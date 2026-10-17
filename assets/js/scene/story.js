/**
 * Home page scroll story — scene controller.
 * Builds the world, then maps the timeline state onto it every frame.
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRenderer, preToneMapped, toneMappingMode, watchSize, aspectClass } from './renderer.js';
import { createMaterials } from './materials.js';
import { buildMachine, DIR, TAN, TOOL_REACH, ENCLOSURE, DOOR_TRAVEL } from './machine.js';
import { buildFloor, buildBackground, buildInspection, BENCH } from './set.js';
import { StoryWorkpiece, removedFraction, PART_CENTER, PART_L, X_FACE, finishedRadius } from './workpiece.js';
import { Chips } from './chips.js';
import { Coolant } from './coolant.js';
import { stateAt, partPose, toolTip, cameraKeys, sideAt, frameSphere, glassClearance } from './timeline.js';
import { createPost } from './post.js';
import { AdaptiveResolution } from './quality.js';
import { Progress, loadEnvironment, loadManifest, loadModel, prepareModel } from './assets.js';
import { ACCENT, KEY_COLOR, RIM_COLOR, LED_COLOR, clamp01, dampK, lerp, norm, smooth } from './util.js';

const WHITE = new THREE.Color(0xffffff);

const DEFAULT_LAYOUT = {
  mode: 'side',
  left: { cx: -0.47, cy: -0.06, hw: 0.45, hh: 0.78 },
  right: { cx: 0.47, cy: -0.06, hw: 0.45, hh: 0.78 },
  stages: [],
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {object} opts.tier         from quality.detectTier()
 * @param {function} [opts.onProgress] 0..1
 * @param {function} [opts.onCallouts] receives projected callout geometry (CSS px) or null
 * @param {boolean} [opts.record]     deterministic frame stepping, no damping, preserve buffer
 */
export async function initStoryScene(canvas, opts = {}) {
  const { tier, onProgress, onCallouts, record = false, onContextLost } = opts;
  const progress = new Progress(onProgress);
  const pBuild = progress.add('build', 0.25);
  const pEnv = progress.add('env', 0.6);
  const pFirst = progress.add('first', 0.15);

  RectAreaLightUniformsLib.init();
  const tm = toneMappingMode();
  const renderer = createRenderer(canvas, { preserve: record });
  renderer.shadowMap.autoUpdate = true;
  const manager = new THREE.LoadingManager();

  const scene = new THREE.Scene();
  const bgPre = preToneMapped(undefined, tm);
  scene.background = bgPre.clone();
  scene.fog = new THREE.Fog(bgPre.clone(), 40, 160);
  scene.environmentIntensity = 0.6;
  scene.environmentRotation.set(0, 1.2, 0);

  // Start loading the environment straight away (largest download).
  const envSize = tier.hdri === '2k' && !record ? '1k' : tier.hdri; // high tier upgrades to 2k after first frame
  const envPromise = loadEnvironment(renderer, record ? '2k' : envSize, pEnv, manager);
  const manifestPromise = loadManifest();

  /* ---------- world ---------- */
  const M = createMaterials({ texSize: tier.texSize, renderer });
  pBuild(0.4);
  const machine = buildMachine(M, tier);
  scene.add(machine.group);
  const floor = buildFloor(M);
  scene.add(floor.group);
  const background = buildBackground(M);
  scene.add(background);
  const bench = buildInspection(M);
  scene.add(bench.group);
  pBuild(0.7);

  const work = new StoryWorkpiece(M, { radialSegments: tier.radialSegments, threadSamplesPerTurn: Math.round(tier.radialSegments * 0.75) });
  const partGroup = new THREE.Group(); // position/orientation (transfer, bench, studio)
  const partSpinner = new THREE.Group(); // spin about the part axis
  partGroup.add(partSpinner);
  partSpinner.add(work.mesh);
  scene.add(partGroup);

  const chips = new Chips(M.chip, {
    flying: Math.round(560 * tier.chipScale),
    pile: Math.round(900 * tier.chipScale),
    floorY: ENCLOSURE.inner.y0 + 0.25,
    pileArea: { x0: -2.2, x1: 4.2, z0: 1.3, z1: 3.3, y: ENCLOSURE.inner.y0 + 0.2 },
  });
  scene.add(chips.group);
  const coolant = new Coolant(M.coolant, machine.turret.nozzleLocal, { mist: Math.round(320 * tier.mistScale) });
  scene.add(coolant.stream, coolant.points);

  // Spindle motion blur: transparent copies of the rotating detail spread over the shutter arc
  const blur = buildSpindleBlur(machine.spindle, M, tier.name === 'high' ? 24 : 12);
  machine.spindle.add(blur.group);
  pBuild(1);

  /* ---------- lights ---------- */
  renderer.shadowMap.type = tier.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const key = new THREE.DirectionalLight(KEY_COLOR, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  // cool rim from behind; in the studio stage it becomes the strong back light
  const rim = new THREE.DirectionalLight(RIM_COLOR, 1.5);
  rim.position.set(-9, 7, -10);
  const rimTarget = new THREE.Object3D();
  rim.target = rimTarget;
  // ONE shaped light, moved per stage: LED work light → bench softbox → studio top light.
  // High tier: a true area light (long, soft highlights on round steel). Medium: a spot light.
  const area = tier.areaLight ? new THREE.RectAreaLight(LED_COLOR, 0, 7.2, 0.5) : new THREE.SpotLight(LED_COLOR, 0, 40, 0.75, 0.9, 1.2);
  const areaScale = area.isRectAreaLight ? 1 : 6;
  const AREA = {
    led: { pos: new THREE.Vector3(1.8, ENCLOSURE.inner.y1 - 0.45, 2.7), look: new THREE.Vector3(0.8, -0.4, -0.6), w: 7.2, h: 0.5, color: new THREE.Color(LED_COLOR) },
    bench: { pos: BENCH.position.clone().add(new THREE.Vector3(-1.5, 8, 3.5)), look: new THREE.Vector3(BENCH.position.x, BENCH.axisY, BENCH.position.z), w: 7, h: 3.2, color: new THREE.Color(0xffffff) },
  };
  const ledFill = new THREE.SpotLight(LED_COLOR, 0, 22, 0.95, 0.75, 1.3);
  ledFill.position.set(1.8, ENCLOSURE.inner.y1 - 0.5, 2.6);
  ledFill.target.position.set(0.6, -0.6, -0.6);
  const amber = new THREE.PointLight(ACCENT, 0, 1.8, 2);
  // Light count stays constant for the whole story (changing it would recompile shaders).
  scene.add(key, key.target, rim, rimTarget, area, ledFill, ledFill.target, amber);
  if (area.isSpotLight) scene.add(area.target);

  /* ---------- camera + post ---------- */
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
  let width = 1;
  let height = 1;
  let aspect = 1;
  let klass = 'landscape';
  let activeTier = { ...tier };
  let post = createPost(renderer, scene, camera, activeTier, { toneMapping: tm, width, height });

  // Smoothness ladder: when even the lowest render scale stays below the frame-rate target,
  // shed the most expensive effects one at a time. Only if the scene still cannot hold
  // ~26 fps with everything shed does the page switch to the pre-rendered video.
  const LADDER = [
    (t) => (t.msaa || t.dof || t.grain ? { ...t, msaa: 0, dof: false, grain: false } : null),
    (t) => (t.ao === 'full' ? { ...t, ao: 'half' } : null),
    (t) => (t.ao ? { ...t, ao: null } : null),
    (t) => (t.bloom ? { ...t, bloom: false } : null),
  ];
  function degrade(fps) {
    for (const stepFn of LADDER) {
      const next = stepFn(activeTier);
      if (!next) continue;
      activeTier = next;
      post.dispose();
      post = createPost(renderer, scene, camera, activeTier, { toneMapping: tm, width, height });
      applySize();
      return;
    }
    if (fps < 26 && opts.onTooSlow) opts.onTooSlow();
  }

  const maxDpr = record ? 1 : tier.maxDpr;
  const adaptive = new AdaptiveResolution({
    max: maxDpr,
    min: tier.minDpr,
    onChange: (scale) => applySize(scale),
    floorFps: record ? 0 : 50,
    onFloor: degrade,
  });

  function applySize(scale = adaptive.scale) {
    renderer.setPixelRatio(scale);
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    coolant.setPixelRatio(scale);
  }

  /* ---------- layout (safe area beside / above the text) ---------- */
  let layout = DEFAULT_LAYOUT;
  function safeRect(P) {
    if (layout.mode === 'stack' && layout.stages.length) {
      const i = Math.min(layout.stages.length - 1, Math.max(0, Math.floor(P)));
      const j = Math.min(layout.stages.length - 1, i + 1);
      const f = smooth(norm(P - i, 0.82, 1.0));
      const a = layout.stages[i];
      const b = layout.stages[j];
      return { cx: lerp(a.cx, b.cx, f), cy: lerp(a.cy, b.cy, f), hw: lerp(a.hw, b.hw, f), hh: lerp(a.hh, b.hh, f) };
    }
    const side = sideAt(P); // +1 right, −1 left
    const t = (side + 1) / 2;
    const L = layout.left;
    const R = layout.right;
    return { cx: lerp(L.cx, R.cx, t), cy: lerp(L.cy, R.cy, t), hw: lerp(L.hw, R.hw, t), hh: lerp(L.hh, R.hh, t) };
  }

  /* ---------- state ---------- */
  let targetP = 0;
  let P = 0;
  let time = 0;
  let chuckAngle = 0;
  let partSpin = 0;
  let introT = record ? 10 : -1; // < 0 until the loader has gone
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camOffset = new THREE.Vector2();
  let camInit = false;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const flow = new THREE.Vector3();
  const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const dirCam = new THREE.Vector3();
  const stationWorld = new THREE.Matrix4();
  const keyDirMachine = new THREE.Vector3(0.25, 1, 0.6).normalize();
  const keyDirBench = new THREE.Vector3(-0.55, 1, 0.75).normalize();
  const keyDir = new THREE.Vector3();
  let wasFeeding = false;

  function ledLevel() {
    if (introT < 0) return 0.05;
    const t = introT;
    if (t < 0.35) return 0.05;
    if (t < 0.42) return 0.85;
    if (t < 0.55) return 0.08;
    if (t < 0.6) return 0.6;
    if (t < 0.78) return 0.12;
    return 0.12 + 0.88 * smooth(norm(t, 0.78, 1.15));
  }

  function apply(dt, pSpeed) {
    const s = stateAt(P);
    work.update(s);

    // spindle + part spin (spindle turns negative about X so chips leave toward the operator)
    const w = s.spindle * 24;
    chuckAngle -= w * dt;
    machine.spindle.rotation.x = chuckAngle;
    blur.update(w, s.spindle);
    if (s.detach <= 0) partSpin = chuckAngle;
    else partSpin -= s.lift * 0.35 * dt;

    // part placement
    partPose(s, pose);
    partGroup.position.copy(pose.pos);
    partGroup.quaternion.copy(pose.quat);
    if (s.lift > 0) {
      partGroup.rotateY(Math.sin(time * 0.22) * 0.22 * s.lift);
    }
    partSpinner.rotation.x = partSpin;

    // turret
    toolTip(s, tip);
    machine.turret.mount.position.copy(tip).addScaledVector(DIR, TOOL_REACH);
    machine.turret.disc.rotation.x = s.turretAngle;
    machine.turret.mount.updateMatrixWorld(true);

    // door
    machine.door.position.x = machine.doorClosedX - (1 - s.door) * DOOR_TRAVEL;

    // coolant + wet sheen
    const led = ledLevel();
    stationWorld.copy(machine.turret.stations[s.activeStation].matrixWorld);
    const spray = s.cutting ? s.spindle * clamp01(s.coolant.grow - s.coolant.cut) : 0;
    coolant.update(dt, { ...s.coolant, light: 0.4 + 0.6 * led }, stationWorld, spray * (0.35 + 0.65 * clamp01(pSpeed / 0.3)));
    M.setWet(s.wet);

    // chips: only while cutting AND the scroll is actually feeding the tool
    const feeding = s.cutting ? clamp01(pSpeed / 0.3) * s.spindle : 0;
    flow.copy(TAN).multiplyScalar(1.0).add(tmp.set(0.35, 0.55, 0.25)).normalize();
    chips.update(dt, feeding, tip, flow, 240 * tier.chipScale);
    chips.setPile(removedFraction(s));
    if (!s.cutting && wasFeeding && Math.abs(pSpeed) > 6) chips.clearFlying();
    wasFeeding = s.cutting;

    // practical amber glint at the insert while cutting
    amber.position.copy(tip).addScaledVector(TAN, 0.35).add(tmp.set(0.1, 0.1, 0));
    amber.intensity = 0.9 * feeding;

    // lighting by stage
    const studio = s.studio;
    const machineK = 1 - 0.9 * studio;
    const ledK = 1 - smooth(norm(s.detach, 0.08, 0.42));
    ledFill.intensity = 12 * led * ledK;
    M.led.emissiveIntensity = 7 * led;
    // the single area light hands over LED → bench → studio while its intensity passes through zero
    if (s.detach < 0.45) {
      placeArea(AREA.led);
      area.intensity = 8 * areaScale * led * ledK;
    } else if (studio < 0.5) {
      placeArea(AREA.bench);
      area.intensity = 5 * areaScale * smooth(norm(s.detach, 0.45, 0.85)) * (1 - smooth(norm(studio, 0, 0.5)));
    } else {
      const c = pose.pos;
      placeArea({ pos: tmp2.set(c.x - 0.6, c.y + 5.5, c.z + 2.5), look: c, w: 6, h: 2.4, color: WHITE });
      area.intensity = 3.4 * areaScale * smooth(norm(studio, 0.5, 1));
    }
    // rim: general backlight in the machine, then a strong cool back light on the studio part
    rimTarget.position.copy(currentSubject.center);
    rim.position.copy(currentSubject.center).add(tmp.set(-9, 7, -10).lerp(tmp2.set(-4, 3.5, -9), studio));
    M.setDim(machineK);
    // studio: the set disappears; only the part, the granite and the lights remain
    background.visible = studio < 0.5;
    for (const b of bench.blocks) b.visible = studio < 0.55;
    floor.shadowMat.opacity = 0.72 * machineK;
    scene.environmentIntensity = lerp(0.42, 0.75, smooth(s.detach)) * (1 - 0.62 * studio);
    key.intensity = lerp(1.3, 2.0, s.detach) * (1 - 0.35 * studio);
    rim.intensity = lerp(1.2, 4.2, studio);

    // camera
    updateCamera(s, dt);

    // shadow-casting key light follows the subject (tight bounds = sharp contact shadows)
    keyDir.copy(keyDirMachine).lerp(keyDirBench, smooth(s.detach)).normalize();
    const sub = currentSubject;
    key.target.position.copy(sub.center);
    key.position.copy(sub.center).addScaledVector(keyDir, 30);
    const half = Math.max(2.4, sub.radius * 1.5);
    const sc = key.shadow.camera;
    if (Math.abs(sc.right - half) > 0.05) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.updateProjectionMatrix();
    }

    // callouts (HTML overlay)
    if (onCallouts) onCallouts(s.callouts > 0.001 ? projectCallouts(s.callouts) : null);
    return s;
  }

  function placeArea(cfg) {
    area.position.copy(cfg.pos);
    if (area.isRectAreaLight) {
      area.lookAt(cfg.look);
      area.width = cfg.w;
      area.height = cfg.h;
    } else area.target.position.copy(cfg.look);
    area.color.copy(cfg.color);
  }

  const currentSubject = { center: new THREE.Vector3(), radius: 3, distance: 10 };
  function updateCamera(s, dt) {
    const k = cameraKeys(P, s, klass);
    const safe = safeRect(P);
    // micro-motion + pointer parallax
    const hero = 1 - smooth(norm(P, 0, 0.9));
    pointerSmooth.lerp(pointer, record ? 1 : dampK(2.5, dt));
    const az = k.az + Math.sin(time * 0.21) * (0.012 + 0.03 * hero) + pointerSmooth.x * 0.035;
    const el = k.el + Math.sin(time * 0.17) * (0.008 + 0.012 * hero) + pointerSmooth.y * 0.02;

    camera.fov = k.fov;
    dirCam.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    let d = frameSphere(k.radius, k.fov, aspect, safe, k.fill);
    d = Math.max(d, glassClearance(k.center, dirCam, s.door));
    tmp2.copy(k.center).addScaledVector(dirCam, d);

    const lam = record || !camInit ? 1 : dampK(7, dt);
    camPos.lerp(tmp2, lam);
    camTarget.lerp(k.center, lam);
    camOffset.lerp(tmp.set(safe.cx, safe.cy, 0), lam);
    camInit = true;

    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    camera.near = Math.max(0.05, d * 0.02);
    camera.far = d * 12 + 120;
    camera.updateProjectionMatrix();
    // shift the projection so the subject sits in the centre of the safe area
    const ox = -camOffset.x * 0.5 * width;
    const oy = camOffset.y * 0.5 * height;
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) camera.setViewOffset(width, height, ox, oy, width, height);
    else camera.clearViewOffset();

    // studio: fog closes in so the dimmed set dissolves into the background
    scene.fog.near = d * lerp(1.7, 1.08, s.studio);
    scene.fog.far = lerp(d * 6 + 30, d * 2.3, s.studio);
    currentSubject.center.copy(k.center);
    currentSubject.radius = k.radius;
    currentSubject.distance = camPos.distanceTo(k.center);
    post.focus(currentSubject.distance, k.radius, k.bokeh * (record ? 1 : 1));
  }

  /* ---------- callouts: project feature points of the example part ---------- */
  const anchors = (() => {
    const yTop = 0.78;
    const yBot = -0.78;
    return {
      L: { a: [PART_L, yTop], b: [X_FACE, yTop], ea: [PART_L, 0.56], eb: [X_FACE, 0.31] },
      D1: { x: -0.15, r: finishedRadius(-0.15), label: [-0.15, yBot - 0.15] },
      D2: { x: 0.65, r: finishedRadius(0.65), label: [0.65, yBot - 0.15] },
      M: { x: 2.26, r: finishedRadius(2.26), label: [2.75, 0.9] },
    };
  })();
  const _v = new THREE.Vector3();
  function toScreen(x, y, z = 0) {
    // part-local (original part coordinates) → world → CSS px
    _v.set(x - PART_CENTER, y, z);
    _v.applyQuaternion(partGroup.quaternion).add(partGroup.position);
    _v.project(camera);
    return [Math.round((_v.x * 0.5 + 0.5) * width * 2) / 2, Math.round((-_v.y * 0.5 + 0.5) * height * 2) / 2];
  }
  function projectCallouts(alpha) {
    camera.updateMatrixWorld();
    const A = anchors;
    const out = { alpha, items: [] };
    out.items.push({
      type: 'length',
      label: 'L',
      a: toScreen(...A.L.a),
      b: toScreen(...A.L.b),
      ea: [toScreen(A.L.ea[0], A.L.ea[1]), toScreen(...A.L.a)],
      eb: [toScreen(A.L.eb[0], A.L.eb[1]), toScreen(...A.L.b)],
    });
    for (const [key2, label] of [['D1', 'Ø D₁'], ['D2', 'Ø D₂']]) {
      const f = A[key2];
      out.items.push({ type: 'dia', label, top: toScreen(f.x, f.r), bottom: toScreen(f.x, -f.r), text: toScreen(...f.label) });
    }
    out.items.push({ type: 'leader', label: 'M · thread', at: toScreen(A.M.x, A.M.r), text: toScreen(...A.M.label) });
    out.caption = toScreen(PART_L, -1.35);
    return out;
  }

  /* ---------- environment (after the machine is built) ---------- */
  const env = await envPromise;
  scene.environment = env;

  /* ---------- optional real models (manifest) ---------- */
  const manifest = await manifestPromise;
  // Entries are a file name, or { "desktop": "…glb", "mobile": "…glb" } (lower LOD / 1k textures).
  const pick = (entry) => (!entry ? null : typeof entry === 'string' ? entry : (tier.texSize <= 512 && entry.mobile) || entry.desktop || null);
  const modelJobs = [];
  if (pick(manifest.lathe)) modelJobs.push(applyLatheModel(pick(manifest.lathe)));
  if (pick(manifest.caliper)) modelJobs.push(applyCaliperModel(pick(manifest.caliper)));
  if (pick(manifest.workshop)) modelJobs.push(applyWorkshopModel(pick(manifest.workshop)));

  async function applyLatheModel(file) {
    try {
      const gltf = await loadModel(renderer, file, null, manager);
      const root = prepareModel(gltf.scene, renderer);
      machine.group.add(root);
      root.updateMatrixWorld(true);
      machine.shell.visible = false; // the model replaces the static shell
      // Optional animated nodes (see ASSETS.md): each is attached to the matching animated
      // group so it moves with the timeline; our procedural meshes in that group are hidden.
      const follow = (name, group, keep = null) => {
        const node = root.getObjectByName(name);
        if (!node) return;
        const hide = (o) => {
          if (o === keep) return; // e.g. the turret disc keeps its own tools unless TurretDisc is supplied
          if (o.isMesh) o.visible = false;
          o.children.forEach(hide);
        };
        group.children.forEach(hide);
        group.attach(node); // keeps its world transform, then follows the group
      };
      follow('Spindle', machine.spindle);
      follow('Door', machine.door);
      follow('Turret', machine.turret.mount, machine.turret.disc);
      follow('TurretDisc', machine.turret.disc);
    } catch (err) {
      console.warn('CNC lathe model could not be loaded — using the procedural machine.', err);
    }
  }
  async function applyCaliperModel(file) {
    try {
      const gltf = await loadModel(renderer, file, null, manager);
      const root = prepareModel(gltf.scene, renderer);
      const slider = root.getObjectByName('Slider');
      bench.caliper.children.forEach((c) => c !== bench.slider && (c.visible = false));
      bench.slider.children.forEach((c) => (c.visible = false));
      bench.caliper.add(root);
      bench.caliper.updateMatrixWorld(true);
      if (slider) bench.slider.attach(slider); // moves with the animated jaw
    } catch (err) {
      console.warn('Caliper model could not be loaded — using the procedural caliper.', err);
    }
  }
  async function applyWorkshopModel(file) {
    try {
      const gltf = await loadModel(renderer, file, null, manager);
      background.visible = false;
      scene.add(prepareModel(gltf.scene, renderer));
    } catch (err) {
      console.warn('Workshop model could not be loaded — using the procedural background.', err);
    }
  }
  if (record) await Promise.all(modelJobs);

  /* ---------- run control ---------- */
  let running = false;
  let wanted = true;
  let onScreen = true;
  let disposed = false;
  let ready = false; // no rendering until shaders are compiled (async, non-blocking)
  const stats = new URLSearchParams(location.search).has('debug') ? [] : null; // per-frame [apply ms, render ms, dt ms, P]
  let last = performance.now();
  const fixedDt = 1 / 30;

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now;
    step(dt);
    adaptive.sample(dt, now);
  }

  function step(dt) {
    time += dt;
    if (introT >= 0) introT += dt;
    const prev = P;
    P = record ? targetP : Math.abs(targetP - P) < 1e-4 ? targetP : P + (targetP - P) * dampK(8, dt);
    const t0 = stats ? performance.now() : 0;
    const s = apply(dt, Math.abs(P - prev) / dt);
    animateBenchCaliper(s);
    const t1 = stats ? performance.now() : 0;
    post.render(dt);
    if (stats) {
      stats.push([+(t1 - t0).toFixed(2), +(performance.now() - t1).toFixed(2), +(dt * 1000).toFixed(1), +P.toFixed(3)]);
      if (stats.length > 2000) stats.shift();
    }
    return s;
  }

  function animateBenchCaliper(s) {
    // caliper slides in from the front-right, jaw closes onto the diameter
    const cal = bench.caliper;
    const rest = bench.caliperRest;
    const inK = s.caliperIn;
    cal.visible = inK > 0.001;
    cal.position.copy(rest).add(tmp.set(2.6 * (1 - inK), 0.6 * (1 - inK), 2.4 * (1 - inK)));
    cal.rotation.set(0, (1 - inK) * -0.5, 0);
    const gapClosed = 2 * finishedRadius(BENCH.caliperX);
    bench.slider.position.y = gapClosed + 0.9 * (1 - s.caliperClose);
  }

  function updateLoop() {
    const run = !record && !disposed && wanted && onScreen && !document.hidden;
    if (run && !running) {
      last = performance.now();
      adaptive.reset();
      renderer.setAnimationLoop(frame);
      running = true;
    } else if (!run && running) {
      renderer.setAnimationLoop(null);
      running = false;
    }
  }
  const onVis = () => updateLoop();
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    updateLoop();
  });
  io.observe(canvas);

  const sizeWatch = watchSize(canvas, ({ width: w, height: h, aspect: a }) => {
    width = w;
    height = h;
    aspect = a;
    klass = aspectClass(a);
    camera.aspect = a;
    camera.updateProjectionMatrix();
    applySize();
    if (!running && !disposed && ready) step(0.0001);
  });

  const onLost = (e) => {
    e.preventDefault();
    disposed = true;
    updateLoop();
    onContextLost && onContextLost();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  /* ---------- first frame ---------- */
  sizeWatch.flush();
  applySize();
  apply(0, 0);
  await renderer.compileAsync(scene, camera);
  ready = true;
  post.render(0);
  pFirst(1);
  canvas.classList.add('is-ready');
  updateLoop();

  // Progressive quality: swap to the 2k HDRI once the page is idle (high tier only).
  if (!record && tier.hdri === '2k') {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1200));
    idle(() => {
      loadEnvironment(renderer, '2k', null, manager)
        .then((hi) => {
          if (disposed) return hi.dispose();
          const old = scene.environment;
          scene.environment = hi;
          old && old.dispose();
        })
        .catch(() => {});
    });
  }

  const controller = {
    tier,
    get aspectClass() {
      return klass;
    },
    setProgress(p) {
      targetP = Math.min(6, Math.max(0, p));
      if (!running && !disposed && !record && ready) {
        P = targetP;
        step(0.0001);
      }
    },
    setActive(active) {
      wanted = active;
      updateLoop();
    },
    /** Layout from the page: where the text sits, so the subject never goes under it. */
    setLayout(l) {
      layout = l || DEFAULT_LAYOUT;
      if (!running && !disposed && ready) step(0.0001);
    },
    /** Normalised pointer position (−1..1) for subtle parallax (desktop). */
    setPointer(x, y) {
      pointer.set(x, y);
    },
    startIntro() {
      if (introT < 0) introT = 0;
    },
    /** Deterministic stepping for ?record=1: set P, simulate `substeps` fixed steps, render. */
    renderAt(p, substeps = 1) {
      targetP = p;
      let s;
      for (let i = 0; i < substeps; i++) s = step(fixedDt / substeps);
      return s;
    },
    resize() {
      sizeWatch.flush();
    },
    getStats() {
      return stats;
    },
    getCallouts() {
      return projectCallouts(1);
    },
    /** Screen rectangle (CSS px) of the workpiece — used by the layout checks. */
    getSubjectRect() {
      work.mesh.updateWorldMatrix(true, false);
      const bb = work.mesh.geometry.boundingBox;
      const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let i = 0; i < 8; i++) {
        _v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        _v.applyMatrix4(work.mesh.matrixWorld).project(camera);
        const x = (_v.x * 0.5 + 0.5) * width;
        const y = (-_v.y * 0.5 + 0.5) * height;
        r.x0 = Math.min(r.x0, x);
        r.y0 = Math.min(r.y0, y);
        r.x1 = Math.max(r.x1, x);
        r.y1 = Math.max(r.y1, y);
      }
      return { ...r, P };
    },
    renderer,
    canvas,
    dispose() {
      disposed = true;
      updateLoop();
      io.disconnect();
      sizeWatch.dispose();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      post.dispose();
      work.dispose();
      chips.dispose();
      coolant.dispose();
      M.dispose();
      scene.traverse((o) => o.geometry && o.geometry.dispose());
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
    },
  };
  return controller;
}

/* ==========================================================================
   Spindle motion blur
   ========================================================================== */
function buildSpindleBlur(spindle, M, N = 16) {
  // Collect the non-symmetric rotating detail (jaws, screws, slots) in spindle space.
  spindle.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(spindle.matrixWorld).invert();
  const geos = [];
  const detail = [];
  spindle.traverse((o) => {
    if (!o.isMesh || o.parent === spindle) return; // direct children are the symmetric body/plate/stub
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      geos.push(ng.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    } else geos.push(g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    detail.push(o);
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  const mat = new THREE.MeshStandardMaterial({ color: M.jawSteel.color.clone(), metalness: 1, roughness: 0.4, transparent: true, opacity: 1 / N, depthWrite: false });
  const group = new THREE.Group();
  group.name = 'spindle-blur';
  const ghosts = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(merged, mat);
    m.renderOrder = 1;
    group.add(m);
    ghosts.push(m);
  }
  group.visible = false;
  return {
    group,
    update(w, speed) {
      const blurOn = speed > 0.35;
      group.visible = blurOn;
      for (const o of detail) o.visible = speed < 0.6;
      if (!blurOn) return;
      // shutter: 1/60 s → arc swept during the exposure (trailing the rotation)
      const arc = Math.min(Math.PI / 2, w * (1 / 60));
      ghosts.forEach((g, i) => (g.rotation.x = (i / (N - 1)) * arc));
      mat.opacity = Math.min(1, (1.6 / N) * (1 + smooth(norm(speed, 0.35, 0.6))));
    },
  };
}
