// Level metadata: dungeon branch, depth, and per-branch visual hints.
// Phase 5B uses this to pick:
//   • the right ambient color grade (cool blue, warm gold, sickly red)
//   • the right ambient bed (Phase 5E)
//   • the right outdoor weather (rain on plains, ash on Gehennom, etc.)
//   • the right tile theme variants for walls (main / mines / sokoban / ...)
//
// The canonical NetHack dungeon graph is in `dat/dungeon.lua`; we mirror
// the coarse branches here. Once the EM_JS engine state export lands
// the runtime branch+depth pour through nethackGlobal.engine.{branch,depth}.

export enum DungeonBranch {
  Main = "main",
  Mines = "mines",
  Sokoban = "sokoban",
  Quest = "quest",
  Gehennom = "gehennom",
  EndGame = "endgame",
  PlanesEarth = "planes-earth",
  PlanesAir = "planes-air",
  PlanesFire = "planes-fire",
  PlanesWater = "planes-water",
  Astral = "astral",
  Unknown = "unknown",
}

export interface LevelStyle {
  /** RGB color multiplier applied to the entire scene as a coarse grade. */
  colorGrade: [number, number, number];
  /** 0 = no vignette darkening, 1 = heavy. */
  vignetteIntensity: number;
  /** 0 = no ambient bloom, 1 = lots. */
  bloomIntensity: number;
  /** Outdoor levels get weather + day/night cycle. */
  outdoor: boolean;
  /** Theme key used by the wall/floor variant picker. */
  theme: "stone" | "mines" | "sokoban" | "knox" | "gehennom" | "ice" | "etheric" | "garden";
  /** Ambient bed key (Phase 5E lookup). */
  ambientBed: string;
}

export const STYLE_BY_BRANCH: Record<DungeonBranch, LevelStyle> = {
  [DungeonBranch.Main]: {
    colorGrade: [0.9, 0.95, 1.05],
    vignetteIntensity: 0.4,
    bloomIntensity: 0.5,
    outdoor: false,
    theme: "stone",
    ambientBed: "dungeon-hum",
  },
  [DungeonBranch.Mines]: {
    colorGrade: [1.05, 0.95, 0.75],
    vignetteIntensity: 0.5,
    bloomIntensity: 0.6,
    outdoor: false,
    theme: "mines",
    ambientBed: "cave-drip",
  },
  [DungeonBranch.Sokoban]: {
    colorGrade: [0.85, 0.92, 1.0],
    vignetteIntensity: 0.45,
    bloomIntensity: 0.3,
    outdoor: false,
    theme: "sokoban",
    ambientBed: "sokoban",
  },
  [DungeonBranch.Quest]: {
    colorGrade: [0.95, 0.95, 1.1],
    vignetteIntensity: 0.5,
    bloomIntensity: 0.7,
    outdoor: false,
    theme: "stone",
    ambientBed: "eldritch-hum",
  },
  [DungeonBranch.Gehennom]: {
    colorGrade: [1.15, 0.7, 0.65],
    vignetteIntensity: 0.6,
    bloomIntensity: 0.85,
    outdoor: false,
    theme: "gehennom",
    ambientBed: "brimstone-wind",
  },
  [DungeonBranch.EndGame]: {
    colorGrade: [1.0, 1.0, 1.1],
    vignetteIntensity: 0.3,
    bloomIntensity: 0.7,
    outdoor: true,
    theme: "etheric",
    ambientBed: "cosmic",
  },
  [DungeonBranch.PlanesEarth]: {
    colorGrade: [1.05, 0.95, 0.8],
    vignetteIntensity: 0.4,
    bloomIntensity: 0.5,
    outdoor: true,
    theme: "stone",
    ambientBed: "cave-drip",
  },
  [DungeonBranch.PlanesAir]: {
    colorGrade: [0.95, 1.0, 1.1],
    vignetteIntensity: 0.2,
    bloomIntensity: 0.7,
    outdoor: true,
    theme: "etheric",
    ambientBed: "water-plane",
  },
  [DungeonBranch.PlanesFire]: {
    colorGrade: [1.2, 0.7, 0.5],
    vignetteIntensity: 0.55,
    bloomIntensity: 0.95,
    outdoor: true,
    theme: "gehennom",
    ambientBed: "crackling-fire",
  },
  [DungeonBranch.PlanesWater]: {
    colorGrade: [0.85, 0.95, 1.15],
    vignetteIntensity: 0.35,
    bloomIntensity: 0.6,
    outdoor: true,
    theme: "etheric",
    ambientBed: "water-plane",
  },
  [DungeonBranch.Astral]: {
    colorGrade: [1.05, 0.95, 1.2],
    vignetteIntensity: 0.25,
    bloomIntensity: 0.95,
    outdoor: true,
    theme: "etheric",
    ambientBed: "cosmic",
  },
  [DungeonBranch.Unknown]: {
    colorGrade: [1.0, 1.0, 1.0],
    vignetteIntensity: 0.4,
    bloomIntensity: 0.5,
    outdoor: false,
    theme: "stone",
    ambientBed: "dungeon-hum",
  },
};

/** Heuristic branch detection from a level name string. The engine
 *  exposes the level name in dumplog; once the EM_JS state export lands
 *  we'll use the structured branch ID directly. Until then this is
 *  what we have. */
export function classifyLevel(name: string): DungeonBranch {
  const n = name.toLowerCase();
  if (n.includes("astral")) return DungeonBranch.Astral;
  if (n.includes("plane of air"))   return DungeonBranch.PlanesAir;
  if (n.includes("plane of fire"))  return DungeonBranch.PlanesFire;
  if (n.includes("plane of water")) return DungeonBranch.PlanesWater;
  if (n.includes("plane of earth")) return DungeonBranch.PlanesEarth;
  if (n.includes("gehennom") || n.includes("baalzebub") || n.includes("asmodeus") || n.includes("juiblex")) return DungeonBranch.Gehennom;
  if (n.includes("sokoban")) return DungeonBranch.Sokoban;
  if (n.includes("mine")) return DungeonBranch.Mines;
  if (n.includes("quest")) return DungeonBranch.Quest;
  if (n.includes("dungeon")) return DungeonBranch.Main;
  return DungeonBranch.Unknown;
}
