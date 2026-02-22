// /js/admin/expenses/renderTable.js

const CATEGORY_COLORS = {
  "Inventory":            "bg-blue-100 text-blue-800",
  "Supplies":             "bg-amber-100 text-amber-800",
  "Advertising":          "bg-purple-100 text-purple-800",
  "Platform Fees":        "bg-pink-100 text-pink-800",
  "Shipping":             "bg-cyan-100 text-cyan-800",
  "Software":             "bg-indigo-100 text-indigo-800",
  "Website / Hosting":    "bg-teal-100 text-teal-800",
  "Office":               "bg-slate-100 text-slate-800",
  "Phone / Internet":     "bg-violet-100 text-violet-800",
  "Travel / Meals":       "bg-green-100 text-green-800",
  "Professional Fees":    "bg-rose-100 text-rose-800",
  "Bank Fees":            "bg-fuchsia-100 text-fuchsia-800",
  "Vehicle":              "bg-orange-100 text-orange-800",
  "Other":                "bg-gray-100 text-gray-800"
};

function catPill(category) {
  const cls = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
  return `<span class="inline-block px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full ${cls}">${esc(category || "—")}</span>`;
}

function esc(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoney(cents) {
  return "$" + (cents / 100).toFixed(2);
}

/**
 * Render desktop table rows.
 */
export function renderExpensesTable(tbody, rows) {
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = "";
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr class="expense-row cursor-pointer" data-id="${r.id}">
      <td class="px-4 py-3 whitespace-nowrap text-sm">${fmtDate(r.expense_date)}</td>
      <td class="px-4 py-3 whitespace-nowrap">${catPill(r.category)}</td>
      <td class="px-4 py-3 text-sm font-medium">${esc(r.description || "—")}</td>
      <td class="px-4 py-3 text-right font-black text-sm whitespace-nowrap">${fmtMoney(r.amount_cents)}</td>
      <td class="px-4 py-3 text-sm text-gray-600">${esc(r.vendor || "—")}</td>
      <td class="px-4 py-3 text-right">
        <span class="row-actions text-xs text-gray-400 hover:text-black">Edit →</span>
      </td>
    </tr>
  `).join("");
}

/**
 * Render mobile card view.
 */
export function renderMobileCards(container, rows) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = rows.map(r => `
    <div class="expense-card border-b border-gray-200 p-4 active:bg-gray-50 cursor-pointer" data-id="${r.id}">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="min-w-0">
          <div class="font-black text-sm truncate">${esc(r.description || "—")}</div>
          <div class="text-xs text-gray-500 mt-0.5">${esc(r.vendor || "")} · ${fmtDate(r.expense_date)}</div>
        </div>
        <div class="font-black text-sm whitespace-nowrap">${fmtMoney(r.amount_cents)}</div>
      </div>
      <div>${catPill(r.category)}</div>
    </div>
  `).join("");
}

/**
 * Wire click events on desktop table rows.
 */
export function wireRowClicks(tbody, callback) {
  if (!tbody) return;
  tbody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => callback(tr.dataset.id));
  });
}

/**
 * Wire click events on mobile cards.
 */
export function wireMobileClicks(container, callback) {
  if (!container) return;
  container.querySelectorAll("[data-id]").forEach(el => {
    el.addEventListener("click", () => callback(el.dataset.id));
  });
}
