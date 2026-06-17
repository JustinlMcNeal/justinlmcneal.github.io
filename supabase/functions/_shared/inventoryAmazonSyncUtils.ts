/** Inventory channel sync — candidate loading + run logging (Phase 7C). */

import {
  BULK_PATCH_MAX_ITEMS,
  processPerListingQuantityPatches,
  type PerListingQuantityItem,
} from "./amazonBulkPatchUtils.ts";

export const INVENTORY_AMAZON_SYNC_DEFAULT_LIMIT = 25;

export type AmazonSyncCandidate = {
  variant_id: string;
  product_id: string;
  amazon_listing_id: string;
  amazon_seller_sku: string | null;
  amazon_current_qty: number | null;
  available_qty: number;
  available_qty_nonneg: number;
  internal_sku: string | null;
  product_label: string | null;
  amazon_sync_action: string;
};

export type InventorySyncRunRow = {
  id: string;
  channel: string;
  mode: string;
  status: string;
};

function clampTargetQty(availableQty: number | null | undefined): number {
  const n = Number(availableQty ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export function targetQtyFromAvailable(
  availableQty: number | null | undefined,
  availableQtyNonneg?: number | null,
): number {
  if (availableQtyNonneg != null && Number.isFinite(Number(availableQtyNonneg))) {
    return Math.max(0, Math.trunc(Number(availableQtyNonneg)));
  }
  return clampTargetQty(availableQty);
}

const SYNC_CTX_UUID_RE = /^[0-9a-f-]{36}$/i;

export type InventorySyncRunContext = {
  triggerSource?: string | null;
  triggerReferenceType?: string | null;
  triggerReferenceId?: string | null;
  stockLedgerId?: string | null;
  orchestrationId?: string | null;
};

/** Parse optional syncContext from edge function POST body (Phase 059A.4). */
export function parseInventorySyncRunContext(value: unknown): InventorySyncRunContext {
  if (!value || typeof value !== "object") return {};
  const o = value as Record<string, unknown>;
  const str = (snake: string, camel: string) => {
    const raw = o[snake] ?? o[camel];
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed || null;
  };
  const uuid = (snake: string, camel: string) => {
    const s = str(snake, camel);
    return s && SYNC_CTX_UUID_RE.test(s) ? s : null;
  };
  return {
    triggerSource: str("trigger_source", "triggerSource"),
    triggerReferenceType: str("trigger_reference_type", "triggerReferenceType"),
    triggerReferenceId: uuid("trigger_reference_id", "triggerReferenceId"),
    stockLedgerId: uuid("stock_ledger_id", "stockLedgerId"),
    orchestrationId: str("orchestration_id", "orchestrationId"),
  };
}

export async function loadAmazonSyncCandidates(
  // deno-lint-ignore no-explicit-any
  client: any,
  filters: {
    variantIds?: string[];
    amazonListingIds?: string[];
    limit?: number;
  },
): Promise<AmazonSyncCandidate[]> {
  let query = client
    .from("v_inventory_channel_sync_candidates")
    .select([
      "variant_id",
      "product_id",
      "amazon_listing_id",
      "amazon_seller_sku",
      "amazon_current_qty",
      "available_qty",
      "available_qty_nonneg",
      "internal_sku",
      "product_label",
      "amazon_sync_action",
      "amazon_is_afn",
    ].join(","))
    .eq("amazon_sync_action", "update_qty");

  if (filters.variantIds?.length) {
    query = query.in("variant_id", filters.variantIds);
  }
  if (filters.amazonListingIds?.length) {
    query = query.in("amazon_listing_id", filters.amazonListingIds);
  }

  const cap = Math.min(
    Math.max(1, filters.limit ?? INVENTORY_AMAZON_SYNC_DEFAULT_LIMIT),
    BULK_PATCH_MAX_ITEMS,
  );

  const { data, error } = await query.limit(cap);
  if (error) throw new Error("database_error");

  return ((data || []) as AmazonSyncCandidate[]).filter((row) => {
    if (!row.amazon_listing_id) return false;
    if (!String(row.amazon_seller_sku || "").trim()) return false;
    return row.amazon_sync_action === "update_qty";
  });
}

export async function createInventorySyncRun(
  // deno-lint-ignore no-explicit-any
  client: any,
  params: {
    channel?: string;
    mode: "dry_run" | "push" | "cache_refresh";
    requestedBy?: string | null;
    candidateCount: number;
    notes?: string | null;
    triggerSource?: string | null;
    triggerReferenceType?: string | null;
    triggerReferenceId?: string | null;
    stockLedgerId?: string | null;
    orchestrationId?: string | null;
  },
): Promise<InventorySyncRunRow | null> {
  const { data, error } = await client
    .from("inventory_channel_sync_runs")
    .insert({
      channel: params.channel ?? "amazon",
      mode: params.mode,
      status: "running",
      requested_by: params.requestedBy ?? null,
      candidate_count: params.candidateCount,
      notes: params.notes ?? null,
      trigger_source: params.triggerSource ?? null,
      trigger_reference_type: params.triggerReferenceType ?? null,
      trigger_reference_id: params.triggerReferenceId ?? null,
      stock_ledger_id: params.stockLedgerId ?? null,
      orchestration_id: params.orchestrationId ?? null,
    })
    .select("id, channel, mode, status")
    .single();

  if (error) {
    console.warn("[inventoryAmazonSync] run insert failed:", error.message);
    return null;
  }
  return data as InventorySyncRunRow;
}

export async function logInventorySyncResult(
  // deno-lint-ignore no-explicit-any
  client: any,
  row: {
    runId: string;
    variantId?: string | null;
    productId?: string | null;
    amazonListingId?: string | null;
    sellerSku?: string | null;
    marketplaceId?: string | null;
    previousQty?: number | null;
    targetQty?: number | null;
    status: "success" | "failed" | "skipped";
    action?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    responseRef?: string | null;
    ebayOfferId?: string | null;
    ebayListingId?: string | null;
  },
): Promise<void> {
  const { error } = await client.from("inventory_channel_sync_results").insert({
    run_id: row.runId,
    variant_id: row.variantId ?? null,
    product_id: row.productId ?? null,
    amazon_listing_id: row.amazonListingId ?? null,
    seller_sku: row.sellerSku ?? null,
    marketplace_id: row.marketplaceId ?? null,
    ebay_offer_id: row.ebayOfferId ?? null,
    ebay_listing_id: row.ebayListingId ?? null,
    previous_qty: row.previousQty ?? null,
    target_qty: row.targetQty ?? null,
    status: row.status,
    action: row.action ?? "set_quantity",
    error_code: row.errorCode ?? null,
    error_message: row.errorMessage ?? null,
    response_ref: row.responseRef ?? null,
  });
  if (error) {
    console.warn("[inventoryAmazonSync] result insert failed:", error.message);
  }
}

export async function finalizeInventorySyncRun(
  // deno-lint-ignore no-explicit-any
  client: any,
  runId: string,
  summary: { succeeded: number; failed: number; skipped: number },
  now: string,
): Promise<void> {
  const status = summary.failed > 0 && summary.succeeded > 0
    ? "partial"
    : summary.failed > 0
    ? "failed"
    : "complete";

  await client
    .from("inventory_channel_sync_runs")
    .update({
      status,
      success_count: summary.succeeded,
      failed_count: summary.failed,
      skipped_count: summary.skipped,
      completed_at: now,
    })
    .eq("id", runId);
}

export function candidatesToPatchItems(
  candidates: AmazonSyncCandidate[],
): PerListingQuantityItem[] {
  return candidates.map((c) => ({
    amazonListingId: String(c.amazon_listing_id),
    quantity: targetQtyFromAvailable(c.available_qty, c.available_qty_nonneg),
    variantId: c.variant_id,
    productId: c.product_id,
    sellerSku: c.amazon_seller_sku,
    previousQty: c.amazon_current_qty,
  }));
}

export { processPerListingQuantityPatches };
