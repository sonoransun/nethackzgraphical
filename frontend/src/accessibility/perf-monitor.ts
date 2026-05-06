// Lightweight per-frame performance monitor. Phase 5F instrumentation
// for the 16ms target on a mid-range laptop. Records a rolling window
// of frame times; the Settings screen and Playwright tests both query
// the average / p95.

const WINDOW_SIZE = 120;     // 2 seconds at 60fps

export class PerfMonitor {
  private readonly samples: number[] = new Array(WINDOW_SIZE).fill(0);
  private writeIdx = 0;
  private filled = false;
  private lastNow: number | null = null;

  /** Record one frame's elapsed time (ms). Call once per requestAnimationFrame. */
  tick(now = performance.now()): void {
    if (this.lastNow !== null) {
      this.samples[this.writeIdx] = now - this.lastNow;
      this.writeIdx = (this.writeIdx + 1) % WINDOW_SIZE;
      if (this.writeIdx === 0) this.filled = true;
    }
    this.lastNow = now;
  }

  /** Mean frame time in ms over the rolling window. */
  averageMs(): number {
    const n = this.filled ? WINDOW_SIZE : this.writeIdx;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.samples[i]!;
    return sum / n;
  }

  /** Approximate p95 frame time in ms. */
  p95Ms(): number {
    const n = this.filled ? WINDOW_SIZE : this.writeIdx;
    if (n === 0) return 0;
    const sorted = this.samples.slice(0, n).sort((a, b) => a - b);
    return sorted[Math.floor(n * 0.95)]!;
  }

  averageFps(): number {
    const ms = this.averageMs();
    return ms === 0 ? 0 : 1000 / ms;
  }

  reset(): void {
    this.samples.fill(0);
    this.writeIdx = 0;
    this.filled = false;
    this.lastNow = null;
  }
}
