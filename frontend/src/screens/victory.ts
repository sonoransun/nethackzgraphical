// Victory / Astral Plane sequence. Slow camera ascent on offering,
// color grade shifts to cosmic violet/gold, end-credits-style scroll
// over starfield with the run summary.

import type { Screen } from "./state-machine";

export interface VictoryInfo {
  finalScore: number;
  turns: number;
  className?: string;
  alignment?: string;
  summary?: string;
}

export class VictoryScreen implements Screen {
  private root!: HTMLElement;
  private contentEl!: HTMLElement;

  constructor(private readonly onContinue: () => void) {}

  mount(host: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.id = "victory-screen";
    this.root.classList.add("victory-screen", "screen-overlay");
    this.root.innerHTML = `
      <div class="victory-stars"></div>
      <div class="victory-content"></div>
    `;
    host.appendChild(this.root);
    this.contentEl = this.root.querySelector(".victory-content")!;
    document.addEventListener("keydown", (ev) => {
      if (this.root.style.display === "none") return;
      ev.preventDefault();
      this.onContinue();
    });
    this.injectStyles();
  }

  setInfo(info: VictoryInfo): void {
    this.contentEl.innerHTML = `
      <h1 class="victory-title">★ Ascended ★</h1>
      <div class="victory-class">${escapeHtml(info.className ?? "")}${info.alignment ? ` of ${escapeHtml(info.alignment)}` : ""}</div>
      <div class="victory-stats">
        <div><span>Final Score</span><strong>${info.finalScore.toLocaleString()}</strong></div>
        <div><span>Turns</span><strong>${info.turns.toLocaleString()}</strong></div>
      </div>
      ${info.summary ? `<div class="victory-summary">${escapeHtml(info.summary)}</div>` : ""}
      <div class="victory-prompt">Press any key to return to the title</div>
    `;
  }

  show(): void { this.root.style.display = "flex"; }
  hide(): void { this.root.style.display = "none"; }

  private injectStyles(): void {
    if (document.getElementById("victory-styles")) return;
    const s = document.createElement("style");
    s.id = "victory-styles";
    s.textContent = `
      .victory-screen { display: none; align-items: center; justify-content: center;
        background: linear-gradient(0deg, #1a0a2a 0%, #050508 60%, #00000a 100%);
        font-family: ui-monospace, monospace; color: #fff; overflow: hidden; }
      .victory-stars { position: absolute; inset: 0;
        background:
          radial-gradient(1px 1px at 10% 20%, #fff, transparent),
          radial-gradient(1px 1px at 30% 50%, #fff, transparent),
          radial-gradient(1px 1px at 50% 80%, #ffe, transparent),
          radial-gradient(2px 2px at 70% 30%, rgba(255,255,200,0.7), transparent),
          radial-gradient(1px 1px at 85% 65%, rgba(220,200,255,0.7), transparent),
          radial-gradient(2px 2px at 25% 70%, rgba(255,180,255,0.5), transparent);
        animation: victory-twinkle 5s ease-in-out infinite; }
      @keyframes victory-twinkle {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.6; }
      }
      .victory-content { position: relative; z-index: 2; text-align: center; max-width: 600px;
        animation: victory-rise 6s ease-out; }
      @keyframes victory-rise {
        from { opacity: 0; transform: translateY(80px); filter: blur(8px); }
        to   { opacity: 1; transform: translateY(0); filter: blur(0); }
      }
      .victory-title { font-size: 64px; letter-spacing: 0.1em;
        background: linear-gradient(120deg, #ffd86b, #c89cff, #ffd86b);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: victory-shimmer 5s ease-in-out infinite; }
      @keyframes victory-shimmer {
        0%, 100% { filter: brightness(1); }
        50%      { filter: brightness(1.4); }
      }
      .victory-class { font-size: 18px; color: #ffe; opacity: 0.85; margin-bottom: 36px; }
      .victory-stats { display: flex; justify-content: center; gap: 48px; margin: 24px 0; }
      .victory-stats div { display: flex; flex-direction: column; gap: 4px; }
      .victory-stats span { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
      .victory-stats strong { color: #ffd86b; font-size: 28px; font-weight: normal; }
      .victory-summary { color: #c8a; font-style: italic; margin-top: 24px; line-height: 1.6; }
      .victory-prompt { margin-top: 48px; color: #888; font-size: 12px; }
      @media (prefers-reduced-motion: reduce) {
        .victory-stars, .victory-content, .victory-title { animation: none; }
      }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
