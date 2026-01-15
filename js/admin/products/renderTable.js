import { escapeHtml, money } from "./dom.js";
import { state } from "./state.js";
import { getProfitIndicator, calculateProfitProjections } from "../pStorage/profitCalc.js";

/**
 * Sort products based on current sort state
 */
function sortProducts(products, catMap) {
  if (!state.sortColumn) return products;
  
  const dir = state.sortDirection === 'asc' ? 1 : -1;
  
  return [...products].sort((a, b) => {
    let aVal, bVal;
    
    switch (state.sortColumn) {
      case 'name':
        aVal = (a.name || '').toLowerCase();
        bVal = (b.name || '').toLowerCase();
        break;
      case 'code':
        aVal = (a.code || '').toLowerCase();
        bVal = (b.code || '').toLowerCase();
        break;
      case 'category':
        aVal = (catMap.get(String(a.category_id)) || '').toLowerCase();
        bVal = (catMap.get(String(b.category_id)) || '').toLowerCase();
        break;
      case 'price':
        aVal = Number(a.price) || 0;
        bVal = Number(b.price) || 0;
        break;
      case 'margin':
        // Calculate margin for sorting
        const aProj = (a.unit_cost && a.price) ? calculateProfitProjections({ price: a.price, weight_g: a.weight_g, unit_cost: a.unit_cost }) : null;
        const bProj = (b.unit_cost && b.price) ? calculateProfitProjections({ price: b.price, weight_g: b.weight_g, unit_cost: b.unit_cost }) : null;
        aVal = aProj?.cpiPaidShipping?.marginPercent ?? -999;
        bVal = bProj?.cpiPaidShipping?.marginPercent ?? -999;
        break;
      case 'status':
        aVal = a.is_active ? 1 : 0;
        bVal = b.is_active ? 1 : 0;
        break;
      default:
        return 0;
    }
    
    if (aVal < bVal) return -1 * dir;
    if (aVal > bVal) return 1 * dir;
    return 0;
  });
}

/**
 * Update sort icons in the table header
 */
function updateSortIcons() {
  document.querySelectorAll('[data-sort-icon]').forEach(icon => {
    const col = icon.getAttribute('data-sort-icon');
    if (col === state.sortColumn) {
      icon.textContent = state.sortDirection === 'asc' ? '↑' : '↓';
    } else {
      icon.textContent = '↕';
    }
  });
}

function mobileCardRow(p, cat, active, readOnly) {
  const imgUrl = p.catalog_image_url || p.primary_image_url || "";
  const statusClass = p.is_active ? "status-active" : "status-inactive";
  const statusText = p.is_active ? "Active" : "Inactive";
  const code = p.code || "";

  // Calculate margin for mobile card
  let marginBadge = '';
  if (p.unit_cost && p.price) {
    const projections = calculateProfitProjections({
      target_price: p.price,
      weight_g: p.weight_g,
      unit_cost: p.unit_cost
    });
    if (projections && projections.hasEnoughData && typeof projections.marginPaidShipping === 'number') {
      const indicator = getProfitIndicator(projections);
      marginBadge = `<span class="px-1.5 py-0.5 text-[8px] font-bold rounded-sm ${indicator.hasData ? '' : 'bg-gray-100 text-gray-500'}">${indicator.html || ''}</span>`;
    }
  }

  return `
    <div class="bg-white border-b-2 border-gray-200 p-3 active:bg-gray-50" data-product-card="${p.id}">
      <div class="flex gap-3">
        <!-- Thumbnail -->
        <div class="w-20 h-20 bg-gray-100 border-2 border-black flex-shrink-0 overflow-hidden">
          ${imgUrl 
            ? `<img src="${escapeHtml(imgUrl)}" class="w-full h-full object-cover" alt="" loading="lazy" />` 
            : `<div class="w-full h-full flex items-center justify-center text-gray-400 text-[10px]">No img</div>`}
        </div>

        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <!-- Top row: Name + Status -->
          <div>
            <div class="flex items-start justify-between gap-2">
              <div class="font-black text-sm leading-tight line-clamp-2">${escapeHtml(p.name || "")}</div>
              <span class="${statusClass} px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-sm flex-shrink-0">
                ${statusText}
              </span>
            </div>
            
            <!-- Meta row -->
            <div class="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
              ${code ? `<span class="bg-gray-100 px-1.5 py-0.5 font-mono">${escapeHtml(code)}</span>` : ''}
              <span class="truncate">${escapeHtml(cat || "No category")}</span>
            </div>
          </div>

          <!-- Bottom row: Price + Margin + Edit -->
          <div class="flex items-center justify-between mt-2">
            <div class="flex items-center gap-2">
              <div class="font-black text-base">${money(p.price)}</div>
              ${marginBadge}
            </div>
            ${!readOnly ? `
              <button
                type="button"
                data-edit="${p.id}"
                class="border-2 border-black bg-black text-white px-4 py-1.5 text-[10px] font-black uppercase tracking-[.08em]
                       active:bg-kkpink active:border-kkpink active:text-black"
              >
                Edit
              </button>
            ` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderTable({
  productRowsEl,
  countLabelEl,
  searchValue,
  onEdit,
  onEditError,
  readOnly = false,
  mobileCardsEl = null,
}) {
  if (!productRowsEl) return;

  const q = (searchValue || "").trim().toLowerCase();
  const categories = state.categories || [];
  const products = state.products || [];

  const filtered = products.filter((p) => {
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.slug || "").toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q)
    );
  });

  if (countLabelEl) {
    countLabelEl.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
  }

  const catMap = new Map(categories.map((c) => [String(c.id), c.name]));
  
  // Apply sorting
  const sorted = sortProducts(filtered, catMap);
  
  // Update sort icons
  updateSortIcons();

  // Get the mobile cards container
  const mobileEl = mobileCardsEl || document.getElementById('mobileProductCards');

  /* ---------------- MOBILE CARDS ---------------- */
  if (mobileEl) {
    mobileEl.innerHTML = sorted
      .map((p) => {
        const cat = catMap.get(String(p.category_id)) || "";
        const active = p.is_active ? "YES" : "NO";
        return mobileCardRow(p, cat, active, readOnly);
      })
      .join("");

    if (!readOnly) {
      mobileEl.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await onEdit(btn.dataset.edit);
          } catch (err) {
            console.error(err);
            onEditError?.(err);
          }
        });
      });
    }
  }

  /* ---------------- DESKTOP ---------------- */
  productRowsEl.innerHTML = sorted
    .map((p) => {
      const cat = catMap.get(String(p.category_id)) || "";
      const imgUrl = p.catalog_image_url || p.primary_image_url || "";
      const statusClass = p.is_active ? "status-active" : "status-inactive";
      const statusText = p.is_active ? "Active" : "Inactive";

      // Calculate margin if we have unit_cost and price
      let marginHtml = '<span class="text-gray-400">—</span>';
      if (p.unit_cost && p.price) {
        const projections = calculateProfitProjections({
          target_price: p.price,
          weight_g: p.weight_g,
          unit_cost: p.unit_cost
        });
        if (projections && projections.hasEnoughData && typeof projections.marginPaidShipping === 'number') {
          const indicator = getProfitIndicator(projections);
          marginHtml = indicator.html || '<span class="text-gray-400">—</span>';
        }
      }

      return `
        <tr class="product-row hover:bg-gray-50 transition-colors">
          <td class="px-4 py-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 bg-gray-100 border-2 border-black flex-shrink-0 overflow-hidden">
                ${imgUrl 
                  ? `<img src="${escapeHtml(imgUrl)}" class="w-full h-full object-cover" alt="" loading="lazy" />` 
                  : `<div class="w-full h-full flex items-center justify-center text-gray-400 text-[8px]">No img</div>`}
              </div>
              <span class="font-bold">${escapeHtml(p.name || "")}</span>
            </div>
          </td>
          <td class="px-4 py-3 text-gray-500 hidden md:table-cell">
            <span class="text-xs font-mono">${escapeHtml(p.slug || "—")}</span>
          </td>
          <td class="px-4 py-3 hidden sm:table-cell">
            <span class="bg-gray-100 px-2 py-1 text-xs font-mono">${escapeHtml(p.code || "—")}</span>
          </td>
          <td class="px-4 py-3">
            ${escapeHtml(cat || "—")}
          </td>
          <td class="px-4 py-3 text-right font-bold">
            ${money(p.price)}
          </td>
          <td class="px-4 py-3 text-center hidden lg:table-cell">
            ${marginHtml}
          </td>
          <td class="px-4 py-3 text-center">
            <span class="${statusClass} px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm">
              ${statusText}
            </span>
          </td>
          <td class="px-4 py-3 text-right">
            ${
              readOnly
                ? `<span class="text-xs text-gray-400">Read only</span>`
                : `
              <button
                type="button"
                data-edit="${p.id}"
                class="row-actions border-2 border-black px-4 py-2 text-[10px] font-black uppercase tracking-[.1em]
                       hover:bg-black hover:text-white transition-colors"
              >
                Edit
              </button>
            `
            }
          </td>
        </tr>
      `;
    })
    .join("");

  if (!readOnly) {
    productRowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await onEdit(btn.dataset.edit);
        } catch (err) {
          console.error(err);
          onEditError?.(err);
        }
      });
    });
  }
}
