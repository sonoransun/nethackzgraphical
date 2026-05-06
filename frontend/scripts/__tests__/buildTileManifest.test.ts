// Verify the BMP decoder handles the formats tile2bmp emits.
// We synthesize tiny BMPs in-memory rather than checking in binary
// fixtures; that keeps the repo lean and the test self-explanatory.

import { describe, it, expect } from "vitest";
import { decodeBmp } from "../buildTileManifest";

/** Build a 24-bit BMP with the supplied RGB pixel rows. Each row must
 *  be `width` triples in (R, G, B) order, top-down. We flip them
 *  bottom-up here to match BMP storage. */
function build24Bmp(width: number, height: number, pixelsTopDown: number[]): Buffer {
  const bytesPerRow = 3 * width;
  const stride = (bytesPerRow + 3) & ~3;
  const imgSize = stride * height;
  const fileSize = 14 + 40 + imgSize;
  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(0, 8);
  buf.writeUInt32LE(54, 10);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);     // BI_RGB
  buf.writeUInt32LE(imgSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const srcY = (height - 1 - y);
    const rowStart = 54 + y * stride;
    for (let x = 0; x < width; x++) {
      const px = pixelsTopDown.slice((srcY * width + x) * 3, (srcY * width + x) * 3 + 3);
      buf[rowStart + x * 3 + 0] = px[2]!;   // B
      buf[rowStart + x * 3 + 1] = px[1]!;   // G
      buf[rowStart + x * 3 + 2] = px[0]!;   // R
    }
  }
  return buf;
}

/** Build an 8-bit paletted BMP, top-down rendering. */
function build8Bmp(width: number, height: number, paletteRgb: number[][], pixelsTopDown: number[]): Buffer {
  const bytesPerRow = width;
  const stride = (bytesPerRow + 3) & ~3;
  const imgSize = stride * height;
  const palSize = paletteRgb.length * 4;
  const imgOffset = 14 + 40 + palSize;
  const fileSize = imgOffset + imgSize;
  const buf = Buffer.alloc(fileSize);

  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(imgOffset, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(8, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(imgSize, 34);
  buf.writeUInt32LE(paletteRgb.length, 46);

  for (let i = 0; i < paletteRgb.length; i++) {
    const [r, g, b] = paletteRgb[i]!;
    const o = 14 + 40 + i * 4;
    buf[o + 0] = b!;
    buf[o + 1] = g!;
    buf[o + 2] = r!;
    buf[o + 3] = 0;
  }

  for (let y = 0; y < height; y++) {
    const srcY = (height - 1 - y);
    for (let x = 0; x < width; x++) {
      buf[imgOffset + y * stride + x] = pixelsTopDown[srcY * width + x]!;
    }
  }
  return buf;
}

describe("decodeBmp 24-bit", () => {
  it("decodes a 2x2 RGB image with correct row order", () => {
    // Top-down pixels: red, green / blue, white
    const pixels = [
      255, 0, 0,    0, 255, 0,
      0, 0, 255,    255, 255, 255,
    ];
    const bmp = build24Bmp(2, 2, pixels);
    const dec = decodeBmp(bmp);
    expect(dec.width).toBe(2);
    expect(dec.height).toBe(2);
    expect(dec.bpp).toBe(24);
    // RGBA layout
    expect(Array.from(dec.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(dec.rgba.slice(4, 8))).toEqual([0, 255, 0, 255]);
    expect(Array.from(dec.rgba.slice(8, 12))).toEqual([0, 0, 255, 255]);
    expect(Array.from(dec.rgba.slice(12, 16))).toEqual([255, 255, 255, 255]);
  });

  it("handles row stride padding for non-multiple-of-4 widths", () => {
    // 3-px-wide row → 9 bytes of pixel data, padded to 12. Decoder
    // must skip 3 bytes per row.
    const pixels = [
      255, 0, 0,   0, 255, 0,   0, 0, 255,
      255, 255, 0,  0, 255, 255,  255, 0, 255,
    ];
    const bmp = build24Bmp(3, 2, pixels);
    const dec = decodeBmp(bmp);
    expect(Array.from(dec.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(dec.rgba.slice(8, 12))).toEqual([0, 0, 255, 255]);
    expect(Array.from(dec.rgba.slice(12, 16))).toEqual([255, 255, 0, 255]);
  });
});

describe("decodeBmp 8-bit paletted", () => {
  it("decodes via the palette", () => {
    const pal = [
      [0, 0, 0],          // 0: black
      [255, 0, 0],        // 1: red
      [0, 255, 0],        // 2: green
      [0, 0, 255],        // 3: blue
    ];
    const indices = [
      1, 2,
      3, 0,
    ];
    const bmp = build8Bmp(2, 2, pal, indices);
    const dec = decodeBmp(bmp);
    expect(dec.bpp).toBe(8);
    expect(Array.from(dec.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(dec.rgba.slice(4, 8))).toEqual([0, 255, 0, 255]);
    expect(Array.from(dec.rgba.slice(8, 12))).toEqual([0, 0, 255, 255]);
    expect(Array.from(dec.rgba.slice(12, 16))).toEqual([0, 0, 0, 255]);
  });
});

describe("decodeBmp errors", () => {
  it("rejects non-BM magic", () => {
    const buf = Buffer.alloc(60);
    buf.write("XX", 0);
    expect(() => decodeBmp(buf)).toThrow(/bad magic/);
  });

  it("rejects compression != BI_RGB", () => {
    const bmp = build24Bmp(2, 2, [
      0,0,0, 0,0,0,
      0,0,0, 0,0,0,
    ]);
    bmp.writeUInt32LE(1 /* BI_RLE8 */, 30);
    expect(() => decodeBmp(bmp)).toThrow(/compression/);
  });

  it("rejects unsupported bpp", () => {
    const bmp = build24Bmp(2, 2, [
      0,0,0, 0,0,0,
      0,0,0, 0,0,0,
    ]);
    bmp.writeUInt16LE(16, 28);
    expect(() => decodeBmp(bmp)).toThrow(/bpp 16/);
  });
});
