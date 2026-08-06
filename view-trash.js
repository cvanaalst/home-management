/**
 * view-trash.js — Recently deleted (BLUEPRINT §4, §8.5).
 *
 * Lists tombstones newest first, excluding ones already restored or purged.
 * The two actions differ sharply in kind, so they differ in confirmation:
 *   • Restore is reversible — no dialog.
 *   • Delete forever is not — a confirm dialog, per §9.
 */

import { state } from "./state.js";
import { t, typeLabel } from "./i18n.js";
import { icon } from "./icons.js";
import {
  getDeletedItems,
  putItem,
  getItem,
  cloneMedia,
  deleteMedia,
  makeId,
  clearVersions,
} from "./db.js";
import { planRestore, planPurge } from "./merge.js";
import { toast, confirmDialog, formatDateTime } from "./ui.js";

const $ = (id) => document.getElementById(id);

let callbacks = { onChanged: () => {}, onOpen: () => {} };
let root;

export function initTrashView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };
  root = $("trash-body");
  root.className = "view__body trash";
}

export async function renderTrash() {
  if (!root) return;
  const items = await getDeletedItems();
  root.textContent = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    const glyph = document.createElement("span");
    glyph.className = "placeholder__icon";
    glyph.innerHTML = icon("trash", { size: 44 });
    const title = document.createElement("p");
    title.className = "placeholder__title";
    title.textContent = t("trash.empty.title");
    const body = document.createElement("p");
    body.className = "placeholder__body";
    body.textContent = t("trash.empty.body");
    empty.append(glyph, title, body);
    root.append(empty);
    return;
  }

  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.textContent = t("trash.hint");
  root.append(hint);

  const list = document.createElement("ul");
  list.className = "record-list";
  for (const item of items) list.append(buildRow(item));
  root.append(list);
}

function buildRow(item) {
  const li = document.createElement("li");
  li.className = "record";
  li.style.setProperty("--record-colour", `var(--type-${item.type})`);

  const surface = document.createElement("div");
  surface.className = "record__surface";

  const main = document.createElement("div");
  main.className = "record__main record__main--static";

  const glyph = document.createElement("span");
  glyph.className = "record__icon";
  glyph.innerHTML = icon(`type-${item.type}`, { size: 20 });
  glyph.title = typeLabel(item.type);

  const text = document.createElement("span");
  text.className = "record__text";
  const title = document.createElement("span");
  title.className = "record__title";
  title.textContent = item.title || t("detail.newRecord");
  const meta = document.createElement("span");
  meta.className = "record__meta";
  meta.textContent = t("trash.deletedAt", { when: formatDateTime(item.deletedAt, state.lang) });
  text.append(title, meta);

  const actions = document.createElement("span");
  actions.className = "trash__actions edit-only";

  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "btn btn--ghost btn--small";
  restore.textContent = t("trash.restore");
  restore.addEventListener("click", () => restoreItem(item));

  const purge = document.createElement("button");
  purge.type = "button";
  purge.className = "btn btn--ghost btn--small btn--danger-text";
  purge.textContent = t("trash.purge");
  purge.addEventListener("click", () => purgeItem(item));

  actions.append(restore, purge);
  main.append(glyph, text, actions);
  surface.append(main);
  li.append(surface);
  return li;
}

/**
 * Restore under a NEW id, with its media cloned (§8.5, §13.6).
 * Reviving the original id would get it re-killed by the next sync that still
 * carries its tombstone — a tombstone always wins.
 */
async function restoreItem(item) {
  const mediaIdMap = {};
  for (const attachment of item.attachments || []) {
    if (!attachment || !attachment.mediaId) continue;
    const clonedId = await cloneMedia(attachment.mediaId);
    if (clonedId) mediaIdMap[attachment.mediaId] = clonedId;
  }

  const { revived, tombstone } = planRestore(item, makeId(), mediaIdMap);
  await putItem(revived, { touch: false });
  await putItem(tombstone, { touch: false });

  toast(t("trash.restored", { title: revived.title || t("detail.newRecord") }), "success");
  await renderTrash();
  callbacks.onChanged();
}

/** Delete forever: irreversible, so this one DOES get a confirm dialog (§9). */
async function purgeItem(item) {
  const ok = await confirmDialog(
    t("trash.purge.confirm", { title: item.title || t("detail.newRecord") }),
    t("trash.purge.ok")
  );
  if (!ok) return;

  for (const attachment of item.attachments || []) {
    if (attachment && attachment.mediaId) await deleteMedia(attachment.mediaId);
  }
  // The bare tombstone stays so the deletion keeps propagating; only the
  // content is wiped. The Drive copy goes on the next sync, by id prefix.
  await putItem(planPurge(item), { touch: false });

  // …and the local revision history goes with it. "Delete forever" that leaves
  // every field recoverable one panel away is not delete forever. Done AFTER
  // the write, because that write snapshots the pre-purge copy itself.
  await clearVersions(item.id);

  toast(t("trash.purged"), "info");
  await renderTrash();
  callbacks.onChanged();
}

export function refreshTrashLanguage() {
  if (!$("view-trash").hidden) renderTrash();
}
