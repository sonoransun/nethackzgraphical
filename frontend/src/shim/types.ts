// TypeScript mirrors of the engine-side structs the shim hands us as raw
// pointers. Layouts must match include/wintype.h exactly. If the engine
// changes (e.g. ENHANCED_SYMBOLS gets disabled, fields reorder), update
// the offsets here in lockstep.

export const enum WindowType {
  Message = 1,
  Status = 2,
  Map = 3,
  Menu = 4,
  Text = 5,
  PermInvent = 6,
}

export const enum Attr {
  None = 0,
  Bold = 1,
  Dim = 2,
  Italic = 3,
  Underline = 4,
  Blink = 5,
  Inverse = 7,
  Urgent = 16,
  NoHistory = 32,
}

export const WIN_ERR = -1;

// glyph_info layout when ENHANCED_SYMBOLS is defined (the WASM build sets it).
//   +0   int      glyph
//   +4   int      ttychar
//   +8   uint32   framecolor
//   +12  uint     glyph_map.glyphflags
//   +16  int      glyph_map.sym.color
//   +20  int      glyph_map.sym.symidx
//   +24  uint32   glyph_map.customcolor
//   +28  uint16   glyph_map.color256idx
//   +30  int16    glyph_map.tileidx
//   +32  ptr      glyph_map.u (unicode_representation*)
// total 36 bytes
export interface GlyphInfo {
  glyph: number;
  ttychar: number;        // codepoint (engine uses int, fits in u32)
  framecolor: number;     // RGBA-ish; engine packs as uint32
  glyphflags: number;
  symColor: number;       // classic 16-color index
  symIdx: number;
  customColor: number;    // RGB or palette idx
  color256idx: number;
  tileidx: number;        // -1 = no tile; sprite-sheet index otherwise
  uPtr: number;           // unicode_representation* (raw pointer, deref later)
}

export const GLYPH_INFO_SIZE = 36;

export function readGlyphInfo(view: DataView, ptr: number): GlyphInfo {
  // All values little-endian; WASM is LE.
  return {
    glyph:       view.getInt32(ptr + 0,  true),
    ttychar:     view.getInt32(ptr + 4,  true),
    framecolor:  view.getUint32(ptr + 8,  true),
    glyphflags:  view.getUint32(ptr + 12, true),
    symColor:    view.getInt32(ptr + 16, true),
    symIdx:      view.getInt32(ptr + 20, true),
    customColor: view.getUint32(ptr + 24, true),
    color256idx: view.getUint16(ptr + 28, true),
    tileidx:     view.getInt16(ptr + 30, true),
    uPtr:        view.getUint32(ptr + 32, true),
  };
}

// Format codes used in winshim.c's DECLCB/VDECLCB declarations.
//   v  void (return only)
//   i  int (4 bytes signed)
//   s  UTF-8 NUL-terminated string
//   p  pointer (passed through unchanged; we deref ourselves)
//   b  boolean (NetHack maps to int)
//   c  char (1 byte signed)
//   0  char (1 byte; behaves like c in this dispatcher)
//   1  coordxy (1 byte signed in NetHack 5.0)
//   2  short (2 bytes signed)
export type FmtCode = "v" | "i" | "s" | "p" | "b" | "c" | "0" | "1" | "2";

// Map shim function names to the JS-visible argument signatures.
// Useful for typed handler tables. Not exhaustive — extend as we add
// per-callback handlers.
export interface ShimSignatures {
  shim_init_nhwindows: (argcPtr: number, argvPtr: number) => void;
  shim_player_selection_or_tty: () => boolean;
  shim_askname: () => void;
  shim_get_nh_event: () => void;
  shim_exit_nhwindows: (msg: string) => void;
  shim_create_nhwindow: (type: number) => number;
  shim_clear_nhwindow: (winid: number) => void;
  shim_display_nhwindow: (winid: number, blocking: boolean) => void;
  shim_destroy_nhwindow: (winid: number) => void;
  shim_curs: (winid: number, x: number, y: number) => void;
  shim_putstr: (winid: number, attr: number, str: string) => void;
  shim_print_glyph: (
    winid: number,
    x: number,
    y: number,
    glyphPtr: number,
    bkGlyphPtr: number,
  ) => void;
  shim_raw_print: (str: string) => void;
  shim_raw_print_bold: (str: string) => void;
  shim_nhgetch: () => number;
  shim_nh_poskey: (xPtr: number, yPtr: number, modPtr: number) => number;
  shim_nhbell: () => void;
  shim_yn_function: (query: string, resp: string, def: number) => number;
  shim_getlin: (query: string, bufPtr: number) => void;
  shim_get_ext_cmd: () => number;
  shim_mark_synch: () => void;
  shim_wait_synch: () => void;
  shim_delay_output: () => void;
  shim_status_init: () => void;
  shim_status_update: (
    fldidx: number,
    ptr: number,
    chg: number,
    percent: number,
    color: number,
    colormasks: number,
  ) => void;
  shim_update_inventory: (a1: number) => void;
  shim_preference_update: (pref: number) => void;
}

export type ShimName = keyof ShimSignatures;
