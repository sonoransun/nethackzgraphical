// Ambient soundscape engine. Web Audio crossfading bed manager;
// one ambient track always playing once the user has interacted with
// the page, crossfaded on level transitions over 2 seconds.
//
// No event SFX, no music — explicit Phase 5 non-goal. The HP heartbeat
// is layered over the current ambient bed when HP < 30%.

import type { Settings } from "../screens/settings";

export interface BedDescriptor {
  name: string;
  url: string;
  volume?: number;     // per-bed gain trim, 0..1 (default 1)
}

export const DEFAULT_BEDS: Record<string, BedDescriptor> = {
  "surface":          { name: "Surface",         url: "/sounds/ambient/surface.ogg" },
  "dungeon-hum":      { name: "Dungeon Hum",     url: "/sounds/ambient/dungeon-hum.ogg" },
  "cave-drip":        { name: "Cave Drip",       url: "/sounds/ambient/cave-drip.ogg" },
  "crystal-cavern":   { name: "Crystal Cavern",  url: "/sounds/ambient/crystal-cavern.ogg" },
  "sokoban":          { name: "Sokoban",         url: "/sounds/ambient/sokoban.ogg" },
  "crackling-fire":   { name: "Crackling Fire",  url: "/sounds/ambient/crackling-fire.ogg" },
  "brimstone-wind":   { name: "Brimstone Wind",  url: "/sounds/ambient/brimstone-wind.ogg" },
  "water-plane":      { name: "Water Plane",     url: "/sounds/ambient/water-plane.ogg" },
  "eldritch-hum":     { name: "Eldritch Hum",    url: "/sounds/ambient/eldritch-hum.ogg" },
  "cosmic":           { name: "Cosmic",          url: "/sounds/ambient/cosmic.ogg" },
  "heartbeat":        { name: "Heartbeat",       url: "/sounds/ambient/heartbeat.ogg" },
};

const CROSSFADE_MS = 2000;

interface BedSlot {
  bed: BedDescriptor | null;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;

  private slots: [BedSlot, BedSlot] | null = null;
  private activeSlot = 0;

  private heartbeatSource: AudioBufferSourceNode | null = null;
  private heartbeatGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private currentKey: string | null = null;
  private pendingKey: string | null = null;
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    settings.on(() => this.applySettings());
    document.addEventListener("visibilitychange", () => this.onVisibilityChange());
  }

  /** Web Audio requires a user gesture before AudioContext.resume()
   *  works. Call this from a click handler in the title screen. */
  async init(): Promise<void> {
    if (this.ctx) return;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) {
      console.warn("Soundscape: Web Audio not supported");
      return;
    }
    this.ctx = new Ctor();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.connect(this.masterGain);
    this.heartbeatGain = this.ctx.createGain();
    this.heartbeatGain.gain.value = 0;
    this.heartbeatGain.connect(this.masterGain);

    this.slots = [
      { bed: null, source: null, gain: this.makeSlotGain() },
      { bed: null, source: null, gain: this.makeSlotGain() },
    ];

    this.applySettings();

    // If a bed transition was queued before init completed, run it now.
    if (this.pendingKey) {
      const k = this.pendingKey;
      this.pendingKey = null;
      void this.transitionTo(k);
    }
  }

  private makeSlotGain(): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = 0;
    g.connect(this.ambientGain!);
    return g;
  }

  /** Trigger a bed change. Crossfades over CROSSFADE_MS. Safe to call
   *  before init() completes; the call queues. */
  async transitionTo(bedKey: string): Promise<void> {
    if (!this.ctx) {
      this.pendingKey = bedKey;
      return;
    }
    if (this.currentKey === bedKey) return;

    const desc = DEFAULT_BEDS[bedKey];
    if (!desc) {
      console.warn(`Soundscape: unknown bed "${bedKey}"`);
      return;
    }
    const buf = await this.loadBuffer(desc);
    if (!buf) return;
    if (!this.slots) return;

    const newSlot = 1 - this.activeSlot;
    const oldSlot = this.activeSlot;
    const now = this.ctx.currentTime;
    const fadeS = CROSSFADE_MS / 1000;

    // Stop the old source after crossfade
    const old = this.slots[oldSlot];
    if (old.source) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fadeS);
      old.source.stop(now + fadeS + 0.05);
    }

    // Start the new source
    const newOne = this.slots[newSlot];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(newOne.gain);
    newOne.bed = desc;
    newOne.source = src;
    newOne.gain.gain.cancelScheduledValues(now);
    newOne.gain.gain.setValueAtTime(0, now);
    newOne.gain.gain.linearRampToValueAtTime(desc.volume ?? 1, now + fadeS);
    src.start(now);

    this.activeSlot = newSlot;
    this.currentKey = bedKey;
  }

  /** Layer the heartbeat under the ambient when HP is critically low. */
  setHeartbeatActive(active: boolean): void {
    if (!this.ctx || !this.heartbeatGain) return;
    const target = active ? 0.6 : 0;
    const now = this.ctx.currentTime;
    this.heartbeatGain.gain.cancelScheduledValues(now);
    this.heartbeatGain.gain.linearRampToValueAtTime(target, now + 0.6);

    if (active && !this.heartbeatSource) {
      void this.startHeartbeat();
    } else if (!active && this.heartbeatSource) {
      // Stop after fade.
      const src = this.heartbeatSource;
      this.heartbeatSource = null;
      try { src.stop(now + 0.7); } catch { /* already stopped */ }
    }
  }

  private async startHeartbeat(): Promise<void> {
    if (!this.ctx || !this.heartbeatGain) return;
    const buf = await this.loadBuffer(DEFAULT_BEDS["heartbeat"]!);
    if (!buf || !this.heartbeatGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.heartbeatGain);
    src.start();
    this.heartbeatSource = src;
  }

  private async loadBuffer(desc: BedDescriptor): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.buffers.get(desc.url);
    if (cached) return cached;
    try {
      const resp = await fetch(desc.url);
      if (!resp.ok) {
        console.warn(`Soundscape: ${desc.url} returned ${resp.status} — using silent fallback`);
        return this.silentBuffer();
      }
      const arr = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.buffers.set(desc.url, buf);
      return buf;
    } catch (err) {
      console.warn(`Soundscape: load failed for ${desc.url}; using silent fallback`, err);
      const silent = this.silentBuffer();
      this.buffers.set(desc.url, silent);
      return silent;
    }
  }

  /** When ambient files aren't yet sourced (Phase 5E external work),
   *  create a 4-second silent buffer so the rest of the system runs. */
  private silentBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    return buf;
  }

  private applySettings(): void {
    if (!this.masterGain || !this.ambientGain) return;
    const s = this.settings.getAll();
    const master = s.audioMuted ? 0 : s.audioMaster;
    this.masterGain.gain.value = master;
    this.ambientGain.gain.value = s.audioAmbient;
  }

  private onVisibilityChange(): void {
    if (!this.ctx) return;
    if (document.hidden) {
      this.ctx.suspend?.();
    } else {
      this.ctx.resume?.();
    }
  }

  /** Tear down everything (e.g. on page unload). */
  async dispose(): Promise<void> {
    if (this.heartbeatSource) {
      try { this.heartbeatSource.stop(); } catch { /* idempotent */ }
      this.heartbeatSource = null;
    }
    if (this.slots) {
      for (const slot of this.slots) {
        if (slot.source) {
          try { slot.source.stop(); } catch { /* idempotent */ }
        }
      }
    }
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* idempotent */ }
      this.ctx = null;
    }
  }
}

/** Map a level branch (from level-meta) to a bed key. Mirrors the
 *  STYLE_BY_BRANCH ambientBed field but exposed here for direct use. */
export function bedForBranch(branch: string): string {
  // Branch keys are kebab-case strings from DungeonBranch; bed keys
  // happen to match for now. If they ever diverge, add a mapping table.
  const normalized = branch.toLowerCase().replace(/_/g, "-");
  if (DEFAULT_BEDS[normalized]) return normalized;
  return "dungeon-hum";
}
