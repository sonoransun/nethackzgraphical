// Tile atlas loader. The manifest schema is fixed early (Phase 2) to
// accommodate animation frames so Phase 3 / 5A don't have to migrate it.
//
// {
//   "tileSize": 16,
//   "tiles": {
//     "0":   { "frames": [[0, 0, 16, 16]],          "fps": 0,  "loops": false },
//     "42":  { "frames": [[16, 0, 16, 16], [32, 0, 16, 16]], "fps": 4, "loops": true },
//     ...
//   }
// }
//
// `tileidx` keys into `tiles`. Phase 2 ships every entry as a single frame.
// Phase 3+ adds idle/walk/attack frames per monster.

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileEntry {
  frames: FrameRect[];
  fps: number;
  loops: boolean;
}

export interface TileManifest {
  tileSize: number;
  imageWidth: number;
  imageHeight: number;
  tiles: Record<string, TileEntry>;
}

export interface LoadedAtlas {
  manifest: TileManifest;
  image: HTMLImageElement;
}

export async function loadAtlas(
  imageUrl: string,
  manifestUrl: string,
): Promise<LoadedAtlas | null> {
  try {
    const [manifestResp, image] = await Promise.all([
      fetch(manifestUrl),
      loadImage(imageUrl),
    ]);
    if (!manifestResp.ok) {
      console.warn(`atlas: manifest ${manifestUrl} not available (${manifestResp.status}); ASCII fallback only`);
      return null;
    }
    const manifest = (await manifestResp.json()) as TileManifest;
    return { manifest, image };
  } catch (err) {
    console.warn(`atlas: load failed for ${imageUrl}; ASCII fallback only:`, err);
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

/** Pick the frame to display at time `tMs` for a tile entry. Static
 *  tiles always return frames[0]; animated tiles cycle. */
export function frameAt(entry: TileEntry, tMs: number, phaseSeed = 0): FrameRect {
  if (entry.frames.length <= 1 || entry.fps <= 0) return entry.frames[0]!;
  const periodMs = 1000 / entry.fps;
  const cycle = entry.frames.length;
  const offset = phaseSeed % cycle;
  const i = entry.loops
    ? (Math.floor(tMs / periodMs) + offset) % cycle
    : Math.min(cycle - 1, Math.floor(tMs / periodMs));
  return entry.frames[i]!;
}
