/**
 * Small maths helpers and brand colours shared by the scene modules.
 */

export const BG = 0x0e1013; // brand near-black (--bg)
export const ACCENT = 0xc8873e; // brand amber (--accent) — practicals only
export const KEY_COLOR = 0xfff1e2; // warm key
export const RIM_COLOR = 0xc6d4e8; // cool rim
export const LED_COLOR = 0xeef3fb; // machine LED work light (cool white)

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const norm = (v, a, b) => clamp01((v - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Bell curve: 0 outside [a, d], 1 on [b, c], smooth ramps between. */
export const window4 = (v, a, b, c, d) => smooth(norm(v, a, b)) * (1 - smooth(norm(v, c, d)));
/** Frame-rate independent exponential smoothing factor. */
export const dampK = (lambda, dt) => 1 - Math.exp(-lambda * dt);

/** Deterministic PRNG (mulberry32) so procedural detail is identical on every visit. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isTouchDevice = () =>
  window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
