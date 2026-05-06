// Reduced-motion plumbing. Sets a global flag derived from
// (a) prefers-reduced-motion media query, OR (b) explicit user setting.
// Other modules (camera shake, particles, status flourishes, screens)
// query reducedMotion() to decide whether to omit the effect.

let userOverride: boolean | null = null;
const listeners: Array<(active: boolean) => void> = [];

const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
mq?.addEventListener("change", () => emit());

function emit(): void {
  const active = reducedMotion();
  for (const fn of listeners) fn(active);
}

export function reducedMotion(): boolean {
  if (userOverride !== null) return userOverride;
  return mq?.matches ?? false;
}

export function setReducedMotionOverride(value: boolean | null): void {
  userOverride = value;
  // Tag <html> so CSS can react (e.g. our keyframes-disable rules).
  if (value === true) document.documentElement.setAttribute("data-reduced-motion", "true");
  else if (value === false) document.documentElement.setAttribute("data-reduced-motion", "false");
  else document.documentElement.removeAttribute("data-reduced-motion");
  emit();
}

export function onReducedMotionChange(fn: (active: boolean) => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
