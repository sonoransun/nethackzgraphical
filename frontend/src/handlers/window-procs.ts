// Window-proc callback implementations. Phases 1–3 land here:
//   • basic engine wiring (init/exit/window create/destroy)
//   • map rendering via WebGL2 MapRenderer
//   • text streams (messages, raw_print)
//   • keyboard + mouse input via InputQueue
//   • interactive menu via MenuController (Phase 3)
//   • modal yn / getlin / display_file via PromptController (Phase 3)
//   • styled status HUD via StatusHUD (Phase 3)
//
// Callbacks not implemented here fall through to the dispatcher's
// defaultReturn(), which returns 0 / space / null as appropriate.

import { registerHandler, type EmscriptenModule } from "../shim/dispatcher";
import { type InputQueue } from "../input/keyboard";
import { MapRenderer } from "../render/webgl2";
import { TextWindow } from "../render/text-windows";
import { WindowType } from "../shim/types";
import { MenuController, PickHow, type MenuItem } from "../ui/menu";
import { PromptController } from "../ui/prompts";
import { StatusHUD } from "../ui/status-hud";

// Engine-side ANY_P + count = MENU_ITEM_P. ANY_P is a union of
// pointer-sized scalars; on WASM32 it's 4 bytes. count is `long`,
// also 4 bytes under WASM. So MENU_ITEM_P is 8 bytes total.
//
// If the engine ever changes this, the assertion in select_menu's
// allocation will overflow silently — we'd want an EM_JS export
// confirming sizeof(MENU_ITEM_P) at runtime. Tracked in MODERNIZATION.md.
const MENU_ITEM_SIZE = 8;
const ANY_P_SIZE = 4;

export interface HandlerDeps {
  module: EmscriptenModule;
  map: MapRenderer;
  messages: TextWindow;
  status: StatusHUD;
  menu: MenuController;
  prompt: PromptController;
  input: InputQueue;
  /** Player name to feed back when the engine asks. Defaults to "Player". */
  playerName?: string;
  /** Called when the engine signals shutdown (shim_exit_nhwindows). */
  onExit?: (msg: string) => void;
}

interface NethackWindow {
  id: number;
  type: WindowType;
  cursor: { x: number; y: number };
}

interface PendingMenuItem extends MenuItem {
  /** Engine-side ANY_P pointer captured at add_menu time. We copy the
   *  bytes back when select_menu resolves. */
  identifierPtr: number;
}

export function registerHandlers(deps: HandlerDeps): void {
  const { module, map, messages, status, menu, prompt, input, onExit } = deps;
  const playerName = deps.playerName ?? "Player";

  const windows = new Map<number, NethackWindow>();
  let nextWinid = 1;

  registerHandler("shim_init_nhwindows", () => {
    map.bindHeap(module);
    messages.replace("Welcome to ModMyNetHack.");
  });

  registerHandler("shim_player_selection_or_tty", () => true);
  registerHandler("shim_askname", () => {});
  registerHandler("shim_get_nh_event", () => {});

  registerHandler("shim_exit_nhwindows", (msg: unknown) => {
    const text = (msg as string) ?? "";
    messages.append(text || "Goodbye.");
    onExit?.(text);
  });

  registerHandler("shim_create_nhwindow", (typeArg: unknown) => {
    const type = typeArg as number as WindowType;
    const id = nextWinid++;
    windows.set(id, { id, type, cursor: { x: 0, y: 0 } });
    return id;
  });

  registerHandler("shim_clear_nhwindow", (winidArg: unknown) => {
    const win = windows.get(winidArg as number);
    if (!win) return;
    switch (win.type) {
      case WindowType.Map:     map.clearAll(); map.flush(); return;
      case WindowType.Message: messages.clear(); return;
      case WindowType.Status:  status.clear(); return;
      default: return;
    }
  });

  registerHandler("shim_destroy_nhwindow", (winidArg: unknown) => {
    windows.delete(winidArg as number);
  });

  registerHandler("shim_display_nhwindow", (winidArg: unknown) => {
    const win = windows.get(winidArg as number);
    if (!win) return;
    if (win.type === WindowType.Map) map.flush();
  });

  registerHandler("shim_curs", (winidArg: unknown, x: unknown, y: unknown) => {
    const win = windows.get(winidArg as number);
    if (!win) return;
    win.cursor.x = x as number;
    win.cursor.y = y as number;
  });

  registerHandler("shim_putstr", (winidArg: unknown, _attr: unknown, str: unknown) => {
    const win = windows.get(winidArg as number);
    const text = (str as string) ?? "";
    if (!win) return;
    switch (win.type) {
      case WindowType.Message: messages.append(text); return;
      case WindowType.Status:  /* status updates flow through shim_status_update */ return;
      case WindowType.Menu:    menuTextLines.push(text); return;
      case WindowType.Text:    pendingTextWindow.push(text); return;
      default: return;
    }
  });

  registerHandler(
    "shim_print_glyph",
    (
      _winid: unknown, x: unknown, y: unknown,
      glyphPtr: unknown, bkglyphPtr: unknown,
    ) => {
      map.putGlyphFromPointer(
        module,
        x as number, y as number,
        glyphPtr as number, bkglyphPtr as number,
      );
    },
  );

  registerHandler("shim_raw_print", (str: unknown) => messages.append((str as string) ?? ""));
  registerHandler("shim_raw_print_bold", (str: unknown) => messages.append((str as string) ?? ""));

  registerHandler("shim_nhgetch", async () => {
    map.flush();
    const ev = await input.next();
    return ev.kind === "key" ? ev.ch : 32;
  });

  registerHandler("shim_nh_poskey", async (xPtr: unknown, yPtr: unknown, modPtr: unknown) => {
    map.flush();
    const ev = await input.next();
    if (ev.kind === "click") {
      module.setValue(xPtr as number, ev.cellX, "i8");
      module.setValue(yPtr as number, ev.cellY, "i8");
      module.setValue(modPtr as number, ev.mod, "i32");
      return 0;
    }
    return ev.ch;
  });

  registerHandler("shim_yn_function", async (query: unknown, resp: unknown, def: unknown) => {
    map.flush();
    return prompt.yn(
      (query as string) ?? "",
      (resp as string) ?? "",
      def as number,
    );
  });

  registerHandler("shim_getlin", async (query: unknown, bufPtr: unknown) => {
    map.flush();
    const q = (query as string) ?? "";
    // Auto-fill the player name on initial askname; user can override
    // via the prompt UI if they care.
    let answer: string;
    if (/who are you|^enter your name/i.test(q)) {
      answer = playerName;
    } else {
      answer = await prompt.getlin(q);
      if (answer === "\x1b") answer = "";
    }
    const bytes = new TextEncoder().encode(answer);
    const ptr = bufPtr as number;
    for (let i = 0; i < bytes.length; i++) module.HEAPU8[ptr + i] = bytes[i]!;
    module.HEAPU8[ptr + bytes.length] = 0;
  });

  registerHandler("shim_get_ext_cmd", () => -1);
  registerHandler("shim_nhbell", () => {});
  registerHandler("shim_mark_synch", () => map.flush());
  registerHandler("shim_wait_synch", () => map.flush());
  registerHandler("shim_delay_output", () => {});
  registerHandler("shim_number_pad", () => {});
  registerHandler("shim_doprev_message", () => 0);

  // Status HUD: per-field updates routed by fldidx
  registerHandler("shim_status_init", () => status.clear());
  registerHandler(
    "shim_status_update",
    (fldidx: unknown, ptr: unknown, _chg: unknown, percent: unknown, _color: unknown) => {
      const str = ptr ? safeUtf8(module, ptr as number) : "";
      status.setField(fldidx as number, str, percent as number);
    },
  );
  registerHandler("shim_update_inventory", () => {});
  registerHandler("shim_preference_update", () => {});

  // Menu state. menuTextLines holds putstr lines that flow into a Text
  // window inside a menu — rare but the engine does it for some help
  // menus. pendingItems is the structured menu being built up.
  let menuTextLines: string[] = [];
  let pendingTextWindow: string[] = [];
  let pendingItems: PendingMenuItem[] = [];
  let menuPrompt = "";
  let menuBehavior = 0;

  registerHandler("shim_start_menu", (_winid: unknown, behavior: unknown) => {
    pendingItems = [];
    menuTextLines = [];
    menuPrompt = "";
    menuBehavior = (behavior as number) ?? 0;
  });

  registerHandler(
    "shim_add_menu",
    (
      _winid: unknown,
      _glyphPtr: unknown,
      identifierPtr: unknown,
      ch: unknown,
      gch: unknown,
      attr: unknown,
      clr: unknown,
      str: unknown,
      itemflags: unknown,
    ) => {
      pendingItems.push({
        identifier: 0,
        identifierSize: ANY_P_SIZE,
        identifierPtr: identifierPtr as number,
        ch: (ch as number) || 0,
        gch: (gch as number) || 0,
        attr: (attr as number) || 0,
        clr: (clr as number) ?? -1,
        text: (str as string) ?? "",
        itemflags: (itemflags as number) ?? 0,
        selected: false,
        count: 0,
      });
    },
  );

  registerHandler("shim_end_menu", (_winid: unknown, p: unknown) => {
    menuPrompt = (p as string) ?? "";
  });

  registerHandler("shim_select_menu", async (_winid: unknown, how: unknown, retArrPtr: unknown) => {
    map.flush();
    const pickHow = ((how as number) ?? 0) as PickHow;

    // Items with ch === 0 are typically header/divider lines — they
    // can't be selected. The MenuController already renders them
    // distinctly, but return value math has to skip them.
    const selectables = pendingItems.filter((i) => i.ch !== 0);
    if (selectables.length === 0) {
      // No interactive items; treat as informational and return 0.
      module.setValue(retArrPtr as number, 0, "i32");
      return 0;
    }

    const result = await menu.open(menuPrompt, pendingItems, pickHow, menuBehavior);
    if (result.cancelled || result.selectedItems.length === 0) {
      module.setValue(retArrPtr as number, 0, "i32");
      return -1;
    }

    // Allocate a MENU_ITEM_P[] in the C heap and write each selected
    // item's identifier (copied from the pointer the engine gave us)
    // plus count (use 0 for "use default count" → 'all of it').
    const n = result.selectedItems.length;
    const buf = module._malloc(n * MENU_ITEM_SIZE);
    for (let i = 0; i < n; i++) {
      const item = result.selectedItems[i] as PendingMenuItem;
      const dst = buf + i * MENU_ITEM_SIZE;
      // Copy ANY_P bytes from the engine's pointer
      if (item.identifierPtr) {
        for (let b = 0; b < ANY_P_SIZE; b++) {
          module.HEAPU8[dst + b] = module.HEAPU8[item.identifierPtr + b]!;
        }
      } else {
        for (let b = 0; b < ANY_P_SIZE; b++) module.HEAPU8[dst + b] = 0;
      }
      // count field (long, 4 bytes) at offset ANY_P_SIZE
      module.setValue(dst + ANY_P_SIZE, item.count | 0, "i32");
    }
    module.setValue(retArrPtr as number, buf, "i32");
    return n;
  });

  registerHandler("shim_message_menu", async (let_: unknown, how: unknown, mesg: unknown) => {
    void let_; void how;
    const text = (mesg as string) ?? "";
    if (text) await prompt.displayText(text);
    return 27;
  });

  registerHandler("shim_display_file", async (name: unknown, _complain: unknown) => {
    void name;
    if (pendingTextWindow.length > 0) {
      await prompt.displayText(pendingTextWindow.join("\n"));
      pendingTextWindow = [];
    }
  });

  registerHandler("shim_get_color_string", () => null);
  registerHandler("shim_getmsghistory", () => null);
  registerHandler("shim_putmsghistory", () => {});
  registerHandler("shim_ctrl_nhwindow", () => 0);
  registerHandler("shim_player_selection", () => {});
  registerHandler("shim_suspend_nhwindows", () => {});
  registerHandler("shim_resume_nhwindows", () => {});
  registerHandler("shim_cliparound", () => {});
  registerHandler("shim_update_positionbar", () => {});
  registerHandler("shim_change_color", () => {});
  registerHandler("shim_change_background", () => {});
}

// Back-compat: the Phase 1 main.ts called this name. Re-export.
export const registerPhase1Handlers = registerHandlers;

function safeUtf8(module: EmscriptenModule, ptr: number): string {
  if (ptr === 0) return "";
  try {
    return module.UTF8ToString(ptr, 256);
  } catch {
    return "";
  }
}
