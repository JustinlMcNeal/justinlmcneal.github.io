import { qs } from "./dom.js";
import { saveAmazonDraft, searchKkProducts, fetchAmazonDraftById, fetchAmazonListingRaw, fetchKkProductForPush, amazonAiAutofill, fetchAmazonCatalogHintForProduct, fetchAmazonVariationFamilyContext } from "./api.js";
import { closeAmazonModals } from "./modals.js";
import { showAmazonNotification } from "./notifications.js";
import { escapeHtml } from "./renderListings.js";
import {
  initPushDraftPtd,
  hydratePtdFromDraft,
  resetPtdPanels,
  getLoadedRequiredAttributes,
  prepareForAiAutofill,
  getLoadedAttributeEnums,
  getLoadedAttributeNames,
} from "./pushDraftPtd.js";
import {
  applyExtraAttributeDefaults,
  applyAiAttributesToForm,
  buildAttributeHintsForAi,
  getExtendedAttributeHints,
  mergeAttributeNameLists,
  filterAttributesForVariationRole,
  readExtraAttributesFromForm,
  filterFormAttributeNames,
  ARTIFICIAL_PLANT_FORM_DENYLIST,
  HAT_FORM_DENYLIST,
  APPAREL_PIN_FORM_DENYLIST,
  APPAREL_BELT_FORM_DENYLIST,
  HANDBAG_FORM_DENYLIST,
  TOTE_BAG_FORM_EXTRA_DENYLIST,
  stripInvalidPushPayloadAttributes,
} from "./pushDraftAttributes.js";
import { resolvePushWorkflowFromSuggestedAsin, shouldHydrateSuggestedAsin } from "./pushDraftWorkflow.js";
import { initPushDraftLive, deriveSubmitMetaFromDraftRow, setDraftSubmitMeta, setPtdPreviewMeta, updateLiveSubmitReadiness } from "./pushDraftLive.js";
import { initPushDraftVerify, updateVerifyReadiness } from "./pushDraftVerify.js";
import { getRecommendationMeta } from "./pushDraftPtd.js";
import {
  hidePushCompliancePanel,
  updatePushComplianceWarnings,
} from "./pushDraftCompliance.js";
import {
  AMAZON_PUSH_MAX_IMAGES,
  hideAmazonPushGalleryPicker,
  initAmazonPushImages,
  renderAmazonPushImageStrip,
  showAmazonPushGalleryPicker,
  extractAmazonListingImageUrls,
  extractAmazonListingCopyFields,
  filterAmazonPatchableImageUrls,
} from "./pushImages.js";
import {
  getSelectedAmazonVariant,
  initAmazonVariantPanel,
  resetAmazonVariantPanel,
  wireAmazonVariantPanel,
} from "./variantPanel.js";
import { applyParentDraftInheritance } from "./parentDraftInherit.js";
import {
  applyVariationAttributes,
  canAddChildToFamily,
  defaultParentSellerSku,
  hydrateVariationFamilyFromDraft,
  initAmazonVariationFamilyPanel,
  readParentDraftId,
  readParentSellerSku,
  readVariationRole,
  readVariationTheme,
  resetAmazonVariationFamilyPanel,
  updateVariationRoleUi,
  VARIATION_ROLES,
  variantColorValue,
  wireAmazonVariationFamilyPanel,
} from "./variationFamily.js";
import {
  advancePushQueue,
  clearPushQueue,
  getPushQueueLength,
  readyRowAsTrigger,
} from "./readyToPushQueue.js";
import {
  clampAmazonItemName,
  draftSaveValidationMessage,
  validateAmazonDraftSavePayload,
} from "./pushDraftSaveValidation.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {boolean} */
let saving = false;

/** @type {string[]} */
let pushImageUrls = [];

/** @type {Record<string, unknown> | null} */
let pushProductRow = null;

/** @type {boolean} */
let pushLinkToFamilySession = false;

/** @type {Record<string, unknown> | null} */
let pushFamilyContext = null;

function syncPushImageUi() {
  renderAmazonPushImageStrip(pushImageUrls);
  const countEl = qs("#amazonPushImageCount");
  if (countEl) {
    countEl.textContent = `${pushImageUrls.length} / ${AMAZON_PUSH_MAX_IMAGES}`;
  }
}

function applyVariantToPushForm(variant, productCode, options = {}) {
  if (!variant) return;
  setInput("#amazonPushKkVariantId", variant.id ? String(variant.id) : "");
  if (!options.keepSellerSku) {
    const sellerSku = variant.sellerSku || variant.sku || productCode;
    if (sellerSku) setInput("#amazonPushSellerSku", String(sellerSku));
  }
  if (!options.keepQuantity) {
    const qty = Number(variant.quantity ?? variant.stock ?? 0);
    if (Number.isFinite(qty)) setInput("#amazonPushQuantity", String(Math.max(0, qty)));
  }

  if (options.keepImages) return;

  const preview = String(variant.preview_image_url || "").trim();
  if (preview.startsWith("http") && pushProductRow) {
    const base = initAmazonPushImages(pushProductRow, pushImageUrls);
    pushImageUrls = [preview, ...base.filter((url) => url !== preview)].slice(0, AMAZON_PUSH_MAX_IMAGES);
    syncPushImageUi();
  }
}

function readPreferredVariantId(trigger, listingRow = null) {
  if (listingRow?.kk_variant_id && UUID_RE.test(String(listingRow.kk_variant_id))) {
    return String(listingRow.kk_variant_id);
  }
  const card = trigger?.closest?.(".amazon-ready-card");
  const fromCard = card instanceof HTMLElement ? card.dataset.kkVariantId : "";
  const fromTrigger = trigger instanceof HTMLElement ? trigger.dataset.kkVariantId : "";
  const raw = String(fromCard || fromTrigger || "").trim();
  return UUID_RE.test(raw) ? raw : null;
}

/**
 * @param {Record<string, unknown>} listingRow
 * @param {Record<string, unknown> | null} product
 * @param {Record<string, unknown> | null | undefined} familyContext
 */
async function hydrateLinkToFamilyFromListing(listingRow, product, familyContext) {
  const marketplaceId = String(listingRow.marketplace_id || "ATVPDKIKX0DER");
  const sellerSku = String(listingRow.seller_sku || "").trim();
  const amazonTitle = String(listingRow.amazon_title || "").trim();
  const productType = String(listingRow.product_type || "").trim();
  const productCode = String(product?.code || listingRow.kk_sku || "");
  const variantId = listingRow.kk_variant_id ? String(listingRow.kk_variant_id) : "";

  setInput("#amazonPushKkProductId", String(listingRow.kk_product_id || product?.id || ""));
  setText(
    "#amazonPushProductTitle",
    String(listingRow.kk_product_title || product?.name || "—"),
  );
  setText("#amazonPushKkSku", productCode || "—");
  setInput("#amazonPushMarketplaceId", marketplaceId);
  if (sellerSku) setInput("#amazonPushSellerSku", sellerSku);
  if (amazonTitle) setInput("#amazonPushAmazonTitle", amazonTitle);
  if (productType) setInput("#amazonPushProductType", productType);

  const livePrice = listingRow.price;
  if (livePrice !== null && livePrice !== undefined && livePrice !== "") {
    setInput("#amazonPushPrice", String(livePrice));
  }
  const liveQty = listingRow.fbm_quantity ?? listingRow.amazon_fulfillable_qty;
  if (liveQty !== null && liveQty !== undefined && liveQty !== "") {
    setInput("#amazonPushQuantity", String(liveQty));
  }

  const listingId = String(listingRow.amazon_listing_id || "");
  if (listingId) {
    try {
      const listingRaw = await fetchAmazonListingRaw(listingId);
      if (listingRaw?.raw_listing) {
        const copy = extractAmazonListingCopyFields(listingRaw.raw_listing, marketplaceId);
        if (copy.title && !readInput("#amazonPushAmazonTitle")) {
          setInput("#amazonPushAmazonTitle", copy.title);
        }
        if (copy.brand) setInput("#amazonPushBrand", copy.brand);
        if (copy.description) setInput("#amazonPushDescription", copy.description);
        if (copy.bulletPoints.length) {
          setInput("#amazonPushBulletPoints", copy.bulletPoints.join("\n"));
        }

        const amazonImages = extractAmazonListingImageUrls(listingRaw.raw_listing, marketplaceId);
        const patchableImages = filterAmazonPatchableImageUrls(amazonImages);
        if (patchableImages.length) {
          pushImageUrls = patchableImages;
          syncPushImageUi();
        }
      }
    } catch {
      // Fall back to KK product images below.
    }
  }

  const parentDraftId = familyContext?.parentDraft?.id;
  if (parentDraftId) {
    try {
      const parentDraft = await fetchAmazonDraftById(String(parentDraftId));
      const parentPayload = parentDraft?.draft_payload;
      if (parentPayload && typeof parentPayload === "object") {
        if (!readInput("#amazonPushBrand") && parentPayload.brand) {
          setInput("#amazonPushBrand", String(parentPayload.brand));
        }
        if (!readInput("#amazonPushProductType") && parentPayload.productType) {
          setInput("#amazonPushProductType", String(parentPayload.productType));
        }
      }
    } catch {
      // Parent draft is optional context only.
    }
  }

  if (product && variantId) {
    const variant = initAmazonVariantPanel(
      product.product_variants || [],
      productCode,
      variantId,
    );
    applyVariantToPushForm(variant, productCode, {
      keepSellerSku: true,
      keepQuantity: liveQty !== null && liveQty !== undefined && liveQty !== "",
      keepImages: pushImageUrls.length > 0,
    });
  }

  if (!pushImageUrls.length && product) {
    applyPushImages(product, []);
  }

  updateVariationRoleUi(VARIATION_ROLES.CHILD);
  showAmazonNotification(
    "Loaded your live Amazon listing into this child draft. Review, save, preview, then submit to link it to the parent.",
    { tone: "info" },
  );
}

/**
 * @param {Record<string, unknown> | null | undefined} product
 * @param {string[]} [savedUrls]
 */
function applyPushImages(product, savedUrls = []) {
  pushImageUrls = initAmazonPushImages(product, savedUrls);
  syncPushImageUi();
}

function readInput(id) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return "";
}

async function applyCatalogHintForProduct(kkProductId) {
  const hint = await fetchAmazonCatalogHintForProduct(kkProductId);
  if (!hint?.asin) return hint;

  showAmazonNotification(
    hint.mappingStatus === "legacy"
      ? `Prior catalog ASIN ${hint.asin} found (legacy mapping). Leave Suggested ASIN blank for new listings (GTIN exemption). Only paste it if you are repushing on that live ASIN.`
      : `Mapped catalog ASIN ${hint.asin}. Paste into Suggested ASIN only for offer-only repush on that ASIN.`,
    { tone: "warning" },
  );
  return hint;
}

function readCardImageUrl(trigger) {
  const card = trigger?.closest?.(".amazon-ready-card");
  const fromCard = card instanceof HTMLElement ? card.dataset.imageUrl : "";
  const fromTrigger = trigger instanceof HTMLElement ? trigger.dataset.imageUrl : "";
  const url = String(fromCard || fromTrigger || "").trim();
  return url.startsWith("http") ? url : "";
}

function setInput(id, value) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value ?? "";
  }
}

function setAiFillStatus(message, tone = "info") {
  const el = qs("#amazonAiFillStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("hidden", "text-red-500", "text-green-600", "text-amber-600", "text-gray-500");
  if (tone === "error") el.classList.add("text-red-500");
  else if (tone === "success") el.classList.add("text-green-600");
  else if (tone === "warning") el.classList.add("text-amber-600");
  else el.classList.add("text-gray-500");
  if (!message) el.classList.add("hidden");
}

async function handleAmazonAiAutofill() {
  if (saving) return;

  const variationRole = readVariationRole();
  const isParent = variationRole === VARIATION_ROLES.PARENT;
  const kkTitle = qs("#amazonPushProductTitle")?.textContent?.trim() || "";
  const productName = (kkTitle && kkTitle !== "—" ? kkTitle : readInput("#amazonPushAmazonTitle")) || "";
  if (!productName) {
    showAmazonNotification("Open a product before using AI auto-fill.", { tone: "warning" });
    return;
  }

  const btn = qs('[data-action="amazon-ai-autofill"]');
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = "✨ Generating…";
  }
  setAiFillStatus(
    isParent
      ? "Generating variation parent catalog copy (color-neutral, no offer fields)…"
      : "Loading Amazon requirements and analyzing product images…",
  );

  try {
    const prep = await prepareForAiAutofill();
    const productType = prep.productType || readInput("#amazonPushProductType");
    let attributeNames = prep.attributeNames?.length
      ? prep.attributeNames
      : getLoadedAttributeNames();
    let requiredAttributes = attributeNames.length
      ? attributeNames
      : mergeAttributeNameLists(
        prep.requiredAttributes?.length ? prep.requiredAttributes : getLoadedRequiredAttributes(),
        getExtendedAttributeHints(productType),
      );
    requiredAttributes = filterAttributesForVariationRole(requiredAttributes, variationRole);
    const recommendedAttributes = [];
    const attributeEnums = prep.attributeEnums || getLoadedAttributeEnums();
    const attributeHints = buildAttributeHintsForAi(requiredAttributes, productType, attributeEnums);

    if (!prep.ok && prep.reason === "missing_product_type") {
      setAiFillStatus("Could not recommend a product type — set Product Type manually, then try again.", "warning");
    } else if (requiredAttributes.length) {
      setAiFillStatus(
        isParent
          ? `Generating parent catalog copy + ${requiredAttributes.length} shared attributes…`
          : `Generating copy + ${requiredAttributes.length} required Amazon attributes…`,
      );
    } else {
      setAiFillStatus("Generating listing copy and extended attributes…");
    }

    const selectedVariant = pushProductRow
      ? getSelectedAmazonVariant(String(pushProductRow.code || readInput("#amazonPushKkSku")))
      : null;
    const imageUrls = isParent && pushProductRow
      ? initAmazonPushImages(pushProductRow, []).filter((url) => url.startsWith("http")).slice(0, 4)
      : pushImageUrls.filter((url) => url.startsWith("http")).slice(0, AMAZON_PUSH_MAX_IMAGES);

    const variantColors = Array.isArray(pushProductRow?.product_variants)
      ? pushProductRow.product_variants
        .map((variant) => String(variant?.option_value || variant?.title || "").trim())
        .filter(Boolean)
      : [];

    const result = await amazonAiAutofill({
      productName,
      productCode: readInput("#amazonPushKkSku"),
      productType,
      price: isParent ? undefined : parsePrice(readInput("#amazonPushPrice")),
      imageUrls,
      requiredAttributes,
      recommendedAttributes,
      attributeHints,
      variationRole,
      variationTheme: readVariationTheme(),
      variantColors,
      brandDefault: readInput("#amazonPushBrand") || "Generic",
    });

    const ai = result.data || {};
    if (ai.title?.value) setInput("#amazonPushAmazonTitle", clampAmazonItemName(ai.title.value));
    if (ai.brand?.value) setInput("#amazonPushBrand", ai.brand.value);
    if (ai.description?.value) setInput("#amazonPushDescription", ai.description.value);
    if (Array.isArray(ai.bulletPoints) && ai.bulletPoints.length) {
      setInput(
        "#amazonPushBulletPoints",
        ai.bulletPoints.map((entry) => entry.value).filter(Boolean).join("\n"),
      );
    }
    applyAiAttributesToForm(ai.attributes, { productType });
    applyExtraAttributeDefaults(requiredAttributes, {
      productType,
      attributeEnums,
    });

    const filledAttrCount = Array.isArray(ai.attributes) ? ai.attributes.length : 0;
    const notes = Array.isArray(ai.notes) ? ai.notes.filter(Boolean) : [];
    if (notes.length) {
      setAiFillStatus(
        `AI filled core fields + ${filledAttrCount} attributes. Review: ${notes.join(" · ")}`,
        "warning",
      );
    } else if (!prep.ok && prep.reason === "missing_product_type") {
      setAiFillStatus("Core copy filled. Set Product Type and click AI again for required attributes.", "warning");
    } else {
      setAiFillStatus(
        `AI auto-fill complete — ${filledAttrCount} attribute(s). Review before saving.`,
        "success",
      );
    }
    showAmazonNotification("Amazon listing fields filled by AI.", { tone: "success" });
  } catch (err) {
    const messages = {
      openai_request_failed: "OpenAI request failed.",
      openai_empty_response: "AI returned an empty response.",
      openai_invalid_json: "AI returned invalid JSON.",
      openai_no_usable_content: "AI did not return usable listing content.",
      server_misconfigured: "OPENAI_API_KEY is not configured on the server.",
      unauthorized: "Please sign in as an admin.",
      ptd_request_failed: "Could not load product type requirements for AI fill.",
      amazon_not_connected: "Connect Amazon before using AI on required attributes.",
    };
    const message = messages[err?.code] || "AI auto-fill failed.";
    setAiFillStatus(message, "error");
    showAmazonNotification(message, { tone: "error" });
  } finally {
    const btn = qs('[data-action="amazon-ai-autofill"]');
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = false;
      btn.textContent = "✨ AI Auto-Fill";
    }
  }
}

function setText(id, value) {
  const el = qs(id);
  if (el) el.textContent = value ?? "—";
}

function parsePrice(value) {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseQuantity(value) {
  const num = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function renderValidationPanel(issues, options = {}) {
  const panel = qs("#amazonPushValidationPanel");
  if (!panel) return;

  const productType = readInput("#amazonPushProductType");
  const showAll = options.showAll === true;
  const filtered = showAll
    ? (issues || [])
    : filterFormAttributeNames(
      (issues || []).filter((issue) => {
        const field = String(issue?.field || "");
        if (!field) return true;
        return filterFormAttributeNames([field], productType).length > 0;
      }),
      productType,
    );

  if (!filtered.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  panel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  panel.innerHTML = filtered.map((issue) => {
    const tone = issue.severity === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
    return `<p class="rounded-lg border px-3 py-2 text-xs ${tone}">${issue.message}</p>`;
  }).join("");
}

function readCardProduct(trigger) {
  const card = trigger?.closest?.("article");
  if (!card) return null;

  const title = card.querySelector("h3")?.textContent?.trim() || "";
  const sku = trigger?.dataset?.sku || card.dataset.sku || "";
  const priceText = card.textContent.match(/\$[\d.]+/)?.[0] || "";
  const stockMatch = card.textContent.match(/Website Stock[\s\S]*?(\d+)/i);
  const stock = stockMatch ? stockMatch[1] : "";

  return { title, sku, priceText, stock };
}

function readReadyCardMeta(trigger) {
  const card = trigger?.closest?.(".amazon-ready-card");
  const source = card || trigger;
  if (!(source instanceof HTMLElement)) return null;

  const warningsRaw = source.dataset.eligibilityWarnings || "";
  const warnings = warningsRaw
    ? warningsRaw.split("|").map((entry) => entry.trim()).filter(Boolean)
    : [];

  if (!source.dataset.eligibilityStatus && !warnings.length) return null;

  return {
    eligibilityStatus: source.dataset.eligibilityStatus || "",
    eligibilityWarnings: warnings,
  };
}

function hidePushEligibilityPanel() {
  const panel = qs("#amazonPushEligibilityPanel");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.innerHTML = "";
}

function renderPushEligibilityPanel(meta) {
  const panel = qs("#amazonPushEligibilityPanel");
  if (!panel) return;

  if (!meta?.eligibilityWarnings?.length) {
    hidePushEligibilityPanel();
    return;
  }

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <p class="text-xs font-bold text-amber-900">This product may need review before Amazon submission:</p>
    <ul class="mt-2 text-xs text-amber-800 list-disc pl-4 space-y-1">
      ${meta.eligibilityWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
    </ul>
  `;
}

async function resolveProduct(trigger) {
  const productId = trigger?.dataset?.kkProductId || "";
  if (UUID_RE.test(productId)) {
    return { id: productId, code: trigger?.dataset?.sku || "", name: readCardProduct(trigger)?.title || "" };
  }

  const sku = trigger?.dataset?.sku || readCardProduct(trigger)?.sku || "";
  if (!sku) return null;

  const products = await searchKkProducts(sku);
  const exact = products.find((row) => row.code === sku);
  return exact || products[0] || null;
}

function hydrateFromDraftRow(row) {
  const payload = row.draft_payload && typeof row.draft_payload === "object"
    ? row.draft_payload
    : {};

  const offerWorkflow = shouldHydrateSuggestedAsin(row.push_workflow, row.requirements);
  if (offerWorkflow) {
    const matchedAsin = String(
      payload.merchant_suggested_asin || row.matched_asin || row.asin || "",
    ).trim();
    if (matchedAsin) payload.merchant_suggested_asin = matchedAsin;
  } else {
    delete payload.merchant_suggested_asin;
  }

  setInput("#amazonPushDraftId", String(row.draft_id || ""));
  setInput("#amazonPushKkProductId", String(row.kk_product_id || ""));
  setText("#amazonPushProductTitle", String(row.kk_product_title || payload.title || ""));
  setText("#amazonPushKkSku", String(row.kk_sku || ""));
  setInput("#amazonPushSellerSku", String(row.seller_sku || row.kk_sku || ""));
  setInput("#amazonPushMarketplaceId", String(row.marketplace_id || "ATVPDKIKX0DER"));
  setInput("#amazonPushProductType", String(row.product_type || payload.productType || ""));
  setInput("#amazonPushAmazonTitle", clampAmazonItemName(String(payload.title || row.kk_product_title || "")));
  setInput("#amazonPushBrand", String(payload.brand || "Generic"));
  setInput("#amazonPushPrice", payload.price != null ? String(payload.price) : "");
  setInput("#amazonPushQuantity", payload.quantity != null ? String(payload.quantity) : "");
  setInput("#amazonPushConditionType", String(payload.conditionType || "new_new"));
  setInput("#amazonPushFulfillmentChannel", String(payload.fulfillmentChannel || "DEFAULT"));
  setInput("#amazonPushDescription", String(payload.description || ""));
  setInput("#amazonPushBulletPoints", Array.isArray(payload.bulletPoints)
    ? payload.bulletPoints.join("\n")
    : String(payload.bulletPoints || ""));

  pushImageUrls = Array.isArray(payload.imageUrls)
    ? payload.imageUrls.filter((url) => typeof url === "string" && url.startsWith("http"))
    : [];

  fetchKkProductForPush(String(row.kk_product_id || ""))
    .then(async (product) => {
      pushProductRow = product;
      if (product) {
        pushFamilyContext = await fetchAmazonVariationFamilyContext(String(row.kk_product_id || ""));
        const variant = initAmazonVariantPanel(
          product.product_variants || [],
          String(product.code || row.kk_sku || ""),
          row.kk_variant_id ? String(row.kk_variant_id) : null,
        );
        hydrateVariationFamilyFromDraft(
          row,
          String(product.code || row.kk_sku || ""),
          product.product_variants || [],
          pushFamilyContext,
        );
        applyPushImages(product, pushImageUrls);
        const draftRole = String(row.variation_role || VARIATION_ROLES.STANDALONE);
        if (draftRole !== VARIATION_ROLES.PARENT && variant) {
          applyVariantToPushForm(variant, String(product.code || ""));
        } else if (draftRole === VARIATION_ROLES.PARENT) {
          setInput("#amazonPushKkVariantId", "");
          updateVariationRoleUi(VARIATION_ROLES.PARENT);
          const colorInput = document.querySelector('#amazonPushExtraAttributes [data-amazon-attr="color"]');
          if (colorInput instanceof HTMLInputElement) colorInput.value = "";
        }
      } else {
        syncPushImageUi();
      }
    })
    .catch(() => {
      syncPushImageUi();
    });

  renderValidationPanel(Array.isArray(row.validation_errors) ? row.validation_errors : []);
  try {
    hydratePtdFromDraft({ ...row, draft_payload: payload });
  } catch (ptdErr) {
    console.error("[amazon] hydratePtdFromDraft failed", ptdErr);
    resetPtdPanels();
    showAmazonNotification(
      "Draft loaded but attribute fields could not be restored. Reload product type requirements.",
      { tone: "warning" },
    );
  }
  applyCatalogHintForProduct(String(row.kk_product_id || "")).catch(() => {});
  const submitMeta = deriveSubmitMetaFromDraftRow(row);
  setDraftSubmitMeta(submitMeta);
  setPtdPreviewMeta({
    previewedAt: submitMeta.ptdPreviewAt,
    productType: submitMeta.ptdPreviewProductType,
  });
  setInput("#amazonPushAmazonPreviewAt", submitMeta.amazonPreviewAt || "");
  updateVerifyReadiness();
  hidePushEligibilityPanel();
  updatePushComplianceWarnings(() => readInput("#amazonPushProductType"));

  const statusEl = qs('[data-hydrate="push-review-status"]');
  if (statusEl) statusEl.textContent = String(row.draft_status || "draft").replace(/_/g, " ");

  const reviewProduct = qs('[data-hydrate="push-review-product"]');
  if (reviewProduct) {
    reviewProduct.textContent = String(row.kk_product_title || payload.title || "—");
  }
  const reviewPriceQty = qs('[data-hydrate="push-review-price-qty"]');
  if (reviewPriceQty) {
    const price = payload.price != null ? `$${payload.price}` : "—";
    const qty = payload.quantity != null ? `${payload.quantity} units · FBM` : "—";
    reviewPriceQty.textContent = `${price} · ${qty}`;
  }
}

/**
 * @param {{ onDraftSaved?: () => Promise<void> | void, getDraftRowById?: (id: string) => Record<string, unknown> | null, onVerified?: () => Promise<void> | void }} deps
 */
export function initAmazonPushDraft(deps = {}) {
  const getDraft = deps.getDraftRowById || (() => null);

  const ptd = initPushDraftPtd({
    collectPayload,
    validateCollectPayload: (payload) => validateAmazonDraftSavePayload(payload, {
      variantCount: pushProductRow?.product_variants?.length || 0,
    }),
    renderValidationPanel,
    onDraftSaved: deps.onDraftSaved,
    isSaving: () => saving,
    setSaving: (value) => { saving = value; },
    setDraftSubmitMeta,
    setPtdPreviewMeta,
    updateReadiness: updateLiveSubmitReadiness,
    updateComplianceWarnings: () => updatePushComplianceWarnings(() => readInput("#amazonPushProductType")),
  });

  initPushDraftLive({
    renderValidationPanel,
    onDraftSaved: deps.onDraftSaved,
    isSaving: () => saving,
    setSaving: (value) => { saving = value; },
    onSubmitComplete: () => updateVerifyReadiness(),
  });

  const productTypeInput = qs("#amazonPushProductType");
  if (productTypeInput) {
    productTypeInput.addEventListener("input", () => {
      updatePushComplianceWarnings(() => readInput("#amazonPushProductType"));
    });
  }

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest("#amazonPushExtraAttributes")) return;
    updatePushComplianceWarnings(() => readInput("#amazonPushProductType"));
  });

  initPushDraftVerify({
    onVerified: deps.onVerified,
    isSaving: () => saving,
    setSaving: (value) => { saving = value; },
  });

  wireAmazonVariantPanel(() => {
    if (!pushProductRow) return;
    if (readVariationRole() === VARIATION_ROLES.PARENT) return;
    const variant = getSelectedAmazonVariant(String(pushProductRow.code || ""));
    applyVariantToPushForm(variant, String(pushProductRow.code || ""));
  });

  function syncPushFormForVariationRole(role) {
    if (!pushProductRow) {
      updateVariationRoleUi(role);
      return;
    }
    const productCode = String(pushProductRow.code || readInput("#amazonPushKkSku") || "");
    updateVariationRoleUi(role);
    if (role === VARIATION_ROLES.PARENT) {
      setInput("#amazonPushKkVariantId", "");
      const parentSku = readParentSellerSku() || defaultParentSellerSku(productCode);
      if (parentSku) setInput("#amazonPushSellerSku", parentSku);
      applyPushImages(pushProductRow, pushImageUrls);
      return;
    }
    const variant = getSelectedAmazonVariant(productCode);
    if (variant) applyVariantToPushForm(variant, productCode);
  }

  wireAmazonVariationFamilyPanel((role) => {
    const draftId = readInput("#amazonPushDraftId");
    const kkVariantId = readInput("#amazonPushKkVariantId");
    if (role === VARIATION_ROLES.PARENT) {
      setInput("#amazonPushParentDraftId", "");
    }
    if (draftId && role === VARIATION_ROLES.PARENT && kkVariantId) {
      setInput("#amazonPushDraftId", "");
      showAmazonNotification(
        "This draft is tied to a color variant. Draft link cleared — use Push Parent and save again to create KK-XXXX-PARENT.",
        { tone: "warning" },
      );
    }
    syncPushFormForVariationRole(role);
  });

  function isLinkToFamilyOpen(trigger, options = {}) {
    return options.linkToFamily === true || trigger?.dataset?.linkVariationFamily === "true";
  }

  function resolveInitialVariationRole(trigger, options = {}, familyContext = null) {
    if (String(trigger?.dataset?.readyRowKind || "") === "parent_shell") {
      return VARIATION_ROLES.PARENT;
    }
    if (String(trigger?.dataset?.variationRole || "").toLowerCase() === "parent") {
      return VARIATION_ROLES.PARENT;
    }
    if (isLinkToFamilyOpen(trigger, options)) return VARIATION_ROLES.CHILD;
    if (options.preferredVariationRole) return options.preferredVariationRole;
    const variantId = trigger?.dataset?.kkVariantId;
    if (variantId && canAddChildToFamily(familyContext)) return VARIATION_ROLES.CHILD;
    return VARIATION_ROLES.STANDALONE;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-action="amazon-push-add-image"]')) return;
    event.preventDefault();
    if (!pushProductRow) {
      showAmazonNotification("Product images unavailable.", { tone: "warning" });
      return;
    }
    showAmazonPushGalleryPicker(pushImageUrls, pushProductRow);
  });

  async function hydratePushModal(trigger, options = {}) {
    try {
      await hydratePushModalInner(trigger, options);
    } catch (err) {
      console.error("[amazon] hydratePushModal failed", err);
      showAmazonNotification(
        "Could not finish loading the push form. Try again or open Continue Draft.",
        { tone: "error" },
      );
      throw err;
    }
  }

  async function hydratePushModalInner(trigger, options = {}) {
    const linkToFamily = isLinkToFamilyOpen(trigger, options);
    pushLinkToFamilySession = linkToFamily;
    const listingRow = options.listingRow && typeof options.listingRow === "object"
      ? options.listingRow
      : null;
    const titleEl = qs("#amazonPushModalTitle");
    if (titleEl) {
      if (linkToFamily) {
        titleEl.textContent = "Link to Variation Family";
      } else {
        titleEl.textContent = options.draftMode
          ? "Create Amazon Draft"
          : "Push Product to Amazon";
      }
    }

    const draftId = trigger?.dataset?.draftId;
    if (draftId) {
      let row = getDraft(String(draftId));
      if (!row) {
        try {
          row = await fetchAmazonDraftById(String(draftId));
        } catch {
          row = null;
        }
      }
      if (row) {
        hydrateFromDraftRow(row);
        return;
      }
    }

    setInput("#amazonPushDraftId", "");
    resetAmazonVariantPanel();
    resetAmazonVariationFamilyPanel();
    setInput("#amazonPushKkVariantId", "");
    if (!options.fromQueue) clearPushQueue();
    resetPtdPanels();
    pushImageUrls = [];
    pushProductRow = null;
    pushFamilyContext = null;
    hideAmazonPushGalleryPicker();
    syncPushImageUi();
    setAiFillStatus("");
    renderValidationPanel([]);
    setDraftSubmitMeta({ draftStatus: "", submissionStatus: "", previewValidated: false, draftUpdatedAt: "", amazonPreviewAt: "" });
    setPtdPreviewMeta({ previewedAt: "", productType: "" });
    updateVerifyReadiness();
    hidePushEligibilityPanel();
    hidePushCompliancePanel();

    const cardMeta = readReadyCardMeta(trigger);
    const cardData = readCardProduct(trigger);
    const cardImageUrl = readCardImageUrl(trigger);
    const preferredVariantId = readPreferredVariantId(trigger, listingRow);
    let product = null;
    try {
      product = await resolveProduct(trigger);
    } catch {
      product = null;
    }

    const title = product?.name || cardData?.title || "";
    const sku = product?.code || cardData?.sku || "";
    const card = trigger?.closest?.(".amazon-ready-card");
    const suggestedSku = trigger?.dataset?.suggestedSellerSku
      || (card instanceof HTMLElement ? card.dataset.suggestedSellerSku : "")
      || sku;
    const price = product?.price != null
      ? String(product.price)
      : parsePrice(cardData?.priceText || "")?.toString() || "";
    const stockFromCard = card instanceof HTMLElement ? card.dataset.kkStock : "";
    const quantity = stockFromCard
      || (product?.stock != null ? String(product.stock) : cardData?.stock || "");

    setInput("#amazonPushKkProductId", product?.id || "");
    setText("#amazonPushProductTitle", title || "—");
    setText("#amazonPushKkSku", sku || "—");
    setInput("#amazonPushSellerSku", suggestedSku || sku);
    setInput("#amazonPushMarketplaceId", "ATVPDKIKX0DER");
    setInput("#amazonPushProductType", "");
    setInput("#amazonPushAmazonTitle", title);
    setInput("#amazonPushBrand", "Generic");
    setInput("#amazonPushPrice", price);
    setInput("#amazonPushQuantity", quantity);
    setInput("#amazonPushConditionType", "new_new");
    setInput("#amazonPushFulfillmentChannel", "DEFAULT");
    setInput("#amazonPushDescription", "");
    setInput("#amazonPushBulletPoints", "");

    if (product?.id) {
      const fetchId = linkToFamily && listingRow?.kk_product_id
        ? String(listingRow.kk_product_id)
        : String(product.id);
      pushProductRow = await fetchKkProductForPush(fetchId) || product;
    } else if (linkToFamily && listingRow?.kk_product_id) {
      pushProductRow = await fetchKkProductForPush(String(listingRow.kk_product_id));
    } else {
      pushProductRow = null;
    }
    if (pushProductRow) {
      pushFamilyContext = product?.id
        ? await fetchAmazonVariationFamilyContext(String(product.id))
        : null;
      initAmazonVariationFamilyPanel(
        String(pushProductRow.code || sku),
        pushProductRow.product_variants || [],
        pushFamilyContext,
        resolveInitialVariationRole(trigger, options, pushFamilyContext),
        readInput("#amazonPushDraftId"),
      );

      const parentProductType = pushFamilyContext?.parentProductType
        ? String(pushFamilyContext.parentProductType).trim()
        : "";
      const currentProductType = readInput("#amazonPushProductType");
      if (
        parentProductType
        && readVariationRole() === VARIATION_ROLES.CHILD
        && (!currentProductType || currentProductType.toUpperCase() === "ACCESSORY")
      ) {
        setInput("#amazonPushProductType", parentProductType);
        showAmazonNotification(
          `Using parent product type ${parentProductType} so this child matches the variation family.`,
          { tone: "info" },
        );
      }

      if (linkToFamily && listingRow) {
        await hydrateLinkToFamilyFromListing(listingRow, pushProductRow, pushFamilyContext);
      } else {
        const initialRole = readVariationRole();
        if (initialRole !== VARIATION_ROLES.PARENT) {
          const variant = initAmazonVariantPanel(
            pushProductRow.product_variants || [],
            String(pushProductRow.code || sku),
            preferredVariantId,
          );
          if (variant) {
            applyVariantToPushForm(variant, String(pushProductRow.code || sku));
          }
        }
        applyPushImages(pushProductRow, []);
        if (initialRole === VARIATION_ROLES.PARENT) {
          syncPushFormForVariationRole(VARIATION_ROLES.PARENT);
        } else if (
          initialRole === VARIATION_ROLES.CHILD
          && !readInput("#amazonPushDraftId")
          && pushFamilyContext
        ) {
          const variants = pushProductRow.product_variants || [];
          const selected = preferredVariantId
            ? variants.find((entry) => String(entry?.id || "") === String(preferredVariantId))
            : null;
          try {
            await applyParentDraftInheritance(pushFamilyContext, {
              variantLabel: String(selected?.option_value || selected?.title || ""),
              productTitle: title,
              productType: readInput("#amazonPushProductType"),
              hasExistingChildDraft: false,
            });
          } catch (inheritErr) {
            console.error("[amazon] applyParentDraftInheritance failed", inheritErr);
            showAmazonNotification(
              "Could not auto-copy parent draft fields. Use “Copy shared fields from parent” after load.",
              { tone: "warning" },
            );
          }
        }
      }
    } else if (cardImageUrl) {
      pushImageUrls = [cardImageUrl];
      syncPushImageUi();
    } else {
      applyPushImages(null, []);
    }

    if (options.fromQueue && getPushQueueLength() > 1) {
      showAmazonNotification(
        `Bulk push queue: ${getPushQueueLength()} variants remaining after this one.`,
        { tone: "info" },
      );
    }

    const reviewProduct = qs('[data-hydrate="push-review-product"]');
    if (reviewProduct) reviewProduct.textContent = title || "—";
    const reviewPriceQty = qs('[data-hydrate="push-review-price-qty"]');
    if (reviewPriceQty) {
      reviewPriceQty.textContent = `${price ? `$${price}` : "—"} · ${quantity || "—"} units · FBM`;
    }
    const statusEl = qs('[data-hydrate="push-review-status"]');
    if (statusEl) statusEl.textContent = "Draft — not saved";

    renderPushEligibilityPanel(cardMeta);
    updateLiveSubmitReadiness();

    if (product?.id) {
      applyCatalogHintForProduct(product.id).catch(() => {});
    }
  }

  function collectPayload() {
    const bulletRaw = readInput("#amazonPushBulletPoints");
    const bulletPoints = bulletRaw
      ? bulletRaw.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    const recommendationMeta = getRecommendationMeta();
    const productType = readInput("#amazonPushProductType");
    const extraAttributes = stripInvalidPushPayloadAttributes(
      readExtraAttributesFromForm(),
      productType,
    );
    const { suggestedAsin, offerOnExistingAsin, requirements, pushWorkflow } =
      resolvePushWorkflowFromSuggestedAsin(extraAttributes.merchant_suggested_asin);
    if (offerOnExistingAsin) {
      extraAttributes.merchant_suggested_asin = suggestedAsin;
    } else {
      delete extraAttributes.merchant_suggested_asin;
    }
    if (productType.toUpperCase() === "TOY_FIGURE") {
      delete extraAttributes.educational_objective;
      delete extraAttributes.item_dimensions;
      delete extraAttributes.supplier_declared_dg_hz_regulation;
    }
    if (productType.toUpperCase() === "KEYCHAIN") {
      delete extraAttributes.cpsia_cautionary_statement;
      delete extraAttributes.safety_warning;
      delete extraAttributes.educational_objective;
      delete extraAttributes.is_assembly_required;
      delete extraAttributes.target_audience_keyword;
      delete extraAttributes.age_range_description;
      delete extraAttributes.manufacturer_minimum_age;
      delete extraAttributes.manufacturer_maximum_age;
      delete extraAttributes.toy_figure_type;
      delete extraAttributes.subject_character;
      delete extraAttributes.item_length_width_height;
      delete extraAttributes.package_level;
    }
    if (productType.toUpperCase() === "HAT") {
      for (const name of HAT_FORM_DENYLIST) {
        delete extraAttributes[name];
      }
    }
    if (productType.toUpperCase() === "APPAREL_PIN") {
      for (const name of APPAREL_PIN_FORM_DENYLIST) {
        delete extraAttributes[name];
      }
    }
    if (productType.toUpperCase() === "APPAREL_BELT") {
      for (const name of APPAREL_BELT_FORM_DENYLIST) {
        delete extraAttributes[name];
      }
    }
    if (productType.toUpperCase() === "HANDBAG") {
      for (const name of HANDBAG_FORM_DENYLIST) {
        delete extraAttributes[name];
      }
    }
    if (productType.toUpperCase() === "TOTE_BAG") {
      for (const name of HANDBAG_FORM_DENYLIST) {
        delete extraAttributes[name];
      }
      for (const name of TOTE_BAG_FORM_EXTRA_DENYLIST) {
        delete extraAttributes[name];
      }
    }
    if (productType.toUpperCase() === "ARTIFICIAL_PLANT") {
      delete extraAttributes.theme;
      delete extraAttributes.target_gender;
      delete extraAttributes.target_audience_keyword;
      delete extraAttributes.age_range_description;
      delete extraAttributes.toy_figure_type;
      delete extraAttributes.subject_character;
      delete extraAttributes.cpsia_cautionary_statement;
      delete extraAttributes.safety_warning;
      delete extraAttributes.educational_objective;
      delete extraAttributes.item_length_width_height;
      delete extraAttributes.batteries_required;
      delete extraAttributes.batteries_included;
      delete extraAttributes.variation_theme;
      delete extraAttributes.child_parent_sku_relationship;
      for (const name of ARTIFICIAL_PLANT_FORM_DENYLIST) {
        delete extraAttributes[name];
      }
    }

    const variationRole = readVariationRole();
    const variationTheme = readVariationTheme();
    const parentSellerSku = readParentSellerSku();
    const selectedVariant = pushProductRow
      ? getSelectedAmazonVariant(String(pushProductRow.code || readInput("#amazonPushKkSku")))
      : null;

    applyVariationAttributes(extraAttributes, variationRole, {
      parentSellerSku,
      variationTheme,
      variantColor: variantColorValue(selectedVariant),
    });

    let sellerSku = readInput("#amazonPushSellerSku");
    let kkVariantId = readInput("#amazonPushKkVariantId") || undefined;
    if (variationRole === VARIATION_ROLES.PARENT) {
      sellerSku = parentSellerSku || sellerSku;
      kkVariantId = undefined;
    } else if (
      variationRole === VARIATION_ROLES.CHILD
      && pushProductRow
      && (pushProductRow.product_variants || []).length > 1
      && !kkVariantId
    ) {
      const picked = getSelectedAmazonVariant(String(pushProductRow.code || readInput("#amazonPushKkSku")));
      if (picked?.id) kkVariantId = String(picked.id);
    }

    const rawParentDraftId = readParentDraftId();
    const resolvedParentDraftId = UUID_RE.test(rawParentDraftId) ? rawParentDraftId : "";

    let imageUrls = pushImageUrls.slice(0, AMAZON_PUSH_MAX_IMAGES);
    if (variationRole === VARIATION_ROLES.PARENT && !imageUrls.length && pushProductRow) {
      imageUrls = initAmazonPushImages(pushProductRow, []).slice(0, AMAZON_PUSH_MAX_IMAGES);
    }

    const safeExtras = { ...extraAttributes };
    delete safeExtras.title;
    delete safeExtras.item_name;

    const draftPayload = {
      brand: readInput("#amazonPushBrand") || "Generic",
      description: readInput("#amazonPushDescription"),
      bulletPoints,
      price: parsePrice(readInput("#amazonPushPrice")),
      quantity: parseQuantity(readInput("#amazonPushQuantity")),
      conditionType: readInput("#amazonPushConditionType") || "new_new",
      fulfillmentChannel: readInput("#amazonPushFulfillmentChannel") || "DEFAULT",
      productType: readInput("#amazonPushProductType"),
      imageUrls,
      ...safeExtras,
      title: clampAmazonItemName(readInput("#amazonPushAmazonTitle")),
      ...(recommendationMeta ? { amazonProductTypeRecommendation: recommendationMeta } : {}),
    };

    if (variationRole === VARIATION_ROLES.PARENT) {
      delete draftPayload.price;
      delete draftPayload.quantity;
      delete draftPayload.color;
      delete draftPayload.merchant_suggested_asin;
      draftPayload.variation_role = VARIATION_ROLES.PARENT;
    } else if (variationRole === VARIATION_ROLES.CHILD) {
      draftPayload.variation_role = VARIATION_ROLES.CHILD;
    }

    return {
      draftId: readInput("#amazonPushDraftId") || undefined,
      kkProductId: readInput("#amazonPushKkProductId"),
      kkVariantId,
      kkSku: readInput("#amazonPushKkSku"),
      marketplaceId: readInput("#amazonPushMarketplaceId") || "ATVPDKIKX0DER",
      sellerSku,
      matchedAsin: suggestedAsin || undefined,
      productType,
      requirements,
      requirementsEnforced: "ENFORCED",
      pushWorkflow,
      variationRole,
      parentDraftId: variationRole === VARIATION_ROLES.CHILD && resolvedParentDraftId
        ? resolvedParentDraftId
        : undefined,
      parentSellerSku: variationRole === VARIATION_ROLES.CHILD ? parentSellerSku : undefined,
      variationTheme: variationRole !== VARIATION_ROLES.STANDALONE ? variationTheme : undefined,
      draftPayload,
    };
  }

  async function persistDraft(action) {
    if (saving) return;

    const payload = collectPayload();
    const localIssues = validateAmazonDraftSavePayload(payload, {
      variantCount: pushProductRow?.product_variants?.length || 0,
    });
    if (localIssues.length) {
      renderValidationPanel(localIssues.map((issue) => ({
        field: issue.field,
        severity: "error",
        message: issue.message,
      })));
      showAmazonNotification(draftSaveValidationMessage(localIssues), { tone: "warning" });
      return;
    }

    saving = true;
    try {
      const result = await saveAmazonDraft({ ...payload, action });
      renderValidationPanel(result.validationErrors || []);
      if (result.draftId) setInput("#amazonPushDraftId", String(result.draftId));
      setDraftSubmitMeta({
        draftStatus: result.draftStatus,
        submissionStatus: "",
        previewValidated: false,
        draftUpdatedAt: new Date().toISOString(),
      });

      const statusEl = qs('[data-hydrate="push-review-status"]');
      if (statusEl) {
        statusEl.textContent = String(result.draftStatus || "draft").replace(/_/g, " ");
      }

      const messages = {
        save_draft: "Amazon draft saved locally.",
        preview: "Draft preview saved with validation results.",
        save_ready: "Draft marked ready to submit locally.",
      };
      showAmazonNotification(messages[action] || "Draft saved.", { tone: "success" });

      await deps.onDraftSaved?.();

      if (action === "save_draft") {
        const next = advancePushQueue();
        if (next) {
          showAmazonNotification(
            `Draft saved. ${getPushQueueLength()} more variant${getPushQueueLength() === 1 ? "" : "s"} in queue.`,
            { tone: "success" },
          );
          await hydratePushModal(readyRowAsTrigger(next), { draftMode: true, fromQueue: true });
          return;
        }
        clearPushQueue();
        if (!pushLinkToFamilySession) {
          closeAmazonModals();
        }
      }
    } catch (err) {
      const code = err?.code || "request_failed";
      const reason = err?.reason || "";
      const messages = {
        product_not_found: "KK product not found.",
        marketplace_not_found: "Marketplace not found.",
        draft_not_found: "Draft not found.",
        invalid_request: "Invalid draft request.",
        missing_title: "Amazon title is required.",
        missing_kk_product_id: "KK product is missing. Re-open Push to Amazon from Ready to Push.",
        missing_marketplace_id: "Marketplace is missing.",
        parent_draft_not_found: "Parent draft link not found. Re-open the push modal or clear parent draft ID.",
        parent_draft_not_parent_role: "Linked draft is not a variation parent. Use Push Parent to create KK-XXXX-PARENT.",
        parent_draft_self_reference: "Parent draft link pointed at this child draft. Save again after a hard refresh.",
        parent_cannot_have_variant: "Parent listings cannot include a variant ID. Use Push Parent from Ready to Push.",
        unauthorized: "Please sign in as an admin.",
        database_error: "Could not save draft.",
      };
      showAmazonNotification(messages[reason] || messages[code] || "Could not save draft.", { tone: "error" });
    } finally {
      saving = false;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;

    switch (actionEl.dataset.action) {
      case "save-amazon-draft":
        event.preventDefault();
        persistDraft("save_draft").catch(() => {});
        break;
      case "preview-amazon-issues":
        event.preventDefault();
        persistDraft("preview").catch(() => {});
        break;
      case "load-amazon-product-type":
        event.preventDefault();
        ptd.loadProductTypeRequirements(false).catch(() => {});
        break;
      case "refresh-amazon-product-type":
        event.preventDefault();
        ptd.loadProductTypeRequirements(true).catch(() => {});
        break;
      case "preview-amazon-draft":
        event.preventDefault();
        ptd.previewAmazonRequirements(false).catch(() => {});
        break;
      case "preview-amazon-submit":
        event.preventDefault();
        ptd.previewAmazonSubmit().catch(() => {});
        break;
      case "search-amazon-product-types":
        event.preventDefault();
        ptd.searchProductTypes().catch(() => {});
        break;
      case "recommend-amazon-product-type":
        event.preventDefault();
        ptd.recommendProductType().catch(() => {});
        break;
      case "accept-amazon-product-type-recommendation":
        event.preventDefault();
        ptd.acceptProductTypeRecommendation(actionEl.dataset.productType || "");
        break;
      case "amazon-ai-autofill":
        event.preventDefault();
        handleAmazonAiAutofill().catch(() => {});
        break;
      case "copy-parent-draft-fields":
        event.preventDefault();
        (async () => {
          const productId = readInput("#amazonPushKkProductId");
          if (!productId) return;
          const ctx = await fetchAmazonVariationFamilyContext(productId);
          const variants = pushProductRow?.product_variants || [];
          const variantId = readInput("#amazonPushKkVariantId");
          const selected = variantId
            ? variants.find((entry) => String(entry?.id || "") === variantId)
            : null;
          await applyParentDraftInheritance(ctx, {
            variantLabel: String(selected?.option_value || selected?.title || ""),
            productTitle: qs("#amazonPushProductTitle")?.textContent?.trim() || "",
            productType: readInput("#amazonPushProductType"),
            hasExistingChildDraft: false,
          });
        })().catch(() => {});
        break;
      case "select-amazon-product-type":
        event.preventDefault();
        ptd.selectProductType(actionEl.dataset.productType || "");
        break;
      default:
        break;
    }
  });

  return {
    hydratePushModal,
    hydrateFromDraftRow,
  };
}
