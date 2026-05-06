// Screen-reader live region. The engine emits messages via shim_putstr
// and shim_raw_print; we mirror them into an ARIA live region so
// AT users hear them as they happen. Polite (not assertive) so we
// don't interrupt other speech.

export class ScreenReaderAnnouncer {
  private readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "log");
    this.el.setAttribute("aria-live", "polite");
    this.el.setAttribute("aria-atomic", "false");
    this.el.style.cssText = `
      position: absolute; left: -10000px; top: auto;
      width: 1px; height: 1px; overflow: hidden;
    `;
    document.body.appendChild(this.el);
  }

  /** Announce a message. Most assistive tech debounces rapid-fire
   *  updates; we don't need to. */
  announce(text: string): void {
    if (!text) return;
    // Some screen readers don't read `textContent` updates if the same
    // text appears twice in a row. Append a thin space variant so each
    // call is a unique change.
    const variant = (this.el.children.length & 1) ? " " : "";
    const div = document.createElement("div");
    div.textContent = text + variant;
    this.el.appendChild(div);
    // Keep the buffer small — old messages stay in the DOM for a bit
    // so AT can re-read on focus, but clean up after 30s.
    setTimeout(() => { div.remove(); }, 30_000);
  }
}
