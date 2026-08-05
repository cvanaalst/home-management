/**
 * app.js — router, boot, cross-view orchestration (BLUEPRINT §4, §9).
 *
 * This is the only module that knows about more than one view. A view module
 * never imports another view module; every cross-view action is a callback
 * handed down from here.
 */

import {
  state,
  applyPreferences,
  applyStoredPreference,
  setPreferenceSink,
  setLocked,
  PREFERENCE_KEYS,
} from "./state.js";
import { t, applyTranslations } from "./i18n.js";
import { icon } from "./icons.js";
import { openDB, getMeta, setMeta, requestPersistentStorage } from "./db.js";
import { toast } from "./ui.js";

import {
  initListView,
  refreshList,
  refreshListLanguage,
  deleteWithUndo,
  revealFilters,
} from "./view-list.js";
import {
  initDetailView,
  openRecord,
  openDraft,
  confirmLeave,
  closeDetail,
  currentRecord,
  refreshDetailLanguage,
} from "./view-detail.js";
import { initAddView, paintAddView } from "./view-add.js";
import {
  initSettingsView,
  paintSettings,
  paintStorage,
  paintSync,
  printRecords,
  renderHelp,
  refreshSettingsLanguage,
} from "./view-settings.js";
import { initReportView, renderReport } from "./view-report.js";
import { initTrashView, renderTrash, refreshTrashLanguage } from "./view-trash.js";
import { initActivityView, renderActivity, refreshActivityLanguage } from "./view-activity.js";
import { consumeRedirectResult, maybeAutoSync, syncNow } from "./sync.js";

// ═══════════════════════════════════════════════════════════════════════════
// Routing
// ═══════════════════════════════════════════════════════════════════════════

/** Tab-bar destinations. These REPLACE the history entry (§9). */
const BASE_TABS = ["list", "settings"];

/** Everything reached from a tab. These PUSH an entry and animate forward. */
const PUSH_TARGETS = ["detail", "add", "report", "trash", "activity", "help"];

const ALL_VIEWS = [...BASE_TABS, ...PUSH_TARGETS];

/** The route id that means "a new, unsaved record". */
const DRAFT_ID = "new";

const $ = (id) => document.getElementById(id);

/** The type chosen in the add view, waiting to become a draft record. */
let draftType = null;

/** Set while a delete is in flight, so the unsaved-changes guard stays quiet. */
let skipLeaveGuard = false;

/** Parse "#/detail/abc123" into { view, id }, falling back to the list. */
function parseHash(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/");
  const view = ALL_VIEWS.includes(parts[0]) ? parts[0] : "list";
  return { view, id: parts[1] || null };
}

/** Save the scroll offset of the base tab we are leaving (§13.9). */
function rememberScroll() {
  if (!BASE_TABS.includes(state.currentView)) return;
  const section = $(`view-${state.currentView}`);
  if (section) state.scroll[state.currentView] = section.scrollTop;
}

/** Show a view. `navigate()` owns history, so popstate and clicks share a path. */
function renderView(view, id) {
  const swap = () => {
    for (const name of ALL_VIEWS) {
      const section = $(`view-${name}`);
      if (section) section.hidden = name !== view;
    }

    $("topbar-title").textContent = t(`view.${view}.title`);
    $("topbar-title").dataset.i18n = `view.${view}.title`;
    $("btn-back").hidden = !PUSH_TARGETS.includes(view);

    document.querySelectorAll(".tab").forEach((tab) => {
      if (tab.dataset.tab === view) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });

    state.currentView = view;
    state.currentId = id;

    const section = $(`view-${view}`);
    if (!section) return;
    // Restore scroll only AFTER the swap — restoring onto a short page gets
    // the offset clamped (§13.9).
    section.scrollTop = BASE_TABS.includes(view) ? state.scroll[view] || 0 : 0;
  };

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !reduced) {
    const transition = document.startViewTransition(swap);
    // Starting a transition while one is still running ABORTS the old one, and
    // every one of these promises then rejects. Unhandled, that is an
    // "InvalidStateError: Transition was aborted" in the console on any quick
    // double navigation. The abort itself is harmless — the swap still ran —
    // so the rejections are swallowed deliberately rather than reported.
    const ignore = () => {};
    transition.finished.catch(ignore);
    transition.ready.catch(ignore);
    transition.updateCallbackDone.catch(ignore);
  } else {
    swap();
  }
}

/**
 * The single navigation entry point.
 * Base tabs replace the current history entry; pushed views add one.
 */
export async function navigate(view, { id = null, fromPop = false } = {}) {
  if (!ALL_VIEWS.includes(view)) view = "list";

  // Leaving the detail view with unsaved changes asks first.
  if (state.currentView === "detail" && !(view === "detail" && id === state.currentId)) {
    if (!skipLeaveGuard && !(await confirmLeave())) {
      // The user kept editing. A popstate has already moved the history
      // pointer, so put the detail entry back or Back would silently no-op.
      if (fromPop) {
        history.pushState(
          { view: "detail", id: state.currentId },
          "",
          `#/detail/${state.currentId}`
        );
      }
      return false;
    }
  }

  // Load the target view's data BEFORE swapping, so nothing renders half-built.
  if (view === "detail") {
    const opened = id === DRAFT_ID ? await openDraftRecord() : await openRecord(id);
    if (!opened) {
      draftType = null;
      return navigate("list", { fromPop });
    }
  }
  if (view === "list") await refreshList();
  if (view === "report") await renderReport();
  if (view === "settings") {
    paintStorage();
    paintSync();
  }
  if (view === "trash") await renderTrash();
  if (view === "activity") await renderActivity();
  if (view === "help") renderHelp();

  rememberScroll();

  if (!fromPop) {
    const path = id ? `#/${view}/${id}` : `#/${view}`;
    const entry = { view, id };
    if (BASE_TABS.includes(view)) history.replaceState(entry, "", path);
    else history.pushState(entry, "", path);
  }

  renderView(view, id);
  return true;
}

/**
 * A draft only exists in memory, so a reload landing on #/detail/new has
 * nothing to show — fall back to the list rather than an empty form.
 */
async function openDraftRecord() {
  if (!draftType) return false;
  const type = draftType;
  draftType = null;
  return openDraft(type);
}

/** One popstate handler performs ALL back navigation (§9). */
function onPopState(event) {
  const target =
    event.state && event.state.view ? event.state : parseHash(location.hash);
  navigate(target.view, { id: target.id, fromPop: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Chrome wiring
// ═══════════════════════════════════════════════════════════════════════════

/** Fill every [data-icon] placeholder from the one icon source. */
function paintIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 20 });
  });
  $("btn-back").innerHTML = icon("chevronLeft", { size: 22 });
  $("btn-new").innerHTML = icon("plus", { size: 26 });
  $("search-icon").innerHTML = icon("search", { size: 18 });
  $("list-placeholder-icon").innerHTML = icon("list", { size: 44 });
  $("pull-indicator").innerHTML = icon("sync", { size: 20 });
  paintLock();
}

function paintLock() {
  $("lock-icon").innerHTML = icon(state.locked ? "lock" : "unlock", { size: 16 });
  const label = $("lock-label");
  label.dataset.i18n = state.locked ? "lock.locked" : "lock.unlocked";
  label.textContent = t(label.dataset.i18n);
  const btn = $("btn-lock");
  btn.setAttribute("aria-pressed", String(state.locked));
  btn.title = t(state.locked ? "lock.toUnlock" : "lock.toLock");
}

/** Re-render everything that holds a translated string (§11: no reload). */
function refreshLanguage() {
  applyTranslations();
  $("topbar-title").textContent = t(`view.${state.currentView}.title`);
  paintLock();
  paintAddView();
  refreshSettingsLanguage();
  refreshListLanguage();
  refreshDetailLanguage();
  refreshTrashLanguage();
  refreshActivityLanguage();
  if (state.currentView === "report") renderReport();
}

function bindChrome() {
  $("btn-back").addEventListener("click", () => history.back());

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => navigate(tab.dataset.tab));
  });

  $("btn-lock").addEventListener("click", () => applyLock(!state.locked));
  $("btn-new").addEventListener("click", () => navigate("add"));

  window.addEventListener("popstate", onPopState);
}

/** The read-only lock changes what several views render, not just the chrome. */
function applyLock(locked) {
  setLocked(locked);
  paintLock();
  paintSettings();
  refreshList();
  refreshDetailLanguage(); // the detail form's fields become editable or not
  refreshTrashLanguage(); // restore / delete-forever are edit affordances
}

/** Keep the browser/iOS chrome colour in step with the active theme. */
function syncThemeColorMeta() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}

// ═══════════════════════════════════════════════════════════════════════════
// Platform
// ═══════════════════════════════════════════════════════════════════════════

/** Offline is a state, not an error (§3.4). */
function bindConnectivity() {
  const banner = $("offline-banner");
  const sync = () => {
    banner.hidden = navigator.onLine;
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
}

/**
 * Register the service worker and offer the user a reload when a new build is
 * ready (§13.13, §15.2).
 *
 * Without this, a returning visitor keeps the old app until they happen to
 * hard-reload — and they never will, because the old app looks like it is
 * working. You push a fix, see it yourself because you clear caches, and every
 * other device silently stays a version behind for weeks. The build number in
 * Settings ▸ About is only trustworthy once this exists.
 */
function registerServiceWorker() {
  // file:// has no service-worker support; skip rather than log an exception.
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  let reloading = false;
  // The swap finishes by reloading exactly once. Guarding this matters: a
  // controllerchange during an already-running reload would loop the page.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register("sw.js");
    } catch (err) {
      console.warn("Service worker registration failed:", err.message);
      return;
    }

    // A build may already have been sitting in waiting since a previous visit.
    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const incoming = registration.installing;
      if (!incoming) return;
      incoming.addEventListener("statechange", () => {
        // No controller means this is the FIRST install, not an update —
        // there is nothing for the user to reload into.
        if (incoming.state === "installed" && navigator.serviceWorker.controller) {
          offerUpdate(incoming);
        }
      });
    });

    // A long-lived tab (an installed PWA is often never closed) would never
    // ask again on its own. Re-check whenever it comes back to the foreground,
    // throttled so tab-flicking does not hammer the server.
    let lastCheck = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {
        /* offline, or the server is unreachable — try again next time */
      });
    });
  });
}

/** The reload prompt. Stays put until answered — a 6-second toast would be missed. */
function offerUpdate(worker) {
  toast(t("update.available"), "info", {
    actionLabel: t("update.reload"),
    duration: 0,
    onAction: () => {
      // The worker is waiting on purpose; tell it to take over. That fires
      // controllerchange above, which reloads into the new build as a whole.
      worker.postMessage({ type: "SKIP_WAITING" });
    },
  });
}

/**
 * Open the database, reconcile preferences with the meta store, and from then
 * on mirror every preference change into meta.
 *
 * meta is the source of truth (it is what sync and export see); localStorage is
 * only the synchronous mirror that lets the theme be right before first paint.
 * On a device where meta has nothing yet, the mirror seeds it.
 */
async function initStorage() {
  await openDB();
  await requestPersistentStorage();

  // A unique sentinel, NOT undefined: getMeta's fallback is a default
  // parameter, so passing undefined selects the default (null) instead of
  // passing it through — and `false` is a legitimate stored value for `locked`,
  // so null cannot double as "missing" either.
  const MISSING = Symbol("missing");
  for (const key of PREFERENCE_KEYS) {
    const stored = await getMeta(`pref.${key}`, MISSING);
    if (stored === MISSING) await setMeta(`pref.${key}`, state[key]);
    else applyStoredPreference(key, stored);
  }

  setPreferenceSink((key, value) => {
    setMeta(`pref.${key}`, value).catch((err) =>
      console.warn(`Could not persist preference "${key}":`, err.message)
    );
  });

  paintLock();
  paintSettings();
}

// ═══════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════

function initViews() {
  initListView({
    onOpen: (id) => navigate("detail", { id }),
    // §8.1: pull-to-refresh reaches "Sync now". Non-interactive, so it never
    // throws a sign-in popup at someone who only wanted to refresh a list.
    onPullRefresh: () => syncNow({ interactive: false }),
  });

  initDetailView({
    onChanged: () => refreshList(),
    onOpen: (id) => navigate("detail", { id }),
    onDelete: (record) => {
      if (!record) return;
      skipLeaveGuard = true;
      closeDetail();
      deleteWithUndo(record);
      history.back();
      // Released on the next tick, once the back navigation has been handled.
      setTimeout(() => {
        skipLeaveGuard = false;
      }, 0);
    },
    onPrint: (record) => {
      if (record) printRecords([record], { single: true, title: record.title });
    },
    onSaved: (record, wasDraft) => {
      // A saved draft must not leave "#/detail/new" in the history, or Back
      // would return to a form for a record that now exists.
      if (wasDraft) {
        history.replaceState({ view: "detail", id: record.id }, "", `#/detail/${record.id}`);
        state.currentId = record.id;
      }
    },
  });

  initAddView({
    onPick: (type) => {
      draftType = type;
      navigate("detail", { id: DRAFT_ID });
    },
  });

  initTrashView({
    onChanged: () => refreshList(),
    onOpen: (id) => navigate("detail", { id }),
  });

  initActivityView();

  initSettingsView({
    onNavigate: (view) => navigate(view),
    onSynced: () => refreshList(),
    onPreferenceChange: (key) => {
      if (key === "theme") syncThemeColorMeta();
      if (key === "density") refreshList();
      if (key === "lang") refreshLanguage();
      if (key === "locked") applyLock(state.locked);
      else paintSettings();
    },
  });

  initReportView({
    // An insight you cannot act on is trivia: both the bars and the tag cloud
    // jump to the list already filtered.
    onFilterByType: (type) => {
      resetFilters();
      state.filters.type = type;
      navigate("list");
    },
    onFilterByTag: (tag) => {
      resetFilters();
      state.filters.tags = [tag];
      // A tag chip lives inside the collapsed filter panel, so without this the
      // list would arrive filtered with nothing on screen explaining why.
      navigate("list").then(revealFilters);
    },
  });
}

/** Clear the list query so a jump from insights shows exactly what was clicked. */
function resetFilters() {
  state.filters.search = "";
  state.filters.type = "";
  state.filters.tags = [];
  state.filters.dateFrom = "";
  state.filters.dateTo = "";
  const search = $("search-input");
  if (search) search.value = "";
  $("date-from").value = "";
  $("date-to").value = "";
}

async function boot() {
  applyPreferences();
  applyTranslations();
  paintIcons();
  syncThemeColorMeta();
  bindChrome();
  bindConnectivity();
  registerServiceWorker();

  try {
    await initStorage();
  } catch (err) {
    console.error("Storage unavailable:", err);
    toast(t("error.storage"), "error");
  }

  initViews();
  applyTranslations();
  paintSettings();

  // An OAuth redirect comes back with the token in the URL fragment, which is
  // the same place the router keeps its route. Consume it FIRST: it strips the
  // token out of the address bar and hands back whatever the user was doing
  // before they were sent to Google (§7, pending action).
  let resume = null;
  try {
    resume = await consumeRedirectResult();
  } catch (err) {
    console.warn("OAuth redirect could not be processed:", err.message);
  }

  const start = parseHash(location.hash);
  // fromPop: the URL already says where we are, so nothing is pushed.
  await navigate(start.view, { id: start.id, fromPop: true });

  if (resume) {
    // We were sent to Google mid-action; carry on where we left off.
    await syncNow({ interactive: false });
    await refreshList();
    await paintSync();
  } else {
    // Best-effort, and every skip reason is logged — auto-sync sits idle on
    // most launches because tokens last about an hour (§13.5).
    maybeAutoSync()
      .then((result) => {
        if (result && result.ok) refreshList();
      })
      .catch((err) => console.warn("Auto-sync failed:", err.message));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
