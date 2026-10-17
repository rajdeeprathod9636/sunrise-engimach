/**
 * Shared material system (story scene, About showcase, part renders).
 *
 * Turned steel uses MeshPhysicalMaterial anisotropy with geometry tangents that run
 * around the circumference, plus a feed-mark normal map, so highlights behave like
 * real turned and faced steel. Raw bar uses a procedural mill-scale finish.
 *
 * Performance: only the anisotropic metals are MeshPhysicalMaterial; everything else
 * is MeshStandardMaterial, and parameters that would switch shader programs at run
 * time (clearcoat on/off) are kept constant, so every program compiles once at load.
 *
 * ?aniso=circ   streak highlights around the circumference
 * ?aniso=axial  streak across the lay (default — the measured look of turned steel:
 *               long axial bands on diameters, radial fans on faced ends)
 */
import * as THREE from 'three';
import * as TX from './textures.js';
import { ACCENT, LED_COLOR } from './util.js';

const srgb = (hex) => new THREE.Color(hex);

/** Real-world length (scene units) of one feed-mark texture tile: 0.6 mm feed at 50 mm/unit. */
const FEED_TILE = (0.6 / 50) * TX.FEED_GROOVES;

export function anisotropyRotation() {
  return new URLSearchParams(location.search).get('aniso') === 'circ' ? 0 : Math.PI / 2;
}

function repeat(tex, x, y) {
  const t = tex.clone();
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

/**
 * @param {object} opts
 * @param {number} opts.texSize   base procedural texture size (512 / 1024)
 * @param {THREE.WebGLRenderer} [opts.renderer]
 */
export function createMaterials({ texSize = 1024, renderer } = {}) {
  if (renderer) TX.setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  const small = texSize <= 512;
  const feed = TX.feedMarks(small ? 512 : 1024);
  const mill = TX.millScale(small ? 256 : 512);
  const peel = TX.paintPeel(small ? 128 : 256);
  const brush = TX.brushed(small ? 256 : 512);
  const rot = anisotropyRotation();
  const all = [];
  const track = (m, { dim = true } = {}) => {
    m.userData.baseColor = m.color.clone();
    m.userData.baseEnv = m.envMapIntensity ?? 1;
    m.userData.baseEmissive = m.emissiveIntensity ?? 0;
    m.userData.dimmable = dim;
    all.push(m);
    return m;
  };
  const std = (o, opts) => track(new THREE.MeshStandardMaterial(o), opts);

  /* ---- workpiece ---- */
  const cutSteel = track(
    new THREE.MeshPhysicalMaterial({
      name: 'cut-steel',
      color: srgb(0xc9cdd2),
      metalness: 1,
      roughness: 0.2,
      roughnessMap: repeat(feed.roughness, 4, 1 / FEED_TILE),
      normalMap: repeat(feed.normal, 4, 1 / FEED_TILE),
      normalScale: new THREE.Vector2(0.32, 0.32),
      anisotropy: 0.72,
      anisotropyRotation: rot,
      clearcoat: 0.001, // kept > 0 so the wet sheen never switches shader programs
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.05,
    }),
    { dim: false }
  );

  const rawStock = std(
    {
      name: 'mill-scale',
      color: 0xffffff,
      map: repeat(mill.albedo, 3, 1),
      roughness: 1,
      metalness: 1,
      roughnessMap: repeat(mill.orm, 3, 1),
      metalnessMap: repeat(mill.orm, 3, 1),
      normalMap: repeat(mill.normal, 3, 1),
      normalScale: new THREE.Vector2(0.9, 0.9),
      envMapIntensity: 0.9,
    },
    { dim: false }
  );

  /* ---- machine: machined (anisotropic) metals share one program ---- */
  const machined = (name, color, roughness, nrm, scale, env = 1) =>
    track(
      new THREE.MeshPhysicalMaterial({
        name,
        color: srgb(color),
        metalness: 1,
        roughness,
        normalMap: nrm,
        normalScale: new THREE.Vector2(scale, scale),
        anisotropy: 0.6,
        anisotropyRotation: rot,
        envMapIntensity: env,
      })
    );
  const chuckSteel = machined('chuck-steel', 0xaeb3ba, 0.3, repeat(feed.normal, 6, 0.5 / FEED_TILE), 0.18);
  const groundSteel = machined('ground-steel', 0xb3b8be, 0.24, repeat(brush.normal, 3, 3), 0.2);
  // Large interior sheet metal: brushed, but standard shading (it fills much of the frame)
  const stainless = std({
    name: 'stainless',
    color: srgb(0x5b6168),
    metalness: 1,
    roughness: 1,
    roughnessMap: repeat(brush.roughness, 1, 1),
    normalMap: repeat(brush.normal, 1, 1),
    normalScale: new THREE.Vector2(0.3, 0.3),
    envMapIntensity: 0.55,
  });

  const jawSteel = std({ name: 'jaw-steel', color: srgb(0x80868e), metalness: 1, roughness: 0.34, normalMap: repeat(brush.normal, 2, 2), normalScale: new THREE.Vector2(0.25, 0.25) });
  const blackOxide = std({ name: 'black-oxide', color: srgb(0x2b2d31), metalness: 0.85, roughness: 0.42 });
  const painted = (name, color, roughness, metal = 0) =>
    std({ name, color: srgb(color), metalness: metal, roughness, normalMap: repeat(peel, 4, 4), normalScale: new THREE.Vector2(0.28, 0.28) });
  const castGrey = painted('cast-grey', 0x3a3d42, 0.55, 0.15);
  const paintLight = painted('paint-light', 0x8f9398, 0.42);
  const paintDark = painted('paint-dark', 0x24272b, 0.48, 0.05);
  const rubber = std({ name: 'rubber', color: srgb(0x121316), roughness: 0.85, metalness: 0 });
  const panelLine = track(new THREE.MeshBasicMaterial({ name: 'seam', color: srgb(0x07080a) }));

  // Glass: reflections only (additive) + a faint absorption layer. Cheap and reads correctly.
  const glassReflect = std(
    { name: 'glass-reflect', color: 0x000000, metalness: 0, roughness: 0.04, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 2.4 },
    { dim: false }
  );
  const glassTint = track(
    new THREE.MeshBasicMaterial({ name: 'glass-tint', color: srgb(0x0b0d10), transparent: true, opacity: 0.18, depthWrite: false }),
    { dim: false }
  );

  /* ---- tooling ---- */
  const carbide = std({ name: 'carbide', color: srgb(0x3c3f45), metalness: 0.7, roughness: 0.28 });
  const tinCoat = std({ name: 'tin-coat', color: srgb(ACCENT), metalness: 1, roughness: 0.22, emissive: srgb(ACCENT), emissiveIntensity: 0 });

  /* ---- practical lights ---- */
  const led = std({ name: 'led', color: 0x000000, emissive: srgb(LED_COLOR), emissiveIntensity: 0 }, { dim: false });
  const statusAmber = std({ name: 'status-amber', color: 0x110a04, emissive: srgb(ACCENT), emissiveIntensity: 3.2 });
  const lampOff = std({ name: 'lamp-off', color: srgb(0x5a5e64), roughness: 0.2, metalness: 0 });
  const screen = std({ name: 'screen', color: srgb(0x0a0c0f), roughness: 0.12, metalness: 0, emissive: srgb(0x223040), emissiveIntensity: 0.25 });

  /* ---- inspection / environment ---- */
  const gran = TX.granite(small ? 256 : 512);
  const granite = std(
    { name: 'granite', color: 0xffffff, map: repeat(gran.albedo, 2, 2), roughnessMap: repeat(gran.roughness, 2, 2), roughness: 1, metalness: 0, envMapIntensity: 1.2 },
    { dim: false }
  );
  const con = TX.concrete(small ? 256 : 512);
  const concrete = std({
    name: 'concrete',
    color: srgb(0x9a9a9a),
    map: repeat(con.albedo, 10, 10),
    roughnessMap: repeat(con.roughness, 10, 10),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  // satin stainless for measuring tools and V-blocks (no anisotropy: thin parts would sparkle)
  const satin = std({ name: 'satin-steel', color: srgb(0x9aa0a7), metalness: 1, roughness: 0.34, normalMap: repeat(brush.normal, 2, 2), normalScale: new THREE.Vector2(0.15, 0.15) });
  const plastic = std({ name: 'plastic', color: srgb(0x1a1c20), roughness: 0.36, metalness: 0 });
  const lcd = std({ name: 'lcd', color: srgb(0x50574f), roughness: 0.15, metalness: 0, emissive: srgb(0x1c201c), emissiveIntensity: 0.3 });

  /* ---- chips & coolant ---- */
  const chip = std({ name: 'chip', color: 0xffffff, metalness: 1, roughness: 0.26, side: THREE.DoubleSide }, { dim: false });
  const coolant = std(
    {
      name: 'coolant',
      color: srgb(0x9aa6b0),
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.3,
      alphaMap: TX.coolantStreaks(),
      depthWrite: false,
      envMapIntensity: 3.2,
      side: THREE.DoubleSide,
    },
    { dim: false }
  );

  const lib = {
    cutSteel, rawStock, chuckSteel, jawSteel, groundSteel, blackOxide, castGrey, paintLight, paintDark, stainless,
    rubber, panelLine, glassReflect, glassTint, carbide, tinCoat, led, statusAmber, lampOff, screen, granite, concrete,
    plastic, lcd, chip, coolant, satin,
    all,
    /** Coolant film: wet sheen on the cut steel that dries off at inspection. */
    setWet(w) {
      cutSteel.clearcoat = 0.001 + 0.85 * w;
      cutSteel.roughness = 0.2 - 0.04 * w;
    },
    /** Dims set/environment materials (studio showcase). 1 = normal, 0 = black. */
    setDim(k, filter = () => true) {
      for (const m of all) {
        if (!m.userData.dimmable || !filter(m)) continue;
        m.color.copy(m.userData.baseColor).multiplyScalar(k);
        if ('envMapIntensity' in m) m.envMapIntensity = m.userData.baseEnv * k;
        if (m.emissive) m.emissiveIntensity = m.userData.baseEmissive * k;
      }
    },
    dispose() {
      const seen = new Set();
      for (const m of all) {
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture && !seen.has(v)) {
            seen.add(v);
            v.dispose();
          }
        }
        m.dispose();
      }
    },
  };
  return lib;
}
