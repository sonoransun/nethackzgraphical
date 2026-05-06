// Dispatcher for the libnh / winshim seam.
//
// The WASM-side code (win/shim/winshim.c:264-322) calls our registered JS
// callback as `userCallback(name, ...jsArgs)` and expects a Promise that
// resolves to the return value. It also expects two helper functions on
// `globalThis.nethackGlobal.helpers` (named `getPointerValue` and
// `setPointerValue`) which it uses to convert pointer-typed arguments
// before calling us, and to write back our return value through `ret_ptr`.
//
// We are responsible for installing all three:
//   globalThis.nethackGlobal.helpers.getPointerValue(name, ptr, type)
//   globalThis.nethackGlobal.helpers.setPointerValue(name, ptr, type, val)
//   globalThis[callbackName] = async (name, ...args) => retVal
//
// The dispatcher itself is a single switch over `name` with handlers
// registered via `registerHandler`. Unknown handlers no-op and log so we
// can incrementally fill them in without crashing the engine.

import type { FmtCode, ShimName } from "./types";

// The Emscripten module type — we only consume the parts we need.
export interface EmscriptenModule {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: number, type: string): void;
  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
  stringToUTF8(str: string, ptr: number, maxBytes: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  ccall(name: string, ret: string | null, types: string[], args: unknown[]): unknown;
  cwrap(name: string, ret: string | null, types: string[]): (...args: unknown[]) => unknown;
}

// Handler signature: receives the decoded args and returns the engine's
// expected reply. May be sync or async; the dispatcher always awaits.
export type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

const handlers = new Map<string, Handler>();

export function registerHandler(name: ShimName | string, fn: Handler): void {
  handlers.set(name, fn);
}

export function unregisterHandler(name: string): void {
  handlers.delete(name);
}

let _module: EmscriptenModule | null = null;
function mod(): EmscriptenModule {
  if (!_module) throw new Error("dispatcher: module not bound; call bindModule() first");
  return _module;
}

export function bindModule(m: EmscriptenModule): void {
  _module = m;
}

// --- Pointer value helpers -------------------------------------------------
// These run on the WASM side via Asyncify.handleSleep (winshim.c:269) so they
// MUST be synchronous. Async work happens inside the user callback.

function getPointerValue(_name: string, ptr: number, type: FmtCode): unknown {
  const m = mod();
  switch (type) {
    case "v": return undefined;
    case "i": return m.getValue(ptr, "i32");
    case "b": return m.getValue(ptr, "i32") !== 0;
    case "c": return m.getValue(ptr, "i8");
    case "0": return m.getValue(ptr, "i8");
    case "1": return m.getValue(ptr, "i8");  // coordxy is signed 8-bit
    case "2": return m.getValue(ptr, "i16");
    case "s": return ptr === 0 ? null : m.UTF8ToString(ptr);
    case "p": return ptr;                    // passthrough
    default: {
      const exhaustive: never = type;
      throw new Error(`getPointerValue: unhandled type code ${exhaustive}`);
    }
  }
}

function setPointerValue(name: string, ptr: number, type: FmtCode, value: unknown): void {
  if (ptr === 0 || type === "v") return;
  const m = mod();
  switch (type) {
    case "i":
      m.setValue(ptr, (value as number) | 0, "i32");
      return;
    case "b":
      m.setValue(ptr, value ? 1 : 0, "i32");
      return;
    case "c":
    case "0": {
      // Char return: accept either a number (codepoint) or a 1-char string.
      const ch = typeof value === "string"
        ? (value.length > 0 ? value.charCodeAt(0) : 0)
        : ((value as number) | 0);
      m.setValue(ptr, ch & 0xff, "i8");
      return;
    }
    case "1":
      m.setValue(ptr, (value as number) | 0, "i8");
      return;
    case "2":
      m.setValue(ptr, (value as number) | 0, "i16");
      return;
    case "p":
      m.setValue(ptr, (value as number) | 0, "i32");
      return;
    case "s": {
      // String return: we own a freshly-malloc'd buffer in the C heap.
      // The engine is expected to free this; if it doesn't, we leak.
      // shim_get_color_string and shim_getmsghistory are the only callers
      // we currently care about; both expect the engine to take ownership.
      const str = (value as string | null) ?? "";
      const bytes = new TextEncoder().encode(str);
      const buf = m._malloc(bytes.length + 1);
      m.HEAPU8.set(bytes, buf);
      m.HEAPU8[buf + bytes.length] = 0;
      m.setValue(ptr, buf, "i32");
      return;
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`setPointerValue[${name}]: unhandled type code ${exhaustive}`);
    }
  }
}

// --- The main callback ----------------------------------------------------

let dispatchCount = 0;
const verboseTrace = false;

async function dispatch(name: string, ...args: unknown[]): Promise<unknown> {
  dispatchCount += 1;
  const handler = handlers.get(name);
  if (!handler) {
    if (verboseTrace) {
      // eslint-disable-next-line no-console
      console.debug(`shim: no handler for ${name}, args=`, args);
    }
    return defaultReturn(name);
  }
  try {
    return await handler(...args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`shim handler for ${name} threw:`, err);
    return defaultReturn(name);
  }
}

// What to return when no handler is registered. For most shim functions
// the safest default is 0 / empty string — the engine treats that as a
// no-op or absent value. nhgetch returning 0 would tight-loop, so we
// return a space (' ') which advances most prompts.
function defaultReturn(name: string): unknown {
  switch (name) {
    case "shim_nhgetch": return 32;        // space
    case "shim_nh_poskey": return 32;
    case "shim_yn_function": return 32;
    case "shim_message_menu": return 27;   // ESC
    case "shim_doprev_message": return 0;
    case "shim_get_ext_cmd": return -1;
    case "shim_player_selection_or_tty": return true;
    case "shim_create_nhwindow": return 0;
    case "shim_select_menu": return -1;
    case "shim_get_color_string": return null;
    case "shim_getmsghistory": return null;
    case "shim_ctrl_nhwindow": return 0;
    default: return 0;
  }
}

export interface DispatcherInstall {
  callbackName: string;
  totalDispatched(): number;
}

// Wire the dispatcher into globalThis so the WASM module can find it.
// Call once after the Emscripten module is instantiated, before invoking
// shim_graphics_set_callback.
export function installDispatcher(callbackName = "nethackCallback"): DispatcherInstall {
  type NethackGlobal = {
    helpers: {
      getPointerValue: typeof getPointerValue;
      setPointerValue: typeof setPointerValue;
    };
    shimFunctionRunning?: string | null;
  };

  const g = globalThis as unknown as Record<string, unknown> & {
    nethackGlobal?: NethackGlobal;
  };

  g.nethackGlobal = {
    ...(g.nethackGlobal ?? {}),
    helpers: { getPointerValue, setPointerValue },
    shimFunctionRunning: null,
  };

  g[callbackName] = dispatch;

  return {
    callbackName,
    totalDispatched: () => dispatchCount,
  };
}
