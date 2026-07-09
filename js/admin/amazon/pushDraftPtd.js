import { qs } from "./dom.js";
import { shouldHydrateSuggestedAsin } from "./pushDraftWorkflow.js";
import {
  saveAmazonDraft,
  getAmazonProductTypeDefinition,
  previewAmazonDraft,
  submitAmazonDraftPreview,
  searchAmazonProductTypes,
} from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { escapeHtml } from "./renderListings.js";
import {
  applyExtraAttributeDefaults,
  AMAZON_EXTENDED_ATTRIBUTE_HINTS,
  getExtendedAttributeHints,
  renderExtraAttributeFields,
  resetExtraAttributeFields,
  resolveFieldMeta,
  filterFormAttributeNames,
  filterAttributesForVariationRole,
  readExtraAttributesFromForm,
  stripInvalidPushPayloadAttributes,
} from "./pushDraftAttributes.js";
import { readVariationRole } from "./variationFamily.js";

/** @type {boolean} */
let loadingPtd = false;

/** @type {string[]} */
let loadedRequiredAttributes = [];

/** @type {string[]} */
let loadedRecommendedAttributes = [];

/** @type {string[]} Fields Amazon submit preview reported as missing (kept across Load Requirements). */
let discoveredAmazonAttributes = [];

/** @type {Record<string, string[]>} */
let loadedAttributeEnums = {};

/** @type {Record<string, unknown> | null} */
let pendingRecommendationMeta = null;

/** @type {{ name: string, displayName: string, source: string } | null} */
let pendingRecommendation = null;

const PTD_ERROR_MESSAGES = {
  amazon_not_connected: "Connect Amazon before loading product type requirements.",
  token_missing: "Amazon token missing. Reconnect Seller Central.",
  token_refresh_failed: "Could not refresh Amazon token. Reconnect Seller Central.",
  aws_assume_role_failed: "AWS role assumption failed. Check AMAZON_IAM_ROLE_ARN and STS policy.",
  server_misconfigured: "Amazon SP-API signing is not configured on the server.",
  ptd_request_failed: "Amazon product type request failed.",
  invalid_product_type: "Product type not found on Amazon. Use Recommend or Search Product Type.",
  invalid_request: "Invalid request. Save the draft with a product type first.",
  missing_kk_product_id: "KK product is missing on this draft. Re-open Push to Amazon from Ready to Push.",
  missing_marketplace_id: "Marketplace is missing on this draft.",
  missing_title: "Amazon title is required before preview submit.",
  variant_product_mismatch: "Selected variant does not belong to this product. Re-select the color variant.",
  parent_cannot_have_variant: "Parent listings cannot include a variant ID.",
  parent_draft_not_found: "Parent draft link not found. Re-open the push modal or clear parent draft ID.",
  parent_draft_not_parent_role: "Linked draft is not a variation parent. Use KK-XXXX-PARENT as parent SKU.",
  parent_draft_self_reference: "Parent draft link pointed at this child draft. Hard refresh and save again.",
  parent_cannot_have_variant: "Parent listings cannot include a variant ID. Use Push Parent from Ready to Push.",
  draft_not_found: "Draft not found. Save the draft and try again.",
  rate_limited: "Amazon rate limited this request. Wait a moment and try again.",
  sp_api_unavailable: "Amazon SP-API is temporarily unavailable. Try again shortly.",
  sigv4_failed_or_permission_denied: "AWS signing failed or SP-API permission denied. Check IAM role and keys.",
  sigv4_may_be_required: "SP-API requires AWS SigV4 signing. Check server AWS credentials.",
  unauthorized: "Please sign in as an admin.",
  unexpected_error: "Unexpected server error while loading product type requirements.",
  database_error: "Could not load product type requirements from the database.",
};

/** @param {{ code?: string, hint?: string, reason?: string }} err */
function ptdErrorMessage(err, fallback) {
  const code = err?.reason || err?.code;
  const base = PTD_ERROR_MESSAGES[code] || PTD_ERROR_MESSAGES[err?.code] || fallback;
  const hint = typeof err?.hint === "string" && err.hint.trim() ? err.hint.trim() : "";
  return hint ? `${base} (${hint})` : base;
}

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

function readCurrentProductType() {
  const el = qs("#amazonPushProductType");
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return "";
}

function extendedAttributeHints() {
  return getExtendedAttributeHints(readCurrentProductType());
}

function mergeAttributeNames(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

/** @param {Array<{ severity?: string, field?: string, message?: string }>} [issues] */
function extractAmazonIssueFields(issues = []) {
  const productType = readCurrentProductType();
  return filterFormAttributeNames(
    mergeAttributeNames(
      issues
        .filter((issue) => issue?.severity === "error" && issue?.field)
        .map((issue) => String(issue.field)),
    ),
    productType,
  );
}

function buildAttributeFormNames() {
  const productType = readCurrentProductType();
  return filterAttributesForVariationRole(
    filterFormAttributeNames(
      mergeAttributeNames(
        loadedRequiredAttributes,
        loadedRecommendedAttributes,
        discoveredAmazonAttributes,
        extendedAttributeHints(),
      ),
      productType,
    ),
    readVariationRole(),
  );
}

function syncExtraAttributeFields(draftPayload) {
  const names = buildAttributeFormNames();
  renderExtraAttributeFields(names, draftPayload, readAttributeRenderOptions());
  applyExtraAttributeDefaults(names, readAttributeRenderOptions());
}

function renderRequiredAttributesPanel() {
  const productType = readCurrentProductType();
  const displayNames = filterFormAttributeNames(
    mergeAttributeNames(
      loadedRequiredAttributes,
      discoveredAmazonAttributes.filter((name) => !loadedRequiredAttributes.includes(name)),
    ),
    productType,
  );
  renderAttributeList(
    "#amazonPushRequiredAttributes",
    displayNames,
    "Load product type requirements to preview Amazon fields.",
  );
}

function renderMissingAmazonAttributes(issues) {
  if (!issues?.length) {
    renderAttributeList(
      "#amazonPushMissingAttributes",
      [],
      "Preview Amazon requirements to see gaps.",
    );
    return;
  }

  const productType = readCurrentProductType();
  const fields = issues
    .filter((issue) => issue?.severity === "error")
    .map((issue) => issue.field || issue.message)
    .filter(Boolean);

  const displayFields = filterFormAttributeNames(
    fields.length ? fields : issues.map((issue) => issue.field || issue.message).filter(Boolean),
    productType,
  );

  renderAttributeList(
    "#amazonPushMissingAttributes",
    displayFields,
    "No Amazon preview issues returned.",
  );
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

function readAttributeRenderOptions() {
  return {
    productType: readCurrentProductType(),
    attributeEnums: loadedAttributeEnums,
  };
}

export function resetPtdPanels() {
  loadedRequiredAttributes = [];
  loadedRecommendedAttributes = [];
  discoveredAmazonAttributes = [];
  loadedAttributeEnums = {};
  pendingRecommendationMeta = null;
  pendingRecommendation = null;
  resetProductTypeSearchResults();
  resetProductTypeRecommendation();
  resetExtraAttributeFields();
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

export function getLoadedRequiredAttributes() {
  return [...loadedRequiredAttributes];
}

export function getLoadedAttributeNames() {
  return buildAttributeFormNames();
}

export function getLoadedAttributeEnums() {
  return { ...loadedAttributeEnums };
}

/** @type {() => Promise<{ ok: boolean, reason?: string, productType?: string, requiredAttributes?: string[], attributeNames?: string[] }>} */
let prepareForAiAutofillImpl = async () => ({ ok: false, reason: "not_initialized" });

/** Load PTD (if needed), render attribute inputs, and return names for AI autofill. */
export async function prepareForAiAutofill() {
  return prepareForAiAutofillImpl();
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
  }
  if (lastResult?.recommendedAttributes?.length) {
    loadedRecommendedAttributes = lastResult.recommendedAttributes;
  }
  if (lastResult?.amazonIssues?.length) {
    discoveredAmazonAttributes = extractAmazonIssueFields(lastResult.amazonIssues);
  }
  if (lastResult?.missingRequiredAttributes?.length) {
    discoveredAmazonAttributes = mergeAttributeNames(
      discoveredAmazonAttributes,
      lastResult.missingRequiredAttributes,
    );
  }

  renderRequiredAttributesPanel();

  if (lastResult?.amazonIssues?.length) {
    renderMissingAmazonAttributes(lastResult.amazonIssues);
  } else if (lastResult?.missingRequiredAttributes?.length) {
    renderAttributeList(
      "#amazonPushMissingAttributes",
      filterFormAttributeNames(lastResult.missingRequiredAttributes, readCurrentProductType()),
      "",
    );
  } else {
    renderAttributeList(
      "#amazonPushMissingAttributes",
      [],
      "Preview Amazon requirements to see gaps.",
    );
  }

  const attributeNames = filterFormAttributeNames(
    mergeAttributeNames(
      lastResult?.requiredAttributes,
      lastResult?.recommendedAttributes,
      lastResult?.missingRequiredAttributes,
      lastResult?.amazonIssues?.map((issue) => issue.field),
      discoveredAmazonAttributes,
      extendedAttributeHints(),
    ),
    readCurrentProductType(),
  );
  if (attributeNames.length) {
    const basePayload = row.draft_payload && typeof row.draft_payload === "object"
      ? row.draft_payload
      : {};
    const offerWorkflow = shouldHydrateSuggestedAsin(row.push_workflow, row.requirements);
    const draftPayload = stripInvalidPushPayloadAttributes({
      ...basePayload,
      merchant_suggested_asin: offerWorkflow
        ? (basePayload.merchant_suggested_asin || row.matched_asin || row.asin || "")
        : (basePayload.merchant_suggested_asin || ""),
    });
    if (!draftPayload.merchant_suggested_asin) delete draftPayload.merchant_suggested_asin;
    renderExtraAttributeFields(attributeNames, draftPayload, readAttributeRenderOptions());
    applyExtraAttributeDefaults(attributeNames, readAttributeRenderOptions());
  }
}

/**
 * @param {{
 *   collectPayload: () => Record<string, unknown>,
 *   validateCollectPayload?: (payload: Record<string, unknown>) => Array<{ field: string, message: string }>,
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
  async function ensureDraftSaved() {
    const payload = deps.collectPayload();
    const localIssues = deps.validateCollectPayload?.(payload) || [];
    if (localIssues.length) {
      const err = new Error("invalid_request");
      err.code = "invalid_request";
      err.validationErrors = localIssues.map((issue) => ({
        field: issue.field,
        severity: "error",
        message: issue.message,
      }));
      throw err;
    }
    const saved = await saveAmazonDraft({ ...payload, action: "save_draft" });
    const draftId = saved.draftId ? String(saved.draftId) : readInput("#amazonPushDraftId");
    if (draftId) setInput("#amazonPushDraftId", draftId);
    if (saved.draftStatus) setInput("#amazonPushDraftStatus", String(saved.draftStatus));
    const now = new Date().toISOString();
    deps.setDraftSubmitMeta?.({
      draftStatus: saved.draftStatus,
      draftUpdatedAt: now,
      previewValidated: false,
    });
    return draftId;
  }

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
      loadedRecommendedAttributes = result.recommendedAttributes || [];
      loadedAttributeEnums = result.attributeEnums && typeof result.attributeEnums === "object"
        ? result.attributeEnums
        : {};
      renderRequiredAttributesPanel();
      if (!discoveredAmazonAttributes.length) {
        renderAttributeList(
          "#amazonPushMissingAttributes",
          [],
          "Preview Amazon requirements to see gaps.",
        );
      }
      syncExtraAttributeFields(deps.collectPayload().draftPayload);

      const sourceLabel = result.source === "cache" ? "cached schema" : "Amazon";
      showAmazonNotification(
        `Loaded ${loadedRequiredAttributes.length} core required attribute(s) from ${sourceLabel}. Use Preview Amazon Submit for conditional gaps.`,
        { tone: "success" },
      );
      deps.updateReadiness?.();
      deps.updateComplianceWarnings?.();
    } catch (err) {
      showAmazonNotification(
        ptdErrorMessage(err, "Could not load product type requirements."),
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
      const draftId = await ensureDraftSaved();
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
      if (result.recommendedAttributes?.length) {
        loadedRecommendedAttributes = result.recommendedAttributes;
      }
      if (result.missingRequiredAttributes?.length) {
        discoveredAmazonAttributes = mergeAttributeNames(
          discoveredAmazonAttributes,
          result.missingRequiredAttributes,
        );
      }
      renderRequiredAttributesPanel();
      renderAttributeList(
        "#amazonPushMissingAttributes",
        filterFormAttributeNames(result.missingRequiredAttributes || [], readCurrentProductType()),
        "All required Amazon attributes are present in this draft.",
      );
      syncExtraAttributeFields(deps.collectPayload().draftPayload);
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
      setInput("#amazonPushDraftStatus", String(result.draftStatus || ""));

      showAmazonNotification("Amazon requirements preview saved locally.", { tone: "success" });
      await deps.onDraftSaved?.();
    } catch (err) {
      if (Array.isArray(err?.validationErrors) && err.validationErrors.length) {
        deps.renderValidationPanel(err.validationErrors, { showAll: true });
      }
      showAmazonNotification(
        ptdErrorMessage(err, "Could not preview Amazon requirements."),
        { tone: "error" },
      );
    } finally {
      deps.setSaving(false);
    }
  }

  async function previewAmazonSubmit() {
    if (deps.isSaving()) return;

    deps.setSaving(true);
    try {
      const draftId = await ensureDraftSaved();
      if (!draftId) {
        showAmazonNotification("Save the draft before previewing Amazon submit.", {
          tone: "warning",
        });
        return;
      }

      const result = await submitAmazonDraftPreview(draftId);

      deps.renderValidationPanel(result.validationErrors || []);

      if (result.amazonIssues?.length) {
        const issueFields = extractAmazonIssueFields(result.amazonIssues);
        discoveredAmazonAttributes = mergeAttributeNames(
          discoveredAmazonAttributes,
          issueFields,
        );
        renderRequiredAttributesPanel();
        renderMissingAmazonAttributes(result.amazonIssues);
        syncExtraAttributeFields(deps.collectPayload().draftPayload);
      } else {
        renderAttributeList(
          "#amazonPushMissingAttributes",
          [],
          "All required Amazon attributes are present in this draft.",
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
        statusLabel === "VALID" || statusLabel === "ACCEPTED"
          ? `Amazon validation preview: ${statusLabel}. Nothing was published.`
          : `Amazon validation preview: ${statusLabel}. Fix remaining fields and preview again.`,
        { tone: result.submissionStatus === "VALID" ? "success" : "warning" },
      );
      await deps.onDraftSaved?.();
    } catch (err) {
      if (Array.isArray(err?.validationErrors) && err.validationErrors.length) {
        deps.renderValidationPanel(err.validationErrors, { showAll: true });
      }
      const messages = {
        draft_not_found: "Draft not found. Save the draft and try again.",
        draft_not_ready: "Fix local and PTD validation errors before Amazon submit preview.",
        validation_preview_disabled: "Amazon validation preview is disabled. Set AMAZON_ENABLE_VALIDATION_PREVIEW=true in Supabase secrets.",
        amazon_not_connected: "Connect Amazon before previewing submit.",
        token_missing: "Amazon token missing. Reconnect Seller Central.",
        token_refresh_failed: "Could not refresh Amazon token.",
        listing_payload_error: "Could not build Amazon listing payload from this draft.",
        sp_api_validation_failed: "Amazon validation preview request failed.",
        sync_push_issues_failed: "Amazon preview succeeded but issue sync failed.",
        unexpected_error: "Unexpected server error during Amazon submit preview.",
        database_error: "Could not save Amazon preview results.",
        invalid_request: "Invalid submit preview request.",
        unauthorized: "Please sign in as an admin.",
      };
      if (Array.isArray(err?.validationErrors) && err.validationErrors.length) {
        deps.renderValidationPanel(err.validationErrors, { showAll: true });
        renderMissingAmazonAttributes(err.validationErrors);
      }
      const blocking = Array.isArray(err?.validationErrors)
        ? err.validationErrors.filter((issue) => issue?.severity === "error")
        : [];
      const summary = blocking.length
        ? blocking.slice(0, 3).map((issue) => issue.message).join(" ")
        : "";
      showAmazonNotification(
        summary || ptdErrorMessage(err, messages[err?.code] || "Could not preview Amazon submit."),
        { tone: "error" },
      );
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
    deps.updateComplianceWarnings?.();
  }

  prepareForAiAutofillImpl = async () => {
    let productType = readInput("#amazonPushProductType");

    if (!productType) {
      try {
        await recommendProductType();
      } catch {
        // Offer-only path: still fill core copy + extended hints without Amazon PTD.
      }
      if (pendingRecommendation?.name) {
        acceptProductTypeRecommendation(pendingRecommendation.name);
        productType = pendingRecommendation.name;
      }
    }

    if (productType && !loadedRequiredAttributes.length) {
      try {
        await loadProductTypeRequirements(false);
      } catch {
        // Continue with extended hints if PTD load fails (e.g. Amazon disconnected).
      }
    }

    const attributeNames = buildAttributeFormNames();
    const basePayload = deps.collectPayload().draftPayload || {};
    const formExtras = readExtraAttributesFromForm();
    const mergedPayload = { ...basePayload, ...formExtras };
    renderExtraAttributeFields(attributeNames, mergedPayload, readAttributeRenderOptions());
    applyExtraAttributeDefaults(attributeNames, readAttributeRenderOptions());

    if (!productType) {
      return { ok: false, reason: "missing_product_type", attributeNames, attributeEnums: loadedAttributeEnums };
    }

    return {
      ok: true,
      productType,
      requiredAttributes: [...loadedRequiredAttributes],
      attributeNames,
      attributeEnums: loadedAttributeEnums,
    };
  };

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
