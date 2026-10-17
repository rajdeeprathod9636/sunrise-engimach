/**
 * Sunrise Engimach — 3D entry point.
 * The scene is split into modules under ./scene/:
 *   renderer.js  quality.js  assets.js  materials.js  textures.js  workpiece.js
 *   machine.js   set.js      chips.js   coolant.js    timeline.js  post.js
 *   story.js (home scroll story)   showcase.js (About)   parts.js (part renders)
 */
export { initStoryScene } from './scene/story.js';
export { initShowcase } from './scene/showcase.js';
export { detectTier, TIERS } from './scene/quality.js';
