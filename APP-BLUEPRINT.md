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

**Read §19 first if you are starting a different kind of app.** Sections 1–18 describe
one blueprint in detail; **§19 is the part that transfers to any local-first PWA with
storage and sync**, ordered by how expensive each lesson is to retrofit. §13 lists the
individual bugs behind those rules — every entry in it was real.

*Sections 5–13, 15 and 16 were revised after a full build of this blueprint (35
releases, ~1,100 tests). Where the original guidance turned out to be wrong or
incomplete, it has been corrected rather than annotated.*

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
| **Sync log** | Capped diary of sync/backup/restore + **why auto-sync skipped** |
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
  crypto.js             # PURE-ish WebCrypto: key derivation, envelope, blob sealing
  calendar.js           # PURE iCalendar (.ics) builder
  report.js             # PURE export + print builders (CSV, JSON, print HTML)
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
  view-synclog.js       # sync log (diagnostics) — NOT "activity", see §8.4
  view-timeline.js      # the event log / history
```

**Rules**
- A view module never imports another view module. Cross-view actions are passed in
  as callbacks from `app.js` (`initDetailView({ onChanged, onDelete, onNavigate })`).
- `merge.js`, `markdown.js`, `calendar.js` and `crypto.js` import **nothing** from the
  app. That is what makes them testable.
- `report.js` takes its translator as a **parameter** rather than importing `i18n.js`,
  so the print and export builders can be tested with a stub dictionary.
- A second list-like view gets its **own module** rather than making the first
  multi-instance: the expensive part (the pure query engine) is already shared, and the
  singleton state, fixed element ids and gesture handlers are not worth untangling.
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
  kind:       "record",        // "record" | "event" — see below

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
  recurrence: null,            // { every: "year", interval: 1 } or null
  linkedIds:  [],              // ids of related records
  fields:     [],              // [{ id, key, value }] — see "structured fields"

  // --- the event axis (only if your app records history) ---
  occurredAt: null,            // "YYYY-MM-DD" — when it HAPPENED
  eventType:  "",              // one of a small fixed set
  amount:     null,            // optional number

  // --- media: N per record, not one ---
  links:       [],             // [{ id, label, url }]
  attachments: [],             // [{ mediaId, filename, mimeType, size }]

  // --- your domain fields go here, freely ---
}
```

**`kind` — a second axis instead of more types**

A records app eventually needs to store *what happened* as well as *what exists*: the
boiler serviced, the premium paid, the power out. The obvious move is another `type`,
and it is the wrong one — an event about the router should keep the router's colour,
icon and filter chip.

So `kind` is a second, orthogonal axis. An event lives in the same store with the same
envelope and inherits sync, merge, tombstones, trash, search, tags, links and
attachments **with no second implementation of any of them**. Rows written before the
axis existed have no `kind` at all and normalise to `"record"`, which is exactly right.

The cost is one filter argument in the query engine and one exclusion in the stats.
The alternative — a second store — means a second sync file, a second merge path, a
second trash and a second export.

**Structured fields — the answer to "one form per type"**

An account record wants a provider and a customer number; a device wants a serial and
an installer. Do **not** fork the form per type: the type is metadata, not a schema,
and seven schemas means seven of everything downstream (export, print, merge, search,
diff).

Instead, any record can carry `fields: [{ id, key, value }]`, and the **type only
decides what the app suggests** in a `<datalist>`. Seven types get seven sensible
forms out of one mechanism, a key the user invents works identically, and the platform
layer stays field-agnostic. Values render monospace with a copy button — a reference
number exists to be pasted somewhere else.

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

**Four IndexedDB stores**

| Store | Key | Contents |
|---|---|---|
| `items` | `id` | the records above — records AND events |
| `media` | `id` | `{ id, blob, thumbnailBlob }` — binary kept out of the record |
| `meta` | `key` | settings, tokens, `lastSyncAt`, sync log, saved views, the encryption key |
| `versions` | `key` | per-record revision history — **local only, never synced** |

**Why revision history must be local**

Last-write-wins discards the losing record *whole*. History kept inside the record
would therefore vanish together with the edit you wanted it for — precisely the case
it exists to cover. A separate local store keeps each device's own view of what it
saw, and lets the merge snapshot what it is about to overwrite.

Its keys are `` `<recordId>#<zero-padded seq>` ``, which makes string order
chronological within a record and every record's history a contiguous run — so a
cursor over a key range reads exactly one record's revisions **with no secondary
index**. Sequence numbers come from the last key rather than from a count, or evicting
an old revision would let a new one reuse a number and sort itself into the middle.

---

## 6. Storage layer (`db.js`)

Hand-rolled promise wrapper over IndexedDB. Roughly this surface:

```js
// lifecycle & identity
openDB()  closeDB()  useDatabase(name)      requestPersistentStorage()
makeId()  makeRecord(fields)  hydrateRecord(raw)   getStorageEstimate()

// items
putItem(item, { touch })          getItem(id)
putItems(items)                   getAllItems()
queryItems({ search, type, kind, eventType, tags, sortBy, sortDir,
             dateFrom, dateTo, dateField, offset, limit,
             pinnedFirst, onlyDeleted })         // -> {results,total,hasMore}
getDeletedItems()   softDeleteItem(id)   clearItems()

// revision history (local only)
getVersions(recordId)   clearVersions(recordId)   VERSION_KEEP
versionKey(id, seq)     versionKeyRange(id)

// media
putMedia(rec)  getMedia(id)  deleteMedia(id)  cloneMedia(id)  getAllMediaIds()
makeThumbnail(file)  makeFullImage(file)

// meta + sync log
getMeta(key, default)  setMeta(key, value)  deleteMeta(key)
logActivity(kind, outcome, detail)  getActivityLog()  clearActivityLog()

// ── pure helpers, all unit-tested ────────────────────────────────────────
// normalisation (every one falls back rather than throwing)
normalizeType  normalizeKind  normalizeEventType  normalizeRecurrence
normalizeAmount  normalizeFields  normalizeViews  normalizeSearchText
normalizeUrl  stripTrackingParams  buildHaystack

// querying & ordering
queryItemSet(items, opts)   makeComparator(sortBy, sortDir, pinnedFirst)

// recurrence arithmetic
addSteps(anchor, rule, n)   nextOccurrence(dateIso, rule, fromIso)
completeReminder(record, todayIso)

// analytics
computeStats(items, today)        bucketItemsByWeek(items, weeks, opts)
computeSpend(items, { from, to }) computeIncidents(items)
computeUpcoming(items, today, days)  countEventsBySubject(items)
sortTagsByRecency(items)          reminderTypesInUse(items)
computeBacklinks(items, id)       computeLinkedIdSet(items)
dueNotification(items, today, notifiedThrough)

// revisions & saved views
diffRecords(a, b)   applyVersion(current, version)   DIFFABLE_FIELDS
isEmptyFilterSet(filters)   SAVED_VIEW_MAX

// the capped sync-log ring buffer
appendActivity(log, entry, cap)
```

**Conventions**
- Every query filters out `deletedAt` records except the trash view.
- Search builds one normalized haystack per record (title + body + comment + url +
  any list content), diacritic- and case-insensitive.
- Pagination is offset-based with a "load more" button — no infinite scroll (it fights
  scroll restoration).
- Migrations: bump the IndexedDB version and add stores in `onupgradeneeded`. Never
  rewrite existing records on upgrade; treat missing fields as defaults at read time.
- **Read-time migration is not optional, it is the safety mechanism.** `hydrateRecord`
  fills every missing field on the way out, and a legacy-value map (`note → various`,
  `reading → other`) resolves retired values to current ones. Without it, an unknown
  value falls through to the default, and because sync writes back through the same
  hydration path **that loss is then persisted and cannot be undone**. Crucially,
  hydration must never touch `updatedAt`, or every device would think it held the
  newest copy of everything the moment it upgraded.
- **Normalisers fall back; they never throw and never half-build.** A malformed
  recurrence becomes `null` ("does not repeat"), not `{ every: undefined }` — a rule
  that cannot be computed must read as *no rule*, never as a schedule nobody can
  predict.

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

### Encryption of the remote payload (optional, but cheap)

Local IndexedDB stays **plaintext**, deliberately: the disk is already covered by
full-disk encryption and a device passcode, and encrypting locally costs a prompt every
session, an in-memory search index and any read-only mode — for a threat the operating
system already handles.

What is worth encrypting is the **remote copy**: account numbers and contracts sitting
on someone else's disk, indefinitely, readable by anyone who reaches that account.

```js
// the whole wire format
{ v: 2, enc: "AES-GCM",
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "<b64>" },
  iv: "<b64>", ct: "<b64>" }
```

- **AES-GCM-256**, key derived by **PBKDF2-SHA-256** at 600,000 rounds. All WebCrypto,
  no dependency.
- **The salt travels with the payload.** A second device has never seen it and has no
  other way to derive the same key from the same passphrase; a salt is not a secret.
  Deriving from a fresh one would tell the user their own passphrase was wrong.
- **The passphrase is never stored.** The derived key is, as a **non-extractable
  `CryptoKey`** in IndexedDB — it survives structured clone, so no prompt every
  session, and `exportKey` refuses it (`InvalidAccessError`) so nothing can read it
  back out, including the app.
- **GCM authenticates**, so a wrong key *throws* rather than returning plausible
  nonsense. That is what makes "wrong passphrase" a reportable error instead of silent
  corruption. Unlocking must **prove** the passphrase against the existing envelope
  before storing a key, or the app claims to be unlocked and fails every sync with no
  explanation.
- **Attachments carry a magic header** (`MAGIC | iv | ciphertext`) so files uploaded
  before encryption was switched on still open — the reader must be able to tell the
  two apart without being told which is which. Filenames stay in the clear because
  media reconciliation keys off the `<mediaId>__` prefix.
- **The irreversible part**: lose the passphrase and every backup is lost. Confirm it
  in plain words and offer a printable recovery sheet — which cannot contain the
  passphrase, because the app never keeps it.

### The payload guard — ship it BEFORE you need it

`parseItems` must **refuse what it cannot read** rather than returning `[]`.

An older build parsing an encrypted envelope as "no records" merges that as an empty
remote, and the write-back then uploads its plaintext straight over the encrypted file
— every secret republished in the clear, reported as a *successful sync*. Unrecognised
payloads must abort and name the version so the log says "upgrade this device".

This guard has to be live on **every** device before the encrypting build ships, which
means shipping it one release early. A zero-byte file stays the one benign empty case.

### Error taxonomy

| Code | Meaning | Handling |
|---|---|---|
| 401 | Missing/expired token | Re-auth; do not spam popups on launch |
| 402 | Out of credit/quota (3rd-party APIs) | Surface plainly, do not retry |
| 404 | Remote file/folder gone | Recreate it |
| 409 / conflict | Concurrent write | Re-read, re-merge, retry once |
| offline | `navigator.onLine === false` | Skip, log the reason, no error toast |
| `unreadable` | Corrupt or non-JSON payload | **Abort.** Backups are the recovery path |
| `unsupported-format` | A payload shape this build does not speak | **Abort**, name the version |
| `encrypted` | Recognised envelope, no key held | Stash the salt, ask for the passphrase |
| `needs-passphrase` | Same, surfaced to the UI | Log as a *skip*, not a failure |
| `wrong-passphrase` | Held key does not open the payload | Drop the key, ask again |

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

### 8.4 Sync log
A capped ring buffer (≈60 entries) in the meta store. **Local only — never synced.**

Call it the *sync log*, not "activity". If the app ever gains a timeline of what
happened in the real world (§8.17), two screens called "activity" will send people to
the wrong one every time.

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
after every data change. Route it through the same funnel as the list refresh, or a
change made in one view leaves the badge stale.

### 8.17 Event log / timeline (if the app records history)
Events are records with `kind: "event"` (§5), so this view is a thin renderer over the
same pure query engine. Rows group under sticky month headings, the primary axis is
`occurredAt`, and there is a running total for anything carrying an amount.

**The feature's real risk is that nobody fills it.** Manual journals die within weeks.
The mitigation is that most entries must be *generated*: completing a recurring
reminder writes its maintenance event automatically, and logging from a record
pre-fills the subject and type. If the only events that ever exist are the automatic
ones, the feature still pays for itself.

An event points at its subject through `linkedIds`; **the subject is never modified**,
so logging fifty events leaves its `updatedAt` alone and none of them can lose a race
with an edit from another device.

### 8.18 Recurrence
`recurrence: { every: "day"|"week"|"month"|"quarter"|"year", interval: n }`.

Two controls, not a rule builder. The arithmetic is the entire feature and it is a bug
farm — see §13.

"Done" advances the date **and writes the event**. That is the point: it is the one
moment the user is already telling the app that work happened, so it is the only place
a history can be created without asking for anything extra.

### 8.19 Catch-up notification
There is no server, so there is no push. The honest version is: the app says what is
due **when it is opened**. State that plainly in the UI and recommend a calendar for
anything critical — dressing it up as a reminder system it is not is worse than the
limitation.

- Permission is requested from a **button**, never on load. A prompt on first paint is
  the fastest route to a permanent denial, and there is no second chance.
- Fired via `registration.showNotification`, not `new Notification` — only that form
  survives in an installed PWA and reaches a `notificationclick` handler.
- **Once per day at most**, tracked by a `notifiedThrough` date. Repeating it every
  launch is how an app gets muted for good.
- A click messages an already-open tab rather than navigating it, so an unsaved record
  survives.

### 8.20 Calendar export (`.ics`)
The only mechanism that reaches the user while the app is **closed**. Export `RRULE`
rather than a list of dates, so the calendar owns the recurrence from then on and keeps
firing without the app ever running again.

Deliberately a **download, not a feed**: a subscribable feed would have to be plaintext,
which contradicts §7's encryption — reminder titles are the most descriptive text in the
whole record set — and a `drive.file`-scoped app cannot publish a public URL anyway.

Details that matter: all-day events (`DTEND` is exclusive), a `VALARM` or the entry is
silent, stable `UID`s so re-importing updates rather than duplicates, CRLF line endings
and 75-octet line folding (RFC 5545 requires both and some clients enforce them).

### 8.21 Revision history
The last N saves of each record, restorable, in a **local-only** store (§5).

Snapshot inside the **same transaction** as the write, or a crash between them loses
the old copy and keeps the new one — the single outcome the feature exists to prevent.
Sync writes snapshot too, but **only when `updatedAt` actually moved**: a sync writes
back the whole merged set every time, and snapshotting unchanged rows would fill the
history with copies of itself.

Restoring is an ordinary edit under the **same id** — not the trash's
restore-under-a-new-id. The record never stopped existing, and a new identity would
orphan every event and link pointing at it. Purging must wipe the revisions, or "delete
forever" leaves every field recoverable one panel away.

### 8.22 Bulk selection
A **mode**, not an always-on checkbox column — a column shifts every row sideways
permanently for something used occasionally. In the mode a tap *ticks* rather than
opens; ticked rows get an outline, so nothing moves when the mode turns on.

The selection must be cleared on leaving the view. Acting later on records someone
forgot were ticked is the one way bulk actions go badly wrong. Bulk delete asks with a
dialog rather than the usual undo-toast: forty records is past the point where "did I
mean that?" can be answered from something already fading.

### 8.23 Saved views
A named filter set as a chip above the list — filtering becomes navigation. Cap the
list, refuse to save an **empty** filter set (a view that selects everything is a button
that does nothing), and repaint the chips whenever the filters change, or a chip stays
marked active over a filter set that no longer matches it.

Not synced: a per-device convenience whose merge story would cost more than recreating
one in five seconds.

### 8.24 Paste to create
Paste a file, image, URL or text onto a list and it becomes a pre-filled draft. This is
the **iOS answer to Web Share Target**, which Safari does not implement. Never
intercept a paste aimed at an input.

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

### Rules

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
  in dialogs, ≥44 px touch targets, real contrast in every theme, and an `aria-live`
  region on anything that changes silently (a filtered result count tells a screen
  reader nothing otherwise).

### Colour

Four themes — two dark (`dark`, `midnight`), two light (`light`, `paper`) — each a flat
block of the same ~20 custom properties. No computed colour, no colour maths at
runtime: a theme is a list of values, which is what makes adding one a five-minute job
and a contrast bug a one-line fix.

Two conventions worth stealing:

- **`color-scheme` is set per theme**, so form controls, scrollbars and the caret follow
  without further work.
- **Semantic tokens, not palette names.** `--danger`, `--success`, `--warning`,
  `--text-secondary`, `--text-tertiary`, `--surface`, `--surface-raised`, `--border`.
  A component asks for meaning, never for "blue".

**Per-category accent colours** get their own tokens (`--type-devices`,
`--event-incident`, …) with **a separate set per theme family**: the same hue that reads
well on near-black is illegible on paper. Categorical colour must be defined twice, not
computed once.

### Typography

- **One self-hosted display face** for headings and the brand, `woff2`, subset, with
  `unicode-range` so it is never fetched for text it cannot render. Never a font CDN:
  it breaks offline and adds a third party to a local-first app.
- **System stack for body text.** It is already on the device, it is what the OS renders
  best at small sizes, and it costs nothing.
- **`font-display: swap`** — after the first visit the face is precached, so the swap
  is invisible; blocking would give a blank heading.
- **Declare a weight *range* on a single static face** (`font-weight: 400 700`) if the
  design asks for weights it does not contain. That tells the browser this face covers
  the range, so it renders the real outlines instead of faking a bold by smearing them —
  synthetic bold on a display serif looks awful.
- **Monospace for reference numbers.** Serials, policy and customer numbers are read a
  character at a time and compared against something on paper: a face where `0` and `O`
  differ is not decoration. Pair it with `font-variant-numeric: tabular-nums` anywhere
  figures form a column, so amounts line up on the decimal.

### Information density — getting the most on screen

This is the design problem a data app actually has, and it has three separate answers.

**1. A density preference, and make it mean something.** "Compact" must be a real
change, not 8px of padding: it drops secondary lines entirely and collapses the gaps
between cards into one divided block. In this app it took list rows from 71px to 41px.
Anything less and users conclude the setting does nothing.

**2. Progressive disclosure, with the summary in the header.** A record page that grew
one panel per feature reached **2.8 phone screens with eight sections open**. Collapsing
the secondary panels halved it — but only works if a closed header still answers *"is
there anything in here?"*:

> `Bestanden (2)` · `Geschiedenis (3 · €263,50)` · `Herinnering  15 sep 2026 · jaarlijks`

A panel that must be opened to discover it is empty is worse than no panel. Remember
open/closed **per user, not per record** — someone who always wants attachments visible
wants that everywhere.

Keep *actions* outside the collapsed body. The badge and the "Done" button live in a
strip under the header: burying the control that logs the work is exactly the friction
the collapse was meant to remove.

**3. Delete the line that repeats itself.** Every list row showed `updatedAt` — on
records touched in one sitting, the same date eight times over, occupying the most
valuable line on the row. Replaced by a priority: the reminder date if there is one,
else how much has happened to it, else the date. Same pixels, real information.

The same instinct applies to a compact timeline: drop the *year* from a row that already
sits under a month heading, and drop the category *word* from a row whose coloured icon
already says it. Both are duplication, and removing them buys the title real width.

### Responsive layout — what gives way, in what order

Decide the priority explicitly and let the layout implement it, rather than shrinking
everything equally:

- **A name that truncates is a row you cannot identify.** "CV-ketel Rem…" is worthless;
  a bar 30px shorter still reads fine. So the *bar* shrinks first, and below a
  breakpoint it **moves to its own line** rather than the label losing.
- **Chip rows collapse to one line** with a toggle that appears only when they genuinely
  overflow — measured from a real chip, not assumed. The row auto-opens if the active
  filter could be on a hidden line, and folds back when that reason disappears, unless
  the user opened it by hand: an automatic action must not outrank an explicit one.
- **`auto-fit` with a sensible `minmax`** gives two columns on a phone and three on a
  desktop from one rule. Reach for it before writing a second breakpoint.

### Keyboard

A thumb-shaped app is still used on a desktop. Four shortcuts earn their place — search,
new, jump-to-record, save — and a fuller scheme is a vocabulary nobody asked to learn.
**Modifier shortcuts must work inside text fields** (⌘S while typing is the one people
reach for); bare letters must not, or the letter can never be typed.

---

## 11. Internationalisation

```js
// i18n.js
const dict = { nl: { key: "Nederlands {var}" }, en: { key: "English {var}" } };
t(key, vars)             // interpolates {var}
tCount(key, n)           // picks `key.one` for 1, `key` otherwise
setLang(lang)            // persists to meta
applyTranslations()      // walks the DOM
```

- Static markup uses `data-i18n`, `data-i18n-placeholder`, `data-i18n-aria`.
- Dynamic strings call `t()` at render time — never cache a translated string.
- **Every user-visible string goes in the dictionary.** No exceptions, including toast
  text, error messages, empty states and log labels.
- Language switch must re-render the current view live, not require a reload.
- **Plurals need a `.one` sibling key from the start.** "1 items" is machine output.
  Both NL and EN have exactly two forms, so a sibling key plus a count helper is enough
  — no `Intl.PluralRules` needed — but retrofitting it across a grown dictionary is
  tedious, so add the helper on day one and use it for every counted string.
- A module that takes its translator as a **parameter** (for testability) cannot call
  the helper. Have it ask for the `.one` key and fall back to the plural when the
  dictionary has none, rather than printing a raw key onto a page someone is holding.
- **Test that every key exists in both languages** — and that every *suggestion*,
  category and enum label does too. A missing key renders as its own name, which is the
  kind of thing that ships.
- Keep log/diagnostic detail strings **language-neutral** (`+3 ~1 -2 ↑4`), so a
  diagnostic buffer never sprouts one language's text.

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
- **every normaliser**, including the malformed and retired-value paths
- **date arithmetic exhaustively** — month-end clamping in both directions, leap years,
  a decade-stale anchor, and completion both early and late
- **the payload parser's refusals**, one assertion per error code
- **the crypto round-trip**: that the serialised payload contains none of the plaintext,
  that a wrong key throws, that two encryptions of identical data differ, and that a
  second device can derive the same key from the shipped salt
- **plural forms**, so "1 items" never ships

Everything storage-backed is tested against a **separate database name**
(`useDatabase()`), so the suite can never touch real data.

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

**Sync (continued)**
14. **Never let an unreadable payload parse as empty.** Returning `[]` makes the next
    write-back overwrite the remote with local state. Abort instead. (§7)
15. **Snapshot inside the same transaction as the write.** Two transactions can lose
    the old copy and keep the new one.

**Dates**
16. **Month arithmetic must count whole steps from the ANCHOR, never iteratively.**
    Clamping is lossy: 31 Jan + 1 month = 28 Feb, and stepping again *from that result*
    gives 28 Mar. A monthly reminder silently migrates to the 28th forever. Counting
    from the anchor gives 31 Jan → 28 Feb → **31 Mar** → 30 Apr.
17. **"Done" must advance from whichever is later, the scheduled date or today.**
    Measuring only from today breaks doing a job early — a task due on the 31st,
    completed on the 6th, resolves to "next occurrence after the 6th", which is still
    the 31st, so the button appears to do nothing.
18. **Never `new Date("2026-08")`** — some engines read it as local time and it slips
    into the previous month east of Greenwich. Build an explicit UTC midnight.

**CSS**
19. **`:read-only` matches every `<select>`.** A select is never `:read-write`, so a
    bare `.input:read-only` rule silently strips the border and background off every
    dropdown in the app. Scope such rules to `input` and `textarea`.
20. **Count your grid children.** Four children in a three-column grid pushes the
    fourth onto a row of its own — a whole line of height for one icon, on every row.
21. **Never measure a hidden view.** A hidden section has no layout: every box reports
    0. Writing that back (e.g. as a CSS variable) collapses the element to nothing.
    Bail out when a measurement returns 0 and re-measure once the view is on screen.
22. **A nested row inside a column-direction flex parent inherits `flex: 1` as
    "grow vertically"**, leaving controls floating in a tall empty box.

**i18n**
23. **Plurals need a singular sibling key from day one.** "1 items" is what a machine
    writes, not a person. A `.one` key plus a count helper costs nothing up front and
    is tedious to retrofit across a dictionary.

**Release**
13. **Add every new module to the SW precache list and bump `CACHE_VERSION`**, or
    offline breaks for existing installs only — invisible in dev.
24. **Precache with `cache: "reload"`.** `cache.addAll()` fetches *through the HTTP
    cache*. With any `max-age` on the host (GitHub Pages sends 600s), files fetched in
    the last few minutes are handed over stale and frozen into the brand-new version
    cache — where they stay until the next release, because a version cache is written
    once. The result is a build that is genuinely half old, and **which** halves depends
    on what the browser happened to be holding. Symptom: a fresh `index.html` with a
    stale `i18n.js`, so new UI renders raw translation keys and icons vanish.

    ```js
    const requests = PRECACHE.map((url) => new Request(url, { cache: "reload" }));
    await cache.addAll(requests);   // still atomic
    ```

    Apply the same to any background re-fetch that writes into the live cache.
25. **Add `.nojekyll`** on GitHub Pages. Nothing in a hand-written static app needs
    Jekyll, and skipping it removed ~28 minutes from the deploy in this project
    (29 min → under 1).

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
2. If any precached file changed, bump `CACHE_VERSION` in `sw.js`. A **new module**
   must also be added to the precache list itself.
3. Run `tests.html` — all green. Clear the service worker and caches first, or you may
   be testing yesterday's modules.
4. Exercise the changed flow in a browser; console must be clean.
5. Stage **by filename** (never `git add -A` — editor lock files and OS junk leak in).
6. Commit with a body that explains *why*, not just what.
7. Push only on the explicit word from the owner.
8. **Verify the deploy on the real host**, not just locally: confirm the build number,
   the cache version, and that every precache entry returns 200. A local dev server can
   fail a burst of concurrent requests that the real host serves fine — and can equally
   hide a genuinely missing file.
9. When shipping something that changes the **wire format**, ship the guard that
   recognises it at least one release earlier (§7).

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
- [ ] Counted strings have a singular form
- [ ] New panels/rows measured on a 375px viewport, not just eyeballed on a desktop
- [ ] Anything that changes silently has an `aria-live` region
- [ ] Test data, seeded records and changed preferences cleaned up afterwards

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

## 19. Generic lessons for any local-first PWA

Everything above is a blueprint for one shape of app. This section is the part that
transfers: rules that hold for **any** browser app with local storage and a sync
mechanism, regardless of what it stores. They are ordered by how expensive they are to
retrofit.

### 19.1 The three failure modes that only appear in production

Each of these is invisible on the machine that built the release, which is exactly why
they cost the most.

**A release that is half old.** Service-worker precaching through the HTTP cache
(`cache.addAll` without `cache: "reload"`) freezes stale files into a brand-new version
cache. The mix of old and new is decided by what the browser happened to be holding, so
the symptom differs per device and never reproduces locally. Fix it once, at the
precache, and apply it to every write into the live cache.

**A sync that overwrites what it could not read.** Any parser that returns "empty" for
an unrecognised payload will, one release later, silently republish local state over a
remote it did not understand. Refusing is always correct; the recovery path for genuine
corruption is a backup, never a blind overwrite.

**A migration that wins the merge.** If read-time hydration touches `updatedAt`, every
device believes it holds the newest copy of everything the moment it upgrades, and the
first sync afterwards is a free-for-all. Hydration adds fields; it never restamps.

### 19.2 Storage & schema

- **The envelope is the platform; domain fields are cargo.** Sync, merge, trash,
  export and print operate only on the envelope. Adding a field should require zero
  platform changes — if it does not, the boundary is in the wrong place.
- **Migrate at read time, never by rewriting the store.** Keep a map of retired values
  to current ones. Deleting that map is safe only once no device can still hold an old
  record — which, with sync, is later than it feels.
- **Add axes, not enums.** When a second concept appears, ask whether it is a new value
  of an existing discriminator or a genuinely orthogonal one. A second axis (`kind`)
  keeps the first axis's colour, filters and icons intact; a new enum value throws them
  away. A second *store* costs a second sync file, merge path, trash and export.
- **Generic named fields beat per-type schemas.** One `[{key, value}]` array plus
  per-type *suggestions* gives every type a tailored form without forking anything
  downstream.
- **Normalisers fall back, never throw and never half-build.** Malformed input must
  resolve to the safest complete value ("does not repeat"), not a partial object.
- **Cap and trim on write.** Length limits belong in the normaliser, so nothing
  downstream has to defend against a 40 KB "title".

### 19.3 Sync & conflict

- **Tombstones are the delete mechanism.** A hard delete cannot propagate — the other
  device re-adds it. Every delete is a write.
- **Tombstone always wins** in the merge, whatever the timestamps say, or a
  resurrection race is unwinnable.
- **Restore under a NEW id.** The old tombstone survives and would re-kill the record.
- **Re-read and re-merge immediately before write-back.** Slow media transfers open a
  window in which a local edit gets clobbered by an already-stale merged set.
- **Last-write-wins silently discards the loser.** If that matters, capture what a sync
  is about to overwrite — and keep that capture **local**, because a synced history
  disappears along with the record that lost.
- **Never gate remote cleanup on local state existing.** A blob purged locally seconds
  after deletion leaves its remote copy orphaned forever if the check runs the wrong way
  round.
- **Reconcile binaries by a filename convention** (`<id>__<name>`), so the mapping needs
  no index and survives both sides being rebuilt.
- **Log every skip, not just every failure.** Tokens expiring hourly with no silent
  refresh means most launches legitimately do nothing; without a line saying so, working
  software looks broken.

### 19.4 Encryption, if you add it

- Encrypt the **remote** payload; leave local storage to the OS. The cost/benefit is
  lopsided in both directions.
- Ship the **unknown-payload guard one release early**. It is the only thing standing
  between a mixed-version fleet and a plaintext republish.
- **Ship the salt with the ciphertext**; derive the key on the other device from it.
- **Store a non-extractable `CryptoKey`**, never the passphrase.
- **Prove the passphrase before storing the key**, using the existing payload as the
  probe. Otherwise the app claims to be unlocked and fails forever with no explanation.
- **Self-describe encrypted binaries with a magic header**, so files written before the
  switch still open.
- Say plainly, before switching it on, that losing the passphrase loses everything.

### 19.5 Service worker & release discipline

- **No `skipWaiting()` in `install`.** Claiming clients mid-session hands new assets to
  an already-loaded old page. Let the worker wait, notice it from the app, and offer a
  reload — the swap then happens all at once on a fresh page.
- **Never return the app shell for every navigation.** An unconditional fallback hijacks
  every other document in the project (`tests.html` starts serving the app), which is
  invisible until you wonder why the test page stopped updating.
- **One precache list, one `CACHE_VERSION`, bumped together.** Forgetting breaks offline
  for existing installs only.
- **Precache with `cache: "reload"`.** See §19.1.
- Keep `addAll` (atomic) rather than looping `put` — a half-populated cache is worse
  than none.

### 19.6 Testing without a framework

A single `tests.html` that imports the real modules and runs assertions in the browser
is enough, and it survives having no build step.

- **Split pure from impure deliberately.** `queryItems()` = `queryItemSet(await
  getAllItems(), opts)`. The part that is easy to get wrong becomes the part that is
  easy to test.
- **Test the reasoning, not the implementation.** Assertion messages should say *why*
  ("the oldest goes first — what slipped matters more than what just came up"), so a
  failure years later explains itself.
- **Every bug found in the browser becomes an assertion.** That is what stops the suite
  from only covering what was easy.
- **Watch for tests that cannot fail.** A tautology (`assertEqual(x, cond ? x : x)`)
  passes forever and tests nothing.
- **DOM behaviour is verified by driving the real app**, not by mocking a DOM.

### 19.7 Verifying your own work

- **Measure, do not eyeball.** "The form is too long" is an opinion; "2,314px, 2.8
  screens, eight panels" is a target you can prove you hit.
- **Beware the stale module.** With ES modules and a service worker, a browser will
  happily run yesterday's code and report today's bug. Clear the worker *and* the caches
  before believing any negative result — several "bugs" in this project were the
  previous build.
- **Check your probe before doubting the app.** In this project, a debug snippet calling
  `caches.open(keys[0])` on an empty array created a cache literally named `"undefined"`
  and then read it for several rounds of investigation.
- **Verify on the real host, not the dev server.** A single-threaded local server can
  fail a burst of 32 simultaneous conditional requests that a CDN serves without
  blinking. The deployment target is the environment that counts.
- **Clean up after seeding.** Test data, preference changes and stored keys all outlive
  the check that created them.

### 19.8 Interaction patterns worth copying

- **Undo-toast for reversible destruction, confirm-dialog for irreversible.** And defer
  the actual write to the toast's expiry, so an undone delete never happens at all.
  Above a certain scale (bulk actions), switch to a dialog: "did I mean that?" cannot be
  answered from something already fading.
- **Two-speed persistence.** Save-gated for typed content, write-through for toggles and
  attachments. Document the edge case rather than hiding it.
- **Build widgets once, reset per open.** Rebuilding per open silently accumulates
  listeners.
- **Guard against overlapping async renders** with a sequence number: only the newest
  may paint, and only the newest may raise or clear a loading state. Boot alone can
  fire two renders.
- **Delay skeletons ~180ms.** An IndexedDB read finishes in milliseconds; an immediate
  skeleton flashes on every render and reads as jank.
- **Modes must not outlive their view.** Clear a selection when the view changes.
- **`.ics` is the only background reminder a serverless app has.** Export `RRULE` and
  let the calendar own it.
- **On iOS, prefer paste over Share Target.** Safari does not implement Web Share
  Target and shows no sign of doing so.

### 19.9 Documentation that stays useful

Comment the **decision**, not the mechanism. `// loop over records` earns nothing;
*"counting whole steps from the anchor, because clamping is lossy and stepping from the
clamped result migrates the date permanently"* is the reason the next person does not
"simplify" it back into a bug. Every non-obvious line in this project has a comment
naming the failure it prevents — and this document exists so those reasons outlive the
code they sit in.

---
