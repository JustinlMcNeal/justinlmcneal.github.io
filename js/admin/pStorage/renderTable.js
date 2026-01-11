// /js/admin/pStorage/renderTable.js
import { money, esc } from "./dom.js";
import { getProfitIndicator } from "./profitCalc.js";

const stageConfig = {
  idea: { emoji: "💡", label: "Idea", class: "bg-gray-100 text-gray-700" },
  researching: { emoji: "🔍", label: "Researching", class: "bg-blue-100 text-blue-700" },
  sample: { emoji: "📦", label: "Sample", class: "bg-amber-100 text-amber-700" },
  pricing: { emoji: "💰", label: "Pricing", class: "bg-purple-100 text-purple-700" },
  ready: { emoji: "✅", label: "Ready", class: "bg-green-100 text-green-700" },
  archived: { emoji: "📁", label: "Archived", class: "bg-gray-800 text-white" },
};

function stagePill(stageRaw) {
  const stage = String(stageRaw || "idea").toLowerCase();
  const cfg = stageConfig[stage] || stageConfig.idea;
  
  return `
    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${cfg.class}">
      <span>${cfg.emoji}</span>
      <span>${cfg.label}</span>
    </span>
  `;
}

export function renderTable({ els, state }) {
  const rows = state.view || [];
  if (els.countLabel) {
    els.countLabel.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
  }

  // Empty state
  if (!rows.length) {
    els.storageRows.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-12 text-center">
          <div class="text-4xl mb-3">📦</div>
          <div class="text-lg font-bold text-gray-800">No stored items yet</div>
          <div class="text-sm text-gray-500 mt-1">
            Click <span class="font-bold">+ Add Item</span> to start your wishlist
          </div>
        </td>
      </tr>
    `;
    
    // Mobile cards empty state
    if (els.mobileCards) {
      els.mobileCards.innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div class="text-4xl mb-3">📦</div>
          <div class="text-lg font-bold text-gray-800">No stored items yet</div>
          <div class="text-sm text-gray-500 mt-1">Tap + to add your first item</div>
        </div>
      `;
    }
    return;
  }

  // Desktop table rows
  els.storageRows.innerHTML = rows
    .map((r, idx) => {
      const url = (r.url || "").trim();
      const name = esc(r.name || "Untitled");
      const stage = r.stage || "idea";
      const pid = esc(r.product_id || "");
      const tags = Array.isArray(r.tags) && r.tags.length ? r.tags : [];
      
      // Get profit indicator
      const profitInfo = getProfitIndicator(r);

      const nameLink = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-gray-900 hover:text-blue-600 hover:underline">${name}</a>`
        : `<span class="font-semibold text-gray-900">${name}</span>`;

      const metaLine = [
        pid ? `<span class="text-gray-400">${pid}</span>` : "",
        tags.length ? `<span class="text-gray-400">${esc(tags.slice(0, 2).join(", "))}${tags.length > 2 ? "..." : ""}</span>` : ""
      ].filter(Boolean).join(" · ");

      return `
        <tr data-id="${esc(r.id)}" class="hover:bg-gray-50 transition-colors cursor-pointer" data-action="edit">
          <td class="px-4 py-3">
            <div>${nameLink}</div>
            ${metaLine ? `<div class="text-xs mt-0.5">${metaLine}</div>` : ""}
          </td>
          <td class="px-4 py-3">${stagePill(stage)}</td>
          <td class="px-4 py-3 text-sm font-medium text-gray-700">${money(r.target_price)}</td>
          <td class="px-4 py-3 text-sm font-medium text-gray-700">${money(r.unit_cost)}</td>
          <td class="px-4 py-3">${profitInfo.hasData ? profitInfo.html : '<span class="text-xs text-gray-400">—</span>'}</td>
          <td class="px-4 py-3 text-right">
            <button
              type="button"
              data-action="edit"
              data-id="${esc(r.id)}"
              class="text-sm font-medium text-gray-600 hover:text-black hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Mobile cards
  if (els.mobileCards) {
    els.mobileCards.innerHTML = rows
      .map((r) => {
        const url = (r.url || "").trim();
        const name = esc(r.name || "Untitled");
        const stage = r.stage || "idea";
        const pid = esc(r.product_id || "");
        const tags = Array.isArray(r.tags) && r.tags.length ? r.tags : [];
        
        // Get profit indicator
        const profitInfo = getProfitIndicator(r);

        return `
          <div 
            data-id="${esc(r.id)}" 
            data-action="edit"
            class="bg-white rounded-xl border border-gray-200 p-4 active:bg-gray-50 transition-colors cursor-pointer"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-gray-900 truncate">${name}</div>
                ${pid ? `<div class="text-xs text-gray-400 mt-0.5">${pid}</div>` : ""}
              </div>
              <div class="flex flex-col items-end gap-1">
                ${stagePill(stage)}
                ${profitInfo.hasData ? profitInfo.html : ''}
              </div>
            </div>
            
            <div class="mt-3 flex items-center gap-4 text-sm">
              <div>
                <div class="text-xs text-gray-400">Target</div>
                <div class="font-semibold text-gray-800">${money(r.target_price)}</div>
              </div>
              <div>
                <div class="text-xs text-gray-400">Cost</div>
                <div class="font-semibold text-gray-800">${money(r.unit_cost)}</div>
              </div>
              ${profitInfo.hasData ? `
              <div>
                <div class="text-xs text-gray-400">Profit</div>
                <div class="font-semibold ${profitInfo.profit > 0 ? 'text-green-600' : 'text-red-600'}">
                  ${profitInfo.profit > 0 ? '+' : ''}$${profitInfo.profit.toFixed(2)}
                </div>
              </div>
              ` : ""}
            </div>
            
            ${tags.length ? `
            <div class="mt-3 flex flex-wrap gap-1">
              ${tags.slice(0, 3).map(t => `<span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">${esc(t)}</span>`).join("")}
              ${tags.length > 3 ? `<span class="text-xs text-gray-400">+${tags.length - 3}</span>` : ""}
            </div>
            ` : ""}
            
            ${url ? `
            <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" 
               class="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
               onclick="event.stopPropagation()">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"></path>
              </svg>
              View Source
            </a>
            ` : ""}
          </div>
        `;
      })
      .join("");
  }
}
