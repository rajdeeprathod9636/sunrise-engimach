/**
 * ?record=1 — renders the story frame by frame at the high tier and saves PNGs,
 * for the low-tier scroll videos and the static stills.
 *
 *   index.html?record=1&frames=288          landscape (size the window, e.g. 2560×1440)
 *   index.html?record=1&frames=288&portrait (open at a portrait size, e.g. 1080×1920)
 *
 * In Chrome/Edge, click "Record to folder" and pick an empty folder: frames are
 * written as frame-0000.png … plus callouts.json. Headless capture scripts can
 * instead call window.__record.frame(i) / .still(p) (see tools/render.mjs).
 */
import { initStoryScene } from './story.js';
import { TIERS } from './quality.js';

export async function initRecorder(canvas, { measureLayout, onCallouts }) {
  const root = document.documentElement;
  root.classList.add('is-recording', 'has-3d');
  const params = new URLSearchParams(location.search);
  const frames = Math.max(2, Number(params.get('frames') || 288));
  const tier = { ...TIERS.high, maxDpr: 1, minDpr: 1 };
  let lastCallouts = null;

  const controller = await initStoryScene(canvas, {
    tier,
    record: true,
    onCallouts: (c) => {
      lastCallouts = c;
      onCallouts && onCallouts(c);
    },
  });
  controller.setLayout(measureLayout());
  controller.startIntro();

  const W = () => canvas.clientWidth;
  const H = () => canvas.clientHeight;
  const normCallouts = () => {
    if (!lastCallouts) return null;
    const n = (p) => [+(p[0] / W()).toFixed(5), +(p[1] / H()).toFixed(5)];
    const items = lastCallouts.items.map((it) => {
      const o = { ...it };
      for (const k of ['a', 'b', 'top', 'bottom', 'text', 'at']) if (o[k]) o[k] = n(o[k]);
      if (o.ea) o.ea = o.ea.map(n);
      if (o.eb) o.eb = o.eb.map(n);
      return o;
    });
    return { alpha: +lastCallouts.alpha.toFixed(3), items, caption: n(lastCallouts.caption) };
  };

  const P = (i) => (i / (frames - 1)) * 6;
  const api = {
    frames,
    ready: true,
    /** Renders frame i of the sequence and returns it as a PNG data URL. */
    frame(i) {
      if (i === 0) controller.renderAt(0, 1);
      controller.renderAt(P(i), 1);
      return canvas.toDataURL('image/png');
    },
    /** A still at progress p (approached from slightly earlier so chips and coolant are alive). */
    still(p, approach = 0.04, steps = 24) {
      for (let k = 0; k <= steps; k++) controller.renderAt(Math.max(0, p - approach * (1 - k / steps)), 1);
      return canvas.toDataURL('image/png');
    },
    callouts: normCallouts,
    relayout() {
      controller.setLayout(measureLayout());
    },
  };
  window.__record = api;

  // Manual recording UI (File System Access API)
  if ('showDirectoryPicker' in window) {
    const bar = document.createElement('div');
    bar.className = 'record-bar';
    bar.innerHTML = `<button type="button">Record ${frames} frames to folder</button><span></span>`;
    document.body.appendChild(bar);
    const status = bar.querySelector('span');
    bar.querySelector('button').addEventListener('click', async () => {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const log = [];
      for (let i = 0; i < frames; i++) {
        const url = api.frame(i);
        const blob = await (await fetch(url)).blob();
        const fh = await dir.getFileHandle(`frame-${String(i).padStart(4, '0')}.png`, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        log.push(api.callouts());
        status.textContent = ` ${i + 1} / ${frames}`;
      }
      const fh = await dir.getFileHandle('callouts.json', { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ frames, items: log }));
      await w.close();
      status.textContent = ' done';
    });
  }
  return api;
}
