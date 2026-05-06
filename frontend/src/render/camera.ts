// Camera framework. Phase 4 ships smooth follow + tween targets;
// Phase 5C bolts on zoom triggers, pan-to-event, and screen shake.
//
// The renderer reads (cameraX, cameraY, zoom) + a transient shake offset
// each frame via setCamera()/setShake(). The camera drives those values
// through update(now, dt). This module is render-agnostic — it just
// produces numbers.

const ROWS = 21;
const COLS = 80;

export type EaseFn = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  in:    (t: number) => t * t,
  out:   (t: number) => 1 - (1 - t) * (1 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
};

interface Tween<T> {
  startMs: number;
  durationMs: number;
  from: T;
  to: T;
  ease: EaseFn;
}

export interface ShakeSpec {
  startMs: number;
  durationMs: number;
  amplitude: number;     // px
  frequency: number;     // Hz
}

export class Camera {
  // Target the camera is following (in cell coords). The renderer
  // converts to pixel offset.
  private targetCellX = COLS / 2;
  private targetCellY = ROWS / 2;

  // Current values that the renderer reads
  private camPxX = 0;
  private camPxY = 0;
  private currentZoom = 1;

  // Smoothing rate for follow (units of "fraction per second")
  private followLerp = 0.18;

  // Active tweens
  private zoomTween: Tween<number> | null = null;
  private panTween: Tween<{ cellX: number; cellY: number }> | null = null;

  // Active shake events (multiple may stack)
  private shakes: ShakeSpec[] = [];
  private shakeOutX = 0;
  private shakeOutY = 0;

  setCellSize(_cellW: number, _cellH: number): void {
    // Reserved hook — the renderer derives pixel offsets from cell coords
    // already. If we ever want camera-driven cell projection here, this
    // is the entry point.
  }

  /** Snap the follow target instantly. Used at level transitions. */
  snapTo(cellX: number, cellY: number): void {
    this.targetCellX = cellX;
    this.targetCellY = cellY;
    // Also snap the rendered camera so we don't see a wide swing on entry.
    this.camPxX = 0;
    this.camPxY = 0;
  }

  /** Smoothly follow target (each frame). */
  followCell(cellX: number, cellY: number): void {
    this.targetCellX = cellX;
    this.targetCellY = cellY;
  }

  /** Phase 5C trigger: zoom in to a level (e.g. 1.3x), then optionally
   *  hold and zoom back. Two calls schedule successive tweens. */
  zoomTo(target: number, durationMs: number, easing: EaseFn = ease.cubicOut): void {
    this.zoomTween = {
      startMs: performance.now(),
      durationMs,
      from: this.currentZoom,
      to: target,
      ease: easing,
    };
  }

  /** Phase 5C trigger: pan to a specific cell, hold focus, return.
   *  The caller is expected to follow up with another panToCell() to
   *  return to the player. */
  panToCell(cellX: number, cellY: number, durationMs: number, easing: EaseFn = ease.inOut): void {
    this.panTween = {
      startMs: performance.now(),
      durationMs,
      from: { cellX: this.targetCellX, cellY: this.targetCellY },
      to: { cellX, cellY },
      ease: easing,
    };
  }

  /** Trigger screen shake. Multiple shakes stack additively. */
  shake(amplitude: number, durationMs: number, frequency = 24): void {
    this.shakes.push({
      startMs: performance.now(),
      durationMs,
      amplitude,
      frequency,
    });
  }

  /** Advance the camera state by one frame. Called from main loop. */
  update(now: number, _dtMs: number, cellW: number, cellH: number): void {
    // Pan tween: overrides follow target while active
    if (this.panTween) {
      const t = (now - this.panTween.startMs) / this.panTween.durationMs;
      if (t >= 1) {
        this.targetCellX = this.panTween.to.cellX;
        this.targetCellY = this.panTween.to.cellY;
        this.panTween = null;
      } else {
        const u = this.panTween.ease(t);
        this.targetCellX = this.panTween.from.cellX + (this.panTween.to.cellX - this.panTween.from.cellX) * u;
        this.targetCellY = this.panTween.from.cellY + (this.panTween.to.cellY - this.panTween.from.cellY) * u;
      }
    }

    // Camera offset is the *delta* from the natural map center.
    // Treat (COLS/2, ROWS/2) as the origin where the camera offset is 0.
    const desiredPxX = (this.targetCellX - COLS / 2) * cellW;
    const desiredPxY = (this.targetCellY - ROWS / 2) * cellH;
    this.camPxX += (desiredPxX - this.camPxX) * this.followLerp;
    this.camPxY += (desiredPxY - this.camPxY) * this.followLerp;

    // Zoom tween
    if (this.zoomTween) {
      const t = (now - this.zoomTween.startMs) / this.zoomTween.durationMs;
      if (t >= 1) {
        this.currentZoom = this.zoomTween.to;
        this.zoomTween = null;
      } else {
        const u = this.zoomTween.ease(t);
        this.currentZoom = this.zoomTween.from + (this.zoomTween.to - this.zoomTween.from) * u;
      }
    }

    // Shake: superpose all active shakes; each decays cubic-out
    let sx = 0, sy = 0;
    const activeShakes: ShakeSpec[] = [];
    for (const sh of this.shakes) {
      const t = (now - sh.startMs) / sh.durationMs;
      if (t >= 1) continue;
      const decay = Math.pow(1 - t, 3);
      const wob = sh.amplitude * decay;
      const phase = (now - sh.startMs) / 1000 * sh.frequency * Math.PI * 2;
      sx += Math.sin(phase) * wob;
      sy += Math.cos(phase * 1.31) * wob * 0.6;
      activeShakes.push(sh);
    }
    this.shakes = activeShakes;
    this.shakeOutX = sx;
    this.shakeOutY = sy;
  }

  cameraX(): number { return this.camPxX; }
  cameraY(): number { return this.camPxY; }
  zoom():    number { return this.currentZoom; }
  shakeX():  number { return this.shakeOutX; }
  shakeY():  number { return this.shakeOutY; }

  /** True if any cinematic transition is in flight. */
  isAnimating(): boolean {
    return this.zoomTween !== null || this.panTween !== null || this.shakes.length > 0;
  }
}
