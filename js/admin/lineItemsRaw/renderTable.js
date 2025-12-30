// /js/admin/lineItemsRaw/renderTable.js
import { esc, formatDateShort, money, centsToDollars } from "./dom.js";
import { state } from "./state.js";

export function renderTable({ tbodyEl, countLabelEl, onEdit } = {}) {
  if (!tbodyEl) return;

  const list = state.rows || [];

  if (countLabelEl) {
    countLabelEl.textContent = `${list.length} row${list.length === 1 ? "" : "s"}`;
  }

  tbodyEl.innerHTML = list
    .map((r) => {
      const prod = [r.product_name || r.product_id || "—", r.product_id ? `(${r.product_id})` : ""]
        .filter(Boolean)
        .join(" ");

      const qty = Number(r.quantity ?? 1);

      const unit =
        r.unit_price_cents != null ? money(Number(centsToDollars(r.unit_price_cents))) : "—";

      const paidUnit =
        r.post_discount_unit_price_cents != null
          ? money(Number(centsToDollars(r.post_discount_unit_price_cents)))
          : "—";

      const linePaidCents =
        r.post_discount_unit_price_cents != null
          ? Number(r.post_discount_unit_price_cents) * qty
          : null;

      const linePaid =
        linePaidCents != null ? money(Number(centsToDollars(linePaidCents))) : "—";

      return `
        <tr data-id="${esc(r.line_item_row_id)}">
          <td data-label="Date" title="${esc(r.order_date)}">${esc(formatDateShort(r.order_date))}</td>
          <td data-label="Order" title="${esc(r.kk_order_id || "")}"><strong>${esc(r.kk_order_id || "—")}</strong></td>
          <td data-label="Product" title="${esc(prod)}">${esc(prod)}</td>
          <td data-label="Variant" title="${esc(r.variant || "")}">${esc(r.variant || "—")}</td>
          <td data-label="Qty">${esc(qty)}</td>
          <td data-label="Unit">${esc(unit)}</td>
          <td data-label="Paid Unit">${esc(paidUnit)}</td>
          <td data-label="Line Total">${esc(linePaid)}</td>
          <td data-label="Actions" class="kk-admin-table-actions">
            <span class="kk-admin-row-actions">
              <button type="button" class="kk-lir-edit" data-edit="${esc(
                r.line_item_row_id
              )}">Edit</button>
            </span>
          </td>
        </tr>
      `;
    })
    .join("");

  tbodyEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const row = state.rows.find((x) => String(x.line_item_row_id) === String(id));
      if (!row) return;
      onEdit?.(row);
    });
  });
}
