import { describe, it, expect } from "vitest";
import { AnimationManager, cellPhaseSeed, Easing } from "../animation";

describe("AnimationManager", () => {
  it("returns -1 when no transition is active", () => {
    const mgr = new AnimationManager(() => 0);
    expect(mgr.progressAt(5, 5)).toBe(-1);
  });

  it("starts a transition only when tile changes", () => {
    let now = 0;
    const mgr = new AnimationManager(() => now);
    mgr.noteCellChange(3, 4, 10, 10);
    expect(mgr.progressAt(3, 4)).toBe(-1);     // same tile = no transition
    mgr.noteCellChange(3, 4, 10, 11, 100);
    now = 50;
    expect(mgr.progressAt(3, 4)).toBeCloseTo(0.5, 1);
  });

  it("clears finished transitions", () => {
    let now = 0;
    const mgr = new AnimationManager(() => now);
    mgr.noteCellChange(3, 4, 10, 11, 100);
    now = 200;
    expect(mgr.progressAt(3, 4)).toBe(-1);
    expect(mgr.activeCount()).toBe(0);
  });

  it("ignores out-of-bounds writes", () => {
    const mgr = new AnimationManager(() => 0);
    mgr.noteCellChange(-1, 5, 1, 2);
    mgr.noteCellChange(80, 5, 1, 2);
    mgr.noteCellChange(5, 21, 1, 2);
    expect(mgr.activeCount()).toBe(0);
  });
});

describe("cellPhaseSeed", () => {
  it("produces stable distinct seeds per cell", () => {
    const a = cellPhaseSeed(3, 4);
    const b = cellPhaseSeed(4, 3);
    const c = cellPhaseSeed(3, 4);
    expect(a).toBe(c);
    expect(a).not.toBe(b);
  });
});

describe("Easing", () => {
  it("linear is identity", () => {
    expect(Easing.linear(0.5)).toBe(0.5);
  });
  it("easeOut starts faster", () => {
    expect(Easing.easeOut(0.1)).toBeGreaterThan(0.1);
    expect(Easing.easeOut(0)).toBe(0);
    expect(Easing.easeOut(1)).toBe(1);
  });
  it("cubicOut starts very fast", () => {
    expect(Easing.cubicOut(0.5)).toBeGreaterThan(0.5);
  });
});
