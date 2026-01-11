import { escapeHtml, money, formatDate, getPromotionTypeLabel } from "./dom.js";
import { state } from "./state.js";

function badgeClass(type) {
  const t = String(type || "").toLowerCase();
  if (t === "bogo") return "type-bogo";
  if (t === "percentage") return "type-percentage";
  if (t === "fixed") return "type-fixed";
  if (t === "free-shipping") return "type-free-shipping";
  return "bg-gray-100 text-gray-800";
}

function getStatusInfo(promo) {
  const now = new Date();
  const start = promo.start_date ? new Date(promo.start_date) : null;
  const end = promo.end_date ? new Date(promo.end_date) : null;
  
  if (!promo.is_active) {
    return { class: "status-inactive", text: "Inactive" };
  }
  if (end && now > end) {
    return { class: "status-expired", text: "Expired" };
  }
  if (start && now < start) {
    return { class: "status-scheduled", text: "Scheduled" };
  }
  return { class: "status-active", text: "Active" };
}

function mobileCardRow(p, onEditId) {
  const typeLabel = getPromotionTypeLabel(p.type);
  const statusInfo = getStatusInfo(p);
  const valueDisplay =
    String(p.type || "").toLowerCase() === "percentage"
      ? `${Number(p.value || 0)}%`
      : money(p.value);

  const startDate = formatDate(p.start_date);
  const endDate = formatDate(p.end_date);

  return `
    <div class="bg-white border-b border-gray-200 p-4 active:bg-gray-50" data-promo-card="${p.id}">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="flex-1 min-w-0">
          <div class="font-black text-sm leading-tight line-clamp-2">${escapeHtml(p.name || "")}</div>
          ${p.code ? `<div class="text-xs text-gray-500 font-mono mt-1 bg-gray-100 inline-block px-2 py-0.5 rounded">${escapeHtml(p.code)}</div>` : '<div class="text-xs text-gray-400 mt-1">Auto-applied</div>'}
        </div>
        <span class="${statusInfo.class} px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg flex-shrink-0">
          ${statusInfo.text}
        </span>
      </div>
      
      <div class="flex items-center gap-2 mb-3 flex-wrap">
        <span class="${badgeClass(p.type)} px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg">
          ${escapeHtml(typeLabel)}
        </span>
        <span class="font-bold text-sm">${escapeHtml(valueDisplay)}</span>
      </div>
      
      ${(startDate || endDate) ? `
        <div class="text-xs text-gray-500 mb-3">
          ${startDate ? `<span>📅 ${escapeHtml(startDate)}</span>` : ''}
          ${startDate && endDate ? ' → ' : ''}
          ${endDate ? `<span>${escapeHtml(endDate)}</span>` : ''}
        </div>
      ` : ''}
      
      ${p.description ? `<div class="text-xs text-gray-600 mb-3 line-clamp-2">${escapeHtml(p.description)}</div>` : ''}
      
      <button
        type="button"
        data-edit="${p.id}"
        class="w-full border-2 border-black bg-black text-white px-4 py-2 text-[11px] font-black uppercase tracking-[.08em]
               rounded-lg active:bg-gray-800"
      >
        Edit
      </button>
    </div>
  `;
}

export function renderTable({
  promotionRowsEl,
  countLabelEl,
  searchValue,
  onEdit,
  onEditError,
  mobileCardsEl = null,
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
    countLabelEl.textContent = `${filtered.length} item${
      filtered.length === 1 ? "" : "s"
    }`;
  }

  // Get the mobile cards container
  const mobileEl = mobileCardsEl || document.getElementById('mobilePromotionCards');

  /* ---------------- MOBILE CARDS ---------------- */
  if (mobileEl) {
    mobileEl.innerHTML = filtered
      .map((p) => mobileCardRow(p, p.id))
      .join("");

    mobileEl.querySelectorAll("[data-edit]").forEach((btn) => {
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

  /* ---------------- DESKTOP TABLE ---------------- */
  promotionRowsEl.innerHTML = filtered
    .map((p) => {
      const typeLabel = getPromotionTypeLabel(p.type);
      const statusInfo = getStatusInfo(p);

      const valueDisplay =
        String(p.type || "").toLowerCase() === "percentage"
          ? `${Number(p.value || 0)}%`
          : money(p.value);

      const startDate = formatDate(p.start_date);
      const endDate = formatDate(p.end_date);

      return `
        <tr class="hover:bg-gray-50 transition-colors">
          <td class="px-4 py-3">
            <div class="font-bold text-sm">${escapeHtml(p.name || "")}</div>
            ${p.description ? `<div class="text-xs text-gray-500 mt-1 line-clamp-1">${escapeHtml(p.description)}</div>` : ''}
          </td>

          <td class="px-4 py-3 hidden md:table-cell">
            ${p.code 
              ? `<span class="font-mono text-sm bg-gray-100 px-2 py-1 rounded">${escapeHtml(p.code)}</span>` 
              : `<span class="text-xs text-gray-400">Auto</span>`}
          </td>

          <td class="px-4 py-3">
            <span class="${badgeClass(p.type)} px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg">
              ${escapeHtml(typeLabel)}
            </span>
          </td>

          <td class="px-4 py-3 hidden lg:table-cell font-bold text-sm">
            ${escapeHtml(valueDisplay)}
          </td>

          <td class="px-4 py-3 text-center">
            <span class="${statusInfo.class} px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg">
              ${statusInfo.text}
            </span>
          </td>

          <td class="px-4 py-3 hidden xl:table-cell text-xs text-gray-500">
            ${startDate ? `<div>${escapeHtml(startDate)}</div>` : ''}
            ${endDate ? `<div class="text-gray-400">→ ${escapeHtml(endDate)}</div>` : ''}
          </td>

          <td class="px-4 py-3 text-right">
            <button
              type="button"
              data-edit="${escapeHtml(p.id)}"
              class="border-2 border-black px-4 py-2 text-[10px] font-black uppercase tracking-[.1em]
                     hover:bg-black hover:text-white transition-colors rounded-lg"
            >
              Edit
            </button>
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
