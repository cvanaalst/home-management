/**
 * icons.js — inline SVG geometry, one source (BLUEPRINT §10).
 *
 * No sprite fetch, no icon font, no library. Every glyph is drawn on a 24×24
 * grid and strokes in `currentColor`, so it themes for free and inherits the
 * colour of whatever button it sits in.
 *
 * The strings below are module constants and contain no user data, so building
 * them into innerHTML is safe by construction.
 */

const GLYPHS = {
  // ── chrome & navigation ───────────────────────────────────────────────────
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  sliders:
    '<path d="M4 7h5M15 7h5M4 12h9M19 12h1M4 17h2M12 17h8"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="17" r="2"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  filter: '<path d="M3 5h18l-7 8.2V19l-4 2v-7.8z"/>',
  sort: '<path d="M7 4.5v15M7 19.5l-3-3M7 19.5l3-3M17 19.5v-15M17 4.5l-3 3M17 4.5l3 3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',

  // ── the read-only lock ────────────────────────────────────────────────────
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock:
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-2.1"/>',

  // ── platform features ─────────────────────────────────────────────────────
  trash:
    '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  chart: '<path d="M3 21h18M6.5 21v-5M11.5 21v-10M16.5 21v-7M21 21v-13"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  help:
    '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a3 3 0 1 1 3.6 3.3c-.6.2-.8.7-.8 1.3v.6"/><path d="M12 17.6h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  download: '<path d="M12 4v11M8 11.5l4 4 4-4M4 20h16"/>',
  print:
    '<path d="M7 9V3h10v6M7 18H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v7H7z"/>',
  database:
    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sync: '<path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17.5 3v3.5H14M6.5 21v-3.5H10"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>',

  // ── record decoration ─────────────────────────────────────────────────────
  pin: '<path d="M9 3h6M12 3v6M8 9h8l1.6 5.5H6.4zM12 14.5V21"/>',
  tag: '<path d="M3.5 11.8V4.5a1 1 0 0 1 1-1h7.3l9 9-8.3 8.3z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  link:
    '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.4 1.4"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 1 0 5.7 5.7l1.4-1.4"/>',
  paperclip:
    '<path d="M19.5 11.8l-8.2 8.2a5 5 0 0 1-7-7l8.7-8.7a3.3 3.3 0 1 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.3-2.3l7.9-7.9"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  bell:
    '<path d="M12 3.5a6 6 0 0 0-6 6c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5a6 6 0 0 0-6-6z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',

  // ── the seven record types ────────────────────────────────────────────────
  // A page with a folded corner.
  "type-document":
    '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/><path d="M10 13h5M10 16.5h5"/>',
  // Sliders — settings written down, not the app's own settings.
  "type-configuration":
    '<path d="M4 7h5M14 7h6M4 12h9M18 12h2M4 17h2M11 17h9"/><circle cx="11.5" cy="7" r="2"/><circle cx="15.5" cy="12" r="2"/><circle cx="8.5" cy="17" r="2"/>',
  // A key.
  "type-account":
    '<circle cx="16" cy="8" r="3.6"/><path d="M13.4 10.6L4 20M6.8 17.2l2.1 2.1M9.6 14.4l2.1 2.1"/>',
  // A droplet and a bolt: water, gas, electricity, internet.
  "type-utilities":
    '<path d="M7 3.5c2.6 3 4 5.3 4 7a4 4 0 0 1-8 0c0-1.7 1.4-4 4-7z"/><path d="M17 3.5l-3.5 6h4L14 20.5"/>',
  // A screen on a stand.
  "type-devices":
    '<rect x="3" y="4.5" width="18" height="11.5" rx="1.8"/><path d="M9 20h6M12 16v4"/>',
  // A calendar page.
  "type-calendar":
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3"/>',
  // Three dots — the catch-all.
  "type-various":
    '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
};

/** Every glyph name — used by tests.html to prove nothing references a typo. */
export const ICON_NAMES = Object.keys(GLYPHS);

/**
 * SVG markup for one glyph.
 * @param {string} name  a key of GLYPHS
 * @param {{size?:number, className?:string}} [opts]
 */
export function icon(name, opts = {}) {
  const body = GLYPHS[name];
  if (!body) {
    console.warn(`icons.js: unknown glyph "${name}"`);
    return "";
  }
  const size = opts.size || 24;
  const cls = opts.className ? ` class="${opts.className}"` : "";
  return (
    `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.7" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    `${body}</svg>`
  );
}

/** The same glyph as a live element, for code that appends rather than builds strings. */
export function iconEl(name, opts = {}) {
  const wrap = document.createElement("span");
  wrap.className = "icon-wrap";
  wrap.innerHTML = icon(name, opts);
  return wrap.firstElementChild;
}

/** Glyph name for a record type, so callers never build the string themselves. */
export function typeIcon(type) {
  return GLYPHS[`type-${type}`] ? `type-${type}` : "type-various";
}
