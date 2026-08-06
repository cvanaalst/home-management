# fonts/

`display.woff2` is the app's single self-hosted display face (§8.10), used for
the brand, headings and the big numbers in Insights. Body text stays on the
system stack.

It is **precached by `sw.js`**, so headings look the same offline as online.
That entry is the part that is easy to forget: without it the font 404s for
existing installs only, which is invisible in development (§13.13).

## Replacing it

1. Drop the new subset in as `fonts/display.woff2` — keep the name, so nothing
   else has to change.
2. Subset it to Latin. The `@font-face` in `style.css` declares a matching
   `unicode-range`; shipping a full face would be a much larger download for
   glyphs this app never renders.
3. Bump `CACHE_VERSION` in `sw.js` and `build` in `version.js`, or returning
   visitors keep the old face from their cache.

Use an OFL-licensed face. macOS system fonts are not redistributable, and this
repository is public.
