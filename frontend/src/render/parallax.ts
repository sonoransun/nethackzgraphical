// Parallax depth illusion. Tall objects (trees, statues, columns,
// dragons, the Wizard of Yendor) lean toward camera by 5–10px when the
// player moves. Background scrolls slightly slower than foreground
// sprites, conveying depth.
//
// Implementation: the renderer accepts a per-cell "tall" flag. When set,
// the cell's vertical draw offset is biased by `parallaxAmount * cameraDxFromCenter`.
// We don't change the engine's logical cell coordinates — only the
// pixel-space offset.
//
// Phase 5C ships the data structure and offset computation; integrating
// the offset into webgl2.ts emit is a follow-up (one extra vertex attrib
// per instance — minor) tracked in MODERNIZATION.md.

const TILE_TALL_HEURISTIC = new Set<number>([
  // Tile indices for "tall" objects. These are placeholder values until
  // the real tile catalog lands; the canonical mapping is built by
  // scripts/buildTileManifest.ts when fed real engine data, and we'll
  // populate this set from the manifest's "tall" metadata.
]);

export interface ParallaxState {
  cameraDx: number;
  cameraDy: number;
}

/** Compute the per-cell pixel offset to apply due to parallax. */
export function parallaxOffset(
  tileidx: number,
  state: ParallaxState,
  amount = 0.06,
): { dx: number; dy: number } {
  if (!TILE_TALL_HEURISTIC.has(tileidx)) return { dx: 0, dy: 0 };
  return {
    dx: -state.cameraDx * amount,
    dy: -state.cameraDy * amount * 0.5,    // less Y movement so it doesn't look unstable
  };
}

/** Tag a tile as tall. Called by the manifest loader if the manifest
 *  includes the "tall" metadata. */
export function markTall(tileidx: number): void {
  TILE_TALL_HEURISTIC.add(tileidx);
}

export function clearTall(): void {
  TILE_TALL_HEURISTIC.clear();
}
