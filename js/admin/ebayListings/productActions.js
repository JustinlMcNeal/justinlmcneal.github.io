import { esc } from "./utils.js";
import { staleActionState } from "./linkCheck.js";

export function renderProductActions(p, compact = false) {
  const status = p.ebay_status || "not_listed";
  const staleState = staleActionState(p);
  const size = compact ? "flex-1 px-2 py-1.5 text-xs" : "px-2 py-1 text-[10px]";
  const black = `bg-black text-white ${size} rounded font-bold hover:bg-kkpink hover:text-black transition-all`;
  const blue = `bg-blue-600 text-white ${size} rounded font-bold hover:bg-blue-700 transition-all`;
  const red = `border border-red-300 text-red-600 ${size} rounded font-bold hover:bg-red-50 transition-all`;
  const amber = `border border-amber-300 text-amber-700 ${size} rounded font-bold hover:bg-amber-50 transition-all`;
  const green = `bg-green-600 text-white ${size} rounded font-bold hover:bg-green-700 transition-all`;

  if (staleState === "out_of_stock") {
    return `<button data-action="edit" data-code="${esc(p.code)}" class="${green}">Restock</button>
            <button data-action="clear-stale" data-code="${esc(p.code)}" class="${amber}">Mark Ended</button>`;
  }

  if (staleState) {
    const clear = `<button data-action="clear-stale" data-code="${esc(p.code)}" class="${amber}">Mark Ended</button>`;
    if (staleState === "stale" && p._linkCheck?.safeRelink) {
      return `<button data-action="relink" data-code="${esc(p.code)}" class="${green}">Relink</button>${clear}`;
    }
    return clear;
  }

  if (status === "not_listed") {
    return `<button data-action="push" data-code="${esc(p.code)}" class="${black}">Push</button>`;
  }
  if (status === "active") {
    return `<button data-action="edit" data-code="${esc(p.code)}" class="${blue}">Edit</button>
            <button data-action="withdraw" data-code="${esc(p.code)}" data-offer-id="${esc(p.ebay_offer_id)}" data-group-key="${esc(p.ebay_item_group_key)}" class="${red}">End</button>`;
  }
  if (status === "draft") {
    return `<button data-action="edit" data-code="${esc(p.code)}" class="${blue}">Edit</button>
            ${p.ebay_offer_id
              ? `<button data-action="publish" data-code="${esc(p.code)}" data-offer-id="${esc(p.ebay_offer_id)}" data-group-key="${esc(p.ebay_item_group_key)}" class="${green}">Publish</button>`
              : `<button data-action="push" data-code="${esc(p.code)}" class="${black}">Resume Push</button>`}
            <button data-action="discard-draft" data-code="${esc(p.code)}" data-offer-id="${esc(p.ebay_offer_id)}" data-group-key="${esc(p.ebay_item_group_key)}" class="${amber}">Discard</button>`;
  }
  if (status === "ended") {
    return `<button data-action="push" data-code="${esc(p.code)}" class="${black}">Re-list</button>`;
  }
  return "";
}
