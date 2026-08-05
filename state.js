/**
 * state.js — the tiny shared mutable state object (BLUEPRINT §4).
 *
 * This is deliberately NOT a store, an observable, or a state machine. It is one
 * plain object that every module may read and that only a handful of setters
 * write. Anything that must survive a reload is mirrored into localStorage.
 *
 * ── Why localStorage and not the meta store? ────────────────────────────────
 * §5 puts settings in the IndexedDB `meta` store, and from Phase 1 that store is
 * the source of truth (it is what sync and export see). But IndexedDB reads are
 * async, and the theme has to be on <html> before the first paint or the user
 * gets a flash of the wrong theme. So the four boot-critical preferences —
 * theme, language, density, lock — are ALSO mirrored here synchronously.
 *
 * Rule: localStorage is a read-through cache for boot. meta is the truth.
 * app.js reconciles the two once the database is open, and installs a sink via
 * `setPreferenceSink()` so every later change is written to meta as well. This
 * module still imports nothing — it must not depend on storage.
 */

const LS_PREFIX = "hms.";

/**
 * Called with (key, value) whenever a preference changes, so app.js can mirror
 * it into the meta store. A no-op until the database is open.
 */
let preferenceSink = () => {};

export function setPreferenceSink(fn) {
  preferenceSink = typeof fn === "function" ? fn : () => {};
}

export const THEMES = ["dark", "light", "midnight", "paper"];
export const DENSITIES = ["comfortable", "compact"];
export const LANGS = ["nl", "en"];

/** Read a mirrored preference, falling back when absent or corrupt. */
function readPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback; // private mode / storage disabled — run on defaults
  }
}

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, String(value));
  } catch {
    /* storage full or disabled — the in-memory value still applies this session */
  }
}

export const state = {
  // ── preferences (mirrored) ────────────────────────────────────────────────
  lang: readPref("lang", LANGS, "nl"),
  theme: readPref("theme", THEMES, "dark"),
  density: readPref("density", DENSITIES, "comfortable"),
  /** Read-only lock. Defaults to locked so codes and contract numbers cannot be
   *  edited by a stray tap. Carried over from the legacy app deliberately. */
  locked: readFlag("locked", true),

  // ── list query (not persisted; a fresh session starts unfiltered) ─────────
  filters: {
    search: "",
    type: "", // "" = all types
    tags: [],
    sortBy: "updatedAt",
    sortDir: "desc",
    dateFrom: "",
    dateTo: "",
  },

  // ── transient view state ──────────────────────────────────────────────────
  currentView: "list",
  currentId: null, // id of the record open in the detail view
  /** Scroll offset per base tab, restored AFTER data renders (§9, lesson 9). */
  scroll: { list: 0, settings: 0 },
};

/**
 * Apply a preference: in memory, to the boot mirror, to the DOM, and to the
 * sink. `persist: false` is used while hydrating FROM meta, so reading a value
 * back does not immediately write it out again.
 */
function applyPref(key, value, toDom, persist = true) {
  state[key] = value;
  writePref(key, value);
  toDom(value);
  if (persist) preferenceSink(key, value);
}

export function setLang(lang, persist = true) {
  if (!LANGS.includes(lang)) return;
  applyPref("lang", lang, (v) => (document.documentElement.lang = v), persist);
}

export function setTheme(theme, persist = true) {
  if (!THEMES.includes(theme)) return;
  applyPref("theme", theme, (v) => (document.documentElement.dataset.theme = v), persist);
}

export function setDensity(density, persist = true) {
  if (!DENSITIES.includes(density)) return;
  applyPref("density", density, (v) => (document.body.dataset.density = v), persist);
}

export function setLocked(locked, persist = true) {
  applyPref(
    "locked",
    !!locked,
    (v) => document.body.classList.toggle("is-locked", v),
    persist
  );
}

/** The preferences mirrored into meta, in one place so both sides agree. */
export const PREFERENCE_KEYS = ["lang", "theme", "density", "locked"];

/** Apply a value read back from meta, without echoing it straight back. */
export function applyStoredPreference(key, value) {
  if (value === undefined || value === null) return false;
  const setter = { lang: setLang, theme: setTheme, density: setDensity, locked: setLocked }[key];
  if (!setter) return false;
  setter(value, false);
  return true;
}

/** Reset the list query to its defaults. Returns true if anything changed. */
export function clearFilters() {
  const f = state.filters;
  const dirty =
    f.search || f.type || f.tags.length || f.dateFrom || f.dateTo;
  f.search = "";
  f.type = "";
  f.tags = [];
  f.dateFrom = "";
  f.dateTo = "";
  return !!dirty;
}

/**
 * Apply every persisted preference to the DOM. Called once at boot, before the
 * first render, so nothing flashes.
 */
export function applyPreferences() {
  document.documentElement.lang = state.lang;
  document.documentElement.dataset.theme = state.theme;
  document.body.dataset.density = state.density;
  document.body.classList.toggle("is-locked", state.locked);
}
