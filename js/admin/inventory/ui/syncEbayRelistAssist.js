/**
 * eBay ended-listing relist assist section (Phase 7E) for Sync Channels modal.
 * Assist-only: links + audit log. No live eBay publish/relist from Inventory.
 */

import { esc } from "../utils/formatters.js";
import {
  summarizeRelistCandidates,
  logEbayRelistAssistAction,
  ebayPublicListingUrl,
  ebaySellSimilarUrl,
  kkEbayListingsAdminUrl,
} from "../api/ebayRelistAssistApi.js";

const ACTION_LABELS = {
  ready_to_relist: "Ready to relist",
  no_available_stock: "No available stock",
  unsupported_variation: "Unsupported variation",
  needs_mapping: "Needs mapping",
  missing_required_listing_data: "Missing listing data",
  manual_review: "Manual review",
};

const ACTION_TONES = {
  ready_to_relist: "text-green-800 bg-green-50 border-green-200",
  no_available_stock: "text-gray-700 bg-gray-50 border-gray-200",
  unsupported_variation: "text-amber-900 bg-amber-50 border-amber-200",
  needs_mapping: "text-orange-900 bg-orange-50 border-orange-200",
  missing_required_listing_data: "text-red-900 bg-red-50 border-red-200",
  manual_review: "text-purple-900 bg-purple-50 border-purple-200",
};

/** @param {import('../api/ebayRelistAssistApi.js').EbayRelistCandidateRow[]} candidates */
function renderCandidateRows(candidates) {
  if (!candidates.length) {
    return `<tr><td colspan="6" class="py-3 px-2 text-xs text-amber-900/70">No ended eBay listings in relist candidate view.</td></tr>`;
  }

  return candidates
    .slice(0, 12)
    .map((r) => {
      const action = r.relist_action || "manual_review";
      const tone = ACTION_TONES[action] || ACTION_TONES.manual_review;
      const missing = Array.isArray(r.required_fields_missing)
        ? r.required_fields_missing.join(", ")
        : "";
      const listingUrl = ebayPublicListingUrl(r.old_ebay_listing_id);
      const listingCell = listingUrl
        ? `<a href="${esc(listingUrl)}" target="_blank" rel="noopener noreferrer" class="font-mono text-[10px] underline">${esc(r.old_ebay_listing_id)}</a>`
        : esc(r.old_ebay_listing_id || "—");

      return `<tr class="border-t border-amber-100 text-xs" data-ebay-relist-row
          data-product-id="${esc(r.product_id)}"
          data-variant-id="${esc(r.variant_id || "")}"
          data-listing-id="${esc(r.old_ebay_listing_id || "")}"
          data-product-code="${esc(r.product_code || "")}"
          data-relist-action="${esc(action)}">
        <td class="py-2 px-2">
          <span class="font-mono">${esc(r.internal_sku || "—")}</span>
          <span class="block text-[10px] text-gray-600">${esc(r.product_label || "—")}</span>
        </td>
        <td class="py-2 px-2">${listingCell}</td>
        <td class="py-2 px-2 text-right font-bold">${esc(r.available_qty ?? "—")}</td>
        <td class="py-2 px-2">
          <span class="inline-block border rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${tone}">${esc(ACTION_LABELS[action] || action)}</span>
          ${missing ? `<span class="block text-[10px] text-red-800 mt-0.5">Missing: ${esc(missing)}</span>` : ""}
        </td>
        <td class="py-2 px-2">
          <div class="flex flex-wrap gap-1">
            <button type="button" data-ebay-relist-open-admin class="border border-amber-700 text-amber-900 px-1.5 py-1 text-[10px] font-black uppercase hover:bg-amber-100">eBay Admin</button>
            <button type="button" data-ebay-relist-mark-review class="border border-gray-400 text-gray-800 px-1.5 py-1 text-[10px] font-black uppercase hover:bg-gray-100">Mark Review</button>
            ${
              action === "ready_to_relist" || action === "missing_required_listing_data"
                ? `<button type="button" data-ebay-relist-open-listings class="border border-amber-800 bg-amber-700 text-white px-1.5 py-1 text-[10px] font-black uppercase hover:bg-amber-800">KK Listings</button>`
                : ""
            }
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

/**
 * @param {import('../api/ebayRelistAssistApi.js').EbayRelistCandidateRow[]} candidates
 */
export function renderEbayRelistAssistSection(candidates) {
  const summary = summarizeRelistCandidates(candidates);

  return `
    <section class="border-4 border-amber-600 rounded-xl p-4 bg-amber-50/40 space-y-3">
      <div>
        <h3 class="text-sm font-black uppercase tracking-[.08em] text-amber-900">eBay Ended-Listing Relist Assist</h3>
        <p class="text-xs text-amber-900/80 mt-1">
          Identifies ended eBay listings with stock available. <strong>Assist-only</strong> — opens eBay Seller Hub / KK eBay Listings admin.
          No automatic relist or quantity push from Inventory.
        </p>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div class="border border-amber-200 rounded-lg p-2 bg-white"><span class="font-black">Ended total</span><br><strong>${esc(summary.total)}</strong></div>
        <div class="border border-green-300 rounded-lg p-2 bg-white"><span class="font-black">Ready to relist</span><br><strong class="text-green-800">${esc(summary.readyToRelist)}</strong></div>
        <div class="border border-gray-300 rounded-lg p-2 bg-white"><span class="font-black">No stock</span><br><strong>${esc(summary.noAvailableStock)}</strong></div>
        <div class="border border-amber-300 rounded-lg p-2 bg-white"><span class="font-black">Unsupported var.</span><br><strong>${esc(summary.unsupportedVariation)}</strong></div>
        <div class="border border-red-200 rounded-lg p-2 bg-white"><span class="font-black">Missing data</span><br><strong>${esc(summary.missingData)}</strong></div>
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Manual review</span><br><strong>${esc(summary.manualReview)}</strong></div>
      </div>
      <div class="overflow-x-auto border-2 border-amber-200 rounded-xl bg-white">
        <table class="w-full text-left min-w-[640px]">
          <thead class="bg-amber-50 text-[10px] font-black uppercase tracking-[.1em] text-amber-900">
            <tr>
              <th class="py-2 px-2">Product / SKU</th>
              <th class="py-2 px-2">Old listing ID</th>
              <th class="py-2 px-2 text-right">Available</th>
              <th class="py-2 px-2">Action / reason</th>
              <th class="py-2 px-2">Assist</th>
            </tr>
          </thead>
          <tbody>${renderCandidateRows(candidates)}</tbody>
        </table>
      </div>
      <p class="text-[10px] text-amber-900/70">
        Ready-to-relist requires available &gt; 0, single-SKU listing (no variation group), and category + price on product.
        Use KK eBay Listings → Push modal to create a <em>draft</em> listing; publish only from that page with explicit confirmation.
      </p>
    </section>`;
}

/** @param {HTMLElement} mount */
export function wireEbayRelistAssistActions(mount) {
  mount.querySelectorAll("[data-ebay-relist-row]").forEach((row) => {
    const productId = row.getAttribute("data-product-id");
    const variantId = row.getAttribute("data-variant-id") || undefined;
    const listingId = row.getAttribute("data-listing-id") || null;
    const productCode = row.getAttribute("data-product-code") || "";

    row.querySelector("[data-ebay-relist-open-admin]")?.addEventListener("click", async () => {
      const sellSimilar = ebaySellSimilarUrl(listingId);
      const publicUrl = ebayPublicListingUrl(listingId);
      const target = sellSimilar || publicUrl || "https://www.ebay.com/sh/lst/ended";
      window.open(target, "_blank", "noopener,noreferrer");
      try {
        await logEbayRelistAssistAction({
          productId,
          variantId,
          oldEbayListingId: listingId,
          actionType: "opened_admin",
          notes: `Opened ${target}`,
        });
      } catch {
        // audit failure should not block navigation
      }
    });

    row.querySelector("[data-ebay-relist-mark-review]")?.addEventListener("click", async () => {
      const notes = window.prompt("Relist review note (optional):", "") ?? "";
      try {
        await logEbayRelistAssistAction({
          productId,
          variantId,
          oldEbayListingId: listingId,
          actionType: "marked_review",
          status: "pending",
          notes: notes.trim() || "Marked for relist review from Inventory sync modal",
        });
        const { showInventoryToast } = await import("../events.js");
        showInventoryToast("Marked for relist review", { variant: "success" });
      } catch (err) {
        const { showInventoryToast } = await import("../events.js");
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });

    row.querySelector("[data-ebay-relist-open-listings]")?.addEventListener("click", async () => {
      const url = kkEbayListingsAdminUrl(productCode);
      window.open(url, "_blank", "noopener,noreferrer");
      try {
        await logEbayRelistAssistAction({
          productId,
          variantId,
          oldEbayListingId: listingId,
          actionType: "draft_created",
          status: "opened_kk_listings",
          notes: `Opened KK eBay Listings admin for draft workflow (${productCode || "no code"})`,
        });
      } catch {
        // non-blocking
      }
    });
  });
}
