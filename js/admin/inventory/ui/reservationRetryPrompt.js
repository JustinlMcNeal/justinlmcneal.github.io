/**
 * Shared reservation retry prompt UI (Phase 8D).
 */

import { esc } from "../utils/formatters.js";
import {
  fetchReservationRetryCandidate,
  retryReservationForOrderLine,
  reservationImpactCopy,
} from "../api/reservationRetryApi.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";
import { showInventoryToast } from "../events.js";

/**
 * @param {HTMLElement} mount
 * @param {import('../api/reservationRetryApi.js').ReservationRetryCandidate} candidate
 * @param {{ onComplete?: () => void }} [opts]
 */
export function renderReservationRetrySection(mount, candidate, opts = {}) {
  if (!mount) return;

  if (!candidate.isEligible) {
    mount.innerHTML = `
      <div class="border border-gray-200 rounded-lg p-3 text-xs bg-gray-50 space-y-1">
        <p class="font-black uppercase text-[10px] text-gray-500">Reservation Retry</p>
        <p class="text-gray-600">${esc(candidate.reason || "Not eligible for reservation retry.")}</p>
        <p class="text-[10px] text-gray-400">Action: ${esc(candidate.suggestedAction)}</p>
      </div>`;
    return;
  }

  const impact = reservationImpactCopy(candidate);

  mount.innerHTML = `
    <div class="border border-indigo-200 rounded-lg p-3 text-xs bg-indigo-50/80 space-y-2">
      <p class="font-black uppercase text-[10px] text-indigo-900">Reservation Retry</p>
      <p class="text-indigo-950">${esc(candidate.reason)}</p>
      <p class="text-[11px] text-indigo-900">
        This reserves available stock for this already-paid order. It does <strong>not</strong> decrement on-hand until shipment/finalization.
      </p>
      <ul class="text-[11px] text-indigo-900 space-y-0.5">
        <li>Reserved: <strong>${esc(impact.reservedDelta)}</strong></li>
        <li>Available: <strong>${esc(impact.availableDelta)}</strong></li>
        <li>On-hand: <strong>${esc(impact.onHandDelta)}</strong></li>
      </ul>
      <button type="button" id="reservationRetryConfirmBtn" class="border-2 border-indigo-800 bg-indigo-800 text-white px-3 py-2 text-xs font-black uppercase min-h-[44px] w-full">
        Create Reservation
      </button>
    </div>`;

  mount.querySelector("#reservationRetryConfirmBtn")?.addEventListener("click", () => {
    void confirmReservationRetry(candidate, opts.onComplete);
  });
}

/**
 * @param {string} channel
 * @param {string} orderId
 * @param {string} orderItemId
 * @param {HTMLElement} mount
 * @param {{ onComplete?: () => void }} [opts]
 */
export async function loadAndRenderReservationRetry(channel, orderId, orderItemId, mount, opts = {}) {
  if (!mount) return null;
  mount.innerHTML = `<p class="text-xs text-gray-400" role="status">Checking reservation eligibility…</p>`;
  try {
    const candidate = await fetchReservationRetryCandidate(channel, orderId, orderItemId);
    if (!candidate) {
      mount.innerHTML = `<p class="text-xs text-gray-500">Line not found in retry candidates.</p>`;
      return null;
    }
    renderReservationRetrySection(mount, candidate, opts);
    return candidate;
  } catch (err) {
    mount.innerHTML = `<p class="text-xs text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
    return null;
  }
}

/**
 * @param {import('../api/reservationRetryApi.js').ReservationRetryCandidate} candidate
 * @param {(() => void)|undefined} onComplete
 */
async function confirmReservationRetry(candidate, onComplete) {
  const ok = window.confirm(
    `Create reservation for ${candidate.quantity} unit(s)?\n\nReserved +${candidate.quantity}, available −${candidate.quantity}, on-hand unchanged.`,
  );
  if (!ok) return;

  try {
    await retryReservationForOrderLine({
      sourceChannel: candidate.sourceChannel,
      sourceOrderId: candidate.sourceOrderId,
      sourceOrderItemId: candidate.sourceOrderItemId,
      expectedVariantId: candidate.variantId,
      note: "Admin reservation retry after mapping assist",
    });
    await refreshInventoryAfterIssueStateChange();
    showInventoryToast("Reservation created.", { variant: "success" });
    onComplete?.();
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

/** @param {import('../api/reservationRetryApi.js').ReservationRetryCandidate} candidate */
export async function promptReservationRetry(candidate) {
  if (!candidate.isEligible) {
    showInventoryToast(candidate.reason || "Not eligible for reservation retry.");
    return;
  }
  await confirmReservationRetry(candidate);
}
