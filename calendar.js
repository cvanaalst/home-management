/**
 * calendar.js — reminders as iCalendar, so they reach you when the app is shut.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * The catch-up notification (§8.16) can only speak when the app is OPEN. That
 * is precisely when a boiler service is not forgotten. Real push needs a server
 * this app does not have and will not get, so the honest way to be reminded of
 * something next March is to put it in the calendar that already runs in the
 * background on every device you own.
 *
 * Exporting RRULE rather than a list of dates matters: the calendar then owns
 * the recurrence, so a yearly service keeps firing for as long as the entry
 * exists, without this app ever running again.
 *
 * ── Deliberately a download, not a file on Drive ───────────────────────────
 * A feed on Drive was the obvious idea and is the wrong one twice over. It
 * would have to be plaintext to be subscribable, which flatly contradicts the
 * encryption in §7 — reminder titles are the most descriptive text in the whole
 * record set. And `drive.file` cannot publish a public URL anyway, so no
 * calendar app could subscribe to it. A one-time import that carries its own
 * recurrence gets the same result without either problem.
 *
 * Everything here is PURE: text in, text out, `now` passed by the caller.
 */

const PRODID = "-//Huisbeheer//Home Management//NL";

/** RFC 5545 line folding: 75 octets, continuation lines start with a space. */
function fold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

/**
 * Escape a TEXT value. PURE.
 * Backslash first — escaping it after the others would double-escape them.
 */
export function icsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** "YYYY-MM-DD" to "YYYYMMDD". PURE. Returns "" for anything else. */
export function icsDate(iso) {
  const day = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.replace(/-/g, "") : "";
}

/** A Date to "YYYYMMDDTHHMMSSZ". PURE. */
export function icsStamp(date) {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** The day after `iso`, as an ics date. All-day events end exclusive. PURE. */
function nextDay(iso) {
  const ms = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return icsDate(new Date(ms + 86400000).toISOString());
}

/**
 * A recurrence rule as RRULE. PURE. Returns "" when it does not repeat.
 *
 * A quarter is not an iCalendar unit, so it becomes MONTHLY at three times the
 * interval — which is what a quarter is.
 */
export function icsRrule(recurrence) {
  if (!recurrence || !recurrence.every) return "";
  const interval = Math.max(1, Math.trunc(Number(recurrence.interval) || 1));
  const map = {
    day: ["DAILY", interval],
    week: ["WEEKLY", interval],
    month: ["MONTHLY", interval],
    quarter: ["MONTHLY", interval * 3],
    year: ["YEARLY", interval],
  };
  const rule = map[recurrence.every];
  if (!rule) return "";
  const [freq, every] = rule;
  return `RRULE:FREQ=${freq}${every > 1 ? `;INTERVAL=${every}` : ""}`;
}

/**
 * One VEVENT per record that has a reminder. PURE.
 *
 * All-day events, because every reminder in this app is a date and never a
 * time — inventing 09:00 would put a wrong fact in someone's calendar.
 *
 * The alarm fires the morning of, at the calendar's own discretion for an
 * all-day entry. Without a VALARM the entry is silent, and a silent reminder is
 * the thing this whole file exists to avoid.
 */
export function buildIcs(records, { now = new Date(), calendarName = "Huisbeheer" } = {}) {
  const stamp = icsStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendarName)}`,
  ];

  for (const record of records || []) {
    if (!record || record.deletedAt || !record.reminderAt) continue;
    // Events already happened; only records carry a future reminder.
    if (record.kind === "event") continue;
    const start = icsDate(record.reminderAt);
    if (!start) continue;

    const summary = String(record.title || "").trim() || calendarName;
    const description = [record.reminderType, record.comment]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join("\n");

    lines.push("BEGIN:VEVENT");
    // Stable across exports: re-importing must UPDATE the entry rather than
    // adding a second copy of every reminder.
    lines.push(`UID:${icsText(record.id)}@huisbeheer`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(record.reminderAt)}`);
    lines.push(fold(`SUMMARY:${icsText(summary)}`));
    if (description) lines.push(fold(`DESCRIPTION:${icsText(description)}`));
    const rrule = icsRrule(record.recurrence);
    if (rrule) lines.push(rrule);
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push("TRIGGER:PT9H"); // 09:00 on the day itself
    lines.push(fold(`DESCRIPTION:${icsText(summary)}`));
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // CRLF is not optional in RFC 5545, and some calendar apps reject LF-only.
  return `${lines.join("\r\n")}\r\n`;
}

/** How many reminders an export would contain. PURE. */
export function icsCount(records) {
  return (records || []).filter(
    (r) => r && !r.deletedAt && r.kind !== "event" && r.reminderAt
  ).length;
}
