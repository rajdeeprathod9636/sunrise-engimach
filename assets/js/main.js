/**
 * Sunrise Engimach — shared UI
 * Config binding, SEO schema, navigation, smooth scroll, reveals,
 * page transitions, and (on the home page) the 3D scroll story.
 */
import { CONFIG, LINKS, LAT, LNG, HAS_COORDS, PHONES, display, isPlaceholder, addressLines } from './config.js';

const root = document.documentElement;
const page = document.body.dataset.page || '';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobileUA =
  /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const hasGsap = Boolean(gsap && ScrollTrigger);
const params = new URLSearchParams(location.search);
const recordMode = page === 'home' && params.has('record'); // ?record=1 — frame-by-frame capture
const renderMode = params.get('render'); // ?render=parts — part render export (Services)

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

if (hasGsap) {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
}

applyConfig();
injectSchema();
initHeader();
const lenis = initSmoothScroll();
initMenu();
initTransitions();
initReveals();

if (page === 'home') initHome();
if (page === 'about') initAboutShowcase();
if (renderMode === 'parts') import('./scene/parts.js').then((m) => m.renderPartsMode());

if (hasGsap && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => ScrollTrigger.refresh());
}

/* ==========================================================================
   Config → page
   ========================================================================== */
function applyConfig() {
  const { company, location, machine } = CONFIG;
  const text = {
    name: company.name,
    founder: company.founder,
    founderTitle: company.founderTitle,
    founded: String(company.foundedYear),
    address: addressLines().join('\n'), // rendered with white-space: pre-line
    city: `${location.city}, ${location.region}, ${location.country}`,
    year: String(new Date().getFullYear()),
  };
  const hrefs = {
    whatsapp: LINKS.whatsapp(),
    directions: LINKS.directions,
    map: LINKS.mapView,
  };
  // "phone"/"tel" = primary number; "phone1", "phone2"… = numbers in config order.
  PHONES.forEach((p, i) => {
    text[`phone${i + 1}`] = p.display;
    hrefs[`tel${i + 1}`] = LINKS.tel(i);
  });
  text.phone = text.phone1;
  hrefs.tel = hrefs.tel1;

  $$('[data-cfg]').forEach((el) => {
    const v = text[el.dataset.cfg];
    if (v !== undefined) el.textContent = v;
  });
  $$('[data-href]').forEach((el) => {
    const v = hrefs[el.dataset.href];
    if (v) el.setAttribute('href', v);
  });
  // Hide markup for a phone slot that has no number in config (e.g. only one number listed).
  $$('[data-phone-slot]').forEach((el) => {
    el.hidden = !PHONES[Number(el.dataset.phoneSlot) - 1];
  });

  // On phones, open WhatsApp / Google Maps in the same tab so the OS hands off to the app directly.
  if (isMobileUA) {
    $$('[data-href="whatsapp"], [data-href="directions"]').forEach((el) => el.removeAttribute('target'));
  }

  $$('[data-map-embed]').forEach((frame) => {
    if (frame.getAttribute('src') !== LINKS.mapEmbed) frame.setAttribute('src', LINKS.mapEmbed);
  });

  // Machine spec cards: placeholders render as "On request"
  $$('[data-spec]').forEach((el) => {
    const raw = machine[el.dataset.spec];
    const pending = !raw || isPlaceholder(raw);
    el.textContent = display(raw);
    el.classList.toggle('is-on-request', pending);
    const note = el.parentElement && el.parentElement.querySelector('[data-spec-note]');
    if (note) note.hidden = !pending;
  });
}

function injectSchema() {
  const { company, location, site } = CONFIG;
  const address = {
    '@type': 'PostalAddress',
    addressLocality: location.locality || location.city,
    addressRegion: location.region,
    addressCountry: location.countryCode,
  };
  if (location.streetAddress && !isPlaceholder(location.streetAddress)) address.streetAddress = location.streetAddress;
  if (location.postalCode && !isPlaceholder(location.postalCode)) address.postalCode = location.postalCode;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${site.url}/#business`,
    name: company.name,
    description: company.description,
    url: `${site.url}/`,
    logo: `${site.url}/assets/img/logo.svg`,
    image: `${site.url}/assets/img/og-image.png`,
    foundingDate: String(company.foundedYear),
    founder: { '@type': 'Person', name: company.founder },
    address,
    hasMap: LINKS.mapView,
    areaServed: { '@type': 'Country', name: 'India' },
    knowsAbout: CONFIG.services.filter((s) => !/other/i.test(s)),
  };
  if (PHONES[0]) schema.telephone = PHONES[0].tel;
  if (PHONES.length > 1) {
    schema.contactPoint = PHONES.slice(1).map((p) => ({
      '@type': 'ContactPoint',
      telephone: p.tel,
      contactType: 'sales',
      areaServed: 'IN',
      availableLanguage: ['en', 'hi', 'gu'],
    }));
  }
  if (HAS_COORDS) schema.geo = { '@type': 'GeoCoordinates', latitude: LAT, longitude: LNG };
  const tag = document.createElement('script');
  tag.type = 'application/ld+json';
  tag.textContent = JSON.stringify(schema);
  document.head.appendChild(tag);
}

/* ==========================================================================
   Header & mobile menu
   ========================================================================== */
function initHeader() {
  const header = $('[data-header]');
  if (!header) return;
  let ticking = false;
  const update = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 24);
    ticking = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
}

function initMenu() {
  const toggle = $('[data-menu-toggle]');
  const menu = $('[data-mobile-menu]');
  if (!toggle || !menu) return;
  let open = false;

  const focusables = () => [toggle, ...$$('a, button', menu)];

  function setOpen(next) {
    open = next;
    menu.dataset.open = String(next);
    menu.inert = !next;
    toggle.setAttribute('aria-expanded', String(next));
    toggle.setAttribute('aria-label', next ? 'Close menu' : 'Open menu');
    root.classList.toggle('menu-open', next);
    if (next) {
      lenis && lenis.stop();
      document.body.style.overflow = 'hidden';
      const first = $('a', menu);
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 80);
    } else {
      lenis && lenis.start();
      document.body.style.overflow = '';
    }
  }

  menu.inert = true;
  toggle.addEventListener('click', () => {
    setOpen(!open);
    if (!open) toggle.focus();
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    } else if (e.key === 'Tab') {
      const items = focusables();
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    }
  });
  window.matchMedia('(min-width: 960px)').addEventListener('change', (e) => {
    if (e.matches && open) setOpen(false);
  });
}

/* ==========================================================================
   Smooth scroll (Lenis) + GSAP
   ========================================================================== */
function initSmoothScroll() {
  if (reduceMotion || typeof window.Lenis === 'undefined' || params.has('nolenis')) return null;
  const instance = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
  if (hasGsap) {
    instance.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => instance.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (t) => {
      instance.raf(t);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }

  $$('a[data-scroll]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const target = id && id.startsWith('#') ? $(id) : null;
      if (!target) return;
      e.preventDefault();
      instance.scrollTo(target, { offset: 0, duration: 1.6 });
    });
  });
  return instance;
}

function initReveals() {
  if (reduceMotion || !hasGsap) return;

  // Fade + blur-to-sharp + slight rise. Filters are cleared afterwards so text renders
  // at full sharpness and glass panels keep their backdrop blur.
  const reveal = { autoAlpha: 0, y: 14, filter: 'blur(8px)', ease: 'power3.out', clearProps: 'filter,transform' };
  const heroItems = $$('[data-hero-item]');
  const heroTitle = $('[data-hero-title]');
  if (heroTitle) gsap.from(heroTitle, { y: 24, filter: 'blur(8px)', duration: 1.1, ease: 'power3.out', delay: 0.15, clearProps: 'filter,transform' });
  if (heroItems.length) gsap.from(heroItems, { ...reveal, duration: 0.9, stagger: 0.1, delay: 0.3 });

  $$('[data-reveal]').forEach((el) => {
    gsap.from(el, { ...reveal, duration: 0.9, scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });
  $$('[data-reveal-group]').forEach((group) => {
    gsap.from(group.children, {
      ...reveal,
      duration: 0.8,
      stagger: 0.08,
      scrollTrigger: { trigger: group, start: 'top 86%', once: true },
    });
  });

  // Amber eyebrow rule draws in when its heading comes into view.
  $$('.eyebrow:not(.eyebrow--plain)').forEach((el) => {
    el.classList.add('eyebrow--pending');
    ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => el.classList.remove('eyebrow--pending') });
  });
}

/* ==========================================================================
   Page transitions (subtle fade)
   ========================================================================== */
function initTransitions() {
  if (reduceMotion) return;
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return;
    e.preventDefault();
    root.classList.add('is-leaving');
    setTimeout(() => {
      location.href = url.href;
    }, 260);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) root.classList.remove('is-leaving');
  });
}

/* ==========================================================================
   Home — loader, quality tier and the scroll story
   high / medium: real-time 3D · low: scroll-scrubbed video · static: stills
   ========================================================================== */
const STAGES = 6;
const RENDERS = 'assets/img/renders/';
const VIDEO = 'assets/video/';
const stackQuery = window.matchMedia('(max-width: 767px), (max-aspect-ratio: 1/1)');

async function initHome() {
  const loader = $('[data-loader]');
  const fill = $('[data-loader-fill]');
  const canvas = $('#scene');
  const setLoader = (p) => fill && fill.style.setProperty('--p', String(Math.max(0.06, Math.min(1, p))));
  let loaderDone = false;
  let onLoaderDone = null;
  const finishLoader = () => {
    if (loaderDone) return;
    loaderDone = true;
    setLoader(1);
    if (loader) setTimeout(() => loader.classList.add('is-done'), 180);
    onLoaderDone && setTimeout(onLoaderDone, 380);
  };
  // Never block content for more than ~2 s after navigation, however slow the 3D setup is.
  const failsafe = setTimeout(finishLoader, Math.max(0, 1900 - performance.now()));

  if (recordMode) {
    clearTimeout(failsafe);
    finishLoader();
    const mod = await import('./scene/record.js');
    mod.initRecorder(canvas, { measureLayout, onCallouts: drawCallouts });
    return;
  }

  let tier;
  try {
    const { detectTier } = await import('./scene/quality.js');
    ({ tier } = await detectTier({ reduceMotion }));
  } catch {
    tier = { name: reduceMotion ? 'static' : 'low', realtime: false };
  }
  root.dataset.tier = tier.name;
  setLoader(0.12);

  if (tier.realtime && canvas) {
    try {
      const mod = await import('./scene.js');
      let controller = null;
      controller = await mod.initStoryScene(canvas, {
        tier,
        onProgress: (p) => setLoader(0.12 + p * 0.88),
        onCallouts: drawCallouts,
        onContextLost: () => {
          root.classList.remove('has-3d');
          initStills();
        },
        // Still below the frame-rate floor with every reduction applied: hand over to the video.
        onTooSlow: () => {
          if (!controller) return;
          controller.dispose();
          controller = null;
          drawCallouts(null);
          root.classList.remove('has-3d');
          canvas.classList.remove('is-ready');
          root.dataset.tier = 'low';
          if (!initVideoStory()) initStills();
        },
      });
      root.classList.add('has-3d');
      if (params.has('debug')) window.__story = controller;
      clearTimeout(failsafe);
      onLoaderDone = () => controller.startIntro();
      finishLoader();
      wireStory(controller);
      if (window.matchMedia('(pointer: fine)').matches) {
        window.addEventListener(
          'pointermove',
          (e) => controller.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)),
          { passive: true }
        );
      }
      return;
    } catch (err) {
      console.warn('3D scene unavailable — using the pre-rendered story instead.', err);
      tier = { name: 'low', realtime: false };
      root.dataset.tier = 'low';
    }
  }

  clearTimeout(failsafe);
  finishLoader();
  if (tier.name === 'low' && initVideoStory()) return;
  initStills();
}

/** Progress (0..6) from the story sections, shared by every tier. */
function trackStory(onProgress, onFade) {
  const stages = $$('[data-stage]');
  const end = $('[data-story-end]');
  const progress = stages.map(() => 0);
  const push = () => onProgress(progress.reduce((a, b) => a + b, 0));

  if (hasGsap) {
    stages.forEach((el, i) => {
      ScrollTrigger.create({
        trigger: el,
        start: i === 0 ? 'top top' : 'top center',
        end: 'bottom center',
        onUpdate: (self) => {
          progress[i] = self.progress;
          push();
        },
        onRefresh: (self) => {
          progress[i] = self.progress;
          push();
        },
      });
    });
    if (end) {
      ScrollTrigger.create({
        trigger: end,
        start: 'top bottom',
        end: 'top 25%',
        onUpdate: (self) => onFade(self.progress),
        onRefresh: (self) => onFade(self.progress),
      });
    }
  } else {
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const update = () => {
      const vh = window.innerHeight;
      stages.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const start = i === 0 ? 0 : vh / 2;
        progress[i] = clamp01((start - r.top) / (r.height + start - vh / 2));
      });
      push();
      if (end) onFade(clamp01((vh - end.getBoundingClientRect().top) / (vh * 0.75)));
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }
}

/**
 * Where the story text sits, as safe rectangles (NDC) for the camera:
 *   side  (landscape) — left / right of the cards, below the header
 *   stack (portrait)  — the upper part of the screen (text scrolls over the scene)
 */
function measureLayout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const header = ($('[data-header]') || { offsetHeight: 72 }).offsetHeight;
  const m = Math.max(12, Math.min(40, W * 0.025));
  const ndc = (x0, y0, x1, y1) => ({
    cx: ((x0 + x1) / 2 / W) * 2 - 1,
    cy: 1 - ((y0 + y1) / 2 / H) * 2,
    hw: Math.max(0.05, (x1 - x0) / W),
    hh: Math.max(0.05, (y1 - y0) / H),
  });
  const stages = $$('[data-stage]');
  if (stackQuery.matches) {
    // Text scrolls continuously over the scene here, so keep the part in the upper part of the screen.
    const upper = ndc(m, header + 8, W - m, Math.max(header + H * 0.3, H * 0.58));
    return { mode: 'stack', stages: stages.map(() => upper), left: upper, right: upper };
  }
  const leftCard = $('.stage:not(.stage--right):not(.stage--hero) .stage__card');
  const rightCard = $('.stage--right .stage__card');
  const hero = $('.hero');
  const lr = leftCard ? leftCard.getBoundingClientRect() : { right: W * 0.45 };
  const rr = rightCard ? rightCard.getBoundingClientRect() : { left: W * 0.55 };
  const hr = hero ? hero.getBoundingClientRect() : { right: 0 };
  // hero text can be wider than the cards: keep the subject clear of whichever is wider
  const leftEdge = Math.max(lr.right, Math.min(hr.right, W * 0.56)) + m;
  return {
    mode: 'side',
    right: ndc(Math.min(leftEdge, W * 0.6), header + 12, W - m, H - m * 1.6),
    left: ndc(m, header + 12, Math.max(rr.left - m, W * 0.4), H - m * 1.6),
    stages: [],
  };
}

function wireStory(controller) {
  const layer = $('[data-scene-layer]');
  const relayout = () => controller.setLayout(measureLayout());
  trackStory(
    (p) => controller.setProgress(p),
    (f) => {
      if (layer) layer.style.opacity = String(1 - f);
      controller.setActive(f < 0.995);
    }
  );
  relayout();
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(relayout, 140);
  });
  stackQuery.addEventListener('change', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  if (hasGsap) ScrollTrigger.refresh();
}

/* ---------- Dimension callouts (HTML/SVG overlay, engineering-drawing style) ---------- */
let calloutSvg = null;
function drawCallouts(data) {
  const layer = $('[data-scene-layer]');
  if (!layer) return;
  if (!calloutSvg) {
    calloutSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    calloutSvg.setAttribute('class', 'callouts');
    calloutSvg.setAttribute('aria-hidden', 'true');
    layer.appendChild(calloutSvg);
  }
  if (!data) {
    if (calloutSvg.style.opacity !== '0') calloutSvg.style.opacity = '0';
    return;
  }
  const W = layer.clientWidth;
  const H = layer.clientHeight;
  calloutSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  calloutSvg.style.opacity = String(data.alpha);
  const line = (a, b, cls = '') => `<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  const dot = (p) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3"/>`;
  const label = (p, text, anchor = 'middle', dy = 0) =>
    `<text x="${p[0]}" y="${p[1] + dy}" text-anchor="${anchor}">${text}</text>`;
  let s = '';
  for (const it of data.items) {
    if (it.type === 'length') {
      s += line(it.ea[0], it.ea[1], 'ext') + line(it.eb[0], it.eb[1], 'ext');
      s += line(it.a, it.b) + `<path class="arrow" d="${arrow(it.a, it.b)}"/><path class="arrow" d="${arrow(it.b, it.a)}"/>`;
      const mid = [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2];
      s += label(mid, it.label, 'middle', -8);
    } else if (it.type === 'dia') {
      s += line(it.top, it.bottom, 'ext') + dot(it.top) + dot(it.bottom);
      s += line(it.bottom, it.text, 'lead') + label(it.text, it.label, 'middle', 18);
    } else if (it.type === 'leader') {
      s += dot(it.at) + line(it.at, it.text, 'lead') + label(it.text, it.label, 'start', -6);
    }
  }
  if (data.caption) s += `<text class="caption" x="${data.caption[0]}" y="${data.caption[1]}">Example part · dimensions illustrative</text>`;
  calloutSvg.innerHTML = s;
}
function arrow(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const s = 7;
  const w = 2.6;
  const bx = from[0] + ux * s;
  const by = from[1] + uy * s;
  return `M${from[0]},${from[1]}L${bx - uy * w},${by + ux * w}L${bx + uy * w},${by - ux * w}Z`;
}

/* ---------- Low tier: scroll-scrubbed pre-rendered video ---------- */
function initVideoStory() {
  const layer = $('[data-scene-layer]');
  if (!layer || !document.createElement('video').canPlayType) return false;
  const video = document.createElement('video');
  video.className = 'scene-video';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('aria-hidden', 'true');

  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    video.remove();
    root.classList.remove('has-video');
    drawCallouts(null);
    initStills();
  };
  // Dimension callouts recorded with the video (normalised to the video frame)
  let callouts = null;
  let orientation = '';
  const pickSources = () => {
    const portrait = stackQuery.matches;
    const wide = window.innerWidth * (window.devicePixelRatio || 1) > 2100;
    const name = portrait ? 'story-portrait-1080' : wide ? 'story-landscape-2560' : 'story-landscape-1920';
    video.poster = `${RENDERS}stage-0-${portrait ? 'portrait-1080' : 'landscape-1920'}.webp`;
    video.innerHTML = `<source src="${VIDEO}${name}.webm" type='video/webm; codecs="vp9"'><source src="${VIDEO}${name}.mp4" type="video/mp4">`;
    video.lastElementChild.addEventListener('error', fail, { once: true }); // fires when every source failed
    video.load();
    const o = portrait ? 'portrait' : 'landscape';
    if (o !== orientation) {
      orientation = o;
      callouts = null;
      fetch(`${VIDEO}story-${o}.callouts.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (callouts = j))
        .catch(() => {});
    }
  };
  pickSources();
  stackQuery.addEventListener('change', pickSources);
  layer.appendChild(video);
  root.classList.add('has-video');

  // Map a point in the video frame (0..1) to screen pixels under object-fit: cover.
  const toScreen = (p) => {
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const k = Math.max(W / vw, H / vh);
    return [p[0] * vw * k + (W - vw * k) / 2, p[1] * vh * k + (H - vh * k) / 2];
  };
  const mapCallouts = (c) => ({
    alpha: c.alpha,
    caption: c.caption && toScreen(c.caption),
    items: c.items.map((it) => {
      const o = { ...it };
      for (const key of ['a', 'b', 'top', 'bottom', 'text', 'at']) if (o[key]) o[key] = toScreen(o[key]);
      if (o.ea) o.ea = o.ea.map(toScreen);
      if (o.eb) o.eb = o.eb.map(toScreen);
      return o;
    }),
  });

  let target = 0;
  let shown = -1;
  let lastFrame = -1;
  const tick = () => {
    if (failed) return;
    if (video.readyState >= 1 && video.duration) {
      const t = (target / STAGES) * (video.duration - 0.05);
      if (!video.seeking && Math.abs(t - shown) > 1 / 60) {
        video.currentTime = t;
        shown = t;
      }
      const frame = callouts ? Math.round((t / video.duration) * (callouts.frames - 1)) : -1;
      if (frame !== lastFrame) {
        lastFrame = frame;
        const c = callouts && callouts.items[frame];
        drawCallouts(c ? mapCallouts(c) : null);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  trackStory(
    (p) => (target = p),
    (f) => (layer.style.opacity = String(1 - f))
  );
  return true;
}

/* ---------- Static tier: one still per stage, cross-faded ---------- */
let stillsStarted = false;
function initStills() {
  if (stillsStarted) return;
  stillsStarted = true;
  root.classList.add('no-3d', 'has-stills');
  const layer = $('[data-scene-layer]');
  if (!layer) return;
  const wrap = document.createElement('div');
  wrap.className = 'scene-stills';
  wrap.setAttribute('aria-hidden', 'true');
  const pics = [];
  for (let i = 0; i < STAGES; i++) {
    const pic = document.createElement('picture');
    pic.className = 'scene-still';
    pic.innerHTML =
      `<source media="(max-width: 767px), (max-aspect-ratio: 1/1)" type="image/avif" srcset="${RENDERS}stage-${i}-portrait-720.avif 720w, ${RENDERS}stage-${i}-portrait-1080.avif 1080w" sizes="100vw">` +
      `<source media="(max-width: 767px), (max-aspect-ratio: 1/1)" type="image/webp" srcset="${RENDERS}stage-${i}-portrait-720.webp 720w, ${RENDERS}stage-${i}-portrait-1080.webp 1080w" sizes="100vw">` +
      `<source type="image/avif" srcset="${RENDERS}stage-${i}-landscape-1280.avif 1280w, ${RENDERS}stage-${i}-landscape-1920.avif 1920w, ${RENDERS}stage-${i}-landscape-2560.avif 2560w" sizes="100vw">` +
      `<source type="image/webp" srcset="${RENDERS}stage-${i}-landscape-1280.webp 1280w, ${RENDERS}stage-${i}-landscape-1920.webp 1920w, ${RENDERS}stage-${i}-landscape-2560.webp 2560w" sizes="100vw">` +
      `<img src="${RENDERS}stage-${i}-landscape-1920.webp" alt="" width="1920" height="1080" decoding="async" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
    wrap.appendChild(pic);
    pics.push(pic);
  }
  layer.appendChild(wrap);
  const show = (p) => {
    const k = Math.min(STAGES - 1, Math.max(0, Math.round(p - 0.35)));
    pics.forEach((pic, i) => pic.classList.toggle('is-active', i === k));
  };
  show(0);
  trackStory(show, (f) => (layer.style.opacity = String(1 - f)));
}

/* ==========================================================================
   About — the finished part, slowly turning
   ========================================================================== */
function initAboutShowcase() {
  const wrap = $('[data-showcase-wrap]');
  const canvas = $('[data-showcase]');
  if (!wrap || !canvas || reduceMotion) return;
  const io = new IntersectionObserver(
    async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        const { webglInfo } = await import('./scene/quality.js');
        if (!webglInfo()) return;
        const mod = await import('./scene/showcase.js'); // no post-processing libraries needed here
        await mod.initShowcase(canvas);
        wrap.classList.add('is-live');
      } catch (err) {
        console.warn('3D preview unavailable — showing the still render instead.', err);
      }
    },
    { rootMargin: '200px' }
  );
  io.observe(canvas);
}
