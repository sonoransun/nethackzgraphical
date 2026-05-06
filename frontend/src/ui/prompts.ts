// Modal prompts: yn (yes/no), getlin (free-form text), display_file
// (long text block). Replaces the Phase 1 ad-hoc handling.
//
// Each returns a Promise that resolves when the user answers. The
// engine handler awaits the resolution and writes the answer through
// the shim's ret_ptr.

export class PromptController {
  private readonly root: HTMLElement;
  private readonly contentEl: HTMLElement;
  private resolveFn: ((value: unknown) => void) | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "prompt-overlay";
    this.root.classList.add("prompt-overlay", "hidden");
    this.root.innerHTML = `<div class="prompt-panel" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(this.root);
    this.contentEl = this.root.querySelector(".prompt-panel")!;
    this.injectStyles();
  }

  isOpen(): boolean { return this.resolveFn !== null; }

  /** Yes/no/cancel-style; engine passes a `resp` string of valid keys
   *  and a default. Returns the chosen char code. */
  yn(query: string, validResponses: string, defaultCh: number): Promise<number> {
    return new Promise<number>((resolve) => {
      this.resolveFn = (v) => resolve(v as number);
      const valid = validResponses ? validResponses.split("") : [];
      const defaultStr = defaultCh ? String.fromCharCode(defaultCh) : "";
      this.contentEl.innerHTML = `
        <div class="prompt-query">${escapeHtml(query)}</div>
        ${valid.length ? `<div class="prompt-hints">[${escapeHtml(validResponses)}]${defaultStr ? ` (default ${escapeHtml(defaultStr)})` : ""}</div>` : ""}
      `;
      this.show();
      const handler = (ev: KeyboardEvent) => {
        if (!this.resolveFn) return;
        let ch: number | null = null;
        if (ev.key === "Escape") ch = 27;
        else if (ev.key === "Enter") ch = defaultCh || 13;
        else if (ev.key === " ") ch = defaultCh || 32;
        else if (ev.key.length === 1) {
          const c = ev.key.charCodeAt(0);
          // Accept any printable char; engine will validate.
          ch = c;
        }
        if (ch !== null) {
          ev.preventDefault();
          document.removeEventListener("keydown", handler);
          this.hide();
          const fn = this.resolveFn;
          this.resolveFn = null;
          fn?.(ch);
        }
      };
      document.addEventListener("keydown", handler);
    });
  }

  /** Free-form line input; engine wants the text written into a buffer. */
  getlin(query: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.resolveFn = (v) => resolve(v as string);
      this.contentEl.innerHTML = `
        <div class="prompt-query">${escapeHtml(query)}</div>
        <input class="prompt-input" type="text" autocomplete="off" />
      `;
      this.show();
      const input = this.contentEl.querySelector(".prompt-input") as HTMLInputElement;
      input.focus({ preventScroll: true });
      const handler = (ev: KeyboardEvent) => {
        if (!this.resolveFn) return;
        if (ev.key === "Enter") {
          ev.preventDefault();
          const value = input.value;
          input.removeEventListener("keydown", handler);
          this.hide();
          const fn = this.resolveFn;
          this.resolveFn = null;
          fn?.(value);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          input.removeEventListener("keydown", handler);
          this.hide();
          const fn = this.resolveFn;
          this.resolveFn = null;
          fn?.("\x1b");  // engine treats ESC as cancel
        }
      };
      input.addEventListener("keydown", handler);
    });
  }

  /** Long-text display (help, RIP transient, etc.). Resolves on any key. */
  displayText(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveFn = () => resolve();
      this.contentEl.innerHTML = `<pre class="prompt-text">${escapeHtml(text)}</pre>
        <div class="prompt-hints">Press any key to continue</div>`;
      this.show();
      const handler = (ev: KeyboardEvent) => {
        ev.preventDefault();
        document.removeEventListener("keydown", handler);
        this.hide();
        const fn = this.resolveFn;
        this.resolveFn = null;
        fn?.(undefined);
      };
      document.addEventListener("keydown", handler);
    });
  }

  private show(): void { this.root.classList.remove("hidden"); }
  private hide(): void { this.root.classList.add("hidden"); }

  private injectStyles(): void {
    if (document.getElementById("prompt-styles")) return;
    const s = document.createElement("style");
    s.id = "prompt-styles";
    s.textContent = `
      .prompt-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 90; }
      .prompt-overlay.hidden { display: none; }
      .prompt-panel { background: #14141a; border: 1px solid #44445a; padding: 14px 18px; min-width: 380px; max-width: 720px; color: #d8d8d8; font-family: ui-monospace, monospace; display: flex; flex-direction: column; gap: 8px; }
      .prompt-query { color: #ffaa33; font-weight: bold; }
      .prompt-hints { color: #888; font-size: 0.85em; }
      .prompt-input { background: #0a0a10; border: 1px solid #44445a; color: inherit; padding: 4px 8px; font-family: inherit; }
      .prompt-text { color: #ddd; max-height: 60vh; overflow-y: auto; white-space: pre-wrap; margin: 0; }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
