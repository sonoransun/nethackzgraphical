// Loads the Emscripten-built nethack.js module.
//
// The build (cross-pre2.500:281) produces an ES module factory via
// MODULARIZE + EXPORT_ES6. Calling it returns a Promise that resolves
// to the instantiated Module with .HEAP*, .ccall, .cwrap, etc.
//
// We expect the WASM artifacts to live at /wasm/nethack.{js,wasm,data}
// in production. In dev, vite's `server.fs.allow: [".."]` lets us serve
// them from ../targets/wasm/ directly, but we still copy them under
// public/wasm/ via scripts/sync-wasm.sh so the import path is stable.

import type { EmscriptenModule } from "../shim/dispatcher";

interface NethackModuleFactory {
  (config?: Partial<EmscriptenModuleConfig>): Promise<EmscriptenModule & {
    _shim_graphics_set_callback?: (cbNamePtr: number) => void;
    _main?: (argc: number, argv: number) => number;
    callMain?: (args: string[]) => number;
  }>;
}

export interface EmscriptenModuleConfig {
  print: (s: string) => void;
  printErr: (s: string) => void;
  locateFile: (path: string, prefix: string) => string;
  noInitialRun: boolean;
  noExitRuntime: boolean;
  arguments: string[];
  preRun: Array<() => void>;
  postRun: Array<() => void>;
  onAbort: (reason: unknown) => void;
}

export async function loadNethack(
  scriptUrl: string,
  config: Partial<EmscriptenModuleConfig> = {},
) {
  // The Emscripten output is published as an ES module whose default export
  // is the factory function. We import it dynamically because Vite's static
  // analysis can't see through MODULARIZE.
  const mod = (await import(/* @vite-ignore */ scriptUrl)) as { default: NethackModuleFactory };
  const factory = mod.default;
  if (typeof factory !== "function") {
    throw new Error(`loadNethack: ${scriptUrl} did not export a factory function`);
  }
  return factory(config);
}
