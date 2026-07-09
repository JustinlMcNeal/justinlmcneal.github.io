import { qs } from "./dom.js";
import {
  fetchAmazonListingOpenIssues,
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
 * @param {Record<string, unknown> | null | undefined} product
 * @param {string} [kkVariantId]
 */
function buildListingPatchDefaultImageUrls(product, kkVariantId = "") {
  const defaults = buildAmazonProductImageUrls(product);
  const variantId = String(kkVariantId || "").trim();
  if (!variantId || !Array.isArray(product?.product_variants)) return defaults;

  const variant = product.product_variants.find((row) => String(row?.id || "") === variantId);
  const preview = String(variant?.preview_image_url || "").trim();
  if (!preview.startsWith("http")) return defaults;

  const rest = defaults.filter((url) => url !== preview);
  return [preview, ...rest].slice(0, AMAZON_MAX_IMAGES);
}

/**
 * Prefer last submitted order until Amazon attributes catch up, then Amazon order, then KK defaults.
 * @param {{
 *   product: Record<string, unknown> | null,
 *   listingRaw: Record<string, unknown> | null | undefined,
 *   marketplaceId: string,
 *   listingId: string,
 *   kkVariantId?: string,
 * }} params
 */
function resolvePatchImageSeedUrls({ product, listingRaw, marketplaceId, listingId, kkVariantId = "" }) {
  const kkUrls = buildListingPatchDefaultImageUrls(product, kkVariantId);
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
    const patchable = filterAmazonPatchableImageUrls(patchImageUrls);
    const amazonOnly = patchImageUrls.length - patchable.length;
    let text = `${patchImageUrls.length} / ${AMAZON_MAX_IMAGES}`;
    if (amazonOnly > 0) {
      text += ` · ${patchable.length} will be sent`;
      if (!patchable.length) {
        text += " — add KK photos from gallery";
      }
    }
    countEl.textContent = text;
  }
}

function renderIssues(issues, err = null) {
  const panel = qs("#amazonListingImageIssues");
  if (!panel) return;

  /** @type {Array<Record<string, unknown>>} */
  const rows = Array.isArray(issues) ? [...issues] : [];
  if (!rows.length && err) {
    const message = patchErrorMessage(err);
    if (message) rows.push({ severity: "error", message });
  }

  if (!rows.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  const items = rows.map((issue) => {
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

  const listingId = String(row.amazon_listing_id || row.id || "");
  const kkProductId = String(row.kk_product_id || "");
  const marketplaceId = String(row.marketplace_id || "ATVPDKIKX0DER");

  const [product, listingRaw, openIssues] = await Promise.all([
    kkProductId ? fetchKkProductForPush(kkProductId) : Promise.resolve(null),
    listingId ? fetchAmazonListingRaw(listingId) : Promise.resolve(null),
    listingId ? fetchAmazonListingOpenIssues(listingId) : Promise.resolve([]),
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
    kkVariantId: String(row.kk_variant_id || ""),
  });
  syncImageUi();

  const issuesPanel = qs("#amazonListingImageIssues");
  const patchableAmazonCount = filterAmazonPatchableImageUrls(amazonUrls).length;
  const patchableSelectedCount = filterAmazonPatchableImageUrls(patchImageUrls).length;
  const amazonIssueLines = (openIssues || [])
    .filter((issue) => String(issue?.severity || "").toLowerCase() === "error")
    .map((issue) => String(issue?.message || "").trim())
    .filter(Boolean);
  const imageIssueLines = amazonIssueLines.filter((message) =>
    /image|background|media_locator|white/i.test(message),
  );
  const notes = [];

  if (patchableSelectedCount === 0 && buildAmazonProductImageUrls(product).length) {
    notes.push("Add at least one photo from the KK gallery. Amazon CDN images in the live listing cannot be re-submitted through SP-API.");
  } else if (amazonUrls.length > patchableAmazonCount && buildAmazonProductImageUrls(product).length) {
    notes.push("Live listing photos are Amazon-hosted. Pick KK gallery images below — the first slot becomes the main image Amazon evaluates.");
  }

  if (imageIssueLines.length) {
    notes.push("Amazon image errors on this SKU:");
    notes.push(...imageIssueLines.slice(0, 2));
    notes.push("Amazon main images for hats and apparel usually need a pure white background (RGB 255,255,255). Lifestyle or colored backgrounds often stay in issue status even after a successful upload.");
  } else if (amazonIssueLines.length) {
    notes.push("Amazon also reports other open errors on this SKU (for example price). Fix those in Edit Listing if image updates keep failing.");
    notes.push(amazonIssueLines[0]);
  }

  if (issuesPanel && notes.length) {
    issuesPanel.classList.remove("hidden");
    issuesPanel.innerHTML = `<ul class="space-y-1 text-xs text-amber-800 list-disc pl-4">${notes.map((line) => `<li>${line}</li>`).join("")}</ul>`;
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
    console.error("[amazon] image patch preview failed", {
      code: err?.code || err?.error,
      hint: err?.hint,
      issues: err?.issues,
      message: err?.message,
    });
    renderIssues(err?.issues || [], err);
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
    console.error("[amazon] image patch apply failed", {
      code: err?.code || err?.error,
      hint: err?.hint,
      issues: err?.issues,
      message: err?.message,
    });
    renderIssues(err?.issues || [], err);
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
    listing_not_patchable: "This listing cannot be patched yet (missing product type). Sync this SKU from Amazon and try again.",
    invalid_image_urls: "No KK-hosted photos to send. Amazon CDN images cannot be re-submitted — click + Add from Gallery.",
    invalid_request: "Invalid image update request.",
    patch_rejected: "Amazon rejected this image update.",
    sp_api_patch_failed: "Amazon rejected this image update.",
    sp_api_validation_failed: "Amazon rejected these image URLs.",
    amazon_not_connected: "Amazon is not connected.",
    token_missing: "Amazon token missing. Reconnect Seller Central.",
    token_refresh_failed: "Amazon token expired. Reconnect Seller Central.",
    unauthorized: "Please sign in as an admin.",
  };
  const issueMessages = Array.isArray(err?.issues)
    ? err.issues
      .map((issue) => String(issue?.message || "").trim())
      .filter(Boolean)
    : [];
  if (issueMessages.length) {
    return issueMessages.slice(0, 2).join(" ");
  }
  const base = messages[code] || "Could not update Amazon listing images.";
  const hint = typeof err?.hint === "string" && err.hint.trim() ? err.hint.trim() : "";
  if (hint && !messages[code]) return hint;
  return hint ? `${base} ${hint}` : base;
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
