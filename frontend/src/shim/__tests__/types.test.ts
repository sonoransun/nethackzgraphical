// Sanity-check the glyph_info struct decoder against the layout in
// include/wintype.h:103-108. If the engine ever changes the struct
// (re-orders fields, drops ENHANCED_SYMBOLS), this test will catch the
// drift before the frontend silently renders garbage.

import { describe, it, expect } from "vitest";
import { readGlyphInfo, GLYPH_INFO_SIZE } from "../types";

describe("readGlyphInfo", () => {
  it("decodes all fields at the documented offsets", () => {
    const buffer = new ArrayBuffer(GLYPH_INFO_SIZE + 8);
    const view = new DataView(buffer);

    // Place the struct at offset 4 to make sure the decoder honors
    // the base pointer rather than assuming offset 0.
    const base = 4;
    view.setInt32(base + 0, 1234, true);                 // glyph
    view.setInt32(base + 4, "@".charCodeAt(0), true);    // ttychar
    view.setUint32(base + 8, 0x01abcdef, true);          // framecolor (NH_BASIC_COLOR set)
    view.setUint32(base + 12, 0x00000003, true);         // glyphflags
    view.setInt32(base + 16, 11, true);                  // sym.color = CLR_YELLOW
    view.setInt32(base + 20, 42, true);                  // sym.symidx
    view.setUint32(base + 24, 0x00ff8030, true);         // customcolor
    view.setUint16(base + 28, 99, true);                 // color256idx
    view.setInt16(base + 30, 256, true);                 // tileidx
    view.setUint32(base + 32, 0x12345678, true);         // u (ptr)

    const info = readGlyphInfo(view, base);
    expect(info.glyph).toBe(1234);
    expect(info.ttychar).toBe(0x40);
    expect(info.framecolor).toBe(0x01abcdef);
    expect(info.glyphflags).toBe(3);
    expect(info.symColor).toBe(11);
    expect(info.symIdx).toBe(42);
    expect(info.customColor).toBe(0x00ff8030);
    expect(info.color256idx).toBe(99);
    expect(info.tileidx).toBe(256);
    expect(info.uPtr).toBe(0x12345678);
  });

  it("treats negative tileidx (no tile) correctly", () => {
    const buffer = new ArrayBuffer(GLYPH_INFO_SIZE);
    const view = new DataView(buffer);
    view.setInt16(30, -1, true);
    const info = readGlyphInfo(view, 0);
    expect(info.tileidx).toBe(-1);
  });
});
