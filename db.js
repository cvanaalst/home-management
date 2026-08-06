/**
 * db.js — IndexedDB wrapper + pure data helpers (BLUEPRINT §5, §6).
 *
 * ── Shape of this module ───────────────────────────────────────────────────
 * The top two thirds are PURE: text normalisation, the query engine, the
 * analytics helpers. They take arrays and return arrays, touch no DOM and no
 * storage, and are fully unit-tested in tests.html.
 *
 * The bottom third is the IndexedDB layer, which is a thin async shell around
 * those pure functions. That split is deliberate — `queryItems()` is just
 * `queryItemSet(await getAllItems(), opts)`, so the part that is easy to get
 * wrong is the part that is easy to test.
 *
 * Four stores (§5):
 *   items     key `id`   records AND events — see the note on `kind` below
 *   media     key `id`   { id, blob, thumbnailBlob } — binary kept out of records
 *   meta      key `key`  settings, lastSyncAt, sync log
 *   versions  key `key`  per-record revision history, local only, never synced
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. The record contract
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The type discriminator. Drives the icon, the filter chips, report grouping
 * and the insights breakdown. Every record has exactly one.
 *
 * Deliberately flat: all seven types share ONE form. The type is metadata, not
 * a different schema — that keeps the platform layer field-agnostic (§5).
 */
export const TYPES = [
  "document",
  "configuration",
  "account",
  "utilities",
  "devices",
  "calendar",
  "various",
];

export const DEFAULT_TYPE = "various";

/**
 * Types used by an earlier version of this app, mapped to their replacements.
 *
 * Applied at READ time by hydrateRecord(), never by rewriting the store on
 * upgrade (§6). Without this every existing record would fall through the
 * `TYPES.includes(...)` guard to DEFAULT_TYPE and lose its categorisation — and
 * because sync writes back through the same hydration path, that loss would be
 * persisted on the next sync and could not be undone.
 *
 * Safe to delete once no device can still be holding pre-build-17 records; it
 * costs one map lookup per read until then.
 */
const LEGACY_TYPES = {
  note: "various",
  contact: "various",
  warranty: "devices",
  insurance: "utilities",
  maintenance: "calendar",
  // "document" and "account" kept their names and need no entry.
};

/** Resolve any stored type to a current one. PURE. */
export function normalizeType(type) {
  if (TYPES.includes(type)) return type;
  return LEGACY_TYPES[type] || DEFAULT_TYPE;
}

/**
 * ── The second axis: what a row IS, as opposed to what it is ABOUT ──────────
 *
 * A "record" documents something that exists — the router, the insurance
 * policy, the boiler. An "event" records something that HAPPENED to one of
 * them: the filter was changed, the yearly premium was paid, the power failed.
 *
 * Both live in the same store and share the whole envelope, so events inherit
 * sync, merge, tombstones, trash, search, tags, links and attachments without
 * a second implementation of any of it. `kind` is what keeps them apart, and
 * it is deliberately NOT an eighth `type`: an event about the router is still
 * `type: "devices"`, so it keeps that colour, icon and filter chip.
 *
 * Anything stored before this existed has no `kind` at all and normalises to
 * "record", which is exactly right.
 */
export const KINDS = ["record", "event"];
export const DEFAULT_KIND = "record";

/** Resolve any stored kind to a current one. PURE. */
export function normalizeKind(kind) {
  return KINDS.includes(kind) ? kind : DEFAULT_KIND;
}

/**
 * What sort of thing happened. Drives the timeline's icons and filter chips,
 * which is why this is a fixed set and `reminderType` is free text — a chip row
 * cannot be built from values nobody has typed yet.
 */
export const EVENT_TYPES = [
  "maintenance", // serviced, cleaned, replaced a part
  "payment", // premium, invoice, call-out charge
  "incident", // failure, outage, leak, damage
  "change", // added, moved, reconfigured
  "reading", // meter reading, measurement
  "other",
];

export const DEFAULT_EVENT_TYPE = "other";

/**
 * Resolve an event type. PURE.
 *
 * Records always resolve to "" — an event type on something that never happened
 * is meaningless, and letting one linger would put ghost entries in the
 * timeline's chip counts.
 */
export function normalizeEventType(value, kind = DEFAULT_KIND) {
  if (normalizeKind(kind) !== "event") return "";
  return EVENT_TYPES.includes(value) ? value : DEFAULT_EVENT_TYPE;
}

/** How a reminder repeats. See nextOccurrence() for the arithmetic. */
export const RECURRENCE_UNITS = ["day", "week", "month", "quarter", "year"];

/**
 * Resolve a stored recurrence to `{ every, interval }` or null. PURE.
 *
 * Anything malformed becomes null rather than a half-built rule: a recurrence
 * that cannot be computed must read as "does not repeat", never as "repeats on
 * a schedule nobody can predict".
 */
export function normalizeRecurrence(value) {
  if (!value || typeof value !== "object") return null;
  if (!RECURRENCE_UNITS.includes(value.every)) return null;
  const interval = Math.trunc(Number(value.interval));
  return { every: value.every, interval: Number.isFinite(interval) && interval > 0 ? interval : 1 };
}

/** Days in a given month. `month` is 1–12. PURE. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Split "YYYY-MM-DD" into numbers, or null if it is not one. PURE. */
function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").slice(0, 10));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

const pad2 = (n) => String(n).padStart(2, "0");

/** How many months one step of a rule covers, or 0 for day/week rules. */
const MONTHS_PER_STEP = { month: 1, quarter: 3, year: 12 };

/**
 * Advance an anchor date by `steps` whole steps of a rule. PURE.
 *
 * ── Why this always counts from the ANCHOR ─────────────────────────────────
 * Month arithmetic has to clamp: 31 January plus one month is 28 February,
 * there being no 31st. The trap is doing it iteratively, because clamping is
 * lossy — 31 Jan → 28 Feb → 28 Mar → 28 Apr, and a boiler serviced on the 31st
 * has silently migrated to the 28th forever.
 *
 * Counting whole steps from the original anchor every time keeps the intent:
 * 31 Jan +1 → 28 Feb, +2 → 31 Mar, +3 → 30 Apr. The day only ever bends for
 * the month that cannot hold it, then springs back.
 */
export function addSteps(anchor, rule, steps) {
  const months = MONTHS_PER_STEP[rule.every];
  if (months) {
    const total = (anchor.y * 12 + anchor.m - 1) + months * rule.interval * steps;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
  }
  const perStep = rule.every === "week" ? 7 : 1;
  const ms = Date.UTC(anchor.y, anchor.m - 1, anchor.d) +
    perStep * rule.interval * steps * 86400000;
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** A {y,m,d} back to "YYYY-MM-DD". PURE. */
function formatDay(parts) {
  return `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}`;
}

/**
 * The first occurrence of a recurring reminder STRICTLY AFTER `fromIso`. PURE.
 *
 * Returns null when there is no rule or the anchor is unusable, which reads as
 * "does not repeat" everywhere it is used.
 *
 * Strictly after, not on-or-after, because this answers "it is done, when is
 * the next one?" — and today's, having just been done, is not it.
 *
 * A reminder years overdue rolls forward to the next FUTURE occurrence rather
 * than to today plus one interval: an annual service missed for three years is
 * still due on its own anniversary, not on the day someone finally noticed.
 */
export function nextOccurrence(dateIso, recurrence, fromIso) {
  const rule = normalizeRecurrence(recurrence);
  const anchor = parseDay(dateIso);
  const from = parseDay(fromIso);
  if (!rule || !anchor || !from) return null;

  const fromKey = formatDay(from);

  // Seed close to the answer instead of walking there. A daily reminder left
  // untouched for a decade is 3,650 steps away, and a loop from one would
  // spend them all.
  const months = MONTHS_PER_STEP[rule.every];
  let steps;
  if (months) {
    const gap = (from.y * 12 + from.m) - (anchor.y * 12 + anchor.m);
    steps = Math.floor(gap / (months * rule.interval));
  } else {
    const perStep = rule.every === "week" ? 7 : 1;
    const gapDays =
      (Date.UTC(from.y, from.m - 1, from.d) - Date.UTC(anchor.y, anchor.m - 1, anchor.d)) / 86400000;
    steps = Math.floor(gapDays / (perStep * rule.interval));
  }
  if (!Number.isFinite(steps) || steps < 0) steps = 0;

  // The seed is an estimate — clamping can put it a step either side — so walk
  // the last stretch. Bounded so a malformed anchor can never spin forever.
  for (let guard = 0; guard < 64; guard++) {
    if (formatDay(addSteps(anchor, rule, steps)) > fromKey) {
      if (steps === 0 || formatDay(addSteps(anchor, rule, steps - 1)) <= fromKey) {
        return formatDay(addSteps(anchor, rule, steps));
      }
      steps--;
    } else {
      steps++;
    }
  }
  return null;
}

/**
 * Everything that changes when a recurring reminder is marked done. PURE.
 *
 * Returns `{ reminderAt, recurred }` — the new date, or null when the rule has
 * run out or there never was one. Kept separate from the record write so the
 * decision is testable without a database.
 */
export function completeReminder(record, todayIso) {
  if (!record || !record.reminderAt) return { reminderAt: null, recurred: false };

  // Advance from whichever is LATER, the scheduled date or today.
  //
  // Measuring only from today breaks doing a job early: a service due on the
  // 31st, done on the 6th, would advance to "the next occurrence after the
  // 6th" — which is still the 31st, so the button appears to do nothing.
  // Measuring only from the scheduled date breaks the overdue case, handing
  // back a date that has already passed.
  const scheduled = String(record.reminderAt).slice(0, 10);
  const today = String(todayIso || "").slice(0, 10);
  const from = scheduled > today ? scheduled : today;

  const next = nextOccurrence(record.reminderAt, record.recurrence, from);
  return next ? { reminderAt: next, recurred: true } : { reminderAt: null, recurred: false };
}

/** Resolve a stored amount to a finite number or null. PURE. */
export function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const SORT_FIELDS = ["updatedAt", "createdAt", "title", "reminderAt", "occurredAt"];

/**
 * Date fields that are legitimately absent on most rows, and must therefore
 * sort to the END in BOTH directions. Ascending on `occurredAt` would otherwise
 * open with every record that never happened, which is not what the sort means.
 */
const SPARSE_DATE_FIELDS = new Set(["reminderAt", "occurredAt"]);

/**
 * ── The record contract (§5) ────────────────────────────────────────────────
 *
 * {
 *   id:           "uuid",        // crypto.randomUUID(); never reused
 *   type:         "note",        // one of TYPES
 *
 *   // envelope — required by the platform layer
 *   createdAt:    "ISO-8601",
 *   updatedAt:    "ISO-8601",    // bump on EVERY write; drives last-write-wins
 *   deletedAt:    null,          // ISO string = tombstone. Never hard-delete.
 *   restoredAt:   null,          // set when a tombstone was restored under a new id
 *   purgedAt:     null,          // set when content was permanently wiped
 *
 *   // common
 *   title:        "",
 *   comment:      "",
 *   tags:         [],
 *   pinned:       false,
 *   reminderAt:   null,          // "YYYY-MM-DD" or null
 *   linkedIds:    [],            // ids of related records
 *
 *   // ── domain fields for this app ──────────────────────────────────────
 *   body:         "",            // Markdown, rendered by markdown.js
 *   reminderType: "",            // at most ONE per record. Free text, suggested
 *                                //  from values already used. Only meaningful
 *                                //  when reminderAt is set.
 *   recurrence:   null,          // { every: "year", interval: 1 } or null
 *   links:        [],            // [{ id, label, url }]        — N per record
 *   attachments:  [],            // [{ mediaId, filename, mimeType, size }]
 *
 *   // ── the event axis ──────────────────────────────────────────────────
 *   kind:         "record",      // "record" | "event"
 *   occurredAt:   null,          // "YYYY-MM-DD" — when it HAPPENED. Events only.
 *   eventType:    "",            // one of EVENT_TYPES. Events only.
 *   amount:       null,          // optional number, e.g. what a call-out cost
 * }
 *
 * An event points AT its subject through `linkedIds`; the subject is never
 * touched. That matters for merging: logging fifty events against the boiler
 * leaves the boiler's own `updatedAt` alone, so none of them can lose a race
 * with an edit made on another device.
 *
 * ── Deviations from the blueprint envelope, and why ─────────────────────────
 * §5 gives a single `mediaId`/`filename`/`mimeType` triplet. The legacy app
 * attaches N files and N URLs to one note, so that is modelled as `attachments`
 * and `links` arrays instead. `mediaId` still keys the media store exactly as
 * §5 specifies — there is simply more than one of them, and the `<id>__`
 * filename prefix rule in §7 keys off the mediaId, so media reconciliation is
 * unaffected.
 *
 * The legacy `colour` category is dropped: `type` now carries that meaning and
 * two overlapping taxonomies is one too many. The legacy `archived` flag is
 * dropped too — nothing used it, and pinned + trash cover the ground.
 */

/** Fresh uuid. crypto.randomUUID needs a secure context (https or localhost). */
export function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for a plain-http origin on the local network.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Build a complete record. PURE apart from makeId()/Date, and every field of
 * the envelope is filled — a partially-filled record is what breaks merges.
 */
export function makeRecord(fields = {}) {
  const now = new Date().toISOString();
  return {
    id: fields.id || makeId(),
    type: normalizeType(fields.type),

    createdAt: fields.createdAt || now,
    updatedAt: fields.updatedAt || now,
    deletedAt: fields.deletedAt ?? null,
    restoredAt: fields.restoredAt ?? null,
    purgedAt: fields.purgedAt ?? null,

    title: fields.title || "",
    comment: fields.comment || "",
    tags: Array.isArray(fields.tags) ? [...fields.tags] : [],
    pinned: !!fields.pinned,
    reminderAt: fields.reminderAt || null,
    linkedIds: Array.isArray(fields.linkedIds) ? [...fields.linkedIds] : [],

    body: fields.body || "",
    reminderType: fields.reminderType || "",
    recurrence: normalizeRecurrence(fields.recurrence),
    links: Array.isArray(fields.links) ? [...fields.links] : [],
    attachments: Array.isArray(fields.attachments) ? [...fields.attachments] : [],

    kind: normalizeKind(fields.kind),
    occurredAt: fields.occurredAt || null,
    eventType: normalizeEventType(fields.eventType, fields.kind),
    amount: normalizeAmount(fields.amount),
  };
}

/**
 * Fill in anything a record is missing. Applied at READ time, never by
 * rewriting the store — §6 is explicit that an upgrade must not touch existing
 * records, so an older or imported record is normalised on the way out instead.
 */
export function hydrateRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  return { ...makeRecord(raw), ...stripUndefined(raw), ...coerce(raw) };
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/** Fields whose type must be right or the query engine throws. */
function coerce(raw) {
  return {
    type: normalizeType(raw.type),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    linkedIds: Array.isArray(raw.linkedIds) ? raw.linkedIds : [],
    links: Array.isArray(raw.links) ? raw.links : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    pinned: !!raw.pinned,
    deletedAt: raw.deletedAt ?? null,
    restoredAt: raw.restoredAt ?? null,
    purgedAt: raw.purgedAt ?? null,
    reminderAt: raw.reminderAt || null,
    recurrence: normalizeRecurrence(raw.recurrence),

    kind: normalizeKind(raw.kind),
    occurredAt: raw.occurredAt || null,
    eventType: normalizeEventType(raw.eventType, raw.kind),
    amount: normalizeAmount(raw.amount),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PURE — text normalisation and search
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fold a string down to a comparable form: diacritics removed, lower-cased,
 * punctuation flattened to single spaces.
 *
 * Punctuation becomes whitespace rather than being deleted so that a code like
 * "AB-123" and a query "ab 123" agree, and an IP "192.168.1.1" stays four
 * tokens instead of collapsing into one number. Both sides of every comparison
 * go through this function, so the transformation only has to be consistent.
 */
export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining diacritical marks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * One normalised haystack per record: everything a user might reasonably
 * search for, in one string. Built once per query, not per term.
 */
export function buildHaystack(item) {
  if (!item) return "";
  const parts = [
    item.title,
    item.body,
    item.comment,
    item.reminderType,
    (item.tags || []).join(" "),
    (item.links || []).map((l) => `${l.label || ""} ${l.url || ""}`).join(" "),
    (item.attachments || []).map((a) => a.filename || "").join(" "),
  ];
  return normalizeSearchText(parts.join(" "));
}

/**
 * Query parameters that only ever identify the visitor, never the content.
 *
 * Note what is NOT here: a bare `ref`. It is load-bearing on plenty of sites
 * (one of the legacy links is a product URL whose `ref` selects the variant),
 * and silently breaking a saved link is far worse than keeping a tracking
 * parameter. `ref_src`/`ref_url` are Twitter-specific and safe to drop.
 */
const TRACKING_PREFIXES = ["utm_", "ga_", "mc_", "pk_", "piwik_", "matomo_", "hsa_", "vero_"];
const TRACKING_EXACT = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "twclid",
  "igshid", "mkt_tok", "_hsenc", "_hsmi", "ref_src", "ref_url", "yclid",
  "s_kwcid", "icid", "cmpid", "trk", "trkcampaign",
]);

function isTrackingParam(name) {
  const key = name.toLowerCase();
  if (TRACKING_EXACT.has(key)) return true;
  return TRACKING_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Remove tracking parameters from a URL string. PURE.
 * Anything that does not parse as a URL is returned untouched — a saved value
 * the user typed is never worth mangling.
 */
export function stripTrackingParams(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  const keep = [...parsed.searchParams.entries()].filter(([k]) => !isTrackingParam(k));
  parsed.search = "";
  for (const [k, v] of keep) parsed.searchParams.append(k, v);
  return tidy(parsed);
}

/**
 * Canonicalise a URL for storage and comparison. PURE.
 * Adds a missing https:// scheme, lower-cases scheme and host, drops the
 * default port, strips tracking parameters, and removes an empty query or
 * fragment. The path keeps its case — plenty of servers care.
 */
export function normalizeUrl(url) {
  let raw = String(url ?? "").trim();
  if (!raw) return "";

  // A bare "example.com/x" is a URL to a person; give it a scheme.
  //
  // The scheme must be at least TWO characters. A one-letter "scheme" is a
  // Windows drive letter — "C:/Users/chris/doc.pdf" would otherwise parse as a
  // URL with protocol "c:" and come back lower-cased, silently corrupting a
  // saved path. (One of the legacy links is exactly such a path.)
  if (!/^[a-z][a-z0-9+.-]+:/i.test(raw)) {
    if (/^[^\s/]+\.[^\s/]{2,}/.test(raw)) raw = `https://${raw}`;
    else return raw; // not a URL at all — hand it back unchanged
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (parsed.protocol === "http:" && parsed.port === "80") parsed.port = "";
  if (parsed.protocol === "https:" && parsed.port === "443") parsed.port = "";

  const keep = [...parsed.searchParams.entries()].filter(([k]) => !isTrackingParam(k));
  parsed.search = "";
  for (const [k, v] of keep) parsed.searchParams.append(k, v);

  return tidy(parsed);
}

/** Serialise a URL without a dangling "?" or "#", and without a lone "/" path. */
function tidy(parsed) {
  let out = parsed.toString();
  // A trailing "#" parses to an EMPTY hash, not "#" — but href still serialises
  // the marker, so test the emptiness rather than the character.
  if (!parsed.hash) out = out.replace(/#$/, "");
  if (!parsed.search) out = out.replace(/\?(?=#|$)/, "");
  if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
    out = out.replace(/\/$/, "");
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PURE — the query engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filter, sort and paginate a set of records. PURE — this is the function that
 * `queryItems()` wraps, and the reason the wrapper needs no tests of its own.
 *
 * @param {Array} items
 * @param {{
 *   search?: string,          all whitespace-separated terms must match (AND)
 *   type?: string,            "" = every type
 *   kind?: string,            "" = every kind; "record" or "event" narrows
 *   eventType?: string,       "" = every event type
 *   tags?: string[],          ALL listed tags must be present (AND)
 *   sortBy?: string,          updatedAt | createdAt | title | reminderAt | occurredAt
 *   sortDir?: "asc"|"desc",
 *   dateFrom?: string,        "YYYY-MM-DD", inclusive
 *   dateTo?: string,          "YYYY-MM-DD", inclusive
 *   dateField?: string,       which field the range applies to
 *   offset?: number,
 *   limit?: number,           0 = no limit
 *   pinnedFirst?: boolean,
 *   onlyDeleted?: boolean,    trash mode: returns ONLY tombstones
 * }} opts
 * @returns {{results: Array, total: number, hasMore: boolean}}
 */
export function queryItemSet(items, opts = {}) {
  const {
    search = "",
    type = "",
    kind = "",
    eventType = "",
    tags = [],
    sortBy = "updatedAt",
    sortDir = "desc",
    dateFrom = "",
    dateTo = "",
    dateField = "updatedAt",
    offset = 0,
    limit = 0,
    pinnedFirst = true,
    onlyDeleted = false,
  } = opts;

  const terms = normalizeSearchText(search).split(" ").filter(Boolean);
  const wantedTags = (tags || []).map(normalizeSearchText).filter(Boolean);

  const filtered = (items || []).filter((item) => {
    if (!item) return false;

    // Every query hides tombstones except the trash view (§6). The flag is
    // exclusive, not additive: trash mode shows tombstones and nothing else.
    if (item.deletedAt ? !onlyDeleted : onlyDeleted) return false;

    if (type && item.type !== type) return false;

    // Through normalizeKind, not item.kind, so a record written before the
    // event axis existed still answers to kind: "record".
    if (kind && normalizeKind(item.kind) !== kind) return false;
    if (eventType && item.eventType !== eventType) return false;

    if (wantedTags.length) {
      const has = (item.tags || []).map(normalizeSearchText);
      if (!wantedTags.every((tag) => has.includes(tag))) return false;
    }

    if (dateFrom || dateTo) {
      const value = item[dateField];
      if (!value) return false;
      const day = String(value).slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
    }

    if (terms.length) {
      const hay = buildHaystack(item);
      if (!terms.every((term) => hay.includes(term))) return false;
    }

    return true;
  });

  filtered.sort(makeComparator(sortBy, sortDir, pinnedFirst));

  const total = filtered.length;
  const start = Math.max(0, offset);
  const results = limit > 0 ? filtered.slice(start, start + limit) : filtered.slice(start);
  return { results, total, hasMore: start + results.length < total };
}

/** Comparator factory. PURE, and exported so the ordering rules are testable. */
export function makeComparator(sortBy = "updatedAt", sortDir = "desc", pinnedFirst = true) {
  const dir = sortDir === "asc" ? 1 : -1;
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : "updatedAt";

  return (a, b) => {
    if (pinnedFirst && !!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;

    if (field === "title") {
      const cmp = String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (cmp !== 0) return cmp * dir;
    } else if (SPARSE_DATE_FIELDS.has(field)) {
      // A row without this date sorts last in BOTH directions. Ascending would
      // otherwise open with a wall of rows that have no reminder — or, on
      // occurredAt, with every record that never happened — which is never what
      // the sort was asked for.
      const av = a[field] || "";
      const bv = b[field] || "";
      if (!av !== !bv) return av ? -1 : 1;
      if (av !== bv) return (av < bv ? -1 : 1) * dir;
    } else {
      const av = String(a[field] || "");
      const bv = String(b[field] || "");
      if (av !== bv) return (av < bv ? -1 : 1) * dir;
    }

    // Stable tiebreak so pagination can never show or skip a record twice.
    return String(a.id).localeCompare(String(b.id));
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PURE — analytics for the insights view
// ═══════════════════════════════════════════════════════════════════════════

/** Local "YYYY-MM-DD". Never toISOString(), which is UTC and shifts the day. */
function localDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Monday of the week containing "YYYY-MM-DD". PURE. */
export function weekStart(day) {
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const shift = (d.getUTCDay() + 6) % 7; // Monday = 0 (NL/BE week)
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/**
 * Counts for the insights tiles and the per-type bars. PURE.
 * `today` is passed in rather than read from the clock so the result is
 * deterministic and testable.
 */
export function computeStats(items, today) {
  const alive = (items || []).filter((i) => i && !i.deletedAt);

  // Insights describe the things you OWN. Events are what happened to them, and
  // counting a decade of boiler services as "12 devices" would make every tile
  // on the page a lie.
  const live = alive.filter((i) => normalizeKind(i.kind) === "record");
  const events = alive.length - live.length;

  const byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
  const tags = new Set();
  let pinned = 0;
  let withReminder = 0;
  let overdue = 0;
  let dueToday = 0;
  let dueWeek = 0;
  let links = 0;
  let attachments = 0;

  for (const item of live) {
    if (byType[item.type] !== undefined) byType[item.type]++;
    if (item.pinned) pinned++;
    for (const tag of item.tags || []) tags.add(normalizeSearchText(tag));
    links += (item.links || []).length;
    attachments += (item.attachments || []).length;

    if (item.reminderAt) {
      withReminder++;
      const days = daysBetween(item.reminderAt, today);
      if (days === null) continue;
      if (days < 0) overdue++;
      else if (days === 0) dueToday++;
      else if (days <= 7) dueWeek++;
    }
  }

  return {
    total: live.length,
    events,
    // Deliberately counts tombstoned events too: the trash shows both, so a
    // count that disagreed with it would look like a bug.
    deleted: (items || []).filter((i) => i && i.deletedAt && !i.purgedAt).length,
    byType,
    pinned,
    withReminder,
    overdue,
    dueToday,
    dueWeek,
    /** What the app badge shows: everything needing attention now (§8.16). */
    due: overdue + dueToday,
    tags: tags.size,
    links,
    attachments,
  };
}

/**
 * Whether to raise a catch-up notification, and what it should say. PURE.
 *
 * ── Catch-up, not push ─────────────────────────────────────────────────────
 * Real push needs a server to send it, which this app does not have and will
 * not get. So the app tells you what is due the next time you OPEN it. That is
 * strictly weaker than a phone notification arriving on its own — it cannot
 * remind you of anything while the app is closed — and it is still worth
 * having, because the badge only says "3" and this says which three.
 *
 * `notifiedThrough` is the last day we already spoke up. Without it every
 * launch would fire the same notification, and the fastest way to have someone
 * mute an app for good is to tell them the same thing four times a day.
 */
export function dueNotification(items, today, notifiedThrough) {
  const due = (items || []).filter(
    (item) =>
      item &&
      !item.deletedAt &&
      normalizeKind(item.kind) === "record" &&
      item.reminderAt &&
      String(item.reminderAt).slice(0, 10) <= today
  );

  if (!due.length || !today) return { shouldNotify: false, overdue: 0, dueToday: 0, titles: [] };
  if (notifiedThrough && String(notifiedThrough) >= String(today)) {
    return { shouldNotify: false, overdue: 0, dueToday: 0, titles: [] };
  }

  // Overdue first, then by date: the notification can only name a few, and the
  // ones that slipped matter more than the one that just came up.
  due.sort((a, b) => String(a.reminderAt).localeCompare(String(b.reminderAt)));

  return {
    shouldNotify: true,
    overdue: due.filter((i) => String(i.reminderAt).slice(0, 10) < today).length,
    dueToday: due.filter((i) => String(i.reminderAt).slice(0, 10) === today).length,
    total: due.length,
    titles: due.slice(0, 3).map((i) => i.title || ""),
  };
}

/** Whole days from `todayIso` to `dayIso`, date-only. PURE. */
function daysBetween(dayIso, todayIso) {
  if (!dayIso || !todayIso) return null;
  const a = Date.parse(`${String(dayIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(todayIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * `weeks` consecutive weekly buckets ending with the week containing `today`,
 * oldest first. PURE. Feeds the hand-drawn SVG bar chart in §8.8.
 */
export function bucketItemsByWeek(items, weeks = 12, { field = "createdAt", today, kind = "" } = {}) {
  const anchor = weekStart(today || localDay(new Date()));
  if (!anchor) return [];

  const buckets = [];
  const index = new Map();
  const cursor = new Date(`${anchor}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    const start = cursor.toISOString().slice(0, 10);
    index.set(start, i);
    buckets.push({ start, count: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  for (const item of items || []) {
    if (!item || item.deletedAt || !item[field]) continue;
    if (kind && normalizeKind(item.kind) !== kind) continue;
    const bucket = index.get(weekStart(item[field]));
    if (bucket !== undefined) buckets[bucket].count++;
  }
  return buckets;
}

/**
 * Every tag in use, most recently used first. PURE.
 *
 * Signature note: §6 writes this as `sortTagsByRecency(tags)`, but recency is a
 * property of the records that carry the tag, not of a bare string list — so it
 * takes items and returns the tags with their counts.
 */
export function sortTagsByRecency(items) {
  const seen = new Map();
  for (const item of items || []) {
    if (!item || item.deletedAt) continue;
    for (const raw of item.tags || []) {
      const tag = String(raw).trim();
      if (!tag) continue;
      const key = normalizeSearchText(tag);
      const at = item.updatedAt || item.createdAt || "";
      const entry = seen.get(key);
      if (!entry) seen.set(key, { tag, count: 1, lastUsedAt: at });
      else {
        entry.count++;
        if (at > entry.lastUsedAt) entry.lastUsedAt = at;
      }
    }
  }
  return [...seen.values()].sort(
    (a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : a.tag.localeCompare(b.tag))
  );
}

/**
 * Reminder types already in use, most-used first. PURE.
 * This is what fills the "free input or pick a previous one" combobox (§14).
 */
export function reminderTypesInUse(items) {
  const seen = new Map();
  for (const item of items || []) {
    if (!item || item.deletedAt) continue;
    const value = String(item.reminderType || "").trim();
    if (!value) continue;
    const key = normalizeSearchText(value);
    const at = item.updatedAt || item.createdAt || "";
    const entry = seen.get(key);
    if (!entry) seen.set(key, { value, count: 1, lastUsedAt: at });
    else {
      entry.count++;
      if (at > entry.lastUsedAt) entry.lastUsedAt = at;
    }
  }
  return [...seen.values()].sort(
    (a, b) => b.count - a.count || (a.lastUsedAt < b.lastUsedAt ? 1 : -1) || a.value.localeCompare(b.value)
  );
}

/** Live records that link TO `id`. PURE. */
export function computeBacklinks(items, id) {
  if (!id) return [];
  return (items || []).filter(
    (item) => item && !item.deletedAt && (item.linkedIds || []).includes(id)
  );
}

/** Every id referenced by any live record. PURE. */
export function computeLinkedIdSet(items) {
  const set = new Set();
  for (const item of items || []) {
    if (!item || item.deletedAt) continue;
    for (const id of item.linkedIds || []) if (id) set.add(id);
  }
  return set;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. PURE — the activity ring buffer (§8.4)
// ═══════════════════════════════════════════════════════════════════════════

export const ACTIVITY_CAP = 60;
export const ACTIVITY_DETAIL_MAX = 200;

/**
 * Prepend an entry to the capped log. PURE — returns a new array, newest first.
 * The log is local only and is never synced.
 */
export function appendActivity(log, entry, cap = ACTIVITY_CAP) {
  const clean = {
    at: entry.at || new Date().toISOString(),
    kind: entry.kind || "sync",
    outcome: entry.outcome || "success",
    detail: String(entry.detail || "").slice(0, ACTIVITY_DETAIL_MAX),
  };
  return [clean, ...(Array.isArray(log) ? log : [])].slice(0, Math.max(1, cap));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

export const STORE_ITEMS = "items";
export const STORE_MEDIA = "media";
export const STORE_META = "meta";
export const STORE_VERSIONS = "versions";

/**
 * How many past revisions of a record are kept. Local only — see the note on
 * versionKey() for why they are never synced.
 */
export const VERSION_KEEP = 5;

/**
 * Primary key for one stored revision: `<recordId>#<zero-padded seq>`.
 *
 * The padding is what makes this work without an index. String order over these
 * keys IS chronological order within a record, and every revision of one record
 * forms a contiguous run, so a cursor over versionKeyRange() reads exactly that
 * record's history — no secondary index, in keeping with §6.
 *
 * Six digits caps a record at a million revisions, which at five kept is
 * roughly two hundred thousand more than anyone will reach.
 *
 * These never leave the device. Last-write-wins discards the losing record
 * whole, so history kept INSIDE the record would vanish together with the edit
 * you wanted it for — which is precisely the case it exists to cover.
 */
export function versionKey(recordId, seq) {
  const n = Math.max(0, Math.trunc(Number(seq) || 0));
  return `${recordId}#${String(n).padStart(6, "0")}`;
}

/** Inclusive `[lower, upper]` bounds covering every revision of one record. */
export function versionKeyRange(recordId) {
  return [`${recordId}#`, `${recordId}#￿`];
}

const DB_VERSION = 2;
let dbName = "huisbeheer";
let dbPromise = null;

/**
 * Point the module at a different database. TESTS ONLY — must be called before
 * openDB(), so the suite can never touch real data.
 */
export function useDatabase(name) {
  dbName = name;
  dbPromise = null;
}

/**
 * Open (and on first run create) the database.
 *
 * Migrations (§6): bump DB_VERSION and add stores here. NEVER rewrite existing
 * records on upgrade — missing fields are filled at read time by
 * hydrateRecord() instead.
 *
 * No indexes, deliberately. Search matches a composed haystack with substring
 * semantics, which no IndexedDB index can serve, so every query scans anyway —
 * and at the few thousand records this app is for, the scan is free. Adding
 * indexes now would be cost with no reader.
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      // v2 — per-record revision history, written from the next phase onward.
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
        db.createObjectStore(STORE_VERSIONS, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: let go so it is not blocked.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade blocked by another open tab"));
  });
  return dbPromise;
}

/** Close the connection. Used by the tests between fixtures. */
export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

/** Wrap one IDBRequest as a promise. */
function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run `fn` inside a transaction and resolve when the transaction COMMITS, not
 * when the last request succeeds — otherwise a write can still be rolled back
 * after the caller has moved on.
 */
async function withStore(names, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    Promise.resolve(fn(tx))
      .then((value) => {
        result = value;
      })
      .catch((err) => {
        try {
          tx.abort();
        } catch {
          /* already finishing */
        }
        reject(err);
      });
  });
}

// ── items ─────────────────────────────────────────────────────────────────

/**
 * Write one record.
 *
 * `touch` stamps updatedAt, which is what every user edit must do — a write
 * that forgets it is silently discarded by the next sync (§5). Sync, restore
 * and import pass `touch: false`, because there the timestamp IS the data.
 */
export async function putItem(item, { touch = true } = {}) {
  // Validate the INPUT, not the hydrated copy: hydrateRecord() mints a missing
  // id by design (it normalises records read back from disk), so checking
  // afterwards would happily write a record under an id the caller never chose
  // — which is how the same record ends up stored twice after a sync.
  if (!item || !item.id) throw new Error("putItem: record needs an id");
  const record = hydrateRecord(item);
  if (touch) record.updatedAt = new Date().toISOString();
  await withStore(STORE_ITEMS, "readwrite", (tx) =>
    req(tx.objectStore(STORE_ITEMS).put(record))
  );
  return record;
}

/**
 * Bulk write. Never touches updatedAt — the only callers are sync, restore and
 * import, and all three must preserve the timestamps they were given.
 */
export async function putItems(items) {
  // Same reasoning as putItem: filter on the input's own id, before hydration.
  const records = (items || [])
    .filter((raw) => raw && raw.id)
    .map(hydrateRecord)
    .filter(Boolean);
  await withStore(STORE_ITEMS, "readwrite", (tx) => {
    const store = tx.objectStore(STORE_ITEMS);
    return Promise.all(records.map((r) => req(store.put(r))));
  });
  return records.length;
}

export async function getItem(id) {
  if (!id) return null;
  const raw = await withStore(STORE_ITEMS, "readonly", (tx) =>
    req(tx.objectStore(STORE_ITEMS).get(id))
  );
  return raw ? hydrateRecord(raw) : null;
}

/** Every record INCLUDING tombstones. Callers filter; the query engine does. */
export async function getAllItems() {
  const rows = await withStore(STORE_ITEMS, "readonly", (tx) =>
    req(tx.objectStore(STORE_ITEMS).getAll())
  );
  return (rows || []).map(hydrateRecord).filter(Boolean);
}

/** `queryItemSet` over the whole store. See that function for the options. */
export async function queryItems(opts = {}) {
  return queryItemSet(await getAllItems(), opts);
}

/** Tombstones, newest first, excluding ones already restored or purged (§8.5). */
export async function getDeletedItems() {
  const all = await getAllItems();
  return all
    .filter((i) => i.deletedAt && !i.restoredAt && !i.purgedAt)
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
}

/**
 * Soft-delete: write a tombstone. Never a hard delete — a removed row cannot
 * propagate, the other device would simply re-add it on the next sync (§5).
 *
 * Undo-on-delete does NOT call this and then undo it. The toast defers this
 * call to its expiry, so an undone delete never writes a tombstone at all —
 * which also avoids resurrecting a record under an id whose tombstone may
 * already have reached Drive (§13.6).
 */
export async function softDeleteItem(id) {
  const item = await getItem(id);
  if (!item || item.deletedAt) return null;
  const now = new Date().toISOString();
  item.deletedAt = now;
  return putItem(item, { touch: true });
}

/** Remove every record. Used by restore-as-replace and by the tests. */
export async function clearItems() {
  await withStore(STORE_ITEMS, "readwrite", (tx) =>
    req(tx.objectStore(STORE_ITEMS).clear())
  );
}

// ── media ─────────────────────────────────────────────────────────────────

/** Store a blob. `rec` is { id, blob, thumbnailBlob }. */
export async function putMedia(rec) {
  if (!rec || !rec.id) throw new Error("putMedia: needs an id");
  const record = { id: rec.id, blob: rec.blob || null, thumbnailBlob: rec.thumbnailBlob || null };
  await withStore(STORE_MEDIA, "readwrite", (tx) =>
    req(tx.objectStore(STORE_MEDIA).put(record))
  );
  return record;
}

export async function getMedia(id) {
  if (!id) return null;
  return (
    (await withStore(STORE_MEDIA, "readonly", (tx) =>
      req(tx.objectStore(STORE_MEDIA).get(id))
    )) || null
  );
}

export async function deleteMedia(id) {
  if (!id) return;
  await withStore(STORE_MEDIA, "readwrite", (tx) =>
    req(tx.objectStore(STORE_MEDIA).delete(id))
  );
}

/** Every media id held locally — the input to media reconciliation (§7). */
export async function getAllMediaIds() {
  const keys = await withStore(STORE_MEDIA, "readonly", (tx) =>
    req(tx.objectStore(STORE_MEDIA).getAllKeys())
  );
  return (keys || []).map(String);
}

/**
 * Copy a blob under a fresh id. Restoring from the trash re-creates a record
 * with a NEW id, so its media has to be cloned rather than shared — otherwise
 * deleting one copy would take the other's blob with it (§8.5).
 */
export async function cloneMedia(sourceId) {
  const source = await getMedia(sourceId);
  if (!source) return null;
  const id = makeId();
  await putMedia({ id, blob: source.blob, thumbnailBlob: source.thumbnailBlob });
  return id;
}

/** A small preview, or null for anything that is not a decodable image. */
export async function makeThumbnail(file, max = 320) {
  return rescaleImage(file, max, 0.72, { always: true });
}

/**
 * A bounded copy of an image, so a phone photo is not stored at 12 MP.
 *
 * Returns null when the image ALREADY fits, which means the caller stores the
 * original untouched. That matters: re-encoding always produces JPEG, so
 * re-encoding a small PNG would leave JPEG bytes sitting behind a ".png"
 * filename and the downloaded file would be broken.
 */
export async function makeFullImage(file, max = 1600) {
  return rescaleImage(file, max, 0.85, { always: false });
}

async function rescaleImage(file, max, quality, { always } = {}) {
  if (!file || !String(file.type || "").startsWith("image/")) return null;
  if (typeof createImageBitmap !== "function") return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null; // not decodable (e.g. an SVG on some browsers) — no preview
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (!always && scale >= 1) {
    bitmap.close && bitmap.close();
    return null; // already small enough — keep the original bytes and format
  }
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close && bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

// ── meta ──────────────────────────────────────────────────────────────────

export async function getMeta(key, fallback = null) {
  const row = await withStore(STORE_META, "readonly", (tx) =>
    req(tx.objectStore(STORE_META).get(key))
  );
  return row === undefined || row === null ? fallback : row.value;
}

export async function setMeta(key, value) {
  await withStore(STORE_META, "readwrite", (tx) =>
    req(tx.objectStore(STORE_META).put({ key, value }))
  );
  return value;
}

export async function deleteMeta(key) {
  await withStore(STORE_META, "readwrite", (tx) =>
    req(tx.objectStore(STORE_META).delete(key))
  );
}

// ── activity log (§8.4) ───────────────────────────────────────────────────

const ACTIVITY_KEY = "activityLog";

/**
 * Append to the app's black box. Local only, never synced.
 * @param {"sync"|"backup"|"restore"|"autosync"} kind
 * @param {"success"|"error"|"skipped"} outcome
 */
export async function logActivity(kind, outcome, detail = "") {
  const log = await getMeta(ACTIVITY_KEY, []);
  const next = appendActivity(log, { kind, outcome, detail });
  await setMeta(ACTIVITY_KEY, next);
  return next[0];
}

export async function getActivityLog() {
  const log = await getMeta(ACTIVITY_KEY, []);
  return Array.isArray(log) ? log : [];
}

export async function clearActivityLog() {
  await setMeta(ACTIVITY_KEY, []);
}

// ── storage (§8.13) ───────────────────────────────────────────────────────

/**
 * Ask the browser not to evict us. Best-effort: a refusal is normal and must
 * never surface as an error.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** { usage, quota, percent } or null where the API is unavailable. */
export async function getStorageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, percent: quota > 0 ? (usage / quota) * 100 : 0 };
  } catch {
    return null;
  }
}

/** Counts + storage for the insights and settings panels. */
export async function getStats(today) {
  const items = await getAllItems();
  return computeStats(items, today || localDay(new Date()));
}
