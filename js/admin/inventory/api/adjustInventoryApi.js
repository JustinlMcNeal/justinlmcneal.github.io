/**
 * Manual inventory adjustment API (Phase 4).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const ALLOWED_REASONS = new Set([
  "count_correction",
  "damaged",
  "lost",
  "found",
  "returned_to_stock",
  "other",
]);

/**
 * @typedef {Object} AdjustInventoryParams
 * @property {string} variantId
 * @property {number} deltaQty
 * @property {string} reason
 * @property {string} note
 * @property {string} [referenceType]
 * @property {string} [referenceId]
 * @property {string} [idempotencyKey]
 */

/**
 * @typedef {Object} AdjustInventoryResult
 * @property {string} variantId
 * @property {string} productId
 * @property {number} delta
 * @property {number} stockBefore
 * @property {number} stockAfter
 * @property {string} ledgerId
 * @property {string} createdAt
 * @property {boolean} idempotentReplay
 */

/**
 * @param {AdjustInventoryParams} params
 * @returns {Promise<AdjustInventoryResult>}
 */
export async function adjustInventory(params) {
  await requireAuthenticatedSession();

  const reason = String(params.reason || "").trim();
  const note = String(params.note || "").trim();

  if (!params.variantId) throw new Error("Variant is required.");
  if (!Number.isFinite(params.deltaQty) || params.deltaQty === 0) {
    throw new Error("Adjustment quantity must be a non-zero number.");
  }
  if (!ALLOWED_REASONS.has(reason)) throw new Error("Select a valid adjustment reason.");
  if (!note) throw new Error("Note is required.");

  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("adjust_inventory", {
    p_variant_id: params.variantId,
    p_delta_qty: Math.trunc(params.deltaQty),
    p_reason: reason,
    p_note: note,
    p_reference_type: params.referenceType || "manual_adjust",
    p_reference_id: params.referenceId || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message || "Adjustment failed");

  const row = data && typeof data === "object" ? data : {};
  return {
    variantId: String(row.variant_id ?? params.variantId),
    productId: String(row.product_id ?? ""),
    delta: Number(row.delta ?? params.deltaQty),
    stockBefore: Number(row.stock_before ?? 0),
    stockAfter: Number(row.stock_after ?? 0),
    ledgerId: String(row.ledger_id ?? ""),
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    idempotentReplay: Boolean(row.idempotent_replay),
  };
}

export const ADJUSTMENT_REASONS = [
  { value: "count_correction", label: "Count correction" },
  { value: "damaged", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "found", label: "Found" },
  { value: "returned_to_stock", label: "Returned to stock" },
  { value: "other", label: "Other" },
];
