/**
 * Adjust modal channel preview controller (Phase 059A.2; 060C.2 variation preview).
 * Read-only preview — no channel sync execution.
 */

import { fetchChannelSyncCandidateForVariant } from "../api/channelSyncCandidateApi.js";
import { fetchEbayVariationChildCandidate } from "../api/ebayVariationCandidateApi.js";
import { fetchEbayVariationRelistCandidate } from "../api/ebayVariationRelistCandidateApi.js";
import { buildAdjustChannelPreviewState } from "../services/adjustChannelPreview.js";
import {
  shouldFetchVariationChildCandidate,
  shouldFetchVariationRelistCandidate,
} from "../services/adjustChannelVariationPreview.js";
import { computeAdjustment } from "../services/adjustmentMath.js";
import {
  renderAdjustChannelPreviewCards,
  renderAdjustChannelPreviewError,
  syncToggleHintText,
} from "../renderers/renderAdjustChannelPreview.js";

/** @type {import('../api/channelSyncCandidateApi.js').VariantChannelBundle|null} */
let channelBundle = null;

/** @type {import('../api/ebayVariationCandidateApi.js').EbayVariationChildCandidateRow|null} */
let variationChildCandidate = null;

/** @type {import('../api/ebayVariationRelistCandidateApi.js').EbayVariationGroupRelistCandidateRow|null} */
let variationRelistCandidate = null;

/** @type {boolean} */
let syncToggleUserSet = false;

export function resetAdjustChannelPreviewState() {
  channelBundle = null;
  variationChildCandidate = null;
  variationRelistCandidate = null;
  syncToggleUserSet = false;
}

/**
 * @param {HTMLElement} mount
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 */
export async function loadAdjustChannelPreview(mount, row) {
  const body = mount.querySelector("[data-adjust-channel-body]");
  if (!body) return;

  body.innerHTML = `<p class="text-xs text-gray-500 animate-pulse" data-adjust-channel-loading aria-busy="true">Loading marketplace status…</p>`;
  setSyncToggleInteractivity(mount, false);

  try {
    channelBundle = await fetchChannelSyncCandidateForVariant(row.id);
    variationChildCandidate = null;
    variationRelistCandidate = null;

    const candidate = channelBundle?.candidate ?? null;
    const relist = channelBundle?.relist ?? null;
    const productId = candidate?.product_id ?? null;

    const loads = [];
    if (shouldFetchVariationChildCandidate(candidate, relist)) {
      loads.push(
        fetchEbayVariationChildCandidate({ productId, variantId: row.id }).then((row) => {
          variationChildCandidate = row;
        }),
      );
    }
    if (shouldFetchVariationRelistCandidate(candidate, relist)) {
      loads.push(
        fetchEbayVariationRelistCandidate({ productId }).then((row) => {
          variationRelistCandidate = row;
        }),
      );
    }
    if (loads.length) await Promise.all(loads);

    syncToggleUserSet = false;
    refreshAdjustChannelPreview(mount, row);
  } catch (err) {
    channelBundle = null;
    variationChildCandidate = null;
    variationRelistCandidate = null;
    const message = err instanceof Error ? err.message : String(err);
    body.innerHTML = renderAdjustChannelPreviewError(message);
    setSyncToggleInteractivity(mount, false);
  }
}

/**
 * @param {HTMLElement} mount
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 */
export function refreshAdjustChannelPreview(mount, row) {
  const body = mount.querySelector("[data-adjust-channel-body]");
  const section = mount.querySelector("[data-adjust-channel-section]");
  if (!body || !section) return;

  const form = mount.querySelector("#inventoryAdjustForm");
  const mode = /** @type {'add'|'remove'|'set'} */ (
    form?.querySelector('input[name="adjustMode"]:checked')?.value || "add"
  );
  const qtyRaw = /** @type {HTMLInputElement|null} */ (form?.querySelector("#inventoryAdjustQty"))?.value;
  const quantity = qtyRaw === "" ? NaN : Number(qtyRaw);
  const adjustment = computeAdjustment(mode, row.onHand, quantity);

  const state = buildAdjustChannelPreviewState({
    candidate: channelBundle?.candidate ?? null,
    relist: channelBundle?.relist ?? null,
    variationChild: variationChildCandidate,
    variationRelist: variationRelistCandidate,
    adjustment,
    fallbackOnHand: row.onHand,
    fallbackReserved: row.reserved,
  });

  const toggleEnabled = state.syncToggleDefault;
  const toggleEl = section.querySelector("[data-adjust-sync-toggle]");
  let checked = toggleEl instanceof HTMLInputElement ? toggleEl.checked : false;

  if (!syncToggleUserSet) {
    checked = state.syncToggleDefault;
  } else if (!toggleEnabled) {
    checked = false;
  }

  body.innerHTML = `<div class="grid gap-2 sm:grid-cols-3" data-adjust-channel-cards>${renderAdjustChannelPreviewCards(state)}</div>`;

  applySyncToggleState(mount, { checked, enabled: toggleEnabled });
}

/**
 * @param {HTMLElement} mount
 * @param {{ checked: boolean, enabled: boolean }} toggle
 */
function applySyncToggleState(mount, toggle) {
  const input = mount.querySelector("[data-adjust-sync-toggle]");
  const hint = mount.querySelector("[data-adjust-sync-toggle-hint]");
  if (input instanceof HTMLInputElement) {
    input.checked = toggle.checked;
    input.disabled = !toggle.enabled;
  }
  if (hint) hint.textContent = syncToggleHintText(toggle);
  setSyncToggleInteractivity(mount, toggle.enabled);
}

/**
 * @param {HTMLElement} mount
 * @param {(ev: Event) => void} onUserToggle
 */
export function wireAdjustChannelPreview(mount, onUserToggle) {
  const toggle = mount.querySelector("[data-adjust-sync-toggle]");
  toggle?.addEventListener("change", onUserToggle);
}

/** @param {Event} _ev */
export function markAdjustSyncToggleUserSet(_ev) {
  syncToggleUserSet = true;
}

/** @param {HTMLElement} mount */
export function isAdjustSyncChannelsEnabled(mount) {
  const el = mount.querySelector("[data-adjust-sync-toggle]");
  return el instanceof HTMLInputElement && el.checked && !el.disabled;
}

/** @param {HTMLElement} mount @param {boolean} enabled */
function setSyncToggleInteractivity(mount, enabled) {
  const wrap = mount.querySelector("[data-adjust-sync-toggle-wrap]");
  if (wrap) wrap.classList.toggle("opacity-60", !enabled);
}
