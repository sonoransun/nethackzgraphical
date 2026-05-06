// Title screen. Parallax-scrolling background placeholder (real art
// lands in Phase 5A); animated logo with subtle glow; main menu.

import type { Screen } from "./state-machine";

export interface TitleActions {
  onNewGame: () => void;
  onSettings: () => void;
  onBestiary: () => void;
  onQuit: () => void;
}

export class TitleScreen implements Screen {
  private root!: HTMLElement;
  private layers!: HTMLElement[];

  constructor(private readonly actions: TitleActions) {}

  mount(host: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.id = "title-screen";
    this.root.classList.add("title-screen", "screen-overlay");
    this.root.innerHTML = `
      <div class="title-bg-layer title-bg-far"></div>
      <div class="title-bg-layer title-bg-mid"></div>
      <div class="title-bg-layer title-bg-near"></div>
      <div class="title-content">
        <h1 class="title-logo">
          <span class="title-mod">Mod</span><span class="title-my">My</span><span class="title-nh">NetHack</span>
        </h1>
        <div class="title-tagline">a modern 2D envisioning of the dungeon</div>
        <ul class="title-menu" role="menu">
          <li role="menuitem" data-action="new" tabindex="0">New Game</li>
          <li role="menuitem" data-action="bestiary" tabindex="0">Bestiary</li>
          <li role="menuitem" data-action="settings" tabindex="0">Settings</li>
          <li role="menuitem" data-action="quit" tabindex="0">Quit</li>
        </ul>
        <div class="title-version">NetHack 5.0.0 · ModMyNetHack frontend</div>
      </div>
    `;
    host.appendChild(this.root);
    this.layers = Array.from(this.root.querySelectorAll(".title-bg-layer"));

    this.root.querySelectorAll<HTMLElement>(".title-menu li").forEach((li) => {
      li.addEventListener("click", () => this.dispatch(li.dataset.action ?? ""));
      li.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          this.dispatch(li.dataset.action ?? "");
        }
      });
    });

    document.addEventListener("mousemove", (ev) => {
      if (!this.isVisible()) return;
      const dx = (ev.clientX / window.innerWidth - 0.5) * 2;
      const dy = (ev.clientY / window.innerHeight - 0.5) * 2;
      this.layers[0]!.style.transform = `translate(${dx * 4}px, ${dy * 3}px)`;
      this.layers[1]!.style.transform = `translate(${dx * 10}px, ${dy * 6}px)`;
      this.layers[2]!.style.transform = `translate(${dx * 18}px, ${dy * 10}px)`;
    });

    this.injectStyles();
  }

  show(): void {
    this.root.style.display = "flex";
    const first = this.root.querySelector<HTMLElement>(".title-menu li");
    first?.focus();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private isVisible(): boolean { return this.root.style.display !== "none"; }

  private dispatch(action: string): void {
    switch (action) {
      case "new":      this.actions.onNewGame(); break;
      case "bestiary": this.actions.onBestiary(); break;
      case "settings": this.actions.onSettings(); break;
      case "quit":     this.actions.onQuit(); break;
    }
  }

  private injectStyles(): void {
    if (document.getElementById("title-styles")) return;
    const s = document.createElement("style");
    s.id = "title-styles";
    s.textContent = `
      .screen-overlay { position: fixed; inset: 0; z-index: 50; }
      .title-screen { display: none; align-items: center; justify-content: center;
        background: radial-gradient(ellipse at center, #1a1a26 0%, #050508 70%);
        overflow: hidden; font-family: ui-monospace, monospace; color: #d8d8d8; }
      .title-bg-layer { position: absolute; inset: -10%; opacity: 0.7;
        background-repeat: repeat; background-size: cover; pointer-events: none; transition: transform 200ms ease-out; }
      .title-bg-far {
        background-image:
          radial-gradient(2px 2px at 20% 30%, rgba(180,180,255,0.4), transparent),
          radial-gradient(1px 1px at 70% 60%, rgba(220,180,120,0.4), transparent),
          radial-gradient(2px 2px at 40% 80%, rgba(180,180,255,0.3), transparent);
      }
      .title-bg-mid {
        background-image: linear-gradient(0deg, rgba(40, 30, 60, 0.5) 0%, rgba(20, 20, 30, 0) 60%);
      }
      .title-bg-near {
        background-image: linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.7) 100%);
      }
      .title-content { position: relative; text-align: center; z-index: 2;
        animation: title-fadein 800ms ease-out; }
      @keyframes title-fadein {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .title-logo { font-size: 56px; margin: 0; letter-spacing: 0.05em;
        text-shadow: 0 0 20px rgba(255, 170, 51, 0.5), 0 0 40px rgba(255, 170, 51, 0.25);
        animation: title-glow 3.6s ease-in-out infinite; }
      @keyframes title-glow {
        0%, 100% { text-shadow: 0 0 18px rgba(255, 170, 51, 0.4), 0 0 32px rgba(255, 170, 51, 0.18); }
        50%      { text-shadow: 0 0 28px rgba(255, 170, 51, 0.6), 0 0 48px rgba(255, 170, 51, 0.32); }
      }
      .title-mod { color: #c89cff; }
      .title-my { color: #ffaa33; }
      .title-nh  { color: #ffe; }
      .title-tagline { font-size: 14px; color: #a0a0a0; margin: 8px 0 36px; font-style: italic; }
      .title-menu { list-style: none; padding: 0; margin: 0; }
      .title-menu li { padding: 10px 24px; cursor: pointer; font-size: 18px;
        border-radius: 4px; transition: background 120ms; outline: none; }
      .title-menu li:hover, .title-menu li:focus { background: rgba(255,170,51,0.18); color: #ffe; }
      .title-version { margin-top: 36px; font-size: 11px; color: #666; }
      @media (prefers-reduced-motion: reduce) {
        .title-content { animation: none; }
        .title-logo { animation: none; }
        .title-bg-layer { transition: none; }
      }
    `;
    document.head.appendChild(s);
  }
}
