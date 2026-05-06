// The message and status windows — for Phase 1, just two DOM elements
// that we append text into. Phase 3 replaces these with proper styled
// HUD components.

const MAX_MESSAGE_LINES = 50;

export class TextWindow {
  private readonly el: HTMLElement;
  private buffer: string[] = [];

  constructor(elementId: string) {
    const el = document.getElementById(elementId);
    if (!el) throw new Error(`TextWindow: #${elementId} not found`);
    this.el = el;
  }

  append(line: string): void {
    if (line.length === 0) return;
    this.buffer.push(line);
    if (this.buffer.length > MAX_MESSAGE_LINES) {
      this.buffer.splice(0, this.buffer.length - MAX_MESSAGE_LINES);
    }
    this.render();
  }

  replace(line: string): void {
    this.buffer = [line];
    this.render();
  }

  clear(): void {
    this.buffer = [];
    this.render();
  }

  private render(): void {
    // Show the last 3 lines for the message window; status windows
    // typically display 1–2 lines of structured stats. We let CSS
    // overflow handle long content.
    this.el.textContent = this.buffer.slice(-3).join("\n");
  }
}
