/**
 * Sunrise Engimach — quote form
 * Validates the enquiry, formats it, and hands it to WhatsApp.
 */
import { CONFIG, LINKS } from './config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isMobile =
  /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const form = document.querySelector('[data-quote-form]');
if (form) initForm(form);

/** Accepts 98765 43210, +91 98765 43210, 91-9876543210, 09876543210. Returns the 10 digits or null. */
function normalizePhone(value) {
  let d = value.replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

function populate(select, options) {
  if (!select) return;
  options.forEach((label) => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

function initForm(form) {
  const f = form.elements;
  const fields = {
    name: f.namedItem('name'),
    company: f.namedItem('company'),
    phone: f.namedItem('phone'),
    email: f.namedItem('email'),
    service: f.namedItem('service'),
    material: f.namedItem('material'),
    quantity: f.namedItem('quantity'),
    message: f.namedItem('message'),
  };
  const submit = form.querySelector('[data-submit]');
  const hint = form.querySelector('[data-form-hint]');
  const success = document.querySelector('[data-form-success]');
  const againLink = document.querySelector('[data-wa-again]');
  const resetBtn = document.querySelector('[data-form-reset]');

  populate(fields.service, CONFIG.services);
  populate(fields.material, CONFIG.materials);

  const validators = {
    name: (v) => {
      const t = v.trim();
      if (!t) return 'Please enter your name.';
      return t.length < 2 ? 'Please enter your full name.' : '';
    },
    phone: (v) => {
      if (!v.trim()) return 'Please enter your phone number so we can reach you.';
      return normalizePhone(v) ? '' : 'Enter a valid 10-digit Indian mobile number, e.g. 98765 43210.';
    },
    email: (v) => (!v.trim() || EMAIL_RE.test(v.trim()) ? '' : 'This email address doesn’t look right — please check it.'),
    message: (v) => {
      const t = v.trim();
      if (!t) return 'Please tell us a little about the part you need.';
      return t.length < 10 ? 'Please add a little more detail (at least 10 characters).' : '';
    },
  };
  const touched = new Set();

  function render(name, error) {
    const input = fields[name];
    const field = input.closest('.field');
    const msg = document.getElementById(`${name}-error`);
    input.setAttribute('aria-invalid', error ? 'true' : 'false');
    if (msg) msg.textContent = error;
    field.classList.toggle('has-error', Boolean(error));
    field.classList.toggle('is-valid', !error && input.value.trim() !== '');
  }

  function refresh() {
    let ok = true;
    for (const name of Object.keys(validators)) {
      const error = validators[name](fields[name].value);
      if (error) ok = false;
      if (touched.has(name)) render(name, error);
    }
    submit.disabled = !ok;
    if (hint) hint.hidden = ok;
    return ok;
  }

  for (const name of Object.keys(validators)) {
    const input = fields[name];
    input.addEventListener('blur', () => {
      if (input.value.trim() || name !== 'email') touched.add(name);
      refresh();
    });
    input.addEventListener('input', refresh);
  }

  function value(input, fallback = 'Not specified') {
    const v = input && input.value.trim();
    return v ? v : fallback;
  }

  function buildMessage() {
    const digits = normalizePhone(fields.phone.value);
    const phone = digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : fields.phone.value.trim();
    return [
      `*New Enquiry – ${CONFIG.company.name} Website*`,
      `Name: ${value(fields.name)}`,
      `Company: ${value(fields.company)}`,
      `Phone: ${phone}`,
      `Email: ${value(fields.email)}`,
      `Service: ${value(fields.service)}`,
      `Material: ${value(fields.material)}`,
      `Quantity: ${value(fields.quantity)}`,
      `Message: ${fields.message.value.trim()}`,
    ].join('\n');
  }

  function openWhatsApp(url) {
    if (isMobile) {
      // Same-tab navigation lets the phone open the WhatsApp app directly.
      window.location.href = url;
      return;
    }
    const win = window.open(url, '_blank');
    if (win) {
      try {
        win.opener = null;
      } catch {
        /* cross-origin — ignore */
      }
    } else {
      window.location.href = url; // pop-up blocked
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.keys(validators).forEach((n) => touched.add(n));
    if (!refresh()) {
      const firstBad = Object.keys(validators).find((n) => validators[n](fields[n].value));
      if (firstBad) fields[firstBad].focus();
      return;
    }
    const url = LINKS.whatsapp(buildMessage());
    if (againLink) againLink.href = url;
    form.hidden = true;
    if (success) {
      success.hidden = false;
      success.focus({ preventScroll: true });
    }
    openWhatsApp(url);
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      form.reset();
      touched.clear();
      Object.keys(validators).forEach((n) => {
        render(n, '');
        fields[n].closest('.field').classList.remove('is-valid');
      });
      refresh();
      success.hidden = true;
      form.hidden = false;
      fields.name.focus();
    });
  }

  refresh();
}
