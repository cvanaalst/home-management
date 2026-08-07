/**
 * view-detail.js — viewing, editing and creating one record (BLUEPRINT §4, §9).
 *
 * The same form serves an existing record and a brand-new draft, so there is
 * exactly one place where a record is edited. view-add.js only picks the type
 * and hands a draft over through app.js; a view never imports another view.
 *
 * ── Two-speed persistence (§9), decided per field ──────────────────────────
 * Save-gated  : type, title, body, comment, tags, reminder date, reminder type.
 * Write-through: pin, links, attachments, linked items — they must survive
 *                backing out without saving, and attachments carry a blob.
 *
 * The deliberate edge case: add a link, rename the title, press Cancel → the
 * link stays, the rename is discarded. That is correct, and Help says so.
 *
 * A NEW draft is the one exception: nothing exists to write through to yet, so
 * every field including its blobs is held in memory until the first Save.
 *
 * ── The widget pattern (§9, §13.11) ────────────────────────────────────────
 * The whole form is built ONCE in initDetailView() and reset per open. Building
 * it per open silently accumulates listeners.
 */

import { state } from "./state.js";
import { t, tCount, typeLabel, eventTypeLabel } from "./i18n.js";
import { icon, eventIcon } from "./icons.js";
import {
  TYPES,
  makeId,
  makeRecord,
  getItem,
  putItem,
  getAllItems,
  putMedia,
  getMedia,
  deleteMedia,
  makeThumbnail,
  makeFullImage,
  normalizeUrl,
  reminderTypesInUse,
  FIELD_SUGGESTIONS,
  normalizeFields,
  RECURRENCE_UNITS,
  normalizeRecurrence,
  nextOccurrence,
  completeReminder,
  EVENT_TYPES,
  DEFAULT_EVENT_TYPE,
  getVersions,
  getMeta,
  setMeta,
  diffRecords,
  applyVersion,
  VERSION_KEEP,
  computeBacklinks,
} from "./db.js";
import {
  toast,
  confirmDialog,
  createTagInput,
  pickRecord,
  formatDate,
  formatDateTime,
  formatBytes,
  formatAmount,
  daysUntil,
  todayIso,
  reminderTone,
  reminderLabel,
  replaceExtension,
  openFileViewer,
} from "./ui.js";
import { renderMarkdown } from "./markdown.js";
import { buildIcs } from "./calendar.js";

/** Anything larger than this is refused rather than silently filling the quota. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

let callbacks = {
  onLogEvent: () => {},
  onChanged: () => {},
  onDelete: () => {},
  onSaved: () => {},
  onOpen: () => {},
  onPrint: () => {},
};

let root;
let tagWidget;
let el = {}; // every form element, looked up once

/** The record being edited. For a draft this is the only copy that exists. */
let current = null;
let isDraft = false;
let baseline = ""; // JSON of the save-gated fields as they were on open
let previewing = false;

/** Blobs for a draft's attachments, written to the media store on first Save. */
const pendingMedia = new Map();

/** Live object URLs backing the attachment links; revoked on repaint/close. */
const attachmentUrls = [];

// ═══════════════════════════════════════════════════════════════════════════
// Build the form — ONCE
// ═══════════════════════════════════════════════════════════════════════════

export function initDetailView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };
  root = $("detail-body");
  root.textContent = "";
  root.className = "view__body detail";

  root.append(buildHead(), buildEvent(), buildReminder(), buildFields(), buildTags());
  root.append(buildBody(), buildComment());
  root.append(buildLinks(), buildAttachments(), buildRelations(), buildHistory());
  root.append(buildVersions(), buildActions());

  tagWidget = createTagInput(el.tagHost, { onChange: markDirty });
  bindEvents();
}

/**
 * A panel that is always open. Title, then content.
 */
function section(titleKey, extraClass = "") {
  const wrap = document.createElement("section");
  wrap.className = `panel detail__section ${extraClass}`.trim();
  const heading = document.createElement("h2");
  heading.className = "panel__title";
  heading.dataset.i18n = titleKey;
  heading.textContent = t(titleKey);
  wrap.append(heading);
  return wrap;
}

/**
 * A panel that starts CLOSED, with a summary in its header.
 *
 * ── Why the form needed this ───────────────────────────────────────────────
 * Every phase added a panel and none was ever merged, so a record ran to
 * roughly three phone screens with eight sections open at once — and the Save
 * button sat at the bottom of all of it. Almost none of that is what you came
 * to look at: files, links, related items, the event history and the revision
 * list are things you consult occasionally and read constantly.
 *
 * Collapsing them costs nothing as long as the header still answers "is there
 * anything in here?". That is what `setSummary` is for — "Bestanden (2)" and
 * "Geschiedenis (3 · €263,50)" mean the panel never has to be opened just to
 * find out it is empty.
 *
 * Open/closed is remembered PER USER, not per record: someone who always wants
 * attachments visible wants that on every record, and re-deciding it for each
 * one would be the same nuisance in a different shape.
 */
function collapsible(titleKey, extraClass = "", { openByDefault = false } = {}) {
  const wrap = document.createElement("section");
  wrap.className = `panel detail__section detail__section--collapsible ${extraClass}`.trim();

  const header = document.createElement("button");
  header.type = "button";
  header.className = "panel__toggle";
  header.setAttribute("aria-expanded", String(openByDefault));

  const heading = document.createElement("span");
  heading.className = "panel__title";
  heading.dataset.i18n = titleKey;
  heading.textContent = t(titleKey);

  const summary = document.createElement("span");
  summary.className = "panel__summary";

  const chevron = document.createElement("span");
  chevron.className = "panel__chevron";
  chevron.innerHTML = icon("chevronDown", { size: 18 });

  header.append(heading, summary, chevron);

  const bodyEl = document.createElement("div");
  bodyEl.className = "panel__body";
  bodyEl.hidden = !openByDefault;

  header.addEventListener("click", () => {
    const opening = bodyEl.hidden;
    bodyEl.hidden = !opening;
    header.setAttribute("aria-expanded", String(opening));
    rememberPanel(titleKey, opening);
  });

  wrap.append(header, bodyEl);
  wrap.body = bodyEl;
  wrap.setSummary = (text) => {
    summary.textContent = text || "";
  };
  wrap.setOpen = (open) => {
    bodyEl.hidden = !open;
    header.setAttribute("aria-expanded", String(open));
  };
  wrap.isOpen = () => !bodyEl.hidden;
  return wrap;
}

/** Which panels the user has opened. Read once at boot, written on every toggle. */
const PANEL_STATE_KEY = "detail.openPanels";
let openPanels = null;

async function loadPanelState() {
  if (openPanels) return openPanels;
  openPanels = (await getMeta(PANEL_STATE_KEY, null)) || {};
  return openPanels;
}

function rememberPanel(key, open) {
  if (!openPanels) openPanels = {};
  openPanels[key] = open;
  setMeta(PANEL_STATE_KEY, openPanels);
}

function buildHead() {
  const head = document.createElement("div");
  head.className = "detail__head";

  el.typeBadge = document.createElement("span");
  el.typeBadge.className = "detail__type";

  el.type = document.createElement("select");
  el.type.className = "detail__type-select edit-only";
  el.type.setAttribute("aria-label", t("type.label"));

  el.pin = document.createElement("button");
  el.pin.type = "button";
  el.pin.className = "icon-btn detail__pin";

  // Printing is reading, not editing — deliberately NOT .edit-only, so it
  // works while the app is locked.
  el.print = document.createElement("button");
  el.print.type = "button";
  el.print.className = "icon-btn";
  el.print.dataset.i18nAria = "print.record";
  el.print.dataset.i18nTitle = "print.record";

  const titleRow = document.createElement("div");
  titleRow.className = "detail__title-row";

  el.title = document.createElement("input");
  el.title.type = "text";
  el.title.className = "detail__title";
  el.title.dataset.i18nPlaceholder = "field.title.placeholder";
  el.title.setAttribute("aria-label", t("field.title"));

  titleRow.append(el.title);

  el.stamps = document.createElement("p");
  el.stamps.className = "detail__stamps";

  const topRow = document.createElement("div");
  topRow.className = "detail__top";
  topRow.append(el.typeBadge, el.type, el.print, el.pin);

  head.append(topRow, titleRow, el.stamps);
  return head;
}

/**
 * The three fields only an event has (§5). Hidden outright on a record — an
 * empty "what happened" box on the boiler's own page would just be a question
 * nobody asked.
 */
function buildEvent() {
  const wrap = section("event.section", "detail__section--event");
  el.eventPanel = wrap;

  const row = document.createElement("div");
  row.className = "detail__grid detail__grid--event";

  const dateCell = document.createElement("div");
  dateCell.className = "detail__field";
  const dateLabel = document.createElement("span");
  dateLabel.className = "field__label";
  dateLabel.dataset.i18n = "event.occurredAt";
  el.occurredAt = document.createElement("input");
  el.occurredAt.type = "date";
  el.occurredAt.className = "input";
  el.occurredAt.setAttribute("aria-label", t("event.occurredAt"));
  dateCell.append(dateLabel, el.occurredAt);

  const typeCell = document.createElement("div");
  typeCell.className = "detail__field";
  const typeLabelEl = document.createElement("span");
  typeLabelEl.className = "field__label";
  typeLabelEl.dataset.i18n = "eventType.label";
  el.eventType = document.createElement("select");
  el.eventType.className = "input";
  el.eventType.setAttribute("aria-label", t("eventType.label"));
  typeCell.append(typeLabelEl, el.eventType);

  const amountCell = document.createElement("div");
  amountCell.className = "detail__field";
  const amountLabel = document.createElement("span");
  amountLabel.className = "field__label";
  amountLabel.dataset.i18n = "event.amount";
  el.amount = document.createElement("input");
  el.amount.type = "number";
  el.amount.step = "0.01";
  el.amount.className = "input";
  el.amount.dataset.i18nPlaceholder = "event.amount.placeholder";
  el.amount.setAttribute("aria-label", t("event.amount"));
  amountCell.append(amountLabel, el.amount);

  const hint = document.createElement("p");
  hint.className = "field__hint edit-only";
  hint.dataset.i18n = "event.hint";

  row.append(dateCell, typeCell, amountCell);
  wrap.append(row, hint);
  return wrap;
}

/**
 * What has happened to THIS record — the reverse of `linkedIds`, filtered to
 * events. Reading a router's page and seeing three outages since March is the
 * entire point of the event log; a chip row of titles would not carry the
 * dates, and dates are what makes a history worth having.
 */
function buildHistory() {
  const wrap = collapsible("history.section", "detail__section--history");
  el.historyPanel = wrap;

  el.historySummary = document.createElement("p");
  el.historySummary.className = "detail__history-summary";

  el.history = document.createElement("div");
  el.history.className = "timeline__list timeline__list--compact";

  el.historyAdd = document.createElement("button");
  el.historyAdd.type = "button";
  el.historyAdd.className = "btn btn--ghost edit-only";
  el.historyAdd.dataset.i18n = "history.add";

  wrap.body.append(el.historySummary, el.history, el.historyAdd);
  return wrap;
}

function buildReminder() {
  const wrap = collapsible("field.reminder", "detail__section--reminder");
  el.reminderPanel = wrap;
  const row = document.createElement("div");
  row.className = "detail__grid";

  el.reminderAt = document.createElement("input");
  el.reminderAt.type = "date";
  el.reminderAt.className = "input";
  el.reminderAt.setAttribute("aria-label", t("field.reminder.date"));

  el.reminderClear = document.createElement("button");
  el.reminderClear.type = "button";
  el.reminderClear.className = "icon-btn edit-only";
  el.reminderClear.dataset.i18nAria = "field.reminder.clear";
  el.reminderClear.dataset.i18nTitle = "field.reminder.clear";
  el.reminderClear.innerHTML = icon("close", { size: 18 });

  const dateCell = document.createElement("div");
  dateCell.className = "detail__cell";
  dateCell.append(el.reminderAt, el.reminderClear);

  el.reminderType = document.createElement("input");
  el.reminderType.type = "text";
  el.reminderType.className = "input";
  el.reminderType.setAttribute("list", "reminder-type-suggestions");
  el.reminderType.dataset.i18nPlaceholder = "field.reminderType.placeholder";
  el.reminderType.setAttribute("aria-label", t("field.reminderType"));

  el.reminderTypeList = document.createElement("datalist");
  el.reminderTypeList.id = "reminder-type-suggestions";

  const typeCell = document.createElement("div");
  typeCell.className = "detail__cell detail__cell--stack";
  const typeLabelEl = document.createElement("span");
  typeLabelEl.className = "field__label";
  typeLabelEl.dataset.i18n = "field.reminderType";
  typeCell.append(typeLabelEl, el.reminderType, el.reminderTypeList);

  // ── Recurrence ─────────────────────────────────────────────────────────
  // Two controls, not a rule builder: a unit and a count. Boiler service,
  // chimney sweep, insurance renewal and meter readings are all "every N of
  // something", and anything that genuinely is not fits a plain date.
  el.recurrence = document.createElement("select");
  el.recurrence.className = "input input--select";
  el.recurrence.setAttribute("aria-label", t("field.recurrence"));

  el.interval = document.createElement("input");
  el.interval.type = "number";
  el.interval.min = "1";
  el.interval.max = "99";
  el.interval.className = "input input--narrow";
  el.interval.setAttribute("aria-label", t("field.recurrence.interval"));

  const repeatCell = document.createElement("div");
  repeatCell.className = "detail__cell detail__cell--stack";
  const repeatLabel = document.createElement("span");
  repeatLabel.className = "field__label";
  repeatLabel.dataset.i18n = "field.recurrence";
  const repeatRow = document.createElement("div");
  repeatRow.className = "detail__row";
  repeatRow.append(el.recurrence, el.interval);
  repeatCell.append(repeatLabel, repeatRow);

  const hint = document.createElement("p");
  hint.className = "field__hint edit-only";
  hint.dataset.i18n = "field.reminderType.hint";

  el.reminderBadge = document.createElement("span");
  el.reminderBadge.className = "reminder";

  // "Done" is the whole point of recurrence: it advances the date AND writes
  // the maintenance event, so the timeline fills itself from work you were
  // going to do anyway rather than from a second round of typing.
  el.reminderDone = document.createElement("button");
  el.reminderDone.type = "button";
  el.reminderDone.className = "btn btn--primary btn--small edit-only";
  el.reminderDone.dataset.i18n = "field.reminder.done";

  el.recurrenceNext = document.createElement("p");
  el.recurrenceNext.className = "field__hint";

  row.append(dateCell, typeCell, repeatCell);
  wrap.body.append(row, hint, el.recurrenceNext);

  // The badge and "Done" sit OUTSIDE the collapsible body, in a strip under the
  // header. Both are things you act on at a glance — burying a two-word
  // "overdue" behind a tap, or the button that logs the maintenance event, is
  // exactly the friction this whole rework exists to remove.
  // "Add to calendar" sits next to Done, because the calendar is the only
  // place a reminder can reach you with the app closed.
  el.reminderIcs = document.createElement("button");
  el.reminderIcs.type = "button";
  el.reminderIcs.className = "icon-btn";
  el.reminderIcs.dataset.i18nAria = "reminder.toCalendar";
  el.reminderIcs.dataset.i18nTitle = "reminder.toCalendar";
  el.reminderIcs.innerHTML = icon("calendar", { size: 18 });

  el.reminderStrip = document.createElement("div");
  el.reminderStrip.className = "detail__reminder-strip";
  el.reminderStrip.append(el.reminderBadge, el.reminderIcs, el.reminderDone);
  wrap.insertBefore(el.reminderStrip, wrap.body);
  return wrap;
}

/**
 * Named fields — provider, customer number, serial, policy number.
 *
 * Open by default on a record that has any, because these ARE the record for
 * an account or a device: the thing you opened it to read. The suggestions
 * come from the type (see FIELD_SUGGESTIONS), which is how seven types get
 * seven sensible forms out of one mechanism.
 */
function buildFields() {
  const wrap = collapsible("field.fields");
  el.fieldsPanel = wrap;

  el.fields = document.createElement("div");
  el.fields.className = "fields";

  el.fieldsAdd = document.createElement("button");
  el.fieldsAdd.type = "button";
  el.fieldsAdd.className = "btn btn--ghost edit-only";
  el.fieldsAdd.dataset.i18n = "field.fields.add";

  el.fieldKeyList = document.createElement("datalist");
  el.fieldKeyList.id = "field-key-suggestions";

  wrap.body.append(el.fields, el.fieldsAdd, el.fieldKeyList);
  return wrap;
}

function buildTags() {
  const wrap = section("field.tags");
  el.tagHost = document.createElement("div");
  wrap.append(el.tagHost);
  return wrap;
}

function buildBody() {
  const wrap = section("field.body");

  const tabs = document.createElement("div");
  tabs.className = "segmented edit-only editor__tabs";
  el.tabWrite = document.createElement("button");
  el.tabWrite.type = "button";
  el.tabWrite.dataset.i18n = "editor.write";
  el.tabPreview = document.createElement("button");
  el.tabPreview.type = "button";
  el.tabPreview.dataset.i18n = "editor.preview";
  tabs.append(el.tabWrite, el.tabPreview);

  el.body = document.createElement("textarea");
  el.body.className = "input input--body edit-only";
  el.body.rows = 12;
  el.body.dataset.i18nPlaceholder = "field.body.placeholder";
  el.body.setAttribute("aria-label", t("field.body"));

  el.bodyPreview = document.createElement("div");
  el.bodyPreview.className = "markdown-body";

  wrap.append(tabs, el.body, el.bodyPreview);
  return wrap;
}

function buildComment() {
  const wrap = collapsible("field.comment");
  el.commentPanel = wrap;
  el.comment = document.createElement("textarea");
  el.comment.className = "input";
  el.comment.rows = 2;
  el.comment.dataset.i18nPlaceholder = "field.comment.placeholder";
  el.comment.setAttribute("aria-label", t("field.comment"));
  wrap.body.append(el.comment);
  return wrap;
}

function buildLinks() {
  const wrap = collapsible("field.links");
  el.linksPanel = wrap;
  el.links = document.createElement("div");
  el.links.className = "row-list";

  const row = document.createElement("div");
  row.className = "detail__grid edit-only";
  el.linkLabel = document.createElement("input");
  el.linkLabel.type = "text";
  el.linkLabel.className = "input";
  el.linkLabel.dataset.i18nPlaceholder = "field.links.label";
  el.linkLabel.setAttribute("aria-label", t("field.links.label"));
  el.linkUrl = document.createElement("input");
  el.linkUrl.type = "text";
  el.linkUrl.className = "input";
  el.linkUrl.inputMode = "url";
  el.linkUrl.dataset.i18nPlaceholder = "field.links.url";
  el.linkUrl.setAttribute("aria-label", t("field.links.url"));
  el.linkAdd = document.createElement("button");
  el.linkAdd.type = "button";
  el.linkAdd.className = "btn btn--ghost";
  el.linkAdd.dataset.i18n = "field.links.add";
  row.append(el.linkLabel, el.linkUrl, el.linkAdd);

  wrap.body.append(el.links, row);
  return wrap;
}

function buildAttachments() {
  const wrap = collapsible("field.attachments");
  el.attachmentsPanel = wrap;
  el.attachments = document.createElement("div");
  el.attachments.className = "row-list";

  el.fileInput = document.createElement("input");
  el.fileInput.type = "file";
  el.fileInput.multiple = true;
  el.fileInput.hidden = true;

  el.fileAdd = document.createElement("button");
  el.fileAdd.type = "button";
  el.fileAdd.className = "btn btn--ghost edit-only";
  el.fileAdd.dataset.i18n = "field.attachments.add";

  wrap.body.append(el.attachments, el.fileInput, el.fileAdd);
  return wrap;
}

function buildRelations() {
  const wrap = collapsible("field.linked");
  el.relationsPanel = wrap;
  el.linked = document.createElement("div");
  el.linked.className = "chip-set";

  el.linkedAdd = document.createElement("button");
  el.linkedAdd.type = "button";
  el.linkedAdd.className = "btn btn--ghost edit-only";
  el.linkedAdd.dataset.i18n = "field.linked.add";

  el.backlinksTitle = document.createElement("h2");
  el.backlinksTitle.className = "panel__title";
  el.backlinksTitle.dataset.i18n = "field.backlinks";
  el.backlinks = document.createElement("div");
  el.backlinks.className = "chip-set";

  wrap.body.append(el.linked, el.linkedAdd, el.backlinksTitle, el.backlinks);
  return wrap;
}

/**
 * The last few saves of this record, newest first.
 *
 * Local only and never synced (see versionKey in db.js): last-write-wins
 * discards the losing record whole, so history kept inside it would vanish
 * together with the edit you wanted it for.
 */
function buildVersions() {
  const wrap = collapsible("versions.section", "detail__section--versions");
  el.versionsPanel = wrap;

  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.textContent = t("versions.hint", { count: VERSION_KEEP });

  el.versions = document.createElement("div");
  el.versions.className = "version-list";

  wrap.body.append(hint, el.versions);
  return wrap;
}

function buildActions() {
  const bar = document.createElement("div");
  bar.className = "detail__actions edit-only";

  el.dirtyFlag = document.createElement("span");
  el.dirtyFlag.className = "detail__dirty";
  el.dirtyFlag.dataset.i18n = "detail.unsaved";

  el.delete = document.createElement("button");
  el.delete.type = "button";
  el.delete.className = "btn btn--ghost btn--danger-text";
  el.delete.dataset.i18n = "action.delete";

  el.save = document.createElement("button");
  el.save.type = "button";
  el.save.className = "btn btn--primary";
  el.save.dataset.i18n = "action.save";

  bar.append(el.dirtyFlag, el.delete, el.save);
  return bar;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

function bindEvents() {
  for (const field of [el.title, el.body, el.comment, el.reminderAt, el.reminderType,
                       el.occurredAt, el.amount]) {
    field.addEventListener("input", markDirty);
  }
  el.eventType.addEventListener("change", () => {
    paintEventBadge();
    markDirty();
  });
  el.type.addEventListener("change", () => {
    if (current) current.type = el.type.value;
    paintTypeBadge();
    paintFields(); // the suggestions belong to the type
    markDirty();
  });

  el.reminderClear.addEventListener("click", () => {
    el.reminderAt.value = "";
    el.reminderType.value = "";
    el.recurrence.value = "";
    paintReminderBadge();
    paintRecurrence();
    markDirty();
  });
  el.reminderAt.addEventListener("change", () => {
    paintReminderBadge();
    paintRecurrence();
  });
  el.recurrence.addEventListener("change", () => {
    paintRecurrence();
    markDirty();
  });
  el.interval.addEventListener("input", () => {
    paintRecurrence();
    markDirty();
  });
  el.reminderDone.addEventListener("click", markReminderDone);
  el.reminderIcs.addEventListener("click", downloadReminderIcs);

  el.tabWrite.addEventListener("click", () => setPreview(false));
  el.tabPreview.addEventListener("click", () => setPreview(true));

  el.linkAdd.addEventListener("click", addLink);
  el.linkUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addLink();
    }
  });

  el.fileAdd.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", onFilesPicked);

  el.fieldsAdd.addEventListener("click", () => {
    current.fields = [...current.fields, { id: makeId(), key: "", value: "" }];
    paintFields();
    markDirty();
    // Focus the key of the row just added; adding a row you then have to hunt
    // for is a worse experience than not having the button.
    const rows = el.fields.querySelectorAll(".field-row__key");
    if (rows.length) rows[rows.length - 1].focus();
  });

  el.linkedAdd.addEventListener("click", addRelation);
  el.historyAdd.addEventListener("click", () => callbacks.onLogEvent(current));
  el.pin.addEventListener("click", togglePin);
  el.print.addEventListener("click", () => callbacks.onPrint(current));
  el.save.addEventListener("click", save);
  const topSave = $("btn-topbar-save");
  if (topSave) topSave.addEventListener("click", save);
  el.delete.addEventListener("click", () => callbacks.onDelete(current));
}

// ═══════════════════════════════════════════════════════════════════════════
// Opening
// ═══════════════════════════════════════════════════════════════════════════

/** Open an existing record. Returns false if it is gone. */
export async function openRecord(id) {
  const item = await getItem(id);
  if (!item || item.deletedAt) {
    toast(t("detail.notFound"), "error");
    return false;
  }
  current = item;
  isDraft = false;
  pendingMedia.clear();
  await paint();
  return true;
}

/**
 * Open a brand-new unsaved record or event.
 *
 * `seed` carries everything the caller already knows: the kind, and for an
 * event logged from a record, the subject it is about and that subject's type.
 * An event inherits its subject's type on purpose — that is what keeps the
 * router's outage on the router's colour and inside the "devices" chip.
 */
export async function openDraft(type, seed = {}) {
  current = makeRecord({
    type,
    kind: seed.kind || "record",
    linkedIds: seed.linkedIds || [],
    occurredAt: seed.kind === "event" ? todayIso() : null,
    eventType: seed.eventType || (seed.kind === "event" ? "maintenance" : ""),
    title: seed.title || "",
    body: seed.body || "",
  });
  isDraft = true;
  pendingMedia.clear();

  // A pasted or opened file goes through the ordinary attach path, so it gets
  // the same size guard, thumbnail and pending-blob handling as one picked
  // from the file dialog. Nothing about a draft is special except that its
  // blobs wait in memory until the first Save.
  if (seed.url) current.links = [{ id: makeId(), label: "", url: normalizeUrl(seed.url) }];
  for (const file of seed.files || []) await attachFile(file);

  await paint();
  // A pasted record already has a title; the body is where the work continues.
  if (seed.title || seed.files?.length) el.body.focus();
  else el.title.focus();
  return true;
}

/** True when the open row is an event, which changes what the form shows. */
function isEvent() {
  return !!current && current.kind === "event";
}

/** Is there an unsaved change the user would lose by leaving? */
export function isDirty() {
  if (!current) return false;
  if (isDraft) return true; // a draft is unsaved by definition
  return snapshot() !== baseline;
}

export function currentRecord() {
  return current;
}

/**
 * Forget the open record without prompting. Used when the record is being
 * deleted, where asking "discard your unsaved changes?" would be absurd.
 */
export function hideTopbarSave() {
  const top = $("btn-topbar-save");
  if (top) top.hidden = true;
}

export function closeDetail() {
  hideTopbarSave();
  current = null;
  isDraft = false;
  pendingMedia.clear();
  releaseAttachmentUrls();
}

/**
 * Ask before discarding. Resolves true when it is safe to leave.
 *
 * Every path that returns true releases the attachment object URLs. This is
 * the ONLY place that reliably means "the user is leaving this record" —
 * hanging the cleanup off the delete path alone leaks one URL per attachment
 * on every ordinary visit, for the lifetime of the session.
 */
export async function confirmLeave() {
  if (!isDirty()) {
    releaseAttachmentUrls();
    return true;
  }
  if (isDraft && isBlankDraft()) {
    // Nothing typed — just go, but let go of the draft and its blobs.
    current = null;
    pendingMedia.clear();
    releaseAttachmentUrls();
    return true;
  }
  const ok = await confirmDialog(t("confirm.discard"), t("confirm.discard.ok"));
  if (ok) {
    current = null;
    pendingMedia.clear();
    releaseAttachmentUrls();
  }
  return ok;
}

function isBlankDraft() {
  return (
    !el.title.value.trim() &&
    !el.body.value.trim() &&
    !el.comment.value.trim() &&
    !tagWidget.getTags().length &&
    !current.links.length &&
    !current.attachments.length
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Painting
// ═══════════════════════════════════════════════════════════════════════════

async function paint() {
  el.type.innerHTML = TYPES.map(
    (type) => `<option value="${type}">${typeLabel(type)}</option>`
  ).join("");
  el.type.value = current.type;

  el.title.value = current.title;
  el.body.value = current.body;
  el.comment.value = current.comment;
  el.reminderAt.value = current.reminderAt || "";
  el.reminderType.value = current.reminderType || "";
  el.recurrence.innerHTML =
    `<option value="">${t("recurrence.none")}</option>` +
    RECURRENCE_UNITS.map((unit) => `<option value="${unit}">${t(`recurrence.${unit}`)}</option>`).join("");
  el.recurrence.value = current.recurrence ? current.recurrence.every : "";
  el.interval.value = current.recurrence ? String(current.recurrence.interval) : "1";

  el.occurredAt.value = current.occurredAt || "";
  el.amount.value = typeof current.amount === "number" ? String(current.amount) : "";
  el.eventType.innerHTML = EVENT_TYPES.map(
    (value) => `<option value="${value}">${eventTypeLabel(value)}</option>`
  ).join("");
  el.eventType.value = current.eventType || DEFAULT_EVENT_TYPE;
  paintFields();
  tagWidget.setTags(current.tags);

  const items = await getAllItems();
  tagWidget.setSuggestions([...new Set(items.flatMap((i) => (i.deletedAt ? [] : i.tags)))]);
  el.reminderTypeList.innerHTML = reminderTypesInUse(items)
    .map((entry) => `<option value="${escapeAttr(entry.value)}"></option>`)
    .join("");

  applyLockState();
  paintTypeBadge();
  paintStamps();
  paintReminderBadge();
  paintRecurrence();
  paintPin();
  paintLinks();
  await paintAttachments();
  paintRelations(items);
  paintEventPanels(items);
  await paintVersions();
  paintPanelSummaries(items);
  await applyPanelState();
  setPreview(state.locked);

  baseline = snapshot();
  paintDirty();
}

/**
 * Make the read-only lock real, not just visual.
 *
 * Hiding the Save button is not enough: a field the user can still type into
 * while the app says "Vergrendeld" invites them to write something that is then
 * silently thrown away. Text fields go readOnly (which keeps them selectable
 * and copyable — you still want to copy a contract number), while the date and
 * type controls go disabled, because readOnly does nothing on those.
 */
function applyLockState() {
  const locked = state.locked;
  for (const field of [el.title, el.body, el.comment, el.reminderType]) {
    field.readOnly = locked;
  }
  for (const input of el.fields.querySelectorAll("input")) input.readOnly = locked;
  el.amount.readOnly = locked;
  el.reminderAt.disabled = locked;
  el.recurrence.disabled = locked;
  el.interval.disabled = locked;
  el.occurredAt.disabled = locked;
  el.eventType.disabled = locked;
  el.type.disabled = locked;
  el.pin.disabled = locked;
  // el.print stays enabled: reading a record aloud on paper is not an edit.
}

function paintTypeBadge() {
  if (isEvent()) return paintEventBadge();
  const type = el.type.value || current.type;
  el.typeBadge.innerHTML = icon(`type-${type}`, { size: 18 });
  el.typeBadge.append(document.createTextNode(typeLabel(type)));
  el.typeBadge.style.color = `var(--type-${type})`;
}

function paintStamps() {
  el.stamps.textContent = isDraft
    ? t("detail.newRecord")
    : `${t("field.created")} ${formatDate(current.createdAt, state.lang)} · ` +
      `${t("field.updated")} ${formatDateTime(current.updatedAt, state.lang)}`;
}

function paintReminderBadge() {
  const value = el.reminderAt.value;
  if (el.reminderPanel && el.reminderPanel.setSummary) {
    const rule = readRecurrence();
    el.reminderPanel.setSummary(
      value
        ? [formatDate(value, state.lang), rule ? t(`recurrence.${rule.every}`).toLowerCase() : ""]
            .filter(Boolean)
            .join(" · ")
        : t("panel.empty")
    );
  }
  if (el.reminderStrip) el.reminderStrip.hidden = !value;
  if (!value) {
    el.reminderBadge.hidden = true;
    return;
  }
  const days = daysUntil(value, todayIso());
  el.reminderBadge.hidden = false;
  el.reminderBadge.className = `reminder reminder--${reminderTone(days)}`;
  el.reminderBadge.innerHTML = icon("bell", { size: 14 });
  el.reminderBadge.append(document.createTextNode(reminderLabel(days)));
}

/** The recurrence controls as a rule, or null. */
function readRecurrence() {
  if (!el.recurrence.value) return null;
  return normalizeRecurrence({ every: el.recurrence.value, interval: Number(el.interval.value) });
}

/**
 * Show the interval box only when something repeats, preview the next date,
 * and offer "Done" only when there is a reminder to finish.
 */
function paintRecurrence() {
  const hasDate = !!el.reminderAt.value;
  const rule = readRecurrence();

  el.recurrence.parentElement.parentElement.hidden = !hasDate;
  el.interval.hidden = !rule;
  el.reminderDone.hidden = !hasDate || isEvent();

  if (!hasDate || !rule) {
    el.recurrenceNext.hidden = true;
    return;
  }

  // Show where "Done" would land. Recurrence is the one field whose effect is
  // invisible until months later, so stating it up front is the difference
  // between a rule someone trusts and one they re-check every time.
  //
  // Through completeReminder(), not nextOccurrence() directly, so the preview
  // and the button can never disagree about a job done early.
  const { reminderAt: next } = completeReminder(
    { reminderAt: el.reminderAt.value, recurrence: rule },
    todayIso()
  );
  el.recurrenceNext.hidden = !next;
  if (next) {
    el.recurrenceNext.textContent = t("recurrence.next", {
      date: formatDate(next, state.lang),
    });
  }
}

/**
 * Mark a reminder done: advance it, and write the event that proves it happened.
 *
 * The event is the reason this button exists. A timeline nobody fills is worth
 * nothing, and this is the one moment where the user is already telling the app
 * that maintenance occurred — so it is the one place the record can be created
 * without asking for anything extra.
 */
async function markReminderDone() {
  if (!current || isDraft || state.locked) return;
  const dateWas = el.reminderAt.value;
  if (!dateWas) return;

  const rule = readRecurrence();
  const today = todayIso();
  const { reminderAt, recurred } = completeReminder(
    { reminderAt: dateWas, recurrence: rule },
    today
  );

  try {
    const event = makeRecord({
      kind: "event",
      type: current.type,
      eventType: "maintenance",
      // The reminder type is what the user already called this job — "jaarlijks
      // onderhoud" — so it makes a better title than anything invented here.
      title: current.reminderType.trim() || current.title || t("field.reminder"),
      occurredAt: today,
      linkedIds: [current.id],
      body: t("recurrence.loggedFrom", { title: current.title || "" }).trim(),
    });
    await putItem(event);

    current.reminderAt = reminderAt;
    current.recurrence = reminderAt ? rule : null;
    const saved = await putItem(current);
    current = saved;

    el.reminderAt.value = reminderAt || "";
    if (!reminderAt) el.recurrence.value = "";
    baseline = snapshot();
    paintStamps();
    paintReminderBadge();
    paintRecurrence();
    paintDirty();
    await paintEventPanels(await getAllItems());
    await paintVersions();

    toast(
      recurred
        ? t("recurrence.doneNext", { date: formatDate(reminderAt, state.lang) })
        : t("recurrence.doneOnce"),
      "success",
      { duration: 2600 }
    );
    callbacks.onChanged();
  } catch {
    toast(t("error.saveFailed"), "error");
  }
}

function paintPin() {
  el.print.innerHTML = icon("print", { size: 19 });
  el.pin.innerHTML = icon("pin", { size: 20 });
  el.pin.classList.toggle("is-active", !!current.pinned);
  const label = t(current.pinned ? "field.unpin" : "field.pin");
  el.pin.setAttribute("aria-label", label);
  el.pin.title = label;
  el.pin.setAttribute("aria-pressed", String(!!current.pinned));
}

function setPreview(on) {
  previewing = on || state.locked;
  el.body.hidden = previewing;
  el.bodyPreview.hidden = !previewing;
  el.tabWrite.setAttribute("aria-pressed", String(!previewing));
  el.tabPreview.setAttribute("aria-pressed", String(previewing));
  if (previewing) {
    const source = el.body.value.trim();
    // renderMarkdown escapes its input, so this assignment is safe by design.
    el.bodyPreview.innerHTML = source
      ? renderMarkdown(source)
      : `<p class="muted">${t("detail.noBody")}</p>`;
  }
}

function paintLinks() {
  el.links.textContent = "";
  if (!current.links.length) {
    el.links.append(emptyLine("detail.noLinks"));
    return;
  }
  for (const link of current.links) {
    const row = document.createElement("div");
    row.className = "row-list__row";

    const glyph = document.createElement("span");
    glyph.className = "row-list__icon";
    glyph.innerHTML = icon("link", { size: 16 });

    const anchor = document.createElement("a");
    anchor.className = "row-list__label";
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = link.label || link.url;
    anchor.title = link.url;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn edit-only";
    remove.setAttribute("aria-label", t("field.links.remove"));
    remove.innerHTML = icon("close", { size: 16 });
    remove.addEventListener("click", () => removeLink(link.id));

    row.append(glyph, anchor, remove);
    el.links.append(row);
  }
}

/**
 * Render the attachment list.
 *
 * Two controls per file, because they fail in different places:
 *   • the filename opens the IN-APP viewer. Nothing here depends on opening a
 *     tab, which is what kept breaking: window.open is a popup and is blocked,
 *     and a target="_blank" link to a blob: URL silently does nothing in
 *     several browsers even though the same link's `download` works.
 *   • the ↓ button is a real <a download>, one click, and works everywhere.
 *
 * The blob URL for the download is created here at render time; the viewer
 * makes its own. Both are revoked when the record is left.
 */
async function paintAttachments() {
  releaseAttachmentUrls();
  el.attachments.textContent = "";
  if (!current.attachments.length) {
    el.attachments.append(emptyLine("detail.noAttachments"));
    return;
  }

  for (const file of current.attachments) {
    const row = document.createElement("div");
    row.className = "row-list__row";

    const glyph = document.createElement("span");
    glyph.className = "row-list__icon";
    glyph.innerHTML = icon("paperclip", { size: 16 });

    const media = pendingMedia.get(file.mediaId) || (await getMedia(file.mediaId));
    const row_children = [glyph];

    if (media && media.blob) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "row-list__label row-list__label--button";
      open.textContent = file.filename;
      open.title = t("field.attachments.view");
      open.addEventListener("click", () =>
        openFileViewer({ filename: file.filename, mimeType: file.mimeType, blob: media.blob })
      );

      const size = document.createElement("span");
      size.className = "row-list__meta";
      size.textContent = formatBytes(file.size || 0, state.lang);

      const url = URL.createObjectURL(media.blob);
      attachmentUrls.push(url);
      const download = document.createElement("a");
      download.className = "icon-btn";
      download.href = url;
      download.download = file.filename;
      download.title = t("field.attachments.download");
      download.setAttribute("aria-label", t("field.attachments.download"));
      download.innerHTML = icon("download", { size: 16 });

      row_children.push(open, size, download);
    } else {
      // The blob is missing (purged, or not yet synced down). Say so rather
      // than offering controls that go nowhere.
      const label = document.createElement("span");
      label.className = "row-list__label row-list__label--muted";
      label.textContent = file.filename;
      const missing = document.createElement("span");
      missing.className = "row-list__meta";
      missing.textContent = t("error.fileMissing");
      row_children.push(label, missing);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn edit-only";
    remove.setAttribute("aria-label", t("field.attachments.remove"));
    remove.innerHTML = icon("close", { size: 16 });
    remove.addEventListener("click", () => removeAttachment(file));
    row_children.push(remove);

    row.append(...row_children);
    el.attachments.append(row);
  }
}

/** Object URLs are a leak until revoked; drop the previous batch on repaint. */
function releaseAttachmentUrls() {
  for (const url of attachmentUrls) URL.revokeObjectURL(url);
  attachmentUrls.length = 0;
}

function paintRelations(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  el.linked.textContent = "";
  if (!current.linkedIds.length) {
    el.linked.append(emptyLine("detail.noLinked"));
  }
  for (const id of current.linkedIds) {
    const target = byId.get(id);
    if (!target || target.deletedAt) continue;
    el.linked.append(
      relationChip(target, () => {
        current.linkedIds = current.linkedIds.filter((x) => x !== id);
        persistRelations();
      })
    );
  }

  // Events that point here are NOT chips — they belong to the history panel
  // below, which can show their dates. Listing them in both places would show
  // the same thing twice, once stripped of the only detail that matters.
  const backlinks = computeBacklinks(items, current.id).filter((i) => i.kind !== "event");
  el.backlinksTitle.hidden = backlinks.length === 0;
  el.backlinks.hidden = backlinks.length === 0;
  el.backlinks.textContent = "";
  for (const source of backlinks) el.backlinks.append(relationChip(source, null));
}

/**
 * Show or hide the two event panels, and fill the history one.
 *
 * The event fields appear only on an event; the history appears only on a
 * saved record — a draft has no id yet, so nothing can point at it, and
 * offering "log an event" before the subject exists would produce an orphan.
 */
function paintEventPanels(items) {
  const event = isEvent();
  el.eventPanel.hidden = !event;
  paintEventBadge();

  // An event is a thing that already happened, so a reminder on it is a
  // contradiction — reminders belong on the record it points at. URL links go
  // for the same reason: an event is a fact, not a place to file references.
  //
  // "Linked items" deliberately STAYS: it holds the link back to the subject,
  // which is what makes the event findable from the boiler's own page.
  el.reminderPanel.hidden = event;
  el.linksPanel.hidden = event;

  el.historyPanel.hidden = event || isDraft;
  if (el.historyPanel.hidden) return;

  const history = computeBacklinks(items, current.id)
    .filter((i) => i.kind === "event")
    .sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")));

  el.history.textContent = "";
  if (!history.length) {
    el.history.append(emptyLine("history.empty"));
    el.historySummary.hidden = true;
    el.historyPanel.setSummary(t("panel.empty"));
    return;
  }

  const spent = history
    .filter((e) => typeof e.amount === "number")
    .reduce((sum, e) => sum + e.amount, 0);
  const hasAmounts = history.some((e) => typeof e.amount === "number");

  el.historyPanel.setSummary(
    hasAmounts
      ? `(${history.length} · ${formatAmount(spent, state.lang)})`
      : `(${history.length})`
  );
  el.historySummary.hidden = false;
  el.historySummary.textContent = hasAmounts
    ? `${tCount("history.count", history.length)} · ${t("history.total", { amount: formatAmount(spent, state.lang) })}`
    : tCount("history.count", history.length);

  for (const entry of history) el.history.append(historyRow(entry));
}

function historyRow(entry) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "timeline__row";
  row.style.setProperty("--event-colour", `var(--event-${entry.eventType})`);
  row.addEventListener("click", () => callbacks.onOpen(entry.id));

  const glyph = document.createElement("span");
  glyph.className = "timeline__icon";
  glyph.innerHTML = icon(eventIcon(entry.eventType), { size: 18 });

  const text = document.createElement("span");
  text.className = "timeline__text";
  const head = document.createElement("span");
  head.className = "timeline__title";
  head.textContent = entry.title || t("timeline.untitled");
  const meta = document.createElement("span");
  meta.className = "timeline__meta";
  meta.textContent = [
    entry.occurredAt ? formatDate(entry.occurredAt, state.lang) : t("timeline.undated"),
    eventTypeLabel(entry.eventType),
  ].join(" · ");
  text.append(head, meta);
  row.append(glyph, text);

  if (typeof entry.amount === "number") {
    const amount = document.createElement("span");
    amount.className = "timeline__amount";
    amount.textContent = formatAmount(entry.amount, state.lang);
    row.append(amount);
  }
  return row;
}

/**
 * Fill the revision list.
 *
 * Hidden on a draft — a record that has never been saved has no past — and on
 * anything with no revisions yet, rather than showing an empty panel that
 * invites the question "is this broken?".
 */
async function paintVersions() {
  if (!el.versionsPanel) return;
  if (isDraft || !current) {
    el.versionsPanel.hidden = true;
    return;
  }

  const versions = await getVersions(current.id);
  el.versionsPanel.hidden = versions.length === 0;
  el.versionsPanel.setSummary(`(${versions.length})`);
  if (!versions.length) return;

  el.versions.textContent = "";
  for (const entry of versions) el.versions.append(versionRow(entry));
}

function versionRow(entry) {
  const row = document.createElement("div");
  row.className = "version";

  const text = document.createElement("div");
  text.className = "version__text";

  const when = document.createElement("span");
  when.className = "version__when";
  when.textContent = formatDateTime(entry.at, state.lang);

  const changed = diffRecords(entry.record, current);
  const summary = document.createElement("span");
  summary.className = "version__summary";
  summary.textContent = changed.length
    ? t("versions.changed", { fields: changed.map((f) => t(`versions.field.${f}`)).join(", ") })
    : t("versions.identical");

  text.append(when, summary);
  row.append(text);

  // Nothing to restore when a revision matches what is already on screen, and
  // offering a button that provably does nothing is worse than offering none.
  if (changed.length) {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn btn--ghost btn--small edit-only";
    restore.textContent = t("versions.restore");
    restore.addEventListener("click", () => restoreVersion(entry));
    row.append(restore);
  }
  return row;
}

/**
 * Put a past revision back.
 *
 * An ordinary edit under the SAME id, not the trash's restore-under-a-new-id:
 * the record never stopped existing, and giving it a new identity would orphan
 * every event and link pointing at it. The current state is snapshotted on the
 * way past by putItem, so restoring is itself undoable.
 */
async function restoreVersion(entry) {
  if (!current || state.locked) return;
  const changed = diffRecords(entry.record, current);
  const ok = await confirmDialog(
    t("versions.restore.confirm", {
      when: formatDateTime(entry.at, state.lang),
      fields: changed.map((f) => t(`versions.field.${f}`)).join(", "),
    }),
    t("versions.restore")
  );
  if (!ok) return;

  try {
    const saved = await putItem(applyVersion(current, entry.record));
    current = saved;
    await paint();
    toast(t("versions.restored"), "success", { duration: 2400 });
    callbacks.onChanged();
  } catch {
    toast(t("error.saveFailed"), "error");
  }
}

/**
 * Fill every collapsed header with the one fact that decides whether it is
 * worth opening. A count alone is enough for most; history earns its total,
 * because "3 · €263,50" is a different decision from "3".
 */
function paintPanelSummaries(items) {
  const count = (n) => (n ? `(${n})` : t("panel.empty"));

  el.fieldsPanel.setSummary(count(current.fields.length));
  el.commentPanel.setSummary(current.comment.trim() ? t("panel.filled") : t("panel.empty"));
  el.linksPanel.setSummary(count((current.links || []).length));
  el.attachmentsPanel.setSummary(count((current.attachments || []).length));

  const related = computeBacklinks(items, current.id).filter((i) => i.kind !== "event").length +
    (current.linkedIds || []).length;
  el.relationsPanel.setSummary(count(related));
}

/** Restore each panel to the state this user last left it in. */
async function applyPanelState() {
  const stored = await loadPanelState();
  for (const [key, panel] of [
    ["field.fields", el.fieldsPanel],
    ["field.comment", el.commentPanel],
    ["field.links", el.linksPanel],
    ["field.attachments", el.attachmentsPanel],
    ["field.linked", el.relationsPanel],
    ["field.reminder", el.reminderPanel],
    ["history.section", el.historyPanel],
    ["versions.section", el.versionsPanel],
  ]) {
    if (panel && typeof panel.setOpen === "function") panel.setOpen(!!stored[key]);
  }
}

/** This one reminder as a calendar entry, recurrence and all. */
function downloadReminderIcs() {
  if (!current || !el.reminderAt.value) return;
  const text = buildIcs([
    {
      ...current,
      reminderAt: el.reminderAt.value,
      reminderType: el.reminderType.value,
      recurrence: readRecurrence(),
    },
  ]);
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  // A filename the calendar app will show while importing, so it is obvious
  // which reminder is being added.
  anchor.download = `${(current.title || "herinnering").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60)}.ics`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(t("reminder.toCalendar.done"), "success", { duration: 2400 });
}

/**
 * Draw the field rows.
 *
 * Save-gated like the title and body, not write-through like links: these are
 * content the user is typing, and half a customer number committed the moment
 * they tab away is not a favour.
 */
function paintFields() {
  el.fields.textContent = "";

  // Suggestions follow the TYPE currently chosen in the form, not the stored
  // one — changing an item to "Devices" should immediately offer a serial.
  const type = el.type.value || current.type;
  el.fieldKeyList.innerHTML = (FIELD_SUGGESTIONS[type] || [])
    .map((key) => `<option value="${escapeAttr(t(`fields.suggest.${key}`))}"></option>`)
    .join("");

  if (!current.fields.length) {
    el.fields.append(emptyLine("field.fields.none"));
    return;
  }
  for (const field of current.fields) el.fields.append(fieldRow(field));
}

function fieldRow(field) {
  const row = document.createElement("div");
  row.className = "field-row";

  const key = document.createElement("input");
  key.type = "text";
  key.className = "input field-row__key";
  key.value = field.key;
  key.setAttribute("list", "field-key-suggestions");
  key.setAttribute("aria-label", t("field.fields.key"));
  key.addEventListener("input", () => {
    field.key = key.value;
    markDirty();
  });

  const value = document.createElement("input");
  value.type = "text";
  // Monospace: these are reference numbers, read a character at a time and
  // usually compared against something on paper.
  value.className = "input field-row__value";
  value.value = field.value;
  value.setAttribute("aria-label", t("field.fields.value"));
  value.addEventListener("input", () => {
    field.value = value.value;
    markDirty();
  });

  // The whole point of the panel. A contract number exists to be pasted
  // somewhere else, and selecting it by hand on a phone is genuinely painful.
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "icon-btn field-row__copy";
  copy.dataset.i18nAria = "action.copy";
  copy.dataset.i18nTitle = "action.copy";
  copy.innerHTML = icon("copy", { size: 16 });
  copy.addEventListener("click", () => copyValue(field.value, copy));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn field-row__remove edit-only";
  remove.dataset.i18nAria = "field.fields.remove";
  remove.dataset.i18nTitle = "field.fields.remove";
  remove.innerHTML = icon("close", { size: 16 });
  remove.addEventListener("click", () => {
    current.fields = current.fields.filter((f) => f.id !== field.id);
    paintFields();
    markDirty();
  });

  row.append(key, value, copy, remove);
  return row;
}

/**
 * Copy to the clipboard, with the button itself as the confirmation.
 *
 * A toast for something this small would be louder than the action; a tick on
 * the button says it landed and gets out of the way.
 */
async function copyValue(text, button) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Safari refuses the API outside a trusted gesture in some contexts, and
    // an insecure origin has no clipboard at all. Fall back rather than fail.
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    try {
      document.execCommand("copy");
    } catch {
      toast(t("action.copy.failed"), "error");
      helper.remove();
      return;
    }
    helper.remove();
  }
  button.classList.add("is-copied");
  button.innerHTML = icon("check", { size: 16 });
  setTimeout(() => {
    button.classList.remove("is-copied");
    button.innerHTML = icon("copy", { size: 16 });
  }, 1400);
}

/** An event shows what happened where a record shows its type. */
function paintEventBadge() {
  if (!isEvent()) return;
  const eventType = el.eventType.value || current.eventType || DEFAULT_EVENT_TYPE;
  el.typeBadge.innerHTML = icon(eventIcon(eventType), { size: 18 });
  el.typeBadge.append(document.createTextNode(eventTypeLabel(eventType)));
  el.typeBadge.style.color = `var(--event-${eventType})`;
}

function relationChip(record, onRemove) {
  const chip = document.createElement("span");
  chip.className = "chip chip--record";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "chip__open";
  open.innerHTML = icon(`type-${record.type}`, { size: 14 });
  open.style.color = `var(--type-${record.type})`;
  open.append(document.createTextNode(record.title || t("detail.newRecord")));
  open.addEventListener("click", () => callbacks.onOpen(record.id));
  chip.append(open);

  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag__remove edit-only";
    remove.setAttribute("aria-label", t("field.linked.remove"));
    remove.innerHTML = icon("close", { size: 12 });
    remove.addEventListener("click", onRemove);
    chip.append(remove);
  }
  return chip;
}

function emptyLine(key) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = t(key);
  return p;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ═══════════════════════════════════════════════════════════════════════════
// Dirty tracking — save-gated fields only
// ═══════════════════════════════════════════════════════════════════════════

function snapshot() {
  return JSON.stringify({
    type: el.type.value,
    title: el.title.value,
    body: el.body.value,
    comment: el.comment.value,
    reminderAt: el.reminderAt.value,
    reminderType: el.reminderType.value,
    recurrence: el.recurrence.value,
    interval: el.recurrence.value ? el.interval.value : "",
    occurredAt: el.occurredAt.value,
    eventType: el.eventType.value,
    amount: el.amount.value,
    tags: tagWidget.getTags(),
    fields: current ? current.fields.map((f) => `${f.key}=${f.value}`).join("|") : "",
  });
}

function markDirty() {
  paintDirty();
}

function paintDirty() {
  const dirty = isDirty();
  el.dirtyFlag.hidden = !dirty;
  el.save.disabled = !dirty;

  // Mirrored into the toolbar so Save is reachable without scrolling past
  // every panel on the record. Shown only when there is something to save —
  // a permanently disabled button in the chrome is just noise.
  const top = $("btn-topbar-save");
  if (top) top.hidden = !dirty || state.locked;
}

// ═══════════════════════════════════════════════════════════════════════════
// Write-through fields
// ═══════════════════════════════════════════════════════════════════════════

/** Persist a write-through change. A draft has nothing to write to yet. */
async function persistNow() {
  if (isDraft) {
    paintDirty();
    return;
  }
  await putItem(current);
  paintStamps();
  callbacks.onChanged();
}

async function togglePin() {
  current.pinned = !current.pinned;
  paintPin();
  await persistNow();
  toast(t(current.pinned ? "toast.pinned" : "toast.unpinned"), "success", { duration: 1800 });
}

async function addLink() {
  const label = el.linkLabel.value.trim();
  const raw = el.linkUrl.value.trim();
  if (!label || !raw) {
    toast(t("error.linkIncomplete"), "error");
    return;
  }
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url) && !/^mailto:|^tel:/i.test(url)) {
    toast(t("error.linkInvalid"), "error");
    return;
  }
  current.links = [...current.links, { id: makeId(), label, url }];
  el.linkLabel.value = "";
  el.linkUrl.value = "";
  paintLinks();
  await persistNow();
  toast(t("toast.linkAdded"), "success", { duration: 1800 });
}

async function removeLink(id) {
  current.links = current.links.filter((link) => link.id !== id);
  paintLinks();
  await persistNow();
  toast(t("toast.linkRemoved"), "info", { duration: 1800 });
}

async function onFilesPicked(event) {
  const files = [...(event.target.files || [])];
  event.target.value = ""; // so the same file can be chosen again
  for (const file of files) await attachFile(file);
}

async function attachFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    toast(t("error.fileTooBig", { limit: formatBytes(MAX_FILE_BYTES, state.lang) }), "error");
    return;
  }
  try {
    const mediaId = makeId();
    // Oversized images are bounded so a phone photo is not stored at 12 MP.
    // Rescaling always yields JPEG, so the recorded type and extension have to
    // follow — otherwise the download is JPEG bytes behind a ".png" name.
    const resized = await makeFullImage(file);
    const blob = resized || file;
    const mimeType = resized ? "image/jpeg" : file.type || "application/octet-stream";
    const filename = resized ? replaceExtension(file.name, "jpg") : file.name;
    const thumbnailBlob = await makeThumbnail(file);

    if (isDraft) pendingMedia.set(mediaId, { blob, thumbnailBlob });
    else await putMedia({ id: mediaId, blob, thumbnailBlob });

    current.attachments = [
      ...current.attachments,
      { mediaId, filename, mimeType, size: blob.size },
    ];
    await paintAttachments();
    await persistNow();
    toast(t("toast.attachmentAdded"), "success", { duration: 1800 });
  } catch {
    toast(t("error.fileFailed"), "error");
  }
}

async function removeAttachment(file) {
  current.attachments = current.attachments.filter((a) => a.mediaId !== file.mediaId);
  if (pendingMedia.has(file.mediaId)) pendingMedia.delete(file.mediaId);
  else await deleteMedia(file.mediaId);
  await paintAttachments();
  await persistNow();
  toast(t("toast.attachmentRemoved"), "info", { duration: 1800 });
}

async function addRelation() {
  const items = await getAllItems();
  const choices = items
    .filter((i) => !i.deletedAt && i.id !== current.id && !current.linkedIds.includes(i.id))
    .map((i) => ({ id: i.id, title: i.title, type: i.type }));
  const chosen = await pickRecord(choices);
  if (!chosen) return;
  current.linkedIds = [...current.linkedIds, chosen];
  await persistRelations();
}

async function persistRelations() {
  paintRelations(await getAllItems());
  await persistNow();
}

// ═══════════════════════════════════════════════════════════════════════════
// Saving
// ═══════════════════════════════════════════════════════════════════════════

async function save() {
  if (!current) return;
  const title = el.title.value.trim();
  if (!title) {
    toast(t("error.titleRequired"), "error");
    el.title.focus();
    return;
  }

  current.type = el.type.value;
  current.title = title;
  current.body = el.body.value;
  current.comment = el.comment.value.trim();
  current.reminderAt = el.reminderAt.value || null;
  // A reminder type without a date is meaningless, so it goes with it.
  current.reminderType = current.reminderAt ? el.reminderType.value.trim() : "";
  // A rule with no date to anchor it can never fire, so it goes with the date.
  current.recurrence = current.reminderAt ? readRecurrence() : null;
  if (isEvent()) {
    current.occurredAt = el.occurredAt.value || null;
    current.eventType = el.eventType.value;
    current.amount = el.amount.value === "" ? null : Number(el.amount.value);
  }
  current.fields = normalizeFields(current.fields);
  current.tags = tagWidget.getTags();

  try {
    // A draft's blobs have been waiting in memory; commit them with the record
    // so an abandoned draft never leaves an orphan in the media store.
    if (isDraft) {
      for (const [id, media] of pendingMedia) await putMedia({ id, ...media });
      pendingMedia.clear();
    }
    const saved = await putItem(current);
    current = saved;
    const wasDraft = isDraft;
    isDraft = false;
    baseline = snapshot();
    paintStamps();
    paintDirty();
    // The save just created a revision, so the panel below is now out of date.
    // Every other write path goes through paint(); this one deliberately does
    // not, to avoid rebuilding the form under the user's cursor.
    await paintVersions();
    if (state.locked) setPreview(true);
    toast(t(wasDraft ? "toast.created" : "toast.saved"), "success", { duration: 2000 });
    callbacks.onChanged();
    callbacks.onSaved(saved, wasDraft);
  } catch {
    toast(t("error.saveFailed"), "error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Language switch
// ═══════════════════════════════════════════════════════════════════════════

export function refreshDetailLanguage() {
  if (!current) return;
  tagWidget.refresh();
  paint();
}
