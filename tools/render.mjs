/**
 * Offline renders from the real-time scene (headless Chrome, uses your GPU).
 *
 *   node tools/render.mjs stills            6 stage stills, landscape 2560×1440 + portrait 1080×1920
 *   node tools/render.mjs frames [n]        scroll-video frames (default 240) for both orientations
 *   node tools/render.mjs parts             typical-part renders (2× and 3×) + About showcase still
 *   node tools/render.mjs og                Open Graph image (1200×630) → assets/img/og-image.png
 *   node tools/render.mjs all
 *
 * Output goes to tools/out/. Then run tools/convert-images.mjs and tools/encode-videos.mjs.
 * Setup once: cd tools && npm install   (puppeteer-core, sharp, ffmpeg-static)
 * Chrome is found automatically; set CHROME_PATH to override.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');
const out = path.join(here, 'out');
const PORT = 8766;
const BASE = `http://localhost:${PORT}`;

// Story moments used for the stills (one per stage).
export const STILL_P = [0.32, 1.55, 2.62, 3.72, 4.92, 5.72];
const VARIANTS = {
  landscape: { width: 2560, height: 1440 },
  portrait: { width: 1080, height: 1920 },
};

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found — set CHROME_PATH');
  return found;
}

async function launch() {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: false,
    protocolTimeout: 0,
    args: ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
}

const save = (file, dataURL) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataURL.split(',')[1], 'base64'));
};

async function openRecorder(browser, variant, frames = 10) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  const { width, height } = VARIANTS[variant];
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?record=1&frames=${frames}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__record && window.__record.ready', { timeout: 180000 });
  return page;
}

async function stills(browser) {
  for (const variant of Object.keys(VARIANTS)) {
    const page = await openRecorder(browser, variant);
    for (let i = 0; i < STILL_P.length; i++) {
      const data = await page.evaluate((p) => window.__record.still(p), STILL_P[i]);
      save(path.join(out, 'stills', `stage-${i}-${variant}.png`), data);
      console.log(`still ${variant} stage ${i}`);
    }
    await page.close();
  }
}

async function frames(browser, n = 240) {
  for (const variant of Object.keys(VARIANTS)) {
    const page = await openRecorder(browser, variant, n);
    const dir = path.join(out, 'frames', variant);
    fs.rmSync(dir, { recursive: true, force: true });
    const log = [];
    for (let i = 0; i < n; i++) {
      const data = await page.evaluate((k) => window.__record.frame(k), i);
      save(path.join(dir, `frame-${String(i).padStart(4, '0')}.png`), data);
      log.push(await page.evaluate(() => window.__record.callouts()));
      if (i % 20 === 0) console.log(`frames ${variant} ${i}/${n}`);
    }
    fs.writeFileSync(path.join(dir, 'callouts.json'), JSON.stringify({ frames: n, items: log }));
    await page.close();
  }
}

async function parts(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/services.html?render=parts`, { waitUntil: 'load' });
  await page.waitForFunction('window.__parts', { timeout: 300000 });
  const shots = await page.evaluate(() => window.__parts.map((s) => ({ name: s.name, scale: s.scale, dataURL: s.dataURL })));
  for (const s of shots) save(path.join(out, 'parts', `part-${s.name}@${s.scale}x.png`), s.dataURL);
  console.log(`parts: ${shots.length} images`);
  await page.close();
}

async function og(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/tools/og.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(site, 'assets', 'img', 'og-image.png'), type: 'png' });
  console.log('og-image.png written');
  await page.close();
}

const [cmd = 'all', arg] = process.argv.slice(2);
const server = await startServer(PORT, site);
const browser = await launch();
try {
  if (cmd === 'stills' || cmd === 'all') await stills(browser);
  if (cmd === 'parts' || cmd === 'all') await parts(browser);
  if (cmd === 'og' || cmd === 'all') await og(browser);
  if (cmd === 'frames' || cmd === 'all') await frames(browser, Number(arg) || 240);
} finally {
  await browser.close();
  server.close();
}
