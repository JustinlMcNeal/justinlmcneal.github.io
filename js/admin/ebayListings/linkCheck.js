import { esc } from "./utils.js";

export function isLinkedOnEbay(p) {
  const status = p?.ebay_status || "not_listed";
  return status === "active" && (p.ebay_sku || p.ebay_offer_id || p.ebay_listing_id || p.ebay_item_group_key);
}

export function isStaleLinkCheck(check) {
  return Boolean(check && ["stale", "ambiguous", "no_active_match", "offer_mapping_unresolved", "ebay_api_failure"].includes(check.state));
}

export function isOutOfStockLinkCheck(check) {
  return Boolean(check?.success && check.state === "out_of_stock");
}

export function isLinkWarningCheck(check) {
  return isStaleLinkCheck(check) || isOutOfStockLinkCheck(check);
}

export function staleActionState(p) {
  const state = p?._linkCheck?.state;
  return ["stale", "ambiguous", "no_active_match", "offer_mapping_unresolved", "ebay_api_failure", "out_of_stock"].includes(state) ? state : "";
}

export function staleActionBadge(p) {
  const state = staleActionState(p);
  if (!state) return "";
  const label = state === "no_active_match" ? "No active eBay listing found" : staleLinkLabel(p._linkCheck);
  const cls = state === "out_of_stock" ? "bg-orange-100 text-orange-800" : "bg-amber-100 text-amber-800";
  return `<span class="inline-block px-2 py-0.5 rounded ${cls} text-[10px] font-bold uppercase" title="${esc(staleLinkMessage(p._linkCheck))}">${esc(label)}</span>`;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => typeof v === "string" ? v.trim() : "").filter(Boolean))];
}

function listText(value) {
  const list = asList(value);
  return list.length ? list.join(", ") : "—";
}

export function offerMappingPrimaryMessage(check) {
  const d = check?.diagnostic || {};
  const mismatched = asList(d.mismatchedLocalSkus);
  if (mismatched.length) return "Local variant SKUs do not match eBay’s variant SKUs. Review/relink before saving.";
  const unavailable = asList(d.unavailableOfferSkus);
  if (unavailable.length) return `eBay could not find active child offers for: ${unavailable.join(", ")}. These variants may be ended, sold out, removed, or renamed.`;
  const missing = asList(d.missingOfferSkus);
  if (missing.length) return `eBay could not find active child offers for: ${missing.join(", ")}. These variants may be ended, sold out, removed, or renamed.`;
  if (d.reasonCode === "ACTIVE_ZERO_QUANTITY") return "Sold out on eBay — quantity is 0.";
  if (d.reasonCode === "STALE_LOCAL_GROUP_KEY") return "Saved local eBay group key is stale or missing on eBay.";
  if (d.reasonCode === "EBAY_API_FAILURE") return "eBay verification failed due to an upstream API error.";
  const activeListingIds = asList(d.activeListingIds);
  if (d.inventoryItemGroupKey && !activeListingIds.length) return "No active eBay group listing found. Clear stale link or relist later after your account restriction is resolved.";
  return check?.message || check?.error || "Offer mapping could not be verified.";
}

function offerMappingBadgeLabel(check) {
  const reasonCode = check?.diagnostic?.reasonCode || check?.reasonCode || "";
  if (reasonCode === "LOCAL_VARIANT_SKU_MISMATCH") return "Variant SKU mismatch";
  if (["OFFER_NOT_AVAILABLE", "GROUP_CHILD_OFFERS_MISSING"].includes(reasonCode)) return "Child offers missing";
  if (reasonCode === "NO_ACTIVE_EBAY_MATCH") return "No active eBay group";
  if (reasonCode === "ACTIVE_ZERO_QUANTITY") return "Sold out on eBay";
  if (reasonCode === "STALE_LOCAL_GROUP_KEY") return "Stale eBay group key";
  if (reasonCode === "EBAY_API_FAILURE") return "eBay verification failed";
  return "Variant mapping needs review";
}

function offerQuantitiesText(diagnostic) {
  const rows = Array.isArray(diagnostic?.offerQuantities) ? diagnostic.offerQuantities : [];
  const parts = rows
    .filter(row => row && typeof row === "object")
    .map(row => {
      const sku = typeof row.sku === "string" && row.sku.trim() ? row.sku.trim() : "unknown SKU";
      const offerQty = row.offerQuantity ?? "?";
      const inventoryQty = row.inventoryQuantity ?? "?";
      return `${sku}: offer ${offerQty}, inventory ${inventoryQty}`;
    });
  return parts.length ? parts.join(" · ") : "—";
}

export function offerMappingDiagnosticHtml(p, compact = false) {
  const check = p?._linkCheck;
  if (!check || !["offer_mapping_unresolved", "ebay_api_failure"].includes(check.state)) return "";
  const groupKey = p?.ebay_item_group_key || check.inventoryItemGroupKey || check.diagnostic?.inventoryItemGroupKey || "";
  if (!groupKey) return "";
  const d = check.diagnostic || null;
  const boxCls = compact
    ? "mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900"
    : "mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900";
  const btn = p?.code
    ? `<button type="button" data-action="diagnose-mapping" data-code="${esc(p.code)}" class="mt-1 inline-flex border border-amber-500 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800 hover:bg-amber-100">Diagnose Mapping</button>`
    : "";
  if (!d) {
    return `<div class="${boxCls}">
      <div class="font-bold">Mapping details not loaded yet.</div>
      <div class="mt-0.5 text-amber-800">Run a read-only diagnostic to compare local variant SKUs with the active eBay group.</div>
      ${btn}
    </div>`;
  }
  return `<details class="${boxCls}">
    <summary class="cursor-pointer font-bold">${esc(offerMappingPrimaryMessage(check))}</summary>
    <div class="mt-2 space-y-1 leading-snug">
      <div><span class="font-bold">Reason:</span> ${esc(String(d.reasonCode || check.reasonCode || "UNKNOWN"))}</div>
      <div><span class="font-bold">Local expected SKUs:</span> ${esc(listText(d.localExpectedSkus))}</div>
      <div><span class="font-bold">eBay group SKUs:</span> ${esc(listText(d.ebayGroupVariantSkus))}</div>
      <div><span class="font-bold">Found active offer SKUs:</span> ${esc(listText(d.foundOfferSkus))}</div>
      <div><span class="font-bold">Missing/unavailable SKUs:</span> ${esc(listText([...(asList(d.missingOfferSkus)), ...(asList(d.unavailableOfferSkus))]))}</div>
      <div><span class="font-bold">Offer quantities:</span> ${esc(offerQuantitiesText(d))}</div>
      <div><span class="font-bold">Active listing IDs:</span> ${esc(listText(d.activeListingIds))}</div>
      <div class="pt-1 border-t border-amber-200"><span class="font-bold">Safe recommendation:</span> ${esc(offerMappingPrimaryMessage(check))} No eBay listing will be created, ended, relisted, or changed by this diagnostic.</div>
    </div>
  </details>`;
}

export function staleLinkLabel(check) {
  if (!check) return "Checking eBay link…";
  if (check.state === "stale") return "Local eBay link may be stale";
  if (check.state === "ambiguous") return "Multiple active eBay matches found";
  if (check.state === "no_active_match") return "No active eBay match found";
  if (check.state === "offer_mapping_unresolved") return offerMappingBadgeLabel(check);
  if (check.state === "ebay_api_failure") return "eBay verification failed";
  if (check.state === "out_of_stock") return "Sold out on eBay";
  return "eBay link verified";
}

export function staleLinkMessage(check) {
  return check?.message || "Local eBay link may be stale. Active eBay listing may be different. Refresh/relink before editing.";
}

export function currentActiveListingId(check) {
  return check?.activeMatch?.listingId || null;
}

export function ebayCodeLinkHtml(p, compact = false) {
  const check = p._linkCheck;
  if (isOutOfStockLinkCheck(check)) {
    const activeId = currentActiveListingId(check) || p.ebay_listing_id;
    const link = activeId
      ? ` <a href="https://www.ebay.com/itm/${esc(activeId)}" target="_blank" class="text-orange-700 hover:underline">sold-out listing ↗</a>`
      : "";
    return `<span class="text-orange-700 font-bold" title="${esc(staleLinkMessage(check))}">⚠ ${compact ? "Sold out" : esc(p.code)}</span>${link}`;
  }
  if (isStaleLinkCheck(check)) {
    const activeId = currentActiveListingId(check);
    const relinkBtn = check.safeRelink
      ? ` <button data-action="relink" data-code="${esc(p.code)}" class="text-amber-700 hover:underline font-bold">Relink</button>`
      : "";
    const activeLink = activeId
      ? ` <a href="https://www.ebay.com/itm/${esc(activeId)}" target="_blank" class="text-amber-700 hover:underline">active match ↗</a>`
      : "";
    return `<span class="text-amber-700 font-bold" title="${esc(staleLinkMessage(check))}">⚠ ${compact ? "Stale" : esc(p.code)}</span>${activeLink}${relinkBtn}`;
  }
  if (p.ebay_listing_id) {
    return `<a href="https://www.ebay.com/itm/${esc(p.ebay_listing_id)}" target="_blank" class="text-blue-500 hover:underline">${esc(p.code)}</a>`;
  }
  return esc(p.code);
}
