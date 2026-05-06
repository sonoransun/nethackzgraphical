import { describe, it, expect } from "vitest";
import { classifyLevel, DungeonBranch, STYLE_BY_BRANCH } from "../level-meta";

describe("classifyLevel", () => {
  it("identifies major branches", () => {
    expect(classifyLevel("Astral Plane")).toBe(DungeonBranch.Astral);
    expect(classifyLevel("Plane of Air")).toBe(DungeonBranch.PlanesAir);
    expect(classifyLevel("Plane of Fire")).toBe(DungeonBranch.PlanesFire);
    expect(classifyLevel("Plane of Water")).toBe(DungeonBranch.PlanesWater);
    expect(classifyLevel("Plane of Earth")).toBe(DungeonBranch.PlanesEarth);
    expect(classifyLevel("Gehennom Lvl 1")).toBe(DungeonBranch.Gehennom);
    expect(classifyLevel("Sokoban")).toBe(DungeonBranch.Sokoban);
    expect(classifyLevel("Mines Town")).toBe(DungeonBranch.Mines);
    expect(classifyLevel("Quest Home")).toBe(DungeonBranch.Quest);
    expect(classifyLevel("Dungeons of Doom Level 4")).toBe(DungeonBranch.Main);
  });

  it("falls through to Unknown", () => {
    expect(classifyLevel("Limbo")).toBe(DungeonBranch.Unknown);
  });
});

describe("STYLE_BY_BRANCH", () => {
  it("provides every DungeonBranch value", () => {
    for (const v of Object.values(DungeonBranch)) {
      expect(STYLE_BY_BRANCH[v]).toBeTruthy();
    }
  });

  it("has unique ambient bed keys per major branch", () => {
    expect(STYLE_BY_BRANCH[DungeonBranch.Mines].ambientBed).not.toBe(
      STYLE_BY_BRANCH[DungeonBranch.Gehennom].ambientBed,
    );
  });
});
