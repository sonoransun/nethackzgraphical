// Per-cell animation state. The renderer reads frame indices through
// frameAt() (atlas.ts), which already gives us per-cell phase offset
// and per-tile fps/frame-count. This module adds glyph transitions —
// fading between two tile entries when a cell's tileidx changes
// (monster moves, terrain changes), and tween durations for projectiles.
//
// The animation loop is driver-agnostic: a requestAnimationFrame in
// main.ts ticks AnimationManager.update(now) and then calls
// renderer.flush() to draw. The manager itself doesn't render; it
// computes interpolation parameters that the renderer (Phase 5C+) can
// query for cinematic effects.

const ROWS = 21;
const COLS = 80;

export interface Transition {
  /** previous tileidx (-1 if none) */
  prev: number;
  /** current tileidx */
  curr: number;
  /** start time in ms (performance.now()) */
  startMs: number;
  /** duration in ms */
  durationMs: number;
}

const NO_TRANSITION: Transition = { prev: -1, curr: -1, startMs: 0, durationMs: 0 };

export class AnimationManager {
  private readonly transitions: Transition[][];
  private readonly nowGetter: () => number;

  constructor(nowGetter: () => number = () => performance.now()) {
    this.nowGetter = nowGetter;
    this.transitions = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({ ...NO_TRANSITION })),
    );
  }

  /** Called when the engine emits a print_glyph for (x, y) with a new
   *  tileidx. If the tile changed, start a transition. */
  noteCellChange(x: number, y: number, prevTile: number, currTile: number, durationMs = 120): void {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    if (prevTile === currTile) return;
    const t = this.transitions[y]![x]!;
    t.prev = prevTile;
    t.curr = currTile;
    t.startMs = this.nowGetter();
    t.durationMs = durationMs;
  }

  /** Returns 0..1 progress through the active transition at (x, y), or
   *  -1 if there is no active transition. The caller (renderer) can
   *  cross-fade prev → curr based on this. */
  progressAt(x: number, y: number): number {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return -1;
    const t = this.transitions[y]![x]!;
    if (t.durationMs <= 0) return -1;
    const dt = this.nowGetter() - t.startMs;
    if (dt >= t.durationMs) {
      // Transition done — clear it so we stop spending cycles here.
      t.durationMs = 0;
      return -1;
    }
    return dt / t.durationMs;
  }

  /** Active count — useful for instrumentation / perf budgets. */
  activeCount(): number {
    let n = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.transitions[y]![x]!.durationMs > 0) n++;
      }
    }
    return n;
  }
}

/** Phase seed for a cell — drives idle animation offset so adjacent
 *  monsters of the same type don't breathe in lockstep. Same hash as
 *  webgl2.ts uses to set the cell phaseSeed. */
export function cellPhaseSeed(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

/** Animation easing curves. */
export const Easing = {
  linear: (t: number) => t,
  easeIn:    (t: number) => t * t,
  easeOut:   (t: number) => 1 - (1 - t) * (1 - t),
  easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicOut:  (t: number) => 1 - Math.pow(1 - t, 3),
  bounceOut: (t: number) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) { const x = t - 1.5 / d; return n * x * x + 0.75; }
    if (t < 2.5 / d) { const x = t - 2.25 / d; return n * x * x + 0.9375; }
    const x = t - 2.625 / d;
    return n * x * x + 0.984375;
  },
};
