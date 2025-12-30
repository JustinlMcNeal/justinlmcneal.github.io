export function recomputeAndRender(els, store, { silent = false } = {}) {
  const st = store.get();
  const selected = store.findSelected();

  if (!selected) {
    if (!silent) els.status.textContent = "No products found.";
    els.tbody.innerHTML = "";
    return;
  }

  const unitCost = num(st.unit_cost);
  const weightGPerUnit = num(st.weight_g); // grams
  const stccPerUnit = num(st.stcc);

  // Summary
  els.sumName.textContent = `${selected.name} (${selected.code})`;
  els.sumUnit.textContent = money(unitCost);
  els.sumWeight.textContent = `${Math.round(weightGPerUnit)} g`;
  els.sumStcc.textContent = stccPerUnit > 0 ? money(stccPerUnit) : "—";
  els.sumShip.textContent = money(num(st.supplier_ship_per_unit));

  const start = clampInt(st.start, 1, 100000);
  const end = clampInt(st.end, 1, 100000);
  const step = clampInt(st.step, 1, 100000);

  const rows = [];
  for (let q = start; q <= end; q += step) {
    const totalWeightG = q * weightGPerUnit;

    const sc = calcSC(totalWeightG);

    const itemAmount = q * unitCost;
    const totalPaid = itemAmount + sc;
    const totalFree = itemAmount + sc + (q * stccPerUnit);

    const cpiPaid = totalPaid / q;
    const cpiFree = totalFree / q;

    rows.push({
      qty: q,
      itemAmount,
      totalWeightG,
      sc,
      totalPaid,
      totalFree,
      cpiFree,
      cpiPaid,
    });
  }

  // ✅ SMART highlights (not just absolute lowest CPI)
  const view = st.view || "both";
  const SMART_TOLERANCE = 0.10; // 10% within best CPI

  const smartPaidIdx = (view === "both" || view === "paid")
    ? pickSmartIdx(rows, "cpiPaid", "totalPaid", SMART_TOLERANCE)
    : -1;

  const smartFreeIdx = (view === "both" || view === "free")
    ? pickSmartIdx(rows, "cpiFree", "totalFree", SMART_TOLERANCE)
    : -1;

  // Render
  els.tbody.innerHTML = "";
  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    if (idx === smartPaidIdx) tr.classList.add("kk-pcalc-best-paid");
    if (idx === smartFreeIdx) tr.classList.add("kk-pcalc-best-free");

    tr.innerHTML = `
      <td>${r.qty}</td>
      <td>${money(r.itemAmount)}</td>
      <td>${Math.round(r.totalWeightG)}</td>
      <td>${money(r.sc)}</td>
      <td>${money(r.totalPaid)}</td>
      <td>${money(r.totalFree)}</td>
      <td>${money(r.cpiFree)}</td>
      <td>${money(r.cpiPaid)}</td>
    `;
    els.tbody.appendChild(tr);
  });

  if (!silent) els.status.textContent = `Calculated ${rows.length} row(s).`;
}

/**
 * SMART PICK:
 * - Find best (min) CPI
 * - Consider rows within (1 + tolerance) * bestCPI
 * - Choose the one with LOWEST total cost among those (or lowest qty tie-break)
 */
function pickSmartIdx(rows, cpiKey, totalKey, tolerance) {
  if (!rows.length) return -1;

  const bestCpi = Math.min(...rows.map(r => r[cpiKey]));
  const maxCpi = bestCpi * (1 + tolerance);

  let bestIdx = -1;
  let bestTotal = Infinity;
  let bestQty = Infinity;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[cpiKey] <= maxCpi) {
      if (r[totalKey] < bestTotal || (r[totalKey] === bestTotal && r.qty < bestQty)) {
        bestTotal = r[totalKey];
        bestQty = r.qty;
        bestIdx = i;
      }
    }
  }

  // Fallback: if none match (shouldn't happen), return min CPI row
  if (bestIdx === -1) {
    bestIdx = indexOfMin(rows, r => r[cpiKey]);
  }

  return bestIdx;
}

/**
 * SC = IF(weight<=500, 260, 260 + CEILING((weight-500)/500)*40) * 0.14
 * weight = TOTAL grams
 */
export function calcSC(totalWeightG) {
  const g = num(totalWeightG);
  if (g <= 0) return 0;

  const baseG = 500;
  const stepG = 500;

  const base = 260;
  const addPerStep = 40;

  const steps = g <= baseG ? 0 : Math.ceil((g - baseG) / stepG);
  const raw = base + steps * addPerStep;

  return raw * 0.14;
}

export function stccFromGrams(itemWeightG) {
  const g = num(itemWeightG);
  if (!g) return 0;

  if (g <= 28) return 4.75;
  if (g <= 56) return 5.50;
  if (g <= 85) return 6.25;
  if (g <= 112) return 6.90;
  if (g <= 454) return 8.25;
  if (g <= 907) return 9.65;
  if (g <= 1814) return 10.40;

  return null;
}

function indexOfMin(arr, fn) {
  let bestI = -1;
  let bestV = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = fn(arr[i]);
    if (v < bestV) { bestV = v; bestI = i; }
  }
  return bestI;
}

function money(n) {
  const x = num(n);
  return `$${x.toFixed(2)}`;
}
function num(x) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function clampInt(v, min, max) {
  const n = Math.floor(Number(v || 0));
  return Math.max(min, Math.min(max, n));
}
