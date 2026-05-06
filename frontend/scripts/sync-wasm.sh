#!/usr/bin/env bash
# Copy WASM build artifacts from ../targets/wasm/ into public/wasm/ so the
# frontend can load them at runtime.
#
# Run this after `make wasm`. It is intentionally a thin shell script
# (no node deps) so it works in CI before npm install.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$FRONTEND_DIR/.." && pwd)"

SRC_DIR="$REPO_ROOT/targets/wasm"
DST_DIR="$FRONTEND_DIR/public/wasm"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "sync-wasm: $SRC_DIR not found." >&2
  echo "Build the WASM artifact first:" >&2
  echo "  cd sys/unix && sh setup.sh hints/wasm.500" >&2
  echo "  cd ../.. && make fetch-Lua && make wasm" >&2
  exit 1
fi

mkdir -p "$DST_DIR"

# Copy the three artifacts emcc emits with our flags. nethack.data is
# present when --embed-file is large enough to spill out of the .js.
for f in nethack.js nethack.wasm nethack.data; do
  if [[ -f "$SRC_DIR/$f" ]]; then
    cp -f "$SRC_DIR/$f" "$DST_DIR/$f"
    echo "synced $f"
  fi
done

if [[ ! -f "$DST_DIR/nethack.js" ]]; then
  echo "sync-wasm: no nethack.js produced — build may have failed silently" >&2
  exit 1
fi
