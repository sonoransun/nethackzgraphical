import { describe, it, expect } from "vitest";
import { InputQueue, keyEventToCh } from "../keyboard";

function fakeKey(opts: Partial<KeyboardEventInit & { key: string }>): KeyboardEvent {
  // Minimal stub; we don't go through the DOM in unit tests.
  return new KeyboardEvent("keydown", { key: "a", ...opts });
}

describe("keyEventToCh", () => {
  it("returns ASCII codes for plain keys", () => {
    expect(keyEventToCh(fakeKey({ key: "h" }))).toBe(0x68);
    expect(keyEventToCh(fakeKey({ key: "Y" }))).toBe(0x59);
    expect(keyEventToCh(fakeKey({ key: "1" }))).toBe(0x31);
  });

  it("maps named keys to control codes", () => {
    expect(keyEventToCh(fakeKey({ key: "Enter" }))).toBe(13);
    expect(keyEventToCh(fakeKey({ key: "Escape" }))).toBe(27);
    expect(keyEventToCh(fakeKey({ key: "Tab" }))).toBe(9);
    expect(keyEventToCh(fakeKey({ key: " " }))).toBe(32);
    expect(keyEventToCh(fakeKey({ key: "Backspace" }))).toBe(8);
  });

  it("translates arrow keys to vi keys (lowercase)", () => {
    expect(keyEventToCh(fakeKey({ key: "ArrowLeft" }))).toBe("h".charCodeAt(0));
    expect(keyEventToCh(fakeKey({ key: "ArrowDown" }))).toBe("j".charCodeAt(0));
    expect(keyEventToCh(fakeKey({ key: "ArrowUp" }))).toBe("k".charCodeAt(0));
    expect(keyEventToCh(fakeKey({ key: "ArrowRight" }))).toBe("l".charCodeAt(0));
  });

  it("translates shifted arrows to uppercase (run command)", () => {
    expect(keyEventToCh(fakeKey({ key: "ArrowRight", shiftKey: true })))
      .toBe("L".charCodeAt(0));
  });

  it("ctrl+letter becomes a control code", () => {
    expect(keyEventToCh(fakeKey({ key: "d", ctrlKey: true }))).toBe(4);
    expect(keyEventToCh(fakeKey({ key: "a", ctrlKey: true }))).toBe(1);
  });

  it("ignores modifier-only events", () => {
    expect(keyEventToCh(fakeKey({ key: "Shift" }))).toBeNull();
    expect(keyEventToCh(fakeKey({ key: "Control" }))).toBeNull();
  });
});

describe("InputQueue", () => {
  it("delivers queued events on next() call", async () => {
    const q = new InputQueue();
    q.push({ kind: "key", ch: 65 });
    q.push({ kind: "key", ch: 66 });
    expect((await q.next()) as { ch: number }).toEqual({ kind: "key", ch: 65 });
    expect((await q.next()) as { ch: number }).toEqual({ kind: "key", ch: 66 });
  });

  it("resolves a pending next() when an event is pushed", async () => {
    const q = new InputQueue();
    const pending = q.next();
    q.push({ kind: "click", cellX: 5, cellY: 7, mod: 1 });
    const ev = await pending;
    expect(ev.kind).toBe("click");
    if (ev.kind === "click") {
      expect(ev.cellX).toBe(5);
      expect(ev.cellY).toBe(7);
    }
  });

  it("drain clears pending queue but not waiters", async () => {
    const q = new InputQueue();
    q.push({ kind: "key", ch: 1 });
    q.push({ kind: "key", ch: 2 });
    q.drain();
    expect(q.size()).toBe(0);
  });
});
