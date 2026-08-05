# fonts/

BLUEPRINT §8.10 requires ONE self-hosted display face (woff2, subset to Latin)
for the brand and headings, and forbids linking a font CDN — that breaks offline
and adds a third party.

No face ships yet, because choosing it is a design decision and I had no
licensed woff2 to embed. Until one is dropped here, `--font-display` in
style.css falls through to the system stack, so nothing 404s and nothing looks
broken.

## To activate one

1. Put the subset file here as `display.woff2` (an OFL-licensed face is the
   safe choice — e.g. Inter, Fraunces, Source Serif; macOS system fonts are NOT
   redistributable).
2. Uncomment the `@font-face` block near the top of `style.css`.
3. Add `"fonts/display.woff2"` to `PRECACHE` in `sw.js`.
4. Bump `CACHE_VERSION` in `sw.js` and `build` in `version.js`.

Step 3 is the one that is easy to forget and breaks offline for existing
installs only — invisible in development (§13.13).
