// Typed-array pooled particle system. No per-particle GC; all state
// lives in a single Float32Array. Capacity caps at 1024 (Phase 4 bar);
// Phase 5C extends with named emitter types.
//
// Each particle stores 12 floats:
//   0: x (px)               6: ax (accel)
//   1: y (px)               7: ay
//   2: vx (px/s)            8: lifeMs (total)
//   3: vy                   9: ageMs
//   4: r * 255              10: size (px)
//   5: g * 255              (a = alpha is computed: 1 - age/life)
//   color packed RGBA in slot 4-5 + slot 11
//
// We use 16 floats per particle (some wasted slots) for nice power-of-two
// alignment, since the WebGL2 instance buffer wants contiguous memory.

export const enum ParticleKind {
  Dust = 0,
  Spark = 1,
  Blood = 2,
  Smoke = 3,
  Magic = 4,
  Fire = 5,
  Ice = 6,
  Lightning = 7,
}

const FLOATS_PER_PARTICLE = 16;
const MAX_PARTICLES = 1024;

export interface EmitOptions {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  ax?: number;
  ay?: number;
  lifeMs: number;
  size: number;
  color?: [number, number, number, number];
  kind?: ParticleKind;
}

export class ParticleSystem {
  private readonly buf = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);
  private alive: boolean[] = new Array(MAX_PARTICLES).fill(false);
  private freeStack: number[] = [];
  private aliveCount = 0;

  constructor() {
    // Initialize free list (high-to-low so emit() returns low indices first
    // — better cache behavior on iteration).
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) this.freeStack.push(i);
  }

  emit(opts: EmitOptions): number {
    const idx = this.freeStack.pop();
    if (idx === undefined) return -1;
    const off = idx * FLOATS_PER_PARTICLE;
    const b = this.buf;
    b[off + 0]  = opts.x;
    b[off + 1]  = opts.y;
    b[off + 2]  = opts.vx ?? 0;
    b[off + 3]  = opts.vy ?? 0;
    b[off + 4]  = (opts.color?.[0] ?? 1);
    b[off + 5]  = (opts.color?.[1] ?? 1);
    b[off + 6]  = opts.ax ?? 0;
    b[off + 7]  = opts.ay ?? 0;
    b[off + 8]  = opts.lifeMs;
    b[off + 9]  = 0;
    b[off + 10] = opts.size;
    b[off + 11] = opts.color?.[2] ?? 1;
    b[off + 12] = opts.color?.[3] ?? 1;
    b[off + 13] = opts.kind ?? ParticleKind.Dust;
    this.alive[idx] = true;
    this.aliveCount++;
    return idx;
  }

  /** Burst-emit `n` particles in a circular spread around (x, y).
   *  Used by spell impacts (Phase 5C). */
  emitBurst(
    n: number,
    x: number, y: number,
    speed: number, lifeMs: number, size: number,
    color: [number, number, number, number],
    kind: ParticleKind = ParticleKind.Spark,
  ): void {
    for (let i = 0; i < n; i++) {
      if (this.aliveCount >= MAX_PARTICLES) return;
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const spd = speed * (0.7 + Math.random() * 0.6);
      this.emit({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        ay: 80,    // gentle gravity by default
        lifeMs: lifeMs * (0.7 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.8),
        color,
        kind,
      });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      const off = i * FLOATS_PER_PARTICLE;
      const b = this.buf;
      b[off + 9] += dtMs;
      if (b[off + 9]! >= b[off + 8]!) {
        this.alive[i] = false;
        this.freeStack.push(i);
        this.aliveCount--;
        continue;
      }
      // Integrate
      b[off + 2] += b[off + 6]! * dt;
      b[off + 3] += b[off + 7]! * dt;
      b[off + 0] += b[off + 2]! * dt;
      b[off + 1] += b[off + 3]! * dt;
    }
  }

  clear(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.alive[i]) {
        this.alive[i] = false;
        this.freeStack.push(i);
      }
    }
    this.aliveCount = 0;
  }

  /** Iterate alive particles, calling `fn(x, y, size, r, g, b, a)` for each.
   *  Returns count rendered. */
  forEachAlive(fn: (x: number, y: number, size: number, r: number, g: number, b: number, a: number) => void): number {
    let n = 0;
    const b = this.buf;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      const off = i * FLOATS_PER_PARTICLE;
      const lifeFrac = b[off + 9]! / b[off + 8]!;
      const a = (1 - lifeFrac) * b[off + 12]!;  // fade out, multiplied by base alpha
      fn(b[off + 0]!, b[off + 1]!, b[off + 10]!, b[off + 4]!, b[off + 5]!, b[off + 11]!, a);
      n++;
    }
    return n;
  }

  active(): number { return this.aliveCount; }
  capacity(): number { return MAX_PARTICLES; }
}
