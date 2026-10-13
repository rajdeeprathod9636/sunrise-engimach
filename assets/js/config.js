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
    phoneDisplay: '+91 79906 36261', // shown on the site
    phoneTel: '+917990636261', // used for click-to-call
    whatsappNumber: '917990636261', // international format, no "+" or spaces
    whatsappGreeting: "Hi, I'd like to enquire about CNC turning work.",
  },

  location: {
    // Full postal address — edit this one line.
    address: '[Plot No. ___, ___ Industrial Area, Rajkot, Gujarat – 360___]',
    city: 'Rajkot',
    region: 'Gujarat',
    country: 'India',
    countryCode: 'IN',
    // Exact pin location (Google Maps → right-click your unit → click the coordinates to copy).
    lat: 22.3039,
    lng: 70.8022,
    mapZoom: 15,
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

/* Shorthand exports for the map coordinates. */
export const LAT = CONFIG.location.lat;
export const LNG = CONFIG.location.lng;

/** True when a value is still an unfilled "[___]" placeholder. */
export function isPlaceholder(value) {
  return typeof value === 'string' && /\[[^\]]*\]/.test(value) && /_{2,}/.test(value);
}

/** Returns the value, or a friendly fallback when it is empty or a placeholder. */
export function display(value, fallback = 'On request') {
  if (value === null || value === undefined || value === '' || isPlaceholder(value)) return fallback;
  return String(value);
}

/** Address text for display. Falls back to the city line until the real address is filled in. */
export function addressText() {
  const { address, city, region, country } = CONFIG.location;
  return isPlaceholder(address) || !address ? `${city}, ${region}, ${country}` : address;
}

const coords = `${LAT},${LNG}`;

export const LINKS = {
  tel: `tel:${CONFIG.contact.phoneTel}`,
  whatsapp: (text = CONFIG.contact.whatsappGreeting) =>
    `https://wa.me/${CONFIG.contact.whatsappNumber}?text=${encodeURIComponent(text)}`,
  directions: `https://www.google.com/maps/dir/?api=1&destination=${coords}`,
  mapView: `https://www.google.com/maps?q=${coords}`,
  mapEmbed: `https://www.google.com/maps?q=${coords}&z=${CONFIG.location.mapZoom}&output=embed`,
};
