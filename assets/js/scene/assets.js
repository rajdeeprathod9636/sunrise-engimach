/**
 * Asset loading: HDRI (Poly Haven, CC0) → PMREM environment, optional glTF models
 * (Draco / Meshopt geometry, KTX2 textures) and a LoadingManager that reports real
 * byte progress to the "PREPARING THE MACHINE" loader.
 *
 * Optional models are listed in assets/models/manifest.json. A model is only
 * requested when its entry names a file, so missing files never cause 404s.
 * See ASSETS.md for what to download and how to optimise it.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const THREE_VERSION = '0.169.0';
export const ASSET_ROOT = new URL('../../', import.meta.url); // → /assets/

export const PATHS = {
  hdri: { '1k': 'hdri/autoshop_01_1k.hdr', '2k': 'hdri/autoshop_01_2k.hdr' },
  manifest: 'models/manifest.json',
  models: 'models/',
};

export const url = (p) => new URL(p, ASSET_ROOT).href;

/**
 * Tracks weighted progress across steps (module import, HDRI bytes, models, build).
 */
export class Progress {
  constructor(onProgress) {
    this.onProgress = onProgress || (() => {});
    this.parts = new Map();
  }
  add(name, weight) {
    this.parts.set(name, { weight, value: 0 });
    return (v) => this.set(name, v);
  }
  set(name, v) {
    const p = this.parts.get(name);
    if (!p) return;
    p.value = Math.max(p.value, Math.min(1, v));
    let sum = 0;
    let total = 0;
    for (const q of this.parts.values()) {
      sum += q.value * q.weight;
      total += q.weight;
    }
    this.onProgress(total ? sum / total : 0);
  }
}

/** Loads an equirectangular .hdr and returns a prefiltered (PMREM) environment texture. */
export function loadEnvironment(renderer, size, onBytes, manager) {
  return new Promise((resolve, reject) => {
    const loader = new RGBELoader(manager);
    loader.setDataType(THREE.HalfFloatType);
    loader.load(
      url(PATHS.hdri[size]),
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
        pmrem.dispose();
        onBytes && onBytes(1);
        resolve(env);
      },
      (e) => {
        if (onBytes && e && e.total) onBytes(e.loaded / e.total);
      },
      reject
    );
  });
}

/** Reads the optional-model manifest. Returns {} if it is missing or invalid. */
export async function loadManifest() {
  try {
    const res = await fetch(url(PATHS.manifest), { cache: 'no-cache' });
    if (!res.ok) return {};
    const json = await res.json();
    return json && typeof json === 'object' ? json : {};
  } catch {
    return {};
  }
}

let gltfLoaderPromise = null;
/** Lazily creates a GLTFLoader with Draco, Meshopt and KTX2 support. */
export function getGLTFLoader(renderer, manager) {
  if (!gltfLoaderPromise) {
    gltfLoaderPromise = (async () => {
      const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js'),
        import('three/addons/loaders/KTX2Loader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
      ]);
      const base = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/libs/`;
      const draco = new DRACOLoader(manager).setDecoderPath(`${base}draco/gltf/`);
      const ktx2 = new KTX2Loader(manager).setTranscoderPath(`${base}basis/`).detectSupport(renderer);
      const loader = new GLTFLoader(manager);
      loader.setDRACOLoader(draco);
      loader.setKTX2Loader(ktx2);
      loader.setMeshoptDecoder(MeshoptDecoder);
      return loader;
    })();
  }
  return gltfLoaderPromise;
}

/** Loads a model named in the manifest (relative to assets/models/). */
export async function loadModel(renderer, file, onBytes, manager) {
  const loader = await getGLTFLoader(renderer, manager);
  return new Promise((resolve, reject) => {
    loader.load(
      url(PATHS.models + file),
      resolve,
      (e) => onBytes && e && e.total && onBytes(e.loaded / e.total),
      reject
    );
  });
}

/** Prepares a loaded glTF scene: shadows on, anisotropic filtering, sRGB colour maps. */
export function prepareModel(root, renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (m[key]) m[key].anisotropy = aniso;
      }
    }
  });
  return root;
}
