/**
 * eBay readiness section for Sync Channels modal (Phase 7D).
 */

import { esc } from "../utils/formatters.js";
import { refreshEbayListingCache } from "../api/ebayCacheRefreshApi.js";

/** @param {import('../api/channelSyncPreviewApi.js').ChannelSyncPreviewSummary} summary */
export function renderEbayReadinessSection(summary) {
  return `
    <section class="border-4 border-purple-600 rounded-xl p-4 bg-purple-50/40 space-y-3">
      <div>
        <h3 class="text-sm font-black uppercase tracking-[.08em] text-purple-900">eBay Sync Readiness</h3>
        <p class="text-xs text-purple-900/80 mt-1">Refresh reads current eBay qty/status into local cache. Quantity push is in the section below.</p>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Cache missing</span><br><strong>${esc(summary.ebayQtyCacheMissing ?? 0)}</strong></div>
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Update candidates</span><br><strong>${esc(summary.ebayUpdate ?? 0)}</strong></div>
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Ended / relist</span><br><strong>${esc(summary.ebayEnded ?? 0)}</strong></div>
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Cached rows</span><br><strong>${esc(summary.ebayCachePresent ?? 0)}</strong></div>
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Unsupported var.</span><br><strong>${esc(summary.ebayUnsupported ?? 0)}</strong></div>
        <div class="border border-purple-200 rounded-lg p-2 bg-white"><span class="font-black">Missing map</span><br><strong>${esc(summary.ebayMissing ?? 0)}</strong></div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-ebay-cache-refresh class="border-2 border-purple-800 bg-purple-700 text-white px-3 py-2 text-xs font-black uppercase min-h-[44px] hover:bg-purple-800 disabled:opacity-50">
          Refresh eBay Cache
        </button>
      </div>
      <p id="ebayCacheRefreshResult" class="text-[11px] text-purple-900/80 hidden"></p>
    </section>`;
}

/** @param {HTMLElement} mount @param {() => Promise<void>} onRefreshed */
export function wireEbayReadinessActions(mount, onRefreshed) {
  const btn = mount.querySelector("[data-ebay-cache-refresh]");
  const resultEl = mount.querySelector("#ebayCacheRefreshResult");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (!window.confirm("Refresh eBay listing quantity cache from eBay?\n\nRead-only — no eBay writes or stock changes.")) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Refreshing…";
    try {
      const data = await refreshEbayListingCache({ limit: 25 });
      if (resultEl) {
        resultEl.classList.remove("hidden");
        resultEl.textContent = `Cache refresh: ${data.summary?.succeeded ?? 0} ok, ${data.summary?.failed ?? 0} failed, ${data.summary?.skipped ?? 0} skipped.`;
      }
      const { showInventoryToast } = await import("../events.js");
      showInventoryToast(
        `eBay cache refreshed: ${data.summary?.succeeded ?? 0} products`,
        { variant: data.summary?.failed ? "error" : "success" },
      );
      await onRefreshed();
    } catch (err) {
      const { showInventoryToast } = await import("../events.js");
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}
