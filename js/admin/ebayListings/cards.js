import { esc } from "./utils.js";
import { computeHealth } from "./listingHealth.js";
import { wsChips, rowEstProfitHtml } from "./renderHelpers.js";
import { ebayCodeLinkHtml, staleActionBadge } from "./linkCheck.js";
import { renderProductActions } from "./productActions.js";

export function renderCards(products, pageAdRatePct) {
  const grid = document.getElementById("cardsGrid");
  if (!products.length) {
    grid.innerHTML = '<p class="col-span-full text-center text-gray-400 py-8">No products found</p>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const kkPrice   = p.price            ? `$${Number(p.price).toFixed(2)}`            : "—";
    const ebayPrice = p.ebay_price_cents ? `$${(p.ebay_price_cents / 100).toFixed(2)}` : "—";
    const status      = p.ebay_status || "not_listed";
    const statusLabel = { active: "Active", draft: "Draft", ended: "Ended", not_listed: "Not Listed" }[status] || status;

    const health     = computeHealth(p);
    const scoreBadge = health.score !== null
      ? `<span class="health-badge health-${health.severity}" title="${esc(health.primaryLabel ? `${health.primaryLabel} — ${health.actionLabel}` : 'No issues found')}">${health.score}</span>`
      : "";

    return `<div class="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      <div class="aspect-square bg-gray-50">
        ${p.catalog_image_url ? `<img src="${p.catalog_image_url}" class="w-full h-full object-cover" />` : '<div class="w-full h-full flex items-center justify-center text-gray-300 text-3xl">📦</div>'}
      </div>
      <div class="p-3">
        <a href="/pages/admin/products.html?q=${encodeURIComponent(p.name)}" target="_blank" class="font-bold text-sm line-clamp-2 leading-tight text-blue-600 hover:underline">${esc(p.name)}</a>
        <p class="text-[10px] font-mono text-gray-400 mt-1">${ebayCodeLinkHtml(p, true)}</p>
        <div class="flex items-center justify-between mt-2">
          <div class="text-xs">
            <span class="text-gray-500">KK</span> <span class="font-bold">${kkPrice}</span>
            <span class="text-gray-300 mx-1">|</span>
            <span class="text-gray-500">eBay</span> <span class="font-bold">${ebayPrice}</span>
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ebay-${status}">${statusLabel}</span>
            ${staleActionBadge(p)}
            ${scoreBadge}
          </div>
        </div>
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">Est Profit</span>
          ${rowEstProfitHtml(p, pageAdRatePct)}
        </div>
        ${wsChips(p, health)}
        <div class="flex gap-1 mt-3">${renderProductActions(p, true)}</div>
        ${status !== "not_listed"
          ? `<button class="w-full mt-1 border border-gray-100 text-gray-400 py-1 rounded text-[9px] font-semibold hover:bg-gray-50 hover:text-black transition-all" data-action="open-sales" data-code="${esc(p.code)}">📊 Sales History</button>`
          : ""}
      </div>
    </div>`;
  }).join("");
}
