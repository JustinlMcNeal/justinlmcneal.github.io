import { esc } from "./utils.js";
import { staleActionState } from "./linkCheck.js";

export function renderProductActions(p, compact = false) {
  const status = p.ebay_status || "not_listed";
  const staleState = staleActionState(p);
  // Compact = card grid; table rows stay quieter for scanability (Amazon-like density)
  const size = compact
    ? "flex-1 px-2 py-2 text-[10px] min-h-[40px]"
    : "px-2 py-1 text-[10px]";
  const base = `${size} font-bold uppercase tracking-[.08em] transition-colors`;
  const primary = compact
    ? `border-4 border-black bg-black text-white ${base} hover:bg-gray-900`
    : `border border-black bg-black text-white ${base} hover:bg-gray-900 rounded-sm`;
  const secondary = compact
    ? `border-4 border-black bg-white text-black ${base} hover:bg-gray-50`
    : `border border-gray-300 bg-white text-gray-800 ${base} hover:bg-gray-50 hover:border-black rounded-sm`;
  const danger = compact
    ? `border-4 border-red-600 text-red-600 bg-white ${base} hover:bg-red-600 hover:text-white`
    : `border border-red-300 text-red-600 bg-white ${base} hover:bg-red-50 rounded-sm`;
  const warn = compact
    ? `border-4 border-amber-600 text-amber-800 bg-white ${base} hover:bg-amber-50`
    : `border border-amber-300 text-amber-800 bg-white ${base} hover:bg-amber-50 rounded-sm`;

  if (staleState === "out_of_stock") {
    return `<button data-action="edit" data-code="${esc(p.code)}" class="${primary}">Restock</button>
            <button data-action="clear-stale" data-code="${esc(p.code)}" class="${warn}">Mark Ended</button>`;
  }

  if (staleState) {
    const clear = `<button data-action="clear-stale" data-code="${esc(p.code)}" class="${warn}">Mark Ended</button>`;
    if (staleState === "stale" && p._linkCheck?.safeRelink) {
      return `<button data-action="relink" data-code="${esc(p.code)}" class="${primary}">Relink</button>${clear}`;
    }
    return clear;
  }

  if (status === "not_listed") {
    return `<button data-action="push" data-code="${esc(p.code)}" class="${primary}">Push</button>`;
  }
  if (status === "active") {
    return `<button data-action="edit" data-code="${esc(p.code)}" class="${secondary}">Edit</button>
            <button data-action="withdraw" data-code="${esc(p.code)}" data-offer-id="${esc(p.ebay_offer_id)}" data-group-key="${esc(p.ebay_item_group_key)}" class="${danger}">End</button>`;
  }
  if (status === "draft") {
    return `<button data-action="edit" data-code="${esc(p.code)}" class="${secondary}">Edit</button>
            ${p.ebay_offer_id
              ? `<button data-action="publish" data-code="${esc(p.code)}" data-offer-id="${esc(p.ebay_offer_id)}" data-group-key="${esc(p.ebay_item_group_key)}" class="${primary}">Publish</button>`
              : `<button data-action="push" data-code="${esc(p.code)}" class="${primary}">Resume Push</button>`}
            <button data-action="discard-draft" data-code="${esc(p.code)}" data-offer-id="${esc(p.ebay_offer_id)}" data-group-key="${esc(p.ebay_item_group_key)}" class="${warn}">Discard</button>`;
  }
  if (status === "ended") {
    return `<button data-action="push" data-code="${esc(p.code)}" class="${primary}">Re-list</button>`;
  }
  return "";
}
