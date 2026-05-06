// Status HUD with per-stat icon slots. Replaces the Phase 1 plain
// concatenated string. The engine emits status updates via
// shim_status_update(fldidx, ptr, chg, percent, color, colormasks);
// fldidx is from BL_* enum in engine. We map known fields to slots.
//
// Engine field indices (from include/botl.h, NetHack 5.0):
//   BL_TITLE   0  player name + class
//   BL_STR     1  strength
//   BL_DX      2  dex
//   BL_CO      3  con
//   BL_IN      4  int
//   BL_WI      5  wis
//   BL_CH      6  cha
//   BL_ALIGN   7  alignment
//   BL_SCORE   8  score
//   BL_CAP     9  encumbrance status
//   BL_GOLD   10  gold pieces
//   BL_ENE    11  energy / power
//   BL_ENEMAX 12
//   BL_XP     13
//   BL_AC     14
//   BL_HD     15  HD (when polymorphed)
//   BL_TIME   16  turn count
//   BL_HUNGER 17
//   BL_HP     18
//   BL_HPMAX  19
//   BL_LEVELDESC 20
//   BL_EXP    21  experience points
//   BL_CONDITION 22  status conditions
//
// We display them in three rows: title; HP/MP/AC/XP; turn/hunger/condition.
// The HUD applies its own styling — it's a real UI component, not a
// reflowed text line.

const FIELD_NAMES: Record<number, string> = {
  0: "title", 1: "Str", 2: "Dx", 3: "Co", 4: "In", 5: "Wi", 6: "Ch",
  7: "align", 8: "score", 9: "cap", 10: "$", 11: "Pw", 12: "PwMx",
  13: "xp", 14: "AC", 15: "HD", 16: "T", 17: "hunger", 18: "HP",
  19: "HPMx", 20: "level", 21: "exp", 22: "cond",
};

export class StatusHUD {
  private readonly el: HTMLElement;
  private readonly fields = new Map<number, string>();
  private readonly percents = new Map<number, number>();

  constructor(elementId: string) {
    const el = document.getElementById(elementId);
    if (!el) throw new Error(`StatusHUD: #${elementId} not found`);
    this.el = el;
    this.injectStyles();
    this.render();
  }

  setField(fldidx: number, text: string, percent = -1): void {
    if (text) this.fields.set(fldidx, text);
    else this.fields.delete(fldidx);
    if (percent >= 0) this.percents.set(fldidx, percent);
    this.render();
  }

  clear(): void {
    this.fields.clear();
    this.percents.clear();
    this.render();
  }

  private render(): void {
    const get = (idx: number): string => this.fields.get(idx) ?? "";
    const title = get(0);
    const hp = get(18); const hpmax = get(19); const hpPct = this.percents.get(18) ?? 100;
    const pw = get(11); const pwmax = get(12);
    const ac = get(14);
    const xp = get(13); const exp = get(21);
    const turn = get(16);
    const hunger = get(17);
    const cond = get(22);
    const gold = get(10);
    const align = get(7);
    const cap = get(9);
    const level = get(20);

    const stats = [
      { label: "Str", v: get(1) }, { label: "Dx", v: get(2) }, { label: "Co", v: get(3) },
      { label: "In", v: get(4) }, { label: "Wi", v: get(5) }, { label: "Ch", v: get(6) },
    ].filter(s => s.v).map(s => `<span class="hud-stat"><span class="hud-key">${s.label}</span> ${s.v}</span>`).join("");

    const hpClass = hpPct < 30 ? "hud-hp critical" : hpPct < 60 ? "hud-hp wounded" : "hud-hp";
    const hpBar = hpmax ? `<div class="hud-bar"><div class="hud-bar-fill" style="width:${Math.max(0, Math.min(100, hpPct))}%"></div></div>` : "";

    this.el.innerHTML = `
      <div class="hud-row hud-row-1">
        <span class="hud-title">${escapeHtml(title)}</span>
        ${align ? `<span class="hud-align">${escapeHtml(align)}</span>` : ""}
        ${level ? `<span class="hud-level">${escapeHtml(level)}</span>` : ""}
      </div>
      <div class="hud-row hud-row-2">
        ${hp ? `<span class="${hpClass}"><span class="hud-key">HP</span> ${escapeHtml(hp)}${hpmax ? "/" + escapeHtml(hpmax) : ""}${hpBar}</span>` : ""}
        ${pw ? `<span class="hud-pw"><span class="hud-key">Pw</span> ${escapeHtml(pw)}${pwmax ? "/" + escapeHtml(pwmax) : ""}</span>` : ""}
        ${ac ? `<span class="hud-ac"><span class="hud-key">AC</span> ${escapeHtml(ac)}</span>` : ""}
        ${xp ? `<span class="hud-xp"><span class="hud-key">XP</span> ${escapeHtml(xp)}${exp ? "/" + escapeHtml(exp) : ""}</span>` : ""}
        ${gold ? `<span class="hud-gold">${escapeHtml(gold)}</span>` : ""}
        ${stats}
      </div>
      <div class="hud-row hud-row-3">
        ${turn ? `<span class="hud-turn"><span class="hud-key">T</span> ${escapeHtml(turn)}</span>` : ""}
        ${hunger ? `<span class="hud-hunger">${escapeHtml(hunger)}</span>` : ""}
        ${cap ? `<span class="hud-cap">${escapeHtml(cap)}</span>` : ""}
        ${cond ? `<span class="hud-cond">${escapeHtml(cond)}</span>` : ""}
      </div>
    `;
  }

  private injectStyles(): void {
    if (document.getElementById("hud-styles")) return;
    const s = document.createElement("style");
    s.id = "hud-styles";
    s.textContent = `
      #status-window { padding: 6px 10px; min-height: 3.6em; border-top: 1px solid #2a2a3a; background: linear-gradient(to bottom, #14141a, #0a0a10); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
      .hud-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; line-height: 1.5; font-size: 13px; }
      .hud-row-1 { color: #ffaa33; font-weight: bold; }
      .hud-key { color: #888; font-size: 0.9em; margin-right: 3px; }
      .hud-hp { color: #6c6; }
      .hud-hp.wounded { color: #fc5; }
      .hud-hp.critical { color: #f55; animation: hp-pulse 1.2s infinite; }
      @keyframes hp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
      .hud-pw { color: #6cf; }
      .hud-ac { color: #fff; }
      .hud-xp { color: #fc6; }
      .hud-gold { color: #fd6; }
      .hud-turn { color: #aaa; }
      .hud-hunger { color: #fa5; }
      .hud-cap { color: #c8c; }
      .hud-cond { color: #f66; }
      .hud-stat { color: #ddd; font-size: 12px; }
      .hud-bar { display: inline-block; vertical-align: middle; width: 60px; height: 6px; background: #2a2a3a; border: 1px solid #44445a; margin-left: 4px; }
      .hud-bar-fill { height: 100%; background: linear-gradient(90deg, #6c6, #6c6); }
      .hud-hp.wounded .hud-bar-fill { background: linear-gradient(90deg, #fc5, #fa5); }
      .hud-hp.critical .hud-bar-fill { background: linear-gradient(90deg, #f55, #c33); }
      @media (prefers-reduced-motion: reduce) {
        .hud-hp.critical { animation: none; }
      }
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export { FIELD_NAMES };
