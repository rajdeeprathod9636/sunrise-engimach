/**
 * Post-processing chain (pmndrs postprocessing + N8AO), built per quality tier:
 *
 *   RenderPass (MSAA ×4 on high, half-float HDR buffers)
 *   → N8AO ambient occlusion (full-res high / half-res medium)
 *   → [depth of field (high)] + bloom (emissives only: high threshold) + tone mapping
 *     + very faint vignette + [film grain (high, barely visible)]
 *   → SMAA (edges of threads, chamfers and jaws stay clean on any DPR)
 *
 * Sharpness rule: depth of field always keeps the subject sphere inside its focus
 * range, and nothing else in the chain softens the image.
 */
import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  BloomEffect,
  DepthOfFieldEffect,
  VignetteEffect,
  NoiseEffect,
  ToneMappingEffect,
  ToneMappingMode,
  BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export function createPost(renderer, scene, camera, tier, { toneMapping = 'agx', width = 1, height = 1, alpha = false } = {}) {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: tier.msaa || 0,
    stencilBuffer: false,
    alpha,
  });
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let ao = null;
  if (tier.ao) {
    try {
      ao = new N8AOPostPass(scene, camera, width, height);
      ao.setQualityMode(tier.ao === 'full' ? 'Medium' : 'Performance');
      Object.assign(ao.configuration, {
        aoRadius: 0.55,
        distanceFalloff: 0.45,
        intensity: 2.6,
        halfRes: tier.ao === 'half',
        depthAwareUpsampling: true,
        color: new THREE.Color(0, 0, 0),
      });
      if (tier.ao === 'half') Object.assign(ao.configuration, { aoSamples: 6, denoiseSamples: 4, denoiseRadius: 8, denoiseIterations: 1 });
      composer.addPass(ao);
    } catch (err) {
      console.warn('Ambient occlusion unavailable on this device.', err);
      ao = null;
    }
  }

  const effects = [];
  let dof = null;
  if (tier.dof) {
    dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 12, worldFocusRange: 6, bokehScale: 1.5, resolutionScale: 0.5 });
    effects.push(dof);
  }
  let bloom = null;
  if (tier.bloom) {
    const lite = tier.name !== 'high';
    bloom = new BloomEffect({
      luminanceThreshold: 1.05,
      luminanceSmoothing: 0.2,
      intensity: 0.42,
      mipmapBlur: true,
      radius: 0.62,
      levels: lite ? 5 : 8,
      resolutionScale: lite ? 0.5 : 1,
    });
    effects.push(bloom);
  }
  const tone = new ToneMappingEffect({ mode: toneMapping === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX });
  effects.push(tone);
  const vignette = new VignetteEffect({ offset: 0.3, darkness: alpha ? 0 : 0.38 });
  if (!alpha) effects.push(vignette);
  let grain = null;
  if (tier.grain) {
    grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
    grain.blendMode.opacity.value = 0.035;
    effects.push(grain);
  }
  composer.addPass(new EffectPass(camera, ...effects));

  if (tier.smaa) {
    const smaa = new SMAAEffect({ preset: tier.name === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM, edgeDetectionMode: EdgeDetectionMode.COLOR });
    composer.addPass(new EffectPass(camera, smaa));
  }

  return {
    composer,
    ao,
    dof,
    bloom,
    vignette,
    setSize(w, h) {
      composer.setSize(w, h, false);
    },
    /** Rack focus: keep the whole subject sphere sharp, blur only what is beyond it. */
    focus(distance, subjectRadius, bokeh) {
      if (!dof) return;
      dof.cocMaterial.worldFocusDistance = distance;
      dof.cocMaterial.worldFocusRange = Math.max(subjectRadius * 2.2, distance * 0.18);
      dof.bokehScale = bokeh;
    },
    render(dt) {
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
    },
  };
}
