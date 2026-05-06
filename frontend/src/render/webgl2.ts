// WebGL2 sprite-batched renderer (Phase 2).
//
// Replaces the Phase 1 Canvas2D renderer. Same public API — the existing
// handlers keep working. Adds: tile atlas support, animation frame
// selection, a camera framework (ready for Phase 5C zoom/shake), and
// batched draw calls per atlas.
//
// One renderer instance owns:
//   • the WebGL2 context
//   • two atlases (font + tiles) backed by separate textures
//   • two per-frame instance pools (one per atlas)
//   • a per-cell glyph store (the engine state we draw from)
//
// Phase 5B will plug post-process passes between this renderer's output
// and the screen via render-to-FBO. The batching path is already two
// draw calls (tile + font) so it scales straight to N atlases.

import { readGlyphInfo } from "../shim/types";
import type { EmscriptenModule } from "../shim/dispatcher";
import { resolveColor, NH_BASIC_COLOR, COLORVAL_MASK } from "./colors";
import { type LoadedAtlas, frameAt, loadAtlas } from "./atlas";
import { SPRITE_VERT, SPRITE_FRAG } from "./webgl/shaders";
import {
  createProgram,
  createTextureFromImage,
  hexToRgb,
} from "./webgl/gl-helpers";
import { buildFontAtlas, fontCellFor, type FontAtlas } from "./webgl/font-atlas";

const ROWS = 21;
const COLS = 80;
const MARGIN = 4;

interface Cell {
  ttychar: number;
  tileidx: number;
  framecolor: number;
  symColor: number;
  // Stable seed so adjacent monsters don't animate in lockstep
  // (Phase 3 raised-bar requirement).
  phaseSeed: number;
}

const EMPTY_CELL: Cell = {
  ttychar: 0,
  tileidx: -1,
  framecolor: 0,
  symColor: 7,
  phaseSeed: 0,
};

const FLOATS_PER_INSTANCE = 12;
const MAX_INSTANCES_PER_PASS = ROWS * COLS + 256;

// One per-atlas pool. The same VAO is bound for both passes; we just
// re-upload the corresponding instance data and swap the texture.
class InstancePool {
  readonly buf: Float32Array = new Float32Array(MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE);
  count = 0;
  reset(): void { this.count = 0; }
  push(
    dx: number, dy: number, dw: number, dh: number,
    sx: number, sy: number, sw: number, sh: number,
    r: number, g: number, b: number, a: number,
  ): void {
    if (this.count >= MAX_INSTANCES_PER_PASS) return;
    const off = this.count * FLOATS_PER_INSTANCE;
    const b_ = this.buf;
    b_[off + 0] = dx; b_[off + 1] = dy; b_[off + 2] = dw; b_[off + 3] = dh;
    b_[off + 4] = sx; b_[off + 5] = sy; b_[off + 6] = sw; b_[off + 7] = sh;
    b_[off + 8] = r;  b_[off + 9] = g;  b_[off + 10] = b; b_[off + 11] = a;
    this.count += 1;
  }
}

export class MapRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly cells: Cell[][];
  private readonly canvas: HTMLCanvasElement;

  // GL state
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instanceBuf: WebGLBuffer;
  private readonly fontTex: WebGLTexture;
  private tileTex: WebGLTexture | null = null;
  private readonly fontAtlas: FontAtlas;
  private tileAtlas: LoadedAtlas | null = null;

  private readonly uViewport: WebGLUniformLocation;
  private readonly uAtlasSize: WebGLUniformLocation;
  private readonly uCamera: WebGLUniformLocation;
  private readonly uZoom: WebGLUniformLocation;

  private readonly tilePool = new InstancePool();
  private readonly fontPool = new InstancePool();

  // Render state
  private cellW = 32;
  private cellH = 32;
  private dirty = true;
  private dataView: DataView | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private cameraX = 0;
  private cameraY = 0;
  private zoom = 1;
  private startTimeMs = performance.now();
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  private renderTargetFBO: WebGLFramebuffer | null = null;
  private renderTargetW = 0;
  private renderTargetH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 context not available — modern browser required");
    this.gl = gl;

    this.cells = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({ ...EMPTY_CELL })),
    );

    this.program = createProgram(gl, SPRITE_VERT, SPRITE_FRAG);
    this.uViewport = mustGetUniform(gl, this.program, "u_viewport");
    this.uAtlasSize = mustGetUniform(gl, this.program, "u_atlasSize");
    this.uCamera = mustGetUniform(gl, this.program, "u_camera");
    this.uZoom = mustGetUniform(gl, this.program, "u_zoom");

    this.fontAtlas = buildFontAtlas(32);
    this.fontTex = createTextureFromImage(gl, this.fontAtlas.canvas, { nearest: false });

    this.vao = mustCreate(gl.createVertexArray(), "VAO");
    gl.bindVertexArray(this.vao);

    const quad = new Float32Array([
      0, 0,    0, 0,
      1, 0,    1, 0,
      0, 1,    0, 1,
      0, 1,    0, 1,
      1, 0,    1, 0,
      1, 1,    1, 1,
    ]);
    const quadBuf = mustCreate(gl.createBuffer(), "quad VBO");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "a_pos");
    const aUv = gl.getAttribLocation(this.program, "a_uv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    this.instanceBuf = mustCreate(gl.createBuffer(), "instance VBO");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE * 4,
      gl.DYNAMIC_DRAW,
    );

    const stride = FLOATS_PER_INSTANCE * 4;
    const aDst = gl.getAttribLocation(this.program, "a_dst");
    const aSrc = gl.getAttribLocation(this.program, "a_src");
    const aTint = gl.getAttribLocation(this.program, "a_tint");
    gl.enableVertexAttribArray(aDst);
    gl.vertexAttribPointer(aDst, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(aDst, 1);
    gl.enableVertexAttribArray(aSrc);
    gl.vertexAttribPointer(aSrc, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(aSrc, 1);
    gl.enableVertexAttribArray(aTint);
    gl.vertexAttribPointer(aTint, 4, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(aTint, 1);

    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  // ---- Public API (compat with Phase 1 MapRenderer) -----------------------

  bindHeap(module: EmscriptenModule): void {
    this.dataView = new DataView(module.HEAPU8.buffer);
  }

  putGlyphFromPointer(
    module: EmscriptenModule,
    x: number, y: number,
    glyphPtr: number, bkglyphPtr: number,
  ): void {
    if (!this.dataView || this.dataView.buffer !== module.HEAPU8.buffer) {
      this.bindHeap(module);
    }
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    if (glyphPtr === 0) return;

    const info = readGlyphInfo(this.dataView!, glyphPtr);
    void bkglyphPtr;

    const cell = this.cells[y]![x]!;
    cell.ttychar = info.ttychar;
    cell.tileidx = info.tileidx;
    cell.framecolor = info.framecolor;
    cell.symColor = info.symColor;
    cell.phaseSeed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    this.dirty = true;
  }

  clearCell(x: number, y: number): void {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    Object.assign(this.cells[y]![x]!, EMPTY_CELL);
    this.dirty = true;
  }

  clearAll(): void {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) Object.assign(this.cells[y]![x]!, EMPTY_CELL);
    }
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.render();
  }

  cellAtClientPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left - MARGIN;
    const localY = clientY - rect.top - MARGIN;
    const x = Math.floor(localX / this.cellW);
    const y = Math.floor(localY / this.cellH);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null;
    return { x, y };
  }

  // ---- Phase 5C hooks ----------------------------------------------------

  setCamera(x: number, y: number, zoom: number): void {
    this.cameraX = x;
    this.cameraY = y;
    this.zoom = zoom;
    this.dirty = true;
  }

  setShake(dx: number, dy: number): void {
    this.shakeOffsetX = dx;
    this.shakeOffsetY = dy;
    this.dirty = true;
  }

  // ---- Render-target hook (Phase 5B post-process integration) -----------

  /** Direct the next render(s) into the supplied framebuffer instead of
   *  the screen. Pass null to revert to the default framebuffer.
   *  The (width, height) must match the FBO's color attachment size; we
   *  use them for the viewport, not the canvas's own size. */
  setRenderTarget(fbo: WebGLFramebuffer | null, width: number, height: number): void {
    this.renderTargetFBO = fbo;
    this.renderTargetW = width;
    this.renderTargetH = height;
    this.dirty = true;
  }

  /** The drawing-buffer dimensions in pixels. Used by the post-process
   *  pipeline to size its FBOs. */
  drawingBufferSize(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  /** Hook called from main loop to give post-process a chance to
   *  composite. We don't do this internally because the orchestrator
   *  may want to apply additional layers (particles, overlays) between
   *  the scene render and the composite. */
  onAfterRender?: () => void;

  // ---- Atlas loading -----------------------------------------------------

  async loadTileAtlas(imageUrl: string, manifestUrl: string): Promise<boolean> {
    const loaded = await loadAtlas(imageUrl, manifestUrl);
    if (!loaded) return false;
    this.tileAtlas = loaded;
    if (this.tileTex) this.gl.deleteTexture(this.tileTex);
    this.tileTex = createTextureFromImage(this.gl, loaded.image, { nearest: true });
    this.dirty = true;
    return true;
  }

  // ---- Internals ---------------------------------------------------------

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const containerW = this.canvas.parentElement?.clientWidth ?? 800;
    const containerH = this.canvas.parentElement?.clientHeight ?? 500;

    this.cellW = Math.max(12, Math.floor((containerW - MARGIN * 2) / COLS));
    this.cellH = Math.max(16, Math.floor((containerH - MARGIN * 2) / ROWS));

    const cssW = this.cellW * COLS + MARGIN * 2;
    const cssH = this.cellH * ROWS + MARGIN * 2;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = true;
    this.render();
  }

  private render(): void {
    const gl = this.gl;
    this.tilePool.reset();
    this.fontPool.reset();

    const tNow = performance.now() - this.startTimeMs;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = this.cells[y]![x]!;
        if (cell.ttychar === 0 && cell.tileidx < 0) continue;
        this.emitCell(x, y, cell, tNow);
      }
    }

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    // Bind the render target (FBO if post-process is active, else screen).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderTargetFBO);
    if (this.renderTargetFBO) {
      gl.viewport(0, 0, this.renderTargetW, this.renderTargetH);
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.uniform2f(this.uViewport, this.cssWidth, this.cssHeight);
    gl.uniform2f(this.uCamera, this.cameraX + this.shakeOffsetX, this.cameraY + this.shakeOffsetY);
    gl.uniform1f(this.uZoom, this.zoom);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);

    if (this.tilePool.count > 0 && this.tileTex && this.tileAtlas) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.tilePool.buf.subarray(0, this.tilePool.count * FLOATS_PER_INSTANCE));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
      gl.uniform2f(
        this.uAtlasSize,
        this.tileAtlas.image.naturalWidth,
        this.tileAtlas.image.naturalHeight,
      );
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.tilePool.count);
    }
    if (this.fontPool.count > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fontPool.buf.subarray(0, this.fontPool.count * FLOATS_PER_INSTANCE));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fontTex);
      gl.uniform2f(this.uAtlasSize, this.fontAtlas.canvas.width, this.fontAtlas.canvas.height);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.fontPool.count);
    }

    gl.bindVertexArray(null);
    // Unbind the FBO so any subsequent direct-to-screen drawing
    // (overlays, the composite pass) works without surprises.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dirty = false;

    if (this.onAfterRender) this.onAfterRender();
  }

  private emitCell(x: number, y: number, cell: Cell, tNow: number): void {
    const dx = MARGIN + x * this.cellW;
    const dy = MARGIN + y * this.cellH;
    const dw = this.cellW;
    const dh = this.cellH;

    // Try tile atlas first
    if (cell.tileidx >= 0 && this.tileAtlas) {
      const entry = this.tileAtlas.manifest.tiles[String(cell.tileidx)];
      if (entry) {
        const f = frameAt(entry, tNow, cell.phaseSeed);
        const [r, g, b] = colorRGB(cell.framecolor, cell.symColor);
        this.tilePool.push(dx, dy, dw, dh, f.x, f.y, f.w, f.h, r, g, b, 1.0);
        return;
      }
    }

    // Font fallback
    const cp = cell.ttychar > 0 ? cell.ttychar : 0x20;
    const fc = fontCellFor(cp);
    const sx = fc.col * this.fontAtlas.cellSize;
    const sy = fc.row * this.fontAtlas.cellSize;
    const sw = this.fontAtlas.cellSize;
    const sh = this.fontAtlas.cellSize;
    const [r, g, b] = colorRGB(cell.framecolor, cell.symColor);
    this.fontPool.push(dx, dy, dw, dh, sx, sy, sw, sh, r, g, b, 1.0);
  }
}

function colorRGB(framecolor: number, symColor: number): [number, number, number] {
  if ((framecolor & NH_BASIC_COLOR) !== 0) {
    const v = framecolor & COLORVAL_MASK;
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
  }
  return hexToRgb(resolveColor(framecolor, symColor));
}

function mustCreate<T>(value: T | null, what: string): T {
  if (value == null) throw new Error(`gl.create${what} returned null`);
  return value;
}

function mustGetUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (!loc) throw new Error(`uniform ${name} not found in program`);
  return loc;
}

export { ROWS, COLS };
