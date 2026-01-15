function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function badge(active) {
  return active
    ? `<span class="status-active px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm">Active</span>`
    : `<span class="status-inactive px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm">Inactive</span>`;
}

/**
 * Render mobile card for a category
 */
function mobileCard(c) {
  const id = esc(c.id);
  const name = esc(c.name);
  const slug = esc(c.slug);
  const img = c.home_image_path || "";
  const order = Number.isFinite(Number(c.home_sort_order)) ? c.home_sort_order : "—";
  const active = !!c.is_active;

  return `
    <div class="bg-white border-b-2 border-gray-200 p-3 active:bg-gray-50" data-category-card="${id}">
      <div class="flex gap-3">
        <!-- Thumbnail -->
        <div class="w-16 h-16 bg-gray-100 border-2 border-black flex-shrink-0 overflow-hidden rounded">
          ${img 
            ? `<img src="${esc(img)}" class="w-full h-full object-cover" alt="" loading="lazy" />` 
            : `<div class="w-full h-full flex items-center justify-center text-gray-400 text-lg">📂</div>`}
        </div>

        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <!-- Top row: Name + Status -->
          <div>
            <div class="flex items-start justify-between gap-2">
              <div class="font-black text-sm leading-tight">${name}</div>
              ${badge(active)}
            </div>
            
            <!-- Meta row -->
            <div class="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
              <span class="bg-gray-100 px-1.5 py-0.5 font-mono">${slug}</span>
              <span>Order: ${order}</span>
            </div>
          </div>

          <!-- Bottom row: Edit button -->
          <div class="flex items-center justify-end mt-2">
            <button
              class="border-2 border-black bg-black text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider
                     hover:bg-pink-500 hover:border-pink-500 transition-all"
              data-edit="${id}"
              type="button"
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render desktop table row for a category
 */
function desktopRow(c) {
  const id = esc(c.id);
  const name = esc(c.name);
  const slug = esc(c.slug);
  const img = esc(c.home_image_path || "—");
  const order = Number.isFinite(Number(c.home_sort_order)) ? esc(c.home_sort_order) : "—";
  const active = !!c.is_active;

  return `
    <tr class="category-row hover:bg-gray-50 transition-colors">
      <td class="px-4 py-3">
        <span class="font-bold">${name}</span>
      </td>
      <td class="px-4 py-3 text-gray-500">
        <span class="text-xs font-mono bg-gray-100 px-2 py-1">${slug}</span>
      </td>
      <td class="px-4 py-3">
        <div class="truncate max-w-[200px] text-xs text-gray-500" title="${img}">${img}</div>
      </td>
      <td class="px-4 py-3 text-center">
        <span class="inline-flex items-center justify-center w-8 h-8 border-2 border-black font-bold text-sm">${order}</span>
      </td>
      <td class="px-4 py-3 text-center">
        ${badge(active)}
      </td>
      <td class="px-4 py-3 text-right">
        <button
          class="row-actions border-2 border-black bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider
                 hover:bg-black hover:text-white transition-all"
          data-edit="${id}"
          type="button"
        >
          Edit
        </button>
      </td>
    </tr>
  `;
}

export function renderCategoryTable(rowsEl, categories, onEdit) {
  // Desktop table
  rowsEl.innerHTML = categories.map(c => desktopRow(c)).join("");

  // Mobile cards
  const mobileContainer = document.getElementById("mobileCategoryCards");
  if (mobileContainer) {
    mobileContainer.innerHTML = categories.map(c => mobileCard(c)).join("");
    mobileContainer.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => onEdit(btn.dataset.edit));
    });
  }

  // Update count label
  const countLabel = document.getElementById("countLabel");
  if (countLabel) {
    countLabel.textContent = `${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`;
  }

  // Show/hide empty state
  const emptyState = document.getElementById("emptyState");
  if (emptyState) {
    emptyState.classList.toggle("hidden", categories.length > 0);
  }

  // Bind desktop edit buttons
  rowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => onEdit(btn.dataset.edit));
  });
}
