/**
 * Encodes the recorded frames (tools/out/frames/…) into the low-tier scroll videos.
 *
 *   node tools/encode-videos.mjs
 *
 * Every 2nd frame is a keyframe so scrubbing (setting currentTime on scroll) is
 * smooth and fast. Uses ffmpeg-static, or a system ffmpeg if FFMPEG is set.
 * Equivalent manual commands are listed in ASSETS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frames = path.join(here, 'out', 'frames');
const dest = path.join(here, '..', 'assets', 'video');
fs.mkdirSync(dest, { recursive: true });
let ffmpeg = process.env.FFMPEG;
if (!ffmpeg) ffmpeg = (await import('ffmpeg-static')).default;

const jobs = [
  { src: 'landscape', name: 'story-landscape-2560', scale: '2560:1440', crf264: 24, crfVp9: 36 },
  { src: 'landscape', name: 'story-landscape-1920', scale: '1920:1080', crf264: 24, crfVp9: 36 },
  { src: 'portrait', name: 'story-portrait-1080', scale: '1080:1920', crf264: 25, crfVp9: 37 },
];

for (const j of jobs) {
  const input = path.join(frames, j.src, 'frame-%04d.png');
  const common = ['-y', '-framerate', '30', '-i', input, '-vf', `scale=${j.scale}:flags=lanczos,format=yuv420p`, '-an'];
  console.log(`→ ${j.name}.mp4`);
  execFileSync(ffmpeg, [...common, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(j.crf264), '-g', '2', '-keyint_min', '1', '-sc_threshold', '0', '-profile:v', 'high', '-movflags', '+faststart', path.join(dest, `${j.name}.mp4`)], { stdio: 'inherit' });
  console.log(`→ ${j.name}.webm`);
  execFileSync(ffmpeg, [...common, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(j.crfVp9), '-g', '2', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', path.join(dest, `${j.name}.webm`)], { stdio: 'inherit' });
}
// Dimension callouts for the inspection stage (normalised to the video frame; only frames where they show)
for (const variant of ['landscape', 'portrait']) {
  const file = path.join(frames, variant, 'callouts.json');
  if (!fs.existsSync(file)) continue;
  const { frames: n, items } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sparse = {};
  items.forEach((c, i) => c && c.alpha > 0.001 && (sparse[i] = c));
  fs.writeFileSync(path.join(dest, `story-${variant}.callouts.json`), JSON.stringify({ frames: n, fps: 30, items: sparse }));
}
for (const f of fs.readdirSync(dest)) console.log(f, (fs.statSync(path.join(dest, f)).size / 1e6).toFixed(2), 'MB');
