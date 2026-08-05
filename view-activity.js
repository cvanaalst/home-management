/**
 * view-activity.js — the sync activity log (BLUEPRINT §4, §8.4).
 *
 * This is the app's black box. When someone says "sync isn't working", this is
 * the first and usually the only diagnostic needed — which is why every SKIP
 * is recorded too, not just failures. Auto-sync skips on most launches because
 * OAuth tokens last about an hour with no silent refresh (§13.5); without a
 * line saying so, working software looks broken.
 *
 * The log is local only and is never synced.
 */

import { state } from "./state.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { getActivityLog, clearActivityLog } from "./db.js";
import { formatDateTime, confirmDialog, toast } from "./ui.js";

const $ = (id) => document.getElementById(id);
let root;

export function initActivityView() {
  root = $("activity-body");
  root.className = "view__body activity";
}

export async function renderActivity() {
  if (!root) return;
  const entries = await getActivityLog();
  root.textContent = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    const glyph = document.createElement("span");
    glyph.className = "placeholder__icon";
    glyph.innerHTML = icon("activity", { size: 44 });
    const title = document.createElement("p");
    title.className = "placeholder__title";
    title.textContent = t("activity.empty.title");
    const body = document.createElement("p");
    body.className = "placeholder__body";
    body.textContent = t("activity.empty.body");
    empty.append(glyph, title, body);
    root.append(empty);
    return;
  }

  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.textContent = t("activity.hint");
  root.append(hint);

  const list = document.createElement("div");
  list.className = "log";
  for (const entry of entries) list.append(buildRow(entry));
  root.append(list);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn--ghost btn--small";
  clear.textContent = t("activity.clear");
  clear.addEventListener("click", async () => {
    if (!(await confirmDialog(t("activity.clear.confirm"), t("activity.clear")))) return;
    await clearActivityLog();
    toast(t("activity.cleared"), "info", { duration: 1800 });
    await renderActivity();
  });
  root.append(clear);
}

function buildRow(entry) {
  const row = document.createElement("div");
  row.className = "log__row";

  const dot = document.createElement("span");
  dot.className = `log__dot log__dot--${entry.outcome}`;
  dot.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "log__text";

  const head = document.createElement("span");
  head.className = "log__head";
  head.textContent = `${t(`activity.kind.${entry.kind}`)} · ${t(`activity.outcome.${entry.outcome}`)}`;

  const when = document.createElement("span");
  when.className = "log__when";
  when.textContent = formatDateTime(entry.at, state.lang);

  text.append(head, when);
  if (entry.detail) {
    const detail = document.createElement("span");
    detail.className = "log__detail";
    detail.textContent = entry.detail;
    text.append(detail);
  }

  row.append(dot, text);
  return row;
}

export function refreshActivityLanguage() {
  if (!$("view-activity").hidden) renderActivity();
}
