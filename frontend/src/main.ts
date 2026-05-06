// Entry point. Wires together: WASM module + dispatcher + renderer +
// input + screens + audio + settings + accessibility. The flow is:
//
//   1. Show title screen immediately (no WASM dependency).
//   2. User clicks "New Game" → init audio (post-gesture), load WASM,
//      call shim_graphics_set_callback, callMain.
//   3. Engine drives the game; shim callbacks render through our handlers.
//   4. shim_exit_nhwindows → death/victory screen.
//   5. From death/victory, return to title.

import { installDispatcher, bindModule, type EmscriptenModule } from "./shim/dispatcher";
import { loadNethack } from "./wasm/loader";
import { MapRenderer } from "./render/webgl2";
import { TextWindow } from "./render/text-windows";
import { InputQueue, bindGlobalListeners } from "./input/keyboard";
import { registerHandlers } from "./handlers/window-procs";
import { MenuController } from "./ui/menu";
import { PromptController } from "./ui/prompts";
import { StatusHUD } from "./ui/status-hud";
import { ScreenManager } from "./screens/state-machine";
import { TitleScreen } from "./screens/title";
import { DeathScreen } from "./screens/death";
import { VictoryScreen } from "./screens/victory";
import { Settings, SettingsScreen } from "./screens/settings";
import { Soundscape, bedForBranch } from "./audio/soundscape";
import { ScreenReaderAnnouncer } from "./accessibility/screen-reader";
import { applyColorBlindPreset } from "./accessibility/colorblind";
import { setReducedMotionOverride } from "./accessibility/reduced-motion";
import { FloatingTextLayer, parseCombatMessage } from "./effects/floating-text";
import { StatusFlourishes, parseHunger, type HungerLevel } from "./effects/status-flourishes";
import { ItemAuraLayer } from "./effects/item-aura";
import { Camera } from "./render/camera";
import { ParticleSystem } from "./render/particles";
import { PerfMonitor } from "./accessibility/perf-monitor";
import { PostProcessPipeline } from "./render/postprocess";
import { STYLE_BY_BRANCH, DungeonBranch } from "./render/level-meta";

const WASM_URL = "/wasm/nethack.js";

const messageEl = document.getElementById("message-window");
const statusEl = document.getElementById("status-window");
const canvas = document.getElementById("map") as HTMLCanvasElement | null;
const bootOverlay = document.getElementById("boot-overlay");
const bootMessage = document.getElementById("boot-message");

if (!messageEl || !statusEl || !canvas || !bootOverlay || !bootMessage) {
  throw new Error("frontend: required DOM elements missing from index.html");
}

// Core game-rendering components
const messages = new TextWindow("message-window");
const status = new StatusHUD("status-window");
const map = new MapRenderer(canvas);
const input = new InputQueue();
const menu = new MenuController();
const prompt = new PromptController();
bindGlobalListeners(input, (cx, cy) => map.cellAtClientPoint(cx, cy));
void map.loadTileAtlas("/tiles/nhtiles-16.png", "/tiles/manifest.json");

// Phase 5C effect layers
const floatingText = new FloatingTextLayer(canvas);
const flourishes = new StatusFlourishes("#app");
const itemAura = new ItemAuraLayer(canvas);
const camera = new Camera();
const particles = new ParticleSystem();

// Phase 5B post-process pipeline. The renderer will draw into the
// pipeline's scene FBO; the pipeline composites bloom + color-grade +
// vignette + optional CRT to the screen each frame.
const drawingBuf = map.drawingBufferSize();
const postprocess = new PostProcessPipeline(
  (canvas.getContext("webgl2") as WebGL2RenderingContext) ?? canvas.getContext("webgl2")!,
  drawingBuf.width || 1024,
  drawingBuf.height || 512,
);
map.setRenderTarget(postprocess.sceneFBO(), drawingBuf.width || 1024, drawingBuf.height || 512);
map.onAfterRender = () => postprocess.composite();

// Settings + accessibility
const settings = new Settings();
const announcer = new ScreenReaderAnnouncer();
applyColorBlindPreset(settings.get("colorBlind"));
setReducedMotionOverride(settings.get("reducedMotion") ? true : null);
flourishes.setHallucinationsAllowed(settings.get("hallucinationsEnabled"));
applyPostprocessSettings();
settings.on((s) => {
  applyColorBlindPreset(s.colorBlind);
  setReducedMotionOverride(s.reducedMotion ? true : null);
  flourishes.setHallucinationsAllowed(s.hallucinationsEnabled);
  applyPostprocessSettings();
});

function applyPostprocessSettings(): void {
  const s = settings.getAll();
  postprocess.setSettings({
    crtEnabled: s.crtEnabled,
    crtScanlines: s.crtScanlineIntensity,
    vignetteIntensity: s.vignetteIntensity,
  });
}

// Audio
const soundscape = new Soundscape(settings);

// Performance monitor
const perfMon = new PerfMonitor();

// Screen manager
const screensHost = document.body;
const screens = new ScreenManager(screensHost);
const titleScreen = new TitleScreen({
  onNewGame: () => { void startGame(); },
  onSettings: () => screens.goto("settings"),
  onBestiary: () => { /* Phase 5D bonus — not yet implemented */ },
  onQuit: () => { /* Just stays on title; the user can close the tab */ },
});
const deathScreen = new DeathScreen(() => screens.goto("title"));
const victoryScreen = new VictoryScreen(() => screens.goto("title"));
const settingsScreen = new SettingsScreen(settings, () => screens.goto("title"));
screens.register("title", titleScreen);
screens.register("death", deathScreen);
screens.register("victory", victoryScreen);
screens.register("settings", settingsScreen);

// Boot overlay → title screen on initial load
function setBoot(msg: string): void { bootMessage!.textContent = msg; }
function hideBoot(): void { bootOverlay!.classList.add("hidden"); }
hideBoot();
screens.goto("title");

const dispatch = installDispatcher("nethackCallback");

// State that the handlers need to share with the main loop
let currentBranch = "main";
let lastHpPercent = -1;
let cachedVitals = { hpPercent: 100, hunger: "normal" as HungerLevel, confused: false, hallucinating: false, stunned: false };

// Track the last cell the player walked into (for floating-text spawning).
// Engine doesn't expose "is this the player" cleanly in print_glyph;
// approximate via @-character emit, then refine when EM_JS state lands.
let playerCellX = 40;
let playerCellY = 10;

let moduleRef: EmscriptenModule | null = null;
let started = false;

async function startGame(): Promise<void> {
  if (started) return;
  started = true;

  setBoot("Initialising audio…");
  bootOverlay!.classList.remove("hidden");
  await soundscape.init();
  void soundscape.transitionTo(bedForBranch(currentBranch));

  setBoot("Loading WASM engine…");
  let engineMod: Awaited<ReturnType<typeof loadNethack>>;
  try {
    engineMod = await loadNethack(WASM_URL, {
      print: (s) => console.log("[nh]", s),
      printErr: (s) => console.warn("[nh]", s),
      locateFile: (path) => `/wasm/${path}`,
      noInitialRun: true,
      noExitRuntime: true,
      onAbort: (reason) => setBoot(`Engine aborted: ${String(reason)}`),
    });
  } catch (err) {
    setBoot(
      `Failed to load /wasm/nethack.js. Build it with:\n` +
      `  cd sys/unix && sh setup.sh hints/wasm.500\n` +
      `  cd ../.. && make fetch-Lua && make wasm\n` +
      `then ./frontend/scripts/sync-wasm.sh\n\n` +
      `Underlying error: ${String(err)}`,
    );
    started = false;
    return;
  }

  bindModule(engineMod as unknown as EmscriptenModule);
  moduleRef = engineMod as unknown as EmscriptenModule;

  registerHandlers({
    module: moduleRef,
    map, messages, status, menu, prompt, input,
    onExit: (msg) => {
      announcer.announce(`Game ended: ${msg}`);
      // Heuristic: "ascended" / "with the amulet" → victory; else death.
      const m = msg.toLowerCase();
      if (m.includes("ascended") || m.includes("amulet of yendor")) {
        victoryScreen.setInfo({ finalScore: 0, turns: 0, summary: msg });
        screens.goto("victory");
      } else {
        deathScreen.setInfo({ cause: msg, finalStats: [], lastMessages: [] });
        screens.goto("death");
      }
      started = false;
    },
  });

  // Wrap the print_glyph + putstr handlers with effect spawning
  installEffectHooks();

  setBoot("Starting NetHack…");
  const m = moduleRef as EmscriptenModule & {
    _shim_graphics_set_callback?: (ptr: number) => void;
    callMain?: (args: string[]) => number;
  };
  const cbName = dispatch.callbackName;
  const bytes = new TextEncoder().encode(cbName);
  const namePtr = m._malloc(bytes.length + 1);
  m.HEAPU8.set(bytes, namePtr);
  m.HEAPU8[namePtr + bytes.length] = 0;
  if (typeof m._shim_graphics_set_callback !== "function") {
    setBoot("Engine missing _shim_graphics_set_callback export — rebuild WASM.");
    started = false;
    return;
  }
  m._shim_graphics_set_callback(namePtr);

  hideBoot();

  // Per-frame loop drives the camera, particles, perf monitor, etc.
  const loop = (now: number): void => {
    perfMon.tick(now);
    camera.update(now, 16, 32, 32);
    map.setCamera(camera.cameraX(), camera.cameraY(), camera.zoom());
    map.setShake(camera.shakeX(), camera.shakeY());
    particles.update(16);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (typeof m.callMain === "function") {
    try {
      m.callMain([]);
    } catch (err) {
      const e = err as { name?: string; status?: number };
      if (e?.name !== "ExitStatus") console.error("callMain threw:", err);
    }
  }
}

function installEffectHooks(): void {
  // Hook the dispatcher to spawn floating text on combat messages and
  // mirror messages to the screen-reader live region. This is layered
  // on top of the registerHandlers wiring; we override two specific
  // handler names by re-registering them to call the original behavior
  // plus the side-effect.
  //
  // Because re-registering replaces the handler, we capture the original
  // registerHandlers behavior by importing the dispatcher directly.

  // Wrap putstr to announce + parse for combat
  const announceMessage = (text: string) => {
    if (!text) return;
    announcer.announce(text);
    const parsed = parseCombatMessage(text);
    if (parsed) {
      if (parsed.kind === "damage-self") {
        floatingText.spawn(parsed.amount ? String(parsed.amount) : "!", playerCellX, playerCellY, "damage-self");
        camera.shake(2, 80);
      } else if (parsed.kind === "damage" && parsed.amount) {
        // We don't know which monster cell — fire at the player cell;
        // looks fine in practice and refined when EM_JS state lands.
        floatingText.spawn(String(parsed.amount), playerCellX, playerCellY, "damage");
      } else if (parsed.kind === "heal") {
        floatingText.spawn("✚", playerCellX, playerCellY, "heal");
      } else if (parsed.kind === "levelup") {
        floatingText.spawnLevelUp(playerCellX, playerCellY);
      }
    }
  };

  // We can't easily override the registerHandlers wiring without
  // duplicating its setup. Instead expose announce hooks via the
  // dispatcher's globalThis hook after registration. Simpler: tap
  // into the message TextWindow.append to also drive announcements.
  const origAppend = messages.append.bind(messages);
  messages.append = (text: string) => {
    origAppend(text);
    announceMessage(text);
  };

  // Vitals tracking from status updates: when HP percent changes,
  // toggle the heartbeat + flourishes. The handlers' shim_status_update
  // already pushes to StatusHUD; we tap the same data.
  const origSetField = status.setField.bind(status);
  status.setField = (fldidx: number, text: string, percent = -1) => {
    origSetField(fldidx, text, percent);
    if (fldidx === 18 /* HP */ && percent >= 0) {
      cachedVitals.hpPercent = percent;
      flourishes.update(cachedVitals);
      if (percent !== lastHpPercent) {
        lastHpPercent = percent;
        soundscape.setHeartbeatActive(percent < 30);
      }
    }
    if (fldidx === 17 /* hunger */) {
      cachedVitals.hunger = parseHunger(text);
      flourishes.update(cachedVitals);
    }
    if (fldidx === 22 /* condition */) {
      cachedVitals.confused = /confus/i.test(text);
      cachedVitals.hallucinating = /hallu/i.test(text);
      cachedVitals.stunned = /stun/i.test(text);
      flourishes.update(cachedVitals);
    }
  };

  // Cross-fade audio + apply per-branch color grade when the level-name
  // (BL_LEVELDESC=20) changes.
  const onLevelDescChange = (lvl: string) => {
    import("./render/level-meta").then(({ classifyLevel }) => {
      const branch = classifyLevel(lvl);
      currentBranch = branch;
      void soundscape.transitionTo(bedForBranch(branch));
      const style = STYLE_BY_BRANCH[branch as DungeonBranch];
      if (style) postprocess.applyLevelStyle(style);
    });
  };
  let lastLevelDesc = "";
  const origStatusSetField2 = status.setField;
  status.setField = (fldidx: number, text: string, percent = -1) => {
    origStatusSetField2(fldidx, text, percent);
    if (fldidx === 20 && text && text !== lastLevelDesc) {
      lastLevelDesc = text;
      onLevelDescChange(text);
    }
  };

  // Track player cell from the @ glyph for floating-text aim. This
  // is approximate; the EM_JS engine state export will replace it.
  // We do it by tapping the renderer's cell store via a periodic
  // scan in the main loop — but that's expensive. For now, defer to
  // the explicit playerCellX/Y updates the engine will provide. The
  // default of (40, 10) is the centre of the map and looks fine.
  void itemAura;
  void particles;
}

console.info("ModMyNetHack frontend loaded. Click 'New Game' on the title screen to begin.");
