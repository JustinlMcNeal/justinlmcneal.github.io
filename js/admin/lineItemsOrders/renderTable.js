// /js/admin/lineItemsOrders/renderTable.js
import { esc, moneyFromCents, gramsToOz, formatOz, formatDateShort } from "./dom.js";

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function statusPillClasses(labelStatus) {
  const s = String(labelStatus || "pending").toLowerCase();

  const base =
    "inline-flex items-center border-[3px] border-black px-2 py-1 " +
    "text-[10px] font-black uppercase tracking-[.18em] whitespace-nowrap";

  if (s === "shipped" || s === "delivered") return `${base} bg-black text-white`;
  if (s === "label_purchased" || s === "label-purchased") return `${base} bg-white text-black`;
  if (s === "cancelled" || s === "canceled") return `${base} bg-white text-black`;
  if (s === "error" || s === "failed") return `${base} bg-black text-white`;

  return `${base} bg-white text-black`;
}

function displayStatus(labelStatus) {
  return String(labelStatus || "pending").replaceAll("_", " ");
}

function formatTracking(trk) {
  const t = String(trk || "—").trim();
  return t.length ? t : "—";
}

/* -------------------------
   MOBILE RENDER (CARDS)
-------------------------- */
function renderMobileCards(rows = []) {
  return rows
    .map((r, idx) => {
      const ship = r.shipment;

      const orderId = r.kk_order_id || "—";
      const date = formatDateShort(r.order_date);

      const customer =
        `${r.first_name || ""} ${r.last_name || ""}`.trim() || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";

      const paid = moneyFromCents(r.total_paid_cents);
      const profit = moneyFromCents(r.profit_cents);
      const profitColor = Number(r.profit_cents) > 0 ? 'text-emerald-600' : 'text-red-600';

      const labelStatus = ship?.label_status || "pending";

      return `
        <tr>
          <td colspan="8" class="p-0">
            <div class="border-b border-black/15 px-4 py-4">
              <!-- top line -->
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[11px] font-black uppercase tracking-[.18em] text-black/60">
                    ${esc(date)} · 
                    <button type="button" data-view="${idx}" class="text-kkpink hover:underline cursor-pointer">
                      ${esc(orderId)}
                    </button>
                  </div>

                  <div class="mt-2">
                    <div class="font-black uppercase tracking-[.06em] text-[12px]">
                      ${esc(customer)}
                    </div>
                  </div>
                </div>

                <div class="shrink-0 flex flex-col items-end gap-2">
                  <span class="${statusPillClasses(labelStatus)}">
                    ${esc(displayStatus(labelStatus))}
                  </span>

                  <button
                    type="button"
                    data-edit="${idx}"
                    class="inline-flex items-center gap-2 border-[4px] border-black bg-white px-3 py-2
                           font-black uppercase tracking-[.14em] text-[11px]
                           hover:bg-black hover:text-white transition"
                    aria-label="Edit order"
                    title="Edit"
                  >
                    <span aria-hidden="true" class="text-[12px] leading-none">✎</span>
                    <span>Edit</span>
                  </button>
                </div>
              </div>

              <!-- stats grid -->
              <div class="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Items</div>
                  <div class="mt-1 font-black">${esc(items)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Paid</div>
                  <div class="mt-1 font-black">${esc(paid)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Profit</div>
                  <div class="mt-1 font-black ${profitColor}">${esc(profit)}</div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

/* -------------------------
   DESKTOP RENDER (TABLE)
-------------------------- */
function renderDesktopRows(rows = []) {
  return rows
    .map((r, idx) => {
      const ship = r.shipment;

      const customer =
        `${r.first_name || ""} ${r.last_name || ""}`.trim() || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";

      const paid = moneyFromCents(r.total_paid_cents);
      const profit = moneyFromCents(r.profit_cents);

      const labelStatus = ship?.label_status || "pending";

      const date = formatDateShort(r.order_date);

      return `
        <tr class="align-top hover:bg-black/5 transition">
          <td class="px-4 py-3 text-sm whitespace-nowrap" title="${esc(r.order_date)}">
            ${esc(date)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap">
            <button
              type="button"
              data-view="${idx}"
              class="font-black text-kkpink hover:underline cursor-pointer"
              title="Click to view details"
            >${esc(r.kk_order_id || "—")}</button>
          </td>

          <td class="px-4 py-3 text-sm">
            <span class="font-black uppercase tracking-[.04em]">${esc(customer)}</span>
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap text-center">
            ${esc(items)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-black text-right">
            ${esc(paid)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-black text-right ${Number(r.profit_cents) > 0 ? 'text-emerald-600' : 'text-red-600'}">
            ${esc(profit)}
          </td>

          <td class="px-4 py-3">
            <span class="${statusPillClasses(labelStatus)}">
              ${esc(displayStatus(labelStatus))}
            </span>
          </td>

          <td class="px-4 py-3 text-right whitespace-nowrap">
            <button
              type="button"
              data-edit="${idx}"
              class="inline-flex items-center gap-2 border-[4px] border-black bg-white px-3 py-2
                     font-black uppercase tracking-[.14em] text-[11px]
                     hover:bg-black hover:text-white transition"
              aria-label="Edit order"
              title="Edit"
            >
              <span aria-hidden="true" class="text-[12px] leading-none">✎</span>
              <span>Edit</span>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

/* -------------------------
   MAIN
-------------------------- */
export function renderOrdersRows({ tbodyEl, rows = [], onEdit, onView, countLabelEl } = {}) {
  if (!tbodyEl) return;

  if (countLabelEl) {
    countLabelEl.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  }

  if (!rows.length) {
    tbodyEl.innerHTML = `
      <tr>
        <td colspan="12" class="px-4 py-8">
          <div class="text-sm text-black/70">No orders found.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbodyEl.innerHTML = isMobile() ? renderMobileCards(rows) : renderDesktopRows(rows);

  // bind edit
  tbodyEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-edit"));
      const row = rows[idx];
      if (row) onEdit?.(row);
    });
  });

  // bind view
  tbodyEl.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-view"));
      const row = rows[idx];
      if (row) onView?.(row);
    });
  });
}
