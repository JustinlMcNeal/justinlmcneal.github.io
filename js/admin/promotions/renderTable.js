import { escapeHtml, money, formatDate, getPromotionTypeLabel } from "./dom.js";
import { state } from "./state.js";

export function renderTable({
  promotionRowsEl,
  countLabelEl,
  searchValue,
  onEdit,
  onEditError,
}) {
  if (!promotionRowsEl) return;

  const q = (searchValue || "").trim().toLowerCase();
  const promotions = state.promotions || [];

  const filtered = promotions.filter((p) => {
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q) ||
      (p.type || "").toLowerCase().includes(q)
    );
  });

  if (countLabelEl) {
    countLabelEl.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
  }

  promotionRowsEl.innerHTML = filtered
    .map((p) => {
      const active = p.is_active ? "YES" : "NO";
      const typeLabel = getPromotionTypeLabel(p.type);
      const valueDisplay = p.type === "percentage" ? `${p.value}%` : money(p.value);
      const startDate = formatDate(p.start_date);
      const endDate = formatDate(p.end_date);

      return `
        <tr>
          <td><strong>${escapeHtml(p.name || "")}</strong></td>
          <td>${escapeHtml(p.code || "")}</td>
          <td><span class="kk-promo-type-badge ${p.type}">${escapeHtml(typeLabel)}</span></td>
          <td>${escapeHtml(valueDisplay)}</td>
          <td>${active}</td>
          <td>${startDate}</td>
          <td>${endDate}</td>
          <td class="kk-admin-table-actions">
            <div class="kk-admin-row-actions">
              <button type="button" data-edit="${p.id}">Edit</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  promotionRowsEl.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await onEdit(btn.dataset.edit);
      } catch (err) {
        console.error("[Admin Promotions] openEdit failed:", err);
        if (onEditError) onEditError(err);
        else alert(err?.message || String(err));
      }
    });
  });
}
