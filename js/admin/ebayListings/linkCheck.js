import { esc } from "./utils.js";

export function isLinkedOnEbay(p) {
  const status = p?.ebay_status || "not_listed";
  return status === "active" && (p.ebay_sku || p.ebay_offer_id || p.ebay_listing_id || p.ebay_item_group_key);
}

export function isStaleLinkCheck(check) {
  return Boolean(check?.success && ["stale", "ambiguous", "no_active_match"].includes(check.state));
}

export function isOutOfStockLinkCheck(check) {
  return Boolean(check?.success && check.state === "out_of_stock");
}

export function isLinkWarningCheck(check) {
  return isStaleLinkCheck(check) || isOutOfStockLinkCheck(check);
}

export function staleActionState(p) {
  const state = p?._linkCheck?.state;
  return ["stale", "ambiguous", "no_active_match", "out_of_stock"].includes(state) ? state : "";
}

export function staleActionBadge(p) {
  const state = staleActionState(p);
  if (!state) return "";
  const label = state === "no_active_match" ? "No active eBay listing found" : staleLinkLabel(p._linkCheck);
  const cls = state === "out_of_stock" ? "bg-orange-100 text-orange-800" : "bg-amber-100 text-amber-800";
  return `<span class="inline-block px-2 py-0.5 rounded ${cls} text-[10px] font-bold uppercase" title="${esc(staleLinkMessage(p._linkCheck))}">${esc(label)}</span>`;
}

export function staleLinkLabel(check) {
  if (!check) return "Checking eBay link…";
  if (check.state === "stale") return "Local eBay link may be stale";
  if (check.state === "ambiguous") return "Multiple active eBay matches found";
  if (check.state === "no_active_match") return "No active eBay match found";
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
