// Thin WebGL2 helpers — just enough to keep the renderer code from
// becoming a wall of GL boilerplate. Not a general-purpose abstraction.

export function createShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("gl.createShader returned null");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "(no log)";
    gl.deleteShader(sh);
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`${kind} shader compile failed:\n${log}\n--- source ---\n${source}`);
  }
  return sh;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  if (!prog) throw new Error("gl.createProgram returned null");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "(no log)";
    gl.deleteProgram(prog);
    throw new Error(`program link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export function createTextureFromImage(
  gl: WebGL2RenderingContext,
  image: HTMLImageElement | HTMLCanvasElement,
  options: { mipmap?: boolean; nearest?: boolean } = {},
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("gl.createTexture returned null");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  const filter = options.nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (options.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

export function createEmptyTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: GLenum = gl.RGBA8,
  format: GLenum = gl.RGBA,
  type: GLenum = gl.UNSIGNED_BYTE,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("gl.createTexture returned null");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Pack an RGBA color (each 0..1) into a 32-bit float by writing each
 *  channel as a byte. Returns four floats so they can be uploaded as
 *  vec4 in a vertex attrib. The shader does the multiplication. */
export function rgbaTuple(r: number, g: number, b: number, a = 1.0): [number, number, number, number] {
  return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
}

export function hexToRgb(hex: string): [number, number, number] {
  // Accepts "#rrggbb" or "rrggbb"
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const v = parseInt(h, 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
