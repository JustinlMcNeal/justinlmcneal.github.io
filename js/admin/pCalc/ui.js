import { stccFromGrams } from "./calc.js";

export function bindPcalcEvents(els, store, { recomputeAndRender }) {
  let stccTouched = false;

  renderProductOptions(els, store);

  els.product.addEventListener("change", () => {
    stccTouched = false;
    setStccMode(els, "auto");

    store.setSelectedCode(els.product.value);
    syncInputsFromSelected(els, store, { stccTouched });
    recomputeAndRender(els, store);
  });

  els.view.addEventListener("change", () => {
    store.setView(els.view.value);
    recomputeAndRender(els, store);
  });

  // Manual STCC edits
  els.stcc.addEventListener("input", () => {
    stccTouched = true;
    setStccMode(els, "manual");
    store.setInputs({ stcc: els.stcc.value });
    recomputeAndRender(els, store);
  });

  // Unit cost + supplier ship per unit
  const onOtherInput = () => {
    store.setInputs({
      unit_cost: els.unitCost.value,
      supplier_ship_per_unit: els.shipPerUnit.value,
    });
    recomputeAndRender(els, store);
  };
  els.unitCost.addEventListener("input", onOtherInput);
  els.shipPerUnit.addEventListener("input", onOtherInput);

  // Weight change -> auto STCC if not touched
  els.weightOz.addEventListener("input", () => {
    const g = Number(els.weightOz.value || 0);
    store.setInputs({ weight_g: g });

    if (!stccTouched) {
      setStccMode(els, "auto");
      const est = stccFromGrams(g);

      if (est == null) {
        els.stcc.value = "0.00";
        store.setInputs({ stcc: 0 });
        // stays auto, but you can override
      } else {
        els.stcc.value = Number(est).toFixed(2);
        store.setInputs({ stcc: est });
      }
    }

    recomputeAndRender(els, store);
  });

  // Range inputs
  const onRange = () => {
    store.setRange({
      start: els.start.value,
      end: els.end.value,
      step: els.step.value,
    });
  };
  els.start.addEventListener("input", onRange);
  els.end.addEventListener("input", onRange);
  els.step.addEventListener("input", onRange);

  els.generate.addEventListener("click", () => {
    onRange();
    recomputeAndRender(els, store);
  });

  els.copy.addEventListener("click", () => copyCsv(els));
  els.refresh.addEventListener("click", () => location.reload());

  els.reset.addEventListener("click", () => {
    stccTouched = false;
    setStccMode(els, "auto");

    const selected = store.findSelected();
    if (!selected) return;

    els.view.value = "both";
    store.setView("both");

    els.unitCost.value = moneyNum(selected.unit_cost);
    els.shipPerUnit.value = moneyNum(selected.supplier_ship_per_unit);
    els.weightOz.value = intNum(selected.weight_g);

    const est = stccFromGrams(Number(els.weightOz.value || 0));
    const stccVal = est == null ? 0 : est;
    els.stcc.value = moneyNum(stccVal);

    store.setInputs({
      unit_cost: els.unitCost.value,
      supplier_ship_per_unit: els.shipPerUnit.value,
      weight_g: els.weightOz.value,
      stcc: stccVal,
    });

    recomputeAndRender(els, store);
  });

  // initial
  setStccMode(els, "auto");
  syncInputsFromSelected(els, store, { stccTouched });
}

function setStccMode(els, mode) {
  if (!els.stccMode) return;
  if (mode === "manual") {
    els.stccMode.textContent = "MANUAL";
    els.stccMode.classList.remove("kk-pill-auto");
    els.stccMode.classList.add("kk-pill-manual");
  } else {
    els.stccMode.textContent = "AUTO";
    els.stccMode.classList.add("kk-pill-auto");
    els.stccMode.classList.remove("kk-pill-manual");
  }
}

function renderProductOptions(els, store) {
  const { products, selectedCode } = store.get();
  els.product.innerHTML = "";

  products.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.code;
    opt.textContent = `${p.name} (${p.code})`;
    if (p.code === selectedCode) opt.selected = true;
    els.product.appendChild(opt);
  });
}

function syncInputsFromSelected(els, store, { stccTouched }) {
  const selected = store.findSelected();
  if (!selected) return;

  els.unitCost.value = moneyNum(selected.unit_cost);
  els.shipPerUnit.value = moneyNum(selected.supplier_ship_per_unit);
  els.weightOz.value = intNum(selected.weight_g);

  const dbStcc = Number(selected.stcc || 0);
  let stccVal = dbStcc;

  if (!stccVal && !stccTouched) {
    const est = stccFromGrams(Number(els.weightOz.value || 0));
    stccVal = est == null ? 0 : est;
  }

  els.stcc.value = moneyNum(stccVal);

  store.setInputs({
    unit_cost: selected.unit_cost,
    supplier_ship_per_unit: selected.supplier_ship_per_unit,
    weight_g: selected.weight_g,
    stcc: stccVal,
  });
}

function moneyNum(x) {
  const n = Number(x || 0);
  return n.toFixed(2);
}
function intNum(x) {
  const n = Number(x || 0);
  return String(Math.round(n));
}

function copyCsv(els) {
  const rows = Array.from(els.tbody.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim())
  );
  const header = ["Qty","Item Amount","Total Weight (g)","SC","Total Cost Paid","Total Cost Free","CPI Free","CPI Paid"];
  const csv = [header, ...rows].map(r => r.map(escapeCsv).join(",")).join("\n");
  navigator.clipboard.writeText(csv);
}

function escapeCsv(s) {
  const x = String(s ?? "");
  if (x.includes(",") || x.includes('"') || x.includes("\n")) return `"${x.replaceAll('"', '""')}"`;
  return x;
}
