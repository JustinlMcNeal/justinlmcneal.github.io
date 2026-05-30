import { qs } from "./dom.js";
import {
  saveAmazonDraft,
  getAmazonProductTypeDefinition,
  previewAmazonDraft,
  submitAmazonDraftPreview,
  searchAmazonProductTypes,
} from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { escapeHtml } from "./renderListings.js";

/** @type {boolean} */
let loadingPtd = false;

/** @type {string[]} */
let loadedRequiredAttributes = [];

/** @type {Record<string, unknown> | null} */
let pendingRecommendationMeta = null;

/** @type {{ name: string, displayName: string, source: string } | null} */
let pendingRecommendation = null;

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

function renderAttributeList(id, items, emptyText) {
  const el = qs(id);
  if (!el) return;

  if (!items?.length) {
    el.innerHTML = `<li class="text-gray-400">${emptyText}</li>`;
    return;
  }

  el.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

export function resetPtdPanels() {
  loadedRequiredAttributes = [];
  pendingRecommendationMeta = null;
  pendingRecommendation = null;
  resetProductTypeSearchResults();
  resetProductTypeRecommendation();
  renderAttributeList(
    "#amazonPushRequiredAttributes",
    [],
    "Load product type requirements to preview Amazon fields.",
  );
  renderAttributeList(
    "#amazonPushMissingAttributes",
    [],
    "Preview Amazon requirements to see gaps.",
  );
}

function resetProductTypeRecommendation() {
  const panel = qs("#amazonProductTypeRecommendation");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.innerHTML = "";
}

function readProductTitleForRecommend() {
  const amazonTitle = readInput("#amazonPushAmazonTitle");
  if (amazonTitle) return amazonTitle;
  const titleEl = qs("#amazonPushProductTitle");
  return titleEl?.textContent?.trim() || "";
}

function renderProductTypeRecommendation(recommendation, source) {
  const panel = qs("#amazonProductTypeRecommendation");
  if (!panel || !recommendation?.name) {
    resetProductTypeRecommendation();
    return;
  }

  const sourceLabel = source === "itemName" ? "item name" : "keywords";
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <p class="font-bold text-sky-900">Recommended based on ${escapeHtml(sourceLabel)}: ${escapeHtml(recommendation.displayName || recommendation.name)}</p>
    <p class="text-[10px] font-mono text-gray-600 mt-1">${escapeHtml(recommendation.name)}</p>
    <button
      type="button"
      data-action="accept-amazon-product-type-recommendation"
      data-product-type="${escapeHtml(recommendation.name)}"
      class="mt-2 border-2 border-black bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide min-h-[36px] hover:bg-kkpeach/40"
    >Accept Recommendation</button>
  `;
}

export function getRecommendationMeta() {
  return pendingRecommendationMeta;
}

function resetProductTypeSearchResults() {
  const results = qs("#amazonProductTypeResults");
  if (!results) return;
  results.classList.add("hidden");
  results.innerHTML = "";
}

function renderProductTypeSearchResults(items) {
  const results = qs("#amazonProductTypeResults");
  if (!results) return;

  if (!items?.length) {
    results.classList.remove("hidden");
    results.innerHTML = `<p class="text-xs text-gray-500">No product types found for that keyword.</p>`;
    return;
  }

  results.classList.remove("hidden");
  results.innerHTML = items.map((item) => {
    const name = String(item.name || "");
    const displayName = String(item.displayName || name);
    return `
      <button
        type="button"
        data-action="select-amazon-product-type"
        data-product-type="${escapeHtml(name)}"
        class="w-full text-left border-2 border-black rounded-lg px-3 py-2 bg-white hover:bg-kkpeach/40 min-h-[44px]"
      >
        <span class="block text-xs font-bold">${escapeHtml(displayName)}</span>
        <span class="block text-[10px] font-mono text-gray-500 mt-0.5">${escapeHtml(name)}</span>
      </button>
    `;
  }).join("");
}

export function hydratePtdFromDraft(row) {
  const lastResult = row.last_validation_result && typeof row.last_validation_result === "object"
    ? row.last_validation_result
    : null;

  if (lastResult?.requiredAttributes?.length) {
    loadedRequiredAttributes = lastResult.requiredAttributes;
    renderAttributeList(
      "#amazonPushRequiredAttributes",
      loadedRequiredAttributes,
      "No required attributes returned.",
    );
  } else {
    renderAttributeList(
      "#amazonPushRequiredAttributes",
      [],
      "Load product type requirements to preview Amazon fields.",
    );
  }

  if (lastResult?.missingRequiredAttributes?.length) {
    renderAttributeList("#amazonPushMissingAttributes", lastResult.missingRequiredAttributes, "");
  } else {
    renderAttributeList(
      "#amazonPushMissingAttributes",
      [],
      "Preview Amazon requirements to see gaps.",
    );
  }
}

/**
 * @param {{
 *   collectPayload: () => Record<string, unknown>,
 *   renderValidationPanel: (issues: unknown[]) => void,
 *   onDraftSaved?: () => Promise<void> | void,
 *   isSaving: () => boolean,
 *   setSaving: (value: boolean) => void,
 *   setDraftSubmitMeta?: (meta: Record<string, unknown>) => void,
 *   setPtdPreviewMeta?: (meta: Record<string, unknown>) => void,
 *   updateReadiness?: () => void,
 * }} deps
 */
export function initPushDraftPtd(deps) {
  async function loadProductTypeRequirements(forceRefresh = false) {
    if (loadingPtd) return;

    const productType = readInput("#amazonPushProductType");
    const marketplaceId = readInput("#amazonPushMarketplaceId") || "ATVPDKIKX0DER";

    if (!productType) {
      showAmazonNotification("Enter a product type before loading requirements.", {
        tone: "warning",
      });
      return;
    }

    loadingPtd = true;
    try {
      const result = await getAmazonProductTypeDefinition({
        marketplaceId,
        productType,
        forceRefresh,
      });

      loadedRequiredAttributes = result.requiredAttributes || [];
      renderAttributeList(
        "#amazonPushRequiredAttributes",
        loadedRequiredAttributes,
        "No required attributes returned for this product type.",
      );
      renderAttributeList(
        "#amazonPushMissingAttributes",
        [],
        "Preview Amazon requirements to see gaps.",
      );

      const sourceLabel = result.source === "cache" ? "cached schema" : "Amazon";
      showAmazonNotification(
        `Loaded ${loadedRequiredAttributes.length} required attributes from ${sourceLabel}.`,
        { tone: "success" },
      );
      deps.updateReadiness?.();
    } catch (err) {
      const messages = {
        amazon_not_connected: "Connect Amazon before loading product type requirements.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        ptd_request_failed: "Amazon product type request failed.",
        invalid_request: "Invalid product type request.",
        unauthorized: "Please sign in as an admin.",
      };
      showAmazonNotification(
        messages[err?.code] || "Could not load product type requirements.",
        { tone: "error" },
      );
    } finally {
      loadingPtd = false;
    }
  }

  async function previewAmazonRequirements(forceSchemaRefresh = false) {
    if (deps.isSaving()) return;

    const payload = deps.collectPayload();
    if (!payload.kkProductId) {
      showAmazonNotification("Select or resolve a KK product before previewing.", {
        tone: "warning",
      });
      return;
    }

    if (!payload.productType) {
      showAmazonNotification("Enter a product type before previewing Amazon requirements.", {
        tone: "warning",
      });
      return;
    }

    deps.setSaving(true);
    try {
      let draftId = readInput("#amazonPushDraftId");
      if (!draftId) {
        const saved = await saveAmazonDraft({ ...payload, action: "save_draft" });
        draftId = saved.draftId ? String(saved.draftId) : "";
        if (draftId) setInput("#amazonPushDraftId", draftId);
      }

      if (!draftId) {
        showAmazonNotification("Save the draft before previewing Amazon requirements.", {
          tone: "warning",
        });
        return;
      }

      const result = await previewAmazonDraft({
        draftId,
        forceSchemaRefresh,
      });

      loadedRequiredAttributes = result.requiredAttributes || loadedRequiredAttributes;
      renderAttributeList(
        "#amazonPushRequiredAttributes",
        loadedRequiredAttributes,
        "No required attributes returned.",
      );
      renderAttributeList(
        "#amazonPushMissingAttributes",
        result.missingRequiredAttributes || [],
        "All required Amazon attributes are present in this draft.",
      );
      deps.renderValidationPanel(result.validationErrors || []);

      const statusEl = qs('[data-hydrate="push-review-status"]');
      if (statusEl) {
        statusEl.textContent = String(result.draftStatus || "draft").replace(/_/g, " ");
      }

      const now = new Date().toISOString();
      deps.setPtdPreviewMeta?.({
        previewedAt: now,
        productType: readInput("#amazonPushProductType"),
      });
      deps.setDraftSubmitMeta?.({
        draftStatus: result.draftStatus,
        draftUpdatedAt: now,
        previewValidated: false,
      });

      showAmazonNotification("Amazon requirements preview saved locally.", { tone: "success" });
      await deps.onDraftSaved?.();
    } catch (err) {
      const messages = {
        draft_not_found: "Draft not found. Save the draft and try again.",
        amazon_not_connected: "Connect Amazon before previewing requirements.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        ptd_request_failed: "Amazon product type request failed.",
        invalid_request: "Invalid preview request.",
        unauthorized: "Please sign in as an admin.",
      };
      showAmazonNotification(messages[err?.code] || "Could not preview Amazon requirements.", {
        tone: "error",
      });
    } finally {
      deps.setSaving(false);
    }
  }

  async function previewAmazonSubmit() {
    if (deps.isSaving()) return;

    let draftId = readInput("#amazonPushDraftId");
    if (!draftId) {
      showAmazonNotification("Save the draft before previewing Amazon submit.", {
        tone: "warning",
      });
      return;
    }

    deps.setSaving(true);
    try {
      const result = await submitAmazonDraftPreview(draftId);

      deps.renderValidationPanel(result.validationErrors || []);

      if (result.amazonIssues?.length) {
        renderAttributeList(
          "#amazonPushMissingAttributes",
          result.amazonIssues.map((issue) => issue.field || issue.message),
          "No Amazon preview issues returned.",
        );
      }

      const statusEl = qs('[data-hydrate="push-review-status"]');
      if (statusEl) {
        statusEl.textContent = String(result.draftStatus || "draft").replace(/_/g, " ");
      }

      const statusLabel = String(result.submissionStatus || "UNKNOWN").toUpperCase();
      deps.setDraftSubmitMeta?.({
        draftStatus: result.draftStatus,
        submissionStatus: result.submissionStatus,
        previewValidated: statusLabel === "VALID" || statusLabel === "ACCEPTED",
        draftUpdatedAt: new Date().toISOString(),
        amazonPreviewAt: new Date().toISOString(),
      });
      deps.updateReadiness?.();
      showAmazonNotification(
        `Amazon validation preview: ${statusLabel}. Nothing was published.`,
        { tone: result.submissionStatus === "VALID" ? "success" : "warning" },
      );
      await deps.onDraftSaved?.();
    } catch (err) {
      const messages = {
        draft_not_found: "Draft not found. Save the draft and try again.",
        draft_not_ready: "Fix local and PTD validation errors before Amazon submit preview.",
        validation_preview_disabled: "Amazon validation preview is disabled on the server.",
        amazon_not_connected: "Connect Amazon before previewing submit.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        listing_payload_error: "Could not build Amazon listing payload from this draft.",
        sp_api_validation_failed: "Amazon validation preview request failed.",
        invalid_request: "Invalid submit preview request.",
        unauthorized: "Please sign in as an admin.",
      };
      if (err?.code === "draft_not_ready" && Array.isArray(err?.validationErrors)) {
        deps.renderValidationPanel(err.validationErrors);
      }
      showAmazonNotification(messages[err?.code] || "Could not preview Amazon submit.", {
        tone: "error",
      });
    } finally {
      deps.setSaving(false);
    }
  }

  async function recommendProductType() {
    if (loadingPtd) return;

    const title = readProductTitleForRecommend();
    const marketplaceId = readInput("#amazonPushMarketplaceId") || "ATVPDKIKX0DER";

    if (title.length < 2) {
      showAmazonNotification("Enter a product title before requesting a recommendation.", {
        tone: "warning",
      });
      return;
    }

    loadingPtd = true;
    try {
      const result = await searchAmazonProductTypes({
        marketplaceId,
        query: title,
        source: "itemName",
      });

      pendingRecommendation = result.recommendedProductType
        ? {
          name: String(result.recommendedProductType.name || ""),
          displayName: String(result.recommendedProductType.displayName || result.recommendedProductType.name || ""),
          source: String(result.source || "itemName"),
        }
        : null;

      pendingRecommendationMeta = pendingRecommendation
        ? {
          source: pendingRecommendation.source,
          recommendedProductType: pendingRecommendation.name,
          accepted: false,
          recommendedAt: new Date().toISOString(),
        }
        : null;

      if (pendingRecommendation) {
        renderProductTypeRecommendation(pendingRecommendation, pendingRecommendation.source);
        showAmazonNotification(
          `Recommended product type: ${pendingRecommendation.displayName || pendingRecommendation.name}.`,
          { tone: "success" },
        );
      } else {
        resetProductTypeRecommendation();
        showAmazonNotification("No product type recommendation found for this title.", {
          tone: "warning",
        });
      }
    } catch (err) {
      resetProductTypeRecommendation();
      const messages = {
        amazon_not_connected: "Connect Amazon before recommending product types.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        ptd_request_failed: "Amazon product type recommendation failed.",
        invalid_request: "Enter a valid product title.",
        unauthorized: "Please sign in as an admin.",
      };
      showAmazonNotification(messages[err?.code] || "Could not recommend product type.", {
        tone: "error",
      });
    } finally {
      loadingPtd = false;
    }
  }

  function acceptProductTypeRecommendation(productType) {
    if (!productType) return;
    selectProductType(productType);
    if (pendingRecommendationMeta) {
      pendingRecommendationMeta = {
        ...pendingRecommendationMeta,
        accepted: true,
        recommendedAt: new Date().toISOString(),
      };
    }
    resetProductTypeRecommendation();
    showAmazonNotification(`Accepted product type ${productType}. Load requirements next.`, {
      tone: "success",
    });
    deps.updateReadiness?.();
  }

  async function searchProductTypes() {
    if (loadingPtd) return;

    const query = readInput("#amazonProductTypeSearch");
    const marketplaceId = readInput("#amazonPushMarketplaceId") || "ATVPDKIKX0DER";

    if (query.length < 2) {
      showAmazonNotification("Enter at least 2 characters to search product types.", {
        tone: "warning",
      });
      return;
    }

    loadingPtd = true;
    try {
      const result = await searchAmazonProductTypes({
        marketplaceId,
        query,
      });
      renderProductTypeSearchResults(result.productTypes || []);
      showAmazonNotification(
        `Found ${result.productTypes?.length || 0} product type suggestion(s).`,
        { tone: "success" },
      );
    } catch (err) {
      const messages = {
        amazon_not_connected: "Connect Amazon before searching product types.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        ptd_request_failed: "Amazon product type search failed.",
        invalid_request: "Enter a valid search keyword.",
        unauthorized: "Please sign in as an admin.",
      };
      renderProductTypeSearchResults([]);
      showAmazonNotification(messages[err?.code] || "Could not search product types.", {
        tone: "error",
      });
    } finally {
      loadingPtd = false;
    }
  }

  function selectProductType(productType) {
    if (!productType) return;
    setInput("#amazonPushProductType", productType);
    showAmazonNotification(`Product type set to ${productType}.`, { tone: "success" });
    deps.updateReadiness?.();
  }

  return {
    loadProductTypeRequirements,
    previewAmazonRequirements,
    previewAmazonSubmit,
    searchProductTypes,
    recommendProductType,
    acceptProductTypeRecommendation,
    selectProductType,
    resetProductTypeSearchResults,
    getRecommendationMeta,
  };
}
