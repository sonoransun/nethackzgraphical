// Settings screen. All toggles persist to localStorage. Other parts
// of the app subscribe to changes via the Settings.on('change', ...)
// pattern below.

import type { Screen } from "./state-machine";

export interface AppSettings {
  // Visual
  tilePx: 32 | 48 | 64;
  crtEnabled: boolean;
  crtScanlineIntensity: number;
  vignetteIntensity: number;
  particleDensity: "off" | "low" | "medium" | "high";
  hallucinationsEnabled: boolean;
  animationSpeed: 0.5 | 1 | 2 | 4;
  fontSize: "small" | "medium" | "large" | "xl";
  // Audio
  audioMaster: number;       // 0..1
  audioAmbient: number;
  audioMuted: boolean;
  // Accessibility
  reducedMotion: boolean;    // overrides prefers-reduced-motion
  colorBlind: "none" | "deuteranopia" | "protanopia" | "tritanopia";
  highContrast: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  tilePx: 48,
  crtEnabled: false,
  crtScanlineIntensity: 0.3,
  vignetteIntensity: 0.4,
  particleDensity: "medium",
  hallucinationsEnabled: true,
  animationSpeed: 1,
  fontSize: "medium",
  audioMaster: 0.7,
  audioAmbient: 0.6,
  audioMuted: false,
  reducedMotion: false,
  colorBlind: "none",
  highContrast: false,
};

const STORAGE_KEY = "modmynethack:settings:v1";

export class Settings {
  private settings: AppSettings;
  private listeners: Array<(s: AppSettings) => void> = [];

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...this.load() };
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  getAll(): AppSettings { return { ...this.settings }; }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;
    this.save();
    for (const fn of this.listeners) fn(this.settings);
  }

  on(fn: (s: AppSettings) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
    for (const fn of this.listeners) fn(this.settings);
  }

  private load(): Partial<AppSettings> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Partial<AppSettings>;
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // localStorage may be disabled (private browsing); fail silently.
    }
  }
}

export class SettingsScreen implements Screen {
  private root!: HTMLElement;
  private contentEl!: HTMLElement;

  constructor(
    private readonly settings: Settings,
    private readonly onClose: () => void,
  ) {}

  mount(host: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.id = "settings-screen";
    this.root.classList.add("settings-screen", "screen-overlay");
    this.root.innerHTML = `
      <div class="settings-panel">
        <div class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close" aria-label="close">×</button>
        </div>
        <div class="settings-body"></div>
      </div>
    `;
    host.appendChild(this.root);
    this.contentEl = this.root.querySelector(".settings-body")!;
    this.root.querySelector(".settings-close")!.addEventListener("click", () => this.onClose());
    this.root.addEventListener("keydown", (ev) => {
      const ke = ev as KeyboardEvent;
      if (ke.key === "Escape") this.onClose();
    });
    this.render();
    this.injectStyles();
  }

  show(): void {
    this.render();
    this.root.style.display = "flex";
    this.root.querySelector<HTMLElement>("[data-firstfocus]")?.focus();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private render(): void {
    const s = this.settings.getAll();
    this.contentEl.innerHTML = `
      <section><h3>Display</h3>
        ${selectField("Tile size", "tilePx", s.tilePx, ["32", "48", "64"])}
        ${toggleField("CRT shader", "crtEnabled", s.crtEnabled, true)}
        ${rangeField("CRT scanlines", "crtScanlineIntensity", s.crtScanlineIntensity, 0, 1, 0.05)}
        ${rangeField("Vignette", "vignetteIntensity", s.vignetteIntensity, 0, 1, 0.05)}
        ${selectField("Particles", "particleDensity", s.particleDensity, ["off", "low", "medium", "high"])}
        ${toggleField("Hallucination effect", "hallucinationsEnabled", s.hallucinationsEnabled)}
        ${selectField("Animation speed", "animationSpeed", String(s.animationSpeed), ["0.5", "1", "2", "4"])}
        ${selectField("Font size", "fontSize", s.fontSize, ["small", "medium", "large", "xl"])}
      </section>
      <section><h3>Audio</h3>
        ${rangeField("Master volume", "audioMaster", s.audioMaster, 0, 1, 0.05)}
        ${rangeField("Ambient volume", "audioAmbient", s.audioAmbient, 0, 1, 0.05)}
        ${toggleField("Mute all", "audioMuted", s.audioMuted)}
      </section>
      <section><h3>Accessibility</h3>
        ${toggleField("Reduced motion", "reducedMotion", s.reducedMotion)}
        ${selectField("Color-blind preset", "colorBlind", s.colorBlind, ["none", "deuteranopia", "protanopia", "tritanopia"])}
        ${toggleField("High contrast", "highContrast", s.highContrast)}
      </section>
      <section><h3>Reset</h3>
        <button class="settings-reset">Reset all settings to defaults</button>
      </section>
    `;
    this.contentEl.querySelectorAll<HTMLInputElement>("[data-key]").forEach((el) => {
      const key = el.dataset.key as keyof AppSettings;
      el.addEventListener("change", () => {
        let value: unknown = el.value;
        if (el.type === "checkbox") value = el.checked;
        else if (el.dataset.kind === "number") value = parseFloat(el.value);
        else if (el.dataset.kind === "int") value = parseInt(el.value, 10);
        this.settings.set(key, value as never);
      });
      el.addEventListener("input", () => {
        if (el.type === "range") {
          let value: number = parseFloat(el.value);
          this.settings.set(key, value as never);
        }
      });
    });
    this.contentEl.querySelector<HTMLButtonElement>(".settings-reset")?.addEventListener("click", () => {
      this.settings.reset();
      this.render();
    });
    const first = this.contentEl.querySelector<HTMLElement>("input, select");
    first?.setAttribute("data-firstfocus", "true");
  }

  private injectStyles(): void {
    if (document.getElementById("settings-styles")) return;
    const s = document.createElement("style");
    s.id = "settings-styles";
    s.textContent = `
      .settings-screen { display: none; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, 0.65); z-index: 80;
        font-family: ui-monospace, monospace; color: #d8d8d8; }
      .settings-panel { background: #14141a; border: 1px solid #44445a;
        min-width: 480px; max-width: 720px; max-height: 80vh; display: flex; flex-direction: column; }
      .settings-header { display: flex; justify-content: space-between; align-items: center;
        padding: 12px 18px; border-bottom: 1px solid #2a2a3a; }
      .settings-header h2 { margin: 0; color: #ffaa33; font-size: 18px; }
      .settings-close { background: transparent; border: none; color: #aaa; font-size: 24px; cursor: pointer; line-height: 1; }
      .settings-close:hover { color: #fff; }
      .settings-body { padding: 16px 18px; overflow-y: auto; }
      .settings-body section { margin-bottom: 24px; }
      .settings-body h3 { color: #ffaa33; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px dashed #2a2a3a; padding-bottom: 4px; margin: 0 0 8px; }
      .settings-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; gap: 12px; }
      .settings-row label { color: #ddd; font-size: 14px; }
      .settings-row input[type=range] { width: 160px; }
      .settings-row input[type=checkbox] { width: 18px; height: 18px; }
      .settings-row select { background: #0a0a10; border: 1px solid #44445a; color: inherit; padding: 4px 8px; font-family: inherit; }
      .settings-reset { background: #2a2a3a; color: #fcc; border: 1px solid #4a4a5a; padding: 8px 14px; cursor: pointer; font-family: inherit; }
      .settings-reset:hover { background: #4a2a3a; color: #fee; }
    `;
    document.head.appendChild(s);
  }
}

function toggleField(label: string, key: string, value: boolean, _hint = false): string {
  return `<div class="settings-row">
    <label for="setting-${key}">${escapeHtml(label)}</label>
    <input id="setting-${key}" type="checkbox" data-key="${key}" ${value ? "checked" : ""}>
  </div>`;
}

function rangeField(label: string, key: string, value: number, min: number, max: number, step: number): string {
  return `<div class="settings-row">
    <label for="setting-${key}">${escapeHtml(label)}</label>
    <input id="setting-${key}" type="range" data-key="${key}" data-kind="number" min="${min}" max="${max}" step="${step}" value="${value}">
  </div>`;
}

function selectField(label: string, key: string, value: string | number, options: string[]): string {
  const sel = String(value);
  const opts = options.map((o) => `<option value="${o}" ${o === sel ? "selected" : ""}>${o}</option>`).join("");
  // For tilePx and animationSpeed we want number coercion.
  const kind = (key === "tilePx" || key === "animationSpeed") ? "number" : "";
  return `<div class="settings-row">
    <label for="setting-${key}">${escapeHtml(label)}</label>
    <select id="setting-${key}" data-key="${key}" ${kind ? `data-kind="${kind}"` : ""}>${opts}</select>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
