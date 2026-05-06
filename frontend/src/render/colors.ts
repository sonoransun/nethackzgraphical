// 16-color palette mirroring include/color.h:14-30. The engine emits color
// indices in [0..15] for the classic representation, so we look these up.
// NH_BASIC_COLOR (0x1000000) and NH_ALTPALETTE (0x2000000) bits in
// framecolor signal richer color modes; we mask with COLORVAL = 0xFFFFFF
// before indexing.

export const NH_BASIC_COLOR = 0x1000000;
export const NH_ALTPALETTE = 0x2000000;
export const COLORVAL_MASK = 0xffffff;

// Tuned to look right on a dark background. Values are sRGB hex strings.
export const PALETTE_16: readonly string[] = [
  "#000000", // CLR_BLACK
  "#cc4040", // CLR_RED
  "#3aa653", // CLR_GREEN
  "#a07024", // CLR_BROWN (low-intensity yellow)
  "#3070d0", // CLR_BLUE
  "#a040a0", // CLR_MAGENTA
  "#308080", // CLR_CYAN
  "#a0a0a0", // CLR_GRAY (low-intensity white)
  "#606060", // NO_COLOR — render as dim gray, distinguishable from black
  "#ff8030", // CLR_ORANGE
  "#50e060", // CLR_BRIGHT_GREEN
  "#f0e040", // CLR_YELLOW
  "#5090ff", // CLR_BRIGHT_BLUE
  "#e060e0", // CLR_BRIGHT_MAGENTA
  "#60d0e0", // CLR_BRIGHT_CYAN
  "#ffffff", // CLR_WHITE
];

export function resolveColor(framecolor: number, symColor: number): string {
  // If framecolor encodes an RGB value (NH_BASIC_COLOR bit set), mask off
  // the flag bits and use it directly. Otherwise fall back to the classic
  // 16-color sym table.
  if ((framecolor & NH_BASIC_COLOR) !== 0) {
    const rgb = framecolor & COLORVAL_MASK;
    return `#${rgb.toString(16).padStart(6, "0")}`;
  }
  const idx = symColor >= 0 && symColor < PALETTE_16.length ? symColor : 7;
  return PALETTE_16[idx]!;
}
