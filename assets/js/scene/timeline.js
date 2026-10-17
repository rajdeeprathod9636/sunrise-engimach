/**
 * The story timeline. ONE number, P (0 → 6), drives everything:
 *   0–1  hero: camera dollies through the open door toward the chuck and raw bar
 *   1–2  door slides shut, spindle spins up, coolant starts
 *   2–3  turret indexes to the turning tool; facing + turning (chips, coolant)
 *   3–4  turret indexes to grooving, then threading; the helical thread forms
 *   4–5  coolant off, door opens, part moves to the surface plate, caliper measures
 *   5–6  finished part in a studio showcase pose
 * Every value is a pure function of P, so scrolling back reverses it exactly.
 */
import * as THREE from 'three';
import { clamp01, lerp, norm, smooth, smoother, window4 } from './util.js';
import { R0, X_FACE, CUT_END, GROOVES, THREAD, PART_CENTER, stepRadius } from './workpiece.js';
import { TOOLS, stationAngle, DIR, ENCLOSURE } from './machine.js';
import { BENCH } from './set.js';

const [G1, G2] = GROOVES;
const PARK = { x: 3.8, r: 2.6 };
const FACE_X = X_FACE + 0.012;
const TH_START = THREAD.to + 0.07;
const TH_R = stepRadius(2.2);

/** Lift, traverse, lower — keeps the tool clear of the work while it repositions. */
function travel(a, b, t) {
  const hi = Math.max(a.r, b.r) + 0.14;
  if (t < 0.3) return { x: a.x, r: lerp(a.r, hi, smooth(t / 0.3)) };
  const k = smooth((t - 0.3) / 0.7);
  return { x: lerp(a.x, b.x, k), r: lerp(hi, b.r, k) };
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function indexAngle(from, to, t) {
  const a = stationAngle(from);
  return a + wrapPi(stationAngle(to) - a) * smoother(clamp01(t));
}

export function stateAt(P) {
  const s = {};
  s.P = P;
  // Door (0 open → 1 closed), spindle, coolant
  s.door = smooth(norm(P, 1.0, 1.45)) * (1 - smooth(norm(P, 4.08, 4.42)));
  s.spindle = smooth(norm(P, 1.18, 1.78)) * (1 - smooth(norm(P, 3.98, 4.24)));
  const coolOn = norm(P, 1.66, 1.92);
  const coolOff = norm(P, 3.95, 4.06);
  s.coolant = { flow: coolOn > 0 && coolOff < 1 ? 1 : 0, grow: smooth(coolOn), cut: smooth(coolOff) };
  s.wet = smooth(norm(P, 1.8, 2.05)) * (1 - smooth(norm(P, 4.15, 4.7)));

  // Facing
  const fT = norm(P, 2.0, 2.16);
  const faceR = (R0 + 0.1) * (1 - fT);
  s.face = clamp01(1 - faceR / R0);

  // Turning
  s.cut = norm(P, 2.24, 2.94);
  s.cutX = lerp(X_FACE + 1e-4, CUT_END, s.cut);

  // Grooving
  const g1R = lerp(G1.r + 0.12, G1.r - G1.d, norm(P, 3.04, 3.2));
  s.g1 = clamp01((G1.r - g1R) / G1.d);
  const g2R = lerp(G2.r + 0.12, G2.r - G2.d, norm(P, 3.28, 3.42));
  s.g2 = clamp01((G2.r - g2R) / G2.d);

  // Threading — three passes, each deeper
  const tT = norm(P, 3.5, 3.95);
  const pf = tT * THREAD.passes;
  const pass = Math.min(THREAD.passes - 1, Math.floor(pf));
  const local = pf - pass;
  const feed = clamp01(local / 0.7);
  s.thread = (pass + feed) / THREAD.passes;

  // Parting / transfer / inspection / studio
  s.detach = smooth(norm(P, 4.3, 4.78));
  s.finish = smooth(norm(P, 4.26, 4.36));
  s.caliperIn = smooth(norm(P, 4.62, 4.78)) * (1 - smooth(norm(P, 5.02, 5.2)));
  s.caliperClose = smooth(norm(P, 4.78, 4.94)) * (1 - smooth(norm(P, 4.98, 5.06)));
  s.callouts = window4(P, 4.7, 4.84, 5.0, 5.14);
  s.studio = smooth(norm(P, 5.05, 5.45));
  s.lift = smooth(norm(P, 5.08, 5.42));

  // Turret station (disc angle) — indexes only while the tool is retracted
  let angle = stationAngle(TOOLS.blank);
  if (P >= 1.5) angle = indexAngle(TOOLS.blank, TOOLS.turning, norm(P, 1.5, 1.7));
  if (P >= 2.97) angle = indexAngle(TOOLS.turning, TOOLS.grooving, norm(P, 2.99, 3.025));
  if (P >= 3.43) angle = indexAngle(TOOLS.grooving, TOOLS.threading, norm(P, 3.445, 3.48));
  s.turretAngle = angle;
  s.activeStation = P < 2.99 ? (P < 1.6 ? TOOLS.blank : TOOLS.turning) : P < 3.46 ? TOOLS.grooving : TOOLS.threading;

  // Tool path (tip x along the axis, r = distance from the axis along the approach direction)
  let tool = PARK;
  let cutting = false;
  if (P < 1.7) tool = PARK;
  else if (P < 2.0) tool = travel(PARK, { x: FACE_X, r: R0 + 0.1 }, norm(P, 1.7, 2.0));
  else if (P < 2.16) {
    tool = { x: FACE_X, r: faceR };
    cutting = faceR < R0 && fT < 1;
  } else if (P < 2.24) tool = { x: FACE_X, r: lerp(0, TH_R, smooth(norm(P, 2.16, 2.24))) };
  else if (P < 2.94) {
    tool = { x: s.cutX, r: stepRadius(s.cutX + 1e-3) };
    cutting = s.cut < 1;
  } else if (P < 3.04)
    tool = travel({ x: CUT_END, r: stepRadius(CUT_END + 1e-3) }, { x: G1.x, r: G1.r + 0.12 }, norm(P, 2.94, 3.04));
  else if (P < 3.2) {
    tool = { x: G1.x, r: g1R };
    cutting = s.g1 > 0 && s.g1 < 1;
  } else if (P < 3.28) tool = travel({ x: G1.x, r: G1.r - G1.d }, { x: G2.x, r: G2.r + 0.12 }, norm(P, 3.2, 3.28));
  else if (P < 3.42) {
    tool = { x: G2.x, r: g2R };
    cutting = s.g2 > 0 && s.g2 < 1;
  } else if (P < 3.5) tool = travel({ x: G2.x, r: G2.r - G2.d }, { x: TH_START, r: TH_R }, norm(P, 3.42, 3.5));
  else if (P < 3.95) {
    const depthR = TH_R - THREAD.depth * s.thread;
    if (local < 0.7) {
      tool = { x: lerp(TH_START, THREAD.from - 0.01, feed), r: depthR };
      cutting = true;
    } else {
      const k = (local - 0.7) / 0.3;
      const lift = TH_R + 0.08;
      const nextR = TH_R - THREAD.depth * Math.min(1, (pass + 1) / THREAD.passes);
      if (k < 0.2) tool = { x: THREAD.from - 0.01, r: lerp(depthR, lift, smooth(k / 0.2)) };
      else if (k < 0.85) tool = { x: lerp(THREAD.from - 0.01, TH_START, smooth((k - 0.2) / 0.65)), r: lift };
      else tool = { x: TH_START, r: lerp(lift, nextR, smooth((k - 0.85) / 0.15)) };
    }
  } else tool = travel({ x: TH_START, r: TH_R }, PARK, norm(P, 3.95, 4.15));
  s.tool = tool;
  s.cutting = cutting;
  return s;
}

/* ==========================================================================
   Part placement: chuck → out through the door → V-blocks → studio
   ========================================================================== */
const _benchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), BENCH.yaw);
export const PART_ON_BENCH = new THREE.Vector3(0, BENCH.axisY, 0).add(BENCH.position);
export const PART_STUDIO = PART_ON_BENCH.clone().add(new THREE.Vector3(0, 1.55, 0.2));
const transferCurve = new THREE.CubicBezierCurve3(
  new THREE.Vector3(PART_CENTER, 0, 0),
  new THREE.Vector3(PART_CENTER + 1.0, 0.9, 7.5),
  new THREE.Vector3(PART_ON_BENCH.x - 7, PART_ON_BENCH.y + 2.6, PART_ON_BENCH.z + 1.5),
  PART_ON_BENCH.clone()
);

/** World position + orientation of the part group (spin is applied separately). */
export function partPose(s, out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }) {
  const d = s.detach;
  if (d <= 0) {
    out.pos.set(PART_CENTER, 0, 0);
    out.quat.identity();
  } else {
    transferCurve.getPoint(d, out.pos);
    out.quat.identity().slerp(_benchQ, smooth(norm(d, 0.3, 1)));
  }
  if (s.lift > 0) {
    out.pos.lerp(PART_STUDIO, s.lift);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.12, 0.1, 'YXZ'));
    out.quat.slerp(tilt.premultiply(_benchQ), s.lift);
  }
  return out;
}

/** Tool tip in world space. */
export function toolTip(s, out = new THREE.Vector3()) {
  return out.set(s.tool.x, 0, 0).addScaledVector(DIR, s.tool.r);
}

/* ==========================================================================
   Camera
   ========================================================================== */
const SUBJECTS = {
  door: (s, out) => out.set(1.6, 0.4, 4.0),
  chuck: (s, out) => out.set(-1.1, 0.25, 0.4),
  work: (s, out) => out.set(-0.4, 0.2, 0.15), // chuck + whole workpiece
  tool: (s, out) => toolTip(s, out).lerp(new THREE.Vector3(Math.min(s.tool.x, X_FACE), 0, 0), 0.5),
  thread: (s, out) => out.set(2.25, 0.2, 0.1),
  part: (s, out) => out.copy(partPose(s).pos).add(_up), // whole workpiece (in the chuck or travelling)
  bench: (s, out) => out.copy(PART_ON_BENCH).add(new THREE.Vector3(0, 0.25, 0.25)),
  studio: (s, out) => out.copy(PART_STUDIO),
};

// p, subject, radius, azimuth, elevation, fill (share of the safe area), lens (vertical fov), bokeh
// Every key frames a sphere that contains the whole workpiece, so the part is never cropped.
export const KEYS = [
  { p: 0.0, sub: 'door', r: 6.4, az: -0.42, el: 0.06, fill: 0.88, fov: 32, bokeh: 3.0 },
  { p: 0.62, sub: 'work', r: 3.9, az: -0.26, el: 0.1, fill: 0.88, fov: 32, bokeh: 2.6 },
  { p: 1.05, sub: 'work', r: 3.6, az: -0.3, el: 0.12, fill: 0.88, fov: 34, bokeh: 1.8 },
  { p: 1.6, sub: 'work', r: 3.4, az: -0.22, el: 0.15, fill: 0.88, fov: 34, bokeh: 1.4 },
  { p: 2.06, sub: 'part', r: 2.4, az: 0.3, el: 0.2, fill: 0.88, fov: 36, bokeh: 1.2 },
  { p: 2.55, sub: 'part', r: 2.4, az: 0.16, el: 0.17, fill: 0.88, fov: 34, bokeh: 1.2 },
  { p: 2.95, sub: 'part', r: 2.4, az: -0.12, el: 0.16, fill: 0.88, fov: 34, bokeh: 1.2 },
  { p: 3.18, sub: 'part', r: 2.4, az: -0.3, el: 0.2, fill: 0.88, fov: 36, bokeh: 1.2 },
  { p: 3.66, sub: 'part', r: 2.4, az: 0.42, el: 0.15, fill: 0.88, fov: 38, bokeh: 1.1 },
  { p: 3.98, sub: 'part', r: 2.45, az: 0.3, el: 0.17, fill: 0.88, fov: 36, bokeh: 1.1 },
  { p: 4.3, sub: 'work', r: 3.4, az: 0.12, el: 0.15, fill: 0.88, fov: 32, bokeh: 1.6 },
  { p: 4.55, sub: 'part', r: 2.7, az: 0.1, el: 0.2, fill: 0.88, fov: 30, bokeh: 2.0 },
  { p: 4.86, sub: 'bench', r: 2.75, az: -0.3, el: 0.26, fill: 0.88, fov: 28, bokeh: 2.2 },
  { p: 5.12, sub: 'bench', r: 2.75, az: -0.24, el: 0.24, fill: 0.88, fov: 28, bokeh: 2.2 },
  { p: 5.48, sub: 'studio', r: 2.5, az: 0.32, el: 0.12, fill: 0.88, fov: 24, bokeh: 1.6 },
  { p: 6.0, sub: 'studio', r: 2.55, az: 0.58, el: 0.18, fill: 0.88, fov: 24, bokeh: 1.6 },
];

const _up = new THREE.Vector3(0, 0.12, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Per aspect class adjustments to every keyframe (classes from renderer.aspectClass):
 *   portrait ≤ 0.7 · tall 0.7–1.0 · landscape 1.0–1.9 · ultrawide ≥ 1.9
 * Narrow screens get a wider lens (so the part fills the width without a flat, distant look),
 * a slightly higher, less sideways camera; ultrawide gets a longer lens.
 */
export const ASPECT_KEYS = {
  portrait: { fov: 1.2, el: 0.05, az: 0.72 },
  tall: { fov: 1.1, el: 0.03, az: 0.85 },
  landscape: { fov: 1, el: 0, az: 1 },
  ultrawide: { fov: 0.88, el: -0.01, az: 1.12 },
};

/** Keyframe blend at P: subject centre, radius, angles, lens. */
export function cameraKeys(P, s, klass = 'landscape') {
  let i = 0;
  while (i < KEYS.length - 2 && P > KEYS[i + 1].p) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(norm(P, a.p, b.p));
  SUBJECTS[a.sub](s, _a);
  SUBJECTS[b.sub](s, _b);
  const m = ASPECT_KEYS[klass] || ASPECT_KEYS.landscape;
  return {
    center: _a.clone().lerp(_b, t),
    radius: lerp(a.r, b.r, t),
    az: lerp(a.az, b.az, t) * m.az,
    el: lerp(a.el, b.el, t) + m.el,
    fill: lerp(a.fill, b.fill, t),
    fov: lerp(a.fov, b.fov, t) * m.fov,
    bokeh: lerp(a.bokeh, b.bokeh, t),
  };
}

/** Which side of the screen the subject sits on: stage k → right when k is even (text on the left). */
export function sideAt(P) {
  const k = Math.floor(P + 0.5);
  const f = P + 0.5 - k; // 0..1 inside the switching window around each integer
  const sideOf = (n) => (Math.min(5, Math.max(0, n)) % 2 === 0 ? 1 : -1);
  const from = sideOf(k - 1);
  const to = sideOf(k);
  // switch quickly around the integer boundary, while neither card is centred
  return lerp(from, to, smooth(norm(f, 0.36, 0.64)));
}

/**
 * Fits a bounding sphere into a safe rectangle (NDC units) and returns the camera
 * distance plus the view offset that centres the subject in that rectangle.
 * @param {object} safe  {cx, cy, hw, hh} centre and half-size in NDC (−1..1)
 */
export function frameSphere(radius, fovDeg, aspect, safe, fill) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const fit = Math.max(0.05, Math.min(safe.hh, safe.hw * aspect) * fill);
  const k = radius / (tanV * fit);
  return Math.sqrt(radius * radius + k * k);
}

/** Minimum distance that keeps the camera outside the closed door glass. */
export function glassClearance(center, dirCam, doorClosed) {
  if (doorClosed < 0.02 || dirCam.z <= 0.05) return 0;
  const zMin = ENCLOSURE.doorZ + 0.55;
  return (zMin - center.z) / dirCam.z;
}
