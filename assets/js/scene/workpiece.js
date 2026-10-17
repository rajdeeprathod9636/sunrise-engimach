/**
 * The workpiece: radius-profile system + turned-geometry builder.
 *
 * A part is a profile — an ordered list of points (x, r) in the plane through the
 * lathe axis (world X). The builder revolves it into a mesh with:
 *   • hard edges at every profile corner (shoulders, grooves, chamfers stay crisp)
 *   • smooth shading around the circumference
 *   • two material groups: raw mill scale (0) and freshly cut steel (1)
 *   • UVs: u = angle / 2π, v = arc length along the profile (world units), so
 *     feed-mark textures keep a constant real-world pitch on diameters and faces
 *   • tangents running around the circumference (drives the anisotropic steel)
 *   • true helical thread geometry for thread spans (not rings)
 * The machining state is rebuilt only when it changes, into preallocated buffers.
 */
import * as THREE from 'three';
import { clamp01, lerp, norm, smooth } from './util.js';

/* ==========================================================================
   Example part (scene units: 1 unit ≈ 50 mm; the lathe axis is world X)
   ========================================================================== */
export const R0 = 0.5; // raw bar radius
export const PART_L = -1.8; // left end of the finished part (meets the stock held in the chuck)
export const X_RAW = 2.72; // free end of the raw bar
export const X_FACE = 2.55; // free end after facing
export const CUT_END = -1.55; // where the turning pass stops
export const PART_CENTER = (PART_L + X_FACE) / 2;

// Stepped shaft: [from, to, finished radius]
export const STEPS = [
  [-1.8, -1.55, 0.5],
  [-1.55, -0.45, 0.37],
  [-0.45, 0.15, 0.47],
  [0.15, 1.15, 0.41],
  [1.15, 1.95, 0.33],
  [1.95, X_RAW, 0.27],
];
export const GROOVES = [
  { key: 'g1', a: 1.87, b: 1.95, d: 0.07, r: 0.33, x: 1.91 }, // thread relief groove
  { key: 'g2', a: 0.56, b: 0.63, d: 0.05, r: 0.41, x: 0.595 }, // circlip groove
];
export const THREAD = { from: 2.03, to: 2.5, pitch: 0.047, depth: 0.028, passes: 3 };
export const FINAL_STATE = { face: 1, cut: 1, cutX: CUT_END, g1: 1, g2: 1, thread: 1, finish: 1 };

export function stepRadius(x) {
  for (const [a, b, r] of STEPS) if (x >= a && x < b) return r;
  return STEPS[STEPS.length - 1][2];
}

export function finishedRadius(x) {
  let r = stepRadius(x);
  for (const g of GROOVES) if (x > g.a && x < g.b) r -= g.d;
  return r;
}

/* ==========================================================================
   Profile helper: builds point lists with chamfered corners
   ========================================================================== */
class ProfileWriter {
  constructor() {
    this.pts = [];
  }
  /** Adds a point; the segment from the previous point takes `cut` / `thread`. */
  add(x, r, cut, thread = null) {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.abs(last.x - x) < 1e-6 && Math.abs(last.r - r) < 1e-6) return;
    this.pts.push({ x, r: Math.max(0, r), cut, thread });
  }
  get last() {
    return this.pts[this.pts.length - 1];
  }
}

/**
 * Turns a list of spans [{a, b, r, cut, thread}] (left → right, contiguous) into a
 * closed outer profile from the axis at the left end to the axis at the right end,
 * breaking each outer corner with a small chamfer.
 */
export function spansToProfile(spans, { leftChamfer = 0, leftCut = true, rightChamfer = 0, rightCut = true, edge = 0.012, bore = 0 } = {}) {
  const w = new ProfileWriter();
  const first = spans[0];
  const x0 = first.a;
  w.add(x0, bore, leftCut);
  if (leftChamfer > 0) {
    w.add(x0, first.r - leftChamfer, leftCut);
    w.add(x0 + leftChamfer, first.r, leftCut);
  } else w.add(x0, first.r, leftCut);

  for (let k = 0; k < spans.length; k++) {
    const s = spans[k];
    const n = spans[k + 1];
    if (!n) {
      // last span: run to the right end, then the right face
      const xe = s.b;
      if (rightChamfer > 0) {
        w.add(xe - rightChamfer, s.r, s.cut, s.thread);
        w.add(xe, s.r - rightChamfer, rightCut);
      } else w.add(xe, s.r, s.cut, s.thread);
      w.add(xe, bore, rightCut);
      break;
    }
    const dr = n.r - s.r;
    if (Math.abs(dr) < 1e-6) {
      w.add(s.b, s.r, s.cut, s.thread);
      continue;
    }
    const cutEdge = s.cut || n.cut;
    const c = cutEdge ? Math.min(edge, Math.abs(dr) * 0.45, (s.b - s.a) * 0.4, (n.b - n.a) * 0.4) : 0;
    if (dr < 0) {
      // step down: outer corner belongs to this span
      if (c > 0) {
        w.add(s.b - c, s.r, s.cut, s.thread);
        w.add(s.b, s.r - c, true);
      } else w.add(s.b, s.r, s.cut, s.thread);
      w.add(s.b, n.r, true);
    } else {
      // step up: outer corner belongs to the next span
      w.add(s.b, s.r, s.cut, s.thread);
      if (c > 0) {
        w.add(s.b, n.r - c, true);
        w.add(s.b + c, n.r, true);
      } else w.add(s.b, n.r, true);
    }
  }
  return w.pts;
}

/** Profile of the story workpiece for a machining state (all values derived from P). */
export function storyProfile(s) {
  const rightCh = s.face >= 1 ? 0.03 * clamp01(s.cut * 12) : 0;
  const leftCh = 0.035 * s.finish;
  const cutX = s.cutX;
  const xEnd = X_FACE;
  const bps = [PART_L, xEnd, cutX, THREAD.from, THREAD.to];
  for (const [a, b] of STEPS) bps.push(a, b);
  for (const g of GROOVES) bps.push(g.a, g.b);
  const xs = [...new Set(bps.map((v) => +v.toFixed(6)))].filter((x) => x >= PART_L && x <= xEnd).sort((a, b) => a - b);

  const spans = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    if (b - a < 1e-5) continue;
    const m = (a + b) / 2;
    const cut = m > cutX;
    let r = cut ? stepRadius(m) : R0;
    if (cut) for (const g of GROOVES) if (m > g.a && m < g.b) r -= g.d * s[g.key];
    const thread =
      cut && s.thread > 1e-4 && m > THREAD.from && m < THREAD.to
        ? { pitch: THREAD.pitch, depth: THREAD.depth * s.thread, phase: THREAD.from }
        : null;
    const prev = spans[spans.length - 1];
    if (prev && Math.abs(prev.r - r) < 1e-6 && prev.cut === cut && !prev.thread && !thread) prev.b = b;
    else spans.push({ a, b, r, cut, thread });
  }

  if (s.face >= 1) {
    return spansToProfile(spans, { leftChamfer: leftCh, rightChamfer: rightCh });
  }

  // Facing in progress: material beyond X_FACE remains only inside the tool radius.
  const pts = spansToProfile(spans, { leftChamfer: leftCh, rightChamfer: 0 });
  pts.pop(); // drop the right face down to the axis; replace with the facing state
  const rTool = R0 * (1 - s.face);
  const touched = s.face > 0;
  const w = new ProfileWriter();
  w.pts = pts;
  if (rTool > 1e-3) {
    w.add(X_FACE, rTool, true);
    w.add(X_RAW, rTool, touched);
    w.add(X_RAW, 0, false);
  } else {
    w.add(X_FACE, 0, true);
  }
  return w.pts;
}

/* ==========================================================================
   Geometry builder
   ========================================================================== */
// Thread profile across one pitch (s ∈ [0, 1]): crest flat, flank, root flat, flank.
// ISO-like truncation: crest P/8, root P/4. Bands are separate so edges stay crisp.
const THREAD_BANDS = [
  [0, 1 / 16, 0, 0],
  [1 / 16, 7 / 16, 0, 1],
  [7 / 16, 9 / 16, 1, 1],
  [9 / 16, 15 / 16, 1, 0],
  [15 / 16, 1, 0, 0],
];

export class TurnedMesh {
  /**
   * @param {THREE.Material[]} materials [raw, cut]
   * @param {object} opts
   */
  constructor(materials, { radialSegments = 128, threadSamplesPerTurn = 0 } = {}) {
    this.R = radialSegments;
    this.threadR = threadSamplesPerTurn || radialSegments;
    this.cos = new Float32Array(this.R + 1);
    this.sin = new Float32Array(this.R + 1);
    for (let j = 0; j <= this.R; j++) {
      const t = (j / this.R) * Math.PI * 2;
      this.cos[j] = Math.cos(t);
      this.sin[j] = Math.sin(t);
    }
    this.geometry = new THREE.BufferGeometry();
    this.capV = 0;
    this.capI = 0;
    this.ensure(4096, 8192);
    this.mesh = new THREE.Mesh(this.geometry, materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.key = '';
    this.rawIdx = [];
    this.cutIdx = [];
  }

  ensure(nv, ni) {
    if (nv <= this.capV && ni <= this.capI) return;
    this.capV = Math.max(nv, Math.ceil(this.capV * 1.5));
    this.capI = Math.max(ni, Math.ceil(this.capI * 1.5));
    const g = this.geometry;
    this.pos = new Float32Array(this.capV * 3);
    this.nrm = new Float32Array(this.capV * 3);
    this.uv = new Float32Array(this.capV * 2);
    this.tan = new Float32Array(this.capV * 4);
    this.idx = new Uint32Array(this.capI);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tangent', new THREE.BufferAttribute(this.tan, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
  }

  /** Rebuilds from a profile (array of {x, r, cut, thread}). */
  build(pts) {
    // Size estimate
    const R = this.R;
    let nv = 0;
    let ni = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.thread) {
        const turns = Math.ceil((p.x - pts[i - 1].x) / p.thread.pitch) + 5;
        const cols = turns * this.threadR + 1;
        nv += cols * THREAD_BANDS.length * 2;
        ni += (cols - 1) * THREAD_BANDS.length * 6;
      } else {
        nv += (R + 1) * 2;
        ni += R * 6;
      }
    }
    this.ensure(nv, ni);
    this.vc = 0;
    this.rawIdx.length = 0;
    this.cutIdx.length = 0;

    let v = 0; // running arc length
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.r - a.r);
      if (len < 1e-7 || (a.r < 1e-7 && b.r < 1e-7)) continue;
      if (b.thread && b.thread.depth > 1e-5 && Math.abs(a.r - b.r) < 1e-6) this.threadSpan(a.x, b.x, a.r, b.thread, v);
      else this.band(a, b, v, len, b.cut);
      v += len;
    }

    // Index buffer: raw group then cut group
    const idx = this.idx;
    let k = 0;
    for (const n of this.rawIdx) idx[k++] = n;
    const nRaw = k;
    for (const n of this.cutIdx) idx[k++] = n;
    const g = this.geometry;
    g.clearGroups();
    if (nRaw) g.addGroup(0, nRaw, 0);
    if (k > nRaw) g.addGroup(nRaw, k - nRaw, 1);
    g.setDrawRange(0, k);
    for (const name of ['position', 'normal', 'uv', 'tangent']) {
      const attr = g.getAttribute(name);
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.vc * attr.itemSize);
      attr.needsUpdate = true;
    }
    g.index.clearUpdateRanges();
    g.index.addUpdateRange(0, k);
    g.index.needsUpdate = true;
  }

  /** One profile segment revolved: two rings, flat normal across the profile. */
  band(a, b, v0, len, cut) {
    const { R, cos, sin, pos, nrm, uv, tan } = this;
    const dx = (b.x - a.x) / len;
    const dr = (b.r - a.r) / len;
    const nx = -dr; // axial component of the outward normal
    const nr = dx; // radial component
    const base = this.vc;
    for (let ring = 0; ring < 2; ring++) {
      const p = ring ? b : a;
      const vv = v0 + (ring ? len : 0);
      for (let j = 0; j <= R; j++) {
        const i = this.vc++;
        const c = cos[j];
        const s = sin[j];
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.r * c;
        pos[i * 3 + 2] = p.r * s;
        nrm[i * 3] = nx;
        nrm[i * 3 + 1] = nr * c;
        nrm[i * 3 + 2] = nr * s;
        uv[i * 2] = j / R;
        uv[i * 2 + 1] = vv;
        tan[i * 4] = 0;
        tan[i * 4 + 1] = -s;
        tan[i * 4 + 2] = c;
        tan[i * 4 + 3] = 1;
      }
    }
    const out = cut ? this.cutIdx : this.rawIdx;
    for (let j = 0; j < R; j++) {
      const p0 = base + j;
      const p1 = base + j + 1;
      const q0 = base + R + 1 + j;
      const q1 = q0 + 1;
      out.push(p0, p1, q0, p1, q1, q0);
    }
  }

  /**
   * Helical thread between x0 and x1 at major radius r. Rows follow the helix, so
   * crests, flanks and roots are exact mesh lines. Outside [x0, x1] the surface runs
   * out onto the major diameter, closing the ends cleanly.
   */
  threadSpan(x0, x1, r, th, v0) {
    const { pitch, depth, phase = x0 } = th;
    const N = this.threadR;
    const turnStart = Math.floor((x0 - phase) / pitch) - 1;
    const turnEnd = Math.ceil((x1 - phase) / pitch) + 1;
    const cols = (turnEnd - turnStart) * N + 1;
    const pos = this.pos;
    const out = this.cutIdx;
    const startV = this.vc;

    for (const [s0, s1, d0, d1] of THREAD_BANDS) {
      const base = this.vc;
      for (let row = 0; row < 2; row++) {
        const sP = row ? s1 : s0;
        const dep = (row ? d1 : d0) * depth;
        for (let c = 0; c < cols; c++) {
          const turn = turnStart + c / N;
          const ang = (c % N) / N;
          const t = ang * Math.PI * 2;
          let x = phase + (turn + sP) * pitch;
          let rr = r - dep;
          if (x < x0) {
            x = x0;
            rr = r;
          } else if (x > x1) {
            x = x1;
            rr = r;
          }
          const i = this.vc++;
          const cs = Math.cos(t);
          const sn = Math.sin(t);
          pos[i * 3] = x;
          pos[i * 3 + 1] = rr * cs;
          pos[i * 3 + 2] = rr * sn;
          this.uv[i * 2] = turn; // continuous across turns (texture repeats)
          this.uv[i * 2 + 1] = v0 + (x - x0);
          this.tan[i * 4] = 0;
          this.tan[i * 4 + 1] = -sn;
          this.tan[i * 4 + 2] = cs;
          this.tan[i * 4 + 3] = 1;
        }
      }
      // Rows advance in +x (bands ordered crest → root → crest), columns in +θ.
      for (let c = 0; c < cols - 1; c++) {
        const p0 = base + c;
        const p1 = p0 + 1;
        const q0 = base + cols + c;
        const q1 = q0 + 1;
        out.push(p0, p1, q0, p1, q1, q0);
      }
    }
    this.accumulateNormals(startV, this.vc, out);
  }

  /** Area-weighted vertex normals for a vertex range (thread bands keep hard edges). */
  accumulateNormals(v0, v1, tris) {
    const { pos, nrm } = this;
    nrm.fill(0, v0 * 3, v1 * 3);
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const C = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let k = tris.length - 1; k >= 0; k -= 3) {
      const ia = tris[k - 2];
      if (ia < v0) break;
      const ib = tris[k - 1];
      const ic = tris[k];
      A.fromArray(pos, ia * 3);
      B.fromArray(pos, ib * 3);
      C.fromArray(pos, ic * 3);
      e1.subVectors(B, A);
      e2.subVectors(C, A);
      e1.cross(e2);
      for (const i of [ia, ib, ic]) {
        nrm[i * 3] += e1.x;
        nrm[i * 3 + 1] += e1.y;
        nrm[i * 3 + 2] += e1.z;
      }
    }
    for (let i = v0; i < v1; i++) {
      const x = nrm[i * 3];
      const y = nrm[i * 3 + 1];
      const z = nrm[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      if (l > 1e-12) {
        nrm[i * 3] = x / l;
        nrm[i * 3 + 1] = y / l;
        nrm[i * 3 + 2] = z / l;
      } else {
        // collapsed run-out vertex: point radially outward
        const py = pos[i * 3 + 1];
        const pz = pos[i * 3 + 2];
        const lr = Math.hypot(py, pz) || 1;
        nrm[i * 3] = 0;
        nrm[i * 3 + 1] = py / lr;
        nrm[i * 3 + 2] = pz / lr;
      }
    }
  }

  dispose() {
    this.geometry.dispose();
  }
}

/* ==========================================================================
   Story workpiece wrapper
   ========================================================================== */
export class StoryWorkpiece {
  constructor(materials, opts) {
    this.turned = new TurnedMesh([materials.rawStock, materials.cutSteel], opts);
    this.mesh = this.turned.mesh;
    this.mesh.name = 'workpiece';
    this.mesh.position.x = -PART_CENTER; // local origin at the part centre
    this.key = '';
    // Fixed bounds (the buffers are preallocated, so computing them would include unused space)
    this.mesh.geometry.boundingBox = new THREE.Box3(new THREE.Vector3(PART_L, -R0, -R0), new THREE.Vector3(X_RAW, R0, R0));
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3((PART_L + X_RAW) / 2, 0, 0), (X_RAW - PART_L) / 2 + 0.1);
  }

  update(s) {
    const key = [s.face, s.cutX, s.cut, s.g1, s.g2, s.thread, s.finish].map((v) => v.toFixed(4)).join('|');
    if (key === this.key) return false;
    this.key = key;
    this.turned.build(storyProfile(s));
    return true;
  }

  dispose() {
    this.turned.dispose();
  }
}

/** Fraction of all material that will be removed, removed so far (drives the chip pile). */
export function removedFraction(s) {
  return clamp01(s.face * 0.12 + s.cut * 0.62 + s.g1 * 0.05 + s.g2 * 0.04 + s.thread * 0.17);
}

export { norm, smooth, lerp };
