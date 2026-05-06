// Item aura overlays — golden glow on blessed items, violet on cursed,
// cyan shimmer on unidentified magicals. Renders via DOM absolute-
// positioned divs above the canvas, similar to floating-text. The
// renderer doesn't need to know about these.
//
// Phase 5C ships only the visual layer; the engine wiring (which
// items to glow, when blessed/cursed status is known) waits on the
// EM_JS engine state export — until then the layer can be exercised
// programmatically for testing.

export type AuraType = "blessed" | "cursed" | "magical";

const AURA_COLOR: Record<AuraType, string> = {
  blessed:  "rgba(255, 220, 80, 0.55)",
  cursed:   "rgba(170, 80, 200, 0.5)",
  magical:  "rgba(120, 200, 255, 0.45)",
};

interface ActiveAura {
  el: HTMLElement;
  cellX: number;
  cellY: number;
  type: AuraType;
}

export class ItemAuraLayer {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private auras = new Map<string, ActiveAura>();   // key = `${x},${y}`

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.host = document.createElement("div");
    this.host.id = "item-aura-layer";
    this.host.style.cssText = `
      position: absolute; inset: 0; pointer-events: none;
    `;
    canvas.parentElement?.appendChild(this.host);
    this.injectStyles();
  }

  set(cellX: number, cellY: number, type: AuraType | null): void {
    const key = `${cellX},${cellY}`;
    const existing = this.auras.get(key);
    if (existing && type === existing.type) return;
    if (existing) {
      existing.el.remove();
      this.auras.delete(key);
    }
    if (type === null) return;

    const el = document.createElement("div");
    el.className = "item-aura";
    el.style.background = `radial-gradient(circle, ${AURA_COLOR[type]} 0%, transparent 65%)`;
    this.host.appendChild(el);
    this.position(el, cellX, cellY);

    this.auras.set(key, { el, cellX, cellY, type });
  }

  clearAll(): void {
    for (const a of this.auras.values()) a.el.remove();
    this.auras.clear();
  }

  /** Re-position all auras (call on window resize). */
  reposition(): void {
    for (const a of this.auras.values()) this.position(a.el, a.cellX, a.cellY);
  }

  private position(el: HTMLElement, cellX: number, cellY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    const dx = rect.left - hostRect.left;
    const dy = rect.top - hostRect.top;
    const cellW = (rect.width - 8) / 80;
    const cellH = (rect.height - 8) / 21;
    const w = cellW * 1.8;
    const h = cellH * 1.8;
    el.style.left = `${dx + 4 + cellX * cellW - (w - cellW) / 2}px`;
    el.style.top  = `${dy + 4 + cellY * cellH - (h - cellH) / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  }

  private injectStyles(): void {
    if (document.getElementById("item-aura-styles")) return;
    const s = document.createElement("style");
    s.id = "item-aura-styles";
    s.textContent = `
      .item-aura {
        position: absolute;
        animation: aura-pulse 2.4s ease-in-out infinite;
        will-change: opacity;
      }
      @keyframes aura-pulse {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        50%      { opacity: 1.0; transform: scale(1.06); }
      }
      @media (prefers-reduced-motion: reduce) {
        .item-aura { animation: none; opacity: 0.85; }
      }
    `;
    document.head.appendChild(s);
  }
}
