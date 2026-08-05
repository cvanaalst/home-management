/**
 * view-settings.js — the platform layer (BLUEPRINT §4, §8).
 *
 * Owns everything behind the Settings tab: appearance, storage figures, the
 * JSON/CSV exports, the print overview, and rendering the Help document.
 * Never imports another view module; navigation is a callback from app.js.
 */

import {
  state,
  setLang,
  setTheme,
  setDensity,
  setLocked,
} from "./state.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { versionLine, VERSION } from "./version.js";
import { getAllItems, getAllMediaIds, getStorageEstimate, requestPersistentStorage } from "./db.js";
import { toast, formatBytes, formatDateTime, todayIso } from "./ui.js";
import { toJsonExport, toCsv, buildPrintHtml, exportFilename } from "./report.js";
import { renderMarkdown } from "./markdown.js";
import { helpText } from "./help.js";
import { TYPES } from "./db.js";
import {
  getSyncState,
  getClientId,
  setClientId,
  isSyncEnabled,
  setSyncEnabled,
  syncNow,
  backupNow,
  listBackups,
  restoreBackup,
  importJson,
  signOut,
  onSyncStatus,
  redirectUri,
  javascriptOrigin,
} from "./sync.js";
import { confirmDialog, trapFocus } from "./ui.js";

const $ = (id) => document.getElementById(id);

let callbacks = { onNavigate: () => {}, onPreferenceChange: () => {}, onSynced: () => {} };

/** Persisted only for this session — it is a print option, not a preference. */
let includeBodyInPrint = true;

export function initSettingsView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };

  $("theme-choice").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-value]");
    if (!btn) return;
    setTheme(btn.dataset.themeValue);
    paintSettings();
    callbacks.onPreferenceChange("theme");
  });

  $("density-choice").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-density-value]");
    if (!btn) return;
    setDensity(btn.dataset.densityValue);
    paintSettings();
    callbacks.onPreferenceChange("density");
  });

  $("lang-choice").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lang-value]");
    if (!btn) return;
    setLang(btn.dataset.langValue);
    callbacks.onPreferenceChange("lang");
  });

  $("lock-choice").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lock-value]");
    if (!btn) return;
    setLocked(btn.dataset.lockValue === "true");
    callbacks.onPreferenceChange("locked");
  });

  document.querySelectorAll("#settings-links [data-goto]").forEach((row) => {
    row.addEventListener("click", () => callbacks.onNavigate(row.dataset.goto));
  });

  bindSync();
  $("btn-storage-refresh").addEventListener("click", paintStorage);
  $("btn-export-json").addEventListener("click", exportJson);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-print-overview").addEventListener("click", printOverview);
  $("print-include-body").addEventListener("change", (e) => {
    includeBodyInPrint = e.target.checked;
  });
  $("print-include-body").checked = includeBodyInPrint;
}

// ═══════════════════════════════════════════════════════════════════════════
// Appearance + about
// ═══════════════════════════════════════════════════════════════════════════

/** Reflect the current preferences onto the segmented controls. */
export function paintSettings() {
  const mark = (containerId, attr, value) => {
    document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[attr] === value));
    });
  };
  mark("theme-choice", "themeValue", state.theme);
  mark("density-choice", "densityValue", state.density);
  mark("lang-choice", "langValue", state.lang);
  mark("lock-choice", "lockValue", String(state.locked));
  $("about-version").textContent = versionLine();
}

// ═══════════════════════════════════════════════════════════════════════════
// Sync (§7, §8.1–8.3)
// ═══════════════════════════════════════════════════════════════════════════

let syncBusy = false;

function bindSync() {
  $("btn-sync-save-id").addEventListener("click", async () => {
    await setClientId($("sync-client-id").value);
    toast(t("sync.clientId.saved"), "success");
    await paintSync();
  });

  $("sync-enabled").addEventListener("change", async (e) => {
    await setSyncEnabled(e.target.checked);
  });

  $("btn-sync-now").addEventListener("click", async () => {
    if (!(await requireClientId())) return;
    const result = await syncNow({ interactive: true });
    if (result && result.skipped === "offline") toast(t("sync.offline"), "info");
    await paintSync();
    callbacks.onSynced();
  });

  $("btn-sync-backup").addEventListener("click", async () => {
    if (!(await requireClientId())) return;
    const result = await backupNow();
    if (result && result.ok) toast(t("sync.backupDone", { name: result.name }), "success");
    await paintSync();
  });

  $("btn-sync-restore").addEventListener("click", openRestoreDialog);

  $("btn-sync-signout").addEventListener("click", async () => {
    await signOut();
    toast(t("sync.signedOut"), "info", { duration: 1800 });
    await paintSync();
  });

  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", onImportFile);

  // The status events drive the badge from wherever a sync was started (§8.1).
  onSyncStatus((status, detail) => {
    syncBusy = status === "syncing";
    paintSyncBadge(status);
    if (status === "success" && detail) toast(t("sync.done", { detail }), "success");
    if (status === "error") toast(t("sync.failed", { detail }), "error");
  });
}

async function requireClientId() {
  if (await getClientId()) return true;
  toast(t("sync.notConfigured"), "error");
  $("sync-client-id").focus();
  return false;
}

function paintSyncBadge(status) {
  const badge = $("sync-status-badge");
  if (!badge) return;
  const key =
    status === "syncing" ? "sync.status.syncing" : badge.dataset.restKey || "sync.status.off";
  badge.textContent = t(key);
  badge.classList.toggle("badge--ok", key === "sync.status.ready");
  badge.classList.toggle("badge--warn", key !== "sync.status.ready" && key !== "sync.status.syncing");
}

export async function paintSync() {
  const stateNow = await getSyncState();
  const badge = $("sync-status-badge");
  const key = !stateNow.configured
    ? "sync.status.off"
    : stateNow.signedIn
    ? "sync.status.ready"
    : "sync.status.signedOut";
  badge.dataset.restKey = key;
  paintSyncBadge(syncBusy ? "syncing" : "idle");

  $("sync-last").textContent = stateNow.lastSyncAt
    ? t("sync.lastAt", { when: formatDateTime(stateNow.lastSyncAt, state.lang) })
    : t("sync.never");

  const field = $("sync-client-id");
  if (document.activeElement !== field) field.value = await getClientId();
  $("sync-origin").textContent = t("sync.clientId.origin", { origin: javascriptOrigin() });
  $("sync-redirect-uri").textContent = t("sync.clientId.redirect", { uri: redirectUri() });
  $("sync-enabled").checked = await isSyncEnabled();
}

async function onImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const mode = await chooseRestoreMode();
  if (!mode) return;
  try {
    const result = await importJson(await file.text(), mode);
    if (result.error) {
      toast(t("sync.import.failed"), "error");
      return;
    }
    toast(t("sync.import.done", { count: result.count }), "success");
    callbacks.onSynced();
  } catch {
    toast(t("sync.import.failed"), "error");
  }
}

/** Merge or replace? Resolves with the mode, or null when cancelled (§8.3). */
function chooseRestoreMode() {
  return new Promise((resolve) => {
    const host = document.getElementById("dialog-host");
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    const box = document.createElement("div");
    box.className = "dialog";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const heading = document.createElement("p");
    heading.className = "dialog__message";
    heading.textContent = t("restore.title");

    const mergeHint = document.createElement("p");
    mergeHint.className = "field__hint";
    mergeHint.textContent = t("restore.merge.hint");
    const replaceHint = document.createElement("p");
    replaceHint.className = "field__hint";
    replaceHint.textContent = t("restore.replace.hint");

    const actions = document.createElement("div");
    actions.className = "dialog__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--ghost";
    cancel.textContent = t("action.cancel");
    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "btn btn--primary";
    merge.textContent = t("restore.merge");
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "btn btn--danger";
    replace.textContent = t("restore.replace");
    actions.append(cancel, merge, replace);

    box.append(heading, mergeHint, replaceHint, actions);
    overlay.append(box);
    host.append(overlay);
    const release = trapFocus(box);

    const done = (value) => {
      document.removeEventListener("keydown", onEsc, true);
      release();
      overlay.remove();
      resolve(value);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    };
    cancel.addEventListener("click", () => done(null));
    merge.addEventListener("click", () => done("merge"));

    // Replace throws away everything on this device, so it gets a confirm
    // dialog while merge does not (§9). The confirm stacks ON TOP of this
    // dialog — answering "no" must leave the user back on this choice, not
    // dumped out of the flow, so nothing is resolved until it comes back.
    replace.addEventListener("click", async () => {
      replace.disabled = true;
      const ok = await confirmDialog(t("restore.replace.confirm"), t("restore.replace"));
      replace.disabled = false;
      if (ok) done("replace");
      else replace.focus();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    document.addEventListener("keydown", onEsc, true);
  });
}

async function openRestoreDialog() {
  if (!(await requireClientId())) return;
  const backups = await listBackups();
  if (backups === null) return; // a sign-in redirect is under way
  if (!backups.length) {
    toast(t("restore.empty"), "info");
    return;
  }

  const host = document.getElementById("dialog-host");
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  const box = document.createElement("div");
  box.className = "dialog dialog--picker";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  const heading = document.createElement("p");
  heading.className = "dialog__message";
  heading.textContent = t("restore.title");

  const list = document.createElement("div");
  list.className = "picker__list";
  for (const file of backups) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "picker__row";
    const glyph = document.createElement("span");
    glyph.className = "picker__icon";
    glyph.innerHTML = icon("database", { size: 18 });
    const label = document.createElement("span");
    label.textContent = file.name.replace(/^backup-/, "").replace(/\.json$/, "").replace(/-/g, ":").slice(0, 19);
    row.append(glyph, label);
    row.addEventListener("click", async () => {
      close();
      const mode = await chooseRestoreMode();
      if (!mode) return;
      const result = await restoreBackup(file.id, mode);
      if (result && result.ok) {
        toast(t("restore.done", { count: result.count }), "success");
        callbacks.onSynced();
      } else if (result && result.error) {
        toast(t("restore.failed"), "error");
      }
    });
    list.append(row);
  }

  const actions = document.createElement("div");
  actions.className = "dialog__actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn--ghost";
  cancel.textContent = t("action.cancel");
  cancel.addEventListener("click", () => close());
  actions.append(cancel);

  box.append(heading, list, actions);
  overlay.append(box);
  host.append(overlay);
  const release = trapFocus(box);
  const onEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener("keydown", onEsc, true);
    release();
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onEsc, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// Storage (§8.13)
// ═══════════════════════════════════════════════════════════════════════════

export async function paintStorage() {
  const estimate = await getStorageEstimate();
  const bar = $("storage-bar");
  const figure = $("storage-figure");

  if (!estimate || !estimate.quota) {
    // Not every browser exposes an estimate; say so rather than showing 0.
    figure.textContent = t("storage.unavailable");
    bar.hidden = true;
  } else {
    bar.hidden = false;
    const percent = Math.min(100, Math.max(0.5, estimate.percent));
    $("storage-bar-fill").style.width = `${percent}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(estimate.percent)));
    figure.textContent = t("storage.used", {
      used: formatBytes(estimate.usage, state.lang),
      quota: formatBytes(estimate.quota, state.lang),
    });
  }

  const items = await getAllItems();
  const media = await getAllMediaIds();
  $("storage-counts").textContent =
    `${t("storage.records", { count: items.filter((i) => !i.deletedAt).length })} · ` +
    `${t("storage.files", { count: media.length })}`;

  // navigator.storage.persisted() only reports; asking again is harmless and
  // occasionally flips to granted once the app has been used a little.
  const persisted = await requestPersistentStorage();
  const badge = $("storage-persistent");
  badge.textContent = t(persisted ? "storage.persistent.on" : "storage.persistent.off");
  badge.classList.toggle("badge--ok", persisted);
  badge.classList.toggle("badge--warn", !persisted);
}

// ═══════════════════════════════════════════════════════════════════════════
// Export (§8.6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hand a generated file to the browser.
 *
 * A real <a download> click, not window.open — the same lesson the attachment
 * viewer paid for: popups are blocked, downloads are not.
 */
function download(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(t("export.done", { name: filename }), "success");
}

async function exportJson() {
  // Tombstones included: this is the backup format restore reads back.
  const items = await getAllItems();
  if (!items.length) {
    toast(t("export.empty"), "info");
    return;
  }
  const payload = toJsonExport(items, { build: VERSION.build });
  const name = exportFilename("json");
  download(JSON.stringify(payload, null, 2), name, "application/json");
}

async function exportCsv() {
  const items = await getAllItems();
  if (!items.filter((i) => !i.deletedAt).length) {
    toast(t("export.empty"), "info");
    return;
  }
  const csv = toCsv(items, { t, lang: state.lang });
  const name = exportFilename("csv");
  // The BOM is what makes Excel read UTF-8 rather than mangling every accent.
  // "\uFEFF" as an escape, not the literal character: a bare BOM in source is
  // invisible in every editor and silently lost by the next tool that touches it.
  download("\uFEFF" + csv, name, "text/csv;charset=utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════
// Print (§8.7)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fill the hidden #print-root and hand over to the browser. No PDF library:
 * a print stylesheet plus the browser's own "Save as PDF" does the job.
 */
export async function printRecords(records, { single = false, title } = {}) {
  const root = $("print-root");
  root.innerHTML = buildPrintHtml(records, {
    t,
    lang: state.lang,
    today: todayIso(),
    includeBody: single ? true : includeBodyInPrint,
    single,
    title,
    types: TYPES,
  });
  // Let the layout settle before the print dialog snapshots the page.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.print();
}

async function printOverview() {
  const items = await getAllItems();
  await printRecords(items, { single: false, title: t("app.name") });
}

// ═══════════════════════════════════════════════════════════════════════════
// Help (§8.14)
// ═══════════════════════════════════════════════════════════════════════════

/** Render the help document. renderMarkdown escapes its input, so this is safe. */
export function renderHelp() {
  $("help-body").innerHTML = renderMarkdown(helpText(state.lang));
}

/** Re-render everything in this view that holds a translated string. */
export function refreshSettingsLanguage() {
  paintSettings();
  paintStorage();
  paintSync();
  if (!$("view-help").hidden) renderHelp();
}
