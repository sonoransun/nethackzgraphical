// Phase 1 renderer: ASCII glyphs on a Canvas2D context.
// Phase 2 will swap this for a tile blitter; the API surface is kept
// minimal so the swap is local.

import { type GlyphInfo, readGlyphInfo, GLYPH_INFO_SIZE } from "../shim/types";
import type { EmscriptenModule } from "../shim/dispatcher";
import { resolveColor } from "./colors";

const ROWS = 21;        // NetHack map rows (engine constant, see include/global.h)
const COLS = 80;        // map cols
const MARGIN = 4;       // px around the grid

interface Cell {
  ch: string;
  color: string;
  bg: string;
}

const EMPTY_CELL: Cell = { ch: " ", color: "#a0a0a0", bg: "#000000" };

export class MapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cells: Cell[][];
  private cellW = 12;
  private cellH = 18;
  private fontPx = 16;
  private dirty = true;
  private dataView: DataView | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D context not available");
    this.ctx = ctx;
    this.cells = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({ ...EMPTY_CELL })),
    );
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  bindHeap(module: EmscriptenModule): void {
    // Re-derive the DataView whenever the heap might have grown. Emscripten
    // can move the heap buffer on _malloc, invalidating prior views.
    this.dataView = new DataView(module.HEAPU8.buffer);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const containerW = this.canvas.parentElement?.clientWidth ?? 800;
    const containerH = this.canvas.parentElement?.clientHeight ?? 500;

    this.cellW = Math.max(8, Math.floor((containerW - MARGIN * 2) / COLS));
    this.cellH = Math.max(12, Math.floor((containerH - MARGIN * 2) / ROWS));
    this.fontPx = Math.floor(this.cellH * 0.85);

    const cssW = this.cellW * COLS + MARGIN * 2;
    const cssH = this.cellH * ROWS + MARGIN * 2;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
    this.render();
  }

  putGlyphFromPointer(
    module: EmscriptenModule,
    x: number,
    y: number,
    glyphPtr: number,
    bkglyphPtr: number,
  ): void {
    if (!this.dataView || this.dataView.buffer !== module.HEAPU8.buffer) {
      this.bindHeap(module);
    }
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    if (glyphPtr === 0) return;

    const info = readGlyphInfo(this.dataView!, glyphPtr);
    const bg = bkglyphPtr !== 0 && bkglyphPtr !== glyphPtr
      ? readGlyphInfo(this.dataView!, bkglyphPtr)
      : null;

    this.cells[y]![x] = glyphInfoToCell(info, bg);
    this.dirty = true;
  }

  clearCell(x: number, y: number): void {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    this.cells[y]![x] = { ...EMPTY_CELL };
    this.dirty = true;
  }

  clearAll(): void {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        this.cells[y]![x] = { ...EMPTY_CELL };
      }
    }
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.render();
  }

  private render(): void {
    const { ctx } = this;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.font = `${this.fontPx}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = this.cells[y]![x]!;
        const px = MARGIN + x * this.cellW;
        const py = MARGIN + y * this.cellH;
        if (cell.bg !== "#000000") {
          ctx.fillStyle = cell.bg;
          ctx.fillRect(px, py, this.cellW, this.cellH);
        }
        if (cell.ch !== " ") {
          ctx.fillStyle = cell.color;
          ctx.fillText(cell.ch, px + this.cellW / 2, py + this.cellH / 2);
        }
      }
    }
    this.dirty = false;
  }

  /** Translate a canvas-relative click into a (col, row) cell coordinate. */
  cellAtClientPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left - MARGIN;
    const localY = clientY - rect.top - MARGIN;
    const x = Math.floor(localX / this.cellW);
    const y = Math.floor(localY / this.cellH);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return null;
    return { x, y };
  }
}

function glyphInfoToCell(g: GlyphInfo, bg: GlyphInfo | null): Cell {
  const ch = g.ttychar > 0 && g.ttychar < 0x110000
    ? String.fromCodePoint(g.ttychar)
    : " ";
  const color = resolveColor(g.framecolor, g.symColor);
  // Background glyph rendering: for now we don't fill bg color, just
  // remember the foreground tile. This keeps the look consistent with
  // tty mode in Phase 1; Phase 4 (FOV/lighting) will use bg properly.
  void bg;
  return { ch, color, bg: "#000000" };
}

// Re-export the size constant so callers can sanity-check the layout
// they're decoding matches the build.
export { GLYPH_INFO_SIZE };
