/**
 * eBay active listing quantity sync section (Phase 7F) for Sync Channels modal.
 */

import { esc } from "../utils/formatters.js";
import { pushEbayInventoryQuantity } from "../api/ebaySyncPushApi.js";

/** @param {import('../api/channelSyncPreviewApi.js').EbayPushCandidateRow[]} candidates */
function renderCandidateRows(candidates) {
  if (!candidates.length) {
    return `<tr><td colspan="4" class="py-3 px-2 text-xs text-purple-900/70">No eligible eBay update candidates. Refresh eBay cache for active listings first.</td></tr>`;
  }

  return candidates
    .slice(0, 8)
    .map((r) => {
      const target = Math.max(0, Number(r.available_qty_nonneg ?? r.available_qty ?? 0));
      return `<tr class="border-t border-purple-100 text-xs">
        <td class="py-2 px-2 font-mono">${esc(r.internal_sku || "—")}</td>
        <td class="py-2 px-2 text-right">${esc(r.ebay_current_qty ?? "—")}</td>
        <td class="py-2 px-2 text-right font-bold text-purple-800">${esc(target)}</td>
        <td class="py-2 px-2 font-mono text-[10px]">${esc(r.ebay_sku || "—")}</td>
      </tr>`;
    })
    .join("");
}

/** @param {Object[]} results */
function renderPushResultRows(results) {
  if (!results?.length) return `<p class="text-sm text-gray-500">No row results returned.</p>`;
  return `
    <div class="overflow-x-auto border-2 border-purple-200 rounded-xl max-h-48 overflow-y-auto">
      <table class="w-full text-left min-w-[480px]">
        <thead class="bg-purple-50 text-[10px] font-black uppercase tracking-[.1em] text-purple-900 sticky top-0">
          <tr>
            <th class="py-2 px-2">SKU</th>
            <th class="py-2 px-2 text-right">Prev</th>
            <th class="py-2 px-2 text-right">Target</th>
            <th class="py-2 px-2">Status</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((r) => {
            const tone = r.status === "success"
              ? "text-green-700"
              : r.status === "skipped"
              ? "text-gray-600"
              : "text-red-700";
            return `<tr class="border-t border-purple-100 text-xs">
              <td class="py-2 px-2 font-mono">${esc(r.internalSku || r.ebaySku || "—")}</td>
              <td class="py-2 px-2 text-right">${esc(r.previousQty ?? "—")}</td>
              <td class="py-2 px-2 text-right font-bold">${esc(r.targetQty ?? "—")}</td>
              <td class="py-2 px-2 font-bold ${tone}">${esc(r.status)}${r.error ? ` — ${esc(r.error)}` : ""}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

/**
 * @param {import('../api/channelSyncPreviewApi.js').EbayPushCandidateRow[]} candidates
 * @param {{ pushResult?: Object|null, pushing?: boolean }} [opts]
 */
export function renderEbayQuantityPushSection(candidates, opts = {}) {
  const { pushResult = null, pushing = false } = opts;
  const pushCount = candidates.length;
  const rows = renderCandidateRows(candidates);

  return `
    <section class="border-4 border-purple-700 rounded-xl p-4 bg-purple-50/30 space-y-3">
      <div>
        <h3 class="text-sm font-black uppercase tracking-[.08em] text-purple-900">eBay Active Quantity Sync</h3>
        <p class="text-xs text-purple-900/80 mt-1">
          Pushes <strong>Inventory Available</strong> to active eBay listings with cached qty and confident mapping.
          Ended listings and variation groups are excluded — use Relist Assist above.
        </p>
      </div>
      <p class="text-xs"><strong>${esc(pushCount)}</strong> eligible candidate(s) · Negative available clamped to <strong>0</strong>.</p>
      <div class="overflow-x-auto border-2 border-purple-200 rounded-xl bg-white">
        <table class="w-full text-left min-w-[420px]">
          <thead class="bg-purple-50 text-[10px] font-black uppercase tracking-[.1em] text-purple-900">
            <tr>
              <th class="py-2 px-2">SKU</th>
              <th class="py-2 px-2 text-right">eBay now</th>
              <th class="py-2 px-2 text-right">Target avail</th>
              <th class="py-2 px-2">eBay SKU</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-ebay-sync-preview class="border-2 border-purple-800 bg-white text-purple-900 px-3 py-2 text-xs font-black uppercase min-h-[44px] hover:bg-purple-100 disabled:opacity-50" ${pushCount ? "" : "disabled"}>
          Validate eBay Qty
        </button>
        <button type="button" data-ebay-sync-push class="border-2 border-black bg-purple-700 text-white px-3 py-2 text-xs font-black uppercase min-h-[44px] hover:bg-purple-800 disabled:opacity-50" ${pushCount ? "" : "disabled"}>
          ${pushing ? "Syncing…" : "Sync eBay Qty"}
        </button>
      </div>
      <p class="text-[10px] text-purple-900/70">Live push requires <code class="font-mono">EBAY_ENABLE_LIVE_QUANTITY_PATCH=true</code>. Max 25 listings per run.</p>
      ${
        pushResult
          ? `<div class="border-2 border-purple-300 rounded-xl p-3 bg-white space-y-2">
        <h4 class="text-xs font-black uppercase tracking-[.1em]">${pushResult.preview ? "Preview" : "Push"} results</h4>
        <p class="text-xs">Run <span class="font-mono">${esc(pushResult.runId || "—")}</span> · OK ${esc(pushResult.summary?.succeeded ?? 0)} · Failed ${esc(pushResult.summary?.failed ?? 0)} · Skipped ${esc(pushResult.summary?.skipped ?? 0)}</p>
        ${renderPushResultRows(pushResult.results)}
      </div>`
          : ""
      }
    </section>`;
}

/**
 * @param {HTMLElement} mount
 * @param {import('../api/channelSyncPreviewApi.js').EbayPushCandidateRow[]} candidates
 * @param {(opts?: Object) => void} rerender
 */
export function wireEbayQuantityPushActions(mount, candidates, rerender) {
  mount.querySelector("[data-ebay-sync-preview]")?.addEventListener("click", () => {
    runEbaySync({ preview: true, candidates, rerender });
  });

  mount.querySelector("[data-ebay-sync-push]")?.addEventListener("click", () => {
    const n = candidates.length;
    const msg = `Sync eBay quantity to Inventory Available for ${n} active listing(s)?\n\nThis updates active eBay listing quantities only. It will not relist ended listings. KK stock and reservations are not changed.`;
    if (!window.confirm(msg)) return;
    runEbaySync({ preview: false, candidates, rerender });
  });
}

async function runEbaySync({ preview, candidates, rerender }) {
  rerender({ ebayPushing: true });
  try {
    const pushResult = await pushEbayInventoryQuantity({ preview, limit: 25 });
    rerender({ ebayPushResult: pushResult, ebayPushing: false });

    const { showInventoryToast } = await import("../events.js");
    const mode = preview ? "Preview" : "Push";
    showInventoryToast(
      `${mode} complete: ${pushResult.summary?.succeeded ?? 0} ok, ${pushResult.summary?.failed ?? 0} failed`,
      { variant: pushResult.summary?.failed ? "error" : "success" },
    );

    if (!preview && pushResult.summary?.succeeded > 0) {
      rerender({ ebayPushResult: pushResult, ebayPushing: false, refreshAfterPush: true });
    }
  } catch (err) {
    const { showInventoryToast } = await import("../events.js");
    let msg = err instanceof Error ? err.message : String(err);
    if (err?.code === "live_patch_disabled") {
      msg =
        "Live eBay qty push is disabled on the server. Use Validate eBay Qty for dry-run, or ask admin to set EBAY_ENABLE_LIVE_QUANTITY_PATCH=true in Supabase secrets.";
    } else if (err?.hint) {
      msg += ` (${err.hint})`;
    }
    showInventoryToast(msg, { variant: "error" });
    rerender({ ebayPushing: false });
  }
}

export { renderPushResultRows };
