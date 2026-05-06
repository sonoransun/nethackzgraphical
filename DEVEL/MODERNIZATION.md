# ModMyNetHack Modernization Notes

This document tracks the modernization effort that started in
2026-05 and is in progress. It complements (not replaces) the
upstream NetHack DevTeam documentation; if you're rebasing onto
NetHack 5.0 from upstream, read this to understand what was added,
removed, or restructured locally.

The full plan lives outside this repository at
`/root/.claude/plans/modernize-this-code-base-goofy-creek.md`.
This file is the in-tree summary.

## What's been added

### Phase 1 — WASM seam proof (shipped 2026-05-04)

- `sys/unix/hints/wasm.500` — hints file for the Emscripten cross-compile.
- `frontend/` — TypeScript + Vite app. Loads `nethack.js`/`nethack.wasm`
  and implements the JS callback for `win/shim/winshim.c`.

### Phase 2 — WebGL2 sprite renderer (shipped 2026-05-06)

- `frontend/src/render/webgl2.ts` — sprite-batched WebGL2 renderer with
  font-atlas ASCII fallback + tile-atlas support keyed by `glyph_info.tileidx`.
- `frontend/scripts/buildTileManifest.ts` — placeholder atlas + manifest.
  Real atlas is produced by feeding `targets/wasm/wasm-data/nhtiles.bmp`
  to this script (BMP→PNG conversion is a TODO; see "Deferred" below).

### Phase 3 — Animation, modern menus, status HUD (shipped 2026-05-06)

- `frontend/src/render/animation.ts` — per-cell tween manager with
  per-monster idle phase offset (Phase 5 raised-bar requirement).
- `frontend/src/ui/menu.ts` — Canvas/DOM hybrid menu replacing the
  Phase 1 auto-cancel stub.
- `frontend/src/ui/status-hud.ts` — styled HUD with HP bar + per-stat
  formatting.
- `frontend/src/ui/prompts.ts` — yn / getlin / display-file modals.

### Phase 4 — Camera + particles + FOV scaffolding (shipped 2026-05-06)

- `frontend/src/render/camera.ts` — tween-capable camera framework.
- `frontend/src/render/particles.ts` — typed-array pooled emitter
  (1024 capacity).
- `frontend/src/render/fov.ts` + `frontend/src/render/shaders/fov.ts` —
  FOV mask + per-pixel darkness shader. Integrated into the renderer
  in Phase 5B.

### Phase 5B — Post-process + terrain shaders (shipped 2026-05-06)

- `frontend/src/render/postprocess.ts` — bloom + vignette + color-grade
  + optional CRT pipeline.
- `frontend/src/render/shaders/terrain.ts` — water, lava, torch flicker,
  altar pillar-of-light, weather rain shaders.
- `frontend/src/render/level-meta.ts` — branch tagging + per-branch
  visual style table (color grade, vignette, bloom, ambient bed).

### Phase 5C — Cinematic flourishes (shipped 2026-05-06)

- `frontend/src/effects/floating-text.ts` — damage numbers, level-up
  sparkle, with regex-based parser of engine combat messages.
- `frontend/src/effects/status-flourishes.ts` — low-HP screen pulse,
  hunger desaturation, confused wobble, hallucinations cycling
  (toggleable).
- `frontend/src/effects/item-aura.ts` — gold/violet/cyan aura overlays.
- `frontend/src/render/parallax.ts` — parallax depth for "tall" tiles.

### Phase 5D — Bookend screens (shipped 2026-05-06)

- `frontend/src/screens/state-machine.ts` — screen routing.
- `frontend/src/screens/title.ts` — parallax title with animated logo.
- `frontend/src/screens/death.ts` — illustrated tombstone (placeholder
  ASCII; real pixel-art lands with Phase 5A commission).
- `frontend/src/screens/victory.ts` — Astral Plane sequence.

### Phase 5E — Ambient soundscape (shipped 2026-05-06)

- `frontend/src/audio/soundscape.ts` — Web Audio crossfading bed
  manager with HP heartbeat layer.
- Real OGG bed files are NOT in the tree (deferred — see below).

### Phase 5F — Settings + accessibility + perf (shipped 2026-05-06)

- `frontend/src/screens/settings.ts` — full settings UI (visual / audio /
  accessibility) persisted to localStorage.
- `frontend/src/accessibility/{screen-reader,colorblind,reduced-motion,perf-monitor}.ts` —
  ARIA live region for messages, SVG color-matrix LUT for color-blind
  presets, reduced-motion plumbing, rolling frame-budget monitor.

### Engine: Headless test harness (shipped 2026-05-06)

- `test/headless/drive.c` + `test/headless/scenarios/*.txt` —
  scripted-input regression harness linking against `libnh.a`.
- `make check-headless` target in `sys/unix/Makefile.top`.

### Engine: EM_JS read-only state export (shipped 2026-05-06)

- `sys/libnh/libnhmain.c:js_globals_init` extended with read access to
  `u.uhp`, `u.uhpmax`, `u.uen`, `u.uenmax`, `u.ulevel`, `u.uhunger`,
  `u.uz.dnum`, `u.uz.dlevel`, `u.ux`, `u.uy`. The frontend reads these
  from `globalThis.nethackGlobal.globals.u.*`. **Strict no-mutate
  contract** — JS must never assign through these getters even though
  the underlying CREATE_GLOBAL macro creates writable properties.

### Engine: CI workflow (shipped 2026-05-06)

- `.github/workflows/frontend.yml` — frontend build/test/typecheck +
  WASM cross-compile + headless harness + Playwright smoke. Runs in
  parallel with Azure Pipelines (which is unchanged).

### Engine: globals migration in-place (shipped 2026-05-06)

- **`g_win` migrated.** WIN_MESSAGE/WIN_STATUS/WIN_MAP/WIN_INVEN moved
  from loose `extern winid` declarations in `include/decl.h` into
  `struct win_globals g_win` defined in `src/decl.c` and declared in
  `include/g_win.h`. The header provides `#define` shims so every
  existing call site (`WIN_MAP = foo`, `&WIN_MAP`, `clear_nhwindow(WIN_MAP)`)
  compiles unchanged. Vestigial duplicate `extern winid WIN_STATUS` in
  three files (`win/tty/wintty.c:4258`, `win/win32/mhmain.c:24`,
  `win/win32/mswproc.c:2892`) replaced with a comment.
  Verified by Linux `make all` build.
- **`g_term` / `g_classes` deemed already migrated.** On investigation
  the target globals (`tc_gbl_data`, `monsyms`, `oc_syms`, `tune`)
  were already grouped into existing instance structs (`gt`, `gs`,
  `gp`, `gr`, `svt`) by upstream. The standalone externs in `decl.h`
  were vestigial — they had no matching definitions. Removed those
  externs and fixed one bug at `src/dungeon.c:164,223` that used
  `sizeof tune` instead of `sizeof svt.tune`. The `g_term.h` and
  `g_classes.h` files are now no-op markers documenting the finding.

### Engine: dead-platform retirement (shipped 2026-05-06)

The Phase D dead-platform sweep — large but mechanical. Four passes:

1. **Directories deleted:**
   - `outdated/` (3.1 MB, already labeled "outdated" by upstream)
   - `sys/amiga/` (532 KB)
   - `sys/msdos/` (416 KB)
   - `sys/vms/` (360 KB)
2. **Dead `sys/share/*.c` removed:** `tclib.c`, `uudecode.c`,
   `pcmain.c`, `pcsys.c`, `pctty.c`, `pcunix.c`. Total ~50 KB of
   PC/Atari/etc. legacy.
3. **Orphan headers removed:** `include/{amiconf.h, micro.h, pcconf.h,
   vmsconf.h}`. The `#include "vmsconf.h"`/`pcconf.h`/`amiconf.h`
   blocks in `include/global.h` (gated by `#ifdef VMS|MSDOS|AMIGA`)
   were also removed since the platforms are gone.
4. **`tradstdc.h` retained.** Despite being mostly K&R relics, it
   still defines live `VA_DECL`/`VA_INIT`/`VA_ARGS`/`VA_END` macros
   that `src/end.c:394-469` (and a few others) use for variadic
   function declarations. A separate cleanup PR could replace those
   call sites with native `<stdarg.h>` and then delete the file.
5. **Build system updates:**
   - `sys/unix/Makefile.src`: removed `micro.h`, `pcconf.h`,
     `vmsconf.h` from header dep lists; added `g_win.h`. Removed
     `pcmain.c`, `pcsys.c`, `pctty.c`, `pcunix.c`, `pmatchregex.c`
     from `SYSCSRC`. Removed the `pmatchregex.o` build rule.
   - `azure-pipelines.yml`: removed the `linux_latest_cross_msdos`
     matrix entry.

**Not yet done (follow-up):** removing the still-referenced `#ifdef
AMIGA|MSDOS|OS2|TOS|VMS|MACOS9` blocks throughout `src/*.c` and
`include/*.h`. These are now unreachable code paths (their headers
are gone, their platforms are gone) but the `#ifdef`s themselves
remain. The build doesn't care — preprocessor evaluates them as false
— but the source is cluttered. Sweep across ~100 files; mechanical.

### Engine: regex backend consolidation (shipped 2026-05-06)

- **`sys/share/pmatchregex.c` deleted.** Was the fallback for
  platforms without POSIX regex; with those platforms gone, no longer
  needed. POSIX regex on Unix (`sys/share/posixregex.c`), C++11
  `<regex>` on Windows (`sys/share/cppregex.cpp`).
- Build rule + source list entry removed from `sys/unix/Makefile.src`.
- Verified by Linux `make all` build.

### Frontend: BMP→PNG conversion in build:atlas (shipped 2026-05-06)

- `frontend/scripts/buildTileManifest.ts` now decodes real
  `nhtiles.bmp` files. Supports BITMAPINFOHEADER (40-byte header
  variant) at 8-bit paletted (BI_RGB), 24-bit RGB, and 32-bit RGBA;
  rejects compressed (RLE) and unusual-bpp BMPs with a clear error.
- Decoder + PNG encoder are exported for testing; 6 unit tests cover
  24-bit, 8-bit-paletted, row-stride padding, and error cases.
- Run: `npm run build:atlas -- --source-bmp ../targets/wasm/wasm-data/nhtiles.bmp`

### Frontend: render-to-FBO + post-process composite (shipped 2026-05-06)

- `webgl2.ts` gained `setRenderTarget(fbo, w, h)` and an
  `onAfterRender` hook. The MapRenderer now draws into the
  PostProcessPipeline's scene FBO; `onAfterRender` triggers
  `pp.composite()` which runs bloom → color-grade → vignette →
  optional CRT → screen.
- `postprocess.ts` gained a working `resize()` that tears down and
  recreates FBOs/textures (was a no-op stub).
- `main.ts` constructs `PostProcessPipeline` after the renderer,
  wires settings (`crtEnabled`, `crtScanlineIntensity`,
  `vignetteIntensity`) into the pipeline, and applies the
  per-branch `LevelStyle` whenever a level transition is detected.
- The post-process settings live-update from the Settings screen.

## Deferred items (next sessions / external work)

These have a defined scope and design but require either external
work (art commissioning, audio sourcing) or verification across
platforms (Windows, macOS) that isn't available in the current
environment.

### Phase 5A — Commissioned 64×64 monster atlas (~2-3 month lead time)

- ~370 monsters at 64×64 with 4 frames each (idle 2-frame loop +
  attack + hurt). Estimated $5–10k via Pixel Joint / ArtStation.
- ~600 objects from CC-licensed packs (Oryx, Kenney, OpenGameArt LPC),
  retouched.
- Terrain hand-authored for the high-traffic branches.
- Custom pixel font (commission or m6x11 / Pixel Operator).

The frontend's atlas loader (`frontend/src/render/atlas.ts`) and
manifest schema are designed to accommodate this without code changes.
When the art lands, `npm run build:atlas` produces `nhtiles-64.png` +
`atlas.json` and the frontend picks them up automatically.

### Phase 5E — CC0 audio bed sourcing

- ~10 ambient beds from freesound.org (manual curation):
  `surface`, `dungeon-hum`, `cave-drip`, `crystal-cavern`, `sokoban`,
  `crackling-fire`, `brimstone-wind`, `water-plane`, `eldritch-hum`,
  `cosmic`, `heartbeat`.
- Files go in `frontend/public/sounds/ambient/*.ogg`.
- The audio engine already loads them lazily and falls back to
  silence if missing — so the frontend works today with no audio
  files in the tree.

### Phase 5D — Illustrated portraits, tombstones, title backdrop

- Class portraits for the 14 classes (commissioned alongside Phase 5A).
- Tombstone pixel art (replaces the placeholder ASCII in `death.ts`).
- Parallax title backdrop layers (3 layers; CC-licensed or commissioned).

### Engine: `g_player` globals migration (the big one)

The `u*` set — `uarm`, `uarmc`, `uarmh`, `uarms`, `uarmg`, `uarmf`,
`uarmu`, `uskin`, `uamul`, `uleft`, `uright`, `ublindf`, `uwep`,
`uswapwep`, `uquiver`, `uchain`, `uball`, plus `u`, `ubirthday`,
`urealtime` — is ~20 names used by hundreds of files. The mechanical
recipe is the same as `g_win`'s (struct + #define shims) but the
blast radius is much larger. Best done as a dedicated PR that focuses
solely on the migration plus a thorough `make all` + `make
check-headless` + browser smoke run.

### Engine: dead-platform `#ifdef` block sweep

After 2026-05-06, all the dead-platform directories and headers are
gone, but the `#ifdef AMIGA|MSDOS|OS2|TOS|VMS|MACOS9` blocks remain
in ~100 source files (rough estimate via `grep -l`). These are
unreachable code (the macros are never defined), but they clutter
reading. A mechanical follow-up sweep would remove them — best done
as one branch with `unifdef -UAMIGA -UMSDOS -UOS2 -UTOS -UVMS
-UMACOS9` applied across `src/*.c` and `include/*.h`, then a manual
review of the diff.

## What was explicitly NOT done

These are decisions, not oversights:

- **No save-format migration.** The structfield (`sf*`) binary format
  stays. Cloud-save sync, if ever wanted, persists the opaque blob.
- **`NHL_SANDBOX` stays disabled** (`src/nhlua.c:9`). The frontend
  doesn't load arbitrary user Lua.
- **No new `wp_id` for the modern frontend.** The shim suffices.
- **No clang-format sweep of existing code.** New code only (gated in
  CI).
- **No event SFX. No music.** Only ambient soundscape.
- **No 3D rendering.** WebGL2 is for 2D shaders only.
- **No mobile-first responsive design.** Desktop browser primary.

## How to validate after a rebase from upstream

If you sync with the upstream NetHack DevTeam:

1. Resolve conflicts in `include/decl.h`, `src/decl.c`, and
   `include/extern.h` carefully — upstream may have continued the
   `instance_globals_a..t` migration.
2. Verify `sys/unix/hints/wasm.500` still triggers the right
   `cross-pre1.500` / `cross-pre2.500` / `cross-post.500` stanzas
   (upstream may rename or restructure).
3. Verify `sys/libnh/libnhmain.c:js_globals_init` still compiles —
   the `u.uhp` etc. references depend on the canonical `struct you`
   layout.
4. Re-run `make wasm` and `make check-headless`; both should still
   pass without code changes if upstream's churn is small.
