/**
 * sw.js — service worker (BLUEPRINT §4, §13.13, §15.2).
 *
 * ── The one rule that breaks offline silently ──────────────────────────────
 * Every new module MUST be added to PRECACHE below AND CACHE_VERSION bumped.
 * Forgetting this breaks offline for EXISTING installs only, which is
 * invisible in development. Check it on every release.
 *
 * Strategy:
 *   • navigations  → the cached document for THAT path if we have one, else the
 *                    network, and only as an offline last resort the app shell
 *   • same-origin  → cache-first, fall back to network, store what we fetch
 *   • cross-origin → straight to network, never cached
 *
 * The navigation rule matters: an unconditional "always return index.html"
 * fallback silently hijacks every other document in the project — tests.html
 * starts serving the app instead of the tests, which is invisible until you
 * wonder why the suite stopped updating.
 */

const CACHE_VERSION = "hms-v23";

const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",

  // core modules
  "app.js",
  "state.js",
  "db.js",
  "sync.js",
  "merge.js",
  "ui.js",
  "i18n.js",
  "icons.js",
  "markdown.js",
  "report.js",
  "help.js",
  "version.js",

  // view modules
  "view-list.js",
  "view-detail.js",
  "view-add.js",
  "view-settings.js",
  "view-report.js",
  "view-trash.js",
  "view-synclog.js",

  // assets
  "fonts/display.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll is atomic: one 404 and the whole install fails loudly, which is
      // what we want — a half-populated cache is worse than none.
      await cache.addAll(PRECACHE);
    })()
  );
  // NOTE: no skipWaiting() here, deliberately.
  //
  // Activating immediately looks helpful and is not: clients.claim() then hands
  // the ALREADY-LOADED page assets from the new build, so an old app.js can
  // fetch a module whose shape has changed. The page ends up half one version
  // and half another.
  //
  // Instead the new worker waits, the app notices it and offers a reload, and
  // the swap happens all at once on a fresh page. If the user never accepts,
  // the worker activates by itself once every tab is closed — so it still
  // self-heals, just never mid-session.
});

/** The app asks for the swap once the user has agreed to reload. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache third parties

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        // A document we precached for this exact path wins — index.html for the
        // app, and nothing else gets impersonated.
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) {
          event.waitUntil(refresh(request)); // top up in the background
          return cached;
        }
        try {
          return await fetch(request);
        } catch {
          // Offline at an uncached path: the app shell is the useful answer,
          // because every in-app route is a hash on index.html.
          const shell = await caches.match("index.html");
          if (shell) return shell;
          throw new Error("offline and no cached shell");
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});

/** Re-fetch a precached document and store it under its own key. */
async function refresh(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
  } catch {
    /* offline — the cached copy is already serving */
  }
}
