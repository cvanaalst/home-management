/**
 * markdown.js — PURE minimal Markdown renderer (BLUEPRINT §4, §12).
 *
 * This module imports NOTHING. That is what makes it unit-testable, and it is
 * why the six-line escape() below is duplicated from ui.js rather than imported.
 *
 * ── Security is the point ──────────────────────────────────────────────────
 * The whole source is escaped FIRST, then every block and inline rule runs over
 * already-escaped text. So user input can never become a tag, and a quote
 * inside a URL is already `&quot;` long before it reaches an href — attribute
 * break-out is impossible by construction rather than by filtering.
 * `javascript:`, `data:`, `vbscript:` and `file:` targets are refused outright.
 *
 * ── The line-based caveat (§13.12) ─────────────────────────────────────────
 * A single newline inside a paragraph becomes <br>. Keep each paragraph or
 * bullet on ONE source line or the formatting shatters.
 */

const SAFE_SCHEME = /^(?:https?:\/\/|mailto:|tel:)/i;
const BLOCKED_SCHEME = /^(?:javascript|data|vbscript|file):/i;

/** Placeholder marker for parked code spans — a character no source can carry. */
const MARK = "\u0000";

function escape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Decide whether a link target may become an href.
 * Returns the usable URL, or null to render the link as plain text instead.
 */
export function safeUrl(raw) {
  // Strip control characters and spaces before testing the scheme. Browsers
  // ignore them inside a URL, so "java\tscript:alert(1)" would otherwise slip
  // past a prefix check and still execute.
  const url = String(raw || "").replace(/[\u0000-\u0020]/g, "");
  if (!url) return null;
  if (BLOCKED_SCHEME.test(url)) return null;
  if (SAFE_SCHEME.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  // A fragment or a relative path is fine. Anything else carrying a colon is
  // an unknown scheme and is refused.
  if (/^[#/]/.test(url)) return url;
  return null;
}

function anchor(url, label) {
  const safe = safeUrl(url);
  if (!safe) return null;
  return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function emphasis(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

/** Inline rules. `text` is ALREADY escaped. */
function inline(text) {
  // Park code spans first so their contents escape the emphasis and link rules.
  const codes = [];
  let out = String(text).replace(/`([^`]+)`/g, (_whole, code) => {
    codes.push(code);
    return `${MARK}${codes.length - 1}${MARK}`;
  });

  // Explicit [label](url) links, and park the result too — otherwise the
  // autolink pass below would find the URL again inside the href it just made.
  const anchors = [];
  const park = (html) => {
    anchors.push(html);
    return `${MARK}a${anchors.length - 1}${MARK}`;
  };

  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, url) => {
    const built = anchor(url, emphasis(label));
    return built === null ? whole : park(built);
  });

  // Bare URLs.
  out = out.replace(
    /(^|[\s(])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)])/g,
    (whole, before, url) => {
      const built = anchor(url, url);
      return built === null ? whole : before + park(built);
    }
  );

  out = emphasis(out);

  out = out.replace(new RegExp(`${MARK}a(\\d+)${MARK}`, "g"), (_w, i) => anchors[Number(i)]);
  return out.replace(new RegExp(`${MARK}(\\d+)${MARK}`, "g"), (_w, i) => `<code>${codes[Number(i)]}</code>`);
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBER = /^\s{0,3}\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,4})\s+(.*)$/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}&gt;\s?(.*)$/; // ">" is already "&gt;" when we look
const FENCE = /^\s{0,3}```/;

/** Anything that terminates the paragraph it is found in. */
function startsBlock(line) {
  return (
    line.trim() === "" ||
    FENCE.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBER.test(line)
  );
}

/**
 * Render Markdown to an HTML string. PURE.
 * The result is safe to assign to innerHTML.
 */
export function renderMarkdown(source) {
  const lines = escape(source).split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // consume the closing fence, or run off the end, which is fine
      out.push(`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    if (RULE.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])[1]);
      out.push(`<blockquote>${inline(body.join("<br>"))}</blockquote>`);
      continue;
    }

    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line);
      const pattern = ordered ? NUMBER : BULLET;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(`<li>${inline(pattern.exec(lines[i++])[1].trim())}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && !startsBlock(lines[i])) paragraph.push(lines[i++].trim());
    out.push(`<p>${inline(paragraph.join("<br>"))}</p>`);
  }

  return out.join("\n");
}

/**
 * The first `limit` characters of the source as PLAIN text, for list previews.
 * PURE. Strips the markup rather than rendering it, so no escaping is involved
 * and the result must be assigned with textContent, never innerHTML.
 */
export function markdownToPlain(source, limit = 160) {
  const text = String(source ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,4}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+[.)]\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
