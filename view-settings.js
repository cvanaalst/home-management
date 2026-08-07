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
import {
  getAllItems,
  getAllMediaIds,
  getStorageEstimate,
  requestPersistentStorage,
  getMeta,
  setMeta,
} from "./db.js";
import { toast, formatBytes, formatDateTime, todayIso, escapeHtml } from "./ui.js";
import {
  toJsonExport,
  toCsv,
  buildPrintHtml,
  buildEventPrintHtml,
  exportFilename,
} from "./report.js";
import { buildIcs, icsCount } from "./calendar.js";
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
  hasBuiltInClientId,
  encryptionStatus,
  setPassphrase,
  disableEncryption,
} from "./sync.js";
import { confirmDialog, trapFocus } from "./ui.js";

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════
// Drive encryption (§7)
// ═══════════════════════════════════════════════════════════════════════════

export async function paintEncryption() {
  const panel = $("encrypt-panel");
  if (!panel) return;
  const status = await encryptionStatus();

  const form = $("encrypt-form");
  const save = $("btn-encrypt-save");
  const sheet = $("btn-encrypt-sheet");
  const off = $("btn-encrypt-off");

  if (!status.supported) {
    $("encrypt-status").textContent = t("encrypt.unsupported");
    $("encrypt-hint").textContent = "";
    form.hidden = true;
    save.hidden = true;
    sheet.hidden = true;
    off.hidden = true;
    return;
  }

  // Three states, and the middle one is the one that must be unmistakable:
  // another device encrypted the payload and this one cannot read it yet.
  if (status.locked) {
    $("encrypt-status").textContent = t("encrypt.status.locked");
    $("encrypt-hint").textContent = t("encrypt.hint.locked");
    form.hidden = false;
    $("encrypt-pass2").hidden = true; // unlocking, not choosing — no confirm
    save.hidden = false;
    save.textContent = t("encrypt.unlock");
    sheet.hidden = true;
    off.hidden = true;
    return;
  }

  if (status.enabled && status.unlocked) {
    $("encrypt-status").textContent = t("encrypt.status.on");
    $("encrypt-hint").textContent = t("encrypt.hint.on");
    form.hidden = true;
    save.hidden = true;
    sheet.hidden = false;
    off.hidden = false;
    return;
  }

  $("encrypt-status").textContent = t("encrypt.status.off");
  $("encrypt-hint").textContent = t("encrypt.hint.off");
  form.hidden = false;
  $("encrypt-pass2").hidden = false;
  save.hidden = false;
  save.textContent = t("encrypt.enable");
  sheet.hidden = true;
  off.hidden = true;
}

function bindEncryption() {
  const save = $("btn-encrypt-save");
  if (!save) return;

  save.addEventListener("click", async () => {
    const status = await encryptionStatus();
    const pass = $("encrypt-pass").value;
    const repeat = $("encrypt-pass2").value;

    if (!status.locked) {
      if (pass !== repeat) {
        toast(t("encrypt.mismatch"), "error");
        return;
      }
      // Switching this on is the one action in the app that can permanently
      // destroy data if the passphrase is lost, so it is confirmed in as many
      // words rather than with a generic "are you sure".
      const ok = await confirmDialog(t("encrypt.confirm"), t("encrypt.enable"), { danger: false });
      if (!ok) return;
    }

    try {
      await setPassphrase(pass);
      $("encrypt-pass").value = "";
      $("encrypt-pass2").value = "";
      toast(t(status.locked ? "encrypt.unlocked" : "encrypt.enabled"), "success");
      await paintEncryption();
      callbacks.onSynced();
    } catch (err) {
      const code = err && err.code;
      toast(
        t(
          code === "passphrase-short"
            ? "encrypt.tooShort"
            : code === "wrong-passphrase"
              ? "encrypt.wrong"
              : "encrypt.failed"
        ),
        "error"
      );
    }
  });

  $("btn-encrypt-off").addEventListener("click", async () => {
    const ok = await confirmDialog(t("encrypt.disable.confirm"), t("encrypt.disable"));
    if (!ok) return;
    await disableEncryption();
    toast(t("encrypt.disabled"), "info");
    await paintEncryption();
  });

  $("btn-encrypt-sheet").addEventListener("click", printRecoverySheet);
}

/**
 * A sheet to print and put somewhere physical.
 *
 * Deliberately does NOT contain the passphrase — this app never sees it after
 * derivation and could not print it if it wanted to. What it gives is the
 * context someone would need months later: which account, which folder, and
 * the fact that nothing on Drive can be read without it.
 */
function printRecoverySheet() {
  const win = window.open("", "_blank");
  if (!win) {
    toast(t("print.blocked"), "error");
    return;
  }
  const rows = [
    [t("encrypt.sheet.app"), "Huisbeheer — Home Management"],
    [t("encrypt.sheet.where"), "Google Drive / Huisbeheer"],
    [t("encrypt.sheet.method"), "AES-GCM-256, PBKDF2-SHA-256"],
    [t("encrypt.sheet.date"), new Date().toLocaleDateString(state.lang === "en" ? "en-GB" : "nl-BE")],
  ];
  win.document.write(
    `<!doctype html><html lang="${state.lang}"><head><meta charset="utf-8">` +
      `<title>${escapeHtml(t("encrypt.sheet.title"))}</title><style>` +
      `body{font:15px/1.6 -apple-system,system-ui,sans-serif;margin:40px;max-width:640px}` +
      `h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px}` +
      `table{border-collapse:collapse;width:100%;margin:24px 0}` +
      `th,td{text-align:left;padding:8px 0;border-bottom:1px solid #ddd;vertical-align:top}` +
      `th{width:38%;font-weight:600}` +
      `.box{border:2px solid #222;border-radius:8px;padding:16px;margin-top:8px}` +
      `.line{border-bottom:1px solid #888;height:34px;margin-top:12px}` +
      `.warn{border-left:4px solid #b00;padding-left:12px}` +
      `</style></head><body>` +
      `<h1>${escapeHtml(t("encrypt.sheet.title"))}</h1>` +
      `<p>${escapeHtml(t("encrypt.sheet.intro"))}</p>` +
      `<table>${rows
        .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
        .join("")}</table>` +
      `<div class="box"><strong>${escapeHtml(t("encrypt.sheet.write"))}</strong>` +
      `<div class="line"></div></div>` +
      `<p class="warn" style="margin-top:24px">${escapeHtml(t("encrypt.sheet.warning"))}</p>` +
      `</body></html>`
  );
  win.document.close();
  win.focus();
  win.print();
}

// ═══════════════════════════════════════════════════════════════════════════
// Reminder notifications (§8.16)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Permission is asked from a BUTTON, never on load.
 *
 * A permission prompt on first paint is the fastest way to get denied forever:
 * the browser remembers a refusal, and there is no second chance to explain
 * what the app wanted it for.
 */
function notificationsSupported() {
  return typeof Notification !== "undefined" && "serviceWorker" in navigator;
}

export function paintNotify() {
  const panel = $("notify-panel");
  const hint = $("notify-hint");
  const button = $("btn-notify-enable");
  if (!panel) return;

  if (!notificationsSupported()) {
    hint.textContent = t("notify.unsupported");
    button.hidden = true;
    return;
  }

  const permission = Notification.permission;
  button.hidden = permission !== "default";
  button.textContent = t("notify.enable");

  if (permission === "granted") hint.textContent = t("notify.granted");
  else if (permission === "denied") hint.textContent = t("notify.denied");
  else hint.textContent = t("notify.hint");
}

function bindNotify() {
  const button = $("btn-notify-enable");
  if (!button) return;
  button.addEventListener("click", async () => {
    try {
      await Notification.requestPermission();
    } catch {
      /* an older browser with the callback-only form; the repaint still runs */
    }
    paintNotify();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Install hint (§6 polish)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The deferred install prompt.
 *
 * Registered at module scope, not in init: the event fires early and can only
 * be replayed later if it was preventDefault()ed the moment it arrived. Miss
 * it and the browser's own prompt is gone with no way to get it back.
 */
let installPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if ($("install-panel")) paintInstall();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if ($("install-panel")) $("install-panel").hidden = true;
  });
}

/** Already running as an installed app? Then there is nothing to suggest. */
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

/** iOS never fires beforeinstallprompt, so it needs written instructions. */
function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

const INSTALL_DISMISSED = "install.dismissed";

async function paintInstall() {
  const panel = $("install-panel");
  if (!panel) return;

  const dismissed = await getMeta(INSTALL_DISMISSED, false);
  const canPrompt = !!installPrompt;
  const ios = isIOS();

  // Show it only when it can actually lead somewhere: not already installed,
  // not previously waved away, and either promptable or iOS (where the user
  // has to do it by hand).
  panel.hidden = isStandalone() || dismissed || (!canPrompt && !ios);
  if (panel.hidden) return;

  $("install-hint").textContent = t(canPrompt ? "install.hint" : "install.hint.ios");
  $("btn-install").hidden = !canPrompt;
}

function bindInstall() {
  $("btn-install").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    // A prompt can only be used once; a declined one must not be replayed.
    installPrompt = null;
    if (outcome === "accepted") toast(t("install.done"), "success");
    paintInstall();
  });

  $("btn-install-dismiss").addEventListener("click", async () => {
    await setMeta(INSTALL_DISMISSED, true);
    paintInstall();
  });
}

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
  bindInstall();
  bindNotify();
  bindEncryption();
  $("btn-storage-refresh").addEventListener("click", paintStorage);
  $("btn-export-ics").addEventListener("click", exportIcs);
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

  // A build that ships its own client ID needs no credentials UI at all.
  const builtIn = hasBuiltInClientId();
  $("sync-client-id-field").hidden = builtIn;
  if (!builtIn) {
    const field = $("sync-client-id");
    // Never clobber what the user is halfway through typing.
    if (document.activeElement !== field) field.value = await getClientId();
    $("sync-origin").textContent = t("sync.clientId.origin", { origin: javascriptOrigin() });
    $("sync-redirect-uri").textContent = t("sync.clientId.redirect", { uri: redirectUri() });
  }
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

export { paintInstall };

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

/**
 * Every reminder as one calendar file.
 *
 * The only mechanism in this app that can reach the user while it is closed —
 * see calendar.js for why this is a download and not a feed on Drive.
 */
async function exportIcs() {
  const items = await getAllItems();
  const count = icsCount(items);
  if (!count) {
    toast(t("export.ics.empty"), "info");
    return;
  }
  download(buildIcs(items), exportFilename("ics"), "text/calendar");
}

/**
 * Export a chosen subset. Used by bulk selection, so "export these six" is a
 * real answer rather than "export everything and edit the file".
 */
export async function exportRecords(records) {
  if (!records || !records.length) {
    toast(t("export.empty"), "info");
    return;
  }
  const payload = toJsonExport(records, { build: VERSION.build });
  download(JSON.stringify(payload, null, 2), exportFilename("json"), "application/json");
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

/**
 * Print the event log, honouring whatever the timeline is currently filtered
 * to. Printing "everything" when the screen shows one boiler's incidents would
 * be answering a question nobody asked.
 */
export async function printEvents(events, records, { title } = {}) {
  const root = $("print-root");
  root.innerHTML = buildEventPrintHtml(events, records, { t, lang: state.lang, title });
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
  paintInstall();
  paintNotify();
  paintEncryption();
  if (!$("view-help").hidden) renderHelp();
}
