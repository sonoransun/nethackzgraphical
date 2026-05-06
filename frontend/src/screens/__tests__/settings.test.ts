import { describe, it, expect, beforeEach, vi } from "vitest";
import { Settings, DEFAULT_SETTINGS } from "../settings";

describe("Settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults on first run", () => {
    const s = new Settings();
    expect(s.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists to localStorage on set", () => {
    const s = new Settings();
    s.set("crtEnabled", true);
    s.set("audioMaster", 0.42);
    const s2 = new Settings();
    expect(s2.get("crtEnabled")).toBe(true);
    expect(s2.get("audioMaster")).toBe(0.42);
  });

  it("notifies listeners on change", () => {
    const s = new Settings();
    const fn = vi.fn();
    s.on(fn);
    s.set("vignetteIntensity", 0.7);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]![0].vignetteIntensity).toBe(0.7);
  });

  it("reset restores defaults", () => {
    const s = new Settings();
    s.set("crtEnabled", true);
    s.reset();
    expect(s.get("crtEnabled")).toBe(false);
  });

  it("survives malformed localStorage gracefully", () => {
    localStorage.setItem("modmynethack:settings:v1", "{ not valid json");
    const s = new Settings();
    expect(s.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});
