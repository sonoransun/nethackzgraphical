// FOV / lighting state. Phase 4 ships a per-cell darkness mask that the
// renderer applies as a fullscreen post-process. Phase 5B extends with
// per-pixel torch propagation and emissive bloom.
//
// The engine emits glyphs for (a) currently visible cells, (b) memory
// of previously-visited cells (which appear in the glyph stream with
// GLYPH_*_REMEMBERED bits set on `glyph` — see src/glyphs.c). Phase 1's
// renderer ignores both distinctions; this module turns them into a
// darkness intensity per cell.

const ROWS = 21;
const COLS = 80;

export class FovMask {
  // 0 = fully lit (visible now), 1 = fully dark (never seen),
  // intermediate = remembered (out of FOV).
  private readonly darkness: Uint8Array = new Uint8Array(ROWS * COLS).fill(255);
  private dirty = true;

  /** Engine glyph bits indicating remembered/seen state. The actual
   *  values live in include/display.h around GLYPH_*_REMEMBERED, and
   *  we'll wire them up exactly when the engine state EM_JS export
   *  lands. For now: any glyph emitted is treated as currently visible
   *  (darkness 0); cells without recent emit fade through "remembered"
   *  (darkness ~150) toward "unseen" (darkness 255).
   *  This is an approximation; Phase 5B replaces the darkness texture
   *  source with a real torch propagation simulation. */
  noteGlyphAt(x: number, y: number, _glyphFlags: number): void {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    this.darkness[y * COLS + x] = 0;
    this.dirty = true;
  }

  /** Apply per-frame fade. Cells not refreshed this frame slide toward
   *  remembered intensity; cells last refreshed long ago slide toward
   *  unseen. Called once per turn from the animation loop. */
  fade(): void {
    for (let i = 0; i < this.darkness.length; i++) {
      const v = this.darkness[i]!;
      if (v < 130) this.darkness[i] = Math.min(150, v + 6);
    }
    this.dirty = true;
  }

  reset(): void {
    this.darkness.fill(255);
    this.dirty = true;
  }

  /** Get a typed-array view ready for upload as an R8 texture. */
  textureData(): Uint8Array {
    return this.darkness;
  }

  cols(): number { return COLS; }
  rows(): number { return ROWS; }

  consumeDirty(): boolean {
    if (this.dirty) { this.dirty = false; return true; }
    return false;
  }
}
