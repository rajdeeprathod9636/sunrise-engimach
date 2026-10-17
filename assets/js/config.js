/**
 * Sunrise Engimach — site configuration
 * ------------------------------------------------------------------
 * This is the ONLY file you need to edit to update business details.
 * Every page reads these values when it loads (footer, contact page,
 * map, directions, WhatsApp links, spec cards and SEO schema).
 *
 * Placeholder rule: any text value written in square brackets with
 * blanks, e.g. "[___ mm]", is treated as "not filled in yet" and is
 * shown on the website as "On request" instead of the raw brackets.
 */

export const CONFIG = {
  company: {
    name: 'Sunrise Engimach',
    founder: 'Shubham Jadav',
    founderTitle: 'Founder & Owner',
    foundedYear: 2026,
    description:
      'Precision CNC turning in mild steel, alloy steel and stainless steel — job work and batch production for industrial clients, from Rajkot, Gujarat.',
  },

  contact: {
    // Click-to-call numbers, in display order. The first one is the primary number.
    phones: [
      { label: 'Mobile', display: '+91 95106 54646', tel: '+919510654646' },
      { label: 'Mobile', display: '+91 63544 90629', tel: '+916354490629' },
    ],
    // Receives quote-form enquiries, the floating button and every "WhatsApp" button.
    // International format, digits only — no "+" or spaces.
    whatsappNumber: '919510654646',
    whatsappGreeting: "Hi, I'd like to enquire about CNC turning work.",
  },

  location: {
    // Postal address as shown on the site — one entry per line.
    addressLines: [
      'Survey No. 29, Plot No. 23, Tecno Cast,',
      'Beside DK, Near Raj Cooling System,',
      'Vavdi, Rajkot, Gujarat – 360004, India',
    ],
    // The same address split up for search engines (SEO schema).
    streetAddress: 'Survey No. 29, Plot No. 23, Tecno Cast, Beside DK, Near Raj Cooling System',
    locality: 'Vavdi, Rajkot',
    city: 'Rajkot',
    region: 'Gujarat',
    postalCode: '360004',
    country: 'India',
    countryCode: 'IN',
    // Used by the map and Get Directions while lat/lng are empty.
    mapQuery: 'Tecno Cast, Vavdi, Rajkot 360004',
    // Exact pin location (Google Maps → right-click your unit → click the coordinates to copy).
    // Leave as null to use mapQuery instead; fill both in to switch the map to the exact pin.
    lat: null,
    lng: null,
    mapZoom: 16,
  },

  // Machine & capability values shown on the Services page.
  // Replace the bracketed text with real values, e.g. maxTurningDiameter: '250 mm'.
  machine: {
    machineType: '[___ CNC turning centre]',
    maxTurningDiameter: '[___ mm]',
    maxTurningLength: '[___ mm]',
    typicalTolerance: '[± ___ mm]',
    batchSize: '[___ – ___ pcs]',
  },

  // Options for the quote form dropdowns.
  services: [
    'CNC Turning',
    'Facing',
    'Threading (internal & external)',
    'Grooving',
    'Boring',
    'Drilling',
    'Taper Turning',
    'Batch / Repeat Production',
    'Job Work as per Drawing',
    'Other / Not sure',
  ],
  materials: [
    'Mild Steel (MS)',
    'EN-series Alloy Steel',
    'Stainless Steel SS 304',
    'Stainless Steel SS 316',
    'Brass (on request)',
    'Aluminium (on request)',
    'Other / Not sure',
  ],

  site: {
    // Your live website address (no trailing slash). Used for SEO schema.
    url: 'https://sunriseengimach.co.in',
  },
};

/* Shorthand exports for the map coordinates (null until filled in). */
export const LAT = CONFIG.location.lat;
export const LNG = CONFIG.location.lng;

/** True when both coordinates are real numbers. */
export const HAS_COORDS = Number.isFinite(LAT) && Number.isFinite(LNG);

/** Phone entries in display order (always an array). */
export const PHONES = (CONFIG.contact.phones || []).filter((p) => p && p.tel);

/** True when a value is still an unfilled "[___]" placeholder. */
export function isPlaceholder(value) {
  return typeof value === 'string' && /\[[^\]]*\]/.test(value) && /_{2,}/.test(value);
}

/** Returns the value, or a friendly fallback when it is empty or a placeholder. */
export function display(value, fallback = 'On request') {
  if (value === null || value === undefined || value === '' || isPlaceholder(value)) return fallback;
  return String(value);
}

/** Address lines for display. Falls back to the city line until a real address is filled in. */
export function addressLines() {
  const { addressLines: lines, city, region, country } = CONFIG.location;
  const real = (lines || []).filter((l) => l && !isPlaceholder(l));
  return real.length ? real : [`${city}, ${region}, ${country}`];
}

/** Address as one line of text (used where line breaks don't fit). */
export function addressText() {
  return addressLines()
    .map((l) => l.replace(/,\s*$/, ''))
    .join(', ');
}

// Exact pin when coordinates are filled in, otherwise a search for the address.
const place = HAS_COORDS ? `${LAT},${LNG}` : encodeURIComponent(CONFIG.location.mapQuery);

export const LINKS = {
  tel: (i = 0) => (PHONES[i] ? `tel:${PHONES[i].tel}` : ''),
  whatsapp: (text = CONFIG.contact.whatsappGreeting) =>
    `https://wa.me/${CONFIG.contact.whatsappNumber}?text=${encodeURIComponent(text)}`,
  directions: `https://www.google.com/maps/dir/?api=1&destination=${place}`,
  mapView: `https://www.google.com/maps?q=${place}`,
  mapEmbed: `https://www.google.com/maps?q=${place}&z=${CONFIG.location.mapZoom}&output=embed`,
};
