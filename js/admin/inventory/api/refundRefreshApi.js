/**
 * Stripe refund refresh API (Phase 10K — read-only cache).
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @param {string} sourceOrderId */
export async function refreshOrderRefundDetails(sourceOrderId) {
  await requireAuthenticatedSession();
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-refresh-refund-details`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ stripe_checkout_session_id: sourceOrderId }),
  });

  const result = await res.json();
  if (!res.ok || result.error) {
    throw new Error(result.error || `Refund refresh failed (${res.status})`);
  }
  return result;
}

/** @param {string} sourceOrderId @param {number} [limit] */
export async function fetchOrderRefundDetails(sourceOrderId, limit = 20) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("order_refund_details")
    .select("*")
    .eq("source_order_id", sourceOrderId)
    .order("refund_created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message || "Failed to load refund details");
  return data ?? [];
}

export const REFUND_GUIDANCE_LABELS = {
  no_refund: "No refund",
  full_refund_detected: "Full refund detected",
  partial_refund_detected: "Partial refund — review",
  line_refund_confirmed: "Line refund confirmed",
  cancellation_detected: "Cancellation detected",
  return_detected: "Return detected",
  marketplace_refund_review: "Marketplace refund — review",
  afn_external_fulfillment_review: "AFN/FBA — external review",
  refund_without_return_workflow: "Refund — no return workflow",
  refund_with_return_workflow_open: "Refund — return workflow open",
  refund_restock_review_needed: "Refund — restock review",
};

export const REFUND_SOURCE_LABELS = {
  stripe: "Stripe",
  ebay: "eBay",
  amazon: "Amazon",
  kk: "KK",
  none: "None",
};

export const REFUND_CONFIDENCE_LABELS = {
  none: "No refund data",
  low: "Low — order-level only",
  medium: "Medium — line inferred",
  high: "High — full or line confirmed",
  line_confirmed: "Line confirmed",
  line_inferred: "Line inferred",
  sku_inferred: "SKU inferred — review",
  order_level: "Order level",
  manual_review: "Manual review",
};

export const MARKETPLACE_EVIDENCE_LABELS = {
  order_sync: "Order sync signal",
  finance_sync: "Finance refund line reference",
  admin_backfill: "Backfill observation",
  cancellation: "Cancellation retained",
};

export const PANEL_ACTION_LABELS = {
  create_return_workflow: "Suggested: create return workflow",
  return_workflow_open: "Return workflow in progress",
  restock_review: "Review restock after return confirm",
  manual_review: "Manual review recommended",
};

export const MARKETPLACE_SYNC_SOURCE_LABELS = {
  order_sync: "Order sync",
  finance_sync: "Finance sync",
  webhook: "Webhook",
  admin_backfill: "Admin backfill",
};

/** @param {Object} [opts]
 * @param {string} [opts.channel]
 * @param {string} [opts.sourceOrderId]
 * @param {number} [opts.limit]
 */
export async function refreshMarketplaceObservations(opts = {}) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc(
    "backfill_marketplace_refund_observations",
    {
      p_channel: opts.channel ?? "all",
      p_since: null,
      p_limit: opts.limit ?? null,
      p_source_order_id: opts.sourceOrderId ?? null,
    },
  );
  if (error) throw new Error(error.message || "Marketplace observation refresh failed");
  return data;
}
