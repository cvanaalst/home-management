/**
 * view-list.js — the overview list (BLUEPRINT §4, §9).
 *
 * Owns its own DOM wiring and rendering. Never imports another view module;
 * cross-view actions arrive as callbacks from app.js.
 *
 * ── Undo-on-delete, and why no tombstone is written up front ───────────────
 * Deleting a row hides it optimistically and shows a toast. The actual
 * softDeleteItem() runs in the toast's onExpire, so an undone delete never
 * writes a tombstone at all. That matters beyond tidiness: bringing a record
 * back under an id whose tombstone may already have reached Drive gets it
 * re-killed by the next sync (§13.6). Not writing the tombstone until the undo
 * window closes sidesteps the whole problem — see `pendingDeletes`.
 */

import { state } from "./state.js";
import { t, typeLabel } from "./i18n.js";
import { icon } from "./icons.js";
import {
  TYPES,
  SORT_FIELDS,
  queryItems,
  getAllItems,
  softDeleteItem,
  putItem,
  getItem,
  sortTagsByRecency,
  countEventsBySubject,
  normalizeViews,
  isEmptyFilterSet,
  SAVED_VIEW_MAX,
  getMeta,
  setMeta,
} from "./db.js";
import {
  toast,
  actionSheet,
  confirmDialog,
  promptText,
  formatDate,
  daysUntil,
  todayIso,
  reminderTone,
  reminderLabel,
} from "./ui.js";
import { markdownToPlain } from "./markdown.js";

const PAGE_SIZE = 25;

const $ = (id) => document.getElementById(id);

let callbacks = { onOpen: () => {}, onPullRefresh: async () => {}, onChanged: () => {}, onExport: () => {} };
let listEl;
let placeholderEl;
let loadMoreEl;
let countEl;
let filterPanel;
let tagRow;

/** Ids hidden from the list while their undo window is still open. */
const pendingDeletes = new Set();

/**
 * Ids currently selected for a bulk action, and whether selection mode is on.
 *
 * Kept OUT of state.js: this is transient interaction state that must not
 * survive a tab switch, let alone a reload. Leaving a selection behind and
 * acting on it later is how someone deletes forty records they forgot were
 * ticked.
 */
const selected = new Set();
let selecting = false;

/** subjectId -> number of live events pointing at it. Rebuilt per render. */
let eventCounts = new Map();

let loaded = 0; // how many rows are currently rendered
let lastTotal = 0;
let searchTimer = null;

// ═══════════════════════════════════════════════════════════════════════════
// Init — runs once
// ═══════════════════════════════════════════════════════════════════════════

export function initListView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };

  listEl = $("record-list");
  placeholderEl = $("list-placeholder");
  loadMoreEl = $("btn-load-more");
  countEl = $("list-count");
  filterPanel = $("filter-panel");
  tagRow = $("tag-filters");

  $("search-input").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshList(), 250);
  });

  $("btn-filters").addEventListener("click", () => {
    const opening = filterPanel.hidden;
    filterPanel.hidden = !opening;
    $("btn-filters").setAttribute("aria-expanded", String(opening));
  });

  $("btn-types-toggle").addEventListener("click", () => {
    typesAutoExpanded = false; // an explicit choice outranks the automatic one
    setTypesExpanded(!typesExpanded);
  });

  // Chip widths change with the viewport AND with the language, so the
  // "does it fit?" answer has to be re-asked rather than computed once.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measureTypeOverflow, 150);
  });

  $("sort-field").addEventListener("change", (e) => {
    state.filters.sortBy = e.target.value;
    refreshList();
  });

  $("btn-sort-dir").addEventListener("click", () => {
    state.filters.sortDir = state.filters.sortDir === "desc" ? "asc" : "desc";
    paintSortDirection();
    refreshList();
  });

  $("date-from").addEventListener("change", (e) => {
    state.filters.dateFrom = e.target.value;
    refreshList();
  });
  $("date-to").addEventListener("change", (e) => {
    state.filters.dateTo = e.target.value;
    refreshList();
  });

  $("btn-clear-filters").addEventListener("click", clearFilters);
  $("btn-empty-clear").addEventListener("click", clearFilters);

  $("type-filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-type]");
    if (!chip) return;
    state.filters.type = chip.dataset.type;
    paintTypeFilters();
    refreshList();
  });

  tagRow.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-tag]");
    if (!chip) return;
    const tag = chip.dataset.tag;
    const current = state.filters.tags;
    state.filters.tags = current.includes(tag)
      ? current.filter((x) => x !== tag)
      : [...current, tag];
    refreshList();
  });

  loadMoreEl.addEventListener("click", () => {
    loaded += PAGE_SIZE;
    renderPage({ keepScroll: true });
  });

  bindSelection();
  $("btn-save-view").addEventListener("click", saveCurrentView);
  loadViews();
  bindRowInteraction();
  bindPullToRefresh();
  paintSortOptions();
  paintTypeFilters();
}

// ═══════════════════════════════════════════════════════════════════════════
// Saved views (§9)
// ═══════════════════════════════════════════════════════════════════════════

const VIEWS_KEY = "list.savedViews";
let savedViews = [];

async function loadViews() {
  savedViews = normalizeViews(await getMeta(VIEWS_KEY, []));
  paintViews();
}

async function persistViews() {
  savedViews = normalizeViews(savedViews);
  await setMeta(VIEWS_KEY, savedViews);
  paintViews();
}

/** Does the current filter set match this saved one? */
function viewIsActive(view) {
  const f = state.filters;
  const v = view.filters;
  return (
    (f.search || "") === v.search &&
    f.type === v.type &&
    f.dateFrom === v.dateFrom &&
    f.dateTo === v.dateTo &&
    [...f.tags].sort().join("|") === [...v.tags].sort().join("|")
  );
}

function paintViews() {
  const row = $("saved-views");
  if (!row) return;
  row.textContent = "";
  row.hidden = savedViews.length === 0;

  for (const view of savedViews) {
    const chip = document.createElement("span");
    chip.className = `chip chip--view${viewIsActive(view) ? " chip--active" : ""}`;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "chip__open";
    open.textContent = view.name;
    open.addEventListener("click", () => applyView(view));

    // Removing a view is the only destructive thing here and it is trivially
    // redoable, so it needs no confirmation — just a small, deliberate target.
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag__remove";
    remove.setAttribute("aria-label", t("views.remove", { name: view.name }));
    remove.innerHTML = icon("close", { size: 12 });
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      savedViews = savedViews.filter((v) => v.id !== view.id);
      await persistViews();
    });

    chip.append(open, remove);
    row.append(chip);
  }
}

function applyView(view) {
  const f = view.filters;
  state.filters.search = f.search;
  state.filters.type = f.type;
  state.filters.tags = [...f.tags];
  state.filters.dateFrom = f.dateFrom;
  state.filters.dateTo = f.dateTo;
  state.filters.sortBy = f.sortBy;
  state.filters.sortDir = f.sortDir;

  $("search-input").value = f.search;
  $("date-from").value = f.dateFrom;
  $("date-to").value = f.dateTo;
  $("sort-field").value = f.sortBy;
  paintSortDirection();
  paintTypeFilters();
  paintViews();
  refreshList();
}

async function saveCurrentView() {
  // Saving "everything" is a button that does nothing, which is worse than a
  // button that refuses.
  if (isEmptyFilterSet(state.filters)) {
    toast(t("views.nothingToSave"), "info");
    return;
  }
  if (savedViews.length >= SAVED_VIEW_MAX) {
    toast(t("views.full", { max: SAVED_VIEW_MAX }), "info");
    return;
  }
  const name = await promptText(t("views.save.prompt"), t("views.save"));
  if (!name) return;

  savedViews = [
    ...savedViews,
    {
      id: undefined,
      name,
      filters: {
        search: state.filters.search,
        type: state.filters.type,
        tags: [...state.filters.tags],
        dateFrom: state.filters.dateFrom,
        dateTo: state.filters.dateTo,
        sortBy: state.filters.sortBy,
        sortDir: state.filters.sortDir,
      },
    },
  ];
  await persistViews();
  toast(t("views.saved", { name }), "success");
}

// ═══════════════════════════════════════════════════════════════════════════
// Bulk selection (§9)
// ═══════════════════════════════════════════════════════════════════════════

export function isSelecting() {
  return selecting;
}

function setSelecting(on) {
  selecting = on;
  if (!on) selected.clear();
  document.body.classList.toggle("is-selecting", on);
  paintSelectionBar();
  refreshList();
}

/** Leave selection mode. Called by app.js when the view changes. */
export function exitSelection() {
  if (selecting) setSelecting(false);
}

function toggleSelected(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  paintSelectionBar();
  // Repaint just the one row's tick rather than the whole list.
  const row = listEl.querySelector(`[data-id="${id}"]`);
  if (row) row.classList.toggle("is-selected", selected.has(id));
}

function paintSelectionBar() {
  const bar = $("selection-bar");
  if (!bar) return;
  bar.hidden = !selecting;
  $("selection-count").textContent = t("bulk.count", { count: selected.size });
  for (const id of ["btn-bulk-tag", "btn-bulk-type", "btn-bulk-delete", "btn-bulk-export"]) {
    const button = $(id);
    if (button) button.disabled = selected.size === 0;
  }
}

function bindSelection() {
  $("btn-select").addEventListener("click", () => setSelecting(!selecting));
  $("btn-selection-done").addEventListener("click", () => setSelecting(false));

  $("btn-bulk-tag").addEventListener("click", async () => {
    const tag = await promptText(t("bulk.tag.prompt"), t("bulk.tag"));
    if (!tag) return;
    await eachSelected((record) => {
      const tags = new Set([...(record.tags || []), tag.trim()]);
      return { ...record, tags: [...tags] };
    });
    toast(t("bulk.tag.done", { count: selected.size, tag: tag.trim() }), "success");
    setSelecting(false);
  });

  $("btn-bulk-type").addEventListener("click", async () => {
    const choice = await actionSheet({
      title: t("bulk.type"),
      items: TYPES.map((type) => ({ id: type, label: typeLabel(type), icon: `type-${type}` })),
    });
    if (!choice) return;
    await eachSelected((record) => ({ ...record, type: choice }));
    toast(t("bulk.type.done", { count: selected.size, type: typeLabel(choice) }), "success");
    setSelecting(false);
  });

  $("btn-bulk-delete").addEventListener("click", async () => {
    const count = selected.size;
    // A confirm dialog, not undo-on-toast: forty records is past the point
    // where "did I mean that?" is answerable from a disappearing toast.
    const ok = await confirmDialog(t("bulk.delete.confirm", { count }), t("action.delete"));
    if (!ok) return;
    for (const id of selected) await softDeleteItem(id);
    toast(t("bulk.delete.done", { count }), "info");
    setSelecting(false);
    callbacks.onChanged();
  });

  $("btn-bulk-export").addEventListener("click", async () => {
    const all = await getAllItems();
    callbacks.onExport(all.filter((r) => selected.has(r.id)));
    setSelecting(false);
  });
}

/** Apply a change to every selected record, one write each. */
async function eachSelected(transform) {
  for (const id of selected) {
    const record = await getItem(id);
    if (record) await putItem(transform(record));
  }
  callbacks.onChanged();
}

function clearFilters() {
  state.filters.search = "";
  state.filters.type = "";
  state.filters.tags = [];
  state.filters.dateFrom = "";
  state.filters.dateTo = "";
  $("search-input").value = "";
  $("date-from").value = "";
  $("date-to").value = "";
  paintTypeFilters();
  paintViews();
  refreshList();
}

// ═══════════════════════════════════════════════════════════════════════════
// Painting the controls
// ═══════════════════════════════════════════════════════════════════════════

/** Whether the type row is showing every chip or just the first line. */
let typesExpanded = false;

/**
 * True when the row opened ITSELF to reveal an active filter, rather than
 * because the user asked. Without this distinction the row is sticky: it
 * auto-opens on filtering and then stays 118px tall forever, which is exactly
 * the height the collapse existed to save.
 */
let typesAutoExpanded = false;

function setTypesExpanded(expanded) {
  typesExpanded = expanded;
  const row = $("type-filters");
  const toggle = $("btn-types-toggle");
  row.dataset.expanded = String(expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.innerHTML = icon("chevronDown", { size: 18 });
  const label = t(expanded ? "list.types.showLess" : "list.types.showAll");
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
}

/**
 * Show the toggle only when the chips actually overflow one line.
 *
 * On a wide screen all eight fit and nothing about the control changes; on a
 * phone the toggle appears because five of them would otherwise be off-screen.
 */
function measureTypeOverflow() {
  const row = $("type-filters");
  const toggle = $("btn-types-toggle");
  const firstChip = row.querySelector(".chip");
  if (!firstChip) return;

  // Measure a real chip rather than assuming, then ask the layout whether the
  // content is taller than that single line.
  const line = Math.round(firstChip.getBoundingClientRect().height);

  // A hidden view has no layout: every box measures 0. Writing that back would
  // set --chip-line to 0px and collapse the row to nothing, which is exactly
  // what happened when arriving from another tab — navigate() refreshes the
  // list BEFORE it unhides the section, so the first measurement ran blind and
  // the chips vanished until something re-measured them. Bail instead; the
  // stylesheet's own fallback keeps the row a sensible height, and
  // remeasureTypeFilters() runs once the view is actually on screen.
  if (line === 0) return;

  row.style.setProperty("--chip-line", `${line}px`);

  const wasExpanded = row.dataset.expanded === "true";
  row.dataset.expanded = "true";
  const overflows = row.scrollHeight > line + 2;
  row.dataset.expanded = String(wasExpanded);

  toggle.hidden = !overflows;

  // A filtered list must never hide which filter is active: if the selected
  // chip could be sitting on a hidden line, open the row.
  if (overflows && state.filters.type && !typesExpanded) {
    typesAutoExpanded = true;
    setTypesExpanded(true);
    return;
  }
  // …and fold it back once that reason disappears, unless the user opened it.
  if (typesAutoExpanded && !state.filters.type) {
    typesAutoExpanded = false;
    setTypesExpanded(false);
    return;
  }
  setTypesExpanded(typesExpanded && overflows);
}

/** The type filter chips. Rebuilt on every language switch. */
export function paintTypeFilters() {
  const row = $("type-filters");
  const chip = (value, label, colourVar) =>
    `<button type="button" class="chip" data-type="${value}" ` +
    `aria-pressed="${state.filters.type === value}">` +
    (colourVar ? `<span class="chip__dot" style="color:var(${colourVar})"></span>` : "") +
    `${label}</button>`;

  row.innerHTML =
    chip("", t("type.all"), null) +
    TYPES.map((type) => chip(type, typeLabel(type), `--type-${type}`)).join("");

  measureTypeOverflow();
}

/**
 * Re-measure once the view is genuinely on screen.
 *
 * Called by app.js after the view swap. Chip widths depend on layout, and
 * layout does not exist while the section is hidden — see measureTypeOverflow().
 */
export function remeasureTypeFilters() {
  measureTypeOverflow();
}

function paintSortOptions() {
  const select = $("sort-field");
  select.innerHTML = SORT_FIELDS.map(
    (field) =>
      `<option value="${field}"${state.filters.sortBy === field ? " selected" : ""}>` +
      `${t(`sort.${field}`)}</option>`
  ).join("");
  paintSortDirection();
}

function paintSortDirection() {
  const button = $("btn-sort-dir");
  const descending = state.filters.sortDir === "desc";
  button.innerHTML = icon("sort", { size: 18 });
  button.setAttribute("aria-label", t("sort.direction.aria"));
  button.title = t(descending ? "sort.desc" : "sort.asc");
  button.dataset.dir = state.filters.sortDir;
}

async function paintTagFilters() {
  const tags = sortTagsByRecency(await getAllItems()).slice(0, 30);
  tagRow.textContent = "";
  if (!tags.length) {
    const empty = document.createElement("span");
    empty.className = "chip-row__empty";
    empty.textContent = t("list.noTags");
    tagRow.append(empty);
    return;
  }
  for (const { tag, count } of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip chip--tag";
    chip.dataset.tag = tag;
    chip.setAttribute("aria-pressed", String(state.filters.tags.includes(tag)));
    chip.append(document.createTextNode(tag));
    const badge = document.createElement("span");
    badge.className = "chip__count";
    badge.textContent = String(count);
    chip.append(badge);
    tagRow.append(chip);
  }
}

/** Re-render everything in this view that holds a translated string. */
export function refreshListLanguage() {
  paintTypeFilters();
  paintSortOptions();
  refreshList();
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering the list
// ═══════════════════════════════════════════════════════════════════════════

/** Reload from the first page. */
export async function refreshList() {
  loaded = 0;
  // Repaint the chips too, not just the rows: the filter can be set from
  // outside this view (the insights bars and tag cloud jump straight here),
  // and a chip row still showing "Alles" over a filtered list is the UI lying
  // about why records are missing.
  paintTypeFilters();
  // Same reasoning for the saved views: a view chip still marked active over a
  // filter set that no longer matches it says the list is showing something it
  // is not.
  paintViews();
  await paintTagFilters();
  await renderPage({ keepScroll: false });
}

/**
 * Open the filter panel. Used when the list arrives already filtered from
 * somewhere else, so the reason is visible rather than hidden behind a button.
 */
export function revealFilters() {
  filterPanel.hidden = false;
  $("btn-filters").setAttribute("aria-expanded", "true");
}

/**
 * Placeholder rows while the first query runs.
 *
 * Deliberately delayed: an IndexedDB read of a few thousand records finishes in
 * milliseconds, so showing this immediately would flash a skeleton on every
 * render and read as jank rather than progress. It appears only if the wait is
 * long enough to have been noticed anyway.
 *
 * Renders overlap — boot alone fires refreshList() from two places, and typing
 * in the search box stacks more on top. Every render therefore takes a sequence
 * number and only the NEWEST one may touch the skeleton, otherwise a timer left
 * behind by an abandoned render pops the placeholder back up over a list that
 * has already been painted, and nothing is left to take it down again.
 */
const SKELETON_DELAY_MS = 180;
const SKELETON_ROWS = 5;
let hasRenderedOnce = false;
let renderSeq = 0;

function showSkeleton() {
  const host = $("record-skeleton");
  if (!host.childElementCount) {
    host.innerHTML = Array.from({ length: SKELETON_ROWS })
      .map(
        () =>
          '<li class="record skeleton__row"><div class="record__surface">' +
          '<div class="record__main"><span class="skeleton__icon"></span>' +
          '<span class="record__text"><span class="skeleton__line skeleton__line--title"></span>' +
          '<span class="skeleton__line skeleton__line--meta"></span></span></div></div></li>'
      )
      .join("");
  }
  host.hidden = false;
  placeholderEl.hidden = true;
  listEl.hidden = true;
}

function hideSkeleton() {
  $("record-skeleton").hidden = true;
}

async function renderPage({ keepScroll }) {
  const seq = ++renderSeq;
  const skeletonTimer = hasRenderedOnce
    ? null
    : setTimeout(() => {
        if (seq === renderSeq) showSkeleton();
      }, SKELETON_DELAY_MS);

  try {
    await paintPage({ keepScroll, seq });
  } finally {
    clearTimeout(skeletonTimer);
    hasRenderedOnce = true;
    // Only the newest render clears the placeholder — and it clears it even if
    // the query threw, so a failure never leaves the list stuck shimmering.
    if (seq === renderSeq) hideSkeleton();
  }
}

async function paintPage({ keepScroll, seq }) {
  const limit = loaded + PAGE_SIZE;
  const { results, total } = await queryItems({
    search: state.filters.search,
    type: state.filters.type,
    // The overview is the things you own. Events belong to the timeline, and
    // left in here a decade of meter readings would bury every record on the
    // first page. Asked for explicitly rather than defaulted inside
    // queryItemSet, so the trash — which must show both — stays neutral.
    kind: "record",
    tags: state.filters.tags,
    sortBy: state.filters.sortBy,
    sortDir: state.filters.sortDir,
    dateFrom: state.filters.dateFrom,
    dateTo: state.filters.dateTo,
    limit,
  });

  // A slower earlier query must not repaint over a newer one's results.
  if (seq !== renderSeq) return;

  // A record inside an open undo window is already gone as far as the user is
  // concerned, even though its tombstone has not been written yet.
  const visible = results.filter((item) => !pendingDeletes.has(item.id));
  const hiddenHere = results.length - visible.length;
  lastTotal = total - hiddenHere;
  loaded = visible.length;

  const today = todayIso();

  // One pass for every row's event count. Counting per row would be a full
  // scan per record — fine at ten, not at a thousand.
  eventCounts = countEventsBySubject(await getAllItems());

  const rows = document.createDocumentFragment();
  for (const item of visible) rows.append(buildRow(item, today));
  listEl.textContent = "";
  listEl.append(rows);

  const filtering =
    !!state.filters.search ||
    !!state.filters.type ||
    state.filters.tags.length > 0 ||
    !!state.filters.dateFrom ||
    !!state.filters.dateTo;

  const empty = visible.length === 0;
  listEl.hidden = empty;
  placeholderEl.hidden = !empty;
  loadMoreEl.hidden = empty || loaded >= lastTotal;
  countEl.hidden = empty;
  countEl.textContent = t("list.count", { count: loaded, total: lastTotal });

  if (empty) paintPlaceholder(filtering);

  // Scroll is restored AFTER the data renders, never before — restoring onto a
  // short page gets the offset clamped (§13.9).
  if (!keepScroll) $("view-list").scrollTop = state.scroll.list || 0;
}

function paintPlaceholder(filtering) {
  $("list-placeholder-icon").innerHTML = icon(filtering ? "search" : "list", { size: 44 });
  $("list-placeholder-title").textContent = t(
    filtering ? "list.empty.filtered.title" : "list.empty.title"
  );
  $("list-placeholder-body").textContent = filtering
    ? t("list.empty.filtered.body")
    : t(state.locked ? "list.empty.locked" : "list.empty.body");
  $("btn-empty-clear").textContent = t("list.clearFilters");
  $("btn-empty-clear").hidden = !filtering;
}

function buildRow(item, today) {
  const li = document.createElement("li");
  li.className = `record${selecting && selected.has(item.id) ? " is-selected" : ""}`;
  li.dataset.id = item.id;
  li.style.setProperty("--record-colour", `var(--type-${item.type})`);
  // The labels revealed behind a swipe, rendered by CSS content: attr(...).
  li.dataset.swipePin = t(item.pinned ? "field.unpin" : "field.pin");
  li.dataset.swipeDelete = t("action.delete");

  const surface = document.createElement("div");
  surface.className = "record__surface";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "record__main";

  const glyph = document.createElement("span");
  glyph.className = "record__icon";
  glyph.innerHTML = icon(`type-${item.type}`, { size: 20 });
  glyph.title = typeLabel(item.type);

  const text = document.createElement("span");
  text.className = "record__text";

  const title = document.createElement("span");
  title.className = "record__title";
  title.textContent = item.title || t("detail.newRecord");
  text.append(title);

  // Comfortable density adds the second and third lines; compact stops here.
  if (state.density === "comfortable") {
    const preview = markdownToPlain(item.body, 90);
    if (preview) {
      const sub = document.createElement("span");
      sub.className = "record__preview";
      sub.textContent = preview;
      text.append(sub);
    }

    const meta = document.createElement("span");
    meta.className = "record__meta";

    // `updatedAt` is what this line USED to say, for every row, always. On a
    // set of records touched in the same sitting that is the same date eight
    // times over — a line of pure noise where the most useful fact about the
    // record could be. So: what is due, then how much has happened to it, and
    // only if neither exists does the date get the space by default.
    const when = document.createElement("span");
    when.textContent = formatDate(item.updatedAt, state.lang);
    const eventCount = eventCounts.get(item.id) || 0;
    if (item.reminderAt) {
      const soon = document.createElement("span");
      soon.className = "record__meta-strong";
      soon.textContent = t("list.meta.due", { date: formatDate(item.reminderAt, state.lang) });
      meta.append(soon);
    } else if (eventCount) {
      const events = document.createElement("span");
      events.className = "record__meta-strong";
      events.textContent = t("list.meta.events", { count: eventCount });
      meta.append(events);
    } else {
      meta.append(when);
    }
    for (const tag of item.tags.slice(0, 3)) {
      const chip = document.createElement("span");
      chip.className = "tag tag--mini";
      chip.textContent = tag;
      meta.append(chip);
    }
    if (item.links.length) meta.append(indicator("link", item.links.length));
    if (item.attachments.length) meta.append(indicator("paperclip", item.attachments.length));
    text.append(meta);
  }

  button.append(glyph, text);

  const marks = document.createElement("span");
  marks.className = "record__marks";
  if (item.reminderAt) {
    const days = daysUntil(item.reminderAt, today);
    const badge = document.createElement("span");
    badge.className = `reminder reminder--${reminderTone(days)}`;
    badge.innerHTML = icon("bell", { size: 13 });
    const label = document.createElement("span");
    label.textContent = reminderLabel(days);
    badge.append(label);
    marks.append(badge);
  }
  if (item.pinned) {
    const pin = document.createElement("span");
    pin.className = "record__pin";
    pin.title = t("field.pinned");
    pin.innerHTML = icon("pin", { size: 15 });
    marks.append(pin);
  }
  button.append(marks);

  // In selection mode a tap TICKS the row instead of opening it — the one
  // interaction that has to change, and the reason selection is a mode at all.
  button.addEventListener("click", () => {
    if (selecting) toggleSelected(item.id);
    else callbacks.onOpen(item.id);
  });
  surface.append(button);
  li.append(surface);
  return li;
}

function indicator(glyph, count) {
  const span = document.createElement("span");
  span.className = "record__indicator";
  span.innerHTML = icon(glyph, { size: 13 });
  span.append(document.createTextNode(String(count)));
  return span;
}

// ═══════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete with undo. The tombstone is written by onExpire, never up front.
 * Exported so the detail view can reuse exactly this path via app.js.
 */
export function deleteWithUndo(item, { onCommitted } = {}) {
  pendingDeletes.add(item.id);
  renderPage({ keepScroll: true });

  toast(t("toast.deleted", { title: item.title || t("detail.newRecord") }), "info", {
    actionLabel: t("action.undo"),
    onAction: () => {
      pendingDeletes.delete(item.id);
      renderPage({ keepScroll: true });
    },
    onExpire: async () => {
      // Only now does the record become a tombstone.
      pendingDeletes.delete(item.id);
      await softDeleteItem(item.id);
      await refreshList();
      onCommitted && onCommitted();
    },
  });
}

async function togglePin(id) {
  const item = await getItem(id);
  if (!item) return;
  item.pinned = !item.pinned;
  await putItem(item);
  toast(t(item.pinned ? "toast.pinned" : "toast.unpinned"), "success", { duration: 2000 });
  await refreshList();
}

async function openRowMenu(id) {
  if (state.locked) return;
  const item = await getItem(id);
  if (!item) return;
  const choice = await actionSheet({
    title: item.title || t("detail.newRecord"),
    items: [
      { id: "pin", label: t(item.pinned ? "field.unpin" : "field.pin"), icon: "pin" },
      { id: "delete", label: t("action.delete"), icon: "trash", danger: true },
    ],
  });
  if (choice === "pin") await togglePin(id);
  if (choice === "delete") deleteWithUndo(item);
}

// ═══════════════════════════════════════════════════════════════════════════
// Gestures (§9)
//
// ONE pointer handler on the list, not one per row. Rows are rebuilt on every
// render, so per-row listeners would accumulate with them (§13.11).
// ═══════════════════════════════════════════════════════════════════════════

const SWIPE_TRIGGER = 72; // px of travel before an action fires
const SWIPE_SLOP = 12; // px before we claim the gesture from the scroller

function bindRowInteraction() {
  let row = null;
  let surface = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let claimed = false;
  let longPress = null;

  const reset = () => {
    if (surface) {
      surface.style.transform = "";
      surface.classList.remove("record__surface--dragging");
    }
    if (row) delete row.dataset.swipe;
    row = null;
    surface = null;
    dx = 0;
    claimed = false;
    clearTimeout(longPress);
  };

  listEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target.closest(".record");
    if (!target) return;
    row = target;
    surface = row.querySelector(".record__surface");
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    claimed = false;

    clearTimeout(longPress);
    longPress = setTimeout(() => {
      if (claimed || !row) return;
      const id = row.dataset.id;
      reset();
      openRowMenu(id);
    }, 550);
  });

  listEl.addEventListener("pointermove", (e) => {
    if (!row) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // A mostly-vertical drag is a scroll; hand it back to the browser.
    if (!claimed && Math.abs(dy) > Math.abs(dx)) {
      reset();
      return;
    }
    if (!claimed && Math.abs(dx) < SWIPE_SLOP) return;

    claimed = true;
    clearTimeout(longPress);
    if (state.locked) return; // no destructive gesture while read-only
    surface.classList.add("record__surface--dragging");
    surface.style.transform = `translateX(${dx}px)`;
    row.dataset.swipe = dx < 0 ? "delete" : "pin";
  });

  const finish = async () => {
    if (!row) return;
    const id = row.dataset.id;
    const travelled = dx;
    const wasClaimed = claimed;
    reset();

    if (!wasClaimed || state.locked) return;
    if (travelled <= -SWIPE_TRIGGER) {
      const item = await getItem(id);
      if (item) deleteWithUndo(item);
    } else if (travelled >= SWIPE_TRIGGER) {
      await togglePin(id);
    }
  };

  listEl.addEventListener("pointerup", finish);
  listEl.addEventListener("pointercancel", reset);

  // Right-click reaches the same menu, so the action is not touch-only.
  listEl.addEventListener("contextmenu", (e) => {
    const target = e.target.closest(".record");
    if (!target || state.locked) return;
    e.preventDefault();
    openRowMenu(target.dataset.id);
  });
}

/**
 * Pull-to-refresh. Today it re-runs the query; in Phase 4 this is where
 * "Sync now" gets triggered from (§8.1).
 */
function bindPullToRefresh() {
  const view = $("view-list");
  const indicatorEl = $("pull-indicator");
  const THRESHOLD = 70;
  let startY = 0;
  let pulling = false;
  let distance = 0;

  view.addEventListener(
    "touchstart",
    (e) => {
      if (view.scrollTop > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      pulling = true;
      distance = 0;
    },
    { passive: true }
  );

  view.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      distance = e.touches[0].clientY - startY;
      if (distance <= 0) {
        pulling = false;
        indicatorEl.style.transform = "";
        return;
      }
      indicatorEl.style.transform = `translateY(${Math.min(distance, THRESHOLD + 20)}px)`;
      indicatorEl.classList.toggle("pull-indicator--ready", distance >= THRESHOLD);
    },
    { passive: true }
  );

  view.addEventListener("touchend", async () => {
    if (!pulling) return;
    const triggered = distance >= THRESHOLD;
    pulling = false;
    indicatorEl.style.transform = "";
    indicatorEl.classList.remove("pull-indicator--ready");
    if (triggered) {
      // Phase 4: this is the "Sync now" entry point from §8.1. It still
      // refreshes the list even when sync is off or skipped.
      indicatorEl.classList.add("pull-indicator--busy");
      try {
        await callbacks.onPullRefresh();
      } catch {
        /* sync reports its own failures through the activity log and a toast */
      }
      indicatorEl.classList.remove("pull-indicator--busy");
      await refreshList();
      toast(t("list.refreshed"), "success", { duration: 1800 });
    }
  });
}
