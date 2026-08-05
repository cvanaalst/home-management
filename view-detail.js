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
import { t, typeLabel } from "./i18n.js";
import { icon } from "./icons.js";
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
  daysUntil,
  todayIso,
  reminderTone,
  reminderLabel,
  replaceExtension,
  openFileViewer,
} from "./ui.js";
import { renderMarkdown } from "./markdown.js";

/** Anything larger than this is refused rather than silently filling the quota. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

let callbacks = {
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

  root.append(buildHead(), buildReminder(), buildTags(), buildBody(), buildComment());
  root.append(buildLinks(), buildAttachments(), buildRelations(), buildActions());

  tagWidget = createTagInput(el.tagHost, { onChange: markDirty });
  bindEvents();
}

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

function buildReminder() {
  const wrap = section("field.reminder");
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

  const hint = document.createElement("p");
  hint.className = "field__hint edit-only";
  hint.dataset.i18n = "field.reminderType.hint";

  el.reminderBadge = document.createElement("span");
  el.reminderBadge.className = "reminder";

  row.append(dateCell, typeCell);
  wrap.append(el.reminderBadge, row, hint);
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
  const wrap = section("field.comment");
  el.comment = document.createElement("textarea");
  el.comment.className = "input";
  el.comment.rows = 2;
  el.comment.dataset.i18nPlaceholder = "field.comment.placeholder";
  el.comment.setAttribute("aria-label", t("field.comment"));
  wrap.append(el.comment);
  return wrap;
}

function buildLinks() {
  const wrap = section("field.links");
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

  wrap.append(el.links, row);
  return wrap;
}

function buildAttachments() {
  const wrap = section("field.attachments");
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

  wrap.append(el.attachments, el.fileInput, el.fileAdd);
  return wrap;
}

function buildRelations() {
  const wrap = section("field.linked");
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

  wrap.append(el.linked, el.linkedAdd, el.backlinksTitle, el.backlinks);
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
  for (const field of [el.title, el.body, el.comment, el.reminderAt, el.reminderType]) {
    field.addEventListener("input", markDirty);
  }
  el.type.addEventListener("change", () => {
    if (current) current.type = el.type.value;
    paintTypeBadge();
    markDirty();
  });

  el.reminderClear.addEventListener("click", () => {
    el.reminderAt.value = "";
    el.reminderType.value = "";
    paintReminderBadge();
    markDirty();
  });
  el.reminderAt.addEventListener("change", paintReminderBadge);

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

  el.linkedAdd.addEventListener("click", addRelation);
  el.pin.addEventListener("click", togglePin);
  el.print.addEventListener("click", () => callbacks.onPrint(current));
  el.save.addEventListener("click", save);
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

/** Open a brand-new unsaved record of the given type. */
export async function openDraft(type) {
  current = makeRecord({ type });
  isDraft = true;
  pendingMedia.clear();
  await paint();
  el.title.focus();
  return true;
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
export function closeDetail() {
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
  paintPin();
  paintLinks();
  await paintAttachments();
  paintRelations(items);
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
  el.reminderAt.disabled = locked;
  el.type.disabled = locked;
  el.pin.disabled = locked;
  // el.print stays enabled: reading a record aloud on paper is not an edit.
}

function paintTypeBadge() {
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
    el.linked.append(emptyLine("detail.noTags", ""));
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

  const backlinks = computeBacklinks(items, current.id);
  el.backlinksTitle.hidden = backlinks.length === 0;
  el.backlinks.hidden = backlinks.length === 0;
  el.backlinks.textContent = "";
  for (const source of backlinks) el.backlinks.append(relationChip(source, null));
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
    tags: tagWidget.getTags(),
  });
}

function markDirty() {
  paintDirty();
}

function paintDirty() {
  const dirty = isDirty();
  el.dirtyFlag.hidden = !dirty;
  el.save.disabled = !dirty;
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
