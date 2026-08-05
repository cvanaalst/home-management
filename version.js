/**
 * version.js — the single source of truth for what is actually running.
 *
 * Bump `build` on EVERY change, without exception (BLUEPRINT §3.7, §15.1).
 * Set `date` to the YY-MM of that change.
 * Rendered as one line in Settings ▸ About (§8.15).
 */

export const VERSION = {
  designer: "Chris",
  date: "26-08",
  build: 14,
};

/** e.g. "Chris · 26-08 · build 14" — the exact string shown in About. */
export function versionLine() {
  return `${VERSION.designer} · ${VERSION.date} · build ${VERSION.build}`;
}
