/**
 * Procedural slant-bed CNC turning centre.
 *
 * Coordinates (1 unit ≈ 50 mm): spindle axis = world X at y = z = 0, chuck on the left,
 * operator / door side = +Z. The turret works from the upper back on a 45° slant bed.
 *
 * Moving parts exposed for the timeline:
 *   spindle   rotates about X (chuck, jaws, held bar)
 *   turret    {mount, disc}: mount follows the tool tip, disc indexes stations
 *   door      slides along X (open → left)
 * Every visible element is bevelled, revolved or extruded — no raw boxes.
 * A GLB (assets/models/cnc-lathe.glb) can replace the static shell; see ASSETS.md.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TurnedMesh, R0, PART_L } from './workpiece.js';
import { rng } from './util.js';

export const CHUCK_FACE = -1.97;
export const SLANT = Math.PI / 4;
export const DIR = new THREE.Vector3(0, Math.sin(SLANT), -Math.cos(SLANT)); // tool approach (axis → tool)
export const TAN = new THREE.Vector3(0, Math.cos(SLANT), Math.sin(SLANT)); // bed normal, up-front
export const TOOL_REACH = 3.55; // turret centre → tool tip
export const STATIONS = 8;
export const TOOLS = { blank: 7, turning: 0, grooving: 1, threading: 2 };

export const ENCLOSURE = {
  inner: { x0: -4.0, x1: 7.6, y0: -5.6, y1: 6.6, z0: -7.0, z1: 4.0 },
  opening: { x0: -3.6, x1: 6.8, y0: -4.6, y1: 5.4 },
  front: 4.6, // outer face of the front panels
  doorZ: 4.86, // glass plane when closed
  outer: { x0: -16, x1: 14, y0: -21, y1: 10, z0: -14 },
  floorY: -21,
};
export const DOOR_TRAVEL = 10.8;
const BED_K = -2.83; // bed plane: TAN · p = BED_K

function mesh(geo, mat, { cast = true, receive = true, name } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (name) m.name = name;
  return m;
}
const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

/** Revolved part around X from [x, r] pairs (crisp edges, circumferential tangents). */
function revolve(points, mat, segments) {
  const t = new TurnedMesh([mat, mat], { radialSegments: segments });
  t.build(points.map(([x, r]) => ({ x, r, cut: true })));
  // freeze into a compact static geometry
  const g = t.geometry;
  const count = g.drawRange.count;
  const nv = t.vc;
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'tangent']) {
    const a = g.getAttribute(name);
    geo.setAttribute(name, new THREE.BufferAttribute(a.array.slice(0, nv * a.itemSize), a.itemSize));
  }
  geo.setIndex(new THREE.BufferAttribute(g.index.array.slice(0, count), 1));
  geo.computeBoundingSphere();
  t.dispose();
  return mesh(geo, mat);
}

/** Socket-head cap screw pointing along +X (head top at x = 0). */
function capScrew(radius, mat, dark, segs = 24) {
  const g = new THREE.Group();
  const head = revolve(
    [
      [-radius * 1.4, 0],
      [-radius * 1.4, radius * 0.92],
      [-radius * 1.3, radius],
      [-radius * 0.12, radius],
      [0, radius * 0.86],
      [0, 0],
    ],
    mat,
    segs
  );
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, 0.004, 6).rotateZ(Math.PI / 2), dark);
  hex.position.x = 0.001;
  g.add(head, hex);
  return g;
}

/** Extrudes a 2D shape (in the plane of local X/Y) along local Z, with bevelled edges. */
function extrude(shape, depth, bevel, mat, curveSegments = 6) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return mesh(geo, mat);
}

function poly(points) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

/* ==========================================================================
   Chuck, jaws, held bar
   ========================================================================== */
function buildSpindle(M, segs) {
  const spindle = new THREE.Group();
  spindle.name = 'spindle';

  // Chuck body: machined steel with chamfers, front recess and centre bore
  const body = revolve(
    [
      [-3.6, 0.0],
      [-3.6, 1.86],
      [-3.5, 1.98],
      [-2.12, 1.98],
      [CHUCK_FACE, 1.86],
      [CHUCK_FACE, 1.2],
      [CHUCK_FACE - 0.04, 1.16],
      [CHUCK_FACE - 0.04, 0.9],
      [CHUCK_FACE, 0.86],
      [CHUCK_FACE, 0.62],
      [CHUCK_FACE - 0.3, 0.6],
      [CHUCK_FACE - 0.3, 0],
    ],
    M.chuckSteel,
    segs
  );
  spindle.add(body);

  // Back plate / spindle adapter (dark, recessed into the headstock wall)
  spindle.add(revolve([[-4.3, 0], [-4.3, 1.7], [-4.2, 1.8], [-3.6, 1.8], [-3.6, 0]], M.blackOxide, segs));

  // Hard jaws: stepped profile in (radial, axial), extruded across the jaw width
  const jawShape = poly([
    [R0, 0],
    [R0, 0.2],
    [0.96, 0.2],
    [0.96, 0.34],
    [1.74, 0.34],
    [1.74, 0],
  ]);
  const jawGeo = new THREE.ExtrudeGeometry(jawShape, { depth: 0.44, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 2, curveSegments: 1 });
  jawGeo.translate(0, 0, -0.22);
  jawGeo.computeVertexNormals();
  // shape X = radial (→ world Y in the jaw frame), shape Y = axial (→ world +X)
  jawGeo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)));

  const masterGeo = rbox(0.06, 2.0 - 1.0, 0.56, 0.02);
  const slotGeo = new THREE.BoxGeometry(0.01, 0.4, 0.62);
  const jaws = [];
  for (let k = 0; k < 3; k++) {
    const pivot = new THREE.Group();
    pivot.rotation.x = (k * Math.PI * 2) / 3;
    const jaw = mesh(jawGeo, M.jawSteel);
    jaw.position.x = CHUCK_FACE;
    pivot.add(jaw);
    // master jaw guide + slot beyond the top jaw
    const master = mesh(masterGeo, M.groundSteel);
    master.position.set(CHUCK_FACE + 0.02, 1.48, 0);
    const slot = mesh(slotGeo, M.panelLine, { cast: false });
    slot.position.set(CHUCK_FACE + 0.003, 1.78, 0);
    pivot.add(master, slot);
    // two cap screws holding the top jaw
    for (const r of [1.16, 1.5]) {
      const s = capScrew(0.07, M.blackOxide, M.panelLine, 20);
      s.position.set(CHUCK_FACE + 0.34 + 0.001, r, 0);
      pivot.add(s);
    }
    // chuck body screws between the jaws
    const bp = new THREE.Group();
    bp.rotation.x = (k * Math.PI * 2) / 3 + Math.PI / 3;
    const bs = capScrew(0.085, M.blackOxide, M.panelLine, 20);
    bs.position.set(CHUCK_FACE + 0.001, 1.42, 0);
    bp.add(bs);
    spindle.add(pivot, bp);
    jaws.push(jaw);
  }

  // Bar stock held in the chuck (mill scale), parted face at PART_L
  const stub = revolve(
    [
      [-3.3, 0],
      [-3.3, R0],
      [PART_L, R0],
      [PART_L, 0],
    ],
    M.rawStock,
    segs
  );
  spindle.add(stub);

  return { spindle, jaws, body };
}

/* ==========================================================================
   Turret + tooling
   ========================================================================== */
function rhombus(nose, bisector, angleDeg, edge) {
  const half = THREE.MathUtils.degToRad(angleDeg / 2);
  const back = bisector.clone().multiplyScalar(-1);
  const e1 = back.clone().rotateAround(new THREE.Vector2(), half).multiplyScalar(edge);
  const e2 = back.clone().rotateAround(new THREE.Vector2(), -half).multiplyScalar(edge);
  return poly([
    [nose.x, nose.y],
    [nose.x + e1.x, nose.y + e1.y],
    [nose.x + e1.x + e2.x, nose.y + e1.y + e2.y],
    [nose.x + e2.x, nose.y + e2.y],
  ]);
}

/**
 * Tool in station-local space: tip at (0, TOOL_REACH, 0); local +Y points to the
 * spindle when active; rake face at z = 0 facing −Z (toward the operator).
 */
function buildTool(type, M) {
  const g = new THREE.Group();
  const tip = TOOL_REACH;
  const insT = 0.095;

  const addInsert = (shape) => {
    const ins = extrude(shape, insT, 0.006, M.carbide, 4);
    ins.position.z = insT / 2;
    // thin TiN-coated land around the cutting edge: the amber glint
    const land = extrude(shape, 0.012, 0.004, M.tinCoat, 4);
    land.position.z = 0.004;
    land.scale.set(1.012, 1.012, 1);
    g.add(ins, land);
  };

  if (type === 'turning') {
    const shape = rhombus(new THREE.Vector2(0, tip), new THREE.Vector2(-0.45, 1).normalize(), 80, 0.26);
    addInsert(shape);
    const head = mesh(rbox(0.46, 0.5, 0.36, 0.04), M.blackOxide);
    head.position.set(0.14, tip - 0.38, insT + 0.18);
    const shank = mesh(rbox(0.4, 0.62, 0.4, 0.03), M.blackOxide);
    shank.position.set(0.12, tip - 0.86, 0.2);
    const clamp = mesh(rbox(0.2, 0.16, 0.08, 0.025), M.blackOxide);
    clamp.position.set(0.16, tip - 0.2, -0.03);
    const screw = capScrew(0.045, M.groundSteel, M.panelLine, 16);
    screw.rotation.y = Math.PI / 2;
    screw.position.set(0.2, tip - 0.3, -0.075);
    g.add(head, shank, clamp, screw);
  } else if (type === 'threading') {
    const s = 0.24;
    const shape = poly([
      [0, tip],
      [-s * Math.sin(Math.PI / 6), tip - s * Math.cos(Math.PI / 6)],
      [s * Math.sin(Math.PI / 6), tip - s * Math.cos(Math.PI / 6)],
    ]);
    addInsert(shape);
    const head = mesh(rbox(0.42, 0.48, 0.34, 0.04), M.blackOxide);
    head.position.set(0.02, tip - 0.42, insT + 0.17);
    const shank = mesh(rbox(0.4, 0.6, 0.4, 0.03), M.blackOxide);
    shank.position.set(0.02, tip - 0.88, 0.2);
    const clamp = mesh(rbox(0.18, 0.14, 0.07, 0.025), M.blackOxide);
    clamp.position.set(0.0, tip - 0.27, -0.03);
    g.add(head, shank, clamp);
  } else if (type === 'grooving') {
    const w = 0.08;
    const blade = mesh(rbox(0.06, 0.62, 0.44, 0.012), M.groundSteel);
    blade.position.set(0, tip - 0.4, 0.22);
    const insert = extrude(poly([[-w / 2, tip], [w / 2, tip], [w / 2 - 0.004, tip - 0.2], [-w / 2 + 0.004, tip - 0.2]]), insT, 0.004, M.carbide, 2);
    insert.position.z = insT / 2;
    const land = extrude(poly([[-w / 2, tip], [w / 2, tip], [w / 2, tip - 0.03], [-w / 2, tip - 0.03]]), 0.012, 0.002, M.tinCoat, 2);
    land.position.z = 0.004;
    const holder = mesh(rbox(0.42, 0.5, 0.56, 0.04), M.blackOxide);
    holder.position.set(0.24, tip - 0.85, 0.24);
    g.add(blade, insert, land, holder);
  } else if (type === 'boring' || type === 'drill') {
    const bar = mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 24).rotateZ(Math.PI / 2), type === 'drill' ? M.groundSteel : M.blackOxide);
    bar.position.set(-0.85, 2.55, 0);
    const holder = mesh(rbox(0.6, 0.5, 0.5, 0.05), M.blackOxide);
    holder.position.set(-0.45, 2.55, 0);
    g.add(bar, holder);
  }
  return g;
}

function buildTurret(M) {
  const mount = new THREE.Group();
  mount.name = 'turret';

  // Housing on the cross-slide, aligned to the slant (local +Y = DIR, local +Z = TAN)
  const slant = new THREE.Group();
  slant.rotation.x = -SLANT;
  mount.add(slant);
  const housing = mesh(rbox(2.3, 3.0, 3.0, 0.16, 4), M.castGrey);
  housing.position.set(1.6, 0.25, 0);
  slant.add(housing);
  const cap = mesh(rbox(0.5, 2.4, 2.4, 0.12, 3), M.paintDark);
  cap.position.set(2.85, 0.25, 0);
  slant.add(cap);
  // saddle down to the bed plane, which lies 2.83 units below the turret centre along −TAN
  const saddle = mesh(rbox(3.6, 3.2, 1.36, 0.1, 3), M.castGrey);
  saddle.position.set(1.4, 0.3, -2.15);
  slant.add(saddle);

  // Disc (octagonal), indexes about X
  const disc = new THREE.Group();
  disc.name = 'turret-disc';
  mount.add(disc);
  const oct = [];
  for (let i = 0; i < STATIONS; i++) {
    const a = ((i + 0.5) / STATIONS) * Math.PI * 2;
    oct.push([Math.cos(a) * 2.38, Math.sin(a) * 2.38]);
  }
  const discMesh = extrude(poly(oct), 0.9, 0.05, M.castGrey, 1);
  // shape in X/Y extruded along Z → rotate so the extrusion runs along world X
  discMesh.geometry.rotateY(Math.PI / 2);
  disc.add(discMesh);
  const hub = revolve([[-0.55, 0], [-0.55, 0.9], [-0.5, 0.95], [-0.45, 0.95], [-0.45, 0]], M.groundSteel, 48);
  disc.add(hub);

  const stations = [];
  const types = ['turning', 'grooving', 'threading', null, 'boring', 'drill', null, null];
  for (let k = 0; k < STATIONS; k++) {
    const st = new THREE.Group();
    st.rotation.x = (k / STATIONS) * Math.PI * 2 - Math.PI / 2; // local +Y = (0, cos θk, sin θk)
    const block = mesh(rbox(0.86, 0.74, 0.9, 0.06), M.blackOxide);
    block.position.set(0, 2.6, 0);
    st.add(block);
    for (const zz of [-0.28, 0.28]) {
      const sc = capScrew(0.05, M.blackOxide, M.panelLine, 16);
      sc.rotation.y = Math.PI; // head faces the chuck side of the block
      sc.position.set(-0.43, 2.6, zz);
      st.add(sc);
    }
    if (types[k]) st.add(buildTool(types[k], M));
    else {
      const blank = mesh(rbox(0.7, 0.18, 0.7, 0.05), M.groundSteel);
      blank.position.set(0, 3.02, 0);
      st.add(blank);
    }
    // coolant outlet (aimed at the tool tip)
    const nozzle = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 16), M.groundSteel);
    nozzle.position.set(0.26, 3.05, -0.36);
    nozzle.lookAt(new THREE.Vector3(0, TOOL_REACH, -0.02));
    nozzle.rotateX(Math.PI / 2);
    st.add(nozzle);
    disc.add(st);
    stations.push(st);
  }
  const NOZZLE_LOCAL = new THREE.Vector3(0.26, 3.05, -0.36);
  return { mount, disc, stations, nozzleLocal: NOZZLE_LOCAL };
}

/** Disc angle (about X) that points station k at the spindle. */
export function stationAngle(k) {
  // station local +Y = (0, cos θ, sin θ) with θ = 2πk/N − π/2; we need it along −DIR (angle 135° in YZ)
  const theta = (k / STATIONS) * Math.PI * 2 - Math.PI / 2;
  return (Math.PI * 3) / 4 - theta;
}

/* ==========================================================================
   Enclosure, bed, tailstock, door, work light, status lamp
   ========================================================================== */
function buildShell(M, tier) {
  const shell = new THREE.Group();
  shell.name = 'shell';
  const { inner: I, opening: O, outer: X, front } = ENCLOSURE;
  const add = (o) => (shell.add(o), o);

  // --- interior walls (brushed stainless) ---
  const wallT = 0.12;
  const left = add(mesh(new THREE.BoxGeometry(wallT, I.y1 - I.y0, I.z1 - I.z0), M.stainless));
  left.position.set(I.x0 - wallT / 2, (I.y0 + I.y1) / 2, (I.z0 + I.z1) / 2);
  const right = add(mesh(new THREE.BoxGeometry(wallT, I.y1 - I.y0, I.z1 - I.z0), M.stainless));
  right.position.set(I.x1 + wallT / 2, (I.y0 + I.y1) / 2, (I.z0 + I.z1) / 2);
  const ceil = add(mesh(new THREE.BoxGeometry(I.x1 - I.x0 + 0.3, wallT, I.z1 - I.z0), M.stainless));
  ceil.position.set((I.x0 + I.x1) / 2, I.y1 + wallT / 2, (I.z0 + I.z1) / 2);
  // back wall above the slant bed (the bed plane meets z = z0 at y ≈ 3)
  const back = add(mesh(new THREE.BoxGeometry(I.x1 - I.x0, I.y1 - 2.4, wallT), M.stainless));
  back.position.set((I.x0 + I.x1) / 2, (I.y1 + 2.4) / 2, I.z0);

  // Spindle labyrinth cover on the left wall
  const lab = revolve([[I.x0 + 0.01, 0], [I.x0 + 0.01, 2.5], [I.x0 + 0.08, 2.42], [I.x0 + 0.08, 2.05], [I.x0 + 0.01, 1.95], [I.x0 + 0.01, 0]], M.paintDark, 64);
  add(lab);

  // --- slant bed with telescopic way covers ---
  const bedFrame = new THREE.Group();
  bedFrame.rotation.x = -SLANT; // local Y along DIR, local Z along −TAN
  // place the frame origin on the bed plane under the spindle axis
  bedFrame.position.copy(TAN.clone().multiplyScalar(BED_K));
  add(bedFrame);
  // telescopic way-cover segments, stepping up toward the turret side
  const span = I.x1 - I.x0;
  for (let i = 0; i < 6; i++) {
    const seg = mesh(rbox(span / 6 + 0.25, 12.0, 0.08, 0.03, 2), M.stainless);
    seg.position.set(I.x0 + (i + 0.5) * (span / 6), 1.0, 0.05 * i);
    bedFrame.add(seg);
  }

  // --- chip trough + hinge-belt conveyor at the bottom ---
  const trough = add(mesh(rbox(I.x1 - I.x0, 0.2, 3.4, 0.05), M.stainless));
  trough.position.set((I.x0 + I.x1) / 2, I.y0, 2.3);
  const belt = add(mesh(new THREE.BoxGeometry(I.x1 - I.x0 - 0.6, 0.06, 1.6), M.blackOxide));
  belt.position.set((I.x0 + I.x1) / 2, I.y0 + 0.13, 2.1);
  const plates = [];
  for (let i = 0; i < 40; i++) {
    const p = new THREE.BoxGeometry(0.035, 0.05, 1.6);
    p.translate(I.x0 + 0.4 + i * ((I.x1 - I.x0 - 0.8) / 40), I.y0 + 0.18, 2.1);
    plates.push(p);
  }
  const beltPlates = add(mesh(mergeGeometries(plates), M.groundSteel));

  // --- tailstock (retracted) ---
  const tail = new THREE.Group();
  tail.name = 'tailstock';
  const tBody = mesh(rbox(2.0, 2.4, 2.4, 0.18, 4), M.castGrey);
  tBody.position.set(6.4, -0.5, -0.9);
  const tFoot = mesh(rbox(2.4, 1.4, 3.2, 0.12, 3), M.castGrey);
  tFoot.position.set(6.4, -2.2, -1.9);
  tFoot.rotation.x = -SLANT;
  const quillH = revolve([[5.3, 0], [5.3, 0.62], [5.36, 0.68], [7.3, 0.68], [7.3, 0]], M.paintDark, 48);
  const quill = revolve([[4.62, 0], [4.62, 0.36], [4.66, 0.4], [5.32, 0.4], [5.32, 0]], M.groundSteel, 48);
  const centre = revolve([[4.0, 0], [4.1, 0.08], [4.42, 0.24], [4.48, 0.3], [4.64, 0.3], [4.64, 0]], M.groundSteel, 48);
  tail.add(tBody, tFoot, quillH, quill, centre);
  add(tail);

  // --- LED work light bar (ceiling, front) ---
  const ledHousing = add(mesh(rbox(7.6, 0.34, 0.7, 0.08), M.paintDark));
  ledHousing.position.set(1.8, I.y1 - 0.2, 2.6);
  ledHousing.rotation.x = 0.35;
  const ledPanel = add(mesh(rbox(7.2, 0.05, 0.42, 0.02), M.led, { cast: false }));
  ledPanel.position.set(1.8, I.y1 - 0.38, 2.68);
  ledPanel.rotation.x = 0.35;

  // --- exterior sheet metal ---
  const T = 0.55; // front panel depth
  const zf = front - T / 2;
  const light = M.paintLight;
  const dark = M.paintDark;
  const gap = 0.07;
  const panel = (x0, x1, y0, y1, mat, z = zf, depth = T, rad = 0.12) => {
    const p = add(mesh(rbox(x1 - x0 - gap, y1 - y0 - gap, depth, rad, 3), mat));
    p.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
    return p;
  };
  // around the door opening
  panel(X.x0, O.x0, -8, X.y1, dark); // left upper (the door parks in front of it)
  panel(O.x1, X.x1, -8, X.y1, light); // right upper
  panel(O.x0, O.x1, O.y1, X.y1, light); // header above the opening
  panel(O.x0, O.x1, -8, O.y0, dark); // sill below the opening
  panel(X.x0, X.x1, X.y0 + 1.2, -8, dark, zf, T, 0.16); // base
  // toe kick
  const toe = add(mesh(rbox(X.x1 - X.x0 - 0.6, 1.2, T, 0.08), M.rubber));
  toe.position.set((X.x0 + X.x1) / 2, X.y0 + 0.6, zf - 0.3);
  // opening reveal (frame lip)
  const lip = new THREE.Shape();
  lip.moveTo(O.x0 - 0.3, O.y0 - 0.3);
  lip.lineTo(O.x1 + 0.3, O.y0 - 0.3);
  lip.lineTo(O.x1 + 0.3, O.y1 + 0.3);
  lip.lineTo(O.x0 - 0.3, O.y1 + 0.3);
  lip.closePath();
  const hole = new THREE.Path();
  hole.moveTo(O.x0, O.y0);
  hole.lineTo(O.x0, O.y1);
  hole.lineTo(O.x1, O.y1);
  hole.lineTo(O.x1, O.y0);
  hole.closePath();
  lip.holes.push(hole);
  const lipMesh = extrude(lip, 0.5, 0.06, M.paintDark, 1);
  lipMesh.position.z = front - 0.2;
  add(lipMesh);
  // cabinet: rear volume behind the work zone + side/top/bottom blocks around it
  const zMid = (I.z0 + front) / 2 - 0.3;
  const dMid = front - I.z0;
  const block = (x0, x1, y0, y1, z0, z1, mat, rad = 0.25) => {
    const b = add(mesh(rbox(x1 - x0, y1 - y0, z1 - z0, rad, 3), mat));
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return b;
  };
  const body = block(X.x0, X.x1, X.y0, X.y1, X.z0, I.z0 - 0.2, light, 0.3);
  block(X.x0, I.x0 - 0.2, X.y0, X.y1, zMid - dMid / 2, zMid + dMid / 2, light);
  block(I.x1 + 0.2, X.x1, X.y0, X.y1, zMid - dMid / 2, zMid + dMid / 2, light);
  block(I.x0 - 0.4, I.x1 + 0.4, I.y1 + 0.2, X.y1, zMid - dMid / 2, zMid + dMid / 2, light);
  block(I.x0 - 0.4, I.x1 + 0.4, X.y0, I.y0 - 0.3, zMid - dMid / 2, zMid + dMid / 2, dark, 0.2);
  // dark accent band
  const band = add(mesh(rbox(X.x1 - X.x0 + 0.02, 0.5, 0.2, 0.06), dark));
  band.position.set((X.x0 + X.x1) / 2, -7.75, front + 0.02);

  // --- operator panel (right) ---
  const pendant = new THREE.Group();
  pendant.position.set(10.4, 1.8, front + 0.55);
  const pBody = mesh(rbox(5.2, 7.6, 1.1, 0.2, 4), dark);
  const pScreen = mesh(rbox(4.0, 2.8, 0.06, 0.04), M.screen, { cast: false });
  pScreen.position.set(0, 1.9, 0.56);
  pendant.add(pBody, pScreen);
  const keys = [];
  for (let iy = 0; iy < 4; iy++)
    for (let ix = 0; ix < 6; ix++) {
      const k = new THREE.BoxGeometry(0.42, 0.3, 0.08);
      k.translate(-1.6 + ix * 0.64, -0.3 - iy * 0.48, 0.58);
      keys.push(k);
    }
  pendant.add(mesh(mergeGeometries(keys), M.plastic, { cast: false }));
  for (let i = 0; i < 3; i++) {
    const knob = mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.2, 32).rotateX(Math.PI / 2), M.plastic);
    knob.position.set(-1.4 + i * 1.4, -2.75, 0.62);
    pendant.add(knob);
  }
  add(pendant);

  // --- status lamp stack (top right): one amber segment lit ---
  const stack = new THREE.Group();
  stack.position.set(12.4, X.y1, 2.6);
  const pole = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 16), M.groundSteel);
  pole.position.y = 0.4;
  stack.add(pole);
  const lampMats = [M.lampOff, M.statusAmber, M.lampOff];
  lampMats.forEach((m, i) => {
    const seg = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 32), m, { cast: false });
    seg.position.y = 1.08 + i * 0.54;
    stack.add(seg);
  });
  const lampCap = mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.12, 32), M.paintDark);
  lampCap.position.y = 1.08 + 3 * 0.54 - 0.2;
  stack.add(lampCap);
  add(stack);

  void tier;
  shell.userData.receivers = [bedFrame, trough, belt, beltPlates, tail];
  return { shell, ledPanel, body, stack };
}

function buildDoor(M) {
  const { opening: O, doorZ } = ENCLOSURE;
  const door = new THREE.Group();
  door.name = 'door';
  const w = O.x1 - O.x0 + 0.8;
  const h = O.y1 - O.y0 + 0.8;
  const cx = (O.x0 + O.x1) / 2;
  const cy = (O.y0 + O.y1) / 2;
  door.position.set(cx, cy, doorZ);

  const rect = (x0, y0, x1, y1, PathType = THREE.Path) => {
    const p = new PathType();
    p.moveTo(x0, y0);
    p.lineTo(x1, y0);
    p.lineTo(x1, y1);
    p.lineTo(x0, y1);
    p.closePath();
    return p;
  };
  // window: wide and tall so the frame stays out of the close-up shots
  const win = { x0: -w / 2 + 0.7, x1: w / 2 - 0.9, y0: -h / 2 + 1.2, y1: h / 2 - 0.7 };
  const frame = rect(-w / 2, -h / 2, w / 2, h / 2, THREE.Shape);
  frame.holes.push(rect(win.x0, win.y0, win.x1, win.y1));
  door.add(extrude(frame, 0.22, 0.05, M.paintLight, 1));

  // rubber gasket around the glass
  const gasket = rect(win.x0, win.y0, win.x1, win.y1, THREE.Shape);
  gasket.holes.push(rect(win.x0 + 0.12, win.y0 + 0.12, win.x1 - 0.12, win.y1 - 0.12));
  door.add(extrude(gasket, 0.12, 0.02, M.rubber, 1));

  const glassGeo = new THREE.PlaneGeometry(win.x1 - win.x0 - 0.2, win.y1 - win.y0 - 0.2);
  glassGeo.translate((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, 0);
  const glassTint = new THREE.Mesh(glassGeo, M.glassTint);
  const glassRefl = new THREE.Mesh(glassGeo, M.glassReflect);
  glassTint.renderOrder = 2;
  glassRefl.renderOrder = 3;
  glassTint.name = glassRefl.name = 'door-glass';
  door.add(glassTint, glassRefl);

  // handle (vertical bar on the right edge)
  const handle = new THREE.Group();
  const bar = mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.2, 24), M.groundSteel);
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.5, 16).rotateX(Math.PI / 2);
  const leg1 = mesh(legGeo, M.groundSteel);
  const leg2 = mesh(legGeo, M.groundSteel);
  leg1.position.set(0, 1.8, -0.25);
  leg2.position.set(0, -1.8, -0.25);
  handle.add(bar, leg1, leg2);
  handle.position.set(w / 2 - 0.45, 0, 0.5);
  door.add(handle);

  return { door, closedX: cx, glass: [glassTint, glassRefl] };
}

/* ==========================================================================
   Assembly
   ========================================================================== */
export function buildMachine(M, tier) {
  const segs = tier.radialSegments >= 128 ? 128 : 72;
  const group = new THREE.Group();
  group.name = 'machine';
  const { spindle, jaws } = buildSpindle(M, segs);
  const turret = buildTurret(M);
  const { shell, ledPanel, body } = buildShell(M, tier);
  const { door, closedX, glass } = buildDoor(M);
  group.add(spindle, turret.mount, shell, door);
  void body;

  // Shadow receiving costs a filtered lookup per pixel: only surfaces near the action receive.
  shell.traverse((o) => o.isMesh && (o.receiveShadow = false));
  door.traverse((o) => o.isMesh && (o.receiveShadow = false));
  for (const o of shell.userData.receivers || []) o.traverse((m) => m.isMesh && (m.receiveShadow = true));

  return {
    group,
    spindle,
    jaws,
    turret,
    shell,
    door,
    doorClosedX: closedX,
    glass,
    ledPanel,
    /** Chuck + jaws motion blur ghosts (created lazily by the story). */
  };
}
