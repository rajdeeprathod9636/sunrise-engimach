/**
 * Sunrise Engimach — procedural CNC lathe scene (Three.js)
 *
 * The whole story is driven by ONE number, P (0 → 6), supplied by scroll:
 *   0–1  hero: camera orbits the chuck and raw bar
 *   1–2  spindle spins up
 *   2–3  facing + turning (the bar profile morphs into a stepped shaft, chips fly)
 *   3–4  grooving + threading
 *   4–5  spindle stops, part detaches, amber ring scans it
 *   5–6  finished part in a showcase pose
 * Everything is computed from P each frame, so scrolling back reverses it exactly.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const BG = 0x0e1013;
const ACCENT = 0xc8873e;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const norm = (v, a, b) => clamp01((v - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

const isMobileDevice = () =>
  window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches;

/* ==========================================================================
   Part definition (scene units; the lathe axis is world X)
   ========================================================================== */
const R0 = 0.5; // raw bar radius
const PART_L = -1.8; // left end of the finished part (meets the stock held in the chuck)
const X_RAW = 2.72; // free end of the raw bar
const X_FACE = 2.55; // free end after facing
const CUT_END = -1.55; // where the turning pass stops
const PART_CENTER = (PART_L + X_FACE) / 2;

// Stepped shaft: [from, to, finished radius]
const STEPS = [
  [-1.8, -1.55, 0.5],
  [-1.55, -0.45, 0.37],
  [-0.45, 0.15, 0.47],
  [0.15, 1.15, 0.41],
  [1.15, 1.95, 0.33],
  [1.95, X_RAW, 0.27],
];
const GROOVES = [
  { key: 'g1', a: 1.87, b: 1.95, d: 0.07, r: 0.33, x: 1.91 }, // thread relief groove
  { key: 'g2', a: 0.56, b: 0.63, d: 0.05, r: 0.41, x: 0.595 }, // circlip groove
];
const THREAD = { from: 2.03, to: 2.5, pitch: 0.047, depth: 0.028, passes: 3 };

const FINAL_STATE = { face: 1, cut: 1, cutX: CUT_END, g1: 1, g2: 1, thread: 1, finish: 1 };

function stepRadius(x) {
  for (const [a, b, r] of STEPS) if (x >= a && x < b) return r;
  return STEPS[STEPS.length - 1][2];
}

function finishedRadius(x) {
  let r = stepRadius(x);
  for (const g of GROOVES) if (x > g.a && x < g.b) r -= g.d;
  return r;
}

/** Builds the lathe profile (radius, x) for the current machining state. */
function buildProfile(s) {
  const ch = s.face >= 1 ? 0.03 * s.finish : 0; // right-end chamfer
  const cl = 0.035 * s.finish; // left-end chamfer
  const xStart = PART_L + cl;
  const xEnd = X_FACE - ch;
  const cutX = s.cutX;

  const bps = [xStart, xEnd, cutX, THREAD.from, THREAD.to];
  for (const [a, b] of STEPS) bps.push(a, b);
  for (const g of GROOVES) bps.push(g.a, g.b);
  const xs = [...new Set(bps)].filter((x) => x >= xStart && x <= xEnd).sort((a, b) => a - b);

  const pts = [];
  const flags = [];
  const add = (r, y, cut) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - r) < 1e-5 && Math.abs(last.y - y) < 1e-5) return;
    pts.push(new THREE.Vector2(Math.max(0, r), y));
    flags.push(cut);
  };

  add(0, PART_L, false);
  if (cl > 0) add(R0 - cl, PART_L, true);

  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    if (b - a < 1e-5) continue;
    const m = (a + b) / 2;
    const cut = m > cutX;
    let r = cut ? stepRadius(m) : R0;
    if (cut) for (const g of GROOVES) if (m > g.a && m < g.b) r -= g.d * s[g.key];

    if (cut && s.thread > 0 && m > THREAD.from && m < THREAD.to) {
      const n = Math.max(1, Math.round((b - a) / THREAD.pitch));
      const p = (b - a) / n;
      const d = THREAD.depth * s.thread;
      for (let k = 0; k < n; k++) {
        const x0 = a + k * p;
        add(r, x0, true);
        add(r - d, x0 + p / 2, true);
      }
      add(r, b, true);
      continue;
    }
    add(r, a, cut);
    add(r, b, cut);
  }

  const rLast = pts[pts.length - 1].x;
  if (s.face < 1) {
    // Facing in progress: material beyond X_FACE remains only inside the tool radius.
    const rTool = R0 * (1 - s.face);
    if (rTool > 1e-3) {
      add(rTool, X_FACE, true);
      add(rTool, X_RAW, false);
      add(0, X_RAW, false);
    } else {
      add(0, X_FACE, true);
    }
  } else {
    if (ch > 0) add(rLast - ch, X_FACE, true);
    add(0, X_FACE, true);
  }
  return { pts, flags };
}

const RAW_COLOR = new THREE.Color().setRGB(0.15, 0.155, 0.165);
const CUT_COLOR = new THREE.Color().setRGB(0.6, 0.62, 0.65);

/** The workpiece: a LatheGeometry that is rebuilt whenever the machining state changes. */
class TurnedPart {
  constructor(segments) {
    this.segments = segments;
    this.key = '';
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.9,
      roughness: 0.35,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.rotation.z = -Math.PI / 2; // lathe Y axis → world X axis
  }

  update(s) {
    const key = [s.face, s.cutX, s.g1, s.g2, s.thread, s.finish].map((v) => v.toFixed(4)).join('|');
    if (key === this.key) return;
    this.key = key;

    const { pts, flags } = buildProfile(s);
    const geo = new THREE.LatheGeometry(pts, this.segments);
    const n = pts.length;
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const c = flags[v % n] ? CUT_COLOR : RAW_COLOR;
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/* ==========================================================================
   Shared setup helpers
   ========================================================================== */
function createRenderer(canvas, mobile) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function createEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  return env;
}

function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xc4ccd6, 0x0e1013, 0.35);
  const key = new THREE.DirectionalLight(0xfff1e2, 2.3);
  key.position.set(3, 6, 5);
  const rim = new THREE.DirectionalLight(0xc6d4e8, 1.7);
  rim.position.set(-5, 3, -6);
  const amber = new THREE.PointLight(ACCENT, 4, 9, 1.4);
  amber.position.set(2.5, 1.2, 1.6);
  scene.add(hemi, key, rim, amber);
  return { key, rim, amber };
}

function makeChipTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ==========================================================================
   Machine: headstock, chuck + jaws, held stock, bed, tool
   ========================================================================== */
const CHUCK_FACE = -1.97;

function buildMachine(mobile) {
  const materials = [];
  const mat = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    m.userData.base = m.color.clone();
    materials.push(m);
    return m;
  };
  const steel = mat({ color: 0x6f757e, metalness: 0.9, roughness: 0.38 });
  const jawSteel = mat({ color: 0x5a6069, metalness: 0.9, roughness: 0.42 });
  const dark = mat({ color: 0x1c1f24, metalness: 0.55, roughness: 0.55 });
  const slot = mat({ color: 0x0a0b0d, metalness: 0.3, roughness: 0.8 });
  const rail = mat({ color: 0x9aa1aa, metalness: 0.95, roughness: 0.22 });
  const raw = mat({ color: 0x4d5056, metalness: 0.85, roughness: 0.5 });
  const shankMat = mat({ color: 0x2b2f36, metalness: 0.75, roughness: 0.4 });
  const insertMat = mat({ color: 0xb37b3c, metalness: 0.85, roughness: 0.3 });

  const seg = mobile ? 40 : 64;
  const xAxis = (geo) => geo.rotateZ(Math.PI / 2);
  const group = new THREE.Group();

  // Headstock
  const head = new THREE.Mesh(new RoundedBoxGeometry(1.3, 2.7, 2.3, 3, 0.12), dark);
  head.position.set(-3.72, 0.05, 0);
  group.add(head);

  // Bed + ways
  const bed = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 2.2), dark);
  bed.position.set(0.3, -1.75, -0.1);
  group.add(bed);
  for (const z of [0.55, -0.65]) {
    const way = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 0.22), rail);
    way.position.set(0.3, -1.4, z);
    group.add(way);
  }

  // Spindle assembly (rotates about X)
  const spindle = new THREE.Group();
  group.add(spindle);

  const nose = new THREE.Mesh(xAxis(new THREE.CylinderGeometry(0.95, 0.95, 0.14, seg)), steel);
  nose.position.x = -3.0;
  const body = new THREE.Mesh(xAxis(new THREE.CylinderGeometry(1.15, 1.15, 0.9, seg)), steel);
  body.position.x = -2.5;
  // Front bevel: radiusTop maps to −X after rotation, radiusBottom to +X
  const bevel = new THREE.Mesh(xAxis(new THREE.CylinderGeometry(1.15, 1.02, 0.08, seg)), steel);
  bevel.position.x = CHUCK_FACE - 0.04;
  const bore = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.022, 8, seg).rotateY(Math.PI / 2), jawSteel);
  bore.position.x = CHUCK_FACE;
  spindle.add(nose, body, bevel, bore);

  const jawGeo = new THREE.BoxGeometry(0.26, 0.48, 0.3);
  const stepGeo = new THREE.BoxGeometry(0.16, 0.3, 0.3);
  const slotGeo = new THREE.BoxGeometry(0.012, 0.66, 0.36);
  const boltGeo = xAxis(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16));
  for (let k = 0; k < 3; k++) {
    const pivot = new THREE.Group();
    pivot.rotation.x = (k * Math.PI * 2) / 3;
    const jaw = new THREE.Mesh(jawGeo, jawSteel);
    jaw.position.set(CHUCK_FACE + 0.13, 0.74, 0);
    const step = new THREE.Mesh(stepGeo, jawSteel);
    step.position.set(CHUCK_FACE + 0.08, 1.02, 0);
    const slotMesh = new THREE.Mesh(slotGeo, slot);
    slotMesh.position.set(CHUCK_FACE + 0.004, 0.83, 0);
    pivot.add(jaw, step, slotMesh);

    const boltPivot = new THREE.Group();
    boltPivot.rotation.x = (k * Math.PI * 2) / 3 + Math.PI / 3;
    const bolt = new THREE.Mesh(boltGeo, dark);
    bolt.position.set(CHUCK_FACE + 0.02, 0.85, 0);
    boltPivot.add(bolt);
    spindle.add(pivot, boltPivot);
  }

  // Bar stock held inside the chuck
  const stub = new THREE.Mesh(xAxis(new THREE.CylinderGeometry(R0, R0, 1.2, seg)), raw);
  stub.position.x = -2.4;
  spindle.add(stub);

  // Cutting tool: angled insert + shank + turret block. Group origin = insert tip.
  const tool = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = -0.22;
  const insert = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.06), insertMat);
  insert.rotation.z = Math.PI / 4;
  insert.position.set(0, 0.106, 0);
  const shank = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.26), shankMat);
  shank.position.set(0.07, 0.88, -0.02);
  const clampPlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.3), shankMat);
  clampPlate.position.set(0.05, 0.22, 0);
  const turret = new THREE.Mesh(new RoundedBoxGeometry(0.85, 0.6, 0.85, 3, 0.06), dark);
  turret.position.set(0.07, 1.9, -0.02);
  tilt.add(insert, shank, clampPlate, turret);
  tool.add(tilt);
  group.add(tool);

  return { group, spindle, tool, materials };
}

/* ==========================================================================
   Chip particles
   ========================================================================== */
class Chips {
  constructor(count, texture) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -50;
    this.cursor = 0;
    this.acc = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.material = new THREE.PointsMaterial({
      size: 0.05,
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  spawn(origin) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const life = 0.35 + Math.random() * 0.5;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.04;
    this.pos[i * 3 + 1] = origin.y + 0.01;
    this.pos[i * 3 + 2] = origin.z + 0.02;
    // Work surface moves toward +Z at the top, so chips fly up and toward the viewer.
    this.vel[i * 3] = (Math.random() - 0.3) * 1.1;
    this.vel[i * 3 + 1] = 0.6 + Math.random() * 1.4;
    this.vel[i * 3 + 2] = 0.8 + Math.random() * 1.6;
  }

  update(dt, rate, origin, perSecond) {
    this.acc += rate * dt * perSecond;
    while (this.acc >= 1) {
      this.spawn(origin);
      this.acc -= 1;
    }
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -50;
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        continue;
      }
      alive++;
      this.vel[j + 1] -= 5.5 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = this.life[i] / this.maxLife[i]; // 1 → 0
      const f = Math.sqrt(t);
      // hot amber at birth → steel grey
      this.col[j] = lerp(0.62, 0.95, t) * f;
      this.col[j + 1] = lerp(0.64, 0.6, t) * f;
      this.col[j + 2] = lerp(0.68, 0.3, t) * f;
    }
    if (alive || this.alive) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
    this.alive = alive;
  }
}

/* ==========================================================================
   Story state — everything derived from P
   ========================================================================== */
const PARK = { x: 3.8, y: 2.8 };
const FACE_X = X_FACE + 0.012;
const [G1, G2] = GROOVES;
const TH_START = THREAD.to + 0.07;
const TH_Y = stepRadius(2.2);
const SHOW = { x: 0.3, y: 0.85, z: 0.4, yaw: -0.28, tilt: 0.12 };

/** Lift, traverse, lower — keeps the tool clear of the work while it repositions. */
function travel(a, b, t) {
  const hi = Math.max(a.y, b.y) + 0.14;
  if (t < 0.3) return { x: a.x, y: lerp(a.y, hi, smooth(t / 0.3)) };
  const k = smooth((t - 0.3) / 0.7);
  return { x: lerp(a.x, b.x, k), y: lerp(hi, b.y, k) };
}

function stateAt(P) {
  const s = {};
  s.spindle = smooth(norm(P, 1.12, 1.75)) * (1 - smooth(norm(P, 3.98, 4.22)));

  // Facing
  const fT = norm(P, 2.0, 2.16);
  const faceY = (R0 + 0.1) * (1 - fT);
  s.face = clamp01(1 - faceY / R0);

  // Turning
  s.cut = norm(P, 2.24, 2.94);
  s.cutX = lerp(X_FACE + 1e-4, CUT_END, s.cut);

  // Grooving
  const g1Y = lerp(G1.r + 0.12, G1.r - G1.d, norm(P, 3.04, 3.2));
  s.g1 = clamp01((G1.r - g1Y) / G1.d);
  const g2Y = lerp(G2.r + 0.12, G2.r - G2.d, norm(P, 3.28, 3.42));
  s.g2 = clamp01((G2.r - g2Y) / G2.d);

  // Threading — three passes, each deeper
  const tT = norm(P, 3.5, 3.95);
  const pf = tT * THREAD.passes;
  const pass = Math.min(THREAD.passes - 1, Math.floor(pf));
  const local = pf - pass;
  const feed = clamp01(local / 0.7);
  s.thread = (pass + feed) / THREAD.passes;

  // Detach, inspect, showcase
  s.detach = smooth(norm(P, 4.12, 4.6));
  s.finish = s.detach;
  s.machineFade = smooth(norm(P, 4.2, 4.9));
  s.scan = norm(P, 4.46, 4.58) * (1 - norm(P, 4.98, 5.12));
  s.scanX = lerp(PART_L + 0.06, X_FACE - 0.05, smooth(norm(P, 4.56, 4.98)));
  s.showcase = norm(P, 4.6, 5.2);

  // Tool path
  let tool = PARK;
  let cutting = false;
  if (P < 1.6) tool = PARK;
  else if (P < 2.0) tool = travel(PARK, { x: FACE_X, y: R0 + 0.1 }, norm(P, 1.6, 2.0));
  else if (P < 2.16) {
    tool = { x: FACE_X, y: faceY };
    cutting = faceY < R0 && fT < 1;
  } else if (P < 2.24) tool = { x: FACE_X, y: lerp(0, TH_Y, smooth(norm(P, 2.16, 2.24))) };
  else if (P < 2.94) {
    tool = { x: s.cutX, y: stepRadius(s.cutX + 1e-3) };
    cutting = s.cut < 1;
  } else if (P < 3.04)
    tool = travel({ x: CUT_END, y: stepRadius(CUT_END + 1e-3) }, { x: G1.x, y: G1.r + 0.12 }, norm(P, 2.94, 3.04));
  else if (P < 3.2) {
    tool = { x: G1.x, y: g1Y };
    cutting = s.g1 > 0 && s.g1 < 1;
  } else if (P < 3.28) tool = travel({ x: G1.x, y: G1.r - G1.d }, { x: G2.x, y: G2.r + 0.12 }, norm(P, 3.2, 3.28));
  else if (P < 3.42) {
    tool = { x: G2.x, y: g2Y };
    cutting = s.g2 > 0 && s.g2 < 1;
  } else if (P < 3.5) tool = travel({ x: G2.x, y: G2.r - G2.d }, { x: TH_START, y: TH_Y }, norm(P, 3.42, 3.5));
  else if (P < 3.95) {
    const depthY = TH_Y - THREAD.depth * s.thread;
    if (local < 0.7) {
      tool = { x: lerp(TH_START, THREAD.from - 0.01, feed), y: depthY };
      cutting = true;
    } else {
      const r = (local - 0.7) / 0.3;
      const lift = TH_Y + 0.08;
      const nextY = TH_Y - THREAD.depth * Math.min(1, (pass + 1) / THREAD.passes);
      if (r < 0.2) tool = { x: THREAD.from - 0.01, y: lerp(depthY, lift, smooth(r / 0.2)) };
      else if (r < 0.85) tool = { x: lerp(THREAD.from - 0.01, TH_START, smooth((r - 0.2) / 0.65)), y: lift };
      else tool = { x: TH_START, y: lerp(lift, nextY, smooth((r - 0.85) / 0.15)) };
    }
  } else tool = travel({ x: TH_START, y: TH_Y }, PARK, norm(P, 3.95, 4.15));

  s.tool = tool;
  s.cutting = cutting;
  return s;
}

/* Camera keyframes: P, look-at target, distance, azimuth, elevation, horizontal frame shift
   (positive shift = model sits right of centre, leaving room for text on the left). */
const KEYS = [
  { p: 0.0, t: [-0.2, 0.25, 0], d: 11, az: 0.5, el: 0.26, sx: 0.17 },
  { p: 0.75, t: [-0.6, 0.15, 0], d: 9.6, az: 0.3, el: 0.22, sx: 0.12 },
  { p: 1.5, t: [-1.3, 0.1, 0], d: 7.2, az: -0.45, el: 0.22, sx: -0.18 },
  { p: 2.55, t: [0.6, 0.25, 0], d: 7.0, az: 0.3, el: 0.34, sx: 0.17 },
  { p: 3.6, t: [1.5, 0.25, 0], d: 4.9, az: 0.55, el: 0.28, sx: -0.17 },
  { p: 4.6, t: [0.3, 0.72, 0.35], d: 8.2, az: -0.12, el: 0.14, sx: 0.2 },
  { p: 5.5, t: [0.3, 0.8, 0.4], d: 9.2, az: -0.32, el: 0.2, sx: -0.22 },
  { p: 6.0, t: [0.3, 0.8, 0.4], d: 9.6, az: -0.5, el: 0.22, sx: -0.22 },
];

function cameraAt(P, time) {
  let i = 0;
  while (i < KEYS.length - 2 && P > KEYS[i + 1].p) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(norm(P, a.p, b.p));
  const heroW = 1 - smooth(norm(P, 0, 0.9));
  return {
    tx: lerp(a.t[0], b.t[0], t),
    ty: lerp(a.t[1], b.t[1], t),
    tz: lerp(a.t[2], b.t[2], t),
    d: lerp(a.d, b.d, t),
    az: lerp(a.az, b.az, t) + Math.sin(time * 0.23) * 0.2 * heroW + Math.sin(time * 0.11) * 0.025,
    el: lerp(a.el, b.el, t) + Math.sin(time * 0.17) * 0.035 * heroW,
    sx: lerp(a.sx, b.sx, t),
  };
}

/* ==========================================================================
   Home page: scroll story
   ========================================================================== */
export async function initStoryScene(canvas, { onProgress = () => {} } = {}) {
  const mobile = isMobileDevice();
  const renderer = createRenderer(canvas, mobile);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 8, 22);
  onProgress(0.15);

  scene.environment = createEnvironment(renderer);
  scene.environmentIntensity = 0.5;
  onProgress(0.45);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const { amber } = addLights(scene);

  const machine = buildMachine(mobile);
  scene.add(machine.group);

  const part = new TurnedPart(mobile ? 40 : 72);
  part.mesh.position.x = -PART_CENTER;
  const partGroup = new THREE.Group();
  partGroup.rotation.order = 'YZX'; // spin about own axis first, then tilt/yaw
  partGroup.add(part.mesh);
  scene.add(partGroup);

  // Inspection ring (child of the part so it follows the showcase tilt)
  const scanGroup = new THREE.Group();
  scanGroup.rotation.y = Math.PI / 2;
  const scanMat = (o) =>
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, ...o });
  const ringMat = scanMat({});
  const glowMat = scanMat({ blending: THREE.AdditiveBlending });
  const discMat = scanMat({ blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  scanGroup.add(
    new THREE.Mesh(new THREE.TorusGeometry(1, 0.016, 8, 128), ringMat),
    new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 12, 128), glowMat),
    new THREE.Mesh(new THREE.CircleGeometry(1, 64), discMat)
  );
  scanGroup.visible = false;
  partGroup.add(scanGroup);

  const chipTex = makeChipTexture();
  const chips = new Chips(mobile ? 160 : 420, chipTex);
  scene.add(chips.points);
  const chipRatePerSec = mobile ? 110 : 260;
  onProgress(0.7);

  /* ----- layout ----- */
  let width = 0;
  let height = 0;
  const layout = { fit: 1, shiftScale: 1, portrait: false };
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    layout.portrait = aspect < 0.9;
    camera.fov = layout.portrait ? 40 : 34;
    layout.fit = aspect >= 1.45 ? 1 : Math.min(2.5, 1.45 / aspect);
    layout.shiftScale = aspect > 1.25 ? 1 : aspect > 0.9 ? 0.5 : 0;
    camera.updateProjectionMatrix();
  }

  /* ----- state ----- */
  let targetP = 0;
  let P = 0;
  let time = 0;
  let chuckAngle = 0;
  let partSpin = 0;
  let last = performance.now();
  let machineDim = 1;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const showLight = new THREE.Vector3(2.6, 1.9, -1.2);
  const MAX_W = 9; // rad/s

  function apply(dt, pSpeed) {
    const s = stateAt(P);
    part.update(s);

    // Spindle & part rotation
    const w = s.spindle * MAX_W;
    chuckAngle += w * dt;
    partSpin += (w + s.showcase * 0.45) * dt;
    machine.spindle.rotation.x = chuckAngle;

    const d = s.detach;
    partGroup.position.set(
      lerp(PART_CENTER, SHOW.x, d),
      lerp(0, SHOW.y, d) + Math.sin(Math.PI * d) * 0.12,
      lerp(0, SHOW.z, d)
    );
    partGroup.rotation.set(partSpin, lerp(0, SHOW.yaw, d), lerp(0, SHOW.tilt, d));

    // Tool
    machine.tool.position.set(s.tool.x, s.tool.y, 0);

    // Machine dims into the background so the finished part takes focus
    // (darkening the colour keeps it opaque — no see-through artefacts)
    const dim = 1 - 0.93 * s.machineFade;
    if (Math.abs(dim - machineDim) > 1e-3) {
      machineDim = dim;
      for (const m of machine.materials) m.color.copy(m.userData.base).multiplyScalar(dim);
    }
    machine.tool.visible = s.machineFade < 0.6;

    // Chips — only while cutting AND while the scroll is actually feeding the tool
    const feedRate = s.cutting ? clamp01(pSpeed / 0.35) * s.spindle : 0;
    tmp.set(s.tool.x, s.tool.y, 0.02);
    chips.update(dt, feedRate, tmp, chipRatePerSec);

    // Inspection ring
    scanGroup.visible = s.scan > 0.001;
    if (scanGroup.visible) {
      const rr = finishedRadius(s.scanX) + 0.07;
      scanGroup.position.x = s.scanX - PART_CENTER;
      scanGroup.scale.set(rr, rr, 1);
      ringMat.opacity = s.scan;
      glowMat.opacity = s.scan * 0.22;
      discMat.opacity = s.scan * 0.07;
    }

    // Warm accent light: follows the cutting zone, then the scan ring, then rims the final part
    tmp.set(s.tool.x + 0.35, s.tool.y + 0.55, 1.2);
    if (d > 0) tmp.lerp(showLight, d);
    if (s.scan > 0) {
      scanGroup.getWorldPosition(tmp2);
      tmp2.y += 0.5;
      tmp2.z += 1.0;
      tmp.lerp(tmp2, s.scan);
    }
    amber.position.lerp(tmp, 1 - Math.exp(-dt * 5));
    amber.intensity = 3.5 + feedRate * 5 + s.scan * 4 + s.showcase * 2;

    // Camera
    const c = cameraAt(P, time);
    const dist = c.d * layout.fit;
    camera.position.set(
      c.tx + dist * Math.sin(c.az) * Math.cos(c.el),
      c.ty + dist * Math.sin(c.el),
      c.tz + dist * Math.cos(c.az) * Math.cos(c.el)
    );
    camera.lookAt(c.tx, c.ty, c.tz);
    scene.fog.near = dist * 0.8;
    scene.fog.far = dist * 2.4 + 4;

    const sx = c.sx * layout.shiftScale;
    const sy = layout.portrait ? 0.2 : 0;
    if (sx || sy) camera.setViewOffset(width, height, -sx * width, sy * height, width, height);
    else camera.clearViewOffset();
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now;
    time += dt;
    const prev = P;
    P = Math.abs(targetP - P) < 1e-4 ? targetP : P + (targetP - P) * (1 - Math.exp(-dt * 8));
    apply(dt, Math.abs(P - prev) / dt);
    renderer.render(scene, camera);
  }

  /* ----- run control: pause when hidden, faded out or off-screen ----- */
  let running = false;
  let wanted = true;
  let onScreen = true;
  let disposed = false;
  function updateLoop() {
    const run = !disposed && wanted && onScreen && !document.hidden;
    if (run && !running) {
      last = performance.now();
      renderer.setAnimationLoop(frame);
      running = true;
    } else if (!run && running) {
      renderer.setAnimationLoop(null);
      running = false;
    }
  }
  document.addEventListener('visibilitychange', updateLoop);
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    updateLoop();
  });
  io.observe(canvas);
  const ro = new ResizeObserver(() => {
    resize();
    if (!running && !disposed) renderer.render(scene, camera);
  });
  ro.observe(canvas);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    disposed = true;
    updateLoop();
    document.documentElement.classList.remove('has-3d');
    document.documentElement.classList.add('no-3d');
  });

  /* ----- first frame ----- */
  resize();
  apply(0, 0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  onProgress(1);
  canvas.classList.add('is-ready');
  updateLoop();

  return {
    setProgress(p) {
      targetP = Math.min(6, Math.max(0, p));
    },
    setActive(active) {
      wanted = active;
      updateLoop();
    },
    dispose() {
      disposed = true;
      updateLoop();
      io.disconnect();
      ro.disconnect();
      part.dispose();
      chipTex.dispose();
      renderer.dispose();
    },
  };
}

/* ==========================================================================
   About page: small rotating finished part
   ========================================================================== */
export async function initShowcase(canvas) {
  const mobile = isMobileDevice();
  const renderer = createRenderer(canvas, true);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);
  scene.environmentIntensity = 0.55;
  const { amber } = addLights(scene);
  amber.position.set(2.2, 1.4, -1.6);
  amber.intensity = 6;

  const part = new TurnedPart(mobile ? 40 : 56);
  part.update(FINAL_STATE);
  part.mesh.position.x = -PART_CENTER;
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  group.rotation.z = 0.14;
  group.rotation.y = -0.34;
  group.add(part.mesh);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  let width = 0;
  let height = 0;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const halfW = 2.7;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfW / (tanH * camera.aspect), 1.4 / tanH);
    camera.position.set(0.2, dist * 0.18, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  let last = performance.now();
  let t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    group.rotation.x = t * 0.6;
    group.rotation.y = -0.34 + Math.sin(t * 0.25) * 0.12;
    renderer.render(scene, camera);
  }

  let running = false;
  let onScreen = false;
  function updateLoop() {
    const run = onScreen && !document.hidden;
    if (run && !running) {
      last = performance.now();
      renderer.setAnimationLoop(frame);
      running = true;
    } else if (!run && running) {
      renderer.setAnimationLoop(null);
      running = false;
    }
  }
  document.addEventListener('visibilitychange', updateLoop);
  new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    updateLoop();
  }).observe(canvas);
  new ResizeObserver(() => {
    resize();
    if (!running) renderer.render(scene, camera);
  }).observe(canvas);

  resize();
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  updateLoop();
}
