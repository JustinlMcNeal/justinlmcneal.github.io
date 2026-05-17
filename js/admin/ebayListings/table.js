import { esc } from "./utils.js";
import { computeHealth } from "./listingHealth.js";
import { wsChips, rowEstProfitHtml } from "./renderHelpers.js";
import { ebayCodeLinkHtml, staleActionBadge, offerMappingDiagnosticHtml } from "./linkCheck.js";
import { renderProductActions } from "./productActions.js";
import { updateBulkBar } from "./bulkActions.js";

export function renderTable(products, pageAdRatePct) {
  const tbody = document.getElementById("productsBody");
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-400">No products found</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => {
    const kkPrice   = p.price             ? `$${Number(p.price).toFixed(2)}`            : "—";
    const ebayPrice = p.ebay_price_cents  ? `$${(p.ebay_price_cents / 100).toFixed(2)}` : "—";
    const status      = p.ebay_status || "not_listed";
    const statusLabel = { active: "Active", draft: "Draft", ended: "Ended", not_listed: "Not Listed" }[status] || status;
    const isListed    = status === "active" || status === "draft";

    const health      = computeHealth(p);
    const scoreBadge  = health.score !== null
      ? `<span class="health-badge health-${health.severity}" title="${esc(health.primaryLabel ? `${health.primaryLabel} — ${health.actionLabel}` : 'No issues found')}">${health.score}</span>`
      : "";

    return `<tr class="product-row border-b border-gray-100">
      <td class="py-2 pr-2">
        ${isListed ? `<input type="checkbox" class="bulk-check accent-kkpink" data-code="${esc(p.code)}" data-offer="${esc(p.ebay_offer_id || '')}" data-sku="${esc(p.ebay_sku || p.code)}" />` : ""}
      </td>
      <td class="py-2 pr-3">
        <div class="flex items-start gap-2">
          ${p.catalog_image_url ? `<img src="${p.catalog_image_url}" class="w-8 h-8 object-cover rounded flex-shrink-0" />` : '<div class="w-8 h-8 bg-gray-100 rounded flex-shrink-0"></div>'}
          <div class="min-w-0">
            <a href="/pages/admin/products.html?q=${encodeURIComponent(p.name)}" target="_blank" class="font-medium text-sm line-clamp-1 text-blue-600 hover:underline">${esc(p.name)}</a>
            <div class="text-[10px] font-mono text-gray-400 leading-none mt-0.5">${ebayCodeLinkHtml(p)}</div>
            ${offerMappingDiagnosticHtml(p)}
            ${wsChips(p, health)}
          </div>
        </div>
      </td>
      <td class="py-2 pr-3 text-xs">${kkPrice}</td>
      <td class="py-2 pr-3 text-xs">${ebayPrice}</td>
      <td class="py-2 pr-3 text-xs">${rowEstProfitHtml(p, pageAdRatePct)}</td>
      <td class="py-2 pr-3">
        <div class="flex flex-col items-start gap-0.5">
          <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ebay-${status}">${statusLabel}</span>
          ${staleActionBadge(p)}
          ${scoreBadge}
        </div>
      </td>
      <td class="py-2">
        <div class="flex gap-1">
          ${renderProductActions(p)}
          ${status !== "not_listed"
            ? `<button class="border border-gray-200 text-gray-400 px-1.5 py-1 rounded text-[10px] hover:bg-gray-100 hover:text-black transition-all" data-action="open-sales" data-code="${esc(p.code)}" title="Sales history">📊</button>`
            : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  updateBulkBar();
}
