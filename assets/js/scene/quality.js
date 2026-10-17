/**
 * Quality tiers + adaptive resolution.
 *
 *   high    full scene, MSAA + SMAA, full-res AO, depth of field, bloom, 2k HDRI, max chips, DPR ≤ 2
 *   medium  full scene, SMAA, half-res AO, bloom, 1k HDRI, fewer chips, DPR ≤ 1.5
 *   low     no real-time 3D: scroll-scrubbed pre-rendered video of the same story
 *   static  reduced motion / no WebGL: one high-resolution still per stage, cross-faded
 *
 * Force a tier for testing with ?tier=high | medium | low | static
 */
import { isTouchDevice } from './util.js';

export const TIERS = {
  high: {
    name: 'high', realtime: true, maxDpr: 2, minDpr: 1, msaa: 4, smaa: true, ao: 'full', dof: true,
    bloom: true, grain: true, hdri: '2k', shadowMap: 2048, softShadows: true, areaLight: true,
    chipScale: 1, mistScale: 1, radialSegments: 160, texSize: 1024, minFps: 45,
  },
  medium: {
    name: 'medium', realtime: true, maxDpr: 1.5, minDpr: 1, msaa: 0, smaa: true, ao: 'half', dof: false,
    bloom: true, grain: false, hdri: '1k', shadowMap: 1024, softShadows: false, areaLight: false,
    chipScale: 0.45, mistScale: 0.5, radialSegments: 96, texSize: 512, minFps: 28,
  },
  low: { name: 'low', realtime: false, video: true },
  static: { name: 'static', realtime: false, stills: true },
};

const ORDER = ['static', 'low', 'medium', 'high'];
const atMost = (name, cap) => (ORDER.indexOf(name) > ORDER.indexOf(cap) ? cap : name);

export function webglInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || c.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info = {
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '',
      maxSamples: gl.MAX_SAMPLES ? gl.getParameter(gl.MAX_SAMPLES) : 0,
    };
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return info;
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/**
 * Picks the tier for this visitor. Never throws; worst case returns a safe guess.
 * @returns {Promise<{tier: object, mobile: boolean, gpu: object|null, gl: object|null}>}
 */
export async function detectTier({ reduceMotion = false } = {}) {
  const params = new URLSearchParams(location.search);
  const forced = params.get('tier');
  const gl = webglInfo();
  const mobile = isTouchDevice();

  if (forced && TIERS[forced]) {
    const tier = { ...TIERS[forced] };
    // Testing overrides, e.g. ?tier=high&ao=0&dof=0&msaa=0&bloom=0&smaa=0
    for (const k of ['ao', 'dof', 'msaa', 'bloom', 'smaa', 'grain', 'areaLight', 'softShadows']) {
      if (params.get(k) === '0') tier[k] = k === 'msaa' ? 0 : k === 'ao' ? null : false;
    }
    if (tier.realtime && !gl) return { tier: TIERS.static, mobile, gpu: null, gl };
    return { tier: adjustForDevice(tier, mobile, gl), mobile, gpu: null, gl };
  }
  if (reduceMotion || !gl) return { tier: TIERS.static, mobile, gpu: null, gl };

  const conn = navigator.connection || {};
  if (conn.saveData) return { tier: TIERS.low, mobile, gpu: null, gl };

  let gpu = null;
  try {
    const { getGPUTier } = await import('detect-gpu');
    gpu = await withTimeout(
      getGPUTier({ benchmarksURL: 'https://unpkg.com/detect-gpu@5.0.70/dist/benchmarks', failIfMajorPerformanceCaveat: true }),
      2500
    );
  } catch {
    gpu = null; // offline or blocked: fall back to device heuristics below
  }

  const isMobile = gpu ? Boolean(gpu.isMobile) : mobile;
  let name;
  if (!gpu) name = isMobile ? 'medium' : 'high';
  else if (gpu.tier >= 3) name = isMobile ? 'medium' : 'high';
  else if (gpu.tier === 2) name = 'medium';
  else name = 'low'; // tier 0 (blocklisted / software) and tier 1 (< 30 fps)

  // Device checks
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (mem <= 2 || cores <= 2) name = atMost(name, 'low');
  else if (isMobile && mem < 4) name = atMost(name, 'medium');
  if (/SwiftShader|llvmpipe|Software/i.test(gl.renderer)) name = atMost(name, 'low');

  return { tier: adjustForDevice({ ...TIERS[name] }, isMobile, gl), mobile: isMobile, gpu, gl };
}

function adjustForDevice(tier, mobile, gl) {
  if (!tier.realtime) return tier;
  if (mobile) {
    tier.shadowMap = 1024;
    tier.hdri = '1k';
    tier.texSize = Math.min(tier.texSize, 512);
  }
  if (gl && (!gl.webgl2 || gl.maxSamples < 4)) tier.msaa = 0;
  return tier;
}

/**
 * Adaptive resolution: watches frame time and steps the render scale down
 * (2 → 1.75 → 1.5 → 1.25 → 1) when the average drops below ~50 fps, and back
 * up when there is headroom again. Hysteresis stops it oscillating.
 */
export class AdaptiveResolution {
  /**
   * @param {object} o
   * @param {number} o.max  highest render scale (device pixel ratio cap)
   * @param {number} o.min  lowest render scale
   * @param {function} o.onChange  new scale
   * @param {number} [o.floorFps]  if fps stays below this at the lowest scale…
   * @param {function} [o.onFloor] …this is called (degrade features / change tier)
   */
  constructor({ max, min = 1, onChange, floorFps = 0, onFloor }) {
    this.floorFps = floorFps;
    this.onFloor = onFloor;
    this.floorWindows = 0;
    const dpr = window.devicePixelRatio || 1;
    const cap = Math.min(max, Math.max(1, dpr));
    this.steps = [2, 1.75, 1.5, 1.25, 1, 0.85].filter((s) => s <= cap + 1e-3 && s >= min - 1e-3);
    if (!this.steps.length) this.steps = [Math.max(min, Math.min(cap, 1))];
    this.level = 0;
    this.onChange = onChange;
    this.reset();
    this.blockedUntil = new Map(); // level → time before which we won't climb back to it
  }

  get scale() {
    return this.steps[this.level];
  }

  reset() {
    this.acc = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.warmup = 20; // ignore the first frames after (re)starting
  }

  /** Call once per rendered frame with the frame delta in seconds. */
  sample(dt, now = performance.now()) {
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    if (dt > 0.25) return; // tab switch / hitch — not representative
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    this.lastFps = fps;

    // At the lowest scale and still too slow for ~3 s: ask for fewer features.
    if (this.level === this.steps.length - 1 && this.floorFps && this.onFloor) {
      this.floorWindows = fps < this.floorFps ? this.floorWindows + 1 : 0;
      if (this.floorWindows >= 6) {
        this.floorWindows = 0;
        this.warmup = 30;
        this.onFloor(fps);
        return;
      }
    }

    if (fps < 50) {
      this.fastWindows = 0;
      if (++this.slowWindows >= 2 && this.level < this.steps.length - 1) {
        this.blockedUntil.set(this.level, now + 20000);
        this.setLevel(this.level + 1);
      }
    } else if (fps > 57) {
      this.slowWindows = 0;
      if (++this.fastWindows >= 8 && this.level > 0) {
        const up = this.level - 1;
        if ((this.blockedUntil.get(up) || 0) < now) this.setLevel(up);
        this.fastWindows = 0;
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
  }

  setLevel(level) {
    if (level === this.level) return;
    this.level = level;
    this.reset();
    this.onChange && this.onChange(this.scale);
  }
}
