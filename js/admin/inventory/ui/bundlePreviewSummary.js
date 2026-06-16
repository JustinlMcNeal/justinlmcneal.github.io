import { renderBundleModeSelect } from "./bundleModeControls.js";
import { renderBundleLiveReadinessCard } from "./bundleLiveReadinessPanel.js";

import { esc } from "../utils/formatters.js";

/** @typedef {import('../api/bundlePreviewApi.js').BundleSummaryPreview} Summary */
/** @typedef {import('../api/bundlePreviewApi.js').BundleAvailabilityPreview} Avail */

const STATUS_BADGE = {
  ready: "bg-green-100 text-green-800 border-green-300",
  component_shortage: "bg-red-100 text-red-800 border-red-300",
  no_rules: "bg-gray-100 text-gray-700 border-gray-300",
  missing_component: "bg-orange-100 text-orange-800 border-orange-300",
  inactive_rule: "bg-gray-100 text-gray-500 border-gray-300",
  self_reference_error: "bg-red-100 text-red-900 border-red-400",
};

function modelLabel(model) {
  if (model === "model_b_virtual_preview") return "Model B — Virtual (preview)";
  return "Model A — Separate stocked";
}

function statusBadge(status) {
  const cls = STATUS_BADGE[status] || STATUS_BADGE.no_rules;
  return `<span class="text-[9px] font-black uppercase px-1.5 py-0.5 border rounded ${cls}">${esc(status.replace(/_/g, " "))}</span>`;
}

/**
 * @param {Summary} s
 * @param {Avail[]} rules
 * @param {string|null} focusId
 * @param {string} [bundleMode]
 * @param {import('../api/bundleShadowApi.js').CutoverReadinessRow|null} [readiness]
 */
export function renderSummaryCard(s, rules, focusId, bundleMode = "preview_only", readiness = null) {
  const focused = focusId && focusId === s.bundleVariantId;
  const rulesHtml = rules.length
    ? rules
        .map((r) => {
          const inactive = !r.isActive ? " · inactive" : "";
          return `
          <li class="flex flex-wrap items-center justify-between gap-1 text-[10px] text-gray-600 py-1 border-b border-gray-100 last:border-0" data-rule-id="${esc(r.ruleId)}">
            <span>${esc(r.componentProductLabel)} × ${r.componentQty} · avail ${r.componentAvailable} · ${esc(r.previewStatus)}${r.limitingComponent ? " · limiting" : ""}${inactive}</span>
            <span class="flex gap-1 shrink-0">
              <button type="button" data-rule-edit="${esc(r.ruleId)}" class="font-black uppercase text-indigo-700 hover:underline">Edit</button>
              ${r.isActive ? `<button type="button" data-rule-disable="${esc(r.ruleId)}" class="font-black uppercase text-gray-500 hover:underline">Disable</button>` : `<button type="button" data-rule-enable="${esc(r.ruleId)}" class="font-black uppercase text-green-700 hover:underline">Enable</button>`}
              <button type="button" data-rule-delete="${esc(r.ruleId)}" class="font-black uppercase text-red-700 hover:underline">Remove</button>
            </span>
          </li>`;
        })
        .join("")
    : `<li class="text-[10px] text-gray-400">No component rules — Model A default</li>`;

  const warnings = [];
  if (s.hasIndependentStockWarning) {
    warnings.push("Bundle has independent stock and virtual rules configured");
  }
  if (s.virtualVsStockedDelta != null && s.virtualVsStockedDelta !== 0) {
    warnings.push(
      `Virtual preview (${s.virtualBundleAvailable ?? "—"}) differs from bundle available (${s.bundleAvailable}) by ${s.virtualVsStockedDelta}`,
    );
  }

  return `
    <div class="border rounded-lg p-3 space-y-2 ${focused ? "border-indigo-500 ring-2 ring-indigo-200" : "border-gray-200"}" data-bundle-card="${esc(s.bundleVariantId)}" id="bundle-card-${esc(s.bundleVariantId)}">
      <div class="flex flex-wrap justify-between gap-2 items-start">
        <div>
          <p class="text-[11px] font-bold">${esc(s.bundleLabel)}</p>
          <p class="text-[10px] font-mono text-gray-500">${esc(s.bundleSku)}</p>
        </div>
        <div class="flex flex-wrap gap-1 items-center">
          ${statusBadge(s.previewStatus)}
          <span class="text-[9px] font-black uppercase text-indigo-700">${esc(modelLabel(s.currentModel))}</span>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center text-[10px]">
        <div class="rounded border border-gray-100 p-1"><span class="text-gray-400 block text-[9px] uppercase">On hand</span><strong>${s.bundleOnHand}</strong></div>
        <div class="rounded border border-gray-100 p-1"><span class="text-gray-400 block text-[9px] uppercase">Reserved</span><strong>${s.bundleReserved}</strong></div>
        <div class="rounded border border-gray-100 p-1"><span class="text-gray-400 block text-[9px] uppercase">Available</span><strong>${s.bundleAvailable}</strong></div>
      </div>
      ${
        s.virtualBundleAvailable != null
          ? `<p class="text-[10px]"><span class="text-gray-500">Virtual avail (preview):</span> <strong>${s.virtualBundleAvailable}</strong>${s.limitingComponentLabel ? ` · limited by ${esc(s.limitingComponentLabel)}` : ""} · ${s.componentCount} component(s)</p>`
          : `<p class="text-[10px] text-gray-500">${s.componentCount} component rule(s)</p>`
      }
      <p class="text-[10px] text-gray-600">${esc(s.previewWarning)}</p>
      ${
        warnings.length
          ? `<ul class="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 list-disc pl-4">${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
          : ""
      }
      <ul class="mt-1">${rulesHtml}</ul>
      ${renderBundleModeSelect(s.bundleVariantId, bundleMode)}
      ${
        s.componentCount > 0 && s.currentModel === "model_b_virtual_preview"
          ? `<button type="button" data-simulate-bundle="${esc(s.bundleVariantId)}" data-simulate-label="${esc(s.bundleLabel)}" class="mt-2 w-full border-2 border-violet-600 text-violet-800 px-3 py-1.5 text-[10px] font-black uppercase">Simulate Sale</button>`
          : ""
      }
      ${readiness && s.componentCount > 0 ? renderBundleLiveReadinessCard(readiness) : ""}
    </div>`;
}

/**
 * @param {Summary[]} summaries
 * @param {Avail[]} availability
 * @param {import('../api/bundlePreviewApi.js').BundleLikeVariant[]} likeVariants
 * @param {string|null} focusId
 * @param {string} [globalMode]
 * @param {Record<string, string>} [bundleModes]
 * @param {Record<string, import('../api/bundleShadowApi.js').CutoverReadinessRow>} [readinessByBundle]
 */
export function renderPreviewBody(summaries, availability, likeVariants, focusId, globalMode = "preview_only", bundleModes = {}, readinessByBundle = {}) {
  const byBundle = availability.reduce((acc, row) => {
    const key = row.bundleVariantId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, /** @type {Record<string, Avail[]>} */ ({}));

  const configuredHtml = summaries.length
    ? summaries
        .map((s) =>
          renderSummaryCard(
            s,
            byBundle[s.bundleVariantId] ?? [],
            focusId,
            bundleModes[s.bundleVariantId] ?? "preview_only",
            readinessByBundle[s.bundleVariantId] ?? null,
          ),
        )
        .join("")
    : `<p class="text-sm text-gray-500">No bundle summaries yet. Add a virtual bundle rule below.</p>`;

  const likeHtml = likeVariants.length
    ? `<ul class="space-y-1 mt-2">${likeVariants
        .map(
          (v) => `
        <li class="text-[10px] text-gray-600 flex flex-wrap justify-between gap-1">
          <span>${esc(v.productLabel)} · ${esc(v.internalSku || v.variantLabel)} · stock ${v.onHand}</span>
          <button type="button" data-use-like-bundle="${esc(v.variantId)}" class="font-black uppercase text-indigo-700 hover:underline">Use as bundle</button>
        </li>`,
        )
        .join("")}</ul>`
    : `<p class="text-[10px] text-gray-400">No pack/bundle/kit patterns detected in active catalog.</p>`;

  return `
    <div class="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <p class="text-[10px] text-violet-800 bg-violet-50 border border-violet-200 rounded px-2 py-1">
        Global mode: <strong>${esc(globalMode)}</strong> — shadow logs checkout only when mode is shadow.
      </p>
      <div id="bundleGlobalModeMount"></div>
      <div id="bundleLiveStagingMount"></div>
      <div id="bundleReadinessMount"></div>
      <div id="bundleShadowEventsMount"></div>
      <div id="bundleReturnRestockMount"></div>
      <section>
        <h3 class="text-[10px] font-black uppercase text-gray-400 mb-2">Configured bundles & preview</h3>
        ${configuredHtml}
      </section>
      <section>
        <h3 class="text-[10px] font-black uppercase text-gray-400 mb-2">Detected bundle-like SKUs</h3>
        ${likeHtml}
      </section>
      <section class="border border-dashed border-amber-300 bg-amber-50 rounded p-3" id="bundleRuleFormSection">
        <h3 class="text-[10px] font-black uppercase text-amber-800 mb-1">Add / edit component rule</h3>
        <p class="text-[10px] text-amber-900 mb-2">Preview/config only — no live deduction yet. Does not change checkout, stock, reservations, or channel sync.</p>
        <div id="bundleRuleFormMount"></div>
        <p class="text-[10px] text-amber-800 mt-2 hidden" data-form-warnings></p>
      </section>
    </div>`;
}
