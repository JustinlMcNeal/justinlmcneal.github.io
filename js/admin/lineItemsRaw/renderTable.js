// /js/admin/lineItemsRaw/renderTable.js
import { esc, formatDateShort, money, centsToDollars } from "./dom.js";
import { state } from "./state.js";

function editButton(id) {
  return `
    <button
      type="button"
      data-edit="${esc(id)}"
      class="inline-flex items-center gap-2
             border-[4px] border-black bg-white px-3 py-2
             font-black uppercase tracking-[.14em] text-[11px]
             hover:bg-black hover:text-white transition"
      aria-label="Edit line item"
      title="Edit"
    >
      <span class="text-[12px] leading-none">✎</span>
      <span>Edit</span>
    </button>
  `;
}

export function renderTable({ tbodyEl, countLabelEl, onEdit } = {}) {
  if (!tbodyEl) return;

  const list = state.rows || [];

  if (countLabelEl) {
    countLabelEl.textContent = `${list.length} row${list.length === 1 ? "" : "s"}`;
  }

  if (!list.length) {
    tbodyEl.innerHTML = `
      <tr>
        <td colspan="9" class="px-4 py-6">
          <div class="text-sm text-black/70">No rows yet.</div>
        </td>
      </tr>
    `;
    return;
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
        <tr
          data-id="${esc(r.line_item_row_id)}"
          class="align-top hover:bg-black/5 transition"
        >
          <td class="px-3 py-3 text-sm whitespace-nowrap" title="${esc(r.order_date)}">
            ${esc(formatDateShort(r.order_date))}
          </td>

          <td class="px-3 py-3 text-sm whitespace-nowrap" title="${esc(r.kk_order_id || "")}">
            <span class="font-black">${esc(r.kk_order_id || "—")}</span>
          </td>

          <td class="px-3 py-3 text-sm" title="${esc(prod)}">
            <span class="font-black uppercase tracking-[.04em]">${esc(prod)}</span>
          </td>

          <td class="px-3 py-3 text-sm" title="${esc(r.variant || "")}">
            ${esc(r.variant || "—")}
          </td>

          <td class="px-3 py-3 text-sm whitespace-nowrap">
            ${esc(qty)}
          </td>

          <td class="px-3 py-3 text-sm whitespace-nowrap">
            ${esc(unit)}
          </td>

          <td class="px-3 py-3 text-sm whitespace-nowrap">
            ${esc(paidUnit)}
          </td>

          <td class="px-3 py-3 text-sm whitespace-nowrap">
            <span class="font-black">${esc(linePaid)}</span>
          </td>

          <td class="px-3 py-3 whitespace-nowrap">
            ${editButton(r.line_item_row_id)}
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
