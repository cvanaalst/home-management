/**
 * merge.js — PURE conflict resolution (BLUEPRINT §7).
 *
 * This module imports NOTHING. No DOM, no network, no storage. That is what
 * makes it unit-testable, and per the build plan it was written and fully
 * tested before sync.js existed.
 *
 * Everything here is field-agnostic: it operates on the §5 envelope only, so
 * new domain fields ride along without a line changing.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Record resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide which of two versions of the same record survives. PURE.
 *
 * The rules, in order:
 *   1. A TOMBSTONE ALWAYS WINS over a live record, regardless of timestamps.
 *      An edit made on another device after a delete is lost. That is the
 *      accepted trade-off (§3.5) and the reason a deletion can never be
 *      resurrected by a stale device coming back online.
 *   2. Between two tombstones, the newer `updatedAt` wins.
 *   3. Between two live records, the newer `updatedAt` wins.
 *   4. On an exact tie between two tombstones, a PURGED one wins — "delete
 *      forever" is strictly more terminal than a plain tombstone.
 *   5. On any remaining exact tie, `a` wins. mergeItemSets passes the LOCAL
 *      copy as `a`, so a tie resolves to "no change" instead of a pointless
 *      write. This makes the function deliberately asymmetric; the tests say so.
 */
export function resolveRecord(a, b) {
  if (!a) return b || null;
  if (!b) return a;

  const aDead = !!a.deletedAt;
  const bDead = !!b.deletedAt;

  // Rule 1 — the whole design rests on this line.
  if (aDead !== bDead) return aDead ? a : b;

  const aAt = String(a.updatedAt || "");
  const bAt = String(b.updatedAt || "");
  if (aAt !== bAt) return aAt > bAt ? a : b;

  // Rule 4 — equal timestamps, both tombstones.
  if (aDead && !!a.purgedAt !== !!b.purgedAt) return a.purgedAt ? a : b;

  return a; // Rule 5
}

/**
 * Merge two record sets into one. PURE.
 *
 * @param {Array} local   this device's records (including its tombstones)
 * @param {Array} remote  the records read from Drive
 * @returns {{merged: Array, stats: {added:number, updated:number, deleted:number}}}
 *
 * `stats` describes what changed FROM THIS DEVICE'S POINT OF VIEW, because
 * that is what the activity log reports back to the user:
 *   added   — a live record we did not have
 *   deleted — something we could see has become a tombstone
 *   updated — a record we already had, changed by the merge in any other way
 */
export function mergeItemSets(local, remote) {
  const byId = new Map();
  for (const record of local || []) if (record && record.id) byId.set(record.id, record);

  const merged = [];
  const seen = new Set();
  const stats = { added: 0, updated: 0, deleted: 0 };

  for (const record of remote || []) {
    if (!record || !record.id) continue;
    seen.add(record.id);
    const mine = byId.get(record.id) || null;
    const winner = resolveRecord(mine, record);

    if (!mine) {
      // New to us. A tombstone arriving for a record we never had is not a
      // deletion the user can perceive, so it is counted as neither.
      if (!winner.deletedAt) stats.added++;
    } else if (!mine.deletedAt && winner.deletedAt) {
      stats.deleted++;
    } else if (winner !== mine) {
      stats.updated++;
    }
    merged.push(winner);
  }

  // Anything we hold that the remote has never seen survives untouched.
  for (const [id, record] of byId) if (!seen.has(id)) merged.push(record);

  return { merged, stats };
}

/** True when the merge produced nothing the user or Drive needs to know about. */
export function isEmptyMerge(stats) {
  return !stats || (!stats.added && !stats.updated && !stats.deleted);
}

// ═══════════════════════════════════════════════════════════════════════════
// Media filenames
// ═══════════════════════════════════════════════════════════════════════════

/** The separator between a mediaId and its original filename on Drive. */
export const MEDIA_SEPARATOR = "__";

/** "<mediaId>__<filename>" — the only naming scheme Drive media uses. PURE. */
export function mediaFilename(mediaId, filename) {
  return `${mediaId}${MEDIA_SEPARATOR}${filename || "bestand"}`;
}

/**
 * The mediaId encoded in a Drive filename, or null. PURE.
 *
 * Splits on the FIRST separator: the original filename may itself contain
 * "__", and splitting on the last one would silently mangle the id.
 */
export function mediaIdFromFilename(name) {
  const text = String(name || "");
  const at = text.indexOf(MEDIA_SEPARATOR);
  if (at <= 0) return null;
  return text.slice(0, at);
}

// ═══════════════════════════════════════════════════════════════════════════
// Media reconciliation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every mediaId a LIVE record still refers to. PURE.
 * A tombstoned or purged record's attachments are not referenced — that is
 * what makes their blobs collectable on both sides.
 */
export function referencedMediaIds(records) {
  const ids = new Set();
  for (const record of records || []) {
    if (!record || record.deletedAt) continue;
    for (const attachment of record.attachments || []) {
      if (attachment && attachment.mediaId) ids.add(attachment.mediaId);
    }
  }
  return ids;
}

/**
 * Work out which blobs move where. PURE.
 *
 * @param {Array}    merged            the merged record set
 * @param {string[]} localMediaIds     ids held in this device's media store
 * @param {string[]} remoteMediaNames  filenames present in the Drive folder
 * @returns {{toUpload:string[], toDownload:string[],
 *            toDeleteLocal:string[], toDeleteRemoteNames:string[]}}
 *
 * ── The rule that was a real, silent storage leak (§7, §13.7) ──────────────
 * `toDeleteRemoteNames` is derived ONLY from whether the merged records still
 * reference the id. It is deliberately NOT gated on the blob still existing
 * locally: the local blob is purged seconds after a delete, so a check like
 * "delete remotely if we no longer have it locally" never fires for the device
 * that did the deleting, and the Drive copy is orphaned forever.
 *
 * Matching is by the `<mediaId>__` PREFIX, never the whole filename — the
 * original filename is part of the name and cannot be reconstructed from a
 * record alone.
 */
export function computeMediaActions(merged, localMediaIds, remoteMediaNames) {
  const referenced = referencedMediaIds(merged);
  const local = new Set((localMediaIds || []).map(String));

  // A Drive folder can, after an interrupted sync, hold two files for one id.
  // Keep them all so every copy gets cleaned up.
  const remoteById = new Map();
  for (const name of remoteMediaNames || []) {
    const id = mediaIdFromFilename(name);
    if (!id) continue;
    if (!remoteById.has(id)) remoteById.set(id, []);
    remoteById.get(id).push(name);
  }

  const toUpload = [];
  const toDownload = [];
  for (const id of referenced) {
    const hereRemotely = remoteById.has(id);
    const hereLocally = local.has(id);
    if (hereLocally && !hereRemotely) toUpload.push(id);
    else if (!hereLocally && hereRemotely) toDownload.push(id);
  }

  // Local orphans: a blob nothing points at any more.
  const toDeleteLocal = [...local].filter((id) => !referenced.has(id));

  // Remote orphans, by prefix, with no reference to the local store.
  const toDeleteRemoteNames = [];
  for (const [id, names] of remoteById) {
    if (!referenced.has(id)) toDeleteRemoteNames.push(...names);
  }

  return {
    toUpload: toUpload.sort(),
    toDownload: toDownload.sort(),
    toDeleteLocal: toDeleteLocal.sort(),
    toDeleteRemoteNames: toDeleteRemoteNames.sort(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Restore (§8.5) — a restored record comes back under a NEW id
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the pair of records a restore produces. PURE.
 *
 * @param {object} tombstone   the record being restored
 * @param {string} newId       a fresh id from the caller
 * @param {object} mediaIdMap  { oldMediaId: newMediaId } for cloned blobs
 * @param {string} now         ISO timestamp
 * @returns {{revived: object, tombstone: object}}
 *
 * ── Why a new id (§13.6) ───────────────────────────────────────────────────
 * Reviving under the SAME id gets the record re-killed by the next sync that
 * still carries its tombstone — a tombstone always wins. So the revived copy
 * takes a new id, and the original tombstone stays (so the delete keeps
 * propagating) but is marked `restoredAt` so it leaves the trash and cannot be
 * restored twice into duplicates.
 */
export function planRestore(tombstone, newId, mediaIdMap = {}, now = new Date().toISOString()) {
  const revived = {
    ...tombstone,
    id: newId,
    deletedAt: null,
    restoredAt: null,
    purgedAt: null,
    createdAt: tombstone.createdAt || now,
    updatedAt: now,
    // Point at the cloned blobs, not the originals: the old tombstone's media
    // is still collectable, and two records must never share one blob.
    attachments: (tombstone.attachments || []).map((attachment) => ({
      ...attachment,
      mediaId: mediaIdMap[attachment.mediaId] || attachment.mediaId,
    })),
  };

  return {
    revived,
    tombstone: { ...tombstone, restoredAt: now, updatedAt: now },
  };
}

/**
 * Strip a tombstone down to a bare marker: "delete forever" (§8.5). PURE.
 *
 * The record is NOT removed — a hard delete cannot propagate, and the other
 * device would re-add it on the next sync. Content is wiped, `purgedAt` is set,
 * and the empty tombstone remains to keep enforcing the deletion.
 */
export function planPurge(tombstone, now = new Date().toISOString()) {
  return {
    id: tombstone.id,
    type: tombstone.type,
    createdAt: tombstone.createdAt,
    updatedAt: now,
    deletedAt: tombstone.deletedAt || now,
    restoredAt: tombstone.restoredAt || null,
    purgedAt: now,
    title: "",
    comment: "",
    tags: [],
    pinned: false,
    reminderAt: null,
    linkedIds: [],
    body: "",
    reminderType: "",
    links: [],
    attachments: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Backup retention (§8.2)
//
// Lives here for the same reason computeMediaActions does: it is pure
// sync-support logic with no DOM, no network and no storage, so it can be
// tested directly rather than against a live Drive.
// ═══════════════════════════════════════════════════════════════════════════

/** How many backups to keep. The legacy app kept ten; no reason to differ. */
export const BACKUP_KEEP = 10;

/**
 * Which backup files to delete. PURE.
 *
 * Backups accumulated forever until this existed — a folder of hundreds of
 * near-identical files, distinguishable only by a timestamp in the name.
 *
 * Ordering is by NAME, not by Drive's modifiedTime: the names are
 * `backup-<ISO>.json`, and an ISO timestamp sorts lexicographically in the
 * same order as chronologically. Drive's own timestamps can be rewritten by an
 * unrelated metadata change, which would make the wrong file look newest and
 * delete a good backup.
 *
 * @param {{id:string,name:string}[]} files  everything in the backups folder
 * @param {number} keep                      how many of the newest to keep
 * @returns {{id:string,name:string}[]}      the ones to delete, oldest first
 */
export function planBackupPruning(files, keep = BACKUP_KEEP) {
  const backups = (files || []).filter(
    (file) => file && typeof file.name === "string" && /^backup-.+\.json$/i.test(file.name)
  );
  // Newest first, so the survivors are the head of the list.
  backups.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const doomed = backups.slice(Math.max(0, keep));
  // Hand them back oldest first: if the run is interrupted the oldest are
  // already gone, which is the order a human would have chosen.
  return doomed.reverse();
}
