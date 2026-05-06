// Floating combat text: damage numbers, level-up sparkles, healing
// pops. Uses DOM absolute-positioned spans rather than canvas because
// the text styling (variable size, drop shadows, fonts) is much easier
// in CSS, and the perf cost is negligible (max ~30 texts in flight).
//
// Phase 5C parses these from the engine's message stream until the
// engine adds a structured combat-result EM_JS export.

const LIFETIME_MS = 1100;
const RISE_PX = 36;

export type FloatKind = "damage" | "damage-self" | "heal" | "magic" | "levelup" | "info";

const COLORS: Record<FloatKind, string> = {
  "damage":      "#ffeb6b",   // damage dealt: gold
  "damage-self": "#ff5050",   // damage taken: red
  "heal":        "#7afa7a",   // healing: green
  "magic":       "#c89cff",   // magic / status: purple
  "levelup":     "#ffaa33",   // big orange
  "info":        "#bbbbbb",
};

interface ActiveFloat {
  el: HTMLElement;
  startMs: number;
  cellX: number;
  cellY: number;
  baseLeft: number;
  baseTop: number;
}

export class FloatingTextLayer {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private actives: ActiveFloat[] = [];
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.host = document.createElement("div");
    this.host.id = "floating-text-layer";
    this.host.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; overflow: hidden;
      font-family: ui-monospace, monospace; font-weight: bold;
      text-shadow: 1px 1px 0 #000, 0 0 4px #000, 0 0 8px rgba(0,0,0,0.7);
    `;
    canvas.parentElement?.appendChild(this.host);
  }

  spawn(text: string, cellX: number, cellY: number, kind: FloatKind = "damage"): void {
    if (!text) return;
    const el = document.createElement("span");
    el.className = "floating-text";
    el.textContent = text;
    el.style.cssText = `
      position: absolute; will-change: transform, opacity;
      color: ${COLORS[kind]}; font-size: ${kind === "levelup" ? 22 : 16}px;
      transform: translate(-50%, -50%);
    `;
    this.host.appendChild(el);

    // Convert cell coords to canvas pixels. The renderer uses cellW/cellH
    // computed from the parent's clientWidth — we replicate that here.
    // For Phase 5C this is fine; Phase 5F refactors it into a shared
    // CellMetrics helper.
    const rect = this.canvas.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    const dx = rect.left - hostRect.left;
    const dy = rect.top - hostRect.top;
    const cellW = (rect.width - 8) / 80;
    const cellH = (rect.height - 8) / 21;

    const baseLeft = dx + 4 + cellX * cellW + cellW / 2;
    const baseTop  = dy + 4 + cellY * cellH + cellH / 2;
    el.style.left = `${baseLeft}px`;
    el.style.top  = `${baseTop}px`;

    this.actives.push({
      el, startMs: performance.now(),
      cellX, cellY, baseLeft, baseTop,
    });
    if (this.rafId === null) this.tick();
  }

  /** Burst variant — used for level-up "+1 LVL" with sparkle. */
  spawnLevelUp(cellX: number, cellY: number, label = "+1 LVL"): void {
    this.spawn(label, cellX, cellY, "levelup");
  }

  clear(): void {
    for (const a of this.actives) a.el.remove();
    this.actives = [];
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(): void {
    const now = performance.now();
    const remain: ActiveFloat[] = [];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const a of this.actives) {
      const t = (now - a.startMs) / LIFETIME_MS;
      if (t >= 1) {
        a.el.remove();
        continue;
      }
      const rise = reduceMotion ? RISE_PX * 0.3 : RISE_PX;
      const opacity = 1 - t * t;
      a.el.style.transform = `translate(-50%, -50%) translateY(${-rise * t}px)`;
      a.el.style.opacity = String(opacity);
      remain.push(a);
    }
    this.actives = remain;
    if (this.actives.length === 0) {
      this.rafId = null;
    } else {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }
}

// ---- Message-stream parser ----------------------------------------------

const DAMAGE_DEALT_RE = /you (?:hit|kick|punch|smite|slay|pummel|kill|destroy)[^.!]*?(\d+)/i;
const DAMAGE_TAKEN_RE = /(?:hits?|bites?|stings?|claws?|kicks?|gores?) you[^.!]*?\((\d+)\s*pts?\.?\)/i;
const LEVELUP_RE = /welcome to experience level (\d+)/i;
const HEAL_RE = /(?:feel better|feel restored|heal)/i;

export interface ParsedDamage {
  kind: FloatKind;
  amount?: number;
}

/** Best-effort parse of an engine message into a floating-text spawn.
 *  Returns null when there's nothing to render. The caller decides
 *  the cell to spawn at — typically the player position for self
 *  damage and the cursor cell for dealt damage. */
export function parseCombatMessage(msg: string): ParsedDamage | null {
  const m1 = DAMAGE_TAKEN_RE.exec(msg);
  if (m1) return { kind: "damage-self", amount: parseInt(m1[1]!, 10) };
  const m2 = DAMAGE_DEALT_RE.exec(msg);
  if (m2) return { kind: "damage", amount: parseInt(m2[1]!, 10) };
  if (LEVELUP_RE.test(msg)) return { kind: "levelup" };
  if (HEAL_RE.test(msg)) return { kind: "heal" };
  return null;
}
