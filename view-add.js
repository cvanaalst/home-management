/**
 * view-add.js — choosing what kind of item to create (BLUEPRINT §4).
 *
 * Deliberately small. The form itself lives in view-detail.js so a record is
 * edited in exactly one place; this view only asks which type, then hands a
 * draft back through app.js. A view never imports another view.
 *
 * The type is asked FIRST rather than being a field buried in the form because
 * it is the app's discriminator — it decides the icon, the filter chip and the
 * insights bucket the item lands in.
 */

import { t, typeLabel } from "./i18n.js";
import { icon } from "./icons.js";
import { TYPES } from "./db.js";

const $ = (id) => document.getElementById(id);

let callbacks = { onPick: () => {} };
let grid;

export function initAddView(handlers = {}) {
  callbacks = { ...callbacks, ...handlers };

  const root = $("add-body");
  root.textContent = "";
  root.className = "view__body add";

  const heading = document.createElement("h2");
  heading.className = "add__title";
  heading.dataset.i18n = "add.chooseType";

  const hint = document.createElement("p");
  hint.className = "add__hint";
  hint.dataset.i18n = "add.chooseType.hint";

  grid = document.createElement("div");
  grid.className = "add__grid";

  root.append(heading, hint, grid);

  grid.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-type]");
    if (tile) callbacks.onPick(tile.dataset.type);
  });

  paintAddView();
}

/** Rebuilt on every language switch. */
export function paintAddView() {
  if (!grid) return;
  grid.textContent = "";
  for (const type of TYPES) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "add__tile";
    tile.dataset.type = type;
    tile.style.setProperty("--tile-colour", `var(--type-${type})`);

    const glyph = document.createElement("span");
    glyph.className = "add__tile-icon";
    glyph.innerHTML = icon(`type-${type}`, { size: 26 });

    const label = document.createElement("span");
    label.className = "add__tile-label";
    label.textContent = typeLabel(type);

    tile.append(glyph, label);
    grid.append(tile);
  }
}
