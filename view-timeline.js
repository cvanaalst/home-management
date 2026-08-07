/**
 * view-timeline.js — everything that happened around the house (BLUEPRINT §4).
 *
 * The overview answers "what do I own?". This answers "what happened to it?" —
 * the filter changed, the premium paid, the power out, the module added. Those
 * are stored as ordinary records with `kind: "event"` (§5), so this view is a
 * thin renderer over the same pure query engine the overview uses. Nothing here
 * reimplements search, filtering or sorting.
 *
 * ── Why this is its own module and not a second instance of view-list.js ────
 * view-list.js is a singleton: module-level paging state, fixed element ids,
 * one set of swipe handlers. Making it multi-instance is a real refactor with
 * no payoff, because the part that is expensive to get right — queryItemSet —
 * is already shared. What differs is genuinely different: rows group under a
 * date heading, the primary axis is `occurredAt` rather than `updatedAt`, and
 * there is a running total for anything carrying an amount.
 */

import { state } from "./state.js";
import { t, typeLabel, eventTypeLabel } from "./i18n.js";
import { icon, eventIcon } from "./icons.js";
import { TYPES, EVENT_TYPES, queryItems, getAllItems } from "./db.js";
import { formatDate, formatDayMonth, formatMonth, formatAmount } from "./ui.js";

const PAGE_SIZE = 40;

const $ = (id) => document.getElementById(id);

let callbacks = { onOpen: () => {}, onNew: () => {}, onPrint: () => {} };
let root;
let listEl;
let placeholderEl;
let summaryEl;
let loadMoreEl;
let chipRow;

/** Every control, looked up once — the same pattern view-detail.js uses. */
const el = {};

/** This view's own filters. Kept out of `state.filters` so the two views
 *  cannot fight over the same search box (§9). */
const filters = {
  search: "",
  eventType: "",
  type: "",
  dateFrom: "",
  dateTo: "",
  sortDir: "desc",
};

let loaded = 0;
let lastTotal = 0;
let searchTimer = null;

/** Whether the event-type row shows every chip or just the first line. */
let chipsExpanded = false;

/** True when the row opened ITSELF to reveal an active filter (see below). */
let chipsAutoExpanded = false;

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

export function initTimelineView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };

  root = $("timeline-body");
  root.textContent = "";
  root.className = "view__body timeline";

  root.append(buildControls());
  const body = document.createElement("div");
  body.className = "timeline__body";
  body.append(buildSummary(), buildList());
  root.append(body);
  bindControls();
  paintChips();
}

function buildControls() {
  // Reuses the overview's control classes rather than inventing a parallel set:
  // two search boxes that look different would read as two different features.
  const wrap = document.createElement("div");
  wrap.className = "list-controls";

  const row = document.createElement("div");
  row.className = "list-controls__row";

  const field = document.createElement("div");
  field.className = "search-field";
  const glyph = document.createElement("span");
  glyph.className = "search-field__icon";
  glyph.innerHTML = icon("search", { size: 18 });
  el.search = document.createElement("input");
  el.search.type = "search";
  el.search.className = "search-field__input";
  el.search.id = "timeline-search";
  el.search.autocomplete = "off";
  el.search.spellcheck = false;
  el.search.dataset.i18nPlaceholder = "list.search";
  el.search.dataset.i18nAria = "list.search.aria";
  el.search.setAttribute("aria-label", t("list.search.aria"));
  field.append(glyph, el.search);

  el.filterToggle = document.createElement("button");
  el.filterToggle.type = "button";
  el.filterToggle.className = "btn btn--ghost btn--icon";
  el.filterToggle.id = "btn-timeline-filters";
  el.filterToggle.dataset.i18nAria = "list.filter.aria";
  el.filterToggle.dataset.i18nTitle = "list.filter";
  el.filterToggle.setAttribute("aria-expanded", "false");
  el.filterToggle.setAttribute("aria-controls", "timeline-filter-panel");
  el.filterToggle.innerHTML = icon("filter", { size: 18 });

  // Printing is reading, not editing — deliberately NOT .edit-only, so a
  // maintenance log can be printed while the app is locked.
  el.print = document.createElement("button");
  el.print.type = "button";
  el.print.className = "btn btn--ghost btn--icon";
  el.print.id = "btn-timeline-print";
  el.print.dataset.i18nAria = "print.events";
  el.print.dataset.i18nTitle = "print.events";
  el.print.innerHTML = icon("print", { size: 18 });

  row.append(field, el.print, el.filterToggle);

  // Seven event types wrap to three lines on a phone. Same treatment as the
  // overview's type chips: collapsed to one line, with a toggle that appears
  // only when they genuinely do not fit.
  const chipGroup = document.createElement("div");
  chipGroup.className = "chip-group";

  chipRow = document.createElement("div");
  chipRow.className = "chip-row chip-row--collapsible";
  chipRow.id = "timeline-event-filters";
  chipRow.setAttribute("role", "group");
  chipRow.dataset.expanded = "false";

  el.chipToggle = document.createElement("button");
  el.chipToggle.type = "button";
  el.chipToggle.className = "chip-group__toggle";
  el.chipToggle.id = "btn-timeline-types-toggle";
  el.chipToggle.setAttribute("aria-expanded", "false");
  el.chipToggle.setAttribute("aria-controls", "timeline-event-filters");
  el.chipToggle.hidden = true;

  chipGroup.append(chipRow, el.chipToggle);

  el.panel = document.createElement("div");
  el.panel.className = "filter-panel";
  el.panel.id = "timeline-filter-panel";
  el.panel.hidden = true;
  buildPanelBody(el.panel);

  wrap.append(row, chipGroup, el.panel);
  return wrap;
}

function buildPanelBody(panel) {
  const sortRow = document.createElement("div");
  sortRow.className = "filter-panel__row";
  const sortLabel = document.createElement("span");
  sortLabel.className = "field__label";
  sortLabel.dataset.i18n = "list.sort";
  el.sortDir = document.createElement("button");
  el.sortDir.type = "button";
  el.sortDir.className = "btn btn--ghost btn--small";
  sortRow.append(sortLabel, el.sortDir);

  const typeRow = document.createElement("div");
  typeRow.className = "filter-panel__row";
  const typeLabelEl = document.createElement("span");
  typeLabelEl.className = "field__label";
  typeLabelEl.dataset.i18n = "type.label";
  el.type = document.createElement("select");
  el.type.className = "input input--select";
  el.type.setAttribute("aria-label", t("type.label"));
  typeRow.append(typeLabelEl, el.type);

  const dateRow = document.createElement("div");
  dateRow.className = "filter-panel__row";
  const fromLabel = document.createElement("span");
  fromLabel.className = "field__label";
  fromLabel.dataset.i18n = "list.dateFrom";
  el.from = document.createElement("input");
  el.from.type = "date";
  el.from.className = "input";
  el.from.setAttribute("aria-label", t("list.dateFrom"));
  const toLabel = document.createElement("span");
  toLabel.className = "field__label";
  toLabel.dataset.i18n = "list.dateTo";
  el.to = document.createElement("input");
  el.to.type = "date";
  el.to.className = "input";
  el.to.setAttribute("aria-label", t("list.dateTo"));
  dateRow.append(fromLabel, el.from, toLabel, el.to);

  el.clear = document.createElement("button");
  el.clear.type = "button";
  el.clear.className = "btn btn--ghost btn--small";
  el.clear.dataset.i18n = "list.clearFilters";

  panel.append(sortRow, typeRow, dateRow, el.clear);
}

function buildSummary() {
  summaryEl = document.createElement("p");
  summaryEl.className = "timeline__summary";
  summaryEl.id = "timeline-summary";
  return summaryEl;
}

function buildList() {
  const wrap = document.createElement("div");

  placeholderEl = document.createElement("div");
  placeholderEl.className = "placeholder";
  placeholderEl.id = "timeline-placeholder";

  listEl = document.createElement("div");
  listEl.className = "timeline__list";
  listEl.id = "timeline-list";

  loadMoreEl = document.createElement("button");
  loadMoreEl.type = "button";
  loadMoreEl.className = "btn btn--ghost btn--block";
  loadMoreEl.dataset.i18n = "list.loadMore";
  loadMoreEl.hidden = true;

  wrap.append(placeholderEl, listEl, loadMoreEl);
  return wrap;
}

function bindControls() {
  el.search.addEventListener("input", (e) => {
    filters.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshTimeline(), 250);
  });

  el.filterToggle.addEventListener("click", () => {
    const opening = el.panel.hidden;
    el.panel.hidden = !opening;
    el.filterToggle.setAttribute("aria-expanded", String(opening));
  });

  chipRow.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-event-type]");
    if (!chip) return;
    filters.eventType = chip.dataset.eventType;
    paintChips();
    refreshTimeline();
  });

  el.type.addEventListener("change", (e) => {
    filters.type = e.target.value;
    refreshTimeline();
  });

  el.sortDir.addEventListener("click", () => {
    filters.sortDir = filters.sortDir === "desc" ? "asc" : "desc";
    paintSortDirection();
    refreshTimeline();
  });

  el.from.addEventListener("change", (e) => {
    filters.dateFrom = e.target.value;
    refreshTimeline();
  });
  el.to.addEventListener("change", (e) => {
    filters.dateTo = e.target.value;
    refreshTimeline();
  });

  el.clear.addEventListener("click", clearFilters);
  el.print.addEventListener("click", printCurrent);

  el.chipToggle.addEventListener("click", () => {
    chipsAutoExpanded = false; // an explicit choice outranks the automatic one
    setChipsExpanded(!chipsExpanded);
  });

  // Chip widths change with the viewport AND with the language, so "does it
  // fit?" has to be re-asked rather than answered once.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measureChipOverflow, 150);
  });

  loadMoreEl.addEventListener("click", () => {
    loaded += PAGE_SIZE;
    render();
  });

  listEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (row) callbacks.onOpen(row.dataset.id);
  });
}

function setChipsExpanded(expanded) {
  chipsExpanded = expanded;
  chipRow.dataset.expanded = String(expanded);
  el.chipToggle.setAttribute("aria-expanded", String(expanded));
  el.chipToggle.innerHTML = icon("chevronDown", { size: 18 });
  const label = t(expanded ? "list.types.showLess" : "list.types.showAll");
  el.chipToggle.setAttribute("aria-label", label);
  el.chipToggle.title = label;
}

/**
 * Show the toggle only when the chips actually overflow one line.
 *
 * Measures a real chip rather than assuming, and bails when there is no layout
 * to measure — a hidden view reports every box as 0, and writing that back
 * would set --chip-line to 0px and collapse the row to nothing.
 */
function measureChipOverflow() {
  if (!chipRow || !el.chipToggle) return;
  const firstChip = chipRow.querySelector(".chip");
  if (!firstChip) return;

  const line = Math.round(firstChip.getBoundingClientRect().height);
  if (line === 0) return;
  chipRow.style.setProperty("--chip-line", `${line}px`);

  const wasExpanded = chipRow.dataset.expanded === "true";
  chipRow.dataset.expanded = "true";
  const overflows = chipRow.scrollHeight > line + 2;
  chipRow.dataset.expanded = String(wasExpanded);

  el.chipToggle.hidden = !overflows;

  // A filtered timeline must never hide which filter is active.
  if (overflows && filters.eventType && !chipsExpanded) {
    chipsAutoExpanded = true;
    setChipsExpanded(true);
    return;
  }
  // …and fold back once that reason goes, unless the user opened it by hand.
  if (chipsAutoExpanded && !filters.eventType) {
    chipsAutoExpanded = false;
    setChipsExpanded(false);
    return;
  }
  setChipsExpanded(chipsExpanded && overflows);
}

/** Re-measure once the view is genuinely on screen. Called by app.js. */
export function remeasureTimelineChips() {
  measureChipOverflow();
}

/**
 * Print exactly what is on screen.
 *
 * Re-runs the query with no limit rather than printing the loaded page: the
 * list shows forty at a time, and a printed log that stops at forty for no
 * visible reason is worse than no log.
 */
async function printCurrent() {
  const { results } = await queryItems({
    kind: "event",
    search: filters.search,
    eventType: filters.eventType,
    type: filters.type,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    dateField: "occurredAt",
    sortBy: "occurredAt",
    sortDir: filters.sortDir,
    pinnedFirst: false,
  });
  callbacks.onPrint(results, await getAllItems());
}

function clearFilters() {
  filters.search = "";
  filters.eventType = "";
  filters.type = "";
  filters.dateFrom = "";
  filters.dateTo = "";
  el.search.value = "";
  el.from.value = "";
  el.to.value = "";
  el.type.value = "";
  paintChips();
  refreshTimeline();
}

// ═══════════════════════════════════════════════════════════════════════════
// Painting the controls
// ═══════════════════════════════════════════════════════════════════════════

function paintChips() {
  chipRow.textContent = "";
  const chip = (value, label, glyph, colourVar) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${filters.eventType === value ? " chip--active" : ""}`;
    button.dataset.eventType = value;
    button.setAttribute("aria-pressed", String(filters.eventType === value));
    if (glyph) {
      const mark = document.createElement("span");
      mark.className = "chip__glyph";
      mark.innerHTML = icon(glyph, { size: 14 });
      if (colourVar) mark.style.color = colourVar;
      button.append(mark);
    }
    button.append(document.createTextNode(label));
    return button;
  };

  chipRow.append(chip("", t("eventType.all"), null, null));
  for (const eventType of EVENT_TYPES) {
    chipRow.append(
      chip(eventType, eventTypeLabel(eventType), eventIcon(eventType), `var(--event-${eventType})`)
    );
  }

  measureChipOverflow();
}

function paintTypeOptions() {
  const options = [`<option value="">${t("type.all")}</option>`];
  for (const type of TYPES) options.push(`<option value="${type}">${typeLabel(type)}</option>`);
  el.type.innerHTML = options.join("");
  el.type.value = filters.type;
}

function paintSortDirection() {
  const key = filters.sortDir === "desc" ? "timeline.newestFirst" : "timeline.oldestFirst";
  el.sortDir.textContent = t(key);
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

export async function renderTimeline() {
  if (!root) return;
  loaded = 0;
  paintTypeOptions();
  paintSortDirection();
  await render();
}

/** Re-query and repaint without resetting how much is loaded. */
export async function refreshTimeline() {
  if (!root) return;
  loaded = 0;
  await render();
}

async function render() {
  const limit = loaded + PAGE_SIZE;
  const { results, total } = await queryItems({
    kind: "event",
    search: filters.search,
    eventType: filters.eventType,
    type: filters.type,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    // The range applies to when it HAPPENED, which is the only date a
    // household reasons about. `updatedAt` would filter on when someone last
    // corrected a typo in the note about it.
    dateField: "occurredAt",
    sortBy: "occurredAt",
    sortDir: filters.sortDir,
    // A pinned event would jump out of its own chronology, which is the one
    // thing a timeline may never do.
    pinnedFirst: false,
    limit,
  });

  loaded = results.length;
  lastTotal = total;

  const subjects = new Map((await getAllItems()).map((item) => [item.id, item]));

  listEl.textContent = "";
  const empty = results.length === 0;
  listEl.hidden = empty;
  placeholderEl.hidden = !empty;
  loadMoreEl.hidden = empty || loaded >= lastTotal;

  if (empty) {
    paintPlaceholder();
    summaryEl.hidden = true;
    return;
  }

  paintSummary(results, total);

  // Rows carry a month heading rather than a date per row: a household's
  // history is naturally read in months, and repeating "March 2026" on nine
  // consecutive rows is noise.
  let currentMonth = null;
  for (const event of results) {
    const month = String(event.occurredAt || "").slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      listEl.append(monthHeading(month));
    }
    listEl.append(buildRow(event, subjects));
  }
}

function paintPlaceholder() {
  placeholderEl.textContent = "";
  const filtering =
    !!filters.search || !!filters.eventType || !!filters.type || !!filters.dateFrom || !!filters.dateTo;

  const glyph = document.createElement("span");
  glyph.className = "placeholder__icon";
  glyph.innerHTML = icon(filtering ? "search" : "timeline", { size: 44 });

  const title = document.createElement("p");
  title.className = "placeholder__title";
  title.textContent = t(filtering ? "timeline.empty.filtered.title" : "timeline.empty.title");

  const body = document.createElement("p");
  body.className = "placeholder__body";
  body.textContent = t(filtering ? "timeline.empty.filtered.body" : "timeline.empty.body");

  placeholderEl.append(glyph, title, body);

  if (filtering) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn btn--ghost btn--small";
    clear.textContent = t("list.clearFilters");
    clear.addEventListener("click", clearFilters);
    placeholderEl.append(clear);
  }
}

/**
 * "23 events · €1,240 spent". The total is what turns a list of dates into
 * something you can argue with — it is the answer to "is this boiler worth
 * keeping?".
 */
function paintSummary(results, total) {
  summaryEl.hidden = false;
  const parts = [t("timeline.count", { count: results.length, total })];

  const withAmount = results.filter((e) => typeof e.amount === "number");
  if (withAmount.length) {
    const sum = withAmount.reduce((acc, e) => acc + e.amount, 0);
    parts.push(t("timeline.total", { amount: formatAmount(sum, state.lang) }));
  }
  summaryEl.textContent = parts.join(" · ");
}

function monthHeading(month) {
  const heading = document.createElement("h2");
  heading.className = "timeline__month";
  heading.textContent = month ? formatMonth(month, state.lang) : t("timeline.undated");
  return heading;
}

function buildRow(event, subjects) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "timeline__row";
  row.dataset.id = event.id;
  row.style.setProperty("--event-colour", `var(--event-${event.eventType})`);

  const glyph = document.createElement("span");
  glyph.className = "timeline__icon";
  glyph.innerHTML = icon(eventIcon(event.eventType), { size: 18 });

  const text = document.createElement("span");
  text.className = "timeline__text";

  const compact = state.density === "compact";

  const head = document.createElement("span");
  head.className = "timeline__title";
  head.textContent = event.title || t("timeline.untitled");

  const meta = document.createElement("span");
  meta.className = "timeline__meta";

  // Compact collapses the row to ONE line, the way the record list's compact
  // does — anything less is not the density the user asked for.
  //
  // What survives, in priority order: the date, because a timeline without one
  // is just a list; the title; and the subject, because "filter replaced" is
  // useless without knowing which boiler. What goes is the event-type WORD,
  // which the coloured icon on the left already says.
  // Compact drops the YEAR too: every row already sits under a month heading
  // that states it, so repeating it costs width the title needs.
  const when = event.occurredAt
    ? (compact ? formatDayMonth : formatDate)(event.occurredAt, state.lang)
    : t("timeline.undated");
  const bits = [when];
  if (!compact) bits.push(eventTypeLabel(event.eventType));

  // Name the subject, not just the event: "filter replaced" is useless without
  // knowing which of the two boilers it was.
  for (const id of event.linkedIds || []) {
    const subject = subjects.get(id);
    if (subject && !subject.deletedAt) {
      bits.push(subject.title || typeLabel(subject.type));
      break;
    }
  }
  if (compact) {
    // Date leads, then the title, then the subject after an en dash. The
    // subject is last so it is the first thing to ellipsise on a narrow
    // screen, which is the right order to lose things in.
    const [when, ...rest] = bits;
    head.textContent = `${when} · ${event.title || t("timeline.untitled")}`;
    if (rest.length) head.textContent += ` – ${rest.join(" · ")}`;
    text.append(head);
  } else {
    meta.textContent = bits.join(" · ");
    text.append(head, meta);
  }

  row.append(glyph, text);

  if (typeof event.amount === "number") {
    const amount = document.createElement("span");
    amount.className = "timeline__amount";
    amount.textContent = formatAmount(event.amount, state.lang);
    row.append(amount);
  }

  return row;
}

// ═══════════════════════════════════════════════════════════════════════════
// Language switch
// ═══════════════════════════════════════════════════════════════════════════

export function refreshTimelineLanguage() {
  if (!root) return;
  paintChips();
  paintTypeOptions();
  paintSortDirection();
  if (!$("view-timeline").hidden) renderTimeline();
}
