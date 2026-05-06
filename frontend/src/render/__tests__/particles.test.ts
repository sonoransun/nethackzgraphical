import { describe, it, expect } from "vitest";
import { ParticleSystem, ParticleKind } from "../particles";

describe("ParticleSystem", () => {
  it("emits and counts active particles", () => {
    const ps = new ParticleSystem();
    expect(ps.active()).toBe(0);
    ps.emit({ x: 10, y: 20, lifeMs: 500, size: 4 });
    expect(ps.active()).toBe(1);
  });

  it("retires particles when their lifetime elapses", () => {
    const ps = new ParticleSystem();
    ps.emit({ x: 0, y: 0, lifeMs: 100, size: 2 });
    ps.update(50);
    expect(ps.active()).toBe(1);
    ps.update(60);
    expect(ps.active()).toBe(0);
  });

  it("integrates velocity and acceleration (semi-implicit Euler)", () => {
    const ps = new ParticleSystem();
    ps.emit({ x: 0, y: 0, vx: 10, vy: 0, ay: 100, lifeMs: 5000, size: 1 });
    ps.update(1000);
    let observedX = 0, observedY = 0;
    ps.forEachAlive((x, y) => { observedX = x; observedY = y; });
    // semi-implicit Euler: v += a*dt first, then x += v*dt
    // After 1s: vx stays 10, vy becomes 100, x = 10, y = 100
    expect(observedX).toBeCloseTo(10, 0);
    expect(observedY).toBeCloseTo(100, 0);
  });

  it("caps at capacity", () => {
    const ps = new ParticleSystem();
    const cap = ps.capacity();
    for (let i = 0; i < cap + 10; i++) {
      ps.emit({ x: 0, y: 0, lifeMs: 10000, size: 1 });
    }
    expect(ps.active()).toBe(cap);
  });

  it("emitBurst fires the requested count (or up to cap)", () => {
    const ps = new ParticleSystem();
    ps.emitBurst(8, 0, 0, 60, 800, 4, [1, 0, 0, 1], ParticleKind.Spark);
    expect(ps.active()).toBe(8);
  });

  it("clear empties the pool", () => {
    const ps = new ParticleSystem();
    ps.emit({ x: 0, y: 0, lifeMs: 500, size: 4 });
    ps.emit({ x: 1, y: 1, lifeMs: 500, size: 4 });
    ps.clear();
    expect(ps.active()).toBe(0);
  });
});
