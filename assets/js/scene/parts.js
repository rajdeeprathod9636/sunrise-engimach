/**
 * Typical-part renders (Services page) — services.html?render=parts
 *
 * Builds each part from a turned profile (plus extrusions for hex flats and bolt
 * holes) using the same materials as the home story, renders it on a transparent
 * background (supersampled) and downloads PNGs at 2× and 3× of the card size.
 * Convert them to AVIF/WebP with tools/convert-images.mjs (see README/ASSETS.md).
 */
import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { TurnedMesh, spansToProfile, storyProfile, FINAL_STATE, PART_L } from './workpiece.js';
import { createStudio } from './showcase.js';
import { loadEnvironment } from './assets.js';

export const CARD = { width: 320, height: 150 }; // CSS px of the part image box (1×)

const TH = (pitch, depth) => ({ pitch, depth, phase: 0 });
const span = (a, b, r, thread = null) => ({ a, b, r, cut: true, thread });

/** Closes an outer profile through a bore (inner surface runs right → left). */
function hollow(spans, bore, opts = {}) {
  const pts = spansToProfile(spans, { ...opts, bore });
  const x0 = spans[0].a;
  pts.push({ x: x0, r: bore, cut: false, thread: null }); // bore surface → darker 'bore' material
  return pts;
}

let boreMat = null;
function turned(pts, M, segs = 192) {
  // Inside a bore less light reaches the surface: a slightly darker, rougher steel reads correctly.
  boreMat = boreMat || new THREE.MeshStandardMaterial({ color: 0x737980, metalness: 1, roughness: 0.34, envMapIntensity: 0.55 });
  const t = new TurnedMesh([boreMat, M.cutSteel], { radialSegments: segs, threadSamplesPerTurn: 160 });
  t.build(pts);
  return t.mesh;
}

/** Extruded disc/prism along X with real holes; UVs set for concentric machining marks. */
function extrudedX(shape, depth, bevel, M) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 64 });
  geo.translate(0, 0, -depth / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, Math.atan2(y, x) / (Math.PI * 2) + 0.5, Math.hypot(x, y));
  }
  geo.rotateY(Math.PI / 2); // extrusion → world X
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, M.cutSteel);
}

const circle = (r, x = 0, y = 0, cw = false) => {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, cw);
  return p;
};

/* ---------- the eight typical parts ---------- */
export const PARTS = {
  shaft(M) {
    const pts = storyProfile({ ...FINAL_STATE, cutX: PART_L - 1 });
    return turned(pts, M);
  },
  pin(M) {
    return turned(
      spansToProfile([span(0, 0.22, 0.42), span(0.22, 2.55, 0.24), span(2.55, 2.62, 0.2), span(2.62, 2.9, 0.24)], { leftChamfer: 0.03, rightChamfer: 0.04 }),
      M
    );
  },
  bush(M) {
    return turned(hollow([span(0, 0.24, 0.78), span(0.24, 1.7, 0.52)], 0.33, { leftChamfer: 0.03, rightChamfer: 0.035 }), M);
  },
  spacer(M) {
    return turned(hollow([span(0, 0.95, 0.62)], 0.37, { leftChamfer: 0.03, rightChamfer: 0.03 }), M);
  },
  coupling(M) {
    return turned(
      hollow([span(0, 1.05, 0.62), span(1.05, 1.15, 0.6), span(1.15, 2.2, 0.62)], 0.31, { leftChamfer: 0.04, rightChamfer: 0.04 }),
      M
    );
  },
  flange(M) {
    const g = new THREE.Group();
    const disc = new THREE.Shape();
    disc.absarc(0, 0, 1.25, 0, Math.PI * 2, false);
    disc.holes.push(circle(0.3, 0, 0, true));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      disc.holes.push(circle(0.11, Math.cos(a) * 0.92, Math.sin(a) * 0.92, true));
    }
    const d = extrudedX(disc, 0.26, 0.025, M);
    d.position.x = 0.13;
    const hub = turned(hollow([span(0.24, 0.85, 0.56)], 0.3, { leftChamfer: 0, rightChamfer: 0.04 }), M);
    g.add(d, hub);
    return g;
  },
  fitting(M) {
    const g = new THREE.Group();
    const hex = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 0.58;
      i ? hex.lineTo(Math.cos(a) * r, Math.sin(a) * r) : hex.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    hex.closePath();
    hex.holes.push(circle(0.2, 0, 0, true));
    const h = extrudedX(hex, 0.62, 0.035, M);
    h.position.x = 1.05;
    const left = turned(hollow([span(0, 0.68, 0.42, TH(0.06, 0.03)), span(0.68, 0.8, 0.36)], 0.2, { leftChamfer: 0.04 }), M);
    const right = turned(
      hollow([span(1.3, 1.42, 0.34), span(1.42, 2.15, 0.39, TH(0.06, 0.03)), span(2.15, 2.4, 0.3)], 0.2, { rightChamfer: 0.08 }),
      M
    );
    g.add(left, h, right);
    return g;
  },
  threaded(M) {
    return turned(
      spansToProfile([span(0, 1.3, 0.3, TH(0.05, 0.027)), span(1.3, 1.36, 0.25), span(1.36, 2.84, 0.27), span(2.84, 2.9, 0.25), span(2.9, 4.2, 0.3, TH(0.05, 0.027))], {
        leftChamfer: 0.04,
        rightChamfer: 0.04,
      }),
      M
    );
  },
};

/** Fits the camera so the object's bounding box fills `fill` of the frame. */
function frame(camera, object, aspect, fill = 0.86) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const halfW = Math.max(size.x, size.z) * 0.5;
  const halfH = Math.max(size.y, size.z * 0.4) * 0.5;
  const dist = Math.max(halfW / (tanV * aspect * fill), halfH / (tanV * fill)) + sphere.radius * 0.6;
  camera.aspect = aspect;
  camera.position.set(0, dist * 0.22, dist);
  camera.lookAt(0, 0, 0);
  camera.near = dist / 50;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
}

/**
 * Renders every part at the given device scale. Returns [{name, scale, dataURL}].
 * Supersampled 2× then downscaled with high-quality smoothing for clean edges.
 */
export async function renderParts({ scales = [2, 3], showcase = true } = {}) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  const scene = createStudio(renderer, { amberRim: false });
  scene.environment = await loadEnvironment(renderer, '2k');
  scene.environmentIntensity = 0.9;
  const M = createMaterials({ texSize: 1024, renderer });
  const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 100);
  const out = [];
  const down = document.createElement('canvas');
  const ctx = down.getContext('2d');

  const shoot = (name, object, w, h, scale) => {
    const holder = new THREE.Group();
    holder.add(object);
    holder.rotation.order = 'YZX';
    holder.rotation.y = -0.42;
    holder.rotation.z = 0.06;
    scene.add(holder);
    frame(camera, holder, w / h, name === 'showcase' ? 0.8 : 0.9);
    const ss = 2;
    renderer.setSize(w * scale * ss, h * scale * ss, false);
    renderer.render(scene, camera);
    down.width = w * scale;
    down.height = h * scale;
    ctx.clearRect(0, 0, down.width, down.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, down.width, down.height);
    out.push({ name, scale, width: down.width, height: down.height, dataURL: down.toDataURL('image/png') });
    scene.remove(holder);
  };

  for (const scale of scales) {
    for (const [name, build] of Object.entries(PARTS)) shoot(name, build(M), CARD.width, CARD.height, scale);
    if (showcase) shoot('showcase', PARTS.shaft(M), 560, 420, scale);
  }
  renderer.dispose();
  return out;
}

/** UI for services.html?render=parts — renders and downloads the PNGs. */
export async function renderPartsMode() {
  const bar = document.createElement('div');
  bar.className = 'record-bar';
  bar.textContent = 'Rendering parts…';
  document.body.appendChild(bar);
  const shots = await renderParts();
  window.__parts = shots;
  bar.innerHTML = `<button type="button">Download ${shots.length} PNGs</button>`;
  bar.querySelector('button').addEventListener('click', async () => {
    for (const s of shots) {
      const a = document.createElement('a');
      a.href = s.dataURL;
      a.download = `part-${s.name}@${s.scale}x.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 150));
    }
  });
}
