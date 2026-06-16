/**
 * Virtual bundle simulation + shadow events API (Phase 10C).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @typedef {Object} BundleSimulationComponent
 * @property {string} componentVariantId
 * @property {string} componentSku
 * @property {number} componentAvailable
 * @property {number} componentQtyPerBundle
 * @property {number} requiredQty
 * @property {number} shortageQty
 * @property {number} wouldReserveQty
 * @property {number} wouldFinalizeQty
 * @property {boolean} isMissing
 */

/** @typedef {Object} BundleSimulationResult
 * @property {boolean} ok
 * @property {boolean} simulationOnly
 * @property {string} bundleVariantId
 * @property {string} bundleLabel
 * @property {string} bundleSku
 * @property {number} requestedQuantity
 * @property {number} bundleOnHand
 * @property {number} bundleReserved
 * @property {number} bundleAvailable
 * @property {number|null} virtualAvailability
 * @property {string} globalMode
 * @property {string} bundleMode
 * @property {string} result
 * @property {boolean} canFulfillVirtual
 * @property {boolean} independentStockWarning
 * @property {BundleSimulationComponent[]} components
 * @property {unknown[]} previewReservations
 * @property {unknown[]} previewLedger
 * @property {string} [error]
 */

/** @typedef {Object} CutoverReadinessRow
 * @property {string} bundleVariantId
 * @property {string} bundleLabel
 * @property {string} bundleMode
 * @property {string} globalMode
 * @property {string} effectiveShadowMode
 * @property {boolean} shadowModeActive
 * @property {number} shadowEventCount
 * @property {string|null} lastShadowEventAt
 * @property {boolean} isReadyForShadow
 * @property {boolean} isReadyForLiveRequest
 * @property {boolean} isReadyForLive
 * @property {boolean} liveDeductionEnabled
 * @property {boolean} isVirtualEnabled
 * @property {boolean} hasIndependentStockWarning
 * @property {boolean} independentStockAcknowledged
 * @property {number} simulationCount
 * @property {number} reservationShadowCount
 * @property {number} finalizeShadowCount
 * @property {number} shortageShadowCount
 * @property {string|null} lastShadowResult
 * @property {string[]} blockerReasons
 */

/** @typedef {Object} ShadowEventRow
 * @property {string} id
 * @property {string} eventType
 * @property {string} bundleVariantId
 * @property {string} bundleLabel
 * @property {number} quantity
 * @property {string|null} sourceOrderId
 * @property {string|null} sourceOrderItemId
 * @property {string} simulationResultCode
 * @property {boolean} canFulfillVirtual
 * @property {boolean} independentStockWarning
 * @property {string} createdAt
 */

/** @param {Record<string, unknown>} raw @returns {BundleSimulationResult} */
export function mapSimulationResult(raw) {
  const components = Array.isArray(raw.components)
    ? raw.components.map((c) => {
        const row = /** @type {Record<string, unknown>} */ (c);
        return {
          componentVariantId: String(row.component_variant_id ?? ""),
          componentSku: String(row.component_sku ?? ""),
          componentAvailable: Number(row.component_available ?? 0),
          componentQtyPerBundle: Number(row.component_qty_per_bundle ?? 0),
          requiredQty: Number(row.required_qty ?? 0),
          shortageQty: Number(row.shortage_qty ?? 0),
          wouldReserveQty: Number(row.would_reserve_qty ?? 0),
          wouldFinalizeQty: Number(row.would_finalize_qty ?? 0),
          isMissing: Boolean(row.is_missing),
        };
      })
    : [];

  return {
    ok: Boolean(raw.ok),
    simulationOnly: Boolean(raw.simulation_only ?? true),
    bundleVariantId: String(raw.bundle_variant_id ?? ""),
    bundleLabel: String(raw.bundle_label ?? ""),
    bundleSku: String(raw.bundle_sku ?? ""),
    requestedQuantity: Number(raw.requested_quantity ?? 0),
    bundleOnHand: Number(raw.bundle_on_hand ?? 0),
    bundleReserved: Number(raw.bundle_reserved ?? 0),
    bundleAvailable: Number(raw.bundle_available ?? 0),
    virtualAvailability: raw.virtual_availability == null ? null : Number(raw.virtual_availability),
    globalMode: String(raw.global_mode ?? "preview_only"),
    bundleMode: String(raw.bundle_mode ?? "preview_only"),
    result: String(raw.result ?? ""),
    canFulfillVirtual: Boolean(raw.can_fulfill_virtual),
    independentStockWarning: Boolean(raw.independent_stock_warning),
    components,
    previewReservations: Array.isArray(raw.preview_reservations) ? raw.preview_reservations : [],
    previewLedger: Array.isArray(raw.preview_ledger) ? raw.preview_ledger : [],
    error: raw.error ? String(raw.error) : undefined,
  };
}

/** @param {string} bundleVariantId @param {number} quantity @returns {Promise<BundleSimulationResult & { raw: Record<string, unknown> }>} */
export async function simulateVirtualBundleOrder(bundleVariantId, quantity) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("simulate_virtual_bundle_order", {
    p_bundle_variant_id: bundleVariantId,
    p_quantity: quantity,
  });
  if (error) throw new Error(error.message || "Simulation failed");
  const raw = /** @type {Record<string, unknown>} */ (data ?? {});
  return { ...mapSimulationResult(raw), raw };
}

/**
 * @param {Object} input
 * @param {string} input.eventType
 * @param {string} input.bundleVariantId
 * @param {number} input.quantity
 * @param {Record<string, unknown>} input.simulationResult
 */
export async function recordBundleShadowEvent(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("record_inventory_bundle_shadow_event", {
    p_event_type: input.eventType,
    p_bundle_variant_id: input.bundleVariantId,
    p_quantity: input.quantity,
    p_simulation_result: input.simulationResult,
    p_source_order_id: input.sourceOrderId ?? null,
    p_source_order_item_id: input.sourceOrderItemId ?? null,
  });
  if (error) throw new Error(error.message || "Failed to save shadow event");
  return data;
}

/** @returns {Promise<{ globalMode: string, allowPerBundleLive: boolean }>} */
export async function fetchBundleGlobalSettings() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("inventory_bundle_settings")
    .select("virtual_bundle_mode, allow_per_bundle_live")
    .eq("setting_key", "global")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    globalMode: String(data?.virtual_bundle_mode ?? "preview_only"),
    allowPerBundleLive: Boolean(data?.allow_per_bundle_live),
  };
}

/** @returns {Promise<CutoverReadinessRow[]>} */
export async function fetchCutoverReadiness() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_bundle_cutover_readiness")
    .select("*")
    .order("bundle_label");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    bundleVariantId: String(row.bundle_variant_id ?? ""),
    bundleLabel: String(row.bundle_label ?? ""),
    bundleMode: String(row.bundle_mode ?? "preview_only"),
    globalMode: String(row.global_mode ?? "preview_only"),
    effectiveShadowMode: String(row.effective_shadow_mode ?? "preview_only"),
    shadowModeActive: Boolean(row.shadow_mode_active),
    shadowEventCount: Number(row.shadow_event_count ?? 0),
    lastShadowEventAt: row.last_shadow_event_at ? String(row.last_shadow_event_at) : null,
    simulationCount: Number(row.simulation_count ?? 0),
    reservationShadowCount: Number(row.reservation_shadow_count ?? 0),
    finalizeShadowCount: Number(row.finalize_shadow_count ?? 0),
    shortageShadowCount: Number(row.shortage_shadow_count ?? 0),
    lastShadowResult: row.last_shadow_result ? String(row.last_shadow_result) : null,
    isVirtualEnabled: Boolean(row.is_virtual_enabled),
    hasIndependentStockWarning: Boolean(row.has_independent_stock_warning),
    independentStockAcknowledged: Boolean(row.independent_stock_acknowledged),
    isReadyForShadow: Boolean(row.is_ready_for_shadow),
    isReadyForLiveRequest: Boolean(row.is_ready_for_live_request),
    isReadyForLive: Boolean(row.is_ready_for_live),
    liveDeductionEnabled: Boolean(row.live_deduction_enabled),
    blockerReasons: Array.isArray(row.blocker_reasons) ? row.blocker_reasons.map(String) : [],
  }));
}

/** @param {string} bundleVariantId @param {string|null} [note] */
export async function acknowledgeIndependentStock(bundleVariantId, note = null) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("acknowledge_independent_bundle_stock", {
    p_bundle_variant_id: bundleVariantId,
    p_note: note,
  });
  if (error) throw new Error(error.message || "Acknowledgement failed");
  return data;
}

/** @param {string} bundleVariantId @param {string|null} [note] */
export async function requestBundleLiveEnablement(bundleVariantId, note = null) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("request_bundle_live_enablement", {
    p_bundle_variant_id: bundleVariantId,
    p_note: note,
  });
  if (error) throw new Error(error.message || "Live request failed");
  return data;
}

/** @param {string} bundleVariantId */
export async function enableBundleVirtual(bundleVariantId) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("enable_bundle_virtual_flag", {
    p_bundle_variant_id: bundleVariantId,
  });
  if (error) throw new Error(error.message || "Failed to enable virtual flag");
  return data;
}

/** @param {boolean} allow */
export async function setAllowPerBundleLive(allow) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("set_inventory_bundle_allow_per_bundle_live", {
    p_allow: allow,
  });
  if (error) throw new Error(error.message || "Failed to update staging flag");
  return data;
}

/** Enable global live mode (requires allow_per_bundle_live). */
export async function enableGlobalBundleLiveMode() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("enable_inventory_bundle_global_live_mode");
  if (error) throw new Error(error.message || "Failed to enable global live mode");
  return data;
}

/** @param {string} bundleVariantId @param {string|null} [note] */
export async function enableBundleLiveMode(bundleVariantId, note = null) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("enable_bundle_live_mode", {
    p_bundle_variant_id: bundleVariantId,
    p_note: note,
  });
  if (error) throw new Error(error.message || "Failed to enable live mode");
  return data;
}

/**
 * @param {string} bundleVariantId
 * @param {string} [targetMode]
 * @param {string|null} [note]
 */
export async function revertBundleLiveMode(bundleVariantId, targetMode = "shadow", note = null) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("revert_bundle_live_mode", {
    p_bundle_variant_id: bundleVariantId,
    p_target_mode: targetMode,
    p_note: note,
  });
  if (error) throw new Error(error.message || "Failed to revert live mode");
  return data;
}

/** @param {string} bundleVariantId @param {boolean} [forLiveRequest] */
export async function evaluateBundleLiveReadiness(bundleVariantId, forLiveRequest = true) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("evaluate_bundle_live_readiness", {
    p_bundle_variant_id: bundleVariantId,
    p_for_live_request: forLiveRequest,
  });
  if (error) throw new Error(error.message || "Readiness evaluation failed");
  return data;
}

/** @param {string} mode */
export async function updateBundleGlobalMode(mode) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("update_inventory_bundle_global_mode", {
    p_mode: mode,
  });
  if (error) throw new Error(error.message || "Failed to update global mode");
  return data;
}

/**
 * @param {string} bundleVariantId
 * @param {string} mode
 * @param {boolean} [isVirtualEnabled]
 */
export async function updateBundleVariantMode(bundleVariantId, mode, isVirtualEnabled) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("update_inventory_bundle_variant_mode", {
    p_bundle_variant_id: bundleVariantId,
    p_mode: mode,
    p_is_virtual_enabled: isVirtualEnabled ?? null,
  });
  if (error) throw new Error(error.message || "Failed to update bundle mode");
  return data;
}

/** @param {number} [limit] @returns {Promise<ShadowEventRow[]>} */
export async function fetchRecentShadowEvents(limit = 30) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_bundle_shadow_events_recent")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    eventType: String(row.event_type ?? ""),
    bundleVariantId: String(row.bundle_variant_id ?? ""),
    bundleLabel: String(row.bundle_label ?? ""),
    quantity: Number(row.quantity ?? 0),
    sourceOrderId: row.source_order_id ? String(row.source_order_id) : null,
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    simulationResultCode: String(row.simulation_result_code ?? "unknown"),
    canFulfillVirtual: Boolean(row.can_fulfill_virtual),
    independentStockWarning: Boolean(row.independent_stock_warning),
    createdAt: String(row.created_at ?? ""),
  }));
}
