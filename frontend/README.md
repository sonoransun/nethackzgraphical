# frontend — Modern 2D web frontend for ModMyNetHack

A TypeScript + Vite app that loads the Emscripten-built `nethack.js`/`.wasm`
through the existing `libnh` + `win/shim` seam and renders the game in
the browser.

This is **Phase 1**: ASCII glyphs on a Canvas2D, mouse + keyboard input,
no tiles yet. See `/root/.claude/plans/modernize-this-code-base-goofy-creek.md`
for the full four-phase plan.

## Architecture

```mermaid
flowchart TB
  subgraph Engine["Engine (WASM blob loaded as ES module)"]
    direction TB
    moveloop[allmain.c moveloop]
    moveloop --> wp["windowprocs.win_*<br>vtable, src/windows.c"]
    wp --> shim["win/shim/winshim.c<br>DECLCB / VDECLCB"]
    shim --> emjs["EM_JS local_callback<br>winshim.c:264-322"]
    setcb["_shim_graphics_set_callback<br>JS → C registration"]
  end

  emjs -->|Asyncify suspends C stack| boundary[(JS / WASM boundary)]
  boundary --> dispatch[globalThis.nethackCallback<br>= dispatch in shim/dispatcher.ts]
  dispatch --> handlers[handlers/window-procs.ts<br>switch on shim_* name]
  handlers --> map[render/webgl2.ts<br>MapRenderer]
  handlers --> menu[ui/menu.ts<br>MenuController]
  handlers --> hud[ui/status-hud.ts<br>StatusHUD]
  handlers --> prompt[ui/prompts.ts<br>PromptController]
  handlers --> sound[audio/soundscape.ts]
  handlers --> input[input/keyboard.ts<br>InputQueue]

  map --> pp[render/postprocess.ts<br>PostProcessPipeline]
  pp --> screen[(screen)]
  input -. async key/click resolves<br>shim_nhgetch / shim_nh_poskey .-> handlers
  handlers -. ret_ptr written + Promise resolves .-> boundary
  boundary -->|wakeUp| emjs

  setcb -. one-time at boot<br>(main.ts) .-> dispatch
```

The engine doesn't know JavaScript exists. It calls `windowprocs.win_print_glyph(...)`, the vtable dispatches to `shim_print_glyph` in `winshim.c`, the `VDECLCB` macro marshals args + name + format string, `EM_JS local_callback` crosses into JS via Asyncify (which suspends the C stack), the JS dispatcher routes by name to a handler, the handler does its work, and the C stack resumes. To the engine it looks like a synchronous function call that took a few milliseconds.

## Prerequisites

- **Node.js ≥ 20** + npm
- **Emscripten ≥ 3.1** (provides `emcc`, `emar`, `emranlib`)
  - Install via [emsdk](https://emscripten.org/docs/getting_started/downloads.html)
  - Activate in the shell: `source /path/to/emsdk/emsdk_env.sh`
- **Lua sources** — fetched once via `make fetch-Lua` from the repo root

## Build the engine (WASM)

From the repo root:

```sh
cd sys/unix
sh setup.sh hints/wasm.500              # generate Makefiles for the WASM build
cd ../..
make fetch-Lua                          # one-time, downloads Lua 5.4.8 source
make wasm                               # produces targets/wasm/nethack.{js,wasm,data}
```

The hints file `sys/unix/hints/wasm.500` activates the existing WASM
cross-compile recipe in `sys/unix/hints/include/cross-pre1.500`,
`cross-pre2.500`, and `cross-post.500`. The recipe sets:

- `DEFAULT_WINDOW_SYS="shim"` so `wp_shim` is the active port
- `-DSHIM_GRAPHICS -DLIBNH -DDLB -DNOTTYGRAPHICS`
- `-sASYNCIFY -sASYNCIFY_IMPORTS=['local_callback']` so JS callbacks can
  block the C stack and resume it
- `-sEXPORT_ES6=1 -sMODULARIZE` so `nethack.js` is an ES module factory
- `-sEXPORTED_FUNCTIONS=['_main','_shim_graphics_set_callback','_repopulate_perminvent','_malloc']`
- `--embed-file targets/wasm/wasm-data@/` so the dlb data, sysconf,
  oracle/quest/options/etc. are baked into the virtual filesystem

## Build the frontend

```sh
cd frontend
npm install
./scripts/sync-wasm.sh           # copies targets/wasm/* into public/wasm/
npm run dev                      # http://localhost:5173
```

The sync script needs to run again after every `make wasm`. In CI the
order is: `make wasm` → `./frontend/scripts/sync-wasm.sh` → `npm run build`.

## How input works

The engine calls `shim_nhgetch()` / `shim_nh_poskey()` synchronously to
read input. These cross into JS via Emscripten's Asyncify, which
suspends the C stack while the JS Promise resolves and resumes it
afterwards (`win/shim/winshim.c:264-322` is the `EM_JS` block).

The frontend implements this with a queue:

- DOM `keydown` and `mousedown` events push onto an `InputQueue`
- The handler for `shim_nhgetch` pops the next event with `await
  queue.next()`
- For mouse clicks, the handler also writes `(cellX, cellY, mod)` back
  through the C-side out-pointers via `Module.setValue(ptr, val, "i8")`

## What works in Phase 1

- ASCII map rendering (Canvas2D, 80×21 grid, 16-color palette)
- Keyboard input: letters, digits, vi keys, arrows mapped to vi keys,
  Ctrl+letter, Esc/Tab/Enter/Backspace
- Mouse click → travel/look (right-click = examine)
- Message and status windows as DOM elements above/below the map
- Engine boot, player auto-named "Player", random class

## What does NOT work yet (deliberate)

- Menus auto-cancel (returning -1 from `shim_select_menu`). Inventory,
  pickup, throw, etc. silently dismiss. Phase 3 wires the real menu UI.
- Tile rendering — Phase 2 (`buildTileManifest.ts` script + tileidx blits).
- Animation frames, smooth scroll, FOV gradient — Phase 4.
- Save / restore via IDBFS. The flags are linked in but not exercised
  by the frontend yet.

## Common issues

**`Failed to load /wasm/nethack.js`** — you haven't run
`./scripts/sync-wasm.sh` (or the `make wasm` itself failed). Check
`targets/wasm/` exists in the repo root.

**"Module is missing `callMain`"** — the WASM build didn't include
`callMain` in `EXPORTED_RUNTIME_METHODS`. Verify
`sys/unix/hints/include/cross-pre2.500:283-285` lists it.

**`Asyncify` errors / "second call to local_callback"** — a JS handler
called the engine reentrantly. Each handler must complete (or await)
before the engine is allowed to invoke another shim function. The
warning at `winshim.c:313` is the engine's own reentrancy guard.

**Engine logs "no handler for shim_xxx"** — expected for callbacks the
Phase 1 handler set hasn't implemented. Add to
`src/handlers/window-procs.ts` if it blocks gameplay.
