/**
 * Mapping assist wizard modal (Phase 8C).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import {
  fetchMappingSuggestionForSource,
  searchProductsForMappingAssist,
  fetchProductVariantsForMappingAssist,
  applyMappingAssist,
} from "../api/mappingAssistApi.js";
import { buildLineItemsOrdersUrl, channelFromOrderId } from "../constants/orderLinks.js";
import { markIssueReviewed } from "../api/issueStateApi.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";
import { showInventoryToast } from "../events.js";
import { findIssueByType } from "../state.js";
import { showPostMappingChecklist } from "./postMappingChecklistModal.js";
import { mappingActionIdsFromSingleApply } from "../api/postMappingWorkflowApi.js";

/** @typedef {import('../api/mappingAssistApi.js').MappingSuggestionRow} MappingSuggestionRow */

const CONFIDENCE_BADGE = {
  high: "bg-green-100 text-green-900 border-green-300",
  medium: "bg-amber-100 text-amber-900 border-amber-300",
  low: "bg-gray-100 text-gray-700 border-gray-300",
};

/** @type {{ issueType: string, sourceOrderId: string|null, sourceOrderItemId: string|null, parentIssue: import('../state.js').InventoryIssueRow|null, fromShippedAudit: boolean, onComplete: (() => void)|null }} */
let context = {
  issueType: "",
  sourceOrderId: null,
  sourceOrderItemId: null,
  parentIssue: null,
  fromShippedAudit: false,
  onComplete: null,
};

/** @type {MappingSuggestionRow|null} */
let suggestion = null;

/** @type {{ productId: string, variantId: string, productLabel: string, variantLabel: string, confidence: string|null }} */
let selection = {
  productId: "",
  variantId: "",
  productLabel: "",
  variantLabel: "",
  confidence: null,
};

function closeModal() {
  const mount = getDom().mappingAssistModalMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
}

function confidenceBadge(level) {
  const key = String(level || "low").toLowerCase();
  const cls = CONFIDENCE_BADGE[key] || CONFIDENCE_BADGE.low;
  return `<span class="text-[9px] font-black uppercase border px-1.5 py-0.5 rounded ${cls}">${esc(key)}</span>`;
}

function impactCopy(issueType) {
  if (issueType === "amazon_mapping_missing") {
    return "This creates/updates a local Amazon listing mapping only. It does not push Amazon quantity or change listing data remotely.";
  }
  return "This sets variant_id on the order line only. It does not change stock or create reservations for historical orders.";
}

function ebayEvidenceHtml(s) {
  if (!s || s.sourceChannel !== "ebay") return "";
  const rows = [];
  if (s.evidenceEbaySku) rows.push(`<li><strong>eBay SKU:</strong> ${esc(s.evidenceEbaySku)}</li>`);
  if (s.evidenceEbayListingId) rows.push(`<li><strong>Listing ID:</strong> ${esc(s.evidenceEbayListingId)}</li>`);
  if (s.evidenceEbayOfferId) rows.push(`<li><strong>Offer ID:</strong> ${esc(s.evidenceEbayOfferId)}</li>`);
  if (s.evidenceProductCode) rows.push(`<li><strong>Product code:</strong> ${esc(s.evidenceProductCode)}</li>`);
  if (s.evidenceVariantSuffix) rows.push(`<li><strong>Buyer variation:</strong> ${esc(s.evidenceVariantSuffix)}</li>`);
  if (s.evidenceEbayStatus) rows.push(`<li><strong>Listing status:</strong> ${esc(s.evidenceEbayStatus)}</li>`);
  if (s.evidenceEbayCacheQty != null) rows.push(`<li><strong>Cache qty:</strong> ${s.evidenceEbayCacheQty}</li>`);
  const groups = [];
  if (s.groupSkuCount > 1) groups.push(`same SKU ×${s.groupSkuCount}`);
  if (s.groupTitleCount > 1) groups.push(`same title ×${s.groupTitleCount}`);
  if (s.groupListingCount > 1) groups.push(`same listing ×${s.groupListingCount}`);
  if (!rows.length && !groups.length) return "";
  return `
    <div class="border border-violet-200 bg-violet-50/80 rounded-lg p-3 text-xs space-y-1">
      <p class="font-black uppercase text-[10px] text-violet-900">eBay mapping evidence</p>
      ${rows.length ? `<ul class="text-violet-950 space-y-0.5 list-disc pl-4">${rows.join("")}</ul>` : ""}
      ${groups.length ? `<p class="text-[10px] text-violet-800">Repeated unmapped pattern: ${esc(groups.join(" · "))}</p>` : ""}
    </div>`;
}

function suggestionBlockHtml(s) {
  if (!s) {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">No automatic suggestion — search and select product/variant manually.</p>`;
  }
  if (s.suggestedProductId && s.variantPickRequired && !s.suggestedVariantId) {
    return `
      <div class="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-black uppercase text-[10px] text-amber-900">Product match</span>
          ${confidenceBadge(s.confidence)}
          ${s.matchType ? `<span class="text-[10px] font-mono text-amber-800">${esc(s.matchType)}</span>` : ""}
        </div>
        <p class="font-bold">${esc(s.suggestedProductLabel || "Product")}</p>
        <p class="text-amber-900">${esc(s.confidenceReason || "")}</p>
        <p class="text-[10px] text-amber-800 font-bold">Select the correct variant below — suggestion is not auto-applied.</p>
      </div>`;
  }
  if (s.suggestedVariantId) {
    return `
      <div class="border border-teal-200 bg-teal-50 rounded-lg p-3 text-xs space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-black uppercase text-[10px] text-teal-900">Suggested match</span>
          ${confidenceBadge(s.confidence)}
          ${s.matchType ? `<span class="text-[10px] font-mono text-teal-800">${esc(s.matchType)}</span>` : ""}
        </div>
        <p class="font-bold">${esc(s.suggestedProductLabel || "Product")} · ${esc(s.suggestedInternalSku || "SKU")}</p>
        <p class="text-teal-800">${esc(s.confidenceReason || "")}</p>
        ${s.isSafeAutoApply ? `<p class="text-[10px] text-teal-700">High-confidence match — still requires your confirmation.</p>` : ""}
        ${s.matchType === "title_similarity" ? `<p class="text-[10px] text-amber-800 font-bold">Title-only suggestion; confirm carefully.</p>` : ""}
      </div>`;
  }
  return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">No automatic suggestion — search and select product/variant manually.</p>`;
}

/**
 * @param {import('../state.js').InventoryIssueRow|null} parentIssue
 * @param {Object} source
 * @param {string} source.issueType
 * @param {string|null} [source.sourceOrderId]
 * @param {string|null} [source.sourceOrderItemId]
 * @param {{ fromShippedAudit?: boolean, onComplete?: () => void }} [opts]
 */
export async function openMappingAssistModal(parentIssue, source, opts = {}) {
  const mount = getDom().mappingAssistModalMount;
  if (!mount) return;

  context = {
    issueType: source.issueType,
    sourceOrderId: source.sourceOrderId ?? null,
    sourceOrderItemId: source.sourceOrderItemId ?? null,
    parentIssue,
    fromShippedAudit: Boolean(opts.fromShippedAudit),
    onComplete: opts.onComplete ?? null,
  };

  document.body.classList.add("overflow-hidden");
  mount.innerHTML = `
    <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" class="absolute inset-0 bg-black/50" data-mapping-assist-close aria-label="Close"></button>
      <div class="relative bg-white w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl p-4 space-y-3">
        <p class="text-xs text-gray-500" role="status">Loading mapping assist…</p>
      </div>
    </div>`;

  mount.querySelectorAll("[data-mapping-assist-close]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  try {
    suggestion = await fetchMappingSuggestionForSource(
      source.issueType,
      source.sourceOrderId || "",
      source.sourceOrderItemId || "",
    );
  } catch {
    suggestion = null;
  }

  if (suggestion?.suggestedProductId && suggestion?.suggestedVariantId && !suggestion.variantPickRequired) {
    selection = {
      productId: suggestion.suggestedProductId,
      variantId: suggestion.suggestedVariantId,
      productLabel: suggestion.suggestedProductLabel || "",
      variantLabel: suggestion.suggestedInternalSku || "",
      confidence: suggestion.confidence,
    };
  } else if (suggestion?.suggestedProductId && suggestion.variantPickRequired) {
    selection = {
      productId: suggestion.suggestedProductId,
      variantId: "",
      productLabel: suggestion.suggestedProductLabel || "",
      variantLabel: "",
      confidence: suggestion.confidence,
    };
  } else {
    selection = { productId: "", variantId: "", productLabel: "", variantLabel: "", confidence: null };
  }

  renderModal();
}

function renderModal() {
  const mount = getDom().mappingAssistModalMount;
  const panel = mount?.querySelector(".relative");
  if (!panel) return;

  const s = suggestion;
  const isAmazon = context.issueType === "amazon_mapping_missing";
  const isEbay = s?.sourceChannel === "ebay";

  const orderLineLink =
    context.sourceOrderId
      ? `<a href="${esc(
          buildLineItemsOrdersUrl({
            sessionId: context.sourceOrderId,
            lineId: context.sourceOrderItemId || undefined,
            channel: channelFromOrderId(context.sourceOrderId) || undefined,
            tab: "overview",
          }),
        )}" target="_blank" rel="noopener" class="inline-block mt-2 text-[10px] font-black uppercase text-indigo-800 hover:underline">Open Order Line →</a>`
      : "";

  panel.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Mapping Assist</p>
        <h2 class="text-lg font-black">${isAmazon ? "Amazon Variant Mapping" : isEbay ? "eBay Order Line Mapping" : "Unmapped Order Line"}</h2>
      </div>
      <button type="button" data-mapping-assist-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Cancel</button>
    </div>

    <div class="border border-gray-200 rounded-lg p-3 text-xs space-y-1 bg-gray-50">
      <p><strong>Channel:</strong> ${esc(s?.sourceChannel || "—")}</p>
      ${s?.sourceSku ? `<p><strong>SKU:</strong> ${esc(s.sourceSku)}</p>` : ""}
      ${s?.sourceTitle ? `<p><strong>Title:</strong> ${esc(s.sourceTitle)}</p>` : ""}
      ${s?.sourceAsin ? `<p><strong>ASIN:</strong> ${esc(s.sourceAsin)}</p>` : ""}
      ${s?.sourceListingId ? `<p><strong>Listing ref:</strong> ${esc(s.sourceListingId)}</p>` : ""}
      ${s?.sourceReason ? `<p class="text-gray-500">${esc(s.sourceReason)} · ${esc(s.recommendedAction || "")}</p>` : ""}
      ${orderLineLink}
    </div>

    ${ebayEvidenceHtml(s)}

    ${
      isEbay
        ? `<button type="button" id="mappingAssistEbayWorklistBtn" class="w-full border-2 border-violet-600 text-violet-900 px-3 py-1.5 text-[10px] font-black uppercase min-h-[40px]">
      Open eBay Mapping Worklist
    </button>`
        : ""
    }

    ${suggestionBlockHtml(s)}

    <div class="space-y-2">
      <label class="block text-[10px] font-black uppercase text-gray-500" for="mappingAssistProductSearch">Search KK products</label>
      <input id="mappingAssistProductSearch" type="search" placeholder="Name or product code…" class="w-full border-2 border-black px-3 py-2 text-sm" />
      <div id="mappingAssistSearchResults" class="max-h-28 overflow-y-auto space-y-1"></div>
    </div>

    <div id="mappingAssistVariantPanel" class="space-y-1"></div>

    <div class="border border-orange-200 bg-orange-50 rounded-lg p-3 text-[11px] text-orange-950 space-y-1">
      <p><strong>Impact:</strong> ${impactCopy(context.issueType)}</p>
      <p>Future orders can reserve/deduct correctly after mapping. Historical lines may still need separate review.</p>
    </div>

    <div class="flex flex-wrap gap-2 pt-1">
      <button type="button" id="mappingAssistConfirmBtn" class="border-2 border-black bg-black text-white px-4 py-2 text-xs font-black uppercase min-h-[44px]" disabled>
        Confirm Mapping
      </button>
      <button type="button" data-mapping-assist-close class="border-2 border-gray-400 px-4 py-2 text-xs font-black uppercase min-h-[44px]">Cancel</button>
    </div>`;

  panel.querySelector("#mappingAssistEbayWorklistBtn")?.addEventListener("click", () => {
    closeModal();
    import("./ebayMappingWorklistModal.js").then((mod) => mod.openEbayMappingWorklistModal());
  });

  panel.querySelectorAll("[data-mapping-assist-close]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  const search = panel.querySelector("#mappingAssistProductSearch");
  search?.addEventListener("input", () => {
    void runProductSearch(search.value);
  });

  panel.querySelector("#mappingAssistConfirmBtn")?.addEventListener("click", () => {
    void confirmMapping();
  });

  if (selection.productId) void loadVariants(selection.productId);
  updateConfirmState();
}

async function runProductSearch(query) {
  const mount = getDom().mappingAssistModalMount;
  const resultsEl = mount?.querySelector("#mappingAssistSearchResults");
  if (!resultsEl) return;

  if (String(query || "").trim().length < 2) {
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.innerHTML = `<p class="text-xs text-gray-400">Searching…</p>`;
  try {
    const rows = await searchProductsForMappingAssist(query);
    if (!rows.length) {
      resultsEl.innerHTML = `<p class="text-xs text-gray-400">No products found.</p>`;
      return;
    }
    resultsEl.innerHTML = rows
      .map(
        (p) => `
      <button type="button" data-mapping-assist-product="${esc(p.id)}" data-product-label="${esc(p.name)}" class="w-full text-left border border-gray-200 rounded px-2 py-1.5 text-xs hover:bg-gray-50">
        <span class="font-bold">${esc(p.name)}</span>
        <span class="block text-gray-500 font-mono">${esc(p.code)}</span>
      </button>`,
      )
      .join("");

    resultsEl.querySelectorAll("[data-mapping-assist-product]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selection.productId = btn.getAttribute("data-mapping-assist-product") || "";
        selection.productLabel = btn.getAttribute("data-product-label") || "";
        selection.variantId = "";
        selection.variantLabel = "";
        selection.confidence = "manual";
        void loadVariants(selection.productId);
      });
    });
  } catch (err) {
    resultsEl.innerHTML = `<p class="text-xs text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

async function loadVariants(productId) {
  const mount = getDom().mappingAssistModalMount;
  const panel = mount?.querySelector("#mappingAssistVariantPanel");
  if (!panel || !productId) return;

  panel.innerHTML = `<p class="text-xs text-gray-400">Loading variants…</p>`;
  try {
    const variants = await fetchProductVariantsForMappingAssist(productId);
    if (!variants.length) {
      panel.innerHTML = `<p class="text-xs text-amber-700">No active variants on this product.</p>`;
      selection.variantId = "";
      updateConfirmState();
      return;
    }

    if (variants.length === 1 && !selection.variantId && !suggestion?.variantPickRequired) {
      selection.variantId = variants[0].id;
      selection.variantLabel = variants[0].label;
      if (!selection.confidence) selection.confidence = "manual";
    }

    panel.innerHTML = `
      <p class="text-[10px] font-black uppercase text-gray-500">Select variant</p>
      <div class="space-y-1 max-h-36 overflow-y-auto">
        ${variants
          .map((v) => {
            const selected = selection.variantId === v.id;
            return `
            <label class="flex items-center gap-2 border rounded px-2 py-1.5 text-xs cursor-pointer ${selected ? "border-black bg-gray-50" : "border-gray-200"}">
              <input type="radio" name="mappingAssistVariant" value="${esc(v.id)}" ${selected ? "checked" : ""} />
              <span><strong>${esc(v.label)}</strong> ${v.sku ? `<span class="font-mono text-gray-500">${esc(v.sku)}</span>` : ""} · stock ${v.stock}</span>
            </label>`;
          })
          .join("")}
      </div>`;

    panel.querySelectorAll('input[name="mappingAssistVariant"]').forEach((input) => {
      input.addEventListener("change", () => {
        const v = variants.find((row) => row.id === input.value);
        selection.variantId = input.value;
        selection.variantLabel = v?.label || "";
        selection.confidence = "manual";
        updateConfirmState();
      });
    });

    updateConfirmState();
  } catch (err) {
    panel.innerHTML = `<p class="text-xs text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

function updateConfirmState() {
  const btn = getDom().mappingAssistModalMount?.querySelector("#mappingAssistConfirmBtn");
  if (!btn) return;
  const ready = Boolean(selection.variantId);
  btn.toggleAttribute("disabled", !ready);
}

async function confirmMapping() {
  if (!selection.variantId) return;

  const isAmazon = context.issueType === "amazon_mapping_missing";
  // source_listing_id is eBay item id for KK lines — only pass for Amazon RPC param (uuid).
  const amazonListingId = isAmazon ? suggestion?.sourceListingId || null : null;

  if (isAmazon && !amazonListingId) {
    showInventoryToast("Amazon listing id is required for this mapping.", { variant: "error" });
    return;
  }

  const ok = window.confirm(
    "Apply this mapping?\n\nThis updates mapping data only — no stock or channel API changes.",
  );
  if (!ok) return;

  const btn = getDom().mappingAssistModalMount?.querySelector("#mappingAssistConfirmBtn");
  btn?.setAttribute("disabled", "true");

  try {
    const result = await applyMappingAssist({
      actionType: isAmazon ? "amazon_variant_mapping" : "order_line_variant",
      issueType: context.issueType,
      sourceOrderId: context.sourceOrderId,
      sourceOrderItemId: context.sourceOrderItemId,
      amazonListingId,
      selectedProductId: selection.productId || suggestion?.suggestedProductId || null,
      selectedVariantId: selection.variantId,
      confidence: selection.confidence || suggestion?.confidence || "manual",
      note: "Mapping applied by assist wizard",
    });

    const parent = context.parentIssue || findIssueByType(context.issueType);
    if (parent) {
      await markIssueReviewed(parent);
    }

    await refreshInventoryAfterIssueStateChange();

    if (isAmazon || !context.sourceOrderId || !context.sourceOrderItemId) {
      closeModal();
      showInventoryToast("Mapping applied. Issues refreshed.", { variant: "success" });
      context.onComplete?.();
      return;
    }

    showInventoryToast("Mapping applied.", { variant: "success" });
    await showPostMappingChecklistInline(result);
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    btn?.removeAttribute("disabled");
  }
}

/** @param {import('../state.js').InventoryIssueRow} issue */
export function issueSupportsMappingAssist(issue) {
  return issue.type === "unmapped_order_line" || issue.type === "amazon_mapping_missing";
}

async function showPostMappingChecklistInline(applyResult) {
  const mount = getDom().mappingAssistModalMount;
  const panel = mount?.querySelector(".relative");
  if (!panel) {
    closeModal();
    context.onComplete?.();
    return;
  }

  panel.innerHTML = `<p class="text-xs text-gray-500">Loading next steps…</p>`;

  await showPostMappingChecklist({
    mappingActionIds: mappingActionIdsFromSingleApply(applyResult),
    orderRefs:
      context.sourceOrderId && context.sourceOrderItemId
        ? [{ sourceOrderId: context.sourceOrderId, sourceOrderItemId: context.sourceOrderItemId }]
        : undefined,
    inlineMount: panel,
    onDone: () => {
      closeModal();
      context.onComplete?.();
    },
  });
}
