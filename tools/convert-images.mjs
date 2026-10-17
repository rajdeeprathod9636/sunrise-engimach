/**
 * Converts the PNG renders in tools/out/ to AVIF + WebP at the sizes the site uses,
 * writing them to assets/img/renders/.
 *
 *   node tools/convert-images.mjs
 *
 * Settings: AVIF quality 58 (effort 6, 4:4:4 chroma for crisp metal edges),
 *           WebP quality 84 (effort 6). Part renders keep their alpha channel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const dest = path.join(here, '..', 'assets', 'img', 'renders');
fs.mkdirSync(dest, { recursive: true });

const AVIF = { quality: 58, effort: 6, chromaSubsampling: '4:4:4' };
const WEBP = { quality: 84, effort: 6, smartSubsample: true };

async function emit(input, name, width) {
  const img = sharp(input).resize({ width, kernel: 'lanczos3', withoutEnlargement: false });
  await img.clone().avif(AVIF).toFile(path.join(dest, `${name}.avif`));
  await img.clone().webp(WEBP).toFile(path.join(dest, `${name}.webp`));
  console.log(name);
}

// Stage stills
const stillDir = path.join(out, 'stills');
if (fs.existsSync(stillDir)) {
  for (const f of fs.readdirSync(stillDir).filter((f) => f.endsWith('.png'))) {
    const [, i, variant] = f.match(/stage-(\d)-(landscape|portrait)\.png/) || [];
    if (!variant) continue;
    const widths = variant === 'landscape' ? [2560, 1920, 1280] : [1080, 720];
    for (const w of widths) await emit(path.join(stillDir, f), `stage-${i}-${variant}-${w}`, w);
  }
}

// Part renders: 1× (from 2×), 2×, 3×
const partDir = path.join(out, 'parts');
if (fs.existsSync(partDir)) {
  for (const f of fs.readdirSync(partDir).filter((f) => f.endsWith('@3x.png'))) {
    const name = f.replace('part-', '').replace('@3x.png', '');
    const src3 = path.join(partDir, f);
    const src2 = path.join(partDir, f.replace('@3x', '@2x'));
    const base = name === 'showcase' ? 'about-part' : `part-${name}`;
    const w1 = name === 'showcase' ? 560 : 320;
    await emit(src2, `${base}-${w1}`, w1);
    await emit(src2, `${base}-${w1 * 2}`, w1 * 2);
    await emit(src3, `${base}-${w1 * 3}`, w1 * 3);
  }
}
