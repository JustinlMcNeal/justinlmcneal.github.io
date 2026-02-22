// /js/admin/itemStats/renderTable.js

function esc(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoney(cents) {
  if (cents == null) return "—";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return (neg ? "-$" : "$") + (abs / 100).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function barStyle(pct) {
  return `width:${Math.max(pct, 1).toFixed(1)}%`;
}

function marginColor(pct) {
  if (pct >= 60) return "text-green-600";
  if (pct >= 40) return "text-yellow-600";
  if (pct >= 0)  return "text-orange-600";
  return "text-red-600";
}

function statusDot(isActive) {
  if (isActive === true) return `<span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" title="Active"></span>`;
  if (isActive === false) return `<span class="inline-block w-2 h-2 rounded-full bg-gray-300 mr-1.5" title="Inactive"></span>`;
  return "";
}

/**
 * Render desktop table rows for product stats.
 */
export function renderStatsTable(tbody, rows, maxRevenue) {
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = "";
    return;
  }

  const topRev = maxRevenue || Math.max(...rows.map(r => r.revenue_cents), 1);

  tbody.innerHTML = rows.map((r, i) => {
    const revPct = (r.revenue_cents / topRev) * 100;
    const img = r.image
      ? `<img src="${esc(r.image)}" class="w-8 h-8 object-cover border-2 border-black flex-shrink-0" alt="" />`
      : `<div class="w-8 h-8 bg-gray-200 border-2 border-black flex-shrink-0 flex items-center justify-center text-[10px] text-gray-400">?</div>`;

    return `
    <tr class="stat-row cursor-pointer" data-code="${esc(r.product_code)}">
      <td class="px-4 py-3 text-gray-400 text-xs font-mono">${i + 1}</td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-3">
          ${img}
          <div class="min-w-0">
            <div class="font-bold text-sm truncate max-w-[200px]">${statusDot(r.is_active)}${esc(r.product_name)}</div>
            <div class="text-[10px] text-gray-400 font-mono">${esc(r.product_code)}</div>
          </div>
        </div>
      </td>
      <td class="px-4 py-3 text-center font-bold">${r.units_sold}</td>
      <td class="px-4 py-3 text-center">${r.order_count}</td>
      <td class="px-4 py-3 text-right font-black">${fmtMoney(r.revenue_cents)}</td>
      <td class="px-4 py-3 text-right text-gray-600">${r.cpi_cents ? fmtMoney(r.cpi_cents) : '<span class="text-gray-300">—</span>'}</td>
      <td class="px-4 py-3 text-right font-bold ${r.profit_cents >= 0 ? "text-green-700" : "text-red-600"}">${fmtMoney(r.profit_cents)}</td>
      <td class="px-4 py-3 text-right ${marginColor(r.margin_pct)}">${r.cpi_cents ? r.margin_pct + "%" : '<span class="text-gray-300">—</span>'}</td>
      <td class="px-4 py-3">
        <div class="w-full bg-gray-100 h-4 border border-gray-200 relative overflow-hidden">
          <div class="bar-fill h-full bg-black" style="${barStyle(revPct)}"></div>
          <span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold ${revPct > 50 ? 'text-white' : 'text-gray-600'}">${revPct.toFixed(1)}%</span>
        </div>
      </td>
    </tr>`;
  }).join("");
}

/**
 * Render mobile cards.
 */
export function renderMobileCards(container, rows) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = rows.map((r, i) => {
    const img = r.image
      ? `<img src="${esc(r.image)}" class="w-10 h-10 object-cover border-2 border-black flex-shrink-0" alt="" />`
      : `<div class="w-10 h-10 bg-gray-200 border-2 border-black flex-shrink-0"></div>`;

    return `
    <div class="stat-card border-b border-gray-200 p-4 active:bg-gray-50 cursor-pointer" data-code="${esc(r.product_code)}">
      <div class="flex items-start gap-3 mb-2">
        ${img}
        <div class="min-w-0 flex-1">
          <div class="flex justify-between items-start gap-2">
            <div class="font-black text-sm truncate">${statusDot(r.is_active)}${esc(r.product_name)}</div>
            <span class="text-[10px] font-mono text-gray-400 whitespace-nowrap">#${i + 1}</span>
          </div>
          <div class="text-[10px] text-gray-400 font-mono">${esc(r.product_code)}</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center">
        <div>
          <div class="text-[9px] font-black uppercase text-gray-400">Revenue</div>
          <div class="font-black text-sm">${fmtMoney(r.revenue_cents)}</div>
        </div>
        <div>
          <div class="text-[9px] font-black uppercase text-gray-400">Units</div>
          <div class="font-bold text-sm">${r.units_sold}</div>
        </div>
        <div>
          <div class="text-[9px] font-black uppercase text-gray-400">Profit</div>
          <div class="font-bold text-sm ${r.profit_cents >= 0 ? "text-green-700" : "text-red-600"}">${fmtMoney(r.profit_cents)}</div>
        </div>
      </div>
    </div>`;
  }).join("");
}

/**
 * Render variant breakdown rows.
 */
export function renderVariantRows(tbody, variants, maxUnits) {
  if (!tbody) return;
  if (!variants.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 text-sm">No variant data</td></tr>`;
    return;
  }

  const top = maxUnits || Math.max(...variants.map(v => v.units), 1);

  tbody.innerHTML = variants.map(v => {
    const pct = (v.units / top) * 100;
    return `
    <tr>
      <td class="px-4 py-3 font-medium text-sm">${esc(v.variant || "(no variant)")}</td>
      <td class="px-4 py-3 text-center font-bold">${v.units}</td>
      <td class="px-4 py-3 text-right font-black">${fmtMoney(v.revenue_cents)}</td>
      <td class="px-4 py-3">
        <div class="w-full bg-gray-100 h-3 border border-gray-200 relative overflow-hidden">
          <div class="bar-fill h-full bg-kkpink" style="${barStyle(pct)}"></div>
        </div>
      </td>
    </tr>`;
  }).join("");
}

/**
 * Wire click events on desktop rows.
 */
export function wireRowClicks(tbody, callback) {
  if (!tbody) return;
  tbody.querySelectorAll("tr[data-code]").forEach(tr => {
    tr.addEventListener("click", () => callback(tr.dataset.code));
  });
}

/**
 * Wire click events on mobile cards.
 */
export function wireMobileClicks(container, callback) {
  if (!container) return;
  container.querySelectorAll("[data-code]").forEach(el => {
    el.addEventListener("click", () => callback(el.dataset.code));
  });
}
