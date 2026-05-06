// Color-blind palette presets. Applied as a CSS filter on #app so all
// rendered content (canvas, DOM, screens) goes through the same LUT.
// Matrices are simulation transforms (Brettel/Vienot/Mollon for the
// most common forms of color vision deficiency).
//
// We could apply this in the post-process shader instead — that would
// be more accurate for the canvas but wouldn't catch HTML overlays.
// CSS filter applies uniformly; trade-off is a small composition cost.

export type ColorBlindPreset = "none" | "deuteranopia" | "protanopia" | "tritanopia";

const SVG_FILTER_ID = "colorblind-filter";

// Daltonization matrices, sRGB linear approximation
const MATRICES: Record<Exclude<ColorBlindPreset, "none">, number[]> = {
  // 4x5 matrices: r = m[0]*R + m[1]*G + m[2]*B + m[3]*A + m[4]
  deuteranopia: [
    0.625, 0.375, 0.0,   0, 0,
    0.7,   0.3,   0.0,   0, 0,
    0.0,   0.3,   0.7,   0, 0,
    0,     0,     0,     1, 0,
  ],
  protanopia: [
    0.567, 0.433, 0.0,   0, 0,
    0.558, 0.442, 0.0,   0, 0,
    0.0,   0.242, 0.758, 0, 0,
    0,     0,     0,     1, 0,
  ],
  tritanopia: [
    0.95,  0.05,  0.0,   0, 0,
    0.0,   0.433, 0.567, 0, 0,
    0.0,   0.475, 0.525, 0, 0,
    0,     0,     0,     1, 0,
  ],
};

function ensureFilter(): SVGSVGElement {
  let svg = document.getElementById(SVG_FILTER_ID) as unknown as SVGSVGElement | null;
  if (svg) return svg;
  const ns = "http://www.w3.org/2000/svg";
  svg = document.createElementNS(ns, "svg") as SVGSVGElement;
  svg.setAttribute("id", SVG_FILTER_ID);
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("style", "position:absolute;width:0;height:0;");
  document.body.appendChild(svg);

  for (const [key, m] of Object.entries(MATRICES)) {
    const filter = document.createElementNS(ns, "filter");
    filter.setAttribute("id", `cb-${key}`);
    const cm = document.createElementNS(ns, "feColorMatrix");
    cm.setAttribute("type", "matrix");
    cm.setAttribute("values", m.join(" "));
    filter.appendChild(cm);
    svg.appendChild(filter);
  }
  return svg;
}

export function applyColorBlindPreset(preset: ColorBlindPreset): void {
  ensureFilter();
  const root = document.getElementById("app");
  if (!root) return;
  if (preset === "none") {
    root.style.filter = root.style.filter
      .split(" ")
      .filter((p) => !p.startsWith("url("))
      .join(" ");
  } else {
    const existing = root.style.filter
      .split(" ")
      .filter((p) => p && !p.startsWith("url("))
      .join(" ");
    root.style.filter = `${existing} url(#cb-${preset})`.trim();
  }
}
