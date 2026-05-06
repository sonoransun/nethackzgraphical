// Canvas/DOM hybrid menu component. Replaces the Phase 1 auto-cancel
// stub so inventory, pickup, throw, etc. become interactive.
//
// Engine flow:
//   1. shim_start_menu(winid, behavior)     — open
//   2. shim_add_menu(...)                    — repeated, accumulates items
//   3. shim_end_menu(winid, prompt)          — sets prompt
//   4. shim_select_menu(winid, how, ret)     — blocks until user resolves;
//      we return the count of selected items and write them into ret.
//
// The "how" parameter (PICK_NONE=0, PICK_ONE=1, PICK_ANY=2) controls
// selection mode. PICK_NONE is informational only.

export interface MenuItem {
  // Engine handle for this entry. The engine passed us a pointer to
  // ANY_P (a tagged union); we keep the raw pointer + the selection
  // accelerator key + display text. Returning the selection means
  // writing back the same identifier so the engine can match it.
  identifier: number;       // raw pointer value (sufficient for engine match)
  identifierSize: number;   // sizeof ANY_P, for the C-side unmarshal
  ch: number;               // accelerator key (a, b, c, ...) or 0
  gch: number;              // group accelerator (rarely used)
  attr: number;             // ATR_* bits
  clr: number;              // color index (−1 = default)
  text: string;
  itemflags: number;        // engine-side flags
  // Frontend state
  selected: boolean;
  count: number;            // for PICK_ANY with quantity selection
}

export const enum PickHow {
  None = 0,
  One = 1,
  Any = 2,
}

export interface MenuResolution {
  selectedItems: MenuItem[];
  /** Single-key 'cancel' returns a -1 count to the engine. */
  cancelled: boolean;
}

export class MenuController {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;

  private items: MenuItem[] = [];
  private how: PickHow = PickHow.None;
  private resolveFn: ((r: MenuResolution) => void) | null = null;
  private filterText = "";

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "menu-overlay";
    this.root.classList.add("menu-overlay", "hidden");
    this.root.innerHTML = `
      <div class="menu-panel" role="dialog" aria-modal="true">
        <div class="menu-prompt"></div>
        <input class="menu-search" type="text" placeholder="filter…" aria-label="filter items" />
        <div class="menu-list" role="listbox" tabindex="0"></div>
        <div class="menu-hints"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.promptEl = this.root.querySelector(".menu-prompt")!;
    this.listEl = this.root.querySelector(".menu-list")!;
    this.searchEl = this.root.querySelector(".menu-search")!;
    const hintsEl = this.root.querySelector(".menu-hints")!;
    hintsEl.textContent = "Letters select • Enter confirms • Esc cancels • / focuses filter";

    this.searchEl.addEventListener("input", () => {
      this.filterText = this.searchEl.value.toLowerCase();
      this.renderList();
    });

    this.root.addEventListener("keydown", (ev) => this.onKey(ev as KeyboardEvent));
    document.addEventListener("keydown", (ev) => {
      if (this.resolveFn) this.onKey(ev);
    });

    this.injectStyles();
  }

  /** Open the menu and return a Promise that resolves when the user
   *  confirms or cancels. */
  open(prompt: string, items: MenuItem[], how: PickHow, _behavior: number): Promise<MenuResolution> {
    this.items = items;
    this.how = how;
    this.filterText = "";
    this.searchEl.value = "";
    this.promptEl.textContent = prompt || (how === PickHow.None ? "" : "Select an item");

    this.root.classList.remove("hidden");
    this.searchEl.focus({ preventScroll: true });
    this.renderList();

    return new Promise((resolve) => { this.resolveFn = resolve; });
  }

  isOpen(): boolean {
    return this.resolveFn !== null;
  }

  private finish(resolution: MenuResolution): void {
    if (!this.resolveFn) return;
    const fn = this.resolveFn;
    this.resolveFn = null;
    this.root.classList.add("hidden");
    fn(resolution);
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.resolveFn) return;
    const key = ev.key;

    if (key === "Escape") {
      ev.preventDefault();
      this.finish({ selectedItems: [], cancelled: true });
      return;
    }
    if (key === "Enter") {
      ev.preventDefault();
      const selected = this.items.filter((i) => i.selected);
      this.finish({ selectedItems: selected, cancelled: false });
      return;
    }
    if (key === "/" && document.activeElement !== this.searchEl) {
      ev.preventDefault();
      this.searchEl.focus();
      return;
    }
    if (document.activeElement === this.searchEl) {
      // Don't intercept while typing in filter.
      return;
    }

    // Single-letter accelerator
    if (key.length === 1) {
      const ch = key.charCodeAt(0);
      const item = this.items.find((i) => i.ch === ch);
      if (item) {
        ev.preventDefault();
        if (this.how === PickHow.One) {
          this.items.forEach((i) => { i.selected = false; });
          item.selected = true;
          this.finish({ selectedItems: [item], cancelled: false });
          return;
        }
        if (this.how === PickHow.Any) {
          item.selected = !item.selected;
          this.renderList();
          return;
        }
      }
    }
  }

  private renderList(): void {
    const filtered = this.filterText
      ? this.items.filter((i) => i.text.toLowerCase().includes(this.filterText))
      : this.items;
    const html = filtered.map((item) => {
      const ch = item.ch ? String.fromCharCode(item.ch) : "·";
      const sel = item.selected ? "✓" : " ";
      const cls = item.selected ? "menu-item selected" : "menu-item";
      const escapedText = escapeHtml(item.text);
      return `<div class="${cls}" data-ch="${item.ch}">
        <span class="menu-acc">${ch}</span>
        <span class="menu-sel">${sel}</span>
        <span class="menu-text">${escapedText}</span>
      </div>`;
    }).join("");
    this.listEl.innerHTML = html || `<div class="menu-empty">no items</div>`;
  }

  private injectStyles(): void {
    if (document.getElementById("menu-overlay-styles")) return;
    const s = document.createElement("style");
    s.id = "menu-overlay-styles";
    s.textContent = `
      .menu-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
      .menu-overlay.hidden { display: none; }
      .menu-panel { background: #14141a; border: 1px solid #44445a; padding: 12px 16px; min-width: 380px; max-width: 720px; max-height: 80vh; display: flex; flex-direction: column; gap: 8px; color: #d8d8d8; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
      .menu-prompt { color: #ffaa33; font-weight: bold; min-height: 1.4em; }
      .menu-search { background: #0a0a10; border: 1px solid #44445a; color: inherit; padding: 4px 8px; font-family: inherit; }
      .menu-list { overflow-y: auto; flex: 1; min-height: 4em; }
      .menu-item { display: flex; gap: 8px; padding: 2px 4px; cursor: pointer; }
      .menu-item:hover { background: #2a2a3a; }
      .menu-item.selected { background: #3a3a52; color: #ffe; }
      .menu-acc { color: #ffaa33; min-width: 1.4em; }
      .menu-sel { min-width: 1.4em; color: #6f6; }
      .menu-text { flex: 1; white-space: pre; }
      .menu-empty { color: #777; padding: 8px; }
      .menu-hints { color: #888; font-size: 0.85em; padding-top: 4px; border-top: 1px solid #2a2a3a; }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
