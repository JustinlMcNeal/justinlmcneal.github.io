import { esc } from "./utils.js";
import { computeHealth } from "./listingHealth.js";
import { wsChips, rowEstProfitHtml } from "./renderHelpers.js";
import { ebayCodeLinkHtml, staleActionBadge, offerMappingDiagnosticHtml } from "./linkCheck.js";
import { renderProductActions } from "./productActions.js";
import { updateBulkBar } from "./bulkActions.js";

export function renderTable(products, pageAdRatePct) {
  const tbody = document.getElementById("productsBody");
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-400 text-sm">No products found</td></tr>';
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
      <td class="py-2.5 pr-2 align-top">
        ${isListed ? `<input type="checkbox" class="bulk-check accent-kkpink mt-1" data-code="${esc(p.code)}" data-offer="${esc(p.ebay_offer_id || '')}" data-sku="${esc(p.ebay_sku || p.code)}" />` : ""}
      </td>
      <td class="py-2.5 pr-3 align-top">
        <div class="flex items-start gap-2.5">
          ${p.catalog_image_url
            ? `<img src="${p.catalog_image_url}" class="w-9 h-9 object-cover rounded-sm border border-gray-200 flex-shrink-0" alt="" />`
            : '<div class="w-9 h-9 bg-gray-100 rounded-sm border border-gray-200 flex-shrink-0"></div>'}
          <div class="min-w-0">
            <a href="/pages/admin/products.html?q=${encodeURIComponent(p.name)}" target="_blank" class="font-semibold text-sm text-gray-900 hover:underline leading-snug line-clamp-2">${esc(p.name)}</a>
            <div class="text-[10px] font-mono text-gray-400 leading-none mt-1">${ebayCodeLinkHtml(p)}</div>
            ${offerMappingDiagnosticHtml(p)}
            ${wsChips(p, health)}
          </div>
        </div>
      </td>
      <td class="py-2.5 pr-3 text-sm text-gray-800 align-top">${kkPrice}</td>
      <td class="py-2.5 pr-3 text-sm font-semibold text-gray-900 align-top">${ebayPrice}</td>
      <td class="py-2.5 pr-3 text-xs align-top">${rowEstProfitHtml(p, pageAdRatePct)}</td>
      <td class="py-2.5 pr-3 align-top">
        <div class="flex flex-col items-start gap-1">
          <span class="ebay-status ebay-${status}">${statusLabel}</span>
          ${staleActionBadge(p)}
          ${scoreBadge}
        </div>
      </td>
      <td class="py-2.5 align-top">
        <div class="flex flex-wrap gap-1">
          ${renderProductActions(p)}
          ${status !== "not_listed"
            ? `<button class="border border-gray-300 bg-white text-gray-600 px-2 py-1 text-[10px] font-bold uppercase tracking-[.08em] hover:border-black hover:text-black rounded-sm" data-action="open-sales" data-code="${esc(p.code)}" title="Sales history">Sales</button>`
            : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  updateBulkBar();
}
