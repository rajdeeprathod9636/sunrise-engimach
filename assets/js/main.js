/**
 * Sunrise Engimach — shared UI
 * Config binding, SEO schema, navigation, smooth scroll, reveals,
 * page transitions, and (on the home page) the 3D scroll story.
 */
import { CONFIG, LINKS, LAT, LNG, display, isPlaceholder, addressText } from './config.js';

const root = document.documentElement;
const page = document.body.dataset.page || '';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobileUA =
  /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const hasGsap = Boolean(gsap && ScrollTrigger);

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

if (hasGsap && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => ScrollTrigger.refresh());
}

/* ==========================================================================
   Config → page
   ========================================================================== */
function applyConfig() {
  const { company, contact, location, machine } = CONFIG;
  const text = {
    name: company.name,
    founder: company.founder,
    founderTitle: company.founderTitle,
    founded: String(company.foundedYear),
    phone: contact.phoneDisplay,
    address: addressText(),
    city: `${location.city}, ${location.region}, ${location.country}`,
    year: String(new Date().getFullYear()),
  };
  $$('[data-cfg]').forEach((el) => {
    const v = text[el.dataset.cfg];
    if (v !== undefined) el.textContent = v;
  });

  const hrefs = {
    tel: LINKS.tel,
    whatsapp: LINKS.whatsapp(),
    directions: LINKS.directions,
    map: LINKS.mapView,
  };
  $$('[data-href]').forEach((el) => {
    const v = hrefs[el.dataset.href];
    if (v) el.setAttribute('href', v);
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
  const { company, contact, location, site } = CONFIG;
  const address = {
    '@type': 'PostalAddress',
    addressLocality: location.city,
    addressRegion: location.region,
    addressCountry: location.countryCode,
  };
  if (!isPlaceholder(location.address)) address.streetAddress = location.address;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${site.url}/#business`,
    name: company.name,
    description: company.description,
    url: `${site.url}/`,
    logo: `${site.url}/assets/img/logo.svg`,
    image: `${site.url}/assets/img/og-image.png`,
    telephone: contact.phoneTel,
    foundingDate: String(company.foundedYear),
    founder: { '@type': 'Person', name: company.founder },
    address,
    geo: { '@type': 'GeoCoordinates', latitude: LAT, longitude: LNG },
    hasMap: LINKS.mapView,
    areaServed: { '@type': 'Country', name: 'India' },
    knowsAbout: CONFIG.services.filter((s) => !/other/i.test(s)),
  };
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
  if (reduceMotion || typeof window.Lenis === 'undefined') return null;
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

  const heroItems = $$('[data-hero-item]');
  const heroTitle = $('[data-hero-title]');
  if (heroTitle) gsap.from(heroTitle, { y: 28, duration: 1.1, ease: 'power3.out', delay: 0.15 });
  if (heroItems.length) {
    gsap.from(heroItems, { autoAlpha: 0, y: 18, duration: 0.9, ease: 'power3.out', stagger: 0.1, delay: 0.3 });
  }

  $$('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      autoAlpha: 0,
      y: 28,
      duration: 0.9,
      ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });
  $$('[data-reveal-group]').forEach((group) => {
    gsap.from(group.children, {
      autoAlpha: 0,
      y: 24,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.08,
      scrollTrigger: { trigger: group, start: 'top 86%', once: true },
    });
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
   WebGL helpers
   ========================================================================== */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

/* ==========================================================================
   Home — loader + 3D scroll story
   ========================================================================== */
async function initHome() {
  const loader = $('[data-loader]');
  const fill = $('[data-loader-fill]');
  const canvas = $('#scene');
  const setLoader = (p) => fill && fill.style.setProperty('--p', String(Math.max(0.06, Math.min(1, p))));
  let loaderDone = false;
  const finishLoader = () => {
    if (loaderDone) return;
    loaderDone = true;
    setLoader(1);
    if (loader) setTimeout(() => loader.classList.add('is-done'), 180);
  };
  // Never block content for more than ~2 s after navigation, however slow the 3D setup is.
  const failsafe = setTimeout(finishLoader, Math.max(0, 1900 - performance.now()));

  if (reduceMotion || !canvas || !webglAvailable()) {
    root.classList.add('no-3d');
    clearTimeout(failsafe);
    finishLoader();
    return;
  }

  setLoader(0.15);
  let controller = null;
  try {
    const mod = await import('./scene.js');
    setLoader(0.35);
    controller = await mod.initStoryScene(canvas, { onProgress: (p) => setLoader(0.35 + p * 0.65) });
    root.classList.add('has-3d');
  } catch (err) {
    root.classList.add('no-3d');
    console.warn('3D scene unavailable — showing the static illustration instead.', err);
  }
  clearTimeout(failsafe);
  finishLoader();
  if (controller) wireStory(controller);
}

function wireStory(controller) {
  const stages = $$('[data-stage]');
  const end = $('[data-story-end]');
  const layer = $('[data-scene-layer]');
  const progress = stages.map(() => 0);
  const push = () => controller.setProgress(progress.reduce((a, b) => a + b, 0));
  const setFade = (f) => {
    if (layer) layer.style.opacity = String(1 - f);
    controller.setActive(f < 0.995);
  };

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
        onUpdate: (self) => setFade(self.progress),
        onRefresh: (self) => setFade(self.progress),
      });
    }
    ScrollTrigger.refresh();
    return;
  }

  // Fallback without GSAP: same maths from getBoundingClientRect
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const update = () => {
    const vh = window.innerHeight;
    stages.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const start = i === 0 ? 0 : vh / 2;
      progress[i] = clamp01((start - r.top) / (r.height + start - vh / 2));
    });
    push();
    if (end) setFade(clamp01((vh - end.getBoundingClientRect().top) / (vh * 0.75)));
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ==========================================================================
   About — small rotating part
   ========================================================================== */
function initAboutShowcase() {
  const wrap = $('[data-showcase-wrap]');
  const canvas = $('[data-showcase]');
  if (!wrap || !canvas || reduceMotion || !webglAvailable()) return;
  const io = new IntersectionObserver(
    async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        const mod = await import('./scene.js');
        await mod.initShowcase(canvas);
        wrap.classList.add('is-live');
      } catch (err) {
        console.warn('3D preview unavailable — showing the illustration instead.', err);
      }
    },
    { rootMargin: '200px' }
  );
  io.observe(canvas);
}
