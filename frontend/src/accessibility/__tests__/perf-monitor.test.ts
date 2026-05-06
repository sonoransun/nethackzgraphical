import { describe, it, expect } from "vitest";
import { PerfMonitor } from "../perf-monitor";

describe("PerfMonitor", () => {
  it("returns 0 before any tick", () => {
    const m = new PerfMonitor();
    expect(m.averageMs()).toBe(0);
    expect(m.averageFps()).toBe(0);
    expect(m.p95Ms()).toBe(0);
  });

  it("computes mean across ticks", () => {
    const m = new PerfMonitor();
    let now = 0;
    for (let i = 0; i < 5; i++) {
      m.tick(now);
      now += 16;
    }
    expect(m.averageMs()).toBeCloseTo(16, 1);
    expect(m.averageFps()).toBeCloseTo(62.5, 0);
  });

  it("p95 captures sustained spikes", () => {
    const m = new PerfMonitor();
    let now = 0;
    // 90 normal frames + 10 long frames → 10% are slow, p95 should
    // land in the slow region.
    for (let i = 0; i < 100; i++) {
      m.tick(now);
      now += (i >= 90) ? 80 : 16;
    }
    expect(m.p95Ms()).toBeGreaterThan(16);
  });

  it("reset clears state", () => {
    const m = new PerfMonitor();
    m.tick(0); m.tick(16);
    m.reset();
    expect(m.averageMs()).toBe(0);
  });
});
