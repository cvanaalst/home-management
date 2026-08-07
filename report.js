/**
 * report.js — PURE export and print builders (BLUEPRINT §8.6, §8.7).
 *
 * §4's file list does not name this module; it folds "report/export logic" into
 * "the reporting + export layer". Keeping it separate from the views is what
 * makes it testable: every function here takes records in and returns a string
 * or an object out, with no DOM and no storage.
 *
 * The one concession to purity: translated labels arrive as a `t` function
 * passed by the caller, rather than importing i18n and reading global state.
 * Tests hand it a stub.
 */

import { formatDate, formatDateTime, daysUntil, formatAmount } from "./ui.js";
import { renderMarkdown, markdownToPlain } from "./markdown.js";

/** Local escape — report.js builds HTML strings and must not trust any field. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON — the full-fidelity backup format (§8.6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Everything, exactly as stored. PURE.
 *
 * Tombstones are INCLUDED on purpose: this is the format restore reads back,
 * and a backup that quietly dropped its tombstones would resurrect every
 * record you have ever deleted the next time you restored it.
 */
export function toJsonExport(records, { build, exportedAt } = {}) {
  return {
    app: "huisbeheer",
    format: 1,
    build: build ?? null,
    exportedAt: exportedAt || new Date().toISOString(),
    count: (records || []).length,
    items: [...(records || [])],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV — flattened for a spreadsheet (§8.6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Separator. Excel in a Dutch/Belgian locale expects `;` and drops a
 * comma-separated file into a single column, which makes the export useless
 * exactly where it is most likely to be opened. Every field that could contain
 * a `;` is quoted, so this stays unambiguous.
 */
export const CSV_SEPARATOR = ";";

export const CSV_COLUMNS = [
  "kind", "type", "title", "tags", "occurredAt", "eventType", "amount",
  "reminderAt", "reminderType", "pinned",
  "comment", "fields", "links", "attachments", "body", "createdAt", "updatedAt", "id",
];

/**
 * Escape one CSV cell. PURE.
 *
 * The leading-quote guard is not cosmetic: a spreadsheet treats a cell opening
 * with = + - or @ as a FORMULA, so a note titled "=cmd|..." becomes executable
 * content in Excel. Prefixing an apostrophe forces it back to text.
 */
export function csvCell(value) {
  let out = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (out.includes('"') || out.includes("\n") || out.includes("\r") ||
      out.includes(CSV_SEPARATOR) || out.includes(",")) {
    out = `"${out.replace(/"/g, '""')}"`;
  }
  return out;
}

/** Flatten one record to primitives, in CSV_COLUMNS order. PURE. */
export function recordToRow(record, { t, lang = "nl" } = {}) {
  const label = t || ((key) => key);
  const kind = record.kind === "event" ? "event" : "record";
  return {
    kind: label(`kind.${kind}`),
    type: label(`type.${record.type}`),
    title: record.title,
    tags: (record.tags || []).join(", "),
    occurredAt: record.occurredAt || "",
    eventType: kind === "event" ? label(`eventType.${record.eventType}`) : "",
    // Raw, not formatted: a spreadsheet must be able to SUM this column, and
    // "€ 89,50" is text. The locale-formatted figure belongs on screen.
    amount: typeof record.amount === "number" ? String(record.amount) : "",
    reminderAt: record.reminderAt || "",
    reminderType: record.reminderType || "",
    pinned: record.pinned ? "1" : "",
    comment: record.comment || "",
    fields: (record.fields || []).map((f) => `${f.key}: ${f.value}`).join(" | "),
    links: (record.links || []).map((l) => `${l.label || ""} <${l.url || ""}>`).join(" | "),
    attachments: (record.attachments || []).map((a) => a.filename).join(" | "),
    body: record.body || "",
    createdAt: formatDateTime(record.createdAt, lang),
    updatedAt: formatDateTime(record.updatedAt, lang),
    id: record.id,
  };
}

/** The whole live record set as CSV text. PURE. */
export function toCsv(records, { t, lang = "nl" } = {}) {
  const label = t || ((key) => key);
  const header = CSV_COLUMNS.map((c) => csvCell(label(`csv.${c}`))).join(CSV_SEPARATOR);
  const rows = (records || [])
    .filter((r) => r && !r.deletedAt)
    .map((record) => {
      const row = recordToRow(record, { t, lang });
      return CSV_COLUMNS.map((c) => csvCell(row[c])).join(CSV_SEPARATOR);
    });
  // A trailing newline: some tools drop the final row without it.
  return [header, ...rows].join("\r\n") + "\r\n";
}

// ═══════════════════════════════════════════════════════════════════════════
// Print (§8.7)
// ═══════════════════════════════════════════════════════════════════════════

/** Live records grouped by type, each group sorted by title. PURE. */
export function groupByType(records, types) {
  const groups = new Map();
  for (const record of records || []) {
    if (!record || record.deletedAt) continue;
    if (!groups.has(record.type)) groups.set(record.type, []);
    groups.get(record.type).push(record);
  }
  for (const list of groups.values()) {
    list.sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }
  // Keep the canonical type order rather than insertion order, so two prints
  // of the same collection always come out identical.
  const order = types || [...groups.keys()];
  return order.filter((type) => groups.has(type)).map((type) => ({ type, records: groups.get(type) }));
}

function reminderCell(record, { t, lang, today }) {
  if (!record.reminderAt) return "—";
  const days = daysUntil(record.reminderAt, today);
  const date = formatDate(record.reminderAt, lang);
  if (days === null) return esc(record.reminderAt);
  if (days < 0) {
    const late = Math.abs(days);
    // Both languages have exactly two forms, so a `.one` sibling key is enough.
    const key = late === 1 ? "print.overdue.one" : "print.overdue";
    return `${esc(date)} · ${esc(t(key, { days: late }))}`;
  }
  if (days === 0) return `${esc(date)} · ${esc(t("reminder.today"))}`;
  return esc(date);
}

/**
 * The printable document body, as an HTML string for #print-root. PURE.
 *
 * @param {Array} records
 * @param {{t:Function, lang:string, today:string, includeBody:boolean,
 *          title:string, single:boolean, types?:string[]}} opts
 */
/**
 * The event log as a printable document, grouped by month. PURE.
 *
 * A different shape from the record print on purpose. Records print grouped by
 * TYPE, because that is how you look something up. Events print in date order,
 * because a history only means anything in sequence — and it ends with what it
 * all cost, which is the question anyone printing a maintenance log is
 * actually asking.
 *
 * `records` is the whole set: events name their subject by id, and the print
 * has to resolve those to titles.
 */
export function buildEventPrintHtml(events, records, opts = {}) {
  const { t, lang = "nl", title } = opts;
  const label = t || ((key) => key);
  const live = (events || []).filter((e) => e && !e.deletedAt);
  const byId = new Map((records || []).filter((r) => r && !r.deletedAt).map((r) => [r.id, r]));

  const total = live.reduce((sum, e) => sum + (typeof e.amount === "number" ? e.amount : 0), 0);
  const withAmount = live.filter((e) => typeof e.amount === "number").length;

  const head =
    `<header class="print__head">` +
    `<h1>${esc(title || label("print.events.title"))}</h1>` +
    `<p class="print__meta">${esc(label("print.generated"))} ` +
    `${esc(formatDateTime(new Date().toISOString(), lang))} · ` +
    `${esc(count(label, "print.events.count", live.length))}` +
    (withAmount
      ? ` · ${esc(label("print.events.total", { amount: formatAmount(total, lang) }))}`
      : "") +
    `</p></header>`;

  if (!live.length) {
    return `${head}<p class="print__empty">${esc(label("print.events.none"))}</p>`;
  }

  // Newest first, matching the timeline the user printed from.
  const sorted = [...live].sort((a, b) =>
    String(b.occurredAt || "").localeCompare(String(a.occurredAt || ""))
  );

  const months = [];
  const index = new Map();
  for (const event of sorted) {
    const key = String(event.occurredAt || "").slice(0, 7) || "—";
    if (!index.has(key)) {
      index.set(key, { key, events: [] });
      months.push(index.get(key));
    }
    index.get(key).events.push(event);
  }

  const subjectOf = (event) => {
    for (const id of event.linkedIds || []) {
      const subject = byId.get(id);
      if (subject && subject.kind !== "event") return subject.title || "";
    }
    return "";
  };

  const body = months
    .map((month) => {
      const monthTotal = month.events.reduce(
        (sum, e) => sum + (typeof e.amount === "number" ? e.amount : 0),
        0
      );
      return (
        `<section class="print__group">` +
        `<h2>${esc(monthLabel(month.key, lang))}` +
        (monthTotal ? ` <span class="print__total">${esc(formatAmount(monthTotal, lang))}</span>` : "") +
        `</h2>` +
        `<table><thead><tr>` +
        `<th>${esc(label("print.col.date"))}</th>` +
        `<th>${esc(label("print.col.event"))}</th>` +
        `<th>${esc(label("print.col.what"))}</th>` +
        `<th>${esc(label("print.col.subject"))}</th>` +
        `<th class="print__num">${esc(label("print.col.amount"))}</th>` +
        `</tr></thead><tbody>` +
        month.events
          .map(
            (event) =>
              `<tr>` +
              `<td>${esc(event.occurredAt ? formatDate(event.occurredAt, lang) : "—")}</td>` +
              `<td>${esc(event.title || "—")}</td>` +
              `<td>${esc(label(`eventType.${event.eventType}`))}</td>` +
              `<td>${esc(subjectOf(event) || "—")}</td>` +
              `<td class="print__num">${
                typeof event.amount === "number" ? esc(formatAmount(event.amount, lang)) : ""
              }</td>` +
              `</tr>` +
              (event.body && event.body.trim()
                ? `<tr class="print__note"><td></td><td colspan="4">${esc(
                    markdownToPlain(event.body, 400)
                  )}</td></tr>`
                : "")
          )
          .join("") +
        `</tbody></table></section>`
      );
    })
    .join("");

  return head + body;
}

/**
 * Singular/plural without importing i18n. PURE.
 *
 * report.js takes its translator as a parameter by design (§8.6) so it stays
 * testable with a stub, which means it cannot call tCount directly — it asks
 * for the `.one` key and falls back if the caller's dictionary has none.
 */
function count(label, key, n) {
  if (Math.abs(n) !== 1) return label(key, { count: n });
  const one = label(`${key}.one`);
  return one === `${key}.one` ? label(key, { count: n }) : one;
}

/** "augustus 2026" from "2026-08". PURE — kept here so report.js stays standalone. */
function monthLabel(key, lang) {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const d = new Date(`${key}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "nl-BE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildPrintHtml(records, opts = {}) {
  const { t, lang = "nl", today, includeBody = true, title, single = false, types } = opts;
  const label = t || ((key) => key);
  const live = (records || []).filter((r) => r && !r.deletedAt);

  const head =
    `<header class="print__head">` +
    `<h1>${esc(title || label("app.name"))}</h1>` +
    `<p class="print__meta">${esc(label("print.generated"))} ` +
    `${esc(formatDateTime(new Date().toISOString(), lang))} · ` +
    `${esc(label("print.count", { count: live.length }))}</p>` +
    `</header>`;

  if (!live.length) {
    return `${head}<p class="print__empty">${esc(label("print.noRecords"))}</p>`;
  }

  const groups = groupByType(live, types);

  // A one-record print needs no index of itself.
  const summary = single
    ? ""
    : `<section class="print__summary"><h2>${esc(label("print.summary"))}</h2>` +
      `<table><thead><tr>` +
      `<th>${esc(label("print.col.title"))}</th>` +
      `<th>${esc(label("print.col.type"))}</th>` +
      `<th>${esc(label("print.col.tags"))}</th>` +
      `<th>${esc(label("print.col.reminder"))}</th>` +
      `<th>${esc(label("print.col.updated"))}</th>` +
      `</tr></thead><tbody>` +
      groups
        .flatMap((group) =>
          group.records.map(
            (record) =>
              `<tr><td>${esc(record.title)}</td>` +
              `<td>${esc(label(`type.${record.type}`))}</td>` +
              `<td>${esc((record.tags || []).join(", ") || "—")}</td>` +
              `<td>${reminderCell(record, { t: label, lang, today })}</td>` +
              `<td>${esc(formatDate(record.updatedAt, lang))}</td></tr>`
          )
        )
        .join("") +
      `</tbody></table></section>`;

  const details = groups
    .map(
      (group) =>
        `<section class="print__group">` +
        (single ? "" : `<h2>${esc(label(`type.${group.type}`))}</h2>`) +
        group.records.map((record) => printRecord(record, { label, lang, today, includeBody })).join("") +
        `</section>`
    )
    .join("");

  return head + summary + details;
}

function printRecord(record, { label, lang, today, includeBody }) {
  const parts = [`<article class="print__record">`];
  parts.push(`<h3>${esc(record.title || label("detail.newRecord"))}</h3>`);

  const meta = [
    `${esc(label("field.created"))}: ${esc(formatDate(record.createdAt, lang))}`,
    `${esc(label("field.updated"))}: ${esc(formatDate(record.updatedAt, lang))}`,
  ];
  if (record.pinned) meta.push(esc(label("field.pinned")));
  parts.push(`<p class="print__record-meta">${meta.join(" · ")}</p>`);

  if (record.reminderAt) {
    const type = record.reminderType ? ` — ${esc(record.reminderType)}` : "";
    parts.push(
      `<p class="print__reminder">${esc(label("field.reminder"))}: ` +
        `${reminderCell(record, { t: label, lang, today })}${type}</p>`
    );
  }

  if ((record.tags || []).length) {
    parts.push(
      `<p class="print__tags">${record.tags.map((tag) => `<span>${esc(tag)}</span>`).join(" ")}</p>`
    );
  }

  // Above the body: on a printed account or device sheet, the reference
  // numbers are what someone is holding the paper to read.
  if ((record.fields || []).length) {
    parts.push(
      `<table class="print__fields">` +
        record.fields
          .map((f) => `<tr><th>${esc(f.key)}</th><td>${esc(f.value)}</td></tr>`)
          .join("") +
        `</table>`
    );
  }

  if (record.comment) parts.push(`<p class="print__comment">${esc(record.comment)}</p>`);

  // renderMarkdown escapes its own input, so this is safe unescaped.
  if (includeBody && record.body) {
    parts.push(`<div class="print__body">${renderMarkdown(record.body)}</div>`);
  }

  if ((record.links || []).length) {
    parts.push(
      `<p class="print__label">${esc(label("field.links"))}</p><ul class="print__links">` +
        record.links
          .map((l) => `<li>${esc(l.label || "")} <span>${esc(l.url || "")}</span></li>`)
          .join("") +
        `</ul>`
    );
  }

  if ((record.attachments || []).length) {
    parts.push(
      `<p class="print__label">${esc(label("field.attachments"))}</p><ul class="print__links">` +
        record.attachments.map((a) => `<li>${esc(a.filename)}</li>`).join("") +
        `</ul>`
    );
  }

  parts.push(`</article>`);
  return parts.join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// Filenames
// ═══════════════════════════════════════════════════════════════════════════

/** "huisbeheer-2026-08-04.json". PURE — a stable, sortable export name. */
export function exportFilename(extension, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `huisbeheer-${day}.${extension}`;
}
