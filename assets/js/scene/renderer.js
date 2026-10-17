/**
 * Renderer creation, tone-mapping helpers and resize handling.
 */
import * as THREE from 'three';
import { BG } from './util.js';

/** Tone mapping in use. AgX keeps polished steel bright without clipping and keeps dark mill scale rich. */
export function toneMappingMode() {
  const p = new URLSearchParams(location.search).get('tm');
  return p === 'neutral' ? 'neutral' : 'agx';
}

export function createRenderer(canvas, { preserve = false, alpha = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // MSAA + SMAA happen in the post-processing chain
    alpha,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: preserve,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping runs as the last HDR effect
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(BG, alpha ? 0 : 1);
  return renderer;
}

/* --------------------------------------------------------------------------
   Background colour that survives tone mapping.
   The brand background (#0E1013) must come out of the tone mapper unchanged,
   so we solve for the linear input that maps to it.
   -------------------------------------------------------------------------- */
const mul = (m, v) => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
// Column-major, as in three.js' GLSL.
const SRGB_TO_2020 = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]];
const R2020_TO_SRGB = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const AGX_IN = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const AGX_OUT = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];

function agx(c) {
  let v = mul(AGX_IN, mul(SRGB_TO_2020, c));
  v = v.map((x) => {
    let t = (Math.log2(Math.max(x, 1e-10)) + 12.47393) / (4.026069 + 12.47393);
    t = Math.min(1, Math.max(0, t));
    const x2 = t * t;
    const x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * t + 31.96 * x4 - 6.868 * x2 * t + 0.4298 * x2 + 0.1191 * t - 0.00232;
  });
  v = mul(AGX_OUT, v).map((x) => Math.pow(Math.max(0, x), 2.2));
  return mul(R2020_TO_SRGB, v).map((x) => Math.min(1, Math.max(0, x)));
}

function neutral(c) {
  const start = 0.8 - 0.04;
  const desat = 0.15;
  let [r, g, b] = c;
  const x = Math.min(r, g, b);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off;
  g -= off;
  b -= off;
  const peak = Math.max(r, g, b);
  if (peak < start) return [r, g, b];
  const d = 1 - start;
  const np = 1 - (d * d) / (peak + d - start);
  const s = np / peak;
  const gg = 1 - 1 / (desat * (peak - np) + 1);
  return [r, g, b].map((v) => v * s * (1 - gg) + np * gg);
}

/** Linear colour that the chosen tone mapper turns into `target` (default: brand background). */
export function preToneMapped(target = BG, mode = toneMappingMode()) {
  const want = new THREE.Color(target); // linear-sRGB working space
  const goal = [want.r, want.g, want.b];
  const f = mode === 'neutral' ? neutral : agx;
  let x = goal.slice();
  for (let i = 0; i < 60; i++) {
    const y = f(x);
    x = x.map((v, k) => Math.max(0, v + (goal[k] - y[k]) * (0.6 + 0.4 * (v / Math.max(goal[k], 1e-6)))));
  }
  return new THREE.Color(x[0], x[1], x[2]);
}

/* --------------------------------------------------------------------------
   Resize handling: canvas size changes, orientation, visualViewport and
   browser zoom (devicePixelRatio) — debounced into a single callback.
   -------------------------------------------------------------------------- */
export function watchSize(canvas, onResize, { debounce = 90 } = {}) {
  let timer = 0;
  let last = '';
  let dprQuery = null;

  const measure = () => {
    timer = 0;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight));
    const dpr = window.devicePixelRatio || 1;
    const key = `${width}x${height}@${dpr}`;
    if (key === last) return;
    last = key;
    onResize({ width, height, dpr, aspect: width / height });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(measure, debounce);
  };
  const watchDpr = () => {
    if (dprQuery) dprQuery.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  function onDpr() {
    watchDpr();
    schedule();
  }

  const ro = new ResizeObserver(schedule);
  ro.observe(canvas);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
  watchDpr();
  measure();

  return {
    flush: measure,
    dispose() {
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', schedule);
      if (dprQuery) dprQuery.removeEventListener('change', onDpr);
    },
  };
}

/** Aspect classes used for camera framing. */
export function aspectClass(aspect) {
  if (aspect <= 0.7) return 'portrait';
  if (aspect < 1.0) return 'tall';
  if (aspect < 1.9) return 'landscape';
  return 'ultrawide';
}
