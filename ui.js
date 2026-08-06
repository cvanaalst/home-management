/**
 * ui.js — toasts, dialogs, focus trap, formatters (BLUEPRINT §9).
 *
 * Everything here is shared chrome. It knows nothing about records, storage or
 * sync — views hand it strings and callbacks.
 *
 * The formatters at the bottom are pure and are unit-tested in tests.html.
 */

import { t, tCount } from "./i18n.js";
import { icon } from "./icons.js";

// ═══════════════════════════════════════════════════════════════════════════
// Escaping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Escape a string for interpolation into HTML text or a double-quoted attribute.
 * PURE. Anything user-supplied that reaches innerHTML must pass through here.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ═══════════════════════════════════════════════════════════════════════════
// Toasts — the undo mechanism for reversible destructive actions (§9)
// ═══════════════════════════════════════════════════════════════════════════

const TOAST_MS = 6000;
let activeToast = null;

/**
 * Show a toast.
 *
 * A toast with an action is the ONLY pattern used for reversible destruction —
 * never a confirm dialog. `onExpire` fires when the undo window closes without
 * the user acting, which is where the real deletion is committed.
 *
 * @param {string} message      already translated
 * @param {"info"|"success"|"error"} [kind]
 * @param {{actionLabel?:string, onAction?:Function, onExpire?:Function,
 *          duration?:number}} [opts]
 *   `duration: 0` means the toast never expires on its own — for a prompt the
 *   user must actually answer, like "a new version is ready". Anything that
 *   auto-dismisses is a message; anything that waits is a question.
 */
export function toast(message, kind = "info", opts = {}) {
  dismissToast(true); // an older toast's expiry must still run

  const host = document.getElementById("toast-host");
  if (!host) return;

  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");

  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;
  el.append(text);

  let expired = false;
  const finish = (runExpire) => {
    if (expired) return;
    expired = true;
    clearTimeout(timer);
    el.classList.add("toast--leaving");
    setTimeout(() => el.remove(), 200);
    if (activeToast && activeToast.el === el) activeToast = null;
    if (runExpire && opts.onExpire) opts.onExpire();
  };

  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast__action";
    btn.textContent = opts.actionLabel;
    btn.addEventListener("click", () => {
      finish(false); // the user undid it — the expiry work must NOT run
      opts.onAction();
    });
    el.append(btn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", t("nav.close"));
  close.innerHTML = icon("close", { size: 16 });
  close.addEventListener("click", () => finish(true));
  el.append(close);

  host.append(el);
  // An explicit 0 must survive: `opts.duration || TOAST_MS` would treat it as
  // "unset" and quietly dismiss a prompt that was meant to persist.
  const duration = opts.duration === 0 ? 0 : opts.duration || TOAST_MS;
  const timer = duration > 0 ? setTimeout(() => finish(true), duration) : null;
  activeToast = { el, finish };
}

/** Close the current toast. `runExpire` decides whether its onExpire still runs. */
export function dismissToast(runExpire = true) {
  if (activeToast) activeToast.finish(runExpire);
}

// ═══════════════════════════════════════════════════════════════════════════
// Focus trap
// ═══════════════════════════════════════════════════════════════════════════

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside `container` until the returned function is called.
 * Restores focus to whatever was focused beforehand.
 */
export function trapFocus(container) {
  const previous = document.activeElement;

  const onKeydown = (e) => {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", onKeydown);
  const firstItem = container.querySelector(FOCUSABLE);
  if (firstItem) firstItem.focus();

  return () => {
    container.removeEventListener("keydown", onKeydown);
    if (previous && previous.focus) previous.focus();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Dialogs — for IRREVERSIBLE actions only (§9)
// ═══════════════════════════════════════════════════════════════════════════

function buildDialog({ message, okLabel, cancelLabel, danger }) {
  const host = document.getElementById("dialog-host");
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";

  const box = document.createElement("div");
  box.className = "dialog";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");

  const body = document.createElement("p");
  body.className = "dialog__message";
  body.textContent = message;
  box.append(body);

  const row = document.createElement("div");
  row.className = "dialog__actions";

  let cancelBtn = null;
  if (cancelLabel) {
    cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost";
    cancelBtn.textContent = cancelLabel;
    row.append(cancelBtn);
  }

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = `btn ${danger ? "btn--danger" : "btn--primary"}`;
  okBtn.textContent = okLabel;
  row.append(okBtn);

  box.append(row);
  overlay.append(box);
  host.append(overlay);

  return { overlay, box, okBtn, cancelBtn };
}

/** Promise<boolean>. Use ONLY where the action cannot be undone. */
export function confirmDialog(message, okLabel, { danger = true } = {}) {
  return new Promise((resolve) => {
    const { overlay, box, okBtn, cancelBtn } = buildDialog({
      message,
      okLabel: okLabel || t("action.confirm"),
      cancelLabel: t("action.cancel"),
      danger,
    });
    const release = trapFocus(box);

    const done = (result) => {
      document.removeEventListener("keydown", onEsc, true);
      release();
      overlay.remove();
      resolve(result);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    };

    okBtn.addEventListener("click", () => done(true));
    cancelBtn.addEventListener("click", () => done(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
    document.addEventListener("keydown", onEsc, true);
  });
}

/** Promise<void>. A message the user must acknowledge. */
export function alertDialog(message, okLabel) {
  return new Promise((resolve) => {
    const { overlay, box, okBtn } = buildDialog({
      message,
      okLabel: okLabel || t("action.ok"),
      cancelLabel: null,
      danger: false,
    });
    const release = trapFocus(box);

    const done = () => {
      document.removeEventListener("keydown", onEsc, true);
      release();
      overlay.remove();
      resolve();
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done();
      }
    };

    okBtn.addEventListener("click", done);
    document.addEventListener("keydown", onEsc, true);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatters — PURE, unit-tested in tests.html
// ═══════════════════════════════════════════════════════════════════════════

const LOCALE = { nl: "nl-BE", en: "en-GB" };

/** "4 aug 2026" / "4 Aug 2026". Returns "" for empty or unparseable input. */
export function formatDate(iso, lang = "nl") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE[lang] || LOCALE.nl, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "4 aug 2026, 19:07". Returns "" for empty or unparseable input. */
export function formatDateTime(iso, lang = "nl") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(LOCALE[lang] || LOCALE.nl, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "augustus 2026" / "August 2026", from a "YYYY-MM" or "YYYY-MM-DD" string.
 * Returns "" for empty or unparseable input.
 *
 * Built from an explicit UTC midnight rather than `new Date("2026-08")`, which
 * some engines read as a local time that can slip into the previous month for
 * anyone east of Greenwich.
 */
export function formatMonth(value, lang = "nl") {
  const month = String(value || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE[lang] || LOCALE.nl, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "€ 340,50" / "€340.50". Returns "" for anything that is not a finite number.
 *
 * The currency is fixed to EUR rather than made a setting: this app is for one
 * household, and a per-record currency invites totals that silently add euros
 * to pounds. If that ever needs to change it should change with an explicit
 * conversion story, not a dropdown.
 */
export function formatAmount(value, lang = "nl") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value.toLocaleString(LOCALE[lang] || LOCALE.nl, {
    style: "currency",
    currency: "EUR",
  });
}

/**
 * Whole days from `todayIso` to `dateIso`, both "YYYY-MM-DD".
 * Negative = overdue, 0 = today. PURE, and deliberately date-only: comparing
 * timestamps makes "due today" flip at an arbitrary hour.
 * Returns null when either date is missing or malformed.
 */
export function daysUntil(dateIso, todayIso) {
  if (!dateIso || !todayIso) return null;
  const a = Date.parse(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(todayIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/** Today as "YYYY-MM-DD" in LOCAL time — never toISOString(), which is UTC. */
export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * How this file can be shown INSIDE the app. PURE.
 *
 * Returns "image" | "pdf" | "text" | "none".
 *
 * Note what is deliberately NOT rendered: text/html goes to "text" so it is
 * shown as source rather than executed. A blob: URL inherits this app's
 * origin, so framing an HTML attachment would run its scripts with full access
 * to our IndexedDB. SVG is safe as "image" because <img> never runs script.
 */
export function previewKind(mimeType) {
  const type = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (!type) return "none";
  if (type === "text/html" || type === "application/xhtml+xml") return "text";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml") {
    return "text";
  }
  return "none";
}

/** Can this file be shown at all, or is downloading the only option? PURE. */
export function isPreviewable(mimeType) {
  return previewKind(mimeType) !== "none";
}

/** Swap a filename's extension, keeping any dots in the stem. PURE. */
export function replaceExtension(filename, extension) {
  const name = String(filename || "").trim() || "bestand";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
}

/**
 * Which visual register a reminder belongs in, from the day count. PURE.
 * Separated from the label so the thresholds are testable without i18n.
 */
export function reminderTone(days) {
  if (days === null || days === undefined) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "soon";
  return "later";
}

/** Translated reminder text, e.g. "3 dagen te laat" / "In 5 days". */
export function reminderLabel(days) {
  const tone = reminderTone(days);
  if (tone === "none") return "";
  if (tone === "today") return t("reminder.today");
  if (tone === "overdue") return tCount("reminder.overdue", days);
  return tCount("reminder.days", days);
}

/** "1,4 MB" / "1.4 MB". Byte counts for the storage panel. PURE. */
export function formatBytes(bytes, lang = "nl") {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString(LOCALE[lang] || LOCALE.nl)} ${units[i]}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Action sheet — the long-press / right-click menu on a list row (§9 gestures)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show a list of actions. Resolves with the chosen action's id, or null.
 * @param {{title?:string, items:{id:string,label:string,icon?:string,danger?:boolean}[]}} config
 */
export function actionSheet({ title = "", items = [] } = {}) {
  return new Promise((resolve) => {
    const host = document.getElementById("dialog-host");
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay dialog-overlay--sheet";

    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title || t("action.more"));

    if (title) {
      const heading = document.createElement("p");
      heading.className = "sheet__title";
      heading.textContent = title;
      sheet.append(heading);
    }

    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sheet__item${item.danger ? " sheet__item--danger" : ""}`;
      if (item.icon) {
        const glyph = document.createElement("span");
        glyph.className = "sheet__icon";
        glyph.innerHTML = icon(item.icon, { size: 20 });
        button.append(glyph);
      }
      const label = document.createElement("span");
      label.textContent = item.label;
      button.append(label);
      button.addEventListener("click", () => done(item.id));
      sheet.append(button);
    }

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "sheet__item sheet__item--cancel";
    cancel.textContent = t("action.cancel");
    cancel.addEventListener("click", () => done(null));
    sheet.append(cancel);

    overlay.append(sheet);
    host.append(overlay);
    const release = trapFocus(sheet);

    function done(result) {
      document.removeEventListener("keydown", onEsc, true);
      release();
      overlay.remove();
      resolve(result);
    }
    function onEsc(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener("keydown", onEsc, true);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Record picker — choosing a record to link to (linkedIds)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search-and-pick over a list of records. Resolves with the chosen id or null.
 * @param {{id:string,title:string,type:string}[]} records  already excludes self
 */
export function pickRecord(records = []) {
  return new Promise((resolve) => {
    const host = document.getElementById("dialog-host");
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";

    const box = document.createElement("div");
    box.className = "dialog dialog--picker";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", t("picker.title"));

    const search = document.createElement("input");
    search.type = "search";
    search.className = "search-field__input";
    search.placeholder = t("picker.search");
    box.append(search);

    const list = document.createElement("div");
    list.className = "picker__list";
    box.append(list);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--ghost";
    cancel.textContent = t("action.cancel");
    cancel.addEventListener("click", () => done(null));
    const actions = document.createElement("div");
    actions.className = "dialog__actions";
    actions.append(cancel);
    box.append(actions);

    function paint() {
      const term = search.value.trim().toLowerCase();
      const matches = records.filter(
        (r) => !term || String(r.title || "").toLowerCase().includes(term)
      );
      list.textContent = "";
      if (!matches.length) {
        const empty = document.createElement("p");
        empty.className = "picker__empty";
        empty.textContent = t("picker.empty");
        list.append(empty);
        return;
      }
      for (const record of matches.slice(0, 50)) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "picker__row";
        const glyph = document.createElement("span");
        glyph.className = "picker__icon";
        glyph.style.color = `var(--type-${record.type})`;
        glyph.innerHTML = icon(`type-${record.type}`, { size: 18 });
        const label = document.createElement("span");
        label.textContent = record.title || t("detail.newRecord");
        row.append(glyph, label);
        row.addEventListener("click", () => done(record.id));
        list.append(row);
      }
    }

    search.addEventListener("input", paint);
    paint();

    overlay.append(box);
    host.append(overlay);
    const release = trapFocus(box);

    function done(result) {
      document.removeEventListener("keydown", onEsc, true);
      release();
      overlay.remove();
      resolve(result);
    }
    function onEsc(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener("keydown", onEsc, true);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tag input — THE widget-pattern example (§9, §13.11)
//
// Created ONCE at view init and reset with setTags() on every open. Building it
// per open silently accumulates listeners, which is a recurring bug class in
// this kind of codebase.
// ═══════════════════════════════════════════════════════════════════════════

export function createTagInput(container, { onChange } = {}) {
  container.classList.add("tag-input");
  container.textContent = "";

  const chips = document.createElement("div");
  chips.className = "tag-input__chips";

  const row = document.createElement("div");
  row.className = "tag-input__row edit-only";

  const field = document.createElement("input");
  field.type = "text";
  field.className = "tag-input__field";
  field.autocomplete = "off";
  field.setAttribute("list", "tag-suggestions");

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn--ghost btn--small";

  const datalist = document.createElement("datalist");
  datalist.id = "tag-suggestions";

  row.append(field, addButton);
  container.append(chips, row, datalist);

  let tags = [];
  let suggestions = [];

  const emit = () => onChange && onChange([...tags]);

  function paint() {
    field.placeholder = t("field.tags.placeholder");
    addButton.textContent = t("field.tags.add");
    chips.textContent = "";
    if (!tags.length) {
      const empty = document.createElement("span");
      empty.className = "tag-input__empty read-only-only";
      empty.textContent = t("detail.noTags");
      chips.append(empty);
    }
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.append(document.createTextNode(tag));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tag__remove edit-only";
      remove.setAttribute("aria-label", t("field.tags.remove", { tag }));
      remove.innerHTML = icon("close", { size: 12 });
      remove.addEventListener("click", () => {
        tags = tags.filter((x) => x !== tag);
        paint();
        emit();
      });
      chip.append(remove);
      chips.append(chip);
    }
    datalist.textContent = "";
    for (const value of suggestions) {
      if (tags.includes(value)) continue;
      const option = document.createElement("option");
      option.value = value;
      datalist.append(option);
    }
  }

  /**
   * @param {boolean} refocus  keep the caret here for the next tag.
   *   MUST be false when called from blur: focusing on the way out drags focus
   *   back from whatever the user just clicked, so their next keystrokes land
   *   in this field instead of the field they aimed at.
   */
  function add(refocus) {
    const value = field.value.trim();
    if (!value) return;
    // Compare case-insensitively but keep what the user typed.
    if (!tags.some((x) => x.toLowerCase() === value.toLowerCase())) {
      tags.push(value);
      emit();
    }
    field.value = "";
    paint();
    if (refocus) field.focus();
  }

  addButton.addEventListener("click", () => add(true));
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(true);
    } else if (e.key === "Backspace" && !field.value && tags.length) {
      tags.pop();
      paint();
      emit();
    }
  });
  // A pending tag the user typed but never confirmed is harvested on blur
  // rather than silently dropped (§13.10) — but without stealing focus back.
  field.addEventListener("blur", () => {
    if (field.value.trim()) add(false);
  });

  return {
    setTags(next) {
      tags = Array.isArray(next) ? [...next] : [];
      field.value = "";
      paint();
    },
    getTags: () => [...tags],
    setSuggestions(next) {
      suggestions = Array.isArray(next) ? [...next] : [];
      paint();
    },
    /** Re-render translated strings after a language switch. */
    refresh: paint,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// File viewer — showing an attachment INSIDE the app
//
// Why not just open a tab? Because it does not work, in two separate ways:
//   • window.open() is a popup and gets blocked; opening it after awaiting the
//     blob loses user activation, so that is blocked too (§13.4).
//   • A link with target="_blank" to a blob: URL silently does nothing in
//     several browsers — the download attribute is honoured, navigation is not.
//   • And on an installed iOS PWA a new tab lands in Safari, which has separate
//     storage and looks like a brand-new empty install (§13.3).
//
// Rendering in place sidesteps all three. Every viewer still offers a real
// download link, which is the one thing that works everywhere.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Show one attachment. Resolves when the viewer is closed.
 * @param {{filename:string, mimeType:string, blob:Blob}} file
 */
export function openFileViewer({ filename, mimeType, blob }) {
  return new Promise((resolve) => {
    const host = document.getElementById("dialog-host");
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";

    const box = document.createElement("div");
    box.className = "dialog viewer";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", filename);

    // ── header ────────────────────────────────────────────────────────────
    const head = document.createElement("div");
    head.className = "viewer__head";
    const name = document.createElement("p");
    name.className = "viewer__name";
    name.textContent = filename;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn";
    close.setAttribute("aria-label", t("nav.close"));
    close.innerHTML = icon("close", { size: 20 });
    close.addEventListener("click", () => done());
    head.append(name, close);

    // ── body ──────────────────────────────────────────────────────────────
    const body = document.createElement("div");
    const url = URL.createObjectURL(blob);
    let kind = previewKind(mimeType);

    // A browser that reports no PDF viewer (iOS Safari, several mobile
    // browsers) renders an <iframe> of a PDF as a blank rectangle with no
    // explanation. Ask first, and offer the download instead of a black box.
    // The property is undefined on older browsers — there, still try.
    if (kind === "pdf" && navigator.pdfViewerEnabled === false) kind = "none";

    body.className = `viewer__body viewer__body--${kind}`;
    let note = null;

    if (kind === "image") {
      const img = document.createElement("img");
      img.className = "viewer__image";
      img.alt = filename;
      img.src = url;
      body.append(img);
    } else if (kind === "pdf") {
      const frame = document.createElement("iframe");
      frame.className = "viewer__frame";
      frame.title = filename;
      frame.src = url;
      body.append(frame);
      // Even where a viewer exists it can decline to render inside a frame, and
      // the result is an empty rectangle. Keep the hint OUTSIDE the scrolling
      // body so it cannot be clipped away.
      note = document.createElement("p");
      note.className = "viewer__note";
      note.textContent = t("viewer.pdfHint");
    } else if (kind === "text") {
      const pre = document.createElement("pre");
      pre.className = "viewer__text";
      // textContent, never innerHTML: an attached .html file is shown as
      // source and never gets to run.
      pre.textContent = t("status.loading");
      blob
        .text()
        .then((text) => {
          pre.textContent = text.slice(0, 200000);
        })
        .catch(() => {
          pre.textContent = t("error.fileFailed");
        });
      body.append(pre);
    } else {
      const message = document.createElement("p");
      message.className = "viewer__note";
      message.textContent = t("viewer.cannotPreview");
      body.append(message);
    }

    // ── footer: the escape hatch that works in every browser ──────────────
    const actions = document.createElement("div");
    actions.className = "dialog__actions";
    const download = document.createElement("a");
    download.className = "btn btn--primary";
    download.href = url;
    download.download = filename;
    download.textContent = t("viewer.download");
    actions.append(download);

    box.append(head, body);
    if (note) box.append(note);
    box.append(actions);
    overlay.append(box);
    host.append(overlay);
    const release = trapFocus(box);

    function done() {
      document.removeEventListener("keydown", onEsc, true);
      release();
      overlay.remove();
      // Give a download that was just started time to take the bytes.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      resolve();
    }
    function onEsc(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        done();
      }
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done();
    });
    document.addEventListener("keydown", onEsc, true);
  });
}
