import { qs } from "./dom.js";
import { amazonAiAutofill, fetchAmazonListingRaw, fetchKkProductForPush, patchAmazonListing } from "./api.js";
import {
  extractAttributeOfferPrice,
  extractLiveOfferPrice,
  listingDisplayPrice,
  listingPendingAttributePrice,
} from "./listingOfferPrice.js";
import { buildAmazonProductImageUrls, extractAmazonListingCopyFields } from "./pushImages.js";
import { showAmazonNotification } from "./notifications.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {Record<string, unknown> | null} */
let activeRow = null;

/** @type {"edit" | "inventory"} */
let activeMode = "edit";

/** @type {boolean} */
let submitting = false;

/** @type {{ title: string, description: string, bullets: string[] }} */
let loadedCopy = { title: "", description: "", bullets: [] };

/** @type {Record<string, unknown> | null} */
let patchProductRow = null;

/** @type {boolean} */
let patchAiBusy = false;

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `$${num.toFixed(2)}`;
}

function rowInventory(row) {
  const fbm = Number(row.fbm_quantity);
  if (Number.isFinite(fbm) && fbm >= 0) return fbm;
  const amazonQty = Number(row.amazon_fulfillable_qty);
  if (Number.isFinite(amazonQty) && amazonQty >= 0) return amazonQty;
  const fba = Number(row.fba_fulfillable_quantity);
  if (Number.isFinite(fba) && fba >= 0) return fba;
  return null;
}

function rowKkStock(row) {
  const kkStock = Number(row.kk_stock);
  return Number.isFinite(kkStock) && kkStock >= 0 ? kkStock : null;
}

function setHydrate(key, value) {
  const el = document.querySelector(`[data-hydrate="${key}"]`);
  if (el) el.textContent = value;
}

function setInputValue(id, value) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = value ?? "";
  }
}

function readFieldValue(id) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim();
  }
  return "";
}

function readBulletLines() {
  const raw = readFieldValue("#amazonPatchBulletPoints");
  return raw
    ? raw.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
}

function bulletsKey(lines) {
  return lines.join("\n");
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

function setPatchAiBusy(active) {
  patchAiBusy = active;
  for (const btn of document.querySelectorAll('[data-action="amazon-patch-ai"]')) {
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.disabled = active || activeMode === "inventory";
    btn.setAttribute("aria-disabled", btn.disabled ? "true" : "false");
    btn.classList.toggle("opacity-50", btn.disabled);
    btn.classList.toggle("cursor-not-allowed", btn.disabled);
  }
}

/**
 * @param {string} message
 * @param {"info" | "success" | "warning" | "error"} [tone]
 */
function setPatchAiStatus(message, tone = "info") {
  const el = qs("#amazonPatchAiStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("hidden", "text-red-500", "text-green-600", "text-amber-600", "text-gray-500");
  if (tone === "error") el.classList.add("text-red-500");
  else if (tone === "success") el.classList.add("text-green-600");
  else if (tone === "warning") el.classList.add("text-amber-600");
  else el.classList.add("text-gray-500");
  if (!message) el.classList.add("hidden");
}

/**
 * @param {Record<string, unknown> | null | undefined} product
 * @param {Record<string, unknown> | null | undefined} row
 */
function resolvePatchAiImageUrls(product, row) {
  /** @type {string[]} */
  let urls = buildAmazonProductImageUrls(product).filter((url) => url.startsWith("https://"));

  const variantId = row?.kk_variant_id && UUID_RE.test(String(row.kk_variant_id))
    ? String(row.kk_variant_id)
    : "";
  if (variantId && product && Array.isArray(product.product_variants)) {
    const variant = product.product_variants.find((entry) => String(entry?.id || "") === variantId);
    const preview = String(variant?.preview_image_url || "").trim();
    if (preview.startsWith("https://")) {
      urls = [preview, ...urls.filter((url) => url !== preview)];
    }
  }

  return urls.slice(0, 4);
}

/**
 * @param {"title" | "description" | "bullets" | "all"} field
 */
async function handlePatchListingAi(field) {
  if (!activeRow || patchAiBusy || activeMode !== "edit") return;

  const row = activeRow;
  const productName = String(
    row.kk_product_title || row.amazon_title || readFieldValue("#amazonPatchAmazonTitle") || "",
  ).trim();
  if (!productName) {
    showAmazonNotification("No product title available for AI copy.", { tone: "warning" });
    return;
  }

  const fieldLabels = {
    title: "title",
    description: "description",
    bullets: "bullet points",
    all: "listing copy",
  };

  setPatchAiBusy(true);
  setPatchAiStatus(`Generating ${fieldLabels[field] || "copy"}…`);

  try {
    const price = listingDisplayPrice(row);
    const result = await amazonAiAutofill({
      productName,
      productCode: String(row.kk_sku || row.seller_sku || ""),
      productType: String(row.product_type || patchProductRow?.product_type || ""),
      price: Number.isFinite(Number(price)) ? Number(price) : undefined,
      imageUrls: resolvePatchAiImageUrls(patchProductRow, row),
      requiredAttributes: [],
      recommendedAttributes: [],
      attributeHints: [],
    });

    const ai = result.data || {};
    let applied = 0;

    if ((field === "title" || field === "all") && ai.title?.value) {
      setInputValue("#amazonPatchAmazonTitle", ai.title.value);
      applied += 1;
    }
    if ((field === "description" || field === "all") && ai.description?.value) {
      setInputValue("#amazonPatchDescription", ai.description.value);
      applied += 1;
    }
    if ((field === "bullets" || field === "all") && Array.isArray(ai.bulletPoints) && ai.bulletPoints.length) {
      setInputValue(
        "#amazonPatchBulletPoints",
        ai.bulletPoints.map((entry) => entry.value).filter(Boolean).join("\n"),
      );
      applied += 1;
    }

    if (!applied) {
      setPatchAiStatus("AI did not return usable copy for that field.", "warning");
      showAmazonNotification("AI did not return usable copy.", { tone: "warning" });
      return;
    }

    const notes = Array.isArray(ai.notes) ? ai.notes.filter(Boolean) : [];
    if (notes.length) {
      setPatchAiStatus(`Filled ${fieldLabels[field] || "copy"}. Review: ${notes.join(" · ")}`, "warning");
    } else {
      setPatchAiStatus(`${fieldLabels[field] || "Copy"} generated — review before applying to Amazon.`, "success");
    }
    showAmazonNotification("AI copy ready — review fields, then Preview or Apply Update.", { tone: "success" });
  } catch (err) {
    const messages = {
      openai_request_failed: "OpenAI request failed.",
      openai_empty_response: "AI returned an empty response.",
      openai_invalid_json: "AI returned invalid JSON.",
      openai_no_usable_content: "AI did not return usable listing content.",
      server_misconfigured: "OPENAI_API_KEY is not configured on the server.",
      unauthorized: "Please sign in as an admin.",
    };
    const message = messages[err?.code] || "AI copy generation failed.";
    setPatchAiStatus(message, "error");
    showAmazonNotification(message, { tone: "error" });
  } finally {
    setPatchAiBusy(false);
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {"edit" | "inventory"} mode
 */
export async function hydrateAmazonPatchModal(row, mode = "edit") {
  activeRow = row;
  activeMode = mode;
  patchProductRow = null;
  setPatchAiStatus("");

  const kkProductId = String(row.kk_product_id || "").trim();
  if (kkProductId) {
    fetchKkProductForPush(kkProductId)
      .then((product) => {
        if (activeRow === row) patchProductRow = product;
      })
      .catch(() => {});
  }

  const title = String(row.kk_product_title || row.amazon_title || "Amazon listing");
  setHydrate("patch-listing-title", title);
  setHydrate("patch-asin", String(row.asin || "—"));
  setHydrate("patch-seller-sku", String(row.seller_sku || row.kk_sku || "—"));

  const listingId = String(row.amazon_listing_id || row.id || "");
  const marketplaceId = String(row.marketplace_id || "ATVPDKIKX0DER");
  let livePrice = listingDisplayPrice(row);
  let pendingAttributePrice = listingPendingAttributePrice(row);

  loadedCopy = { title: "", description: "", bullets: [] };

  if (listingId) {
    const listingRaw = await fetchAmazonListingRaw(listingId);
    if (listingRaw?.raw_listing) {
      livePrice = extractLiveOfferPrice(listingRaw.raw_listing, marketplaceId) ?? livePrice;
      pendingAttributePrice = extractAttributeOfferPrice(listingRaw.raw_listing, marketplaceId);
      if (
        pendingAttributePrice !== null
        && livePrice !== null
        && Math.abs(pendingAttributePrice - livePrice) < 0.01
      ) {
        pendingAttributePrice = null;
      }

      const copy = extractAmazonListingCopyFields(listingRaw.raw_listing, marketplaceId);
      loadedCopy = {
        title: copy.title || String(row.amazon_title || ""),
        description: copy.description || "",
        bullets: copy.bulletPoints || [],
      };
    }
  }

  setHydrate("patch-current-price", formatPrice(livePrice));
  const amazonQty = rowInventory(row);
  const kkStock = rowKkStock(row);
  setHydrate(
    "patch-current-qty",
    amazonQty === null ? "—" : String(amazonQty),
  );
  setHydrate(
    "patch-kk-stock",
    kkStock === null ? "—" : String(kkStock),
  );

  const priceField = qs("#amazonPatchPrice");
  const qtyField = qs("#amazonPatchQuantity");
  const priceSection = qs("#amazonPatchPriceSection");
  const copySection = qs("#amazonPatchCopySection");

  if (priceField instanceof HTMLInputElement) {
    priceField.value = livePrice === null || livePrice === undefined ? "" : String(livePrice);
  }
  if (qtyField instanceof HTMLInputElement) {
    qtyField.value = amazonQty === null ? "" : String(amazonQty);
  }

  if (priceSection) {
    priceSection.classList.toggle("hidden", mode === "inventory");
  }
  if (copySection) {
    copySection.classList.toggle("hidden", mode === "inventory");
  }

  if (mode !== "inventory") {
    setInputValue("#amazonPatchAmazonTitle", loadedCopy.title);
    setInputValue("#amazonPatchDescription", loadedCopy.description);
    setInputValue("#amazonPatchBulletPoints", loadedCopy.bullets.join("\n"));
  } else {
    setInputValue("#amazonPatchAmazonTitle", "");
    setInputValue("#amazonPatchDescription", "");
    setInputValue("#amazonPatchBulletPoints", "");
  }

  const modalTitle = qs("#amazonPatchModalTitle");
  if (modalTitle) {
    modalTitle.textContent = mode === "inventory"
      ? "Update Amazon Inventory"
      : "Edit Amazon Listing";
  }

  renderIssues([]);
  renderPriceHint(pendingAttributePrice, livePrice);
  setPatchAiBusy(false);
}

function renderPriceHint(pendingAttributePrice, livePrice) {
  const panel = qs("#amazonPatchPriceHint");
  if (!panel) return;

  if (
    pendingAttributePrice === null
    || pendingAttributePrice === undefined
    || !Number.isFinite(Number(pendingAttributePrice))
  ) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  panel.innerHTML = `<p class="text-xs text-amber-800">Live Amazon offer: ${formatPrice(livePrice)}. Listing attributes still show ${formatPrice(pendingAttributePrice)} until Amazon finishes processing a price update.</p>`;
}

function readPatchPayload() {
  const priceField = qs("#amazonPatchPrice");
  const qtyField = qs("#amazonPatchQuantity");
  /** @type {{ amazonListingId: string, price?: number, quantity?: number, title?: string, description?: string, bulletPoints?: string[] }} */
  const payload = {
    amazonListingId: String(activeRow?.amazon_listing_id || ""),
  };

  if (activeMode === "edit" && priceField instanceof HTMLInputElement && priceField.value.trim()) {
    payload.price = Number(priceField.value);
  }
  if (qtyField instanceof HTMLInputElement && qtyField.value.trim()) {
    payload.quantity = Number(qtyField.value);
  }

  if (activeMode === "edit") {
    const title = readFieldValue("#amazonPatchAmazonTitle");
    if (title && title !== loadedCopy.title) {
      payload.title = title;
    }

    const description = readFieldValue("#amazonPatchDescription");
    if (description !== loadedCopy.description) {
      payload.description = description;
    }

    const bullets = readBulletLines();
    if (bulletsKey(bullets) !== bulletsKey(loadedCopy.bullets)) {
      payload.bulletPoints = bullets;
    }
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

  const hasTitle = payload.title !== undefined;
  const hasDescription = payload.description !== undefined;
  const hasBullets = payload.bulletPoints !== undefined;

  if (!hasPrice && !hasQty && !hasTitle && !hasDescription && !hasBullets) {
    return "Change price, quantity, title, description, or bullet points to update.";
  }
  if (hasPrice && (!Number.isFinite(payload.price) || payload.price <= 0)) {
    return "Enter a valid price.";
  }
  if (hasQty && (!Number.isInteger(payload.quantity) || payload.quantity < 0)) {
    return "Enter a whole number quantity.";
  }
  if (hasTitle && !String(payload.title || "").trim()) {
    return "Amazon title cannot be empty.";
  }
  if (hasBullets && (!Array.isArray(payload.bulletPoints) || !payload.bulletPoints.length)) {
    return "Add at least one bullet point, or leave bullets unchanged.";
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
    showAmazonNotification(
      "Preview passed — nothing was saved. Click Apply Update to publish to Amazon.",
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
    const status = String(result.submissionStatus || "ACCEPTED");
    const qtyNote = payload.quantity !== undefined
      ? ` Amazon inventory set to ${payload.quantity} in admin; Seller Central may take a few minutes to match.`
      : "";
    const copyNote = payload.title || payload.description || payload.bulletPoints
      ? " Listing copy may take a few minutes to appear on Amazon."
      : "";
    showAmazonNotification(
      `Update submitted (${status}).${qtyNote}${payload.price !== undefined ? " Live Amazon price may take a few minutes to match." : ""}${copyNote}`,
      { tone: "success" },
    );
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
    invalid_request: "Change at least one field before updating.",
    invalid_title: "Amazon title cannot be empty.",
    invalid_bullet_points: "Add at least one bullet point.",
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
      return;
    }

    const aiBtn = target.closest('[data-action="amazon-patch-ai"]');
    if (aiBtn instanceof HTMLElement) {
      event.preventDefault();
      const field = aiBtn.dataset.aiField;
      if (field === "title" || field === "description" || field === "bullets" || field === "all") {
        handlePatchListingAi(field).catch(() => {});
      }
    }
  });

  return { hydrateAmazonPatchModal };
}
