/**
 * Workshop set: concrete floor, distant racking (soft-focus background) and the
 * inspection bench — granite surface plate, two V-blocks and a digital caliper.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENCLOSURE } from './machine.js';
import { finishedRadius, PART_CENTER } from './workpiece.js';
import { radialSprite } from './textures.js';
import { rng } from './util.js';

const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/* Inspection bench placement (world). The part rests on V-blocks with its axis along local X. */
export const BENCH = {
  position: new THREE.Vector3(24, 0, 12.5),
  yaw: -0.9, // part seen at ~0.6 rad from side-on: readable profile and caliper face
  plateY: -1.0, // granite plate top
  axisY: 0.25, // part axis height when resting on the V-blocks
  vblocks: [-1.0, 0.65], // part-local X (original part coordinates) of the two supports
  caliperX: -0.15, // original part coordinate of the measured diameter (largest step)
};

export function buildFloor(M) {
  const group = new THREE.Group();
  group.name = 'floor';
  const floor = mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), M.concrete, { cast: false, receive: false });
  floor.position.y = ENCLOSURE.floorY;
  group.add(floor);

  // soft contact shadow under the machine and the bench (baked gradient decals)
  const sprite = radialSprite(128, 0.35, 1.8);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, map: sprite, depthWrite: false });
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(40, 28).rotateX(-Math.PI / 2), shadowMat);
  s1.position.set(-1, ENCLOSURE.floorY + 0.02, -4.5);
  const s2 = new THREE.Mesh(new THREE.PlaneGeometry(14, 10).rotateX(-Math.PI / 2), shadowMat);
  s2.position.set(BENCH.position.x, ENCLOSURE.floorY + 0.02, BENCH.position.z);
  group.add(s1, s2);
  return { group, shadowMat };
}

/** Pallet racking and stock on the far wall — dim, out of focus, never competing. */
export function buildBackground(M) {
  const group = new THREE.Group();
  group.name = 'background';
  const uprights = [];
  const beams = [];
  const boxes = [];
  const r = rng(77);
  const y0 = ENCLOSURE.floorY;
  for (let bay = -7; bay <= 7; bay++) {
    const x = bay * 9;
    for (const dz of [0, 4]) {
      const u = new THREE.BoxGeometry(0.4, 26, 0.4);
      u.translate(x, y0 + 13, -46 - dz);
      uprights.push(u);
    }
    for (let lvl = 0; lvl < 4; lvl++) {
      const yy = y0 + 2 + lvl * 7;
      for (const dz of [0, 4]) {
        const b = new THREE.BoxGeometry(9, 0.6, 0.3);
        b.translate(x + 4.5, yy, -46 - dz);
        beams.push(b);
      }
      if (lvl < 3 && r() > 0.25) {
        const w = 3 + r() * 4;
        const h = 2 + r() * 3.5;
        const bx = new THREE.BoxGeometry(w, h, 3.4);
        bx.translate(x + 1 + r() * (8 - w) + w / 2, yy + 0.3 + h / 2, -48);
        boxes.push(bx);
      }
    }
  }
  // near-black silhouettes: they give depth without competing with the machine
  const dark = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.85, metalness: 0.2, envMapIntensity: 0.25 });
  group.add(mesh(mergeGeometries(uprights), dark, { cast: false, receive: false }));
  group.add(mesh(mergeGeometries(beams), dark, { cast: false, receive: false }));
  group.add(mesh(mergeGeometries(boxes), dark, { cast: false, receive: false }));

  // distant overhead fixtures (become soft highlights under depth of field)
  const fixtures = [];
  for (let i = -3; i <= 3; i++) {
    for (const z of [-30, -14]) {
      const f = new THREE.BoxGeometry(6, 0.25, 0.6);
      f.translate(i * 14, 26, z);
      fixtures.push(f);
    }
  }
  const fixtureMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.34, 0.37), fog: true });
  group.add(new THREE.Mesh(mergeGeometries(fixtures), fixtureMat));
  return group;
}

/* ==========================================================================
   Inspection bench
   ========================================================================== */
function vBlock(height, notchDepth, M) {
  const w = 1.5;
  const half = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-half, 0);
  s.lineTo(half, 0);
  s.lineTo(half, height);
  s.lineTo(notchDepth, height);
  s.lineTo(0, height - notchDepth);
  s.lineTo(-notchDepth, height);
  s.lineTo(-half, height);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, curveSegments: 1 });
  geo.translate(0, 0, -0.3);
  geo.rotateY(Math.PI / 2); // shape plane → local Z/Y, extrusion along X
  geo.computeVertexNormals();
  return mesh(geo, M.satin);
}

/** Digital caliper in its own frame: beam along +Y, jaws reach toward −Z, faces ±X. */
function buildCaliper(M) {
  const g = new THREE.Group();
  g.name = 'caliper';
  const t = 0.07;
  const beam = mesh(rbox(t, 5.0, 0.34, 0.012), M.satin);
  beam.position.set(0, 2.1, 0.17);
  g.add(beam);
  // scale graduations on the beam face (fine dark lines)
  const ticks = [];
  for (let i = 0; i < 90; i++) {
    const big = i % 10 === 0;
    const tk = new THREE.BoxGeometry(0.004, 0.006, big ? 0.1 : 0.055);
    tk.translate(t / 2 + 0.002, 0.2 + i * 0.05, 0.3 - (big ? 0.05 : 0.0275));
    ticks.push(tk);
  }
  g.add(mesh(mergeGeometries(ticks), M.panelLine, { cast: false }));

  const jawShape = (len) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0, 0.36);
    s.lineTo(-len * 0.55, 0.3);
    s.lineTo(-len, 0.06);
    s.lineTo(-len, 0);
    s.closePath();
    return s;
  };
  const jawGeo = (len) => {
    const geo = new THREE.ExtrudeGeometry(jawShape(len), { depth: t, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 });
    geo.translate(0, 0, -t / 2);
    geo.rotateY(-Math.PI / 2); // shape X → world −Z… extrusion along X
    geo.computeVertexNormals();
    return geo;
  };
  // fixed jaw (bottom, measuring face on its top edge at y = 0)
  const fixed = mesh(jawGeo(1.15), M.satin);
  fixed.rotation.x = Math.PI; // measuring face up, body below
  fixed.position.set(0, 0, 0);
  g.add(fixed);

  // slider with the movable jaw (measuring face on its bottom edge at local y = 0)
  const slider = new THREE.Group();
  slider.name = 'caliper-slider';
  const movable = mesh(jawGeo(1.15), M.satin);
  slider.add(movable);
  const housing = mesh(rbox(0.2, 1.1, 0.62, 0.05), M.plastic);
  housing.position.set(0, 0.85, 0.24);
  const lcd = mesh(new THREE.PlaneGeometry(0.42, 0.24), M.lcd, { cast: false });
  lcd.rotation.y = Math.PI / 2;
  lcd.position.set(0.102, 1.0, 0.24);
  const wheel = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24).rotateZ(Math.PI / 2), M.satin);
  wheel.position.set(0, 0.25, 0.46);
  slider.add(housing, lcd, wheel);
  // three small buttons
  for (let i = 0; i < 3; i++) {
    const b = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).rotateZ(Math.PI / 2), M.satin, { cast: false });
    b.position.set(0.11, 0.66, 0.1 + i * 0.12);
    slider.add(b);
  }
  g.add(slider);
  return { group: g, slider };
}

export function buildInspection(M) {
  const group = new THREE.Group();
  group.name = 'inspection';
  group.position.copy(BENCH.position);
  group.rotation.y = BENCH.yaw;
  const { plateY, axisY } = BENCH;
  const floorY = ENCLOSURE.floorY;

  // bench: steel frame + top
  const benchTopY = plateY - 1.6;
  const top = mesh(rbox(11, 0.4, 7, 0.08), M.paintDark, { receive: false });
  top.position.set(0, benchTopY - 0.2, 0);
  group.add(top);
  const legs = [];
  for (const [x, z] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) {
    const l = new THREE.BoxGeometry(0.4, benchTopY - 0.4 - floorY, 0.4);
    l.translate(x, (benchTopY - 0.4 + floorY) / 2, z);
    legs.push(l);
  }
  const rail = new THREE.BoxGeometry(10.4, 0.35, 0.3);
  rail.translate(0, floorY + 3, -3);
  legs.push(rail, rail.clone().translate(0, 0, 6));
  group.add(mesh(mergeGeometries(legs), M.paintDark, { receive: false }));

  // granite surface plate
  const plate = mesh(rbox(9, 1.6, 5.6, 0.06), M.granite);
  plate.position.set(0, plateY - 0.8, 0);
  group.add(plate);

  // V-blocks sized so the part axis is level
  const blocks = BENCH.vblocks.map((px) => {
    const r = finishedRadius(px);
    const bottom = axisY - r * Math.SQRT2;
    const depth = 0.42;
    const h = bottom + depth - plateY;
    const vb = vBlock(h, depth, M);
    vb.position.set(px - PART_CENTER, plateY, 0);
    group.add(vb);
    return vb;
  });

  const cal = buildCaliper(M);
  group.add(cal.group);
  const caliperRest = new THREE.Vector3(BENCH.caliperX - PART_CENTER + 0.0, axisY - finishedRadius(BENCH.caliperX), 1.05);
  cal.group.position.copy(caliperRest);

  return { group, plate, blocks, caliper: cal.group, slider: cal.slider, caliperRest };
}
