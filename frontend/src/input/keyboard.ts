// Keyboard + mouse input plumbing.
//
// The engine calls shim_nhgetch / shim_nh_poskey synchronously and blocks
// (via Asyncify) until our handler's Promise resolves. We queue inputs
// asynchronously and pop one per blocking call.
//
// Mouse events synthesise nh_poskey output: they fill x/y/mod and return
// a CLICK_1 / CLICK_2 sentinel. Keyboard events return the codepoint
// directly.

const CLICK_1 = 1;
const CLICK_2 = 2;

export interface KeyEvent {
  kind: "key";
  ch: number;          // codepoint, or special-key sentinel below
}

export interface ClickEvent {
  kind: "click";
  cellX: number;
  cellY: number;
  mod: 1 | 2;          // CLICK_1 left, CLICK_2 right
}

export type InputEvent = KeyEvent | ClickEvent;

// Special-key sentinels for keys that don't have an obvious ASCII
// translation. NetHack 5.0 supports a few "high" key codes via the
// SPECIAL_CMD enum but the bulk of the input vocabulary is plain ASCII.
// For arrow keys we emit the vi-key equivalents because that's what
// every NetHack player uses anyway.
const VI_LEFT = "h".charCodeAt(0);
const VI_DOWN = "j".charCodeAt(0);
const VI_UP = "k".charCodeAt(0);
const VI_RIGHT = "l".charCodeAt(0);
const VI_NW = "y".charCodeAt(0);
const VI_NE = "u".charCodeAt(0);
const VI_SW = "b".charCodeAt(0);
const VI_SE = "n".charCodeAt(0);

export class InputQueue {
  private queue: InputEvent[] = [];
  private waiters: ((event: InputEvent) => void)[] = [];

  push(event: InputEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
    } else {
      this.queue.push(event);
    }
  }

  next(): Promise<InputEvent> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Discard all pending input. Used when the engine asks for fresh input
   *  after a long-running animation, to avoid replaying stale keystrokes. */
  drain(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }
}

/** Map a DOM KeyboardEvent to a single byte the engine will accept. Returns
 *  null for keys we don't translate (modifier-only events, etc.). */
export function keyEventToCh(ev: KeyboardEvent): number | null {
  // Modifier-only events: ignore.
  if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
    return null;
  }

  // Ctrl+letter → control codes 1..26
  if (ev.ctrlKey && ev.key.length === 1) {
    const lc = ev.key.toLowerCase();
    const c = lc.charCodeAt(0);
    if (c >= 0x61 && c <= 0x7a) {
      return c - 0x60;
    }
  }

  switch (ev.key) {
    case "Enter":     return 13;
    case "Escape":    return 27;
    case "Backspace": return 8;
    case "Tab":       return 9;
    case " ":         return 32;
    case "ArrowLeft":  return ev.shiftKey ? toUpper(VI_LEFT)  : VI_LEFT;
    case "ArrowDown":  return ev.shiftKey ? toUpper(VI_DOWN)  : VI_DOWN;
    case "ArrowUp":    return ev.shiftKey ? toUpper(VI_UP)    : VI_UP;
    case "ArrowRight": return ev.shiftKey ? toUpper(VI_RIGHT) : VI_RIGHT;
    case "Home":       return ev.shiftKey ? toUpper(VI_NW) : VI_NW;
    case "PageUp":     return ev.shiftKey ? toUpper(VI_NE) : VI_NE;
    case "End":        return ev.shiftKey ? toUpper(VI_SW) : VI_SW;
    case "PageDown":   return ev.shiftKey ? toUpper(VI_SE) : VI_SE;
    case "Delete":     return 127;
    default:
      break;
  }

  // Single character keys
  if (ev.key.length === 1) {
    return ev.key.charCodeAt(0);
  }

  return null;
}

function toUpper(ch: number): number {
  if (ch >= 0x61 && ch <= 0x7a) return ch - 0x20;
  return ch;
}

/** Wire DOM listeners. Returns a teardown function. */
export function bindGlobalListeners(
  queue: InputQueue,
  mapCellResolver: (clientX: number, clientY: number) => { x: number; y: number } | null,
): () => void {
  const onKey = (ev: KeyboardEvent) => {
    // Don't intercept browser shortcuts the user might want.
    if (ev.key === "F5" || ev.key === "F11" || ev.key === "F12") return;
    if (ev.metaKey || (ev.ctrlKey && (ev.key === "c" || ev.key === "v"))) return;

    const ch = keyEventToCh(ev);
    if (ch === null) return;
    ev.preventDefault();
    queue.push({ kind: "key", ch });
  };

  const onClick = (ev: MouseEvent) => {
    const cell = mapCellResolver(ev.clientX, ev.clientY);
    if (!cell) return;
    ev.preventDefault();
    const mod: 1 | 2 = ev.button === 2 ? CLICK_2 : CLICK_1;
    queue.push({ kind: "click", cellX: cell.x, cellY: cell.y, mod });
  };

  const onContextMenu = (ev: MouseEvent) => {
    // Right-click is the look/examine binding; we want it on the canvas
    // without triggering the browser context menu.
    const cell = mapCellResolver(ev.clientX, ev.clientY);
    if (cell) ev.preventDefault();
  };

  window.addEventListener("keydown", onKey);
  window.addEventListener("mousedown", onClick);
  window.addEventListener("contextmenu", onContextMenu);

  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("mousedown", onClick);
    window.removeEventListener("contextmenu", onContextMenu);
  };
}

export { CLICK_1, CLICK_2 };
