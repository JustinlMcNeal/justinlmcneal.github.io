import { initNavbar } from "/js/shared/navbar.js";

import { requireAdminOrShowError } from "./guard.js";
import { fetchProductsWithCosts } from "./api.js";
import { createState } from "./state.js";
import { bindPcalcEvents } from "./ui.js";
import { recomputeAndRender } from "./calc.js";

document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();

  const els = getEls();
  const store = createState();

  els.status.textContent = "Checking admin session…";
  const ok = await requireAdminOrShowError(els);
  if (!ok) return;

  try {
    els.status.textContent = "Loading products…";
    const products = await fetchProductsWithCosts();

    store.setProducts(products);
    bindPcalcEvents(els, store, { recomputeAndRender });

    recomputeAndRender(els, store, { silent: true });
    els.status.textContent = `Loaded ${products.length} product(s).`;
  } catch (err) {
    console.error(err);
    els.status.textContent = `Failed to load: ${err?.message || err}`;
  }
});

function getEls() {
  return {
    stccMode: document.getElementById("pc_stcc_mode"),

    status: document.getElementById("pc_status"),

    refresh: document.getElementById("pc_refresh"),
    reset: document.getElementById("pc_reset"),

    product: document.getElementById("pc_product"),
    view: document.getElementById("pc_view"),

    unitCost: document.getElementById("pc_unit_cost"),
    shipPerUnit: document.getElementById("pc_ship_per_unit"),

    // NOTE: id is legacy "oz" but this input is GRAMS now (as labeled in HTML)
    weightOz: document.getElementById("pc_weight_oz"),

    stcc: document.getElementById("pc_stcc"),

    start: document.getElementById("pc_start"),
    end: document.getElementById("pc_end"),
    step: document.getElementById("pc_step"),

    generate: document.getElementById("pc_generate"),
    copy: document.getElementById("pc_copy"),

    sumName: document.getElementById("pc_sum_name"),
    sumUnit: document.getElementById("pc_sum_unit"),
    sumWeight: document.getElementById("pc_sum_weight"),
    sumStcc: document.getElementById("pc_sum_stcc"),
    sumShip: document.getElementById("pc_sum_ship"),

    tbody: document.getElementById("pc_tbody"),
  };
}
