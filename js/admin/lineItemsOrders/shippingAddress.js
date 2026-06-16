// /js/admin/lineItemsOrders/shippingAddress.js
// Client helpers for order shipping address edit + validation UI.

/** @param {{ first_name?: string|null, last_name?: string|null }} order */
export function customerDisplayName(order = {}) {
  return `${order.first_name || ""} ${order.last_name || ""}`.trim();
}

/** Strip emojis/symbols for thermal label readability (ASCII-ish). */
export function toPrintableName(raw) {
  return String(raw ?? "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} raw */
export function splitPrintableFirstLast(raw) {
  const n = toPrintableName(raw);
  if (!n) return { first_name: null, last_name: null };
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

/** @param {{ first_name?: string|null, last_name?: string|null }} order @returns {string[]} */
export function shippingNameWarnings(order = {}) {
  const full = customerDisplayName(order);
  if (!full) return [];
  const warnings = [];
  if (full !== toPrintableName(full)) {
    warnings.push(
      "Name contains emojis or special characters that may not print correctly on shipping labels.",
    );
  }
  if (full && !toPrintableName(full)) {
    warnings.push("Name has no printable characters for a label — edit before printing.");
  }
  return warnings;
}

/** @returns {string[]} */
export function localAddressIssues(order = {}) {
  const issues = [];
  const street = String(order.street_address ?? "").trim();
  const city = String(order.city ?? "").trim();
  const state = String(order.state ?? "").trim();
  const zip = String(order.zip ?? "").trim();
  const country = (String(order.country ?? "US").trim() || "US").toUpperCase();

  if (!street) issues.push("Street address is required.");
  else {
    if (street.length < 5) issues.push("Street address looks too short.");
    if (!/[a-zA-Z]/.test(street)) {
      issues.push("Street address should include a street name, not only a number.");
    }
    if (/^\d+\s*$/.test(street)) {
      issues.push("Street address appears incomplete (number only).");
    }
  }

  if (!city) issues.push("City is required.");
  if (!state || state.length < 2) issues.push("State is required.");

  if (country === "US") {
    if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) {
      issues.push("ZIP code must be 5 digits (or ZIP+4).");
    }
  } else if (!zip) {
    issues.push("Postal code is required.");
  }

  return issues;
}

/** Resolve an element by id within document or a workspace container element. */
function queryInRoot(root, id) {
  if (!root) return null;
  if (typeof root.getElementById === "function") {
    return root.getElementById(id);
  }
  return root.querySelector?.(`#${id}`) ?? null;
}

export function readShippingFieldsFromDom(root = document) {
  const q = (id) => queryInRoot(root, id);
  return {
    first_name: q("addrFirstName")?.value?.trim() || null,
    last_name: q("addrLastName")?.value?.trim() || null,
    street_address: q("addrStreet")?.value?.trim() || null,
    city: q("addrCity")?.value?.trim() || null,
    state: q("addrState")?.value?.trim() || null,
    zip: q("addrZip")?.value?.trim() || null,
    country: (q("addrCountry")?.value?.trim() || "US").toUpperCase(),
  };
}

export function populateShippingFields(order, root = document) {
  const set = (id, val) => {
    const el = queryInRoot(root, id);
    if (el) el.value = val ?? "";
  };
  set("addrFirstName", order.first_name);
  set("addrLastName", order.last_name);
  set("addrStreet", order.street_address);
  set("addrCity", order.city);
  set("addrState", order.state);
  set("addrZip", order.zip);
  set("addrCountry", order.country || "US");
}

export function renderAddressStatusHtml({
  issues = [],
  isValid = null,
  messages = [],
  suggested = null,
  pending = false,
} = {}) {
  if (pending) {
    return `<div class="border-4 border-black/20 bg-gray-50 p-3 text-sm text-black/70">
      Save any edits, then click <strong>Validate Address</strong> before buying a label.
    </div>`;
  }

  if (isValid === true) {
    return `<div class="border-4 border-emerald-400 bg-emerald-50 p-3 text-sm text-emerald-800">
      <span class="font-black uppercase text-xs tracking-wider">✓ Validated</span>
      <p class="mt-1">Address passed Shippo validation. You can buy a label.</p>
    </div>`;
  }

  const lines = [
    ...issues,
    ...(messages || []).map((m) => m.text).filter(Boolean),
  ].filter(Boolean);

  if (!lines.length) return "";

  const suggestedHtml = suggested?.street_address
    ? `<p class="mt-2 text-xs">Shippo suggested: <strong>${escapeHtml(
        [suggested.street_address, suggested.city, suggested.state, suggested.zip]
          .filter(Boolean)
          .join(", "),
      )}</strong>
      <button type="button" data-apply-suggested-address class="ml-2 underline font-black">Apply suggested</button></p>`
    : "";

  const border = isValid === false ? "border-red-400 bg-red-50 text-red-800" : "border-amber-400 bg-amber-50 text-amber-900";
  const title = isValid === false ? "✕ Address issue" : "⚠ Review address";

  return `<div class="border-4 ${border} p-3 text-sm">
    <span class="font-black uppercase text-xs tracking-wider">${title}</span>
    <ul class="mt-2 list-disc pl-5 space-y-1">${lines.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
    ${suggestedHtml}
  </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
