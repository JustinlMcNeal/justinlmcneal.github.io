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
      const email = r.email || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";
      const weightG = r.total_weight_g ?? r.li_total_weight_g ?? null;
      const weightOz = weightG != null ? gramsToOz(weightG) : null;

      const paid = moneyFromCents(r.total_paid_cents);
      const cost = moneyFromCents(r.order_cost_total_cents);
      const profit = moneyFromCents(r.profit_cents);

      const labelStatus = ship?.label_status || "pending";
      const tracking = formatTracking(ship?.tracking_number);

      return `
        <tr>
          <td colspan="12" class="p-0">
            <div class="border-b border-black/15 px-4 py-4">
              <!-- top line -->
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[11px] font-black uppercase tracking-[.18em] text-black/60">
                    ${esc(date)} · Order
                    <span class="text-black">${esc(orderId)}</span>
                  </div>

                  <div class="mt-2">
                    <div class="font-black uppercase tracking-[.06em] text-[12px]">
                      ${esc(customer)}
                    </div>
                    <div class="text-xs text-black/60 mt-1 break-words">
                      ${esc(email)}
                    </div>
                  </div>
                </div>

                <div class="shrink-0 flex flex-col items-end gap-2">
                  <span class="${statusPillClasses(labelStatus)}">
                    ${esc(displayStatus(labelStatus))}
                  </span>

                  <div class="flex gap-2">
                    <button
                      type="button"
                      data-view="${idx}"
                      class="inline-flex items-center gap-1 border-[4px] border-black bg-white px-3 py-2
                             font-black uppercase tracking-[.14em] text-[11px]
                             hover:bg-gray-100 transition"
                      aria-label="View order details"
                      title="View Details"
                    >
                      <span aria-hidden="true" class="text-[12px] leading-none">👁</span>
                    </button>
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
              </div>

              <!-- stats grid -->
              <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Items</div>
                  <div class="mt-1 font-black">${esc(items)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Weight</div>
                  <div class="mt-1 font-black">${esc(formatOz(weightOz))}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Paid</div>
                  <div class="mt-1 font-black">${esc(paid)}</div>
                </div>

                <div class="border-[3px] border-black p-3">
                  <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Profit</div>
                  <div class="mt-1 font-black">${esc(profit)}</div>
                  <div class="text-xs text-black/60 mt-1">Cost: ${esc(cost)}</div>
                </div>
              </div>

              <!-- tracking -->
              <div class="mt-3 border-[3px] border-black p-3">
                <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Tracking</div>
                <div class="mt-1 font-mono text-[12px] break-all">
                  ${esc(tracking)}
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
      const email = r.email || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";
      const weightG = r.total_weight_g ?? r.li_total_weight_g ?? null;
      const weightOz = weightG != null ? gramsToOz(weightG) : null;

      const paid = moneyFromCents(r.total_paid_cents);
      const cost = moneyFromCents(r.order_cost_total_cents);
      const profit = moneyFromCents(r.profit_cents);

      const labelStatus = ship?.label_status || "pending";
      const tracking = formatTracking(ship?.tracking_number);

      const date = formatDateShort(r.order_date);

      return `
        <tr class="align-top hover:bg-black/5 transition">
          <td class="px-4 py-3 text-sm whitespace-nowrap" title="${esc(r.order_date)}">
            ${esc(date)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap" title="${esc(r.kk_order_id || "")}">
            <span class="font-black">${esc(r.kk_order_id || "—")}</span>
          </td>

          <td class="px-4 py-3 text-sm">
            <span class="font-black uppercase tracking-[.04em]">${esc(customer)}</span>
          </td>

          <td class="px-4 py-3 text-sm text-black/70">
            ${esc(email)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap">
            ${esc(items)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap">
            ${esc(formatOz(weightOz))}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-black">
            ${esc(paid)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap">
            ${esc(cost)}
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-black">
            ${esc(profit)}
          </td>

          <td class="px-4 py-3">
            <span class="${statusPillClasses(labelStatus)}">
              ${esc(displayStatus(labelStatus))}
            </span>
          </td>

          <td class="px-4 py-3 text-sm whitespace-nowrap font-mono text-[12px]">
            ${esc(tracking)}
          </td>

          <td class="px-4 py-3 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                data-view="${idx}"
                class="inline-flex items-center justify-center border-[4px] border-black bg-white w-10 h-10
                       font-black text-[14px]
                       hover:bg-gray-100 transition"
                aria-label="View order details"
                title="View Details"
              >
                👁
              </button>
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
