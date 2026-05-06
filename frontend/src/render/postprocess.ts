// Post-process pipeline manager. Owns the offscreen FBOs, the
// per-pass programs, and the composite uniforms. The MapRenderer
// renders into the scene FBO; this module then runs:
//
//   scene FBO ─┬─→ bright pass ─→ blur H ─→ blur V ─→ bloom FBO
//              ├──────────────────────────────────────┐
//              │                                      ▼
//              └─────────────────────────────────→ composite (color grade + vignette)
//                                                      │
//                                                      ▼
//                                               (optional CRT) ─→ screen
//
// For Phase 5B we ship the framework + uniforms tied into per-branch
// LevelStyle. Wiring the MapRenderer to render-to-FBO instead of
// directly to screen is a follow-up task documented in
// MODERNIZATION.md so we don't disrupt the working Phase 2 path.

import {
  FULLSCREEN_VERT,
  BRIGHT_PASS_FRAG,
  BLUR_H_FRAG,
  BLUR_V_FRAG,
  COMPOSITE_FRAG,
  CRT_FRAG,
} from "./shaders/postprocess";
import { createProgram, createEmptyTexture } from "./webgl/gl-helpers";
import type { LevelStyle } from "./level-meta";

export interface PostProcessSettings {
  bloomEnabled: boolean;
  bloomThreshold: number;     // 0..1
  vignetteIntensity: number;  // 0..1
  colorGrade: [number, number, number];
  crtEnabled: boolean;
  crtScanlines: number;       // 0..1
  crtChromatic: number;       // 0..1
  crtBarrel: number;          // 0..1
}

export const DEFAULT_SETTINGS: PostProcessSettings = {
  bloomEnabled: true,
  bloomThreshold: 0.65,
  vignetteIntensity: 0.4,
  colorGrade: [1.0, 1.0, 1.0],
  crtEnabled: false,
  crtScanlines: 0.3,
  crtChromatic: 0.4,
  crtBarrel: 0.06,
};

export class PostProcessPipeline {
  private readonly gl: WebGL2RenderingContext;
  private readonly progBright: WebGLProgram;
  private readonly progBlurH: WebGLProgram;
  private readonly progBlurV: WebGLProgram;
  private readonly progComposite: WebGLProgram;
  private readonly progCrt: WebGLProgram;

  private fboScene: WebGLFramebuffer;
  private texScene: WebGLTexture;
  private fboPing: WebGLFramebuffer;
  private texPing: WebGLTexture;
  private fboPong: WebGLFramebuffer;
  private texPong: WebGLTexture;

  private readonly quadVao: WebGLVertexArrayObject;

  private settings: PostProcessSettings = { ...DEFAULT_SETTINGS };
  private width = 0;
  private height = 0;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;

    this.progBright = createProgram(gl, FULLSCREEN_VERT, BRIGHT_PASS_FRAG);
    this.progBlurH = createProgram(gl, FULLSCREEN_VERT, BLUR_H_FRAG);
    this.progBlurV = createProgram(gl, FULLSCREEN_VERT, BLUR_V_FRAG);
    this.progComposite = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
    this.progCrt = createProgram(gl, FULLSCREEN_VERT, CRT_FRAG);

    this.texScene = createEmptyTexture(gl, width, height);
    this.fboScene = mustCreate(gl.createFramebuffer(), "scene FBO");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScene);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texScene, 0);

    const halfW = Math.max(1, Math.floor(width / 2));
    const halfH = Math.max(1, Math.floor(height / 2));
    this.texPing = createEmptyTexture(gl, halfW, halfH);
    this.fboPing = mustCreate(gl.createFramebuffer(), "ping FBO");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texPing, 0);

    this.texPong = createEmptyTexture(gl, halfW, halfH);
    this.fboPong = mustCreate(gl.createFramebuffer(), "pong FBO");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPong);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texPong, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Shared fullscreen quad VAO
    this.quadVao = mustCreate(gl.createVertexArray(), "quad VAO");
    gl.bindVertexArray(this.quadVao);
    const quad = new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      0, 1, 0, 1,
      0, 1, 0, 1,
      1, 0, 1, 0,
      1, 1, 1, 1,
    ]);
    const quadBuf = mustCreate(gl.createBuffer(), "fullscreen quad VBO");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    // Each program shares the same attrib layout; just bind to the bright pass to pick locations.
    const aPos = gl.getAttribLocation(this.progBright, "a_pos");
    const aUv = gl.getAttribLocation(this.progBright, "a_uv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  setSettings(s: Partial<PostProcessSettings>): void {
    this.settings = { ...this.settings, ...s };
  }

  applyLevelStyle(style: LevelStyle): void {
    this.settings.colorGrade = [...style.colorGrade];
    this.settings.vignetteIntensity = style.vignetteIntensity;
    this.settings.bloomEnabled = style.bloomIntensity > 0;
  }

  /** FBO that the MapRenderer should render the scene into. */
  sceneFBO(): WebGLFramebuffer { return this.fboScene; }
  sceneSize(): { width: number; height: number } { return { width: this.width, height: this.height }; }

  /** Run the pipeline; final pixels go to the default framebuffer (screen). */
  composite(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.disable(gl.BLEND);

    // Bloom: bright-pass + 4-tap separable blur (one round-trip)
    if (this.settings.bloomEnabled) {
      const halfW = Math.max(1, Math.floor(this.width / 2));
      const halfH = Math.max(1, Math.floor(this.height / 2));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing);
      gl.viewport(0, 0, halfW, halfH);
      gl.useProgram(this.progBright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texScene);
      gl.uniform1i(this.must(this.progBright, "u_color"), 0);
      gl.uniform1f(this.must(this.progBright, "u_threshold"), this.settings.bloomThreshold);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPong);
      gl.useProgram(this.progBlurH);
      gl.bindTexture(gl.TEXTURE_2D, this.texPing);
      gl.uniform1i(this.must(this.progBlurH, "u_src"), 0);
      gl.uniform2f(this.must(this.progBlurH, "u_texel"), 1.0 / halfW, 1.0 / halfH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing);
      gl.useProgram(this.progBlurV);
      gl.bindTexture(gl.TEXTURE_2D, this.texPong);
      gl.uniform1i(this.must(this.progBlurV, "u_src"), 0);
      gl.uniform2f(this.must(this.progBlurV, "u_texel"), 1.0 / halfW, 1.0 / halfH);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Composite: scene + bloom + grade + vignette → either pong (if CRT
    // is on, we'll go pong → screen via CRT) or directly to screen.
    const composeTarget = this.settings.crtEnabled ? this.fboPong : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, composeTarget);
    if (composeTarget) gl.viewport(0, 0, this.width, this.height);
    else gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(this.progComposite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texScene);
    gl.uniform1i(this.must(this.progComposite, "u_scene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.settings.bloomEnabled ? this.texPing : this.texScene);
    gl.uniform1i(this.must(this.progComposite, "u_bloom"), 1);
    gl.uniform1f(this.must(this.progComposite, "u_bloomIntensity"), this.settings.bloomEnabled ? 0.6 : 0);
    gl.uniform3f(this.must(this.progComposite, "u_colorGrade"), ...this.settings.colorGrade);
    gl.uniform1f(this.must(this.progComposite, "u_vignette"), this.settings.vignetteIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (this.settings.crtEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.useProgram(this.progCrt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texPong);
      gl.uniform1i(this.must(this.progCrt, "u_src"), 0);
      gl.uniform2f(this.must(this.progCrt, "u_resolution"), this.width, this.height);
      gl.uniform1f(this.must(this.progCrt, "u_scanlineIntensity"), this.settings.crtScanlines);
      gl.uniform1f(this.must(this.progCrt, "u_chromaticIntensity"), this.settings.crtChromatic);
      gl.uniform1f(this.must(this.progCrt, "u_barrelIntensity"), this.settings.crtBarrel);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    // Tear down old FBOs/textures
    gl.deleteFramebuffer(this.fboScene);
    gl.deleteFramebuffer(this.fboPing);
    gl.deleteFramebuffer(this.fboPong);
    gl.deleteTexture(this.texScene);
    gl.deleteTexture(this.texPing);
    gl.deleteTexture(this.texPong);

    this.width = width;
    this.height = height;

    this.texScene = createEmptyTexture(gl, width, height);
    this.fboScene = mustCreate(gl.createFramebuffer(), "scene FBO");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScene);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texScene, 0);

    const halfW = Math.max(1, Math.floor(width / 2));
    const halfH = Math.max(1, Math.floor(height / 2));
    this.texPing = createEmptyTexture(gl, halfW, halfH);
    this.fboPing = mustCreate(gl.createFramebuffer(), "ping FBO");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texPing, 0);

    this.texPong = createEmptyTexture(gl, halfW, halfH);
    this.fboPong = mustCreate(gl.createFramebuffer(), "pong FBO");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPong);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texPong, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private must(program: WebGLProgram, name: string): WebGLUniformLocation {
    const loc = this.gl.getUniformLocation(program, name);
    if (!loc) throw new Error(`postprocess: uniform ${name} not found`);
    return loc;
  }
}

function mustCreate<T>(value: T | null, what: string): T {
  if (value == null) throw new Error(`gl.create${what} returned null`);
  return value;
}
