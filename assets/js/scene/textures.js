/**
 * Procedural surface textures (generated once at load, no downloads):
 *   feed marks   — concentric micro-grooves left by the turning tool (normal + roughness)
 *   mill scale   — hot-rolled bar: dark blue-grey, rough, slightly flaky (albedo + ORM + normal)
 *   paint        — powder-coat orange peel (normal)
 *   brushed      — linear brushed stainless (normal + roughness)
 *   granite      — black surface-plate granite (albedo + roughness)
 *   concrete     — workshop floor (albedo + roughness)
 * All are tileable. ORM textures follow three.js conventions: G = roughness, B = metalness.
 */
import * as THREE from 'three';
import { rng } from './util.js';

/* ---------- periodic gradient noise ---------- */
function makeNoise(seed) {
  const r = rng(seed);
  const perm = new Uint16Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  /** Gradient noise in [-1, 1] that repeats every (px, py) lattice cells. */
  return function noise(x, y, px = 256, py = 256) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const h = (ix, iy) => perm[perm[ix & 255] + (iy & 255)];
    const d = (hh, dx, dy) => gx[hh] * dx + gy[hh] * dy;
    const u = fade(xf);
    const v = fade(yf);
    const a = d(h(x0, y0), xf, yf);
    const b = d(h(x1, y0), xf - 1, yf);
    const c = d(h(x0, y1), xf, yf - 1);
    const e = d(h(x1, y1), xf - 1, yf - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v) * 1.41;
  };
}

function fbm(noise, x, y, period, octaves, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, period * f, period * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Periodic Worley noise: returns [F1, F2, cellId] for point (x, y) in cell units. */
function makeWorley(seed, cells) {
  const r = rng(seed);
  const pts = new Float32Array(cells * cells * 3);
  for (let i = 0; i < cells * cells; i++) {
    pts[i * 3] = r();
    pts[i * 3 + 1] = r();
    pts[i * 3 + 2] = r();
  }
  return function worley(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i;
        const cy = yi + j;
        const k = ((((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)) * 3;
        const dx = cx + pts[k] - x;
        const dy = cy + pts[k + 1] - y;
        const dd = dx * dx + dy * dy;
        if (dd < f1) {
          f2 = f1;
          f1 = dd;
          id = pts[k + 2];
        } else if (dd < f2) f2 = dd;
      }
    }
    return [Math.sqrt(f1), Math.sqrt(f2), id];
  };
}

/* ---------- texture helpers ---------- */
let maxAniso = 8;
export function setMaxAnisotropy(v) {
  maxAniso = Math.max(1, Math.min(16, v || 1));
}

function dataTexture(data, w, h, { srgb = false } = {}) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = maxAniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Height field (Float32, wraps) → tangent-space normal map. */
function heightToNormal(hf, w, h, strength) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (hf[y * w + xp] - hf[y * w + xm]) * strength;
      const dy = (hf[yp + x] - hf[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/* ---------- feed marks (turned surface) ---------- */
export const FEED_GROOVES = 40; // grooves per texture tile (along v)

export function feedMarks(size = 1024, seed = 7) {
  const w = Math.max(64, size >> 3);
  const h = size;
  const noise = makeNoise(seed);
  const hf = new Float32Array(w * h);
  const rough = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    const g = v * FEED_GROOVES;
    const t = g - Math.floor(g);
    const grooveAmp = 0.85 + 0.3 * noise(Math.floor(g) * 0.37, 3.1, 256, 256);
    // Scallop profile left by the tool nose radius: cusps between passes.
    const scallop = (t - 0.5) * (t - 0.5) * 4 * grooveAmp;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const chatter = 0.12 * noise(u * 16, v * FEED_GROOVES * 0.5, 16, FEED_GROOVES / 2);
      const wave = 0.25 * noise(u * 4, v * 4, 4, 4);
      hf[y * w + x] = scallop + chatter + wave * 0.2;
      const rv = 0.5 + 0.18 * noise(u * 6, v * 6, 6, 6) + 0.08 * (scallop - 0.33);
      const i = (y * w + x) * 4;
      rough[i] = 255;
      rough[i + 1] = byte(rv);
      rough[i + 2] = 255;
      rough[i + 3] = 255;
    }
  }
  const normal = dataTexture(heightToNormal(hf, w, h, 2.2), w, h);
  const roughness = dataTexture(rough, w, h);
  return { normal, roughness };
}

/* ---------- mill scale (raw hot-rolled bar) ---------- */
/**
 * Hot-rolled bar: dark blue-grey oxide with soft mottling, faint rolling streaks along
 * the bar (texture v), a fine grain, and a few irregular patches where the scale has
 * flaked off (slightly lighter, smoother, more metallic).
 */
export function millScale(size = 512, seed = 11) {
  const n = size;
  const noise = makeNoise(seed);
  const worley = makeWorley(seed + 1, 5);
  const hf = new Float32Array(n * n);
  const albedo = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      const broad = fbm(noise, u * 3, v * 3, 3, 4);
      const grain = fbm(noise, u * 48, v * 48, 48, 3);
      const streak = noise(u * 96, v * 3, 96, 3) * 0.6 + noise(u * 40, v * 1, 40, 1) * 0.4; // along the bar
      // irregular flaked patches: warped Worley thresholded by broad noise
      const wu = u * 5 + 0.35 * noise(u * 6 + 3, v * 6, 6, 6);
      const wv = v * 5 + 0.35 * noise(u * 6, v * 6 + 7, 6, 6);
      const [f1, f2, id] = worley(wu, wv);
      const edge = Math.min(1, (f2 - f1) * 6);
      const flake = id > 0.78 && broad > 0.0 ? Math.min(1, (broad - 0.0) * 6) * Math.min(1, edge * 3) : 0;
      hf[y * n + x] = grain * 0.18 + streak * 0.12 + broad * 0.2 - flake * 0.14;

      const i = (y * n + x) * 4;
      const tone = 0.15 + broad * 0.03 + grain * 0.012 + streak * 0.012;
      const t = tone + flake * 0.025;
      albedo[i] = byte(t * 0.94);
      albedo[i + 1] = byte(t * 1.0);
      albedo[i + 2] = byte(t * 1.1);
      albedo[i + 3] = 255;
      orm[i] = 255;
      orm[i + 1] = byte(0.66 + grain * 0.1 + streak * 0.04 - flake * 0.2);
      orm[i + 2] = byte(0.45 + broad * 0.06 + flake * 0.2);
      orm[i + 3] = 255;
    }
  }
  return {
    albedo: dataTexture(albedo, n, n, { srgb: true }),
    orm: dataTexture(orm, n, n),
    normal: dataTexture(heightToNormal(hf, n, n, 2.2), n, n),
  };
}

/* ---------- powder-coat paint ---------- */
export function paintPeel(size = 256, seed = 21) {
  const n = size;
  const noise = makeNoise(seed);
  const hf = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) hf[y * n + x] = fbm(noise, (x / n) * 24, (y / n) * 24, 24, 3, 0.55);
  return dataTexture(heightToNormal(hf, n, n, 1.4), n, n);
}

/* ---------- brushed stainless ---------- */
export function brushed(size = 512, seed = 31) {
  const n = size;
  const noise = makeNoise(seed);
  const hf = new Float32Array(n * n);
  const rough = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      // long streaks along u, fine variation across v
      const s = noise(u * 2, v * 384, 2, 384) * 0.6 + noise(u * 6, v * 96, 6, 96) * 0.4;
      hf[y * n + x] = s;
      const i = (y * n + x) * 4;
      rough[i] = 255;
      rough[i + 1] = byte(0.55 + 0.25 * fbm(noise, u * 3, v * 3, 3, 3));
      rough[i + 2] = 255;
      rough[i + 3] = 255;
    }
  }
  return { normal: dataTexture(heightToNormal(hf, n, n, 0.9), n, n), roughness: dataTexture(rough, n, n) };
}

/* ---------- black granite ---------- */
export function granite(size = 512, seed = 41) {
  const n = size;
  const noise = makeNoise(seed);
  const r = rng(seed);
  const albedo = new Uint8Array(n * n * 4);
  const rough = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      const speck = noise(u * 160, v * 160, 160, 160);
      const cloud = fbm(noise, u * 6, v * 6, 6, 4);
      let t = 0.035 + cloud * 0.01;
      if (speck > 0.55) t = 0.11 + (speck - 0.55) * 0.3;
      if (speck < -0.72 && r() > 0.5) t = 0.3;
      const i = (y * n + x) * 4;
      albedo[i] = byte(t);
      albedo[i + 1] = byte(t * 1.02);
      albedo[i + 2] = byte(t * 1.06);
      albedo[i + 3] = 255;
      rough[i] = 255;
      rough[i + 1] = byte(0.2 + cloud * 0.04 + (speck > 0.55 ? 0.08 : 0));
      rough[i + 2] = 0;
      rough[i + 3] = 255;
    }
  }
  return { albedo: dataTexture(albedo, n, n, { srgb: true }), roughness: dataTexture(rough, n, n) };
}

/* ---------- concrete floor ---------- */
export function concrete(size = 512, seed = 51) {
  const n = size;
  const noise = makeNoise(seed);
  const albedo = new Uint8Array(n * n * 4);
  const rough = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      const a = fbm(noise, u * 5, v * 5, 5, 5);
      const fine = noise(u * 96, v * 96, 96, 96);
      const stain = Math.max(0, fbm(noise, u * 2 + 9, v * 2 + 3, 2, 3) - 0.15);
      const t = 0.2 + a * 0.035 + fine * 0.012 - stain * 0.08;
      const i = (y * n + x) * 4;
      albedo[i] = byte(t);
      albedo[i + 1] = byte(t * 0.99);
      albedo[i + 2] = byte(t * 0.97);
      albedo[i + 3] = 255;
      rough[i] = 255;
      rough[i + 1] = byte(0.78 + a * 0.1 - stain * 0.35);
      rough[i + 2] = 0;
      rough[i + 3] = 255;
    }
  }
  return { albedo: dataTexture(albedo, n, n, { srgb: true }), roughness: dataTexture(rough, n, n) };
}

/** Soft radial gradient used for contact-shadow decals and mist sprites. */
export function radialSprite(size = 64, inner = 0, falloff = 1.6) {
  const n = size;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = d < inner ? 1 : Math.pow(1 - (d - inner) / (1 - inner), falloff);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = byte(a);
    }
  }
  const tex = dataTexture(data, n, n);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Scrolling streak texture for the coolant stream (alpha in G, used as alphaMap). */
export function coolantStreaks(seed = 61) {
  const w = 64;
  const h = 256;
  const noise = makeNoise(seed);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const s = 0.62 + 0.3 * noise(u * 8, v * 3, 8, 3) + 0.18 * noise(u * 24, v * 10, 24, 10);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = byte(s);
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, w, h);
}
