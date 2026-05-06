// Build a tile atlas + manifest from the engine's tile descriptors.
//
// Modes:
//   --source-bmp <path>     read a real BMP from the engine (decoded to RGBA,
//                           re-encoded as PNG, manifest emitted with one
//                           frame per 16×16 tile).
//   (no flags)              emit a procedural placeholder atlas so the
//                           renderer has something to load before the
//                           engine's tile data is built.
//
// Engine BMP format reference: win/share/bmptiles.c. NetHack's tile2bmp
// emits 8-bit paletted (BI_RGB) or 24-bit RGB BMPs with the 40-byte
// BITMAPINFOHEADER. We support both. RLE compression and the larger
// header variants (52/56/108/124/64) are NOT supported — flag them as
// errors and document that nhtiles.bmp from the standard build is fine.
//
// Run via `npm run build:atlas`.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const OUT_DIR = join(PROJECT_ROOT, "public", "tiles");
const OUT_IMG = join(OUT_DIR, "nhtiles-16.png");
const OUT_MANIFEST = join(OUT_DIR, "manifest.json");

const TILE_SIZE = 16;
const TILES_PER_ROW = 40;        // matches engine x11tiles convention
const PLACEHOLDER_TILE_COUNT = 1024;

interface FrameRect { x: number; y: number; w: number; h: number; }
interface TileEntry { frames: FrameRect[]; fps: number; loops: boolean; }
interface Manifest {
  tileSize: number;
  imageWidth: number;
  imageHeight: number;
  tiles: Record<string, TileEntry>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceBmpIdx = args.indexOf("--source-bmp");
  const sourceBmp = sourceBmpIdx >= 0 ? args[sourceBmpIdx + 1] : null;
  const tileSizeIdx = args.indexOf("--tile-size");
  const customTileSize = tileSizeIdx >= 0 ? parseInt(args[tileSizeIdx + 1] ?? "16", 10) : TILE_SIZE;

  ensureDir(OUT_DIR);

  if (sourceBmp && existsSync(sourceBmp)) {
    console.log(`buildTileManifest: decoding source BMP ${sourceBmp}`);
    await buildFromBmp(sourceBmp, customTileSize);
    return;
  }

  console.log("buildTileManifest: no --source-bmp given (or not found); emitting placeholder atlas.");
  console.log("  Re-run with `--source-bmp <path/to/nhtiles.bmp>` once the engine is built.");
  await buildPlaceholder();
}

async function buildPlaceholder(): Promise<void> {
  const cols = TILES_PER_ROW;
  const rows = Math.ceil(PLACEHOLDER_TILE_COUNT / cols);
  const w = cols * TILE_SIZE;
  const h = rows * TILE_SIZE;

  const png = renderPlaceholderPng(w, h, cols, rows);
  writeFileSync(OUT_IMG, png);

  const manifest: Manifest = {
    tileSize: TILE_SIZE,
    imageWidth: w,
    imageHeight: h,
    tiles: {},
  };
  for (let i = 0; i < PLACEHOLDER_TILE_COUNT; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    manifest.tiles[String(i)] = {
      frames: [{ x: col * TILE_SIZE, y: row * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE }],
      fps: 0,
      loops: false,
    };
  }
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${OUT_IMG} (${w}x${h}) and ${OUT_MANIFEST} with ${PLACEHOLDER_TILE_COUNT} entries.`);
}

async function buildFromBmp(sourcePath: string, tileSize: number): Promise<void> {
  const bmp = readFileSync(sourcePath);
  const decoded = decodeBmp(bmp);

  const cols = Math.floor(decoded.width / tileSize);
  const rows = Math.floor(decoded.height / tileSize);
  if (cols === 0 || rows === 0) {
    throw new Error(`BMP ${sourcePath} (${decoded.width}x${decoded.height}) is too small for ${tileSize}px tiles`);
  }
  const totalTiles = cols * rows;

  // Re-encode as PNG. We carry the RGBA bytes through unchanged.
  const png = encodePng(decoded.width, decoded.height, decoded.rgba);
  writeFileSync(OUT_IMG, png);

  const manifest: Manifest = {
    tileSize,
    imageWidth: decoded.width,
    imageHeight: decoded.height,
    tiles: {},
  };
  for (let i = 0; i < totalTiles; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    manifest.tiles[String(i)] = {
      frames: [{ x: col * tileSize, y: row * tileSize, w: tileSize, h: tileSize }],
      fps: 0,
      loops: false,
    };
  }
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(
    `Wrote ${OUT_IMG} (${decoded.width}x${decoded.height}, ${totalTiles} tiles, ${decoded.bpp} bpp source) and ${OUT_MANIFEST}.`,
  );
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

// ---- BMP decoder --------------------------------------------------------
// Supports BITMAPINFOHEADER (40-byte) variants; bpp ∈ {8, 24, 32}.
// Compression must be BI_RGB (0). RLE / BITFIELDS / JPEG / PNG embeds
// are out of scope (the engine's tile2bmp doesn't emit them).
//
// BMP format quirk: rows are stored bottom-up (unless Height is negative,
// which means top-down). Each row is padded to a 4-byte boundary.

interface DecodedBmp {
  width: number;
  height: number;
  bpp: number;
  rgba: Uint8Array;
}

function decodeBmp(buf: Buffer): DecodedBmp {
  if (buf.length < 14) throw new Error("BMP: too short");
  // File header (14 bytes)
  const magic = String.fromCharCode(buf[0]!, buf[1]!);
  if (magic !== "BM") throw new Error(`BMP: bad magic "${magic}", expected "BM"`);
  const imgOffset = readU32LE(buf, 10);

  // BITMAPINFOHEADER (variable, but we read the first 40 bytes)
  const headerSize = readU32LE(buf, 14);
  if (headerSize < 40) {
    throw new Error(`BMP: header size ${headerSize} not supported (need >= 40)`);
  }
  const widthRaw = readS32LE(buf, 18);
  const heightRaw = readS32LE(buf, 22);
  const bpp = readU16LE(buf, 28);
  const compression = readU32LE(buf, 30);
  const colorsUsed = readU32LE(buf, 46);

  if (compression !== 0) {
    throw new Error(
      `BMP: compression ${compression} not supported (only BI_RGB=0). ` +
      `tile2bmp from the standard NetHack build emits BI_RGB; if you have a ` +
      `compressed BMP, decompress it first with imagemagick or similar.`,
    );
  }
  if (![8, 24, 32].includes(bpp)) {
    throw new Error(`BMP: bpp ${bpp} not supported (need 8, 24, or 32)`);
  }

  const width = widthRaw;
  const topDown = heightRaw < 0;
  const height = Math.abs(heightRaw);

  // Palette (only present for bpp <= 8)
  let palette: Uint32Array | null = null;
  if (bpp === 8) {
    const numColors = colorsUsed > 0 ? colorsUsed : 256;
    palette = new Uint32Array(numColors);
    const palOff = 14 + headerSize;
    for (let i = 0; i < numColors; i++) {
      const o = palOff + i * 4;
      // BMP palette entries are BGRA-order
      const b = buf[o + 0]!;
      const g = buf[o + 1]!;
      const r = buf[o + 2]!;
      // Alpha byte often zero for indexed BMPs; force opaque.
      palette[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }

  // Row stride is padded to 4 bytes
  const bytesPerRow = bpp === 8 ? width : (bpp >> 3) * width;
  const stride = (bytesPerRow + 3) & ~3;

  const rgba = new Uint8Array(width * height * 4);

  for (let yIn = 0; yIn < height; yIn++) {
    const yOut = topDown ? yIn : (height - 1 - yIn);
    const rowOff = imgOffset + yIn * stride;
    const rowDst = yOut * width * 4;
    if (bpp === 8) {
      for (let x = 0; x < width; x++) {
        const idx = buf[rowOff + x]!;
        const argb = palette![idx]!;
        rgba[rowDst + x * 4 + 0] = argb & 0xff;
        rgba[rowDst + x * 4 + 1] = (argb >> 8) & 0xff;
        rgba[rowDst + x * 4 + 2] = (argb >> 16) & 0xff;
        rgba[rowDst + x * 4 + 3] = (argb >>> 24) & 0xff;
      }
    } else if (bpp === 24) {
      for (let x = 0; x < width; x++) {
        const o = rowOff + x * 3;
        rgba[rowDst + x * 4 + 0] = buf[o + 2]!;  // R
        rgba[rowDst + x * 4 + 1] = buf[o + 1]!;  // G
        rgba[rowDst + x * 4 + 2] = buf[o + 0]!;  // B
        rgba[rowDst + x * 4 + 3] = 255;
      }
    } else { // 32
      for (let x = 0; x < width; x++) {
        const o = rowOff + x * 4;
        rgba[rowDst + x * 4 + 0] = buf[o + 2]!;
        rgba[rowDst + x * 4 + 1] = buf[o + 1]!;
        rgba[rowDst + x * 4 + 2] = buf[o + 0]!;
        const a = buf[o + 3]!;
        // Some 32-bit BMPs use the alpha byte as padding (always 0);
        // treat fully-zero alpha as opaque.
        rgba[rowDst + x * 4 + 3] = a === 0 ? 255 : a;
      }
    }
  }

  return { width, height, bpp, rgba };
}

function readU16LE(buf: Buffer, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}
function readU32LE(buf: Buffer, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}
function readS32LE(buf: Buffer, off: number): number {
  const v = readU32LE(buf, off);
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

// ---- Placeholder atlas --------------------------------------------------

function renderPlaceholderPng(w: number, h: number, cols: number, rows: number): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const tileRow = Math.floor(y / TILE_SIZE);
    const yInTile = y % TILE_SIZE;
    for (let x = 0; x < w; x++) {
      const tileCol = Math.floor(x / TILE_SIZE);
      const xInTile = x % TILE_SIZE;
      const idx = tileRow * cols + tileCol;
      const off = (y * w + x) * 4;
      const border = (xInTile === 0 || yInTile === 0 || xInTile === TILE_SIZE - 1 || yInTile === TILE_SIZE - 1);
      if (border || idx >= cols * rows) {
        px[off + 0] = 30; px[off + 1] = 30; px[off + 2] = 36; px[off + 3] = 255;
        continue;
      }
      const hue = (idx * 137) % 360;
      const [r, g, b] = hsvToRgb(hue, 0.55, 0.85);
      px[off + 0] = r; px[off + 1] = g; px[off + 2] = b; px[off + 3] = 255;
    }
  }
  return encodePng(w, h, px);
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (h / 60);
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1)      [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else             [r, g, b] = [c, 0, x];
  const m = v - c;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ---- PNG encoder (uncompressed-DEFLATE blocks; minimal, zero deps) -----

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const crcTable = makeCrcTable();
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.subarray(y * stride, (y + 1) * stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }

  const idat = zlibUncompressed(raw);

  const out: Buffer[] = [
    sig,
    chunk("IHDR", ihdr, crcTable),
    chunk("IDAT", idat, crcTable),
    chunk("IEND", Buffer.alloc(0), crcTable),
  ];
  return Buffer.concat(out);
}

function makeCrcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

function crc32(buf: Buffer, table: Uint32Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer, crcTable: Uint32Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data]), crcTable), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function adler32(buf: Buffer): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibUncompressed(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x78, 0x01]));
  let off = 0;
  while (off < data.length) {
    const chunkLen = Math.min(65535, data.length - off);
    const final = off + chunkLen >= data.length ? 1 : 0;
    const hdr = Buffer.alloc(5);
    hdr[0] = final;
    hdr.writeUInt16LE(chunkLen, 1);
    hdr.writeUInt16LE((~chunkLen) & 0xffff, 3);
    parts.push(hdr, data.subarray(off, off + chunkLen));
    off += chunkLen;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(data), 0);
  parts.push(adler);
  return Buffer.concat(parts);
}

// Exported for test harness
export { decodeBmp, encodePng };

// Only run main() when invoked directly (not when imported by tests).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
