// /js/admin/customers/renderTable.js
function moneyFromCents(cents) {
  const n = Number(cents || 0) / 100;
  return `$${n.toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fullName(r) {
  const a = (r.first_name || "").trim();
  const b = (r.last_name || "").trim();
  const x = `${a} ${b}`.trim();
  return x.length ? x : "—";
}

function fmtAddress(r) {
  const parts = [
    r.street_address,
    [r.city, r.state, r.zip].filter(Boolean).join(", ").replace(", ,", ", "),
    r.country
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function fmtShip(r) {
  const s = (r.last_label_status || "").trim();
  return s || "—";
}

/* ------------- DESKTOP TABLE ------------- */
export function renderCustomersTable(tbodyEl, rows) {
  if (!tbodyEl) return;

  const emptyState = document.getElementById("emptyState");
  const tableWrap = document.getElementById("tableWrap");

  if (!rows?.length) {
    tbodyEl.innerHTML = "";
    emptyState?.classList.remove("hidden");
    return;
  }

  emptyState?.classList.add("hidden");

  tbodyEl.innerHTML = rows.map(r => {
    const email = esc(r.email || "");
    const name = esc(fullName(r));
    const addr = esc(fmtAddress(r));
    const orders = Number(r.order_count || 0);
    const spent = moneyFromCents(r.total_spent_cents);
    const last = fmtDate(r.last_order_at);
    const ship = esc(fmtShip(r));

    return `
      <tr class="customer-row cursor-pointer" data-email="${email}">
        <td class="px-4 py-3">
          <div class="font-bold text-sm">${name}</div>
          <div class="text-[10px] text-gray-500">Status: ${ship}</div>
        </td>
        <td class="px-4 py-3 text-sm text-gray-600">${email || "—"}</td>
        <td class="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell max-w-[200px] truncate">${addr}</td>
        <td class="px-4 py-3 text-center">
          <span class="inline-flex items-center justify-center w-8 h-8 bg-gray-100 text-sm font-bold">${orders}</span>
        </td>
        <td class="px-4 py-3 text-right font-bold text-sm">${spent}</td>
        <td class="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">${last}</td>
        <td class="px-4 py-3 text-right">
          <button class="row-actions border-2 border-black px-3 py-1 text-[10px] font-black uppercase hover:bg-black hover:text-white transition-colors" type="button" data-action="open">
            View
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/* ------------- MOBILE CARDS ------------- */
export function renderMobileCustomerCards(containerEl, rows) {
  if (!containerEl) return;

  if (!rows?.length) {
    containerEl.innerHTML = "";
    return;
  }

  containerEl.innerHTML = rows.map(r => {
    const email = esc(r.email || "");
    const name = esc(fullName(r));
    const addr = esc(fmtAddress(r));
    const orders = Number(r.order_count || 0);
    const spent = moneyFromCents(r.total_spent_cents);
    const last = fmtDate(r.last_order_at);
    const ship = esc(fmtShip(r));

    return `
      <div class="customer-card border-b-2 border-gray-100 p-4 active:bg-gray-50 cursor-pointer" data-email="${email}">
        <!-- Header row -->
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="min-w-0">
            <div class="font-bold text-sm truncate">${name}</div>
            <div class="text-xs text-gray-500 truncate">${email || "—"}</div>
          </div>
          <div class="flex-shrink-0 text-right">
            <div class="text-sm font-black">${spent}</div>
            <div class="text-[10px] text-gray-400">${orders} order${orders !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <!-- Address -->
        <div class="text-xs text-gray-500 mb-2 truncate">${addr}</div>

        <!-- Footer -->
        <div class="flex items-center justify-between">
          <div class="text-[10px] text-gray-400">
            ${last !== '—' ? `Last: ${last}` : 'No orders'}
          </div>
          <span class="text-[9px] font-bold uppercase tracking-wider ${ship === '—' ? 'text-gray-400' : 'text-teal-600'}">${ship}</span>
        </div>
      </div>
    `;
  }).join("");
}

/* ------------- ROW CLICK HANDLERS ------------- */
export function wireCustomerRowClicks(tbodyEl, onOpen) {
  if (!tbodyEl) return;

  tbodyEl.onclick = (e) => {
    const tr = e.target?.closest?.("tr[data-email]");
    if (!tr) return;
    const email = tr.getAttribute("data-email") || "";
    onOpen?.(email);
  };
}

export function wireMobileCardClicks(containerEl, onOpen) {
  if (!containerEl) return;

  containerEl.onclick = (e) => {
    const card = e.target?.closest?.(".customer-card[data-email]");
    if (!card) return;
    const email = card.getAttribute("data-email") || "";
    onOpen?.(email);
  };
}
