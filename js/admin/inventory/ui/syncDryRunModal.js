/**

 * Phase 7A/7C — channel sync dry-run modal + Amazon FBM push.

 */



import { getDom } from "../dom.js";

import {

  fetchChannelSyncPreview,

  fetchAmazonPushCandidates,

  fetchEbayPushCandidates,

} from "../api/channelSyncPreviewApi.js";

import { pushAmazonFbmInventory } from "../api/amazonSyncPushApi.js";

import { renderEbayReadinessSection, wireEbayReadinessActions } from "./syncEbayReadiness.js";
import { renderEbayRelistAssistSection, wireEbayRelistAssistActions } from "./syncEbayRelistAssist.js";
import { renderEbayQuantityPushSection, wireEbayQuantityPushActions } from "./syncEbayQuantityPush.js";
import { renderRecentSyncFailuresSection } from "./syncRecentSyncLogs.js";
import { fetchEbayRelistCandidates } from "../api/ebayRelistAssistApi.js";
import { fetchRecentSyncFailureRows } from "../api/issuesApi.js";

import { esc } from "../utils/formatters.js";



function getMount() {

  return getDom().syncDryRunModalMount;

}



function closeModal() {

  const mount = getMount();

  if (mount) mount.innerHTML = "";

  document.body.classList.remove("overflow-hidden");

}



function statCard(label, value, tone = "text-gray-900") {

  return `

    <div class="border-2 border-black rounded-xl p-3 bg-white">

      <p class="text-[9px] font-black uppercase tracking-[.14em] text-gray-500">${esc(label)}</p>

      <p class="text-xl font-black mt-1 ${tone}">${esc(String(value))}</p>

    </div>

  `;

}



/** @param {import('../api/channelSyncPreviewApi.js').AmazonPushCandidateRow[]} candidates */

function renderAmazonCandidateRows(candidates) {

  return candidates

    .slice(0, 8)

    .map((r) => {

      const target = Math.max(0, Number(r.available_qty_nonneg ?? r.available_qty ?? 0));

      return `<tr class="border-t border-gray-100 text-xs">

        <td class="py-2 pr-2 font-mono">${esc(r.internal_sku || "—")}</td>

        <td class="py-2 pr-2 text-right">${esc(r.amazon_current_qty ?? "—")}</td>

        <td class="py-2 pr-2 text-right font-bold text-blue-700">${esc(target)}</td>

        <td class="py-2 pr-2 font-mono text-[10px]">${esc(r.amazon_seller_sku || "—")}</td>

      </tr>`;

    })

    .join("");

}



/** @param {Object[]} results */

function renderPushResultRows(results) {

  if (!results?.length) return `<p class="text-sm text-gray-500">No row results returned.</p>`;

  return `

    <div class="overflow-x-auto border-2 border-gray-200 rounded-xl max-h-48 overflow-y-auto">

      <table class="w-full text-left min-w-[480px]">

        <thead class="bg-gray-50 text-[10px] font-black uppercase tracking-[.1em] text-gray-500 sticky top-0">

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

            return `<tr class="border-t border-gray-100 text-xs">

              <td class="py-2 px-2 font-mono">${esc(r.internalSku || r.sellerSku || "—")}</td>

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

 * @param {import('../api/channelSyncPreviewApi.js').ChannelSyncPreviewSummary} summary

 * @param {import('../api/channelSyncPreviewApi.js').AmazonPushCandidateRow[]} amazonCandidates

 * @param {import('../api/ebayRelistAssistApi.js').EbayRelistCandidateRow[]} ebayRelistCandidates

 * @param {import('../api/channelSyncPreviewApi.js').EbayPushCandidateRow[]} ebayPushCandidates

 * @param {{ pushResult?: Object|null, pushing?: boolean, ebayPushResult?: Object|null, ebayPushing?: boolean, recentSyncFailures?: Object[] }} [opts]

 */

function renderContent(summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, opts = {}) {

  const mount = getMount();

  if (!mount) return;



  const { pushResult = null, pushing = false, ebayPushResult = null, ebayPushing = false, recentSyncFailures = [] } = opts;



  const sampleRows = (summary.samples || [])

    .map((r) => {

      const flags = Array.isArray(r.issue_flags) ? r.issue_flags.join(", ") : "";

      return `<tr class="border-t border-gray-100 text-xs">

        <td class="py-2 pr-2 font-mono">${esc(r.internal_sku || "—")}</td>

        <td class="py-2 pr-2">${esc(r.product_label || "—")}</td>

        <td class="py-2 pr-2 text-right font-bold">${esc(r.available_qty ?? "—")}</td>

        <td class="py-2 pr-2">${esc(r.kk_sync_action || "—")}</td>

        <td class="py-2 pr-2">${esc(r.amazon_sync_action || "—")}</td>

        <td class="py-2">${esc(r.ebay_sync_action || "—")}${flags ? `<span class="block text-[10px] text-amber-700">${esc(flags)}</span>` : ""}</td>

      </tr>`;

    })

    .join("");



  const amazonRows = renderAmazonCandidateRows(amazonCandidates);

  const pushCount = amazonCandidates.length;



  mount.innerHTML = `

    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="syncDryRunTitle">

      <button type="button" class="absolute inset-0 bg-black/50" data-sync-dry-run-close aria-label="Close"></button>

      <div class="relative bg-white w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl">

        <div class="sticky top-0 bg-amber-50 border-b-2 border-amber-300 px-4 py-3 flex items-start justify-between gap-3 z-10">

          <div>

            <p class="text-[10px] font-black uppercase tracking-[.14em] text-amber-800">Channel Sync</p>

            <h2 id="syncDryRunTitle" class="text-lg font-black">Sync Preview &amp; Amazon Push</h2>

            <p class="text-xs text-amber-900 mt-1">Target sellable qty = on_hand − reserved (available). eBay active qty push + relist assist below.</p>

          </div>

          <button type="button" data-sync-dry-run-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase min-h-[36px]">Close</button>

        </div>

        <div class="p-4 space-y-4">
          ${
            opts.contextNote || opts.highlightSku
              ? `<div class="border-2 border-amber-400 bg-amber-50 rounded p-3 text-xs text-amber-900">
                  <p class="font-black uppercase text-[10px]">Post-restock follow-up</p>
                  <p class="mt-1">${esc(opts.contextNote || `Review sync candidates for SKU ${opts.highlightSku}. Sync is not run automatically.`)}</p>
                  ${opts.highlightSku ? `<p class="mt-1 font-mono text-[10px]">Highlight SKU: ${esc(opts.highlightSku)}</p>` : ""}
                </div>`
              : ""
          }

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">

            ${statCard("Ready (preview)", summary.readyToSync, "text-green-700")}

            ${statCard("KK needs available", summary.kkAlign)}

            ${statCard("Amazon FBM update", summary.amazonUpdate, "text-blue-700")}

            ${statCard("eBay ended", summary.ebayEnded, "text-amber-700")}

            ${statCard("Amazon AFN skip", summary.amazonAfnSkip)}

            ${statCard("Missing Amazon map", summary.amazonMissing)}

            ${statCard("eBay qty cache missing", summary.ebayQtyCacheMissing, summary.ebayQtyCacheMissing ? "text-purple-700" : "text-gray-900")}

            ${statCard("Negative available", summary.negativeAvailable, summary.negativeAvailable ? "text-red-700" : "text-gray-900")}

          </div>



          <section class="border-4 border-blue-600 rounded-xl p-4 bg-blue-50/40 space-y-3">

            <div>

              <h3 class="text-sm font-black uppercase tracking-[.08em] text-blue-900">Amazon FBM Quantity Sync</h3>

              <p class="text-xs text-blue-900/80 mt-1">Pushes <strong>Inventory Available</strong> to Amazon FBM for mapped listings with <code class="font-mono text-[11px]">update_qty</code> action. AFN/FBA and unmapped listings are skipped.</p>

            </div>

            <p class="text-xs"><strong>${esc(pushCount)}</strong> eligible FBM candidate(s) · Negative available clamped to <strong>0</strong> on push.</p>

            ${

              amazonRows

                ? `<div class="overflow-x-auto border-2 border-blue-200 rounded-xl bg-white">

              <table class="w-full text-left min-w-[420px]">

                <thead class="bg-blue-50 text-[10px] font-black uppercase tracking-[.1em] text-blue-800">

                  <tr>

                    <th class="py-2 px-2">SKU</th>

                    <th class="py-2 px-2 text-right">Amazon now</th>

                    <th class="py-2 px-2 text-right">Target avail</th>

                    <th class="py-2 px-2">Seller SKU</th>

                  </tr>

                </thead>

                <tbody>${amazonRows}</tbody>

              </table>

            </div>`

                : `<p class="text-sm text-blue-800/70">No Amazon FBM update candidates right now.</p>`

            }

            <div class="flex flex-wrap gap-2">

              <button type="button" data-amazon-sync-preview class="border-2 border-blue-800 bg-white text-blue-900 px-3 py-2 text-xs font-black uppercase min-h-[44px] hover:bg-blue-100 disabled:opacity-50" ${pushCount ? "" : "disabled"}>

                Validate (preview)

              </button>

              <button type="button" data-amazon-sync-push class="border-2 border-black bg-blue-700 text-white px-3 py-2 text-xs font-black uppercase min-h-[44px] hover:bg-blue-800 disabled:opacity-50" ${pushCount ? "" : "disabled"}>

                ${pushing ? "Syncing…" : "Sync Amazon FBM"}

              </button>

            </div>

            <p class="text-[10px] text-blue-900/70">Live push requires <code class="font-mono">AMAZON_ENABLE_LIVE_PATCH=true</code>. Max 25 listings per run.</p>

          </section>



          ${renderEbayReadinessSection(summary)}

          ${renderEbayQuantityPushSection(ebayPushCandidates || [], { pushResult: ebayPushResult, pushing: ebayPushing })}

          ${renderEbayRelistAssistSection(ebayRelistCandidates || [])}

          ${renderRecentSyncFailuresSection(recentSyncFailures)}

          ${

            pushResult

              ? `<section class="border-2 border-gray-300 rounded-xl p-3 bg-gray-50 space-y-2">

            <h3 class="text-xs font-black uppercase tracking-[.1em]">${pushResult.preview ? "Preview" : "Push"} results</h3>

            <p class="text-xs">Run <span class="font-mono">${esc(pushResult.runId || "—")}</span> · OK ${esc(pushResult.summary?.succeeded ?? 0)} · Failed ${esc(pushResult.summary?.failed ?? 0)} · Skipped ${esc(pushResult.summary?.skipped ?? 0)}</p>

            ${renderPushResultRows(pushResult.results)}

          </section>`

              : ""

          }



          <p class="text-xs text-gray-600">Variants considered: <strong>${esc(summary.totalVariants)}</strong></p>

          ${

            sampleRows

              ? `<div class="overflow-x-auto border-2 border-gray-200 rounded-xl">

            <table class="w-full text-left min-w-[640px]">

              <thead class="bg-gray-50 text-[10px] font-black uppercase tracking-[.1em] text-gray-500">

                <tr>

                  <th class="py-2 px-2">SKU</th>

                  <th class="py-2 px-2">Product</th>

                  <th class="py-2 px-2 text-right">Avail</th>

                  <th class="py-2 px-2">KK</th>

                  <th class="py-2 px-2">Amazon</th>

                  <th class="py-2 px-2">eBay</th>

                </tr>

              </thead>

              <tbody>${sampleRows}</tbody>

            </table>

          </div>`

              : ""

          }

        </div>

      </div>

    </div>

  `;



  mount.querySelectorAll("[data-sync-dry-run-close]").forEach((btn) => {

    btn.addEventListener("click", closeModal);

  });



  mount.querySelector("[data-amazon-sync-preview]")?.addEventListener("click", () => {

    runAmazonSync({ preview: true, summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, opts });

  });



  mount.querySelector("[data-amazon-sync-push]")?.addEventListener("click", () => {

    const n = amazonCandidates.length;

    const msg = `Sync Amazon FBM quantity to Inventory Available for ${n} listing(s)?\n\nThis updates Amazon FBM quantity only. KK stock and reservations are not changed.`;

    if (!window.confirm(msg)) return;

    runAmazonSync({ preview: false, summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, opts });

  });



  wireEbayReadinessActions(mount, async () => {

    const [newSummary, refreshedAmazon, refreshedRelist, refreshedEbayPush] = await Promise.all([

      fetchChannelSyncPreview(),

      fetchAmazonPushCandidates(),

      fetchEbayRelistCandidates(),

      fetchEbayPushCandidates(),

    ]);

    renderContent(newSummary, refreshedAmazon, refreshedRelist, refreshedEbayPush, opts);

  });

  wireEbayRelistAssistActions(mount);

  wireEbayQuantityPushActions(mount, ebayPushCandidates || [], async (patchOpts = {}) => {

    if (patchOpts.refreshAfterPush) {

      const [newSummary, refreshedAmazon, refreshedRelist, refreshedEbayPush] = await Promise.all([

        fetchChannelSyncPreview(),

        fetchAmazonPushCandidates(),

        fetchEbayRelistCandidates(),

        fetchEbayPushCandidates(),

      ]);

      renderContent(newSummary, refreshedAmazon, refreshedRelist, refreshedEbayPush, {

        ...opts,

        ebayPushResult: patchOpts.ebayPushResult ?? opts.ebayPushResult,

        ebayPushing: false,

      });

      return;

    }

    renderContent(summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, {

      ...opts,

      ...patchOpts,

    });

  });

}



async function runAmazonSync({ preview, summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, opts = {} }) {

  if (!getMount()) return;



  renderContent(summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, { ...opts, pushing: true });



  try {

    const pushResult = await pushAmazonFbmInventory({ preview, limit: 25 });



    renderContent(summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, { ...opts, pushResult, pushing: false });



    if (!preview && pushResult.summary?.succeeded > 0) {

      const { refreshInventoryAfterAdjustment } = await import("../services/refreshInventoryData.js");

      await refreshInventoryAfterAdjustment().catch(() => {});

    }



    const { showInventoryToast } = await import("../events.js");

    const mode = preview ? "Preview" : "Push";

    showInventoryToast(

      `${mode} complete: ${pushResult.summary?.succeeded ?? 0} ok, ${pushResult.summary?.failed ?? 0} failed`,

      { variant: pushResult.summary?.failed ? "error" : "success" },

    );



    if (!preview) {

      const [newSummary, refreshed, refreshedRelist, refreshedEbayPush] = await Promise.all([

        fetchChannelSyncPreview(),

        fetchAmazonPushCandidates(),

        fetchEbayRelistCandidates(),

        fetchEbayPushCandidates(),

      ]);

      renderContent(newSummary, refreshed, refreshedRelist, refreshedEbayPush, { ...opts, pushResult, pushing: false });

    }

  } catch (err) {

    const { showInventoryToast } = await import("../events.js");

    let msg = err instanceof Error ? err.message : String(err);

    if (err?.hint) msg += ` (${err.hint})`;

    showInventoryToast(msg, { variant: "error" });

    renderContent(summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, { ...opts, pushing: false });

  }

}



/** Open sync modal with preview + Amazon push. */
/** @param {Object} [opts]
 * @param {string} [opts.highlightVariantId]
 * @param {string} [opts.highlightSku]
 * @param {string} [opts.contextNote]
 */
export async function openSyncDryRunModal(opts = {}) {

  const mount = getMount();

  if (!mount) return;



  mount.innerHTML = `<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"><p class="bg-white border-2 border-black px-4 py-3 font-bold text-sm">Loading sync preview…</p></div>`;

  document.body.classList.add("overflow-hidden");



  try {

    const [summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, recentSyncFailures] = await Promise.all([

      fetchChannelSyncPreview(),

      fetchAmazonPushCandidates(),

      fetchEbayRelistCandidates(),

      fetchEbayPushCandidates(),

      fetchRecentSyncFailureRows(6).catch(() => []),

    ]);

    renderContent(summary, amazonCandidates, ebayRelistCandidates, ebayPushCandidates, {
      recentSyncFailures,
      ...opts,
    });

  } catch (err) {

    mount.innerHTML = `

      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">

        <div class="bg-white border-4 border-black rounded-xl p-4 max-w-md">

          <p class="font-black text-red-700">Preview failed</p>

          <p class="text-sm mt-2">${esc(err instanceof Error ? err.message : String(err))}</p>

          <button type="button" data-sync-dry-run-close class="mt-4 border-2 border-black px-3 py-2 text-xs font-black uppercase">Close</button>

        </div>

      </div>`;

    mount.querySelector("[data-sync-dry-run-close]")?.addEventListener("click", closeModal);

  }

}


