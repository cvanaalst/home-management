/**
 * view-report.js — insights (BLUEPRINT §4, §8.8).
 *
 * Tiles, a per-type breakdown, a 12-week bar chart and a tag cloud. The chart
 * is hand-drawn <rect> elements: a charting library would be the single
 * heaviest dependency in the app, for four dozen rectangles (§3.2).
 *
 * All the arithmetic lives in db.js as pure, tested functions; this module only
 * turns numbers into DOM.
 */

import { state } from "./state.js";
import { t, typeLabel } from "./i18n.js";
import { icon } from "./icons.js";
import {
  TYPES,
  getAllItems,
  computeStats,
  bucketItemsByWeek,
  sortTagsByRecency,
  computeSpend,
  computeIncidents,
  computeUpcoming,
} from "./db.js";
import { formatDate, todayIso, formatAmount, daysUntil, reminderTone, reminderLabel } from "./ui.js";

const WEEKS = 12;
const SVG_NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

let callbacks = { onFilterByType: () => {}, onFilterByTag: () => {}, onOpen: () => {} };
let root;

export function initReportView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };
  root = $("report-body");
  root.className = "view__body report";
}

/** Rebuild the whole view. Cheap enough to redo on every open. */
export async function renderReport() {
  if (!root) return;
  const items = await getAllItems();
  const today = todayIso();
  const stats = computeStats(items, today);

  root.textContent = "";

  if (!stats.total) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    const glyph = document.createElement("span");
    glyph.className = "placeholder__icon";
    glyph.innerHTML = icon("chart", { size: 44 });
    const title = document.createElement("p");
    title.className = "placeholder__title";
    title.textContent = t("report.empty");
    empty.append(glyph, title);
    root.append(empty);
    return;
  }

  const year = today.slice(0, 4);
  const spend = computeSpend(items, { from: `${year}-01-01`, to: `${year}-12-31` });

  root.append(buildTiles(stats, spend, year));
  root.append(buildUpcoming(items, today));
  if (spend.bySubject.length) root.append(buildSpend(spend, year));
  const incidents = computeIncidents(items);
  if (incidents.length) root.append(buildIncidents(incidents));
  root.append(buildTypeBreakdown(stats));
  root.append(buildWeekChart(items, today));
  root.append(buildTagCloud(items));
}

// ═══════════════════════════════════════════════════════════════════════════
// Tiles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Six tiles that answer questions, not eight that report counts.
 *
 * What went: "Links" and "Bestanden", which were nearly always zero — a tile
 * that never changes is furniture. What arrived: what the house has cost this
 * year, and how much of its history is on record. Both come from data the app
 * has been collecting since the timeline shipped and never showed anywhere.
 */
function buildTiles(stats, spend, year) {
  const panel = section("view.report.title");
  const grid = document.createElement("div");
  grid.className = "tiles";

  const tiles = [
    { key: "report.total", value: String(stats.total), glyph: "list" },
    {
      key: "report.spendYear",
      label: t("report.spendYear", { year }),
      value: formatAmount(spend.total, state.lang) || "—",
      glyph: "event-payment",
      tone: spend.total ? "accent" : "",
    },
    // Overdue / today / this week rather than a combined "needs attention":
    // that total is equal to "overdue" most days, so it reads as a duplicate
    // and buries the one number that actually differs.
    { key: "report.overdue", value: String(stats.overdue), glyph: "bell", tone: stats.overdue ? "danger" : "" },
    { key: "report.dueToday", value: String(stats.dueToday), glyph: "bell", tone: stats.dueToday ? "warn" : "" },
    { key: "report.dueWeek", value: String(stats.dueWeek), glyph: "calendar" },
    { key: "report.events", value: String(stats.events), glyph: "timeline" },
  ];

  for (const tile of tiles) {
    const box = document.createElement("div");
    box.className = `tile${tile.tone ? ` tile--${tile.tone}` : ""}`;
    const glyph = document.createElement("span");
    glyph.className = "tile__icon";
    glyph.innerHTML = icon(tile.glyph, { size: 18 });
    const value = document.createElement("span");
    value.className = "tile__value";
    value.textContent = tile.value;
    const label = document.createElement("span");
    label.className = "tile__label";
    label.textContent = tile.label || t(tile.key);
    box.append(glyph, value, label);
    grid.append(box);
  }

  panel.append(grid);
  return panel;
}

/**
 * The next ninety days, overdue first.
 *
 * Overdue entries are INCLUDED rather than filtered out: something three weeks
 * late is more upcoming than something due next month, and hiding it because
 * its date has passed is how a planner quietly stops mentioning the one thing
 * you most need to do.
 */
function buildUpcoming(items, today) {
  const panel = section("report.upcoming");
  const upcoming = computeUpcoming(items, today, 90);

  if (!upcoming.length) {
    panel.append(muted(t("report.upcoming.none")));
    return panel;
  }

  const list = document.createElement("div");
  list.className = "upcoming";
  for (const record of upcoming.slice(0, 8)) {
    const days = daysUntil(record.reminderAt, today);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "upcoming__row";
    row.addEventListener("click", () => callbacks.onOpen(record.id));

    const glyph = document.createElement("span");
    glyph.className = "upcoming__icon";
    glyph.innerHTML = icon(`type-${record.type}`, { size: 16 });
    glyph.style.color = `var(--type-${record.type})`;

    const text = document.createElement("span");
    text.className = "upcoming__text";
    text.textContent = record.title || t("detail.newRecord");

    const when = document.createElement("span");
    when.className = `reminder reminder--${reminderTone(days)}`;
    when.textContent = reminderLabel(days);

    row.append(glyph, text, when);
    list.append(row);
  }
  panel.append(list);
  return panel;
}

/** What each thing has cost, biggest first. */
function buildSpend(spend, year) {
  const panel = section("report.spend");
  const total = document.createElement("p");
  total.className = "field__hint";
  total.textContent = t("report.spend.total", {
    year,
    amount: formatAmount(spend.total, state.lang),
    count: spend.count,
  });
  panel.append(total);

  const max = Math.max(...spend.bySubject.map((s) => s.amount), 1);
  const list = document.createElement("div");
  list.className = "breakdown";
  for (const entry of spend.bySubject.slice(0, 8)) {
    list.append(
      breakdownRow({
        id: entry.id,
        label: entry.title || t("detail.newRecord"),
        type: entry.type,
        ratio: entry.amount / max,
        value: formatAmount(entry.amount, state.lang),
      })
    );
  }
  panel.append(list);
  return panel;
}

/** Which things break most — incidents only, so upkeep does not mask failure. */
function buildIncidents(incidents) {
  const panel = section("report.incidents");
  const max = Math.max(...incidents.map((i) => i.count), 1);
  const list = document.createElement("div");
  list.className = "breakdown";
  for (const entry of incidents.slice(0, 6)) {
    list.append(
      breakdownRow({
        id: entry.id,
        label: entry.title || t("detail.newRecord"),
        type: entry.type,
        ratio: entry.count / max,
        value: String(entry.count),
        colourVar: "--event-incident",
      })
    );
  }
  panel.append(list);
  return panel;
}

function breakdownRow({ id, label, type, ratio, value, colourVar }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "breakdown__row";
  row.addEventListener("click", () => callbacks.onOpen(id));

  const name = document.createElement("span");
  name.className = "breakdown__label";
  name.innerHTML = icon(`type-${type}`, { size: 14 });
  name.style.color = `var(--type-${type})`;
  name.append(document.createTextNode(label));

  const track = document.createElement("span");
  track.className = "breakdown__track";
  const fill = document.createElement("span");
  fill.className = "breakdown__fill";
  fill.style.width = `${Math.max(4, Math.round(ratio * 100))}%`;
  fill.style.background = `var(${colourVar || `--type-${type}`})`;
  track.append(fill);

  const amount = document.createElement("span");
  amount.className = "breakdown__value";
  amount.textContent = value;

  row.append(name, track, amount);
  return row;
}

function muted(text) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-type breakdown — each bar filters the list
// ═══════════════════════════════════════════════════════════════════════════

function buildTypeBreakdown(stats) {
  const panel = section("report.byType");
  const list = document.createElement("div");
  list.className = "bars";

  const max = Math.max(1, ...TYPES.map((type) => stats.byType[type] || 0));

  for (const type of TYPES) {
    const count = stats.byType[type] || 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bar";
    row.style.setProperty("--bar-colour", `var(--type-${type})`);
    row.disabled = count === 0;
    row.addEventListener("click", () => callbacks.onFilterByType(type));

    const label = document.createElement("span");
    label.className = "bar__label";
    label.innerHTML = icon(`type-${type}`, { size: 15 });
    label.append(document.createTextNode(typeLabel(type)));

    const track = document.createElement("span");
    track.className = "bar__track";
    const fill = document.createElement("span");
    fill.className = "bar__fill";
    fill.style.width = `${(count / max) * 100}%`;
    track.append(fill);

    const value = document.createElement("span");
    value.className = "bar__value";
    value.textContent = String(count);

    row.append(label, track, value);
    list.append(row);
  }

  panel.append(list);
  return panel;
}

// ═══════════════════════════════════════════════════════════════════════════
// 12-week chart — hand-drawn SVG
// ═══════════════════════════════════════════════════════════════════════════

function buildWeekChart(items, today) {
  const panel = section("report.perWeek");

  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.textContent = t("report.weeksHint");
  panel.append(hint);

  // Records only, to match the tiles above it — a chart counting events too
  // would show a busy month where nothing was actually filed.
  const buckets = bucketItemsByWeek(items, WEEKS, { field: "createdAt", today, kind: "record" });
  const max = Math.max(1, ...buckets.map((b) => b.count));

  // A viewBox plus width:100% makes the chart resolution-independent with no
  // measuring and no resize handling.
  const W = 300;
  const H = 90;
  const gap = 4;
  const barW = (W - gap * (buckets.length - 1)) / buckets.length;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("preserveAspectRatio", "none");
  // A chart that only exists visually is invisible to a screen reader; the
  // whole series goes in the label.
  svg.setAttribute(
    "aria-label",
    buckets
      .map((b) => t("report.week", { date: formatDate(b.start, state.lang), count: b.count }))
      .join(", ")
  );

  buckets.forEach((bucket, index) => {
    // An empty week still gets a sliver, so the axis reads as a timeline
    // rather than as gaps.
    const height = bucket.count === 0 ? 2 : Math.max(3, (bucket.count / max) * (H - 12));
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(index * (barW + gap)));
    rect.setAttribute("y", String(H - height));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", "1.5");
    rect.setAttribute("class", bucket.count ? "chart__bar" : "chart__bar chart__bar--empty");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = t("report.week", {
      date: formatDate(bucket.start, state.lang),
      count: bucket.count,
    });
    rect.append(title);
    svg.append(rect);
  });

  const frame = document.createElement("div");
  frame.className = "chart__frame";
  frame.append(svg);

  const axis = document.createElement("div");
  axis.className = "chart__axis";
  const first = document.createElement("span");
  first.textContent = formatDate(buckets[0].start, state.lang);
  const last = document.createElement("span");
  last.textContent = formatDate(buckets[buckets.length - 1].start, state.lang);
  axis.append(first, last);

  panel.append(frame, axis);
  return panel;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tag cloud — each tag filters the list
// ═══════════════════════════════════════════════════════════════════════════

function buildTagCloud(items) {
  const panel = section("report.tagCloud");
  const tags = sortTagsByRecency(items);

  if (!tags.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = t("list.noTags");
    panel.append(empty);
    return panel;
  }

  const cloud = document.createElement("div");
  cloud.className = "cloud";
  const max = Math.max(...tags.map((tag) => tag.count));

  for (const entry of tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip chip--tag";
    // Size carries frequency, but the count is printed too — size alone is not
    // something everyone can compare.
    chip.style.fontSize = `${0.8 + (entry.count / max) * 0.45}rem`;
    chip.append(document.createTextNode(entry.tag));
    const count = document.createElement("span");
    count.className = "chip__count";
    count.textContent = String(entry.count);
    chip.append(count);
    chip.addEventListener("click", () => callbacks.onFilterByTag(entry.tag));
    cloud.append(chip);
  }

  panel.append(cloud);
  return panel;
}

function section(titleKey) {
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h2");
  heading.className = "panel__title";
  heading.textContent = t(titleKey);
  panel.append(heading);
  return panel;
}
