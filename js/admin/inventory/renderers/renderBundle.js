/**
 * Bundle Rules preview panel (Phase 10A — read-only design preview).
 */

import { esc } from "../utils/formatters.js";
import { openBundlePreviewModal } from "../ui/bundlePreviewModal.js";

/**
 * @typedef {import('../api/bundlePreviewApi.js').BundleSummaryPreview} Summary
 * @typedef {import('../api/bundlePreviewApi.js').BundleLikeVariant} LikeVariant
 */

/**
 * @param {HTMLElement|null} mount
 * @param {{ summaries?: Summary[], likeVariants?: LikeVariant[], loading?: boolean, error?: string|null, isLive?: boolean }} [opts]
 */
export function renderBundleRules(mount, opts = {}) {
  if (!mount) return;

  const { summaries = [], likeVariants = [], loading = false, error = null, isLive = false } = opts;

  if (loading) {
    mount.innerHTML = `<p class="text-sm text-gray-500 text-center py-4">Loading bundle preview…</p>`;
    return;
  }

  if (error) {
    mount.innerHTML = `
      <p class="text-sm text-red-600 text-center py-2">${esc(error)}</p>
      <p class="text-[10px] text-gray-500 text-center">Preview unavailable — live inventory unchanged.</p>`;
    return;
  }

  const virtualCount = summaries.filter((s) => s.currentModel === "model_b_virtual_preview").length;
  const likeCount = likeVariants.length;
  const shortageCount = summaries.filter(
    (s) =>
      s.currentModel === "model_b_virtual_preview" &&
      (s.virtualBundleAvailable == null || s.virtualBundleAvailable <= 0),
  ).length;

  const topSummaries = summaries.slice(0, 3);
  const topLike = likeVariants.slice(0, 4);

  const summaryList = topSummaries.length
    ? topSummaries
        .map(
          (s) => `
        <li class="text-[10px] text-gray-600 border-b border-gray-100 pb-1">
          <span class="font-bold">${esc(s.bundleLabel)}</span>
          · ${esc(s.bundleSku)}
          · ${s.currentModel === "model_b_virtual_preview" ? "Virtual preview" : "Separate stock"}
          ${s.virtualBundleAvailable != null ? ` · preview avail ${s.virtualBundleAvailable}` : ""}
        </li>`,
        )
        .join("")
    : `<li class="text-[10px] text-gray-400">No configured virtual bundles yet.</li>`;

  const likeList = topLike.length
    ? topLike
        .map(
          (v) => `
        <li class="text-[10px] text-gray-500">
          ${esc(v.productLabel)} · ${esc(v.internalSku || v.variantLabel)} · stock ${v.onHand}
        </li>`,
        )
        .join("")
    : `<li class="text-[10px] text-gray-400">No pack/bundle/kit patterns detected.</li>`;

  mount.innerHTML = `
    <div class="space-y-3">
      <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <p class="text-[9px] font-black uppercase text-amber-800">Preview Only</p>
        <p class="text-[10px] text-amber-900 leading-relaxed">
          Preview/config only — no live deduction. Does not affect checkout, stock, reservations, or channel sync.
        </p>
      </div>

      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="rounded border border-gray-200 p-2">
          <p class="text-lg font-black">${likeCount}</p>
          <p class="text-[9px] font-black uppercase text-gray-400">Bundle-like</p>
        </div>
        <div class="rounded border border-gray-200 p-2">
          <p class="text-lg font-black">${virtualCount}</p>
          <p class="text-[9px] font-black uppercase text-gray-400">Virtual rules</p>
        </div>
        <div class="rounded border border-gray-200 p-2">
          <p class="text-lg font-black">${shortageCount}</p>
          <p class="text-[9px] font-black uppercase text-gray-400">Preview shortage</p>
        </div>
      </div>

      <div>
        <p class="text-[9px] font-black uppercase text-gray-400 mb-1">Model A default</p>
        <p class="text-[10px] text-gray-600 leading-relaxed">
          Current bundle-like SKUs are separate stocked items until explicitly configured as virtual bundles (Model B).
        </p>
      </div>

      <ul class="space-y-1">${summaryList}</ul>
      <div>
        <p class="text-[9px] font-black uppercase text-gray-400 mb-1">Detected patterns</p>
        <ul class="space-y-0.5">${likeList}</ul>
      </div>

      <button
        type="button"
        data-inventory-restock-queue
        class="w-full inline-flex items-center justify-center border-2 border-emerald-700 text-emerald-900 bg-white hover:bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase tracking-[.12em] min-h-[40px] mt-2"
      >
        Marketplace Restock Queue
      </button>
      <button
        type="button"
        data-inventory-returns-restock-dashboard
        class="w-full inline-flex items-center justify-center border-2 border-violet-700 text-violet-900 bg-white hover:bg-violet-50 px-4 py-2 text-[10px] font-black uppercase tracking-[.12em] min-h-[40px]"
      >
        Returns &amp; Restock Dashboard
      </button>
      <button
        type="button"
        data-inventory-bundle-preview
        class="w-full inline-flex items-center justify-center border-2 border-indigo-700 text-indigo-800 bg-white hover:bg-indigo-50 px-4 py-2 text-[10px] font-black uppercase tracking-[.12em] min-h-[40px]"
      >
        Open Bundle Preview${isLive ? "" : " (offline)"}
      </button>
    </div>`;

  mount.querySelector("[data-inventory-restock-queue]")?.addEventListener("click", () => {
    import("../ui/marketplaceRestockAssistQueueModal.js").then((mod) =>
      mod.openMarketplaceRestockAssistQueueModal(),
    );
  });

  mount.querySelector("[data-inventory-returns-restock-dashboard]")?.addEventListener("click", () => {
    import("../ui/returnsRestockDashboardModal.js").then((mod) =>
      mod.openReturnsRestockDashboardModal(),
    );
  });

  mount.querySelector("[data-inventory-bundle-preview]")?.addEventListener("click", () => {
    openBundlePreviewModal({
      onRefresh: () => {
        mount.dispatchEvent(new CustomEvent("inventory:bundle-preview-refresh"));
      },
    });
  });
}
