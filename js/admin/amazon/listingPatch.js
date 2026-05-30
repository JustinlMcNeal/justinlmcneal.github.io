import { qs } from "./dom.js";
import { patchAmazonListing } from "./api.js";
import { showAmazonNotification } from "./notifications.js";

/** @type {Record<string, unknown> | null} */
let activeRow = null;

/** @type {"edit" | "inventory"} */
let activeMode = "edit";

/** @type {boolean} */
let submitting = false;

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `$${num.toFixed(2)}`;
}

function rowInventory(row) {
  const kkStock = Number(row.kk_stock);
  if (Number.isFinite(kkStock) && kkStock >= 0) return kkStock;
  const fbm = Number(row.fbm_quantity);
  if (Number.isFinite(fbm)) return fbm;
  const fba = Number(row.fba_fulfillable_quantity);
  if (Number.isFinite(fba)) return fba;
  return null;
}

function setHydrate(key, value) {
  const el = document.querySelector(`[data-hydrate="${key}"]`);
  if (el) el.textContent = value;
}

function renderIssues(issues) {
  const panel = qs("#amazonPatchIssues");
  if (!panel) return;

  if (!issues?.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  const items = issues.map((issue) => {
    const severity = String(issue.severity || "warning");
    const tone = severity === "error" ? "text-red-700" : "text-amber-700";
    return `<li class="${tone}"><span class="font-bold uppercase text-[10px]">${severity}</span> — ${String(issue.message || issue.field || "Issue")}</li>`;
  }).join("");

  panel.innerHTML = `<ul class="space-y-1 text-xs">${items}</ul>`;
}

function setSubmitting(active) {
  submitting = active;
  for (const selector of ['[data-action="preview-amazon-patch"]', '[data-action="apply-amazon-patch"]']) {
    const btn = qs(selector);
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.disabled = active;
    btn.setAttribute("aria-disabled", active ? "true" : "false");
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {"edit" | "inventory"} mode
 */
export function hydrateAmazonPatchModal(row, mode = "edit") {
  activeRow = row;
  activeMode = mode;

  const title = String(row.kk_product_title || row.amazon_title || "Amazon listing");
  setHydrate("patch-listing-title", title);
  setHydrate("patch-asin", String(row.asin || "—"));
  setHydrate("patch-seller-sku", String(row.seller_sku || row.kk_sku || "—"));
  setHydrate("patch-current-price", formatPrice(row.price));
  const qty = rowInventory(row);
  setHydrate("patch-current-qty", qty === null ? "—" : String(qty));

  const priceField = qs("#amazonPatchPrice");
  const qtyField = qs("#amazonPatchQuantity");
  const priceSection = qs("#amazonPatchPriceSection");

  if (priceField instanceof HTMLInputElement) {
    priceField.value = row.price === null || row.price === undefined ? "" : String(row.price);
  }
  if (qtyField instanceof HTMLInputElement) {
    qtyField.value = qty === null ? "" : String(qty);
  }

  if (priceSection) {
    priceSection.classList.toggle("hidden", mode === "inventory");
  }

  const modalTitle = qs("#amazonPatchModalTitle");
  if (modalTitle) {
    modalTitle.textContent = mode === "inventory"
      ? "Update Amazon Inventory"
      : "Edit Amazon Listing";
  }

  renderIssues([]);
}

function readPatchPayload() {
  const priceField = qs("#amazonPatchPrice");
  const qtyField = qs("#amazonPatchQuantity");
  /** @type {{ amazonListingId: string, price?: number, quantity?: number }} */
  const payload = {
    amazonListingId: String(activeRow?.amazon_listing_id || ""),
  };

  if (activeMode === "edit" && priceField instanceof HTMLInputElement && priceField.value.trim()) {
    payload.price = Number(priceField.value);
  }
  if (qtyField instanceof HTMLInputElement && qtyField.value.trim()) {
    payload.quantity = Number(qtyField.value);
  }

  return payload;
}

/** @returns {string | null} */
function validatePatchPayload(payload) {
  if (!payload.amazonListingId) return "Listing unavailable.";

  const hasPrice = payload.price !== undefined;
  const hasQty = payload.quantity !== undefined;

  if (activeMode === "inventory") {
    if (!hasQty) return "Enter a quantity to update.";
    if (!Number.isInteger(payload.quantity) || payload.quantity < 0) {
      return "Enter a whole number quantity.";
    }
    return null;
  }

  if (!hasPrice && !hasQty) return "Enter a price and/or quantity to update.";
  if (hasPrice && (!Number.isFinite(payload.price) || payload.price <= 0)) {
    return "Enter a valid price.";
  }
  if (hasQty && (!Number.isInteger(payload.quantity) || payload.quantity < 0)) {
    return "Enter a whole number quantity.";
  }
  return null;
}

async function previewPatch() {
  if (!activeRow || submitting) return;
  const payload = readPatchPayload();
  const validationError = validatePatchPayload(payload);
  if (validationError) {
    showAmazonNotification(validationError, { tone: "warning" });
    return;
  }

  setSubmitting(true);
  try {
    const result = await patchAmazonListing({ ...payload, preview: true });
    renderIssues(result.issues || []);
    showAmazonNotification("Amazon validation preview complete.", { tone: "success" });
  } catch (err) {
    renderIssues(err?.issues || []);
    showAmazonNotification(patchErrorMessage(err), { tone: "error" });
  } finally {
    setSubmitting(false);
  }
}

async function applyPatch() {
  if (!activeRow || submitting) return;
  const payload = readPatchPayload();
  const validationError = validatePatchPayload(payload);
  if (validationError) {
    showAmazonNotification(validationError, { tone: "warning" });
    return;
  }

  if (!window.confirm("Apply this update to the live Amazon listing?")) {
    return;
  }

  setSubmitting(true);
  try {
    const result = await patchAmazonListing({ ...payload, preview: false });
    renderIssues(result.issues || []);
    showAmazonNotification("Amazon listing updated.", { tone: "success" });
    await deps.onPatched?.();
    deps.closeModal?.();
  } catch (err) {
    renderIssues(err?.issues || []);
    showAmazonNotification(patchErrorMessage(err), { tone: "error" });
  } finally {
    setSubmitting(false);
  }
}

/** @param {Record<string, unknown>} err */
function patchErrorMessage(err) {
  const code = err?.code || err?.error || "request_failed";
  const messages = {
    live_patch_disabled: "Live listing updates are disabled on the server.",
    listing_not_found: "Listing not found.",
    listing_not_patchable: "This listing cannot be patched yet (missing product type).",
    fba_quantity_not_supported: "FBA quantity must be changed in Seller Central.",
    invalid_price: "Enter a valid price.",
    invalid_quantity: "Enter a whole number quantity.",
    invalid_request: "Enter a price and/or quantity to update.",
    patch_rejected: "Amazon rejected this update.",
    sp_api_patch_failed: "Amazon patch request failed.",
    sp_api_validation_failed: "Amazon validation failed.",
    amazon_not_connected: "Amazon is not connected.",
    unauthorized: "Please sign in as an admin.",
  };
  return messages[code] || "Could not update Amazon listing.";
}

/** @type {{ onPatched?: () => Promise<void> | void, closeModal?: () => void }} */
let deps = {};

/**
 * @param {{ onPatched?: () => Promise<void> | void, closeModal?: () => void }} options
 */
export function initAmazonListingPatch(options = {}) {
  deps = options;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-action="preview-amazon-patch"]')) {
      event.preventDefault();
      previewPatch().catch(() => {});
      return;
    }

    if (target.closest('[data-action="apply-amazon-patch"]')) {
      event.preventDefault();
      applyPatch().catch(() => {});
    }
  });

  return { hydrateAmazonPatchModal };
}
