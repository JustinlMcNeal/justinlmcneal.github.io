import { qs } from "./dom.js";
import { saveAmazonDraft, searchKkProducts, fetchAmazonDraftById } from "./api.js";
import { closeAmazonModals } from "./modals.js";
import { showAmazonNotification } from "./notifications.js";
import { escapeHtml } from "./renderListings.js";
import { initPushDraftPtd, hydratePtdFromDraft, resetPtdPanels } from "./pushDraftPtd.js";
import { initPushDraftLive, deriveSubmitMetaFromDraftRow, setDraftSubmitMeta, setPtdPreviewMeta, updateLiveSubmitReadiness } from "./pushDraftLive.js";
import { initPushDraftVerify, updateVerifyReadiness } from "./pushDraftVerify.js";
import { getRecommendationMeta } from "./pushDraftPtd.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {boolean} */
let saving = false;

function readInput(id) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return "";
}

function setInput(id, value) {
  const el = qs(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value ?? "";
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

function renderValidationPanel(issues) {
  const panel = qs("#amazonPushValidationPanel");
  if (!panel) return;

  if (!issues?.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  panel.innerHTML = issues.map((issue) => {
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

  setInput("#amazonPushDraftId", String(row.draft_id || ""));
  setInput("#amazonPushKkProductId", String(row.kk_product_id || ""));
  setText("#amazonPushProductTitle", String(row.kk_product_title || payload.title || ""));
  setText("#amazonPushKkSku", String(row.kk_sku || ""));
  setInput("#amazonPushSellerSku", String(row.seller_sku || row.kk_sku || ""));
  setInput("#amazonPushMarketplaceId", String(row.marketplace_id || "ATVPDKIKX0DER"));
  setInput("#amazonPushProductType", String(row.product_type || payload.productType || ""));
  setInput("#amazonPushAmazonTitle", String(payload.title || row.kk_product_title || ""));
  setInput("#amazonPushBrand", String(payload.brand || "Karry Kraze"));
  setInput("#amazonPushPrice", payload.price != null ? String(payload.price) : "");
  setInput("#amazonPushQuantity", payload.quantity != null ? String(payload.quantity) : "");
  setInput("#amazonPushConditionType", String(payload.conditionType || "new_new"));
  setInput("#amazonPushFulfillmentChannel", String(payload.fulfillmentChannel || "DEFAULT"));
  setInput("#amazonPushDescription", String(payload.description || ""));
  setInput("#amazonPushBulletPoints", Array.isArray(payload.bulletPoints)
    ? payload.bulletPoints.join("\n")
    : String(payload.bulletPoints || ""));

  renderValidationPanel(Array.isArray(row.validation_errors) ? row.validation_errors : []);
  hydratePtdFromDraft(row);
  const submitMeta = deriveSubmitMetaFromDraftRow(row);
  setDraftSubmitMeta(submitMeta);
  setPtdPreviewMeta({
    previewedAt: submitMeta.ptdPreviewAt,
    productType: submitMeta.ptdPreviewProductType,
  });
  setInput("#amazonPushAmazonPreviewAt", submitMeta.amazonPreviewAt || "");
  updateVerifyReadiness();
  hidePushEligibilityPanel();

  const statusEl = qs('[data-hydrate="push-review-status"]');
  if (statusEl) statusEl.textContent = String(row.draft_status || "draft").replace(/_/g, " ");
}

/**
 * @param {{ onDraftSaved?: () => Promise<void> | void, getDraftRowById?: (id: string) => Record<string, unknown> | null, onVerified?: () => Promise<void> | void }} deps
 */
export function initAmazonPushDraft(deps = {}) {
  const getDraft = deps.getDraftRowById || (() => null);

  const ptd = initPushDraftPtd({
    collectPayload,
    renderValidationPanel,
    onDraftSaved: deps.onDraftSaved,
    isSaving: () => saving,
    setSaving: (value) => { saving = value; },
    setDraftSubmitMeta,
    setPtdPreviewMeta,
    updateReadiness: updateLiveSubmitReadiness,
  });

  initPushDraftLive({
    renderValidationPanel,
    onDraftSaved: deps.onDraftSaved,
    isSaving: () => saving,
    setSaving: (value) => { saving = value; },
    onSubmitComplete: () => updateVerifyReadiness(),
  });

  initPushDraftVerify({
    onVerified: deps.onVerified,
    isSaving: () => saving,
    setSaving: (value) => { saving = value; },
  });

  async function hydratePushModal(trigger, options = {}) {
    const titleEl = qs("#amazonPushModalTitle");
    if (titleEl) {
      titleEl.textContent = options.draftMode
        ? "Create Amazon Draft"
        : "Push Product to Amazon";
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
    resetPtdPanels();
    renderValidationPanel([]);
    setDraftSubmitMeta({ draftStatus: "", submissionStatus: "", previewValidated: false, draftUpdatedAt: "", amazonPreviewAt: "" });
    setPtdPreviewMeta({ previewedAt: "", productType: "" });
    updateVerifyReadiness();
    hidePushEligibilityPanel();

    const cardMeta = readReadyCardMeta(trigger);
    const cardData = readCardProduct(trigger);
    let product = null;
    try {
      product = await resolveProduct(trigger);
    } catch {
      product = null;
    }

    const title = product?.name || cardData?.title || "";
    const sku = product?.code || cardData?.sku || "";
    const price = product?.price != null
      ? String(product.price)
      : parsePrice(cardData?.priceText || "")?.toString() || "";
    const quantity = product?.stock != null
      ? String(product.stock)
      : cardData?.stock || "";

    setInput("#amazonPushKkProductId", product?.id || "");
    setText("#amazonPushProductTitle", title || "—");
    setText("#amazonPushKkSku", sku || "—");
    setInput("#amazonPushSellerSku", sku);
    setInput("#amazonPushMarketplaceId", "ATVPDKIKX0DER");
    setInput("#amazonPushProductType", "");
    setInput("#amazonPushAmazonTitle", title);
    setInput("#amazonPushBrand", "Karry Kraze");
    setInput("#amazonPushPrice", price);
    setInput("#amazonPushQuantity", quantity);
    setInput("#amazonPushConditionType", "new_new");
    setInput("#amazonPushFulfillmentChannel", "DEFAULT");
    setInput("#amazonPushDescription", "");
    setInput("#amazonPushBulletPoints", "");

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
  }

  function collectPayload() {
    const bulletRaw = readInput("#amazonPushBulletPoints");
    const bulletPoints = bulletRaw
      ? bulletRaw.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    const recommendationMeta = getRecommendationMeta();

    return {
      draftId: readInput("#amazonPushDraftId") || undefined,
      kkProductId: readInput("#amazonPushKkProductId"),
      kkSku: readInput("#amazonPushKkSku"),
      marketplaceId: readInput("#amazonPushMarketplaceId") || "ATVPDKIKX0DER",
      sellerSku: readInput("#amazonPushSellerSku"),
      productType: readInput("#amazonPushProductType"),
      requirements: "LISTING",
      requirementsEnforced: "ENFORCED",
      pushWorkflow: "create_local_draft_only",
      draftPayload: {
        title: readInput("#amazonPushAmazonTitle"),
        brand: readInput("#amazonPushBrand") || "Karry Kraze",
        description: readInput("#amazonPushDescription"),
        bulletPoints,
        price: parsePrice(readInput("#amazonPushPrice")),
        quantity: parseQuantity(readInput("#amazonPushQuantity")),
        conditionType: readInput("#amazonPushConditionType") || "new_new",
        fulfillmentChannel: readInput("#amazonPushFulfillmentChannel") || "DEFAULT",
        productType: readInput("#amazonPushProductType"),
        ...(recommendationMeta ? { amazonProductTypeRecommendation: recommendationMeta } : {}),
      },
    };
  }

  async function persistDraft(action) {
    if (saving) return;

    const payload = collectPayload();
    if (!payload.kkProductId) {
      showAmazonNotification("Select or resolve a KK product before saving a draft.", {
        tone: "warning",
      });
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

      if (action === "save_draft") closeAmazonModals();
    } catch (err) {
      const code = err?.code || "request_failed";
      const messages = {
        product_not_found: "KK product not found.",
        marketplace_not_found: "Marketplace not found.",
        draft_not_found: "Draft not found.",
        invalid_request: "Invalid draft request.",
        unauthorized: "Please sign in as an admin.",
        database_error: "Could not save draft.",
      };
      showAmazonNotification(messages[code] || "Could not save draft.", { tone: "error" });
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
