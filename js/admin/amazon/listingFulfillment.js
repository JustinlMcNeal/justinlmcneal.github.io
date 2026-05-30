/** FBA vs FBM fulfillment and FBA inventory breakdown helpers (Phase 5F). */

/** @param {unknown} value */
function asInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

/** @param {Record<string, unknown>} row */
export function getFulfillmentMode(row) {
  return String(row.fulfillment_mode || (row.is_fba_managed ? "fba" : "fbm"));
}

/** @param {Record<string, unknown>} row */
export function isFbaListing(row) {
  return getFulfillmentMode(row) === "fba" || row.is_fba_managed === true;
}

/** @param {Record<string, unknown>} row */
export function getFulfillmentBadge(row) {
  const mode = getFulfillmentMode(row);
  if (mode === "fba") {
    return { label: "FBA", className: "bg-indigo-100 text-indigo-900" };
  }
  if (mode === "fbm") {
    return { label: "FBM", className: "bg-slate-100 text-slate-800" };
  }
  return { label: "Unknown", className: "bg-gray-100 text-gray-700" };
}

/** @param {Record<string, unknown>} row */
export function getFulfillmentChannelLabel(row) {
  const label = String(row.fulfillment_channel_label || "").trim();
  if (label) return label;
  const channel = String(row.fulfillment_channel || "").trim();
  return channel || "—";
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function fulfillmentColumnMarkup(row, escapeHtml) {
  const badge = getFulfillmentBadge(row);
  const channel = escapeHtml(getFulfillmentChannelLabel(row));
  return `
    <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${badge.className}">${escapeHtml(badge.label)}</span>
    <span class="text-[10px] text-gray-500 block mt-0.5">${channel}</span>
  `;
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function fbaQtyCellMarkup(row, escapeHtml, field, emptyLabel = "—") {
  if (!isFbaListing(row)) {
    return `<span class="text-gray-300">${emptyLabel}</span><span class="text-[10px] text-gray-300 block">n/a</span>`;
  }
  const qty = asInt(row[field]);
  if (qty === null) {
    return `<span class="text-gray-400">${emptyLabel}</span><span class="text-[10px] text-gray-400 block">—</span>`;
  }
  const tone = qty > 0 ? "font-bold text-gray-900" : "font-bold text-gray-400";
  return `<span class="${tone}">${escapeHtml(qty)}</span>`;
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function fbaReservedColumnMarkup(row, escapeHtml) {
  return fbaQtyCellMarkup(row, escapeHtml, "fba_reserved_quantity");
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function fbaInboundColumnMarkup(row, escapeHtml) {
  return fbaQtyCellMarkup(row, escapeHtml, "fba_inbound_quantity");
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function fbaInventoryColumnMarkup(row, escapeHtml) {
  const fulfillable = asInt(row.fba_fulfillable_quantity) ?? 0;
  const reserved = asInt(row.fba_reserved_quantity);
  const inbound = asInt(row.fba_inbound_quantity);
  const extras = [];
  if (reserved !== null && reserved > 0) extras.push(`${reserved} reserved`);
  if (inbound !== null && inbound > 0) extras.push(`${inbound} inbound`);
  const extraLine = extras.length > 0
    ? `<span class="text-[10px] text-indigo-700 block">${escapeHtml(extras.join(" · "))}</span>`
    : `<span class="text-[10px] text-gray-400 block">no reserved/inbound</span>`;

  return `
    <span class="font-bold">${escapeHtml(fulfillable)}</span>
    <span class="text-[10px] text-gray-500 block">FBA fulfillable</span>
    ${extraLine}
  `;
}

/** @param {Record<string, unknown>} row @param {string} filterValue */
export function fulfillmentMatchesFilter(row, filterValue) {
  const filter = String(filterValue || "").trim();
  if (!filter) return true;

  const mode = getFulfillmentMode(row);
  if (filter === "fba") return mode === "fba";
  if (filter === "fbm") return mode === "fbm";
  if (filter === "unknown") return mode === "unknown";
  if (filter === "has_reserved") return row.has_fba_reserved === true;
  if (filter === "has_inbound") return row.has_fba_inbound === true;
  return true;
}

/** @param {Record<string, unknown>} row */
export function getFulfillmentExportFields(row) {
  return {
    fulfillmentMode: getFulfillmentMode(row),
    fulfillmentChannel: row.fulfillment_channel ?? "",
    fulfillmentChannelLabel: getFulfillmentChannelLabel(row),
    fbmQuantity: row.fbm_quantity ?? "",
    fbaFulfillable: row.fba_fulfillable_quantity ?? "",
    fbaReserved: row.fba_reserved_quantity ?? "",
    fbaInbound: row.fba_inbound_quantity ?? "",
    hasFbaReserved: row.has_fba_reserved === true ? "true" : "",
    hasFbaInbound: row.has_fba_inbound === true ? "true" : "",
  };
}

/** @param {Record<string, unknown>} row */
export function fulfillmentSummaryLine(row) {
  if (!isFbaListing(row)) {
    const fbm = asInt(row.fbm_quantity);
    return fbm === null ? "" : ` · FBM qty ${fbm}`;
  }
  const fulfillable = asInt(row.fba_fulfillable_quantity) ?? 0;
  const reserved = asInt(row.fba_reserved_quantity) ?? 0;
  const inbound = asInt(row.fba_inbound_quantity) ?? 0;
  return ` · FBA ${fulfillable} fulfillable (${reserved} reserved, ${inbound} inbound)`;
}

/** @param {Array<Record<string, unknown>>} rows */
export function countFbaListings(rows) {
  return rows.filter((row) => isFbaListing(row)).length;
}
