// Whole-screen status flourishes that respond to the player state:
// low-HP red pulse, hunger desaturation, confused wobble, hallucinating
// color cycling. These are CSS filter / animation overlays applied to
// the #app element. The engine state EM_JS export populates the inputs;
// until that lands we drive them from the StatusHUD's parsed values.
//
// All effects respect prefers-reduced-motion and the Settings panel
// "hallucination effect" toggle.

export interface StatusVitals {
  hpPercent: number;       // 0..100; -1 = unknown
  hunger: HungerLevel;
  confused: boolean;
  hallucinating: boolean;
  stunned: boolean;
}

export type HungerLevel = "satiated" | "normal" | "hungry" | "weak" | "fainting" | "starved";

const DEFAULT_VITALS: StatusVitals = {
  hpPercent: 100,
  hunger: "normal",
  confused: false,
  hallucinating: false,
  stunned: false,
};

const HUNGER_DESATURATION: Record<HungerLevel, number> = {
  satiated: 0,
  normal:   0,
  hungry:   0.15,
  weak:     0.35,
  fainting: 0.6,
  starved:  0.8,
};

export class StatusFlourishes {
  private readonly root: HTMLElement;
  private vitals: StatusVitals = { ...DEFAULT_VITALS };
  private hallucinationsOn = true;
  private rmotion = false;
  private hueRotateAnim: number | null = null;

  constructor(rootSelector = "#app") {
    const root = document.querySelector<HTMLElement>(rootSelector);
    if (!root) throw new Error(`StatusFlourishes: ${rootSelector} not found`);
    this.root = root;
    this.injectStyles();
    this.rmotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
      this.rmotion = e.matches;
      this.apply();
    });
  }

  setHallucinationsAllowed(on: boolean): void {
    this.hallucinationsOn = on;
    this.apply();
  }

  update(v: Partial<StatusVitals>): void {
    this.vitals = { ...this.vitals, ...v };
    this.apply();
  }

  private apply(): void {
    const v = this.vitals;
    const filters: string[] = [];

    // Hunger: desaturate
    const desat = HUNGER_DESATURATION[v.hunger] ?? 0;
    if (desat > 0) filters.push(`saturate(${1 - desat})`);

    // Low HP: pulse red overlay (handled via CSS class so the keyframe runs)
    this.root.classList.toggle("flourish-low-hp", v.hpPercent >= 0 && v.hpPercent < 30 && !this.rmotion);
    this.root.classList.toggle("flourish-low-hp-static", v.hpPercent >= 0 && v.hpPercent < 30 && this.rmotion);

    // Confused: subtle wobble (CSS animation)
    this.root.classList.toggle("flourish-confused", v.confused && !this.rmotion);

    // Stunned: brief blur
    if (v.stunned) filters.push("blur(0.6px)");

    // Hallucinating: color cycling via JS-driven hue-rotate (so we can
    // toggle off cleanly when the option turns off)
    const wantHue = v.hallucinating && this.hallucinationsOn && !this.rmotion;
    if (wantHue && this.hueRotateAnim === null) this.startHueRotate();
    if (!wantHue && this.hueRotateAnim !== null) this.stopHueRotate();

    this.root.style.filter = filters.join(" ");
  }

  private startHueRotate(): void {
    let phase = 0;
    const tick = () => {
      phase = (phase + 6) % 360;
      // Don't blow away the existing filter list; rebuild it.
      const existing = this.root.style.filter
        .split(" ")
        .filter((p) => p && !p.startsWith("hue-rotate"))
        .join(" ");
      this.root.style.filter = `${existing} hue-rotate(${phase}deg)`.trim();
      this.hueRotateAnim = requestAnimationFrame(tick);
    };
    this.hueRotateAnim = requestAnimationFrame(tick);
  }

  private stopHueRotate(): void {
    if (this.hueRotateAnim !== null) {
      cancelAnimationFrame(this.hueRotateAnim);
      this.hueRotateAnim = null;
    }
    this.apply(); // rebuild filter without hue-rotate
  }

  private injectStyles(): void {
    if (document.getElementById("flourish-styles")) return;
    const s = document.createElement("style");
    s.id = "flourish-styles";
    s.textContent = `
      #app { transition: filter 250ms linear; }
      .flourish-low-hp { animation: flourish-hp-pulse 1.4s ease-in-out infinite; }
      @keyframes flourish-hp-pulse {
        0%, 100% { box-shadow: inset 0 0 0 rgba(220, 40, 40, 0); }
        50%      { box-shadow: inset 0 0 60px rgba(220, 40, 40, 0.45); }
      }
      .flourish-low-hp-static { box-shadow: inset 0 0 60px rgba(220, 40, 40, 0.3); }
      .flourish-confused { animation: flourish-wobble 480ms ease-in-out infinite; }
      @keyframes flourish-wobble {
        0%, 100% { transform: translateX(0px); }
        25%      { transform: translateX(-2px) rotate(-0.15deg); }
        75%      { transform: translateX( 2px) rotate( 0.15deg); }
      }
    `;
    document.head.appendChild(s);
  }
}

/** Parse a hunger keyword from engine status text. */
export function parseHunger(s: string): HungerLevel {
  const v = s.toLowerCase().trim();
  if (v === "satiated") return "satiated";
  if (v === "hungry")   return "hungry";
  if (v === "weak")     return "weak";
  if (v === "fainting" || v === "fainted") return "fainting";
  if (v === "starved")  return "starved";
  return "normal";
}
