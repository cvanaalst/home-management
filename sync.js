/**
 * sync.js — Google Drive REST + OAuth + sync/backup/restore (BLUEPRINT §7, §8).
 *
 * ── What this talks to ─────────────────────────────────────────────────────
 * Google Drive v3, with the `drive.file` scope ONLY. That scope means the app
 * can see nothing in the user's Drive except the files it created itself — it
 * cannot read one other document (§3.3). There is no server and no client
 * secret; an OAuth client ID for a browser app is public by design.
 *
 * ── Two ways to get a token, both needed ───────────────────────────────────
 *   1. Google Identity Services (`accounts.google.com/gsi/client`) in a popup.
 *      Loaded LAZILY, only when the user signs in, so the app stays fully
 *      usable offline and no third-party script is ever precached.
 *   2. A hand-rolled implicit redirect, used when GIS cannot load or the popup
 *      is blocked. §7 makes this mandatory: on an iOS standalone PWA popups
 *      simply fail. A "pending action" is stored before redirecting and resumed
 *      after the reload.
 *
 * Tokens last about an hour and there is NO silent refresh in either flow, so
 * the app is signed out most of the time. That is normal; auto-sync logs the
 * skip rather than nagging (§13.5).
 *
 * ── Drive layout (§7) ──────────────────────────────────────────────────────
 *   Huisbeheer/
 *     items.json                      the full record set
 *     <mediaId>__<filename>           one file per media blob
 *     backups/
 *       backup-2026-08-05T18-30-00-000Z.json
 */

import {
  getMeta,
  setMeta,
  getAllItems,
  putItems,
  clearItems,
  getMedia,
  putMedia,
  deleteMedia,
  getAllMediaIds,
  logActivity,
} from "./db.js";
import {
  mergeItemSets,
  computeMediaActions,
  mediaFilename,
  mediaIdFromFilename,
  planBackupPruning,
  BACKUP_KEEP,
} from "./merge.js";
import {
  cryptoAvailable,
  makeSalt,
  deriveKey,
  isEnvelope,
  envelopeKdf,
  encryptPayload,
  decryptPayload,
  encryptBlob,
  decryptBlob,
  toBase64,
  fromBase64,
  KDF_ITERATIONS,
} from "./crypto.js";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Optional build-time client ID. Leave empty and paste one in Settings instead
 * — that is the documented route (see the setup guide in the blueprint). An
 * OAuth client ID for a browser app is NOT a secret; it is safe in source.
 */
const DEFAULT_CLIENT_ID = "236659380710-npqb9gbgr470bbfrppcksbqbluic4d68.apps.googleusercontent.com";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Huisbeheer";
const BACKUP_FOLDER = "backups";
const ITEMS_FILE = "items.json";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Treat a token as expired this early, so a sync never dies mid-flight. */
const EXPIRY_BUFFER_MS = 120000;

/** Don't auto-sync more often than this. */
const AUTO_SYNC_MIN_GAP_MS = 5 * 60 * 1000;

const META = {
  clientId: "sync.clientId",
  token: "sync.token",
  enabled: "sync.enabled",
  lastSyncAt: "sync.lastSyncAt",
  folderId: "sync.folderId",
  pending: "sync.pendingAction",
  authState: "sync.authState",

  // Encryption (§7). The KEY is stored as a non-extractable CryptoKey, which
  // survives structured clone into IndexedDB and cannot be read back out — not
  // by another script, and not by this one. The PASSPHRASE is never stored.
  encKey: "enc.key",
  encSalt: "enc.salt",
  encIterations: "enc.iterations",
  encEnabled: "enc.enabled",
  // Salt seen on a remote envelope this device cannot yet open, so Settings
  // can derive the same key once the passphrase is typed in.
  encPending: "enc.pendingKdf",
};

// ═══════════════════════════════════════════════════════════════════════════
// Encryption (§7)
// ═══════════════════════════════════════════════════════════════════════════

/** Is the Drive payload meant to be encrypted on this device? */
export async function isEncryptionOn() {
  return !!(await getMeta(META.encEnabled, false));
}

/** Do we hold a usable key right now? */
export async function hasEncryptionKey() {
  return !!(await getMeta(META.encKey, null));
}

async function encryptionKey() {
  return getMeta(META.encKey, null);
}

/**
 * What Settings needs to draw the panel, in one call.
 * `locked` is the state that matters: encryption is on somewhere, but this
 * device cannot open it until the passphrase is entered.
 */
export async function encryptionStatus() {
  const [enabled, key, pending] = await Promise.all([
    isEncryptionOn(),
    hasEncryptionKey(),
    getMeta(META.encPending, null),
  ]);
  return {
    supported: cryptoAvailable(),
    enabled,
    unlocked: !!key,
    locked: !!pending && !key,
  };
}

/**
 * Turn encryption on with a new passphrase, or unlock a payload another device
 * already encrypted.
 *
 * The salt is NOT invented when one already exists. A remote envelope carries
 * the salt it was written with, and deriving from a fresh one would produce a
 * different key for the same passphrase — the user would be told their own
 * passphrase is wrong, on a file they encrypted themselves.
 */
export async function setPassphrase(passphrase) {
  if (!cryptoAvailable()) throw new SyncError("no-crypto");
  const phrase = String(passphrase || "");
  if (phrase.length < 8) throw new SyncError("passphrase-short");

  const pending = await getMeta(META.encPending, null);
  const storedSalt = await getMeta(META.encSalt, null);

  let salt;
  let iterations = KDF_ITERATIONS;
  if (pending) {
    salt = fromBase64(pending.salt);
    iterations = pending.iterations || KDF_ITERATIONS;
  } else if (storedSalt) {
    salt = fromBase64(storedSalt);
    iterations = (await getMeta(META.encIterations, KDF_ITERATIONS)) || KDF_ITERATIONS;
  } else {
    salt = makeSalt();
  }

  const key = await deriveKey(phrase, salt, iterations);

  // Unlocking an existing payload must PROVE the passphrase before it is
  // accepted. Storing a wrong key would leave the app claiming to be unlocked
  // and failing on every sync with no explanation.
  if (pending && pending.probe) {
    try {
      await decryptPayload({ iv: pending.probe.iv, ct: pending.probe.ct }, key);
    } catch {
      throw new SyncError("wrong-passphrase");
    }
  }

  await setMeta(META.encKey, key);
  await setMeta(META.encSalt, toBase64(salt));
  await setMeta(META.encIterations, iterations);
  await setMeta(META.encEnabled, true);
  await setMeta(META.encPending, null);
  await logActivity("sync", "success", pending ? "unlocked" : "encryption on");
  return { ok: true };
}

/**
 * Stop encrypting. The key is dropped and the next sync writes plaintext.
 *
 * Deliberately does NOT reach out to Drive: the plaintext write happens on the
 * next ordinary sync, which is the only moment the whole merged set is in hand
 * anyway. Until then the remote stays encrypted and readable, because the salt
 * is kept — turning it back on with the same passphrase still works.
 */
export async function disableEncryption() {
  await setMeta(META.encKey, null);
  await setMeta(META.encEnabled, false);
  await setMeta(META.encPending, null);
  await logActivity("sync", "success", "encryption off");
}

/** Forget the key without disabling, so the passphrase is asked for again. */
export async function lockEncryption() {
  await setMeta(META.encKey, null);
}

// ═══════════════════════════════════════════════════════════════════════════
// Status events (§8.1)
// ═══════════════════════════════════════════════════════════════════════════

const listeners = new Set();

/** Subscribe to "syncing" | "success" | "error" | "idle". Returns unsubscribe. */
export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status, detail = "") {
  for (const fn of listeners) {
    try {
      fn(status, detail);
    } catch {
      /* a broken listener must never break a sync */
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration accessors
// ═══════════════════════════════════════════════════════════════════════════

export async function getClientId() {
  const stored = await getMeta(META.clientId, "");
  return String(stored || DEFAULT_CLIENT_ID || "").trim();
}

/**
 * True when this build ships its own client ID.
 *
 * The settings panel uses it to hide the credentials field entirely: if the
 * deployment already carries an ID there is nothing to enter, and leaving an
 * empty-looking box on screen above a working sync only invites someone to
 * paste something into it and break their own setup.
 */
export function hasBuiltInClientId() {
  return !!String(DEFAULT_CLIENT_ID || "").trim();
}

export async function setClientId(value) {
  await setMeta(META.clientId, String(value || "").trim());
  await setMeta(META.token, null); // a different project means a different token
}

export async function isSyncEnabled() {
  return !!(await getMeta(META.enabled, false));
}

export async function setSyncEnabled(value) {
  await setMeta(META.enabled, !!value);
}

export async function getLastSyncAt() {
  return await getMeta(META.lastSyncAt, null);
}

/** Everything the settings panel needs to describe the current state. */
export async function getSyncState() {
  const [clientId, enabled, lastSyncAt, token] = await Promise.all([
    getClientId(),
    isSyncEnabled(),
    getLastSyncAt(),
    getMeta(META.token, null),
  ]);
  return {
    configured: !!clientId,
    enabled,
    lastSyncAt,
    signedIn: !!(token && token.expiresAt > Date.now() + EXPIRY_BUFFER_MS),
    expiresAt: token ? token.expiresAt : null,
  };
}

export async function signOut() {
  await setMeta(META.token, null);
}

// ═══════════════════════════════════════════════════════════════════════════
// OAuth
// ═══════════════════════════════════════════════════════════════════════════

/** A cached token, or null. Never triggers a sign-in. */
async function cachedToken() {
  const token = await getMeta(META.token, null);
  if (!token || !token.accessToken) return null;
  if (token.expiresAt <= Date.now() + EXPIRY_BUFFER_MS) return null;
  return token.accessToken;
}

/**
 * The redirect URI, normalised to always end in "/".
 *
 * Google matches redirect_uri EXACTLY. Without this normalisation the value
 * would be ".../index.html" when the user arrived via that filename and ".../"
 * when they arrived at the directory — two different strings for one app, only
 * one of which is registered, and the other fails with redirect_uri_mismatch.
 */
export function redirectUri() {
  const path = location.pathname.replace(/index\.html$/i, "");
  return `${location.origin}${path.endsWith("/") ? path : `${path}/`}`;
}

/**
 * The JavaScript origin, which is NOT the same thing as the redirect URI.
 * Google rejects an origin containing a path ("Invalid Origin: URIs must not
 * contain a path"), so the two fields need two different values.
 */
export function javascriptOrigin() {
  return location.origin;
}

function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false); // offline, or blocked — use the redirect
    document.head.append(script);
    // Never hang the UI on a third-party script that may never answer.
    setTimeout(() => resolve(!!(window.google && window.google.accounts)), 8000);
  });
}

/**
 * Ask Google for a token via the GIS popup.
 * Resolves with the token, or null when the popup could not be used at all.
 */
async function requestTokenViaPopup(clientId) {
  const ready = await loadGis();
  if (!ready) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (response) => {
          if (response && response.access_token) {
            done({
              accessToken: response.access_token,
              expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            });
          } else done(null);
        },
        error_callback: () => done(null),
      });
      client.requestAccessToken();
      // A blocked popup sometimes fires no callback at all.
      setTimeout(() => done(null), 90000);
    } catch {
      done(null);
    }
  });
}

/**
 * Full-page redirect to Google (the implicit flow), by hand — no library.
 * This never returns: the browser leaves the page.
 */
async function redirectToGoogle(clientId, pendingAction) {
  const nonce = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  await setMeta(META.authState, nonce);
  await setMeta(META.pending, pendingAction || "sync");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "token");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", nonce);
  location.assign(url.toString());
}

/**
 * Consume an OAuth response sitting in the URL fragment after a redirect.
 * Call once at boot, BEFORE the router reads the hash.
 *
 * @returns {Promise<null|{resume: string}>} the action to resume, if any
 */
export async function consumeRedirectResult() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!raw.includes("access_token=") && !raw.includes("error=")) return null;

  const params = new URLSearchParams(raw);
  const expectedState = await getMeta(META.authState, null);
  const pending = await getMeta(META.pending, null);
  await setMeta(META.authState, null);
  await setMeta(META.pending, null);

  // Strip the token out of the address bar before anything else can read it,
  // and before it can end up in a bookmark or in history.
  history.replaceState(null, "", `${location.pathname}${location.search}`);

  if (params.get("error")) {
    await logActivity("sync", "error", `OAuth: ${params.get("error")}`);
    return null;
  }
  // A mismatched state means the response is not the one we asked for.
  if (!expectedState || params.get("state") !== expectedState) {
    await logActivity("sync", "error", "OAuth state mismatch");
    return null;
  }

  const accessToken = params.get("access_token");
  if (!accessToken) return null;
  await setMeta(META.token, {
    accessToken,
    expiresAt: Date.now() + Number(params.get("expires_in") || 3600) * 1000,
  });
  return { resume: pending || "sync" };
}

/**
 * Get a usable token, signing in if allowed.
 * @param {{interactive?: boolean, action?: string}} opts
 */
async function ensureToken({ interactive = false, action = "sync" } = {}) {
  const existing = await cachedToken();
  if (existing) return existing;
  if (!interactive) return null;

  const clientId = await getClientId();
  if (!clientId) throw new SyncError("not-configured");

  const viaPopup = await requestTokenViaPopup(clientId);
  if (viaPopup) {
    await setMeta(META.token, viaPopup);
    return viaPopup.accessToken;
  }

  // The popup route failed. Redirect instead — this does not return.
  await redirectToGoogle(clientId, action);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drive REST
// ═══════════════════════════════════════════════════════════════════════════

export class SyncError extends Error {
  constructor(code, detail = "") {
    super(detail || code);
    this.code = code;
    this.detail = detail;
  }
}

async function driveFetch(token, path, { method = "GET", headers = {}, body, raw = false } = {}) {
  const url = path.startsWith("http") ? path : `https://www.googleapis.com${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
  } catch (err) {
    throw new SyncError("offline", err.message);
  }

  if (response.status === 401) {
    await setMeta(META.token, null); // force a fresh sign-in next time
    throw new SyncError("unauthorised");
  }
  if (response.status === 402) throw new SyncError("quota");
  if (response.status === 404) throw new SyncError("not-found");
  if (response.status === 409) throw new SyncError("conflict");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SyncError("http", `${response.status} ${text.slice(0, 120)}`);
  }
  if (raw) return response;
  if (response.status === 204) return null;
  return response.json();
}

function query(parts) {
  return parts.filter(Boolean).join(" and ");
}

async function findFolder(token, name, parentId) {
  const q = query([
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    parentId ? `'${parentId}' in parents` : "'root' in parents",
    "trashed = false",
  ]);
  const result = await driveFetch(
    token,
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`
  );
  return result.files && result.files[0] ? result.files[0].id : null;
}

async function createFolder(token, name, parentId) {
  const body = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const created = await driveFetch(token, "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return created.id;
}

/** The app folder id, created on first use. Cached in meta but re-verified. */
async function ensureFolder(token) {
  const cached = await getMeta(META.folderId, null);
  if (cached) {
    try {
      await driveFetch(token, `/drive/v3/files/${cached}?fields=id,trashed`);
      return cached;
    } catch (err) {
      // 404 means the user deleted it in Drive; recreate rather than fail (§7).
      if (!(err instanceof SyncError) || err.code !== "not-found") throw err;
    }
  }
  const found = (await findFolder(token, FOLDER_NAME, null)) || (await createFolder(token, FOLDER_NAME, null));
  await setMeta(META.folderId, found);
  return found;
}

async function listFolder(token, folderId) {
  const files = [];
  let pageToken = "";
  do {
    const q = query([`'${folderId}' in parents`, "trashed = false"]);
    const result = await driveFetch(
      token,
      `/drive/v3/files?q=${encodeURIComponent(q)}` +
        `&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size)` +
        `&pageSize=1000&spaces=drive${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    files.push(...(result.files || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return files;
}

/** Multipart upload — metadata and bytes in one request. */
async function uploadFile(token, { fileId, name, parents, blob, mimeType }) {
  const boundary = `hms${Math.random().toString(36).slice(2)}`;
  const metadata = {};
  if (name) metadata.name = name;
  if (parents && !fileId) metadata.parents = parents;

  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, blob, tail], { type: `multipart/related; boundary=${boundary}` });

  const path = fileId
    ? `/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id`
    : `/upload/drive/v3/files?uploadType=multipart&fields=id`;

  return driveFetch(token, path, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function downloadFile(token, fileId, { asBlob = false } = {}) {
  const response = await driveFetch(token, `/drive/v3/files/${fileId}?alt=media`, { raw: true });
  return asBlob ? response.blob() : response.text();
}

async function deleteFile(token, fileId) {
  try {
    await driveFetch(token, `/drive/v3/files/${fileId}`, { method: "DELETE", raw: true });
  } catch (err) {
    // Already gone is a success, not a failure.
    if (!(err instanceof SyncError) || err.code !== "not-found") throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The sync sequence (§7)
// ═══════════════════════════════════════════════════════════════════════════

let inFlight = null;

/**
 * Two-way sync. Safe to call concurrently — the second caller joins the first.
 * @param {{interactive?: boolean, kind?: string}} opts
 */
export async function syncNow({ interactive = true, kind = "sync" } = {}) {
  if (inFlight) return inFlight;
  inFlight = runSync({ interactive, kind }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync({ interactive, kind }) {
  if (!navigator.onLine) {
    await logActivity(kind, "skipped", "offline");
    emit("idle");
    return { skipped: "offline" };
  }

  emit("syncing");
  try {
    const token = await ensureToken({ interactive, action: "sync" });
    if (!token) {
      // Either not signed in and not allowed to ask, or a redirect is underway.
      await logActivity(kind, "skipped", interactive ? "redirecting to sign in" : "not signed in");
      emit("idle");
      return { skipped: "no-token" };
    }

    const folderId = await ensureFolder(token);
    const files = await listFolder(token, folderId);
    const itemsFile = files.find((f) => f.name === ITEMS_FILE) || null;

    // 1 — read the remote set
    let remote = [];
    if (itemsFile) {
      const text = await downloadFile(token, itemsFile.id);
      remote = await readPayload(text);
    }

    // 2 — merge
    const local = await getAllItems();
    const first = mergeItemSets(local, remote);

    // 3 — reconcile media
    const mediaFiles = files.filter(
      (f) => f.mimeType !== FOLDER_MIME && f.name !== ITEMS_FILE && mediaIdFromFilename(f.name)
    );
    const actions = computeMediaActions(
      first.merged,
      await getAllMediaIds(),
      mediaFiles.map((f) => f.name)
    );
    const mediaStats = await reconcileMedia(token, folderId, actions, mediaFiles, first.merged);

    // 4 — RE-READ and RE-MERGE (§7 step 4). Media transfer can take a long
    // time, and an edit made during that window would otherwise be clobbered
    // by the now-stale merged set.
    const localAgain = await getAllItems();
    const final = mergeItemSets(localAgain, first.merged);
    await putItems(final.merged);

    // 5 — write back
    const payload = await writePayload(final.merged);
    await uploadFile(token, {
      fileId: itemsFile ? itemsFile.id : null,
      name: ITEMS_FILE,
      parents: [folderId],
      blob: new Blob([payload], { type: "application/json" }),
      mimeType: "application/json",
    });

    const at = new Date().toISOString();
    await setMeta(META.lastSyncAt, at);
    const detail = describe(first.stats, mediaStats);
    await logActivity(kind, "success", detail);
    emit("success", detail);
    return { ok: true, stats: first.stats, media: mediaStats };
  } catch (err) {
    const detail = err instanceof SyncError ? `${err.code}${err.detail ? `: ${err.detail}` : ""}` : String(err.message || err);
    // "Not configured" and "offline" are states, not failures. Logging them as
    // errors puts a red dot in the activity log for someone who simply has not
    // set sync up yet, which makes working software look broken.
    const skipped =
      err instanceof SyncError &&
      (err.code === "not-configured" || err.code === "offline" || err.code === "needs-passphrase");
    await logActivity(kind, skipped ? "skipped" : "error", detail);
    emit(skipped ? "idle" : "error", detail);
    if (err instanceof SyncError) return skipped ? { skipped: err.code } : { error: err.code, detail: err.detail };
    throw err;
  }
}

function describe(stats, media) {
  const parts = [];
  if (stats.added) parts.push(`+${stats.added}`);
  if (stats.updated) parts.push(`~${stats.updated}`);
  if (stats.deleted) parts.push(`-${stats.deleted}`);
  if (media.uploaded) parts.push(`↑${media.uploaded}`);
  if (media.downloaded) parts.push(`↓${media.downloaded}`);
  if (media.removed) parts.push(`⌫${media.removed}`);
  return parts.length ? parts.join(" ") : "no changes";
}

/**
 * Read a sync payload. THROWS on anything it does not understand.
 *
 * ── Why this refuses instead of shrugging ──────────────────────────────────
 * It used to return [] for an unreadable file, on the reasoning that a corrupt
 * remote must not destroy the local set. That reasoning inverts as soon as the
 * payload can legitimately be something this build cannot read — an encrypted
 * envelope, or any future format. An empty parse merges to "the remote has
 * nothing", and step 5 then uploads this device's plaintext set straight over
 * it. One device left on an old build would silently undo the encryption and
 * republish every account number in the clear, and the only trace would be a
 * successful-looking sync.
 *
 * So: an unrecognised payload aborts the sync. Nothing is read, nothing is
 * written, and the sync log says why. Ten rolling backups are the recovery
 * path for a genuinely corrupt file — a blind overwrite never was one.
 *
 * A zero-byte file is the one benign case (Drive can hand back an empty
 * placeholder) and still reads as empty.
 */
export function parseItems(text) {
  if (!String(text || "").trim()) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SyncError("unreadable", `not JSON: ${String(err.message || err).slice(0, 80)}`);
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) return parsed.items;

  // An envelope this build DOES understand, but cannot open without a key.
  // Not an error the sync should swallow — see readPayload().
  if (isEnvelope(parsed)) throw new SyncError("encrypted", "payload is encrypted");

  // Recognisably a payload, just not one this build speaks. Name the version so
  // the sync log says "upgrade this device" rather than "something went wrong".
  if (parsed && typeof parsed === "object") {
    const version = parsed.v ?? parsed.version;
    throw new SyncError(
      "unsupported-format",
      version !== undefined ? `payload v${version}` : "unknown payload shape"
    );
  }

  throw new SyncError("unreadable", `unexpected ${typeof parsed}`);
}

/**
 * Read a payload, decrypting it if it is an envelope and we hold the key.
 *
 * When it is encrypted and we do NOT, the envelope's salt and a small probe are
 * stashed so Settings can derive the same key the moment a passphrase is typed,
 * and a `needs-passphrase` error stops the sync. Stopping matters: carrying on
 * with an empty remote would merge to "Drive has nothing" and upload this
 * device's plaintext straight over the encrypted file.
 */
async function readPayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "").trim() || "[]");
  } catch {
    return parseItems(text); // let it raise the specific error
  }

  if (!isEnvelope(parsed)) return parseItems(text);

  const key = await encryptionKey();
  if (!key) {
    const kdf = parsed.kdf || {};
    await setMeta(META.encPending, {
      salt: kdf.salt,
      iterations: Number(kdf.iterations) || KDF_ITERATIONS,
      // The envelope itself is the probe: if it decrypts, the passphrase is
      // right. Nothing extra is written to Drive to make this possible.
      probe: { iv: parsed.iv, ct: parsed.ct },
    });
    throw new SyncError("needs-passphrase", "remote payload is encrypted");
  }

  let items;
  try {
    items = await decryptPayload(parsed, key);
  } catch {
    // The key we hold does not open this file — the passphrase was changed on
    // another device. Drop the key so the UI asks again rather than failing
    // silently on every sync from here on.
    const kdf = parsed.kdf || {};
    await setMeta(META.encPending, {
      salt: kdf.salt,
      iterations: Number(kdf.iterations) || KDF_ITERATIONS,
      probe: { iv: parsed.iv, ct: parsed.ct },
    });
    await setMeta(META.encKey, null);
    throw new SyncError("wrong-passphrase", "stored key does not open the remote payload");
  }

  if (Array.isArray(items)) return items;
  if (items && Array.isArray(items.items)) return items.items;
  throw new SyncError("unreadable", "decrypted payload is not a record set");
}

/**
 * Serialise the record set for upload, encrypting when a key is held.
 * Returns text either way, because both forms are JSON on the wire.
 */
async function writePayload(records) {
  const key = await encryptionKey();
  if (!key || !(await isEncryptionOn())) return JSON.stringify(records);
  const salt = fromBase64(await getMeta(META.encSalt, ""));
  const iterations = (await getMeta(META.encIterations, KDF_ITERATIONS)) || KDF_ITERATIONS;
  return JSON.stringify(await encryptPayload(records, key, salt, iterations));
}



async function reconcileMedia(token, folderId, actions, mediaFiles, records) {
  const stats = { uploaded: 0, downloaded: 0, removed: 0 };
  const nameById = new Map();
  for (const file of mediaFiles) nameById.set(mediaIdFromFilename(file.name), file);

  // Original filenames live on the records, not in the media store.
  const filenameById = new Map();
  const mimeById = new Map();
  for (const record of records) {
    for (const attachment of record.attachments || []) {
      if (!attachment || !attachment.mediaId) continue;
      filenameById.set(attachment.mediaId, attachment.filename);
      if (attachment.mimeType) mimeById.set(attachment.mediaId, attachment.mimeType);
    }
  }

  // A PDF of an insurance policy is exactly as sensitive as the JSON
  // describing it, so attachments go through the same key. The filename is
  // NOT encrypted — §7 reconciles media by the `<mediaId>__` prefix, and
  // hiding it would mean re-implementing that from scratch for no real gain,
  // since the record set that names those files is already encrypted.
  const key = await encryptionKey();
  const encrypting = key && (await isEncryptionOn());

  for (const mediaId of actions.toUpload) {
    const media = await getMedia(mediaId);
    if (!media || !media.blob) continue;
    const payload = encrypting ? await encryptBlob(media.blob, key) : media.blob;
    await uploadFile(token, {
      name: mediaFilename(mediaId, filenameById.get(mediaId)),
      parents: [folderId],
      blob: payload,
      mimeType: encrypting ? "application/octet-stream" : media.blob.type || "application/octet-stream",
    });
    stats.uploaded++;
  }

  for (const mediaId of actions.toDownload) {
    const file = nameById.get(mediaId);
    if (!file) continue;
    const raw = await downloadFile(token, file.id, { asBlob: true });

    // decryptBlob hands back anything WITHOUT the header untouched, so files
    // uploaded before encryption was switched on still open. The MIME type
    // comes from the record, because ciphertext cannot carry one.
    let blob = raw;
    if (key) {
      try {
        blob = await decryptBlob(raw, key, mimeById.get(mediaId) || "application/octet-stream");
      } catch {
        // One unreadable attachment must not abort a whole sync — the records
        // matter more. It stays on Drive and can be retried.
        continue;
      }
    }
    await putMedia({ id: mediaId, blob, thumbnailBlob: null });
    stats.downloaded++;
  }

  for (const mediaId of actions.toDeleteLocal) await deleteMedia(mediaId);

  for (const name of actions.toDeleteRemoteNames) {
    const file = mediaFiles.find((f) => f.name === name);
    if (!file) continue;
    await deleteFile(token, file.id);
    stats.removed++;
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-sync (§13.5 — log every skip, or it looks broken)
// ═══════════════════════════════════════════════════════════════════════════

export async function maybeAutoSync() {
  if (!(await isSyncEnabled())) return { skipped: "disabled" };
  if (!(await getClientId())) {
    await logActivity("autosync", "skipped", "not configured");
    return { skipped: "not-configured" };
  }
  if (!navigator.onLine) {
    await logActivity("autosync", "skipped", "offline");
    return { skipped: "offline" };
  }
  const last = await getLastSyncAt();
  if (last && Date.now() - Date.parse(last) < AUTO_SYNC_MIN_GAP_MS) {
    return { skipped: "too-soon" };
  }
  if (!(await cachedToken())) {
    // The normal case: tokens last about an hour and there is no silent
    // refresh, so most launches land here. Log it or sync looks broken.
    await logActivity("autosync", "skipped", "signed out");
    return { skipped: "signed-out" };
  }
  return syncNow({ interactive: false, kind: "autosync" });
}

// ═══════════════════════════════════════════════════════════════════════════
// Backup and restore (§8.2, §8.3)
// ═══════════════════════════════════════════════════════════════════════════

async function ensureBackupFolder(token, folderId) {
  return (
    (await findFolder(token, BACKUP_FOLDER, folderId)) ||
    (await createFolder(token, BACKUP_FOLDER, folderId))
  );
}

/** Write a timestamped copy into backups/. Independent of sync (§8.2). */
export async function backupNow() {
  if (!navigator.onLine) {
    await logActivity("backup", "skipped", "offline");
    return { skipped: "offline" };
  }
  emit("syncing");
  try {
    const token = await ensureToken({ interactive: true, action: "backup" });
    if (!token) {
      await logActivity("backup", "skipped", "not signed in");
      emit("idle");
      return { skipped: "no-token" };
    }
    const folderId = await ensureFolder(token);
    const backupFolder = await ensureBackupFolder(token, folderId);
    const items = await getAllItems();
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await uploadFile(token, {
      name,
      parents: [backupFolder],
      blob: new Blob([await writePayload(items)], { type: "application/json" }),
      mimeType: "application/json",
    });
    // Prune AFTER the new one is safely uploaded, never before: an interrupted
    // run then costs an old backup, not the one being taken right now.
    const pruned = await pruneBackups(token, backupFolder);

    // Same terse, language-neutral shape the sync detail uses (↑↓⌫), rather
    // than a sentence — the log is not i18n'd and must not sprout Dutch (§11).
    const detail = `${name} (${items.length})` + (pruned ? ` ⌫${pruned}` : "");
    await logActivity("backup", "success", detail);
    emit("success", name);
    return { ok: true, name, pruned };
  } catch (err) {
    const detail = err instanceof SyncError ? err.code : String(err.message || err);
    await logActivity("backup", "error", detail);
    emit("error", detail);
    return { error: detail };
  }
}

/**
 * Delete all but the newest BACKUP_KEEP backups. Returns how many went.
 *
 * Failures here are swallowed on purpose: the backup itself already succeeded,
 * and reporting "backup failed" because tidying up did would be a lie that
 * discourages the user from backing up at all.
 */
async function pruneBackups(token, backupFolder) {
  try {
    const files = await listFolder(token, backupFolder);
    const doomed = planBackupPruning(files, BACKUP_KEEP);
    for (const file of doomed) await deleteFile(token, file.id);
    return doomed.length;
  } catch {
    return 0;
  }
}

/** Backups on Drive, newest first (§8.3). */
export async function listBackups() {
  const token = await ensureToken({ interactive: true, action: "restore" });
  if (!token) return null;
  const folderId = await ensureFolder(token);
  const backupFolder = await findFolder(token, BACKUP_FOLDER, folderId);
  if (!backupFolder) return [];
  const files = await listFolder(token, backupFolder);
  return files
    .filter((f) => f.name.endsWith(".json"))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/**
 * Restore from a backup (§8.3).
 *
 * @param {string} fileId
 * @param {"merge"|"replace"} mode
 *
 * `merge`   runs the backup through the normal LWW merge.
 * `replace` makes the backup the truth locally AND re-uploads it immediately,
 *           because otherwise the very next sync would merge the current Drive
 *           contents back in and silently undo the restore.
 */
export async function restoreBackup(fileId, mode = "merge") {
  emit("syncing");
  try {
    const token = await ensureToken({ interactive: true, action: "restore" });
    if (!token) {
      emit("idle");
      return { skipped: "no-token" };
    }
    const text = await downloadFile(token, fileId);
    const backup = await readPayload(text);

    if (mode === "replace") {
      await clearItems();
      await putItems(backup);
      const folderId = await ensureFolder(token);
      const files = await listFolder(token, folderId);
      const itemsFile = files.find((f) => f.name === ITEMS_FILE) || null;
      await uploadFile(token, {
        fileId: itemsFile ? itemsFile.id : null,
        name: ITEMS_FILE,
        parents: [folderId],
        blob: new Blob([await writePayload(backup)], { type: "application/json" }),
        mimeType: "application/json",
      });
    } else {
      const local = await getAllItems();
      const { merged } = mergeItemSets(local, backup);
      await putItems(merged);
    }

    // Either way, pull down any media the restored records refer to.
    const after = await getAllItems();
    const folderId = await ensureFolder(token);
    const files = await listFolder(token, folderId);
    const mediaFiles = files.filter(
      (f) => f.mimeType !== FOLDER_MIME && f.name !== ITEMS_FILE && mediaIdFromFilename(f.name)
    );
    const actions = computeMediaActions(after, await getAllMediaIds(), mediaFiles.map((f) => f.name));
    // Only download; a restore must never delete anything as a side effect.
    for (const mediaId of actions.toDownload) {
      const file = mediaFiles.find((f) => mediaIdFromFilename(f.name) === mediaId);
      if (!file) continue;
      const blob = await downloadFile(token, file.id, { asBlob: true });
      await putMedia({ id: mediaId, blob, thumbnailBlob: null });
    }

    await logActivity("restore", "success", `${mode} (${backup.length})`);
    emit("success", mode);
    return { ok: true, mode, count: backup.length };
  } catch (err) {
    const detail = err instanceof SyncError ? err.code : String(err.message || err);
    await logActivity("restore", "error", detail);
    emit("error", detail);
    return { error: detail };
  }
}

/** Import a JSON export from disk through the same merge path (§2.3, §8.3). */
export async function importJson(text, mode = "merge") {
  let incoming;
  try {
    incoming = parseItems(text);
  } catch (err) {
    // Someone picked the wrong file, or an encrypted export. Either way this is
    // a user mistake, not a fault — report it and leave the store untouched.
    const detail = err instanceof SyncError ? err.code : String(err.message || err);
    await logActivity("restore", "error", `import ${detail}`);
    return { error: detail };
  }
  if (!incoming.length) return { error: "empty" };
  if (mode === "replace") {
    await clearItems();
    await putItems(incoming);
  } else {
    const { merged } = mergeItemSets(await getAllItems(), incoming);
    await putItems(merged);
  }
  await logActivity("restore", "success", `import ${mode} (${incoming.length})`);
  return { ok: true, count: incoming.length };
}
