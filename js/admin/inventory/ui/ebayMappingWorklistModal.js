/**
 * eBay mapping worklist modal (Phase 8H — grouped visibility + selected apply).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import {
  fetchEbayMappingWorklist,
  fetchEbayMappingWorklistLines,
  applyEbayMappingBatch,
} from "../api/ebayMappingWorklistApi.js";
import {
  fetchProductVariantsForMappingAssist,
  searchProductsForMappingAssist,
} from "../api/mappingAssistApi.js";
import {
  mappingActionIdsFromBatchResult,
} from "../api/postMappingWorkflowApi.js";
import { showPostMappingChecklist } from "./postMappingChecklistModal.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";
import { showInventoryToast } from "../events.js";

/** @typedef {import('../api/ebayMappingWorklistApi.js').EbayMappingWorklistGroup} WorklistGroup */
/** @typedef {import('../api/ebayMappingWorklistApi.js').EbayMappingWorklistLine} WorklistLine */

/** @type {WorklistGroup[]} */
let groups = [];
/** @type {WorklistGroup|null} */
let activeGroup = null;
/** @type {WorklistLine[]} */
let activeLines = [];
/** @type {Set<string>} */
let selectedKeys = new Set();

/** @type {{ productId: string, variantId: string, productLabel: string, variantLabel: string, confidence: string|null }} */
let selection = { productId: "", variantId: "", productLabel: "", variantLabel: "", confidence: null };

function lineKey(line) {
  return `${line.sourceOrderId}:${line.sourceOrderItemId}`;
}

function closeModal() {
  const mount = getDom().ebayWorklistModalMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  activeGroup = null;
  activeLines = [];
  selectedKeys = new Set();
}

function actionBadge(action) {
  const labels = {
    review_and_apply_selected: "Review & apply selected",
    manual_variant_pick: "Manual variant pick",
    manual_search: "Manual search",
    skip: "Skip",
  };
  return esc(labels[action] || action);
}

function groupLabel(g) {
  if (g.groupType === "source_sku") return `SKU ${g.sourceSku || g.groupKey}`;
  if (g.groupType === "product_code") return `Product code ${g.groupKey}`;
  if (g.groupType === "ebay_listing_id") return `Listing ${g.groupKey}`;
  if (g.groupType === "title") return g.groupKey.slice(0, 48);
  return g.groupKey;
}

function renderGroupsList(panel) {
  panel.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">eBay Mapping Worklist</p>
        <h2 class="text-lg font-black">Repeated Unmapped Patterns</h2>
        <p class="text-xs text-gray-600">${groups.length} group(s) · select lines per group before apply.</p>
      </div>
      <button type="button" data-ebay-worklist-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
    </div>
    <p class="text-[11px] text-violet-900 bg-violet-50 border border-violet-200 rounded-lg p-2">
      Bulk visibility only — you must review, select lines, and confirm each batch. No auto-map or auto-finalize.
    </p>
    <div class="space-y-2 max-h-[60vh] overflow-y-auto">
      ${
        groups.length
          ? groups
              .map(
                (g, idx) => `
        <div class="border border-gray-200 rounded-lg p-3 text-xs space-y-1">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="text-[9px] font-black uppercase text-gray-400">${esc(g.groupType.replace(/_/g, " "))}</span>
              <p class="font-bold text-gray-900">${esc(groupLabel(g))}</p>
              <p class="text-gray-600">${g.rowCount} lines · qty ${g.totalQty} · ${g.shippedCount} shipped · ${g.unshippedCount} unshipped</p>
            </div>
            <button type="button" data-review-group="${idx}" class="border-2 border-violet-700 text-violet-900 px-3 py-2 text-[10px] font-black uppercase min-h-[40px]">Review Lines</button>
          </div>
          ${
            g.suggestedProductLabel
              ? `<p class="text-teal-800">Suggested: ${esc(g.suggestedProductLabel)} ${g.suggestedInternalSku ? `· ${esc(g.suggestedInternalSku)}` : ""} (${esc(g.confidence || "—")})</p>`
              : ""
          }
          <p class="text-gray-500">${esc(g.confidenceReason || "No suggestion")}</p>
          <p class="text-[10px] font-mono text-gray-400">${actionBadge(g.recommendedAction)}${g.variantPickRequired ? " · manual pick" : ""}</p>
        </div>`,
              )
              .join("")
          : `<p class="text-center text-gray-400 py-8">No repeated eBay mapping groups found.</p>`
      }
    </div>`;

  panel.querySelectorAll("[data-ebay-worklist-close]").forEach((b) => b.addEventListener("click", closeModal));
  panel.querySelectorAll("[data-review-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = groups[Number(btn.getAttribute("data-review-group"))];
      if (g) void openGroupReview(g);
    });
  });
}

async function openGroupReview(group) {
  activeGroup = group;
  selectedKeys = new Set();
  selection = {
    productId: group.suggestedProductId || "",
    variantId: group.variantPickRequired ? "" : group.suggestedVariantId || "",
    productLabel: group.suggestedProductLabel || "",
    variantLabel: group.suggestedInternalSku || "",
    confidence: group.confidence,
  };

  const panel = getDom().ebayWorklistModalMount?.querySelector(".relative");
  if (!panel) return;

  panel.innerHTML = `<p class="text-xs text-gray-500">Loading lines…</p>`;
  activeLines = await fetchEbayMappingWorklistLines(group.groupType, group.groupKey);
  renderGroupReview(panel);
}

function renderGroupReview(panel) {
  const g = activeGroup;
  if (!g) return;

  const isHighExact =
    g.recommendedAction === "review_and_apply_selected" && !g.variantPickRequired;

  panel.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <button type="button" data-ebay-worklist-back class="text-[10px] font-black uppercase text-gray-500 hover:underline mb-1">← Back to groups</button>
        <h2 class="text-lg font-black">${esc(groupLabel(g))}</h2>
        <p class="text-xs text-gray-600">${actionBadge(g.recommendedAction)} · ${activeLines.length} lines</p>
      </div>
      <button type="button" data-ebay-worklist-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
    </div>

    <div id="ebayWorklistVariantPanel" class="space-y-2"></div>

    <div class="flex flex-wrap gap-2">
      ${
        isHighExact
          ? `<button type="button" id="ebaySelectSuggestedBtn" class="border-2 border-teal-700 text-teal-900 px-2 py-1 text-[10px] font-black uppercase">Select suggested lines</button>`
          : ""
      }
      <span id="ebaySelectedCount" class="text-[10px] text-gray-500 self-center">${selectedKeys.size} selected</span>
    </div>

    <div class="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
      ${activeLines
        .map((line) => {
          const key = lineKey(line);
          const checked = selectedKeys.has(key);
          return `
        <label class="flex gap-2 p-2 text-[11px] cursor-pointer hover:bg-gray-50">
          <input type="checkbox" data-line-key="${esc(key)}" ${checked ? "checked" : ""} class="mt-0.5" />
          <span>
            <strong>${esc(line.sourceTitle || line.sourceSku || "Line")}</strong>
            <span class="block text-gray-500 font-mono">${esc(line.sourceOrderId.slice(0, 24))}… · qty ${line.quantity}</span>
            <span class="block text-gray-500">${line.isShipped ? "Shipped — may need finalize audit" : "Unshipped — may be reservation retry eligible"}</span>
            ${line.confidence ? `<span class="text-teal-700">${esc(line.matchType || "")} · ${esc(line.confidence)}</span>` : ""}
          </span>
        </label>`;
        })
        .join("")}
    </div>

    <button type="button" id="ebayWorklistApplyBtn" class="w-full border-2 border-black bg-black text-white px-4 py-2 text-xs font-black uppercase min-h-[44px]" disabled>
      Apply Mapping to Selected Lines
    </button>
    <p class="text-[10px] text-gray-500">Mapped shipped lines → Shipped Finalize Audit. Mapped paid/unshipped → Reservation Retry (manual).</p>`;

  panel.querySelector("[data-ebay-worklist-back]")?.addEventListener("click", () => {
    activeGroup = null;
    renderGroupsList(panel);
  });
  panel.querySelectorAll("[data-ebay-worklist-close]").forEach((b) => b.addEventListener("click", closeModal));

  panel.querySelectorAll("[data-line-key]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-line-key");
      if (!key) return;
      if (input.checked) selectedKeys.add(key);
      else selectedKeys.delete(key);
      updateApplyState(panel);
      const countEl = panel.querySelector("#ebaySelectedCount");
      if (countEl) countEl.textContent = `${selectedKeys.size} selected`;
    });
  });

  panel.querySelector("#ebaySelectSuggestedBtn")?.addEventListener("click", () => {
    for (const line of activeLines) {
      if (line.suggestedVariantId && line.confidence === "high" && !line.variantPickRequired) {
        selectedKeys.add(lineKey(line));
      }
    }
    panel.querySelectorAll("[data-line-key]").forEach((input) => {
      const key = input.getAttribute("data-line-key");
      if (key) input.checked = selectedKeys.has(key);
    });
    updateApplyState(panel);
    const countEl = panel.querySelector("#ebaySelectedCount");
    if (countEl) countEl.textContent = `${selectedKeys.size} selected`;
  });

  panel.querySelector("#ebayWorklistApplyBtn")?.addEventListener("click", () => void confirmApply());

  if (selection.productId) void loadVariantPanel();
  else renderVariantSearch(panel);
  updateApplyState(panel);
}

function renderVariantSearch(panel) {
  const mount = panel.querySelector("#ebayWorklistVariantPanel");
  if (!mount) return;
  mount.innerHTML = `
    <label class="block text-[10px] font-black uppercase text-gray-500">Search product for mapping</label>
    <input id="ebayWorklistProductSearch" type="search" placeholder="Name or code…" class="w-full border-2 border-black px-2 py-1.5 text-sm" />
    <div id="ebayWorklistSearchResults" class="max-h-24 overflow-y-auto"></div>`;
  mount.querySelector("#ebayWorklistProductSearch")?.addEventListener("input", (e) => {
    void runSearch(/** @type {HTMLInputElement} */ (e.target).value);
  });
}

async function runSearch(query) {
  const results = getDom().ebayWorklistModalMount?.querySelector("#ebayWorklistSearchResults");
  if (!results || String(query).trim().length < 2) {
    if (results) results.innerHTML = "";
    return;
  }
  const rows = await searchProductsForMappingAssist(query);
  results.innerHTML = rows
    .map(
      (p) =>
        `<button type="button" data-wl-product="${esc(p.id)}" data-wl-label="${esc(p.name)}" class="w-full text-left text-xs border rounded px-2 py-1 mb-1 hover:bg-gray-50">${esc(p.name)} · ${esc(p.code)}</button>`,
    )
    .join("");
  results.querySelectorAll("[data-wl-product]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selection.productId = btn.getAttribute("data-wl-product") || "";
      selection.productLabel = btn.getAttribute("data-wl-label") || "";
      selection.variantId = "";
      selection.confidence = "manual";
      void loadVariantPanel();
    });
  });
}

async function loadVariantPanel() {
  const mount = getDom().ebayWorklistModalMount?.querySelector("#ebayWorklistVariantPanel");
  if (!mount || !selection.productId) return;

  mount.innerHTML = `<p class="text-xs text-gray-400">Loading variants…</p>`;
  const variants = await fetchProductVariantsForMappingAssist(selection.productId);

  if (variants.length === 1 && !activeGroup?.variantPickRequired && !selection.variantId) {
    selection.variantId = variants[0].id;
    selection.variantLabel = variants[0].label;
  }

  mount.innerHTML = `
    <p class="text-[10px] font-black uppercase text-gray-500">Product: ${esc(selection.productLabel)}</p>
    <p class="text-[10px] font-black uppercase text-gray-500 mt-2">Select variant ${activeGroup?.variantPickRequired ? "(required)" : ""}</p>
    <div class="space-y-1 max-h-28 overflow-y-auto">
      ${variants
        .map(
          (v) => `
        <label class="flex items-center gap-2 text-xs border rounded px-2 py-1 cursor-pointer ${selection.variantId === v.id ? "border-black bg-gray-50" : "border-gray-200"}">
          <input type="radio" name="ebayWlVariant" value="${esc(v.id)}" ${selection.variantId === v.id ? "checked" : ""} />
          <span>${esc(v.label)} ${v.sku ? `<span class="font-mono text-gray-500">${esc(v.sku)}</span>` : ""}</span>
        </label>`,
        )
        .join("")}
    </div>`;

  mount.querySelectorAll('input[name="ebayWlVariant"]').forEach((input) => {
    input.addEventListener("change", () => {
      const v = variants.find((row) => row.id === input.value);
      selection.variantId = input.value;
      selection.variantLabel = v?.label || "";
      selection.confidence = "manual";
      updateApplyState(getDom().ebayWorklistModalMount?.querySelector(".relative"));
    });
  });

  updateApplyState(getDom().ebayWorklistModalMount?.querySelector(".relative"));
}

function updateApplyState(panel) {
  const btn = panel?.querySelector("#ebayWorklistApplyBtn");
  if (!btn) return;
  const ready = selectedKeys.size > 0 && Boolean(selection.variantId);
  btn.toggleAttribute("disabled", !ready);
}

async function confirmApply() {
  if (!activeGroup || !selection.variantId || selectedKeys.size === 0) return;

  const lines = activeLines.filter((l) => selectedKeys.has(lineKey(l)));
  const ok = window.confirm(
    `Apply mapping to ${lines.length} selected line(s)?\n\nProduct/variant: ${selection.productLabel} · ${selection.variantLabel}\n\nMapping only — no stock, reservation, or finalize changes.`,
  );
  if (!ok) return;

  try {
    const result = await applyEbayMappingBatch({
      lines: lines.map((l) => ({
        sourceOrderId: l.sourceOrderId,
        sourceOrderItemId: l.sourceOrderItemId,
      })),
      groupType: activeGroup.groupType,
      groupKey: activeGroup.groupKey,
      selectedProductId: selection.productId,
      selectedVariantId: selection.variantId,
      confidence: selection.confidence || activeGroup.confidence || "manual",
      note: `eBay worklist batch apply (${activeGroup.groupType})`,
    });

    await refreshInventoryAfterIssueStateChange();
    closeModal();
    await showPostMappingChecklist({
      batchId: result.batch_id ? String(result.batch_id) : undefined,
      mappingActionIds: mappingActionIdsFromBatchResult(result),
      applySummary: {
        selected_count: result.selected_count,
        success_count: result.success_count,
        failed_count: result.failed_count,
        skipped_count: result.skipped_count || 0,
      },
    });
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

/** @param {{ focusGroupType?: string, focusGroupKey?: string }} [opts] */
export async function openEbayMappingWorklistModal(opts = {}) {
  const mount = getDom().ebayWorklistModalMount;
  if (!mount) return;

  document.body.classList.add("overflow-hidden");
  mount.innerHTML = `
    <div class="fixed inset-0 z-[65] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" class="absolute inset-0 bg-black/50" data-ebay-worklist-close aria-label="Close"></button>
      <div class="relative bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl p-4 space-y-3">
        <p class="text-xs text-gray-500">Loading worklist…</p>
      </div>
    </div>`;

  mount.querySelector("[data-ebay-worklist-close]")?.addEventListener("click", closeModal);

  try {
    groups = await fetchEbayMappingWorklist({ limit: 50 });
  } catch (err) {
    const panel = mount.querySelector(".relative");
    if (panel) panel.innerHTML = `<p class="text-red-700 text-sm">${esc(err instanceof Error ? err.message : String(err))}</p>`;
    return;
  }

  const panel = mount.querySelector(".relative");
  if (!panel) return;

  if (opts.focusGroupType && opts.focusGroupKey) {
    const g = groups.find((row) => row.groupType === opts.focusGroupType && row.groupKey === opts.focusGroupKey);
    if (g) {
      await openGroupReview(g);
      return;
    }
  }

  renderGroupsList(panel);
}
