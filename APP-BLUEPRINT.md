# Local-First Browser App — Starter Blueprint

**A reusable design contract for any app that stores, retrieves and reports data.**

Derived from *Second Memory* (a vanilla-JS offline-first PWA, 5.4k lines of JS, zero
dependencies, no build step, two-way Google Drive sync). Everything in Sections 3–12
is **generic platform code** you get in every app. Only Section 14 changes per project.

---

## 0. How to use this document

1. Copy this file into the new project root as `BLUEPRINT.md`.
2. Fill in **Section 14 — App Brief** (the only app-specific part).
3. If you are replacing an existing server-based app, read **Section 2** first — it
   covers what changes, what happens to the old code, and how to migrate the data.
4. Paste the **Section 15 — Kickoff Prompt** into a fresh Claude Code session.
5. Keep the file in the repo. It is the contract; when in doubt during the build,
   the agent should re-read it rather than invent a new convention.

> This document deliberately encodes *decisions already made*. Its value is that a new
> session does not re-litigate storage, sync, theming, i18n or release discipline —
> it goes straight to your app's actual subject matter.

---

## 1. What the platform layer gives you for free

Every app built from this blueprint ships with these on day one. This is the
"Settings tab and everything behind it" — the part that is identical across apps.

| Capability | Summary |
|---|---|
| **Local-first storage** | IndexedDB, works fully offline, survives airplane mode |
| **Two-way Google Drive sync** | `drive.file` scope only — the app sees only its own folder |
| **Conflict resolution** | Last-write-wins with **tombstone-always-wins**; pure + unit-tested |
| **Backup / Restore** | Separate timestamped copies; restore as *merge* or *replace* |
| **Activity log** | Capped diary of sync/backup/restore + **why auto-sync skipped** |
| **Recently deleted (trash)** | Browse tombstones, restore, or permanently wipe content |
| **Export** | JSON (full fidelity) + CSV (spreadsheet) |
| **Print / reports** | Single record + full grouped overview, real print stylesheet |
| **Insights** | Counts, per-type bars, per-week chart, tag cloud |
| **Themes** | 4 themes via CSS custom properties, per-theme accent |
| **Typography** | Self-hosted display font (no CDN), deliberate type scale |
| **Dual language** | Full NL/EN, `data-i18n` + runtime `t()` with interpolation |
| **Density toggle** | Compact / comfortable list rendering |
| **Storage info** | `navigator.storage.estimate()` + persistent-storage request |
| **Help screen** | Long-form Markdown help rendered in-app |
| **Version / build** | Shown in About; bumped on every single change |
| **PWA shell** | Manifest, service worker, install hint, app-icon badge |
| **Search / filter / sort** | Text search, type + tag + date-range filters, sort orders |
| **Undo-on-delete** | Toast with undo; no confirm dialogs for reversible actions |

If a new app does **not** need one of these, delete it deliberately — don't quietly
skip it and rediscover the need three builds later.

---

## 2. Replacing a legacy server app (Python/Flask, PHP, Node, …)

**This is the standard starting point: you already have a working app built the
classic way — a server process, a database on that server, HTML rendered by the
server — and you want to rebuild it the Second Memory way.**

The new app contains **no Python and no server at all.** It is plain HTML, CSS and
JavaScript files. The old codebase is not ported line by line; it is *replaced*. The
only thing that carries over is **your data**, via a one-time migration script.

### 2.1 What actually changes

| | Legacy app (before) | New app (after) |
|---|---|---|
| **Runs on** | A server process that must be started | The browser. Nothing to start |
| **Language** | Python (Flask/Django) or similar | Vanilla JavaScript (ES modules) |
| **UI** | Server-rendered templates (Jinja) | Views in one `index.html`, rendered by JS |
| **Database** | SQLite/Postgres on the server | IndexedDB, on each device |
| **Works offline** | No — server unreachable = app dead | **Yes, fully** |
| **Multi-device** | Everyone hits the same server | Each device has a copy; **Google Drive syncs them** |
| **Backups** | Server-side files/cron | In the user's own Drive, plus JSON/CSV export |
| **Hosting** | A machine, a runtime, updates, security patches | Static files (GitHub Pages). Free, nothing to patch |
| **Install** | Open a URL, hope the server is up | Home-screen icon, launches like a native app |

**What you gain:** it works on a plane; there is no server to maintain, secure, pay
for, or restart; the data belongs to the user; startup is instant.

**What you give up (be honest about this):**
- **No shared central database.** Devices converge through Drive sync, not instantly.
  If two people must see the same data *simultaneously*, this design is wrong for you.
- **No server-side scheduled jobs.** Nothing runs while the app is closed — so no
  emails at 3 a.m., no cron. (Reminders work via the app badge when the app is opened.)
- **No server-side secrets.** Anything the browser can reach, the user can read. No
  private API keys.
- **Heavy computation runs on the phone.** Fine for thousands of records; not fine for
  gigabyte-scale analysis.

### 2.2 What happens to the old Python code

| Old code | Fate |
|---|---|
| Routes / view functions (`@app.route`) | **Deleted.** Replaced by the view modules in Section 4 |
| Jinja templates | **Deleted.** Replaced by the view sections in `index.html` |
| SQLAlchemy models / SQL | **Deleted.** Replaced by the record contract in Section 5 |
| Auth / sessions | **Deleted.** No server, no login. Google sign-in is only for *your own* Drive |
| Business rules & validation | **Re-expressed** as pure JS functions — and now unit-tested (Section 12) |
| Report/export logic | **Re-expressed** in the reporting + export layer (§8.7–8.9) |
| The database file | **Kept once**, as the input to the migration script (§2.3) |

Read the old code as a **specification**, not as something to translate. It tells you
what the app must do; it does not tell you how the new one should be built.

### 2.3 The migration path

Migration is a **one-time, one-way, offline** job. Write it as a throwaway Python
script (Python is excellent for this — it can read the old database directly), run it
once, verify the numbers, then never run it again.

```
legacy.db  ──►  migrate.py  ──►  import.json  ──►  Settings ▸ Restore/Import  ──►  app
```

**The script must:**

1. Read every row from the legacy database (read-only — **never** write to it; work on
   a copy).
2. Map each row to the record contract in Section 5. Fill the whole envelope:
   - `id` — a fresh UUID (do not reuse legacy integer primary keys)
   - `createdAt` / `updatedAt` — from the legacy timestamps; if absent, use the file
     date, never `now()` for everything (it destroys sort order)
   - `deletedAt: null`, `restoredAt: null`, `purgedAt: null`
   - `type` — your discriminator; derive from the legacy table or a column
3. Convert legacy relations (foreign keys, join tables) into `linkedIds` arrays or tags.
4. Extract attachments to files and emit them alongside, so they can be imported into
   the media store.
5. **Print a reconciliation report**: rows read, records written, per type, skipped and
   why. You must be able to prove nothing was lost.
6. Emit exactly the JSON array the app's import/restore path already accepts — so no
   special import code is needed in the app itself.

**Verify before trusting it:** counts match per type; the oldest and newest records
survive with correct dates; a handful of records checked by eye field-by-field;
attachments open. Keep the legacy database untouched until you have used the new app
for a few weeks.

### 2.4 The one escape hatch

If — and only if — you can name a job that **must** run on a server (multi-user shared
state, scheduled sending, private API keys, heavy computation), keep a small backend,
but keep it at arm's length so you can retreat later:

- The browser's IndexedDB stays the **primary** store; the server is just another peer.
  The same LWW + tombstone rules from Section 7 apply between device and server.
- The API is a dumb record store (`GET`/`PUT /records`), never a business-logic gateway.
- Everything in Sections 3–13 still applies unchanged to the frontend.

Do not adopt this "just in case". It costs you offline-first, hosting, and security
work, and it is the one decision that is expensive to undo.

### 2.5 Rejected: running Python in the browser

PyScript/Pyodide can execute Python in a browser, and it is the wrong tool here: a
~10 MB runtime, multi-second cold start, and poor behaviour on iOS. It defeats every
property that makes this design good. **Do not use it.**

---

## 3. Non-negotiable principles

1. **Local-first.** The app must be fully usable with the network off. Network features
   (sync, backup) are enhancements that degrade gracefully, never preconditions.
2. **Zero dependencies, no build step.** Plain ES modules served as static files. If a
   library seems necessary, write the 60 lines instead. (Second Memory's Markdown
   renderer is 96 lines; its IndexedDB wrapper is part of a 631-line module.)
3. **The user's data is theirs.** Request the narrowest OAuth scope that works
   (`drive.file` — the app can only see files it created). No analytics. No third-party
   calls. Say so plainly in the Help screen.
4. **Offline is a state, not an error.** Check `navigator.onLine`, show it, log it,
   never throw a stack trace at the user.
5. **Deletes are terminal.** A tombstone always beats a live record in a merge. An edit
   made on another device after a delete is lost — that is the accepted trade-off, and
   it must be documented in Help.
6. **Anything testable is a pure function.** Merge logic, formatting, parsing, stats,
   and URL cleanup live in dependency-free modules with no DOM and no I/O, so they can
   be unit-tested directly in the browser.
7. **Every change bumps the build number.** No exceptions. It is the only way to know
   what is actually running on a phone.
8. **Never trust the platform.** iOS Safari in particular will silently do the wrong
   thing. See Section 13 — those lessons were each paid for with a real bug.

---

## 4. File layout

Flat, one module per responsibility. No framework, no bundler, no `src/`.

```
project/
  index.html            # all views as <section> elements, one file
  app.js                # router, boot, cross-view orchestration, shared actions
  state.js              # tiny shared mutable state object (lang, theme, filters)
  db.js                 # IndexedDB wrapper + pure data helpers (stats, search text)
  sync.js               # Google Drive REST + OAuth + sync/backup/restore
  merge.js              # PURE merge logic — no DOM, no network, no storage
  ui.js                 # toast, dialogs, focus trap, formatters, shared widgets
  i18n.js               # NL/EN dictionaries + t() + applyTranslations()
  icons.js              # inline SVG path data, one place
  markdown.js           # PURE minimal Markdown renderer
  help.js               # long-form help text as Markdown, per language
  version.js            # { designer, date, build } — bumped every change
  style.css             # all CSS, custom-property themes, print styles
  sw.js                 # service worker, explicit precache list + CACHE_VERSION
  manifest.webmanifest
  tests.html            # unit tests for every pure function — no framework
  icons/                # app icons (192, 512, apple-touch)
  fonts/                # self-hosted display font (woff2)

  view-list.js          # each view owns its own DOM wiring + render
  view-detail.js
  view-add.js
  view-settings.js
  view-report.js        # insights / statistics
  view-trash.js         # recently deleted
  view-activity.js      # sync activity log
```

**Rules**
- A view module never imports another view module. Cross-view actions are passed in
  as callbacks from `app.js` (`initDetailView({ onChanged, onDelete, onNavigate })`).
- `merge.js` and `markdown.js` import **nothing**. That is what makes them testable.
- Every new module must be added to the service-worker precache list **and** the
  `CACHE_VERSION` bumped, or offline breaks silently.

---

## 5. The record contract

Every stored record — whatever the app is about — carries this envelope. The sync,
backup, trash, export and merge layers are **field-agnostic**: they operate on the
envelope, so new domain fields ride along with zero changes to the platform code.

```js
{
  id:         "uuid",          // crypto.randomUUID(); never reused
  type:       "note",          // your app's discriminator (drives icons/filters)

  // --- envelope: required by the platform layer ---
  createdAt:  "ISO-8601",
  updatedAt:  "ISO-8601",      // bump on EVERY write; drives last-write-wins
  deletedAt:  null,            // ISO string = tombstone. Never hard-delete.
  restoredAt: null,            // set when a tombstone was restored under a new id
  purgedAt:   null,            // set when content was permanently wiped

  // --- common, useful in almost every app ---
  title:      "",
  comment:    "",
  tags:       [],
  pinned:     false,
  reminderAt: null,            // "YYYY-MM-DD" or null
  linkedIds:  [],              // ids of related records

  // --- media (only if your app has attachments) ---
  mediaId:    null,            // key into the separate media store
  filename:   null,
  mimeType:   null,

  // --- your domain fields go here, freely ---
}
```

**Why each envelope field exists**

- `updatedAt` — the entire conflict resolution depends on it. A write that forgets to
  bump it will be silently discarded by the next sync.
- `deletedAt` — soft delete. Hard deletion cannot propagate: the other device would
  simply re-add the record on the next sync. Tombstones *are* the delete mechanism.
- `restoredAt` — a restored record is a **new id**; the old tombstone stays (so the
  delete still propagates) but is marked so it disappears from the trash and cannot be
  restored twice into duplicates.
- `purgedAt` — "delete forever": content wiped, bare tombstone kept so sync still
  enforces the deletion and the record can never resurrect.

**Three IndexedDB stores**

| Store | Key | Contents |
|---|---|---|
| `items` | `id` | the records above |
| `media` | `id` | `{ id, blob, thumbnailBlob }` — binary kept out of the record |
| `meta` | `key` | settings, tokens, `lastSyncAt`, activity log |

---

## 6. Storage layer (`db.js`)

Hand-rolled promise wrapper over IndexedDB. Roughly this surface:

```js
openDB()                          requestPersistentStorage()
makeId()                          getStorageEstimate()

putItem(item)                     getItem(id)
putItems(items)                   getAllItems()
queryItems({ search, tags, type, sortBy, sortDir,
             dateFrom, dateTo, offset, limit })   // -> {results,total,hasMore}
getDeletedItems()                 // tombstones, excludes restored/purged

putMedia(rec)  getMedia(id)  deleteMedia(id)  cloneMedia(sourceId)
makeThumbnail(file)  makeFullImage(file)

getMeta(key, default)  setMeta(key, value)
logActivity(kind, outcome, detail)   getActivityLog()   clearActivityLog()

// pure helpers — unit-tested
normalizeSearchText(s)   stripTrackingParams(url)   normalizeUrl(url)
getStats()   bucketItemsByWeek(items, n)   sortTagsByRecency(tags)
computeBacklinks(items, id)   computeLinkedIdSet(items)
```

**Conventions**
- Every query filters out `deletedAt` records except the trash view.
- Search builds one normalized haystack per record (title + body + comment + url +
  any list content), diacritic- and case-insensitive.
- Pagination is offset-based with a "load more" button — no infinite scroll (it fights
  scroll restoration).
- Migrations: bump the IndexedDB version and add stores in `onupgradeneeded`. Never
  rewrite existing records on upgrade; treat missing fields as defaults at read time.

---

## 7. Sync layer (`sync.js` + `merge.js`)

### Drive folder layout

```
SecondMemory/                 (or <YourApp>/ — created via drive.file scope)
  items.json                  the full record set
  <itemId>__<filename>        one file per media blob
  backups/
    backup-2026-07-22T18-30-00-000Z.json
```

### OAuth

- Google Identity Services token client for the popup flow.
- **Implicit/redirect fallback is mandatory** for iOS standalone PWAs, where popups
  fail. Store a "pending action" before redirecting and resume after the reload.
- Tokens last ~1 hour with **no silent refresh**. Cache `{accessToken, expiresAt}` in
  meta with a safety buffer. Assume you are signed out most of the time (Section 13).

### The merge (pure, in `merge.js`)

```js
resolveRecord(a, b)          // tombstone beats live; else newer updatedAt wins
mergeItemSets(local, remote) // -> { merged, stats:{added,updated,deleted} }
computeMediaActions(merged, localMediaIds, remoteMediaNames)
  // -> { toUpload, toDownload, toDeleteLocal, toDeleteRemoteNames }
```

Rules that are easy to get wrong and must stay in the pure module:

- A tombstone **always** wins, regardless of timestamps.
- Between two tombstones, the newer `updatedAt` wins.
- Media deletion on Drive must be matched by the **`<id>__` filename prefix**, not by
  the exact filename, and must **not** be gated on the local blob still existing —
  the local blob is purged seconds after deletion, so gating on it orphans the Drive
  copy forever. (This was a real, silent storage leak.)

### The sync sequence

1. Get token → ensure app folder → download `items.json` (or `[]` on first run).
2. `mergeItemSets(local, remote)`.
3. Reconcile media: upload local-only, download remote-only, delete tombstoned.
4. **Re-read local and re-merge** immediately before writing back. Media transfer can
   take a long time, and an edit made during that window would otherwise be clobbered
   by the now-stale merged set.
5. Write `items.json` back to Drive, set `lastSyncAt`, log the outcome.

### Error taxonomy

| Code | Meaning | Handling |
|---|---|---|
| 401 | Missing/expired token | Re-auth; do not spam popups on launch |
| 402 | Out of credit/quota (3rd-party APIs) | Surface plainly, do not retry |
| 404 | Remote file/folder gone | Recreate it |
| 409 / conflict | Concurrent write | Re-read, re-merge, retry once |
| offline | `navigator.onLine === false` | Skip, log the reason, no error toast |

---

## 8. Platform features — specifications

### 8.1 Sync now
Primary button. Disabled/short-circuited when offline with a plain message. Emits
status events (`syncing` / `success` / `error`) that both the Settings view and the
toast system listen to. Also reachable via **pull-to-refresh** on the main list.

### 8.2 Backup
Writes a timestamped JSON copy into `backups/`. Independent of sync. Logs success
(with filename) or failure.

### 8.3 Restore
Lists backups newest-first. The user chooses:
- **Merge** — run the backup through the normal LWW merge.
- **Replace** — the backup becomes the source of truth locally *and* is re-uploaded to
  Drive immediately, so the next sync cannot silently revert the restore.

Both modes re-download any missing media referenced by the restored records.

### 8.4 Activity log
A capped ring buffer (≈60 entries) in the meta store. **Local only — never synced.**

```js
{ at: ISO, kind: "sync"|"backup"|"restore"|"autosync",
  outcome: "success"|"error"|"skipped", detail: "≤200 chars" }
```

Rendered newest-first with a coloured status dot, translated labels, and a Clear
button. This is the app's black box — when a user says "sync isn't working", this is
the first and usually only diagnostic needed.

### 8.5 Recently deleted (trash)
Lists tombstones newest-first (excluding restored/purged). Two actions per row:

- **Restore** → re-create as a **new id** (a resurrected old id would be re-killed by
  the next sync that saw its tombstone), clone the media under a new id, then mark the
  old tombstone `restoredAt` so it leaves the list.
- **Delete forever** → confirm, then wipe content (title/body/tags/links), purge any
  local blob, set `purgedAt`, keep the bare tombstone. The Drive media copy is removed
  by the next sync via the id-prefix rule.

### 8.6 Export
- **JSON** — everything, full fidelity, the real backup format.
- **CSV** — flattened for spreadsheets; nested structures collapse to readable text.

### 8.7 Print
- Per-record print button.
- **Overview report**: whole collection grouped by type, alphabetical, with an
  "include full body text" toggle. Implemented as a hidden `<div>` populated on demand
  plus a `@media print` stylesheet — no PDF library.

### 8.8 Insights
Tiles (total, pinned, due reminders, plus any app-specific aggregate), a per-type bar
breakdown, a 12-week inline-SVG bar chart, and a tag cloud. No charting library —
hand-drawn `<rect>` elements are enough and stay dependency-free.

### 8.9 Themes
Four themes minimum (dark, light, midnight, paper). All colour flows through CSS
custom properties on `:root[data-theme=...]`. Each theme defines its own accent —
distinctive per theme, not one accent recoloured.

Required tokens: `--bg --surface --surface-raised --border --text --text-secondary
--text-tertiary --accent --accent-text --danger --tag-bg --tag-text --radius-sm
--radius-md`.

### 8.10 Typography
One self-hosted display face (woff2, subset to Latin) for headings/brand, system
stack for body. **Never link a font CDN** — it breaks offline and adds a third party.

### 8.11 Language
Full dual language (NL default / EN), see Section 11.

### 8.12 Density
Compact (title only) vs comfortable (tags + dates). Persisted in meta.

### 8.13 Storage
Show usage/quota from `navigator.storage.estimate()`; call
`navigator.storage.persist()` at boot so the browser is less likely to evict data.

### 8.14 Help
Long-form Markdown per language rendered with the app's own renderer. Must explain, in
plain user language: what syncs, that deletes always win, where the data lives, and any
platform quirks the user will hit.

### 8.15 About
`{ designer, date, build }` from `version.js`, rendered as one line.

### 8.16 App badge (optional)
`navigator.setAppBadge(count)` for due reminders, feature-detected, updated on boot and
after every data change. The strongest nudge a serverless PWA can give — no push server
is possible without one.

---

## 9. UI architecture

### Router
All views are `<section>` elements in one `index.html`; the router toggles `hidden`.

- Tab-bar destinations (list / grid / settings) **replace** the history entry.
- Pushed views (detail, add, report, help, trash, activity) **push** an entry and are
  listed in `PUSH_TARGETS` so they animate as a forward navigation.
- A single `popstate` handler performs all back navigation, so in-app Back buttons just
  call `history.back()` — one code path for both.
- Scroll position is saved per base tab and restored **after** the data has rendered
  (restoring before render gets clamped to a short page — a real bug).

### Dialogs
`confirmDialog(message, okLabel)` and `alertDialog(message)` return promises. Every
dialog gets a focus trap, Escape-to-close, and a visible `:focus-visible` ring.

### Toasts
`toast(message, kind, { actionLabel, onAction, onExpire })`.
Reversible destructive actions use **undo-on-toast**, never a confirm dialog.
Irreversible ones (delete forever, replace-restore) use a confirm dialog.

### The widget pattern
Reusable input widgets (tag input, checklist, pickers) are **created once** at view
init and **reset** via `setItems()` on each open. Creating them per open silently
accumulates event listeners — a recurring bug class in this codebase.

```js
// init once
listWidget = setupChecklist(container, { onPersist, pickLink, onNavigate });
// per open
listWidget.setItems(rows);
```

### Two-speed persistence
Decide per field and document it:
- **Immediate persist** (write-through): checkbox toggles, link set/remove — they must
  survive backing out without saving.
- **Save-gated**: text fields — committed on the Save button.

The edge case must be deliberate: tick a box, rename a row, hit Cancel → the tick
persists, the rename is discarded. That is correct; say so in Help if users will hit it.

### Gestures (touch)
Swipe-left to delete (with undo), swipe-right to pin, long-press for a context menu,
pull-to-refresh to sync.

---

## 10. Design system

- **Tokens first.** No literal colour in a component rule — only `var(--…)`.
- **Layout does spacing.** Flex/grid + `gap`, not per-element margins.
- **Wide content scrolls itself.** Tables/code get `overflow-x:auto` on their own
  container; the page body never scrolls sideways.
- **Motion is optional.** View Transitions API where available with a plain fallback;
  respect `prefers-reduced-motion`.
- **Icons** live in `icons.js` as inline SVG path data — one source, themeable via
  `currentColor`, no sprite fetch.
- **Glass chrome** (translucent + `backdrop-filter`) for top/bottom bars, with a solid
  fallback.
- **Accessibility**: visible focus rings, `aria-label` on icon-only buttons, focus traps
  in dialogs, ≥44 px touch targets, real contrast in every theme.

---

## 11. Internationalisation

```js
// i18n.js
const dict = { nl: { key: "Nederlands {var}" }, en: { key: "English {var}" } };
t(key, vars)             // interpolates {var}
setLang(lang)            // persists to meta
applyTranslations()      // walks the DOM
```

- Static markup uses `data-i18n`, `data-i18n-placeholder`, `data-i18n-aria`.
- Dynamic strings call `t()` at render time — never cache a translated string.
- **Every user-visible string goes in the dictionary.** No exceptions, including toast
  text, error messages, empty states and log labels.
- Language switch must re-render the current view live, not require a reload.

---

## 12. Testing

`tests.html` — a plain page that imports the pure modules and runs assertions in the
browser. No framework, no runner, no npm.

```js
assertEqual(actual, expected, "label")   // renders PASS/FAIL rows + a summary
```

**What must be tested** (all pure, all fast):
- `resolveRecord` — every tombstone/timestamp permutation
- `mergeItemSets` — first sync, fresh device, incremental, resurrection prevention
- `computeMediaActions` — upload/download/delete, orphan cleanup, id-prefix matching
- URL normalisation / tracking-param stripping
- stats, bucketing, tag sorting, backlink computation
- the Markdown renderer, including **XSS**: escaping raw HTML, rejecting
  `javascript:` URLs, and preventing attribute break-out

Target: the pure layer is fully covered. DOM behaviour is verified by driving the real
app in a browser, not by mocking.

---

## 13. Hard-won lessons (each one was a real bug)

**iOS / Safari**
1. **Clipboard reads must start synchronously inside the user gesture.** Any `await`
   before `navigator.clipboard.read()` loses user activation and it silently fails.
2. **Safari copies URLs as `text/uri-list`** with no plain-text twin. Read both
   flavours and race them.
3. **A home-screen PWA and Safari have separate storage.** A link *always* opens in
   Safari, which looks like a brand-new empty install. Never build a capture flow that
   depends on a link opening the installed app — use the **clipboard** instead, and
   detect the situation to show an explanatory banner.
4. **Popups are blocked after an await.** Open the tab synchronously in the gesture,
   then fill it once the blob is ready.
5. **OAuth tokens last ~1 hour with no silent refresh.** Auto-sync will skip on most
   launches. Log it or it looks broken.

**Sync**
6. **Never restore under the same id** — the surviving tombstone re-kills it.
7. **Never gate remote media deletion on the local blob existing** — the blob is purged
   seconds after deletion, so the Drive copy orphans forever.
8. **Re-merge immediately before write-back**, or slow media transfers clobber edits.

**UI**
9. **Restore scroll after data renders**, not before, or it gets clamped.
10. **Don't re-render on blur** if it moves the Save button between mousedown and
    mouseup — harvest pending input instead.
11. **Create widgets once, reset per open** — otherwise listeners accumulate.
12. **A line-based Markdown renderer** turns a single newline into `<br>`; keep each
    paragraph/bullet on **one source line** or the formatting shatters.

**Release**
13. **Add every new module to the SW precache list and bump `CACHE_VERSION`**, or
    offline breaks for existing installs only — invisible in dev.

---

## 14. App brief — fill this in

> This is the only section that changes per project. Be concrete; vagueness here
> becomes churn later.

```markdown
### App name
Home Management System

### One-sentence purpose
Home Management System is a standalone desktop application for organising and managing
personal notes, household documents, contacts, warranties, insurance details, maintenance schedules, and
any other home information.

### Replacing an existing app? (Section 2)
[ ] No — new app from scratch
[ X] Yes — legacy app: Flask + SQLite + Jinja
No server must remain

Replace the flask_app in '/Users/chris/Documents/My Apps/flask_app'

### New Fearures/Functionality
add a Reminder type to a reminder, only one reminder-type per reminder, free input or select out list of previous types

### Migration
No migration of data is needed.

### Languages
Default: <nl>   Also: <en>

### Deployment target
<GitHub Pages / static host>   URL: <...>
```

---

## 15. Release discipline

1. Bump `version.js` `build` on **every** change (and `date` to `YY-MM`).
2. If any precached file changed, bump `CACHE_VERSION` in `sw.js`.
3. Run `tests.html` — all green.
4. Exercise the changed flow in a browser; console must be clean.
5. Stage **by filename** (never `git add -A` — editor lock files and OS junk leak in).
6. Commit with a body that explains *why*, not just what.
7. Push only on the explicit word from the owner.

---

## 16. Definition of done (per feature)

- [ ] Works with the network off
- [ ] Survives a reload and an app restart
- [ ] Syncs correctly in both directions, including the delete case
- [ ] Strings exist in both languages
- [ ] Pure logic has tests; they pass
- [ ] Renders correctly in all four themes, light and dark
- [ ] Keyboard reachable, focus visible, touch targets ≥44 px
- [ ] Console clean, no unhandled rejections
- [ ] Build number bumped, SW cache version bumped if needed
- [ ] Help text updated if the user-visible behaviour changed

---

## 17. Setting up the Google OAuth client ID

> Everything in this section is done once, in a browser, on Google's site. It
> takes about ten minutes. Nothing here is secret and nothing here costs money.

### What you are actually creating, and why

The app needs permission to put files in **your own** Google Drive. Google will
not hand that permission to an anonymous web page, so you register the app once
and Google gives you a **client ID** — a public string like
`123456789012-abc123def456.apps.googleusercontent.com`.

Three things worth understanding before you start, because they remove most of
the anxiety:

- **A client ID is not a password.** For a browser app it is public by design;
  it is visible in the network tab of anyone who uses your app. It identifies
  the app, it does not authorise anything on its own. It is safe in source code
  and safe in a screenshot. There is no client *secret* here at all — those only
  exist for apps with a server, which this is not.
- **The `drive.file` scope is extremely narrow.** The app can only ever see
  files **it created itself**. It cannot list, read or touch a single other
  document in your Drive. If you delete the app's folder, it starts over with
  nothing. This is the whole reason the scope was chosen (§3.3).
- **You are not publishing anything.** The app stays in "Testing" mode with you
  as the only user. No review, no verification, no fee.

### Step 1 — create a project

1. Go to <https://console.cloud.google.com/>.
2. Sign in with the Google account **whose Drive you want to sync into**. This
   matters: the files land in that account's Drive.
3. Click the project dropdown in the top bar → **New Project**.
4. Name it something you will recognise in two years — `Huisbeheer` will do.
   Leave "Location" as "No organisation".
5. **Create**, then make sure the project dropdown now shows your new project.
   Everything below applies to the *selected* project; picking the wrong one is
   the single most common way to waste twenty minutes here.

### Step 2 — enable the Drive API

1. Left menu → **APIs & Services** → **Library**.
2. Search for **Google Drive API**, open it, click **Enable**.

Without this the sign-in will succeed and then every Drive call returns a
confusing 403. If sync signs in fine but nothing ever uploads, come back and
check this step.

### Step 3 — configure the consent screen

1. **APIs & Services** → **OAuth consent screen**.
2. User type: **External**. (Internal only exists for Google Workspace
   organisations. External + Testing is right even for a private app.)
3. Fill in the required fields only:
   - App name: `Huisbeheer` — this is the name you will see on the Google
     sign-in screen, so make it recognisable.
   - User support email: your own address.
   - Developer contact email: your own address again.
4. **Save and continue.**
5. **Scopes** — click **Add or remove scopes**, filter for `drive.file`, and
   tick `.../auth/drive.file` ("See, edit, create and delete only the specific
   Google Drive files you use with this app"). Update → Save and continue.
6. **Test users** — click **Add users** and add your own Google address.
   *Do this.* In Testing mode only listed users can sign in; skipping it gives
   `Error 403: access_denied` at sign-in with no useful explanation.
7. Save. Leave the app in **Testing**. Do not click "Publish app" — publishing
   starts a verification process you do not need for personal use.

> **The seven-day refresh-token caveat, and why it does not matter here.**
> Testing-mode apps get refresh tokens that expire after seven days. This app
> uses the browser (implicit) flow, which never receives a refresh token at all
> — every sign-in lasts about an hour and then you sign in again. So the
> seven-day limit changes nothing for you.

### Step 4 — create the OAuth client ID

1. **APIs & Services** → **Credentials** → **Create credentials** →
   **OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Huisbeheer browser`.
4. **Authorized JavaScript origins** — click **Add URI** and enter the origin
   *with no path and no trailing slash*:

   ```
   https://<your-github-username>.github.io
   ```

   Add a second one for local development:

   ```
   http://localhost:5173
   ```

5. **Authorized redirect URIs** — click **Add URI** and enter the full URL of
   the app *including the trailing slash*:

   ```
   https://<your-github-username>.github.io/<repository-name>/
   http://localhost:5173/
   ```

6. **Create**. Copy the client ID that appears.

> **These two fields are not the same value, and mixing them up is the number
> one setup failure.** An origin must have no path — Google rejects it with
> *"Invalid Origin: URIs must not contain a path"*. A redirect URI must be the
> exact full URL the app returns to, matched character for character. The app
> prints both correct values for you: **Settings ▸ Sync**, under the client ID
> field. Copy them from there rather than typing them.

### Step 5 — paste it into the app

Open the app → **Settings ▸ Sync** → paste into **OAuth client ID** → **Save**
→ **Sync now**. A Google sign-in appears; approve it. You will see a warning
that the app is not verified — that is expected for a Testing-mode app that is
yours. Click **Advanced** → **Go to Huisbeheer (unsafe)**.

Alternatively, hardcode it: set `DEFAULT_CLIENT_ID` at the top of `sync.js`.
The Settings field overrides it, and it is safe in a public repository.

### Troubleshooting

| What you see | What it means |
|---|---|
| `redirect_uri_mismatch` | The redirect URI is not registered *exactly*. Compare character by character with the value shown in Settings ▸ Sync — the trailing slash counts, and `http` ≠ `https`. |
| `Invalid Origin: URIs must not contain a path` | You put the full URL in the **origins** box. Origins are scheme + host + port only. |
| `Error 403: access_denied` at sign-in | Your address is not in **Test users**, or the consent screen was never completed. |
| Sign-in works, uploads fail with 403 | The **Google Drive API** is not enabled (Step 2). |
| `Error 400: invalid_client` | The client ID is wrong, or belongs to a deleted project. |
| Nothing happens when you click Sync now | A blocked popup. The app falls back to a full-page redirect automatically; if that also does nothing, check that the redirect URI is registered. |
| Changes take a while to apply | Google can take a few minutes to propagate credential edits. Wait, then retry. |

---

## 18. Publishing on GitHub Pages

> The app is a folder of static files. GitHub Pages serves a folder of static
> files, over https, free, with no build step. That is the entire mechanism.

### Why GitHub Pages suits this design exactly

- **HTTPS is mandatory for the app to work at all.** Service workers, IndexedDB
  persistence and OAuth all refuse to run on plain `http` on a real domain.
  Pages gives you a certificate automatically.
- **No build step means no CI.** There is nothing to compile, so the repository
  *is* the deployment. What you commit is what runs.
- **A stable URL** is what the OAuth redirect URI and the installed PWA icon
  both depend on.

### Step 1 — create the repository

```bash
cd "/Users/chris/Documents/My Apps/Home Management System"
git init
git add index.html style.css sw.js manifest.webmanifest *.js icons fonts tests.html APP-BLUEPRINT.md
git commit -m "Huisbeheer: local-first home management app"
```

Stage **by name**, never `git add -A` (§15.5) — editor lock files and `.DS_Store`
leak in otherwise. Then create an empty repository on GitHub and:

```bash
git remote add origin https://github.com/<username>/<repository>.git
git branch -M main
git push -u origin main
```

### Step 2 — turn Pages on

1. Repository → **Settings** → **Pages** (left menu).
2. **Source**: *Deploy from a branch*.
3. **Branch**: `main`, folder: **`/ (root)`**. Save.
4. Wait a minute. The page then shows your URL:
   `https://<username>.github.io/<repository>/`

That URL is what goes into the OAuth redirect URI in §17, Step 5.

### Step 3 — the one gotcha: relative paths

The app lives at `/<repository>/`, **not** at the domain root. Every path in
this app is already relative (`style.css`, `app.js`, `./` in the service
worker's precache list), which is why it works unchanged. If you ever add a
path starting with `/`, it will break on Pages and work locally — the nastiest
possible failure mode.

- ✅ `<link rel="stylesheet" href="style.css">`
- ✅ `caches.open(...)` precaching `"./"` and `"index.html"`
- ❌ `<script src="/app.js">` — resolves to the domain root, 404 on Pages

### Step 4 — private repository, public site?

GitHub Pages from a **private** repository requires a paid plan. On the free
plan the repository must be public, which means **your source is public — but
your data never is.** The data lives in your browser and your Drive; the
repository holds only code. The OAuth client ID in that code is not a secret
(§17). Do not put codes, passwords or contract numbers in the repository — the
app is for those, not the source.

### Step 5 — deploying an update

```bash
git add index.html app.js sw.js version.js
git commit -m "why this change was needed"
git push
```

Pages redeploys in under a minute. **Before every push**, run the release
discipline in §15: bump `version.js`, bump `CACHE_VERSION` in `sw.js` if any
precached file changed, run `tests.html` green, exercise the change in a
browser.

> **Why the cache version matters more than it looks.** Returning visitors are
> served by the service worker from its cache. If `CACHE_VERSION` did not
> change, they keep the old app forever and see none of your fix — and you will
> not notice, because your own browser is the one you keep clearing. Check the
> build number in Settings ▸ About on a device you have not touched.

### Custom domain (optional)

Settings → Pages → Custom domain, add a `CNAME` record at your DNS provider
pointing to `<username>.github.io`, and tick **Enforce HTTPS**. If you do this,
**add the new origin and redirect URI to the OAuth client** (§17 Step 4) or
sync stops working the moment the domain changes.

### Other static hosts

Nothing here is GitHub-specific. Netlify, Cloudflare Pages, Vercel and a plain
nginx directory all work the same way: serve the folder over https, register
that origin with Google. The only requirements are **https** and **no path
rewriting**.

---
