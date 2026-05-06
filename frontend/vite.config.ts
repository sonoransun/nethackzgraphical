import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// The Emscripten output is built outside this project at
//   ../targets/wasm/nethack.{js,wasm,data}
// We don't import nethack.js at build time because Vite's static analysis
// can't see through Emscripten's MODULARIZE wrapper. Instead we copy the
// artifacts into public/wasm/ via the postinstall step (see scripts/sync-wasm.sh)
// and load them at runtime via a dynamic import in src/wasm/loader.ts.

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Emscripten needs cross-origin isolation for SharedArrayBuffer when
    // we add Web Workers later (Phase 2+). Set the headers up-front so
    // the dev server matches production.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    fs: {
      // Allow Vite to serve files from the engine's targets/wasm directory
      // during dev so we don't have to copy on every rebuild. Production
      // builds still go through public/wasm/.
      allow: [".."],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep nethack.wasm out of the JS bundle — it's loaded as an
        // asset by the Emscripten glue code.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".wasm")) {
            return "wasm/[name][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  optimizeDeps: {
    // The Emscripten glue does its own dynamic loading; Vite's pre-bundler
    // would just confuse things.
    exclude: ["nethack.js"],
  },
});
