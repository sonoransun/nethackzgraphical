// Screen state machine. The frontend has a small explicit set of
// screens; this manages which one is visible. Game state lives in the
// engine; this is purely presentation.
//
// States:
//   • Boot       — loading the WASM module
//   • Title      — main menu
//   • ClassSelect — character creation (rendered alongside engine yn)
//   • Game       — the actual map; engine is the boss here
//   • Pause      — menu overlay during play (settings, inventory, save, etc.)
//   • Death      — RIP screen
//   • Victory    — Astral Plane sequence
//   • Settings   — accessible from Title or Pause
//   • Bestiary   — accessible from Title or Pause
//
// Transitions are explicit method calls; the engine signals Death and
// Victory via shim_exit_nhwindows. The frontend handles UI-driven
// transitions (Title → Game, Pause → Settings, etc.).

export type ScreenName =
  | "boot"
  | "title"
  | "classselect"
  | "game"
  | "pause"
  | "death"
  | "victory"
  | "settings"
  | "bestiary";

export interface Screen {
  show(): void;
  hide(): void;
  /** Called once on first registration; the screen typically inserts
   *  its DOM node at this point. */
  mount?(host: HTMLElement): void;
}

export class ScreenManager {
  private current: ScreenName = "boot";
  private screens = new Map<ScreenName, Screen>();
  private host: HTMLElement;
  private listeners: Array<(s: ScreenName) => void> = [];

  constructor(host: HTMLElement) {
    this.host = host;
  }

  register(name: ScreenName, screen: Screen): void {
    if (this.screens.has(name)) throw new Error(`screen ${name} already registered`);
    screen.mount?.(this.host);
    screen.hide();
    this.screens.set(name, screen);
  }

  goto(name: ScreenName): void {
    if (this.current === name) return;
    const cur = this.screens.get(this.current);
    cur?.hide();
    const next = this.screens.get(name);
    if (!next) {
      console.warn(`screen ${name} not registered`);
      return;
    }
    next.show();
    this.current = name;
    for (const fn of this.listeners) fn(name);
  }

  currentScreen(): ScreenName { return this.current; }

  onChange(fn: (s: ScreenName) => void): void {
    this.listeners.push(fn);
  }
}
