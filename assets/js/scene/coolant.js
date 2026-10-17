/**
 * Coolant: a translucent stream from the turret nozzle onto the cutting zone,
 * fine mist and droplets lit by the work light.
 *
 * The stream lives in station-local space (nozzle → insert are fixed relative to a
 * tool station), so each frame it simply takes the active station's world matrix.
 */
import * as THREE from 'three';
import { TOOL_REACH } from './machine.js';
import { rng } from './util.js';

const TUBE_SEG = 40;
const TUBE_RAD = 10;

export class Coolant {
  constructor(material, nozzleLocal, { mist = 260, pixelRatio = 1 } = {}) {
    // --- stream ---
    const start = nozzleLocal.clone();
    const end = new THREE.Vector3(0.03, TOOL_REACH - 0.05, -0.07);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0.02, 0.06, -0.08));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geo = new THREE.TubeGeometry(curve, TUBE_SEG, 0.02, TUBE_RAD, false);
    // taper: wider at the impact (the jet spreads), slim at the nozzle
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      curve.getPointAt(Math.min(1, u), c);
      p.fromBufferAttribute(pos, i).sub(c);
      p.multiplyScalar(0.75 + 0.7 * u * u);
      pos.setXYZ(i, c.x + p.x, c.y + p.y, c.z + p.z);
    }
    geo.computeVertexNormals();
    this.material = material;
    // streaks run along the flow: low frequency along the jet, high frequency around it
    if (material.alphaMap) material.alphaMap.repeat.set(0.25, 3);
    this.stream = new THREE.Mesh(geo, material);
    this.stream.name = 'coolant-stream';
    this.stream.matrixAutoUpdate = false;
    this.stream.renderOrder = 4;
    this.stream.castShadow = false;
    this.stream.receiveShadow = false;
    this.stream.visible = false;
    this.impactLocal = end.clone();

    // --- mist + droplets (points) ---
    const n = mist;
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.kind = new Float32Array(n);
    const pg = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ageAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.posAttr);
    pg.setAttribute('aT', this.ageAttr);
    pg.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    pg.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    this.pointsMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0.85, 0.9, 0.97) },
        uPixel: { value: pixelRatio },
        uLight: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aT; attribute float aSize; attribute float aKind;
        uniform float uPixel;
        varying float vT; varying float vKind;
        void main() {
          vT = aT; vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float grow = aKind > 0.5 ? 1.0 : (0.6 + aT * 1.8);
          gl_PointSize = aSize * grow * uPixel * 300.0 / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uLight;
        varying float vT; varying float vKind;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float soft = vKind > 0.5 ? smoothstep(1.0, 0.2, r) : pow(1.0 - r, 2.2);
          float fade = vT < 0.15 ? vT / 0.15 : 1.0 - smoothstep(0.45, 1.0, vT);
          float a = soft * fade * (vKind > 0.5 ? 0.5 : 0.055) * uLight;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    this.points = new THREE.Points(pg, this.pointsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'coolant-mist';
    this.cursor = 0;
    this.acc = 0;
    this.rand = rng(314);
    this.flowOffset = 0;
  }

  setPixelRatio(pr) {
    this.pointsMat.uniforms.uPixel.value = pr;
  }

  /**
   * @param {number} dt
   * @param {object} s  { flow: 0..1 stream state, grow: 0..1 front, cut: 0..1 tail, light: work light 0..1, active: bool }
   * @param {THREE.Matrix4} stationMatrix  active station world matrix
   * @param {number} spray  0..1 how much mist (cutting + spindle speed)
   */
  update(dt, s, stationMatrix, spray) {
    // stream
    const visible = s.flow > 0.001;
    this.stream.visible = visible;
    if (visible) {
      this.stream.matrix.copy(stationMatrix);
      this.stream.matrixWorldNeedsUpdate = true;
      const per = TUBE_RAD * 6;
      const head = Math.round(TUBE_SEG * s.grow);
      const tail = Math.round(TUBE_SEG * s.cut);
      this.stream.geometry.setDrawRange(tail * per, Math.max(0, head - tail) * per);
      this.flowOffset -= dt * 2.6;
      if (this.material.alphaMap) this.material.alphaMap.offset.set(this.flowOffset, 0);
      this.material.opacity = 0.22 * s.flow;
    }

    // mist + droplets
    const R = this.rand;
    this.pointsMat.uniforms.uLight.value = s.light;
    this.acc += dt * spray * 220;
    const impact = new THREE.Vector3().copy(this.impactLocal).applyMatrix4(stationMatrix);
    while (this.acc >= 1) {
      this.acc -= 1;
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const droplet = R() < 0.3;
      this.kind[i] = droplet ? 1 : 0;
      this.pos[i * 3] = impact.x + (R() - 0.5) * 0.12;
      this.pos[i * 3 + 1] = impact.y + (R() - 0.5) * 0.08;
      this.pos[i * 3 + 2] = impact.z + (R() - 0.5) * 0.12;
      const sp = droplet ? 3 + R() * 5 : 0.4 + R() * 0.9;
      const th = R() * Math.PI * 2;
      this.vel[i * 3] = Math.cos(th) * sp;
      this.vel[i * 3 + 1] = (droplet ? 1.5 : 0.6) + R() * sp * 0.6;
      this.vel[i * 3 + 2] = Math.sin(th) * sp + (droplet ? 1.5 : 0.4);
      this.life[i] = droplet ? 0.35 + R() * 0.3 : 0.9 + R() * 0.9;
      this.size[i] = droplet ? 0.012 + R() * 0.01 : 0.14 + R() * 0.16;
      this.age[i] = 0;
    }
    const ageOut = this.ageAttr.array;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= 1) {
        ageOut[i] = 1;
        continue;
      }
      this.age[i] = Math.min(1, this.age[i] + dt / this.life[i]);
      const j = i * 3;
      if (this.kind[i] > 0.5) this.vel[j + 1] -= 40 * dt;
      else {
        const d = Math.exp(-dt * 1.4);
        this.vel[j] *= d;
        this.vel[j + 1] = this.vel[j + 1] * d + 0.15 * dt;
        this.vel[j + 2] *= d;
      }
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      ageOut[i] = this.age[i];
    }
    this.posAttr.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
    this.points.geometry.getAttribute('aSize').needsUpdate = true;
    this.points.geometry.getAttribute('aKind').needsUpdate = true;
  }

  dispose() {
    this.stream.geometry.dispose();
    this.points.geometry.dispose();
    this.pointsMat.dispose();
  }
}
