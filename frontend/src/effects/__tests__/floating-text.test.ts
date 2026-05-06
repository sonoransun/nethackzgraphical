import { describe, it, expect } from "vitest";
import { parseCombatMessage } from "../floating-text";

describe("parseCombatMessage", () => {
  it("parses 'you hit X for N damage' style", () => {
    const r = parseCombatMessage("You hit the orc for 7 damage.");
    expect(r).toEqual({ kind: "damage", amount: 7 });
  });

  it("parses '(N pts.)' damage taken", () => {
    const r = parseCombatMessage("The orc bites you (5 pts.).");
    expect(r).toEqual({ kind: "damage-self", amount: 5 });
  });

  it("recognises level-up messages", () => {
    const r = parseCombatMessage("Welcome to experience level 7.");
    expect(r?.kind).toBe("levelup");
  });

  it("recognises healing messages", () => {
    const r = parseCombatMessage("You feel better.");
    expect(r?.kind).toBe("heal");
  });

  it("returns null for unrelated messages", () => {
    expect(parseCombatMessage("You see here a scroll.")).toBeNull();
    expect(parseCombatMessage("")).toBeNull();
  });
});
