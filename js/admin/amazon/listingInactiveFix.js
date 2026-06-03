import { qs } from "./dom.js";
import {
  fetchAmazonListingBasics,
  fetchAmazonListingOpenIssues,
  patchAmazonListing,
} from "./api.js";
import { isFbaListing } from "./listingFulfillment.js";
import { escapeHtml } from "./renderListings.js";
import { showAmazonNotification } from "./notifications.js";

/** @type {Record<string, unknown> | null} */
let activeRow = null;

/** @type {boolean} */
let submitting = false;

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return `$${num.toFixed(2)}`;
}

function setHydrate(key, value) {
  const el = document.querySelector(`[data-inactive-hydrate="${key}"]`);
  if (el) el.textContent = value;
}

function setHtml(id, html) {
  const el = qs(id);
  if (el) el.innerHTML = html;
}

/** @param {Record<string, unknown>} row */
function isFbaRow(row) {
  if (isFbaListing(row)) return true;
  const channel = String(row.fulfillment_channel || "").toUpperCase();
  if (channel.includes("AMAZON") || channel === "AFN") return true;
  const fba = Number(row.fba_fulfillable_quantity);
  const fbm = Number(row.fbm_quantity);
  return Number.isFinite(fba) && fba > 0 && (!Number.isFinite(fbm) || fbm <= 0);
}

/**
 * @param {Record<string, unknown>} row
 * @param {Array<Record<string, unknown>>} [openIssues]
 */
export function diagnoseInactiveListing(row, openIssues = []) {
  const problems = [];
  const suggestions = [];
  /** @type {{ price?: number, quantity?: number }} */
  const suggested = {};

  const price = Number(row.price);
  const hasPrice = Number.isFinite(price) && price > 0;
  const kkPrice = Number(row.kk_price);

  const fbmRaw = row.fbm_quantity;
  const hasQtyValue = fbmRaw !== null &&
    fbmRaw !== undefined &&
    fbmRaw !== "" &&
    Number.isFinite(Number(fbmRaw));
  const qty = hasQtyValue ? Number(fbmRaw) : null;
  const kkStock = Number(row.kk_stock);

  const status = String(row.listing_status || "unknown");
  if (status !== "inactive" && status !== "unknown") {
    problems.push(`Status is "${status.replace(/_/g, " ")}" — quick fix targets inactive listings.`);
  }

  if (row.listing_status_buyable !== true) {
    problems.push("Amazon marks this listing as not buyable.");
  }

  if (!hasPrice) {
    problems.push("Missing offer — no Amazon price on file (Seller Central: add offer details).");
    if (Number.isFinite(kkPrice) && kkPrice > 0) {
      suggested.price = kkPrice;
      suggestions.push(`Use KK price (${formatPrice(kkPrice)}).`);
    } else {
      suggestions.push("Enter a price below (map to KK product for suggested price).");
    }
  } else if (row.listing_status_buyable !== true &&
    Number.isFinite(kkPrice) && kkPrice > 0 &&
    Math.abs(price - kkPrice) > 0.001) {
    suggested.price = kkPrice;
    suggestions.push(`Use KK price (${formatPrice(kkPrice)}) — synced Amazon price may be wrong.`);
  }

  if (!hasQtyValue) {
    problems.push("No Amazon quantity synced.");
    if (!isFbaRow(row) && Number.isFinite(kkStock) && kkStock > 0) {
      suggested.quantity = kkStock;
      suggestions.push(`Use KK stock (${kkStock} units).`);
    } else if (!isFbaRow(row)) {
      suggestions.push("Enter FBM quantity below.");
    }
  } else if (qty === 0 && !isFbaRow(row)) {
    problems.push("Amazon quantity is 0.");
    if (Number.isFinite(kkStock) && kkStock > 0) {
      suggested.quantity = kkStock;
      suggestions.push(`Use KK stock (${kkStock} units).`);
    }
  }

  if (isFbaRow(row)) {
    suggestions.push("FBA listing — quantity must be managed in Seller Central.");
  }

  const issueCount = openIssues.length || Number(row.open_issue_count || 0);
  if (issueCount > 0) {
    problems.push(`${issueCount} open Amazon issue(s) may block reactivation.`);
    suggestions.push("Fixing price/qty may not be enough if attributes are missing.");
  }

  if (row.latest_issue_message) {
    problems.push(String(row.latest_issue_message));
  }

  for (const issue of openIssues.slice(0, 5)) {
    const msg = String(issue.message || "").trim();
    if (msg && !problems.includes(msg)) problems.push(msg);
  }

  const canQuickFix = (suggested.price !== undefined || suggested.quantity !== undefined) &&
    !isFbaRow(row);

  if (!canQuickFix && (issueCount > 0 || !hasPrice)) {
    suggestions.push("May be a duplicate/legacy ASIN — consider Ignore or ending in Seller Central.");
  }

  return { problems, suggestions, suggested, canQuickFix };
}

function renderIssueList(issues) {
  const panel = qs("#amazonInactiveFixIssues");
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
    return `<li class="${tone} text-xs"><span class="font-bold uppercase text-[10px]">${escapeHtml(severity)}</span> — ${escapeHtml(String(issue.message || "Issue"))}</li>`;
  }).join("");
  panel.innerHTML = `<p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500 mb-2">Open Amazon issues</p><ul class="space-y-1">${items}</ul>`;
}

function renderDiagnosis(diagnosis) {
  const problemsEl = qs("#amazonInactiveFixProblems");
  const suggestionsEl = qs("#amazonInactiveFixSuggestions");
  if (problemsEl) {
    if (!diagnosis.problems.length) {
      problemsEl.innerHTML = '<p class="text-xs text-gray-500">No obvious blockers detected — try restoring price/qty anyway.</p>';
    } else {
      problemsEl.innerHTML = `<ul class="space-y-1 text-xs">${diagnosis.problems.map((item) =>
        `<li class="text-amber-800">• ${escapeHtml(item)}</li>`,
      ).join("")}</ul>`;
    }
  }
  if (suggestionsEl) {
    if (!diagnosis.suggestions.length) {
      suggestionsEl.innerHTML = "";
    } else {
      suggestionsEl.innerHTML = `<ul class="space-y-1 text-xs text-gray-600">${diagnosis.suggestions.map((item) =>
        `<li>→ ${escapeHtml(item)}</li>`,
      ).join("")}</ul>`;
    }
  }
}

function readPayload() {
  const priceField = qs("#amazonInactiveFixPrice");
  const qtyField = qs("#amazonInactiveFixQuantity");
  /** @type {{ amazonListingId: string, price?: number, quantity?: number }} */
  const payload = {
    amazonListingId: String(activeRow?.amazon_listing_id || activeRow?.id || ""),
  };

  if (priceField instanceof HTMLInputElement && priceField.value.trim()) {
    payload.price = Number(priceField.value);
  }
  if (qtyField instanceof HTMLInputElement && qtyField.value.trim()) {
    payload.quantity = Number(qtyField.value);
  }
  return payload;
}

/** @returns {string | null} */
function validatePayload(payload) {
  if (!payload.amazonListingId) return "Listing unavailable.";
  if (payload.price === undefined && payload.quantity === undefined) {
    return "Enter a price and/or quantity to apply.";
  }
  if (payload.price !== undefined && (!Number.isFinite(payload.price) || payload.price <= 0)) {
    return "Enter a valid price.";
  }
  if (payload.quantity !== undefined &&
    (!Number.isInteger(payload.quantity) || payload.quantity < 0)) {
    return "Enter a whole number quantity.";
  }
  if (activeRow && isFbaRow(activeRow) && payload.quantity !== undefined) {
    return "FBA quantity must be changed in Seller Central.";
  }
  return null;
}

function setSubmitting(active) {
  submitting = active;
  for (const selector of [
    '[data-action="preview-inactive-fix"]',
    '[data-action="apply-inactive-fix"]',
  ]) {
    const btn = qs(selector);
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.disabled = active;
    btn.setAttribute("aria-disabled", active ? "true" : "false");
  }
}

function renderPatchIssues(issues) {
  const panel = qs("#amazonInactiveFixPatchResult");
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
    return `<li class="${tone} text-xs">${escapeHtml(String(issue.message || "Issue"))}</li>`;
  }).join("");
  panel.innerHTML = `<ul class="space-y-1">${items}</ul>`;
}

/** @param {Record<string, unknown>} err */
function patchErrorMessage(err) {
  const code = err?.code || err?.error || "request_failed";
  const messages = {
    live_patch_disabled: "Live listing updates are disabled on the server.",
    listing_not_found: "Listing not found.",
    listing_not_patchable: "This listing cannot be patched yet (missing product type).",
    fba_quantity_not_supported: "FBA quantity must be changed in Seller Central.",
    patch_rejected: "Amazon rejected this update.",
    sp_api_patch_failed: "Amazon patch request failed.",
    unauthorized: "Please sign in as an admin.",
  };
  return messages[code] || "Could not update Amazon listing.";
}

/**
 * @param {Record<string, unknown>} row
 * @param {Array<Record<string, unknown>>} openIssues
 */
function hydrateForm(row, openIssues) {
  const diagnosis = diagnoseInactiveListing(row, openIssues);
  const title = String(row.kk_product_title || row.amazon_title || "Amazon listing");
  const imageUrl = row.image_url || row.main_image_url ? String(row.image_url || row.main_image_url) : "";

  setHydrate("inactive-title", title);
  setHydrate("inactive-asin", String(row.asin || "—"));
  setHydrate("inactive-sku", String(row.seller_sku || row.kk_sku || "—"));
  setHydrate("inactive-status", String(row.listing_status || "unknown").replace(/_/g, " "));
  setHydrate("inactive-price", formatPrice(row.price));
  setHydrate("inactive-qty", row.fbm_quantity === null || row.fbm_quantity === undefined
    ? "—"
    : String(row.fbm_quantity));
  setHydrate("inactive-kk-price", formatPrice(row.kk_price));
  setHydrate("inactive-kk-stock", row.kk_stock === null || row.kk_stock === undefined
    ? "—"
    : String(row.kk_stock));

  const thumbEl = qs("#amazonInactiveFixThumb");
  if (thumbEl) {
    thumbEl.innerHTML = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" class="w-14 h-14 rounded-lg object-cover border border-gray-200" loading="lazy" />`
      : `<div class="w-14 h-14 rounded-lg bg-kkpeach/60 border border-gray-200" aria-hidden="true"></div>`;
  }

  const priceField = qs("#amazonInactiveFixPrice");
  const qtyField = qs("#amazonInactiveFixQuantity");
  const qtySection = qs("#amazonInactiveFixQtySection");

  if (priceField instanceof HTMLInputElement) {
    priceField.value = diagnosis.suggested.price !== undefined
      ? String(diagnosis.suggested.price)
      : (Number.isFinite(Number(row.price)) && Number(row.price) > 0 ? String(row.price) : "");
  }
  if (qtyField instanceof HTMLInputElement) {
    qtyField.value = diagnosis.suggested.quantity !== undefined
      ? String(diagnosis.suggested.quantity)
      : (row.fbm_quantity !== null && row.fbm_quantity !== undefined ? String(row.fbm_quantity) : "");
  }
  if (qtySection) {
    qtySection.classList.toggle("hidden", isFbaRow(row));
  }

  renderDiagnosis(diagnosis);
  renderIssueList(openIssues);
  renderPatchIssues([]);

  const noteEl = qs("#amazonInactiveFixNote");
  if (noteEl) {
    const missingOffer = !Number.isFinite(Number(row.price)) || Number(row.price) <= 0;
    const needsOfferPut = row.listing_status_buyable !== true && String(row.asin || "").trim();
    noteEl.textContent = needsOfferPut
      ? "Missing live offer — Apply Fix submits a full Amazon offer (price + qty), not a simple patch. Avoid syncing for ~30 minutes after apply."
      : missingOffer
        ? "Missing offer — restoring price/qty on Amazon. Avoid syncing for ~30 minutes after apply."
        : diagnosis.canQuickFix
          ? "Suggested values are pre-filled from KK where available. Preview, then apply."
          : "Enter price/qty manually or map to a KK product for suggestions. Some inactive listings need Seller Central.";
  }
}

/** @param {HTMLElement} card */
export function readUnmappedCardRow(card) {
  return {
    amazon_listing_id: card.dataset.amazonListingId || "",
    asin: card.dataset.asin || "",
    seller_sku: card.dataset.sellerSku || "",
    amazon_title: card.dataset.title || "",
    listing_status: card.dataset.status || "unknown",
    marketplace_id: card.dataset.marketplaceId || card.dataset.marketplace || "",
    price: card.dataset.priceRaw || card.dataset.price || "",
    fbm_quantity: card.dataset.inventoryRaw ?? card.dataset.inventory ?? "",
    main_image_url: card.dataset.imageUrl || "",
    kk_price: card.dataset.kkPrice || "",
    kk_stock: card.dataset.kkStock || "",
    listing_status_buyable: card.dataset.buyable === "true",
  };
}

async function enrichRow(row) {
  const listingId = String(row.amazon_listing_id || row.id || "");
  if (!listingId) return row;

  const [basics, openIssues] = await Promise.all([
    fetchAmazonListingBasics(listingId),
    fetchAmazonListingOpenIssues(listingId),
  ]);

  return {
    ...row,
    ...(basics || {}),
    amazon_listing_id: listingId,
    open_issues: openIssues,
    open_issue_count: openIssues.length,
    latest_issue_message: openIssues[0]?.message || row.latest_issue_message || null,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
export async function hydrateAmazonInactiveFixModal(row) {
  activeRow = row;
  const openIssues = Array.isArray(row.open_issues)
    ? row.open_issues
    : await fetchAmazonListingOpenIssues(String(row.amazon_listing_id || row.id || ""));

  if (!row.fulfillment_channel && !row.is_fba_managed) {
    const basics = await fetchAmazonListingBasics(String(row.amazon_listing_id || row.id || ""));
    if (basics) activeRow = { ...row, ...basics };
  }

  hydrateForm(activeRow || row, openIssues);
}

async function previewFix() {
  if (!activeRow || submitting) return;
  const payload = readPayload();
  const validationError = validatePayload(payload);
  if (validationError) {
    showAmazonNotification(validationError, { tone: "warning" });
    return;
  }

  setSubmitting(true);
  try {
    const result = await patchAmazonListing({ ...payload, preview: true });
    renderPatchIssues(result.issues || []);
    showAmazonNotification(
      "Preview passed — nothing saved yet. Click Apply Fix to publish.",
      { tone: "success" },
    );
  } catch (err) {
    renderPatchIssues(err?.issues || []);
    showAmazonNotification(patchErrorMessage(err), { tone: "error" });
  } finally {
    setSubmitting(false);
  }
}

async function applyFix() {
  if (!activeRow || submitting) return;
  const payload = readPayload();
  const validationError = validatePayload(payload);
  if (validationError) {
    showAmazonNotification(validationError, { tone: "warning" });
    return;
  }

  if (!window.confirm("Apply this fix to the live Amazon listing?")) return;

  setSubmitting(true);
  try {
    const result = await patchAmazonListing({ ...payload, preview: false });
    renderPatchIssues(result.issues || []);
    const status = String(result.submissionStatus || "ACCEPTED");
    showAmazonNotification(
      `Fix submitted (${status}). Seller Central may take a few minutes to update.`,
      { tone: "success" },
    );
    await deps.onFixed?.();
    deps.closeModal?.();
  } catch (err) {
    renderPatchIssues(err?.issues || []);
    showAmazonNotification(patchErrorMessage(err), { tone: "error" });
  } finally {
    setSubmitting(false);
  }
}

/** @type {{ onFixed?: () => Promise<void> | void, closeModal?: () => void, getAuthState?: () => Record<string, unknown> | null }} */
let deps = {};

/**
 * @param {{ onFixed?: () => Promise<void> | void, closeModal?: () => void, getAuthState?: () => Record<string, unknown> | null }} options
 */
export function initAmazonListingInactiveFix(options = {}) {
  deps = options;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const fixBtn = target.closest('[data-action="fix-inactive-listing"]');
    if (fixBtn instanceof HTMLElement) {
      event.preventDefault();
      const auth = deps.getAuthState?.();
      if (!auth?.connected || auth?.tokenStatus !== "active") {
        showAmazonNotification("Connect Amazon before fixing listings.", { tone: "warning" });
        return;
      }

      const card = fixBtn.closest(".amazon-unmapped-card");
      if (card instanceof HTMLElement) {
        enrichRow(readUnmappedCardRow(card))
          .then((row) => deps.openModal?.(row))
          .catch(() => showAmazonNotification("Could not load listing details.", { tone: "error" }));
        return;
      }
    }

    if (target.closest('[data-action="preview-inactive-fix"]')) {
      event.preventDefault();
      previewFix().catch(() => {});
      return;
    }

    if (target.closest('[data-action="apply-inactive-fix"]')) {
      event.preventDefault();
      applyFix().catch(() => {});
    }
  });

  return { hydrateAmazonInactiveFixModal, enrichRow, readUnmappedCardRow, attachOpener };
}

/** @param {(row: Record<string, unknown>) => void | Promise<void>} openFn */
function attachOpener(openFn) {
  deps.openModal = openFn;
}
