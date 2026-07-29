import { esc } from "./utils.js";
import { computeHealth } from "./listingHealth.js";
import { wsChips, rowEstProfitHtml } from "./renderHelpers.js";
import { ebayCodeLinkHtml, staleActionBadge, offerMappingDiagnosticHtml } from "./linkCheck.js";
import { renderProductActions } from "./productActions.js";

export function renderCards(products, pageAdRatePct) {
  const grid = document.getElementById("cardsGrid");
  if (!products.length) {
    grid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8 font-black uppercase tracking-[.14em] text-xs border-4 border-black border-dashed">No products found</p>';
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

    return `<div class="bg-white border-4 border-black overflow-hidden">
      <div class="aspect-square bg-gray-50 border-b-4 border-black">
        ${p.catalog_image_url ? `<img src="${p.catalog_image_url}" class="w-full h-full object-cover" alt="" />` : '<div class="w-full h-full flex items-center justify-center text-gray-300 text-xs font-black uppercase tracking-wider">No image</div>'}
      </div>
      <div class="p-3">
        <a href="/pages/admin/products.html?q=${encodeURIComponent(p.name)}" target="_blank" class="font-black text-sm line-clamp-2 leading-tight text-black hover:underline uppercase tracking-tight">${esc(p.name)}</a>
        <p class="text-[10px] font-mono text-gray-500 mt-1">${ebayCodeLinkHtml(p, true)}</p>
        ${offerMappingDiagnosticHtml(p, true)}
        <div class="flex items-center justify-between mt-2 gap-2">
          <div class="text-xs">
            <span class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">KK</span> <span class="font-black">${kkPrice}</span>
            <span class="text-gray-300 mx-1">|</span>
            <span class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">eBay</span> <span class="font-black">${ebayPrice}</span>
          </div>
          <div class="flex items-center gap-1 flex-wrap justify-end">
            <span class="ebay-status ebay-${status}">${statusLabel}</span>
            ${staleActionBadge(p)}
            ${scoreBadge}
          </div>
        </div>
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-[9px] text-gray-500 font-black uppercase tracking-[.14em]">Est Profit</span>
          ${rowEstProfitHtml(p, pageAdRatePct)}
        </div>
        ${wsChips(p, health)}
        <div class="flex gap-1 mt-3">${renderProductActions(p, true)}</div>
        ${status !== "not_listed"
          ? `<button class="w-full mt-1 border-2 border-black bg-white text-black py-2 text-[9px] font-black uppercase tracking-[.12em] hover:bg-gray-50 min-h-[44px]" data-action="open-sales" data-code="${esc(p.code)}">Sales History</button>`
          : ""}
      </div>
    </div>`;
  }).join("");
}
