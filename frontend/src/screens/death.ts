// Death screen — elevation of the engine's `genl_outrip`. Receives
// the cause-of-death (passed via shim_exit_nhwindows) and final stats,
// renders an illustrated tombstone (placeholder ASCII art for now;
// commissioned 5A art replaces it without code changes).

import type { Screen } from "./state-machine";

export interface DeathInfo {
  cause: string;
  finalStats?: string[];
  lastMessages?: string[];
}

export class DeathScreen implements Screen {
  private root!: HTMLElement;
  private contentEl!: HTMLElement;
  private currentInfo: DeathInfo | null = null;

  constructor(private readonly onContinue: () => void) {}

  mount(host: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.id = "death-screen";
    this.root.classList.add("death-screen", "screen-overlay");
    this.root.innerHTML = `
      <div class="death-content">
        <pre class="death-tombstone"></pre>
        <div class="death-stats"></div>
        <div class="death-messages"></div>
        <div class="death-prompt">Press any key to continue…</div>
      </div>
    `;
    host.appendChild(this.root);
    this.contentEl = this.root.querySelector(".death-content")!;
    document.addEventListener("keydown", (ev) => {
      if (this.root.style.display === "none") return;
      ev.preventDefault();
      this.onContinue();
    });
    this.injectStyles();
  }

  setInfo(info: DeathInfo): void {
    this.currentInfo = info;
    const tombstone = this.contentEl.querySelector<HTMLElement>(".death-tombstone")!;
    tombstone.textContent = renderTombstone(info.cause);

    const statsEl = this.contentEl.querySelector<HTMLElement>(".death-stats")!;
    statsEl.innerHTML = (info.finalStats ?? []).map(escapeHtml).join("<br>");

    const msgEl = this.contentEl.querySelector<HTMLElement>(".death-messages")!;
    msgEl.innerHTML = (info.lastMessages ?? []).slice(-10).map(escapeHtml).map((m) => `<div>${m}</div>`).join("");
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  getCurrentInfo(): DeathInfo | null { return this.currentInfo; }

  private injectStyles(): void {
    if (document.getElementById("death-styles")) return;
    const s = document.createElement("style");
    s.id = "death-styles";
    s.textContent = `
      .death-screen { display: none; align-items: center; justify-content: center;
        background: radial-gradient(ellipse at center, #1a0a0a 0%, #000 80%);
        font-family: ui-monospace, monospace; color: #d8d8d8;
        animation: death-slow-zoom 6s ease-out forwards;
      }
      @keyframes death-slow-zoom {
        from { transform: scale(1.1); filter: saturate(0.4); }
        to   { transform: scale(1.0); filter: saturate(1.0); }
      }
      .death-content { text-align: center; max-width: 720px; padding: 40px;
        animation: death-fadein 1.5s ease-out; }
      @keyframes death-fadein {
        from { opacity: 0; transform: translateY(40px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .death-tombstone { white-space: pre; line-height: 1.0; color: #aaa; font-size: 16px; }
      .death-stats { margin: 24px auto; max-width: 480px; color: #ccc; line-height: 1.6; }
      .death-messages { margin: 16px auto; max-width: 600px; color: #888; font-size: 13px; line-height: 1.7; }
      .death-prompt { margin-top: 32px; color: #666; font-size: 12px; animation: death-blink 2s infinite; }
      @keyframes death-blink {
        0%, 50%, 100% { opacity: 1; }
        25%, 75%      { opacity: 0.3; }
      }
      @media (prefers-reduced-motion: reduce) {
        .death-screen { animation: none; transform: scale(1); }
        .death-content { animation: none; }
        .death-prompt { animation: none; }
      }
    `;
    document.head.appendChild(s);
  }
}

function renderTombstone(cause: string): string {
  // Placeholder ASCII tombstone. Phase 5A replaces with pixel-art.
  const lines: string[] = [];
  const words = cause.replace(/\.+$/g, "").split(/\s+/);
  let line = "";
  for (const w of words) {
    if ((line + w).length > 18) { lines.push(line.trim()); line = ""; }
    line += w + " ";
  }
  if (line.trim()) lines.push(line.trim());
  while (lines.length < 4) lines.push("");
  const pad = (s: string) => `      |  ${s.padEnd(18, " ")}  |`;

  return [
    "         _______",
    "        /       \\",
    "       /  R I P  \\",
    "      |           |",
    "      |  killed   |",
    "      |    by     |",
    pad(lines[0] ?? ""),
    pad(lines[1] ?? ""),
    pad(lines[2] ?? ""),
    pad(lines[3] ?? ""),
    "      |           |",
    "  ___ |    *  *   | ___",
    " *.\\ \\\\\\\\\\///\\\\\\\\///",
    "",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
