/**
 * Chips: instanced, curled helical ribbons (several shape variants).
 *   • flying chips spawn at the insert while the tool is actually feeding, leave the
 *     rake face with realistic arcs, tumble, and drop into the chip trough
 *   • the pile on the conveyor is deterministic — its size follows the material
 *     removed so far, so scrolling backwards un-piles it exactly
 * Fresh chips are bright steel; a few show straw or blue heat tint.
 */
import * as THREE from 'three';
import { rng } from './util.js';

/** Helical ribbon: a strip swept along a (slightly conical) helix. */
function ribbonGeometry({ radius, turns, pitch, width, taper = 0.2, steps = 64, twist = 0 }) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const total = turns * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const t = f * total;
    const r = radius * (1 - taper * f);
    const cx = Math.cos(t) * r;
    const cy = Math.sin(t) * r;
    const cz = pitch * (t / (Math.PI * 2));
    // ribbon width runs mostly along the helix axis, with a little twist
    const a = twist * f;
    const wx = Math.cos(t) * Math.sin(a);
    const wy = Math.sin(t) * Math.sin(a);
    const wz = Math.cos(a);
    const half = width * (0.75 + 0.25 * Math.sin(f * Math.PI));
    pos.push(cx - wx * half, cy - wy * half, cz - wz * half, cx + wx * half, cy + wy * half, cz + wz * half);
    // normal ≈ radial direction (the chip's outer curl)
    nrm.push(Math.cos(t), Math.sin(t), 0, Math.cos(t), Math.sin(t), 0);
    if (i < steps) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // centre the chip on its own origin so it tumbles about its middle
  g.center();
  return g;
}

// All variants are open 3D coils (pitch > ~radius) so no chip ever reads as a flat ring or letter.
const VARIANTS = [
  { radius: 0.04, turns: 3.4, pitch: 0.07, width: 0.02, taper: 0.25, twist: 0.5 }, // springy coil
  { radius: 0.055, turns: 2.2, pitch: 0.085, width: 0.024, taper: 0.55, twist: 0.3 }, // conical spiral
  { radius: 0.03, turns: 6, pitch: 0.06, width: 0.016, taper: 0.1, twist: 0.9 }, // long helix
  { radius: 0.045, turns: 1.6, pitch: 0.1, width: 0.026, taper: 0.4, twist: 1.2 }, // short twisted segment
];

function tintColor(r) {
  const x = r();
  if (x < 0.07) return new THREE.Color(0.62, 0.5, 0.3); // straw
  if (x < 0.1) return new THREE.Color(0.32, 0.36, 0.55); // blue
  const s = 0.85 + r() * 0.15;
  return new THREE.Color(s, s, s * 1.02);
}

export class Chips {
  /**
   * @param {THREE.Material} material  shared chip material (DoubleSide metal)
   * @param {object} opts
   */
  constructor(material, { flying = 600, pile = 900, pileArea, floorY, gravity = 60 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'chips';
    this.geos = VARIANTS.map((v) => ribbonGeometry({ ...v, steps: v.turns > 3 ? 96 : 48 }));
    this.gravity = gravity;
    this.floorY = floorY;
    const r = rng(99);

    // Flying chips: one InstancedMesh per variant
    const per = Math.ceil(flying / VARIANTS.length);
    this.fly = this.geos.map((geo) => {
      const m = new THREE.InstancedMesh(geo, material, per);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      for (let i = 0; i < per; i++) m.setColorAt(i, tintColor(r));
      this.group.add(m);
      return {
        mesh: m,
        n: per,
        pos: new Float32Array(per * 3),
        vel: new Float32Array(per * 3),
        rot: new Float32Array(per * 4),
        spin: new Float32Array(per * 3),
        life: new Float32Array(per),
        scale: new Float32Array(per),
        cursor: 0,
      };
    });
    for (const f of this.fly) for (let i = 0; i < f.n; i++) f.rot[i * 4 + 3] = 1;

    // Deterministic pile in the trough
    const perPile = Math.ceil(pile / VARIANTS.length);
    const area = pileArea || { x0: -2, x1: 4, z0: 1.0, z1: 3.4, y: floorY };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    this.pile = this.geos.map((geo, vi) => {
      const m = new THREE.InstancedMesh(geo, material, perPile);
      const rr = rng(1000 + vi);
      for (let i = 0; i < perPile; i++) {
        // denser toward the cutting zone, heaping slightly
        const u = rr();
        const x = area.x0 + (area.x1 - area.x0) * Math.pow(u, 0.8);
        const z = area.z0 + (area.z1 - area.z0) * rr();
        const heap = 0.25 * Math.max(0, 1 - Math.abs(x - 1.2) / 3) * (i / perPile);
        p.set(x, area.y + 0.04 + rr() * 0.05 + heap, z);
        e.set(rr() * Math.PI * 2, rr() * Math.PI * 2, rr() * Math.PI * 2);
        q.setFromEuler(e);
        const sc = 0.8 + rr() * 0.5;
        s.set(sc, sc, sc);
        m4.compose(p, q, s);
        m.setMatrixAt(i, m4);
        m.setColorAt(i, tintColor(rr));
      }
      m.count = 0;
      m.castShadow = false;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    });
    this.perPile = perPile;
    this.acc = 0;
    this.tmp = { m4, q, p, s, e, q2: new THREE.Quaternion(), v: new THREE.Vector3() };
    this.rand = rng(4242);
  }

  /** Pile fraction 0..1 (derived from the machining state, so it is reversible). */
  setPile(f) {
    const n = Math.round(this.perPile * f);
    for (const m of this.pile) m.count = n;
  }

  /**
   * @param {number} dt
   * @param {number} rate       0..1 feed activity
   * @param {THREE.Vector3} origin  insert tip (world)
   * @param {THREE.Vector3} flowDir chip flow direction off the rake face (world, unit)
   * @param {number} perSecond  spawn rate at full feed
   */
  update(dt, rate, origin, flowDir, perSecond) {
    const R = this.rand;
    this.acc += rate * dt * perSecond;
    while (this.acc >= 1) {
      this.acc -= 1;
      const f = this.fly[Math.floor(R() * this.fly.length)];
      const i = f.cursor;
      f.cursor = (f.cursor + 1) % f.n;
      f.pos[i * 3] = origin.x + (R() - 0.5) * 0.03;
      f.pos[i * 3 + 1] = origin.y + (R() - 0.5) * 0.03;
      f.pos[i * 3 + 2] = origin.z + (R() - 0.5) * 0.03;
      const sp = 5 + R() * 8;
      f.vel[i * 3] = flowDir.x * sp + (R() - 0.5) * 3.5;
      f.vel[i * 3 + 1] = flowDir.y * sp + R() * 2.5;
      f.vel[i * 3 + 2] = flowDir.z * sp + (R() - 0.3) * 3;
      f.spin[i * 3] = (R() - 0.5) * 30;
      f.spin[i * 3 + 1] = (R() - 0.5) * 30;
      f.spin[i * 3 + 2] = (R() - 0.5) * 30;
      f.life[i] = 1.6 + R() * 0.8;
      f.scale[i] = 0.75 + R() * 0.6;
      if (f.mesh.count <= i) f.mesh.count = i + 1;
    }

    const { m4, q, p, s, q2, v } = this.tmp;
    const g = this.gravity;
    for (const f of this.fly) {
      let any = false;
      for (let i = 0; i < f.mesh.count; i++) {
        if (f.life[i] <= 0) {
          continue;
        }
        any = true;
        f.life[i] -= dt;
        const j = i * 3;
        if (f.life[i] <= 0) {
          m4.makeScale(0, 0, 0);
          f.mesh.setMatrixAt(i, m4);
          continue;
        }
        if (f.pos[j + 1] > this.floorY + 0.03) {
          f.vel[j + 1] -= g * dt;
          // light air drag
          const drag = Math.exp(-dt * 0.6);
          f.vel[j] *= drag;
          f.vel[j + 2] *= drag;
          f.pos[j] += f.vel[j] * dt;
          f.pos[j + 1] += f.vel[j + 1] * dt;
          f.pos[j + 2] += f.vel[j + 2] * dt;
          // tumble
          v.set(f.spin[j], f.spin[j + 1], f.spin[j + 2]);
          const ang = v.length() * dt;
          if (ang > 0) {
            q2.setFromAxisAngle(v.normalize(), ang);
            q.fromArray(f.rot, i * 4).premultiply(q2).toArray(f.rot, i * 4);
          }
          if (f.pos[j + 1] <= this.floorY + 0.03) {
            f.pos[j + 1] = this.floorY + 0.03;
            f.life[i] = Math.min(f.life[i], 0.6); // rest briefly, then join the pile
          }
        }
        const sc = f.scale[i] * Math.min(1, f.life[i] / 0.25);
        p.fromArray(f.pos, j);
        q.fromArray(f.rot, i * 4);
        s.setScalar(Math.max(0, sc));
        m4.compose(p, q, s);
        f.mesh.setMatrixAt(i, m4);
      }
      if (any || f.wasAny) f.mesh.instanceMatrix.needsUpdate = true;
      f.wasAny = any;
    }
  }

  /** Removes all flying chips (e.g. after a big scroll jump). */
  clearFlying() {
    for (const f of this.fly) {
      f.life.fill(0);
      f.mesh.count = 0;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const f of this.fly) f.mesh.dispose();
    for (const m of this.pile) m.dispose();
  }
}
