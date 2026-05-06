// Build a font atlas at startup from Canvas2D so we can render ASCII
// fallback glyphs through the same WebGL2 sprite path used for tiles.
// This means the renderer has exactly one batched draw path, regardless
// of whether the engine emitted a tileidx or only a ttychar.
//
// Atlas layout: 16x16 grid of cells, each `cellSize` px square. Codepoint
// 0..255 maps to (cp & 15, cp >> 4). UTF-8 codepoints above 255 fall
// back to '?' for now; the engine's enhanced symbols are addressed in
// Phase 3 when we have a custom pixel font.

const COLS = 16;
const ROWS = 16;

export interface FontAtlas {
  canvas: HTMLCanvasElement;
  cellSize: number;
  glyphWidth: number;
  glyphHeight: number;
}

export function buildFontAtlas(cellSize = 32, fontPx?: number): FontAtlas {
  const canvas = document.createElement("canvas");
  canvas.width = cellSize * COLS;
  canvas.height = cellSize * ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("font-atlas: 2d context not available");

  const px = fontPx ?? Math.floor(cellSize * 0.78);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";

  for (let cp = 32; cp < 127; cp++) {
    const col = cp & 15;
    const row = cp >> 4;
    const x = col * cellSize + cellSize / 2;
    const y = row * cellSize + cellSize / 2 + 1;
    ctx.fillText(String.fromCodePoint(cp), x, y);
  }
  // A few box-drawing useful for walls if the engine emits them.
  const extras: Array<[number, string]> = [
    [0x90, "│"], [0x91, "─"], [0x92, "┌"], [0x93, "┐"],
    [0x94, "└"], [0x95, "┘"], [0x96, "├"], [0x97, "┤"],
    [0x98, "┬"], [0x99, "┴"], [0x9a, "┼"],
    [0xa0, "·"], [0xa1, "•"], [0xa2, "◊"], [0xa3, "♦"],
    [0xa4, "♥"], [0xa5, "♣"], [0xa6, "♠"], [0xa7, "★"],
  ];
  for (const [cp, ch] of extras) {
    const col = cp & 15;
    const row = cp >> 4;
    const x = col * cellSize + cellSize / 2;
    const y = row * cellSize + cellSize / 2 + 1;
    ctx.fillText(ch, x, y);
  }

  return { canvas, cellSize, glyphWidth: cellSize, glyphHeight: cellSize };
}

/** Map a codepoint to a (col, row) in the atlas. Codepoints we don't
 *  have rasterised return the '?' cell. */
export function fontCellFor(codepoint: number): { col: number; row: number } {
  if (codepoint >= 32 && codepoint < 127) {
    return { col: codepoint & 15, row: codepoint >> 4 };
  }
  if (codepoint >= 0x90 && codepoint <= 0xa7) {
    return { col: codepoint & 15, row: codepoint >> 4 };
  }
  // Unknown — fallback to '?'
  const q = "?".charCodeAt(0);
  return { col: q & 15, row: q >> 4 };
}
