import { qs } from "./dom.js";
import {
  fetchAmazonListingRaw,
  fetchKkProductForPush,
  patchAmazonListing,
} from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import {
  AMAZON_MAX_IMAGES,
  buildAmazonProductImageUrls,
  extractAmazonListingImageUrls,
  filterAmazonPatchableImageUrls,
  hideAmazonGalleryPicker,
  initAmazonImageUrls,
  isAmazonHostedImageUrl,
  renderAmazonImageStrip,
  showAmazonGalleryPicker,
} from "./pushImages.js";

const STRIP_ID = "amazonListingImageStrip";
const PICKER_ID = "amazonListingImagePicker";
const COUNT_ID = "amazonListingImageCount";

/** @type {Record<string, unknown> | null} */
let activeRow = null;

/** @type {Record<string, unknown> | null} */
let patchProductRow = null;

/** @type {string[]} */
let patchImageUrls = [];

/** @type {boolean} */
let submitting = false;

const IMAGE_PATCH_ORDER_KEY_PREFIX = "kk.amazonImagePatch.";

/** @param {string} listingId @param {string[]} urls */
function saveImagePatchOrder(listingId, urls) {
  const id = String(listingId || "").trim();
  if (!id || !urls.length) return;
  try {
    sessionStorage.setItem(`${IMAGE_PATCH_ORDER_KEY_PREFIX}${id}`, JSON.stringify(urls));
  } catch {
    // ignore quota / private mode
  }
}

/** @param {string} listingId @returns {string[] | null} */
function readSavedImagePatchOrder(listingId) {
  const id = String(listingId || "").trim();
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(`${IMAGE_PATCH_ORDER_KEY_PREFIX}${id}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? filterAmazonPatchableImageUrls(parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * Prefer last submitted order until Amazon attributes catch up, then Amazon order, then KK defaults.
 * @param {{
 *   product: Record<string, unknown> | null,
 *   listingRaw: Record<string, unknown> | null | undefined,
 *   marketplaceId: string,
 *   listingId: string,
 * }} params
 */
function resolvePatchImageSeedUrls({ product, listingRaw, marketplaceId, listingId }) {
  const kkUrls = buildAmazonProductImageUrls(product);
  const amazonUrls = filterAmazonPatchableImageUrls(
    extractAmazonListingImageUrls(listingRaw?.raw_listing, marketplaceId),
  );
  const savedLocal = readSavedImagePatchOrder(listingId);

  if (savedLocal?.length) {
    const amazonMain = amazonUrls[0] || "";
    const savedMain = savedLocal[0] || "";
    if (!amazonUrls.length || amazonMain !== savedMain) {
      return initAmazonImageUrls(product, savedLocal);
    }
    saveImagePatchOrder(listingId, amazonUrls);
  }

  if (amazonUrls.length) {
    return initAmazonImageUrls(product, amazonUrls);
  }

  if (savedLocal?.length) {
    return initAmazonImageUrls(product, savedLocal);
  }

  return initAmazonImageUrls(product, kkUrls);
}

function setHydrate(key, value) {
  const el = document.querySelector(`[data-hydrate="${key}"]`);
  if (el) el.textContent = value;
}

function syncImageUi() {
  renderAmazonImageStrip(STRIP_ID, patchImageUrls);
  const countEl = qs(`#${COUNT_ID}`);
  if (countEl) {
    countEl.textContent = `${patchImageUrls.length} / ${AMAZON_MAX_IMAGES}`;
  }
}

function renderIssues(issues) {
  const panel = qs("#amazonListingImageIssues");
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
  for (const selector of [
    '[data-action="preview-amazon-image-patch"]',
    '[data-action="apply-amazon-image-patch"]',
  ]) {
    const btn = qs(selector);
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.disabled = active;
    btn.setAttribute("aria-disabled", active ? "true" : "false");
  }
}

/**
 * @param {Record<string, unknown>} row
 */
export async function hydrateAmazonImagePatchModal(row) {
  activeRow = row;
  patchProductRow = null;
  patchImageUrls = [];
  hideAmazonGalleryPicker(PICKER_ID);
  renderIssues([]);

  const title = String(row.kk_product_title || row.amazon_title || "Amazon listing");
  setHydrate("image-patch-listing-title", title);
  setHydrate("image-patch-asin", String(row.asin || "—"));
  setHydrate("image-patch-seller-sku", String(row.seller_sku || row.kk_sku || "—"));

  const listingId = String(row.amazon_listing_id || "");
  const kkProductId = String(row.kk_product_id || "");
  const marketplaceId = String(row.marketplace_id || "ATVPDKIKX0DER");

  const [product, listingRaw] = await Promise.all([
    kkProductId ? fetchKkProductForPush(kkProductId) : Promise.resolve(null),
    listingId ? fetchAmazonListingRaw(listingId) : Promise.resolve(null),
  ]);

  patchProductRow = product;
  const amazonUrls = extractAmazonListingImageUrls(
    listingRaw?.raw_listing,
    marketplaceId,
  );
  patchImageUrls = resolvePatchImageSeedUrls({
    product,
    listingRaw,
    marketplaceId,
    listingId,
  });
  syncImageUi();

  const issuesPanel = qs("#amazonListingImageIssues");
  const patchableAmazonCount = filterAmazonPatchableImageUrls(amazonUrls).length;
  if (issuesPanel && amazonUrls.length > patchableAmazonCount && buildAmazonProductImageUrls(product).length) {
    issuesPanel.classList.remove("hidden");
    issuesPanel.innerHTML = `<p class="text-xs text-amber-800">Showing your KK gallery order. Amazon-hosted photos in the live listing cannot be re-submitted — reorder using gallery images below.</p>`;
  }
}

function readPayload() {
  return {
    amazonListingId: String(activeRow?.amazon_listing_id || activeRow?.id || ""),
    imageUrls: filterAmazonPatchableImageUrls(patchImageUrls),
  };
}

/** @returns {string | null} */
function validatePayload(payload) {
  if (!payload.amazonListingId) return "Listing unavailable.";
  if (!payload.imageUrls.length) {
    const hadAmazonOnly = patchImageUrls.some(isAmazonHostedImageUrl);
    if (hadAmazonOnly) {
      return "Amazon-hosted images cannot be re-submitted. Add photos from the KK gallery.";
    }
    return "Select at least one KK-hosted image URL (https://…).";
  }
  return null;
}

async function previewPatch() {
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
    renderIssues(result.issues || []);
    showAmazonNotification(
      "Image preview passed — nothing was saved. Click Apply Update to publish to Amazon.",
      { tone: "success" },
    );
  } catch (err) {
    renderIssues(err?.issues || []);
    showAmazonNotification(patchErrorMessage(err), { tone: "error" });
  } finally {
    setSubmitting(false);
  }
}

async function applyPatch() {
  if (!activeRow || submitting) return;
  const payload = readPayload();
  const validationError = validatePayload(payload);
  if (validationError) {
    showAmazonNotification(validationError, { tone: "warning" });
    return;
  }

  if (!window.confirm("Apply these images to the live Amazon listing?")) {
    return;
  }

  setSubmitting(true);
  try {
    const result = await patchAmazonListing({ ...payload, preview: false });
    renderIssues(result.issues || []);
    const status = String(result.submissionStatus || "ACCEPTED");
    showAmazonNotification(
      `Images submitted (${status}). Amazon may take 15 minutes to several hours to refresh the gallery.`,
      { tone: "success" },
    );
    saveImagePatchOrder(String(activeRow?.amazon_listing_id || activeRow?.id || ""), patchImageUrls);
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
    invalid_image_urls: "Use KK-hosted https image URLs from the gallery (Amazon CDN links cannot be patched).",
    invalid_request: "Invalid image update request.",
    patch_rejected: "Amazon rejected this image update.",
    sp_api_patch_failed: "Amazon patch request failed.",
    sp_api_validation_failed: "Amazon rejected these image URLs. Use KK gallery photos with public https links.",
    amazon_not_connected: "Amazon is not connected.",
    unauthorized: "Please sign in as an admin.",
  };
  const base = messages[code] || "Could not update Amazon listing images.";
  return err?.hint ? `${base} ${err.hint}` : base;
}

/** @type {{ onPatched?: () => Promise<void> | void, closeModal?: () => void }} */
let deps = {};

/**
 * @param {{ onPatched?: () => Promise<void> | void, closeModal?: () => void }} options
 */
export function initAmazonListingImagePatch(options = {}) {
  deps = options;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-action="amazon-listing-add-image"]')) {
      event.preventDefault();
      if (!patchProductRow) {
        showAmazonNotification("KK product images unavailable for this listing.", { tone: "warning" });
        return;
      }
      showAmazonGalleryPicker(STRIP_ID, PICKER_ID, patchImageUrls, patchProductRow);
      return;
    }

    if (target.closest('[data-action="preview-amazon-image-patch"]')) {
      event.preventDefault();
      previewPatch().catch(() => {});
      return;
    }

    if (target.closest('[data-action="apply-amazon-image-patch"]')) {
      event.preventDefault();
      applyPatch().catch(() => {});
    }
  });

  return { hydrateAmazonImagePatchModal };
}
