/**
 * About page: the finished example part, slowly turning, in the same materials
 * and lighting as the home story. Rendered directly (MSAA, transparent) so the
 * card's blueprint background shows through.
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createMaterials } from './materials.js';
import { StoryWorkpiece, FINAL_STATE } from './workpiece.js';
import { loadEnvironment } from './assets.js';
import { watchSize } from './renderer.js';
import { KEY_COLOR, RIM_COLOR, ACCENT } from './util.js';

export function createStudio(renderer, { amberRim = true } = {}) {
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene();
  scene.environmentIntensity = 0.75;
  scene.environmentRotation.set(0, 1.2, 0);
  const key = new THREE.RectAreaLight(KEY_COLOR, 4.5, 6, 2.2);
  key.position.set(-1.5, 5, 4);
  key.lookAt(0, 0, 0);
  const rimL = new THREE.RectAreaLight(RIM_COLOR, 5, 2, 7);
  rimL.position.set(-4.5, 1.2, -3.5);
  rimL.lookAt(0, 0, 0);
  const rimR = new THREE.RectAreaLight(RIM_COLOR, 4, 2, 7);
  rimR.position.set(4.5, 0.8, -3.2);
  rimR.lookAt(0, 0, 0);
  const fill = new THREE.HemisphereLight(0xc4ccd6, 0x0e1013, 0.15);
  scene.add(key, rimL, rimR, fill);
  if (amberRim) {
    const amber = new THREE.PointLight(ACCENT, 3, 7, 2);
    amber.position.set(2.6, 1.2, -1.8);
    scene.add(amber);
  }
  void renderer;
  return scene;
}

export async function initShowcase(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const small = window.matchMedia('(max-width: 767px)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));

  const scene = createStudio(renderer);
  scene.environment = await loadEnvironment(renderer, '1k');
  const M = createMaterials({ texSize: small ? 512 : 1024, renderer });
  M.setWet(0);
  const part = new StoryWorkpiece(M, { radialSegments: 160, threadSamplesPerTurn: 120 });
  part.update(FINAL_STATE);
  const spinner = new THREE.Group();
  spinner.add(part.mesh);
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  group.rotation.z = 0.12;
  group.add(spinner);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  function frameCamera(w, h) {
    camera.aspect = w / h;
    const halfW = 2.75;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfW / (tanV * camera.aspect), 1.25 / tanV);
    camera.position.set(0.2, dist * 0.2, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  let last = performance.now();
  let t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    spinner.rotation.x = -t * 0.5;
    group.rotation.y = -0.34 + Math.sin(t * 0.25) * 0.14;
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
  watchSize(canvas, ({ width, height }) => {
    renderer.setSize(width, height, false);
    frameCamera(width, height);
    if (!running) renderer.render(scene, camera);
  });

  group.rotation.y = -0.34;
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  updateLoop();
}
