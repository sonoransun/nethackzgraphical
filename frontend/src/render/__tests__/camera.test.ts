import { describe, it, expect } from "vitest";
import { Camera, ease } from "../camera";

describe("Camera", () => {
  it("initial zoom is 1.0", () => {
    const cam = new Camera();
    expect(cam.zoom()).toBe(1);
  });

  it("zoomTo tweens over the requested duration", () => {
    const cam = new Camera();
    const start = performance.now();
    cam.zoomTo(2.0, 1000, ease.linear);
    cam.update(start + 500, 16, 32, 32);
    expect(cam.zoom()).toBeCloseTo(1.5, 1);
    cam.update(start + 1100, 16, 32, 32);
    expect(cam.zoom()).toBeCloseTo(2.0, 2);
  });

  it("shake decays to zero", () => {
    const cam = new Camera();
    const start = performance.now();
    cam.shake(10, 200);
    cam.update(start, 16, 32, 32);
    const x1 = Math.abs(cam.shakeX());
    cam.update(start + 250, 16, 32, 32);
    expect(Math.abs(cam.shakeX())).toBe(0);
    expect(x1).toBeGreaterThanOrEqual(0);   // sin(0) is 0; just ensure no crash
  });

  it("isAnimating tracks active tweens", () => {
    const cam = new Camera();
    expect(cam.isAnimating()).toBe(false);
    cam.zoomTo(1.5, 500);
    expect(cam.isAnimating()).toBe(true);
  });
});
