import { describe, it, expect } from "vitest";
import { resolveColor, NH_BASIC_COLOR, PALETTE_16 } from "../colors";

describe("resolveColor", () => {
  it("returns the framecolor RGB when NH_BASIC_COLOR is set", () => {
    const fc = NH_BASIC_COLOR | 0xff8030;
    expect(resolveColor(fc, 7)).toBe("#ff8030");
  });

  it("falls back to the 16-color palette when framecolor has no flag bits", () => {
    expect(resolveColor(0, 11)).toBe(PALETTE_16[11]);
    expect(resolveColor(0, 0)).toBe(PALETTE_16[0]);
  });

  it("clamps invalid sym color indices to gray", () => {
    expect(resolveColor(0, -1)).toBe(PALETTE_16[7]);
    expect(resolveColor(0, 99)).toBe(PALETTE_16[7]);
  });
});
