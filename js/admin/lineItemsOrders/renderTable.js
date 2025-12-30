// /js/admin/lineItemsOrders/renderTable.js
import { esc, moneyFromCents, gramsToOz, formatOz, formatDateShort } from "./dom.js";

function pillClass(labelStatus) {
  const s = String(labelStatus || "pending").toLowerCase();
  return `kk-admin-pill is-${esc(s)}`;
}

function displayStatus(labelStatus) {
  return labelStatus ? String(labelStatus) : "pending";
}

export function renderOrdersRows({ tbodyEl, rows = [], onEdit } = {}) {
  if (!tbodyEl) return;

  tbodyEl.innerHTML = rows
    .map((r, idx) => {
      const ship = r.shipment;

      const customer = `${r.first_name || ""} ${r.last_name || ""}`.trim() || "—";
      const email = r.email || "—";

      const items = r.total_items ?? r.li_total_items ?? "—";
      const weightG = r.total_weight_g ?? r.li_total_weight_g ?? null;
      const weightOz = weightG != null ? gramsToOz(weightG) : null;

      const paid = moneyFromCents(r.total_paid_cents);

      // ✅ finance fields (from v_order_summary_plus)
      const cost = moneyFromCents(r.order_cost_total_cents);
      const profit = moneyFromCents(r.profit_cents);

      const labelStatus = ship?.label_status || "pending";
      const tracking = ship?.tracking_number || "—";

      const date = formatDateShort(r.order_date);

      return `
        <tr data-row="${idx}">
          <td data-label="Date">${esc(date)}</td>
          <td data-label="Order"><strong>${esc(r.kk_order_id || "—")}</strong></td>
          <td data-label="Customer">${esc(customer)}</td>
          <td data-label="Email">${esc(email)}</td>
          <td data-label="Items">${esc(items)}</td>
          <td data-label="Weight">${esc(formatOz(weightOz))}</td>
          <td data-label="Paid">${esc(paid)}</td>
          <td data-label="Cost">${esc(cost)}</td>
          <td data-label="Profit">${esc(profit)}</td>
          <td data-label="Status"><span class="${pillClass(labelStatus)}">${esc(displayStatus(labelStatus))}</span></td>
          <td data-label="Tracking">${esc(tracking)}</td>
          <td data-label="Actions">
            <button class="kk-admin-rowbtn" type="button" data-edit="${idx}">
              Edit
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbodyEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-edit"));
      const row = rows[idx];
      if (row) onEdit?.(row);
    });
  });
}
