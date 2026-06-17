/** Amazon inactive FBM restock — candidate load + single-listing processing (Phase 059B.2). */

import { isFbaManagedListing } from "./amazonListingPatchUtils.ts";
import { submitAmazonOfferRestore } from "./amazonOfferRestoreUtils.ts";
import type { readSyncEnvConfig } from "./amazonSyncAccountUtils.ts";
import {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
  targetQtyFromAvailable,
  type InventorySyncRunContext,
} from "./inventoryAmazonSyncUtils.ts";

export type AmazonInactiveRestockCandidate = {
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
  amazon_is_afn: boolean;
  amazon_listing_status: string | null;
};

export type InactiveRestockResultStatus = "success" | "failed" | "skipped" | "dry_run";

export type InactiveRestockResultRow = {
  status: InactiveRestockResultStatus;
  mode: "inactive_restock";
  variantId: string | null;
  amazonListingId: string | null;
  sellerSku: string | null;
  targetQty: number | null;
  previousQty: number | null;
  message: string;
  offerRestore?: boolean;
  submissionStatus?: string | null;
  submissionId?: string | null;
  issues?: ReturnType<typeof import("./amazonListingPatchUtils.ts").mapPatchIssues>;
  error?: string | null;
};

const LISTING_SELECT = [
  "id",
  "seller_account_id",
  "seller_id",
  "marketplace_id",
  "seller_sku",
  "product_type",
  "currency",
  "fulfillment_channel",
  "fba_fulfillable_quantity",
  "fbm_quantity",
  "price",
  "asin",
  "listing_status",
  "listing_status_buyable",
  "raw_listing",
].join(",");

/** Load one inactive_can_update candidate for a variant (pool-safe single row). */
export async function loadAmazonInactiveRestockCandidate(
  // deno-lint-ignore no-explicit-any
  client: any,
  variantId: string,
): Promise<AmazonInactiveRestockCandidate | null> {
  const { data, error } = await client
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
      "amazon_listing_status",
    ].join(","))
    .eq("variant_id", variantId)
    .eq("amazon_sync_action", "inactive_can_update")
    .maybeSingle();

  if (error) throw new Error("database_error");
  if (!data) return null;

  const row = data as AmazonInactiveRestockCandidate;
  if (row.amazon_sync_action !== "inactive_can_update") return null;
  if (row.amazon_is_afn) return null;
  if (!row.amazon_listing_id || !String(row.amazon_seller_sku || "").trim()) return null;
  if (Number(row.available_qty) <= 0) return null;

  return row;
}

/** Fetch full amazon_listings row for offer-restore PUT. */
export async function fetchAmazonListingForOfferRestore(
  // deno-lint-ignore no-explicit-any
  client: any,
  listingId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("amazon_listings")
    .select(LISTING_SELECT)
    .eq("id", listingId)
    .maybeSingle();

  if (error) throw new Error("database_error");
  return data ? (data as Record<string, unknown>) : null;
}

function resultRow(
  partial: Omit<InactiveRestockResultRow, "mode">,
): InactiveRestockResultRow {
  return { mode: "inactive_restock", ...partial };
}

export type HandleInactiveRestockParams = {
  // deno-lint-ignore no-explicit-any
  client: any;
  variantId: string;
  wantsPreview: boolean;
  livePatchDisabled: boolean;
  syncEnv: ReturnType<typeof readSyncEnvConfig>;
  syncCtx: InventorySyncRunContext;
  requestedBy: string | null;
  now: string;
};

export type HandleInactiveRestockResponse = {
  ok: boolean;
  mode: "inactive_restock";
  preview: boolean;
  runId: string | null;
  candidateCount: number;
  summary: { total: number; succeeded: number; failed: number; skipped: number };
  results: InactiveRestockResultRow[];
  message: string;
};

/** Process single-variant inactive FBM restock (offer PUT + qty). */
export async function handleAmazonInactiveRestockSync(
  params: HandleInactiveRestockParams,
): Promise<HandleInactiveRestockResponse> {
  const { client, variantId, wantsPreview, livePatchDisabled, syncEnv, syncCtx, requestedBy, now } =
    params;

  const candidate = await loadAmazonInactiveRestockCandidate(client, variantId);

  const run = await createInventorySyncRun(client, {
    mode: wantsPreview || livePatchDisabled ? "dry_run" : "push",
    requestedBy,
    candidateCount: candidate ? 1 : 0,
    notes: wantsPreview
      ? "Amazon inactive FBM restock preview"
      : livePatchDisabled
      ? "Amazon inactive FBM restock (live patch disabled — no API call)"
      : "Amazon inactive FBM restock",
    triggerSource: syncCtx.triggerSource,
    triggerReferenceType: syncCtx.triggerReferenceType,
    triggerReferenceId: syncCtx.triggerReferenceId,
    stockLedgerId: syncCtx.stockLedgerId,
    orchestrationId: syncCtx.orchestrationId,
  });

  const finish = async (
    results: InactiveRestockResultRow[],
    summary: { total: number; succeeded: number; failed: number; skipped: number },
    message: string,
  ): Promise<HandleInactiveRestockResponse> => {
    if (run?.id) {
      for (const r of results) {
        const logStatus =
          r.status === "success" ? "success" : r.status === "failed" ? "failed" : "skipped";
        await logInventorySyncResult(client, {
          runId: run.id,
          variantId: r.variantId,
          productId: candidate?.product_id ?? null,
          amazonListingId: r.amazonListingId,
          sellerSku: r.sellerSku,
          marketplaceId: null,
          previousQty: r.previousQty,
          targetQty: r.targetQty,
          status: logStatus,
          action: "inactive_restock",
          errorCode: r.error ?? null,
          errorMessage: r.message,
          responseRef: r.submissionId ?? null,
        });
      }
      await finalizeInventorySyncRun(client, run.id, summary, now);
    }
    return {
      ok: true,
      mode: "inactive_restock",
      preview: wantsPreview,
      runId: run?.id ?? null,
      candidateCount: candidate ? 1 : 0,
      summary,
      results,
      message,
    };
  };

  if (!candidate) {
    const row = resultRow({
      status: "skipped",
      variantId,
      amazonListingId: null,
      sellerSku: null,
      targetQty: null,
      previousQty: null,
      message: "No inactive_can_update candidate for this variant.",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 0, skipped: 1 }, row.message);
  }

  const targetQty = targetQtyFromAvailable(candidate.available_qty, candidate.available_qty_nonneg);

  if (candidate.amazon_is_afn) {
    const row = resultRow({
      status: "skipped",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku: candidate.amazon_seller_sku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message: "Amazon FBA/AFN listing — inactive restock skipped.",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 0, skipped: 1 }, row.message);
  }

  if (targetQty <= 0) {
    const row = resultRow({
      status: "skipped",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku: candidate.amazon_seller_sku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message: "Available quantity is not positive — inactive restock skipped.",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 0, skipped: 1 }, row.message);
  }

  const listing = await fetchAmazonListingForOfferRestore(
    client,
    String(candidate.amazon_listing_id),
  );

  if (!listing) {
    const row = resultRow({
      status: "failed",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku: candidate.amazon_seller_sku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message: "Amazon listing not found.",
      error: "listing_not_found",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 1, skipped: 0 }, row.message);
  }

  if (isFbaManagedListing(listing)) {
    const row = resultRow({
      status: "skipped",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku: candidate.amazon_seller_sku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message: "FBA-managed listing — inactive restock skipped.",
      error: "fba_quantity_not_supported",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 0, skipped: 1 }, row.message);
  }

  const sellerSku = String(listing.seller_sku || "").trim();
  if (!sellerSku || !String(listing.marketplace_id || "").trim()) {
    const row = resultRow({
      status: "failed",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku: candidate.amazon_seller_sku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message: "Listing missing seller SKU or marketplace.",
      error: "listing_not_patchable",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 1, skipped: 0 }, row.message);
  }

  if (livePatchDisabled && !wantsPreview) {
    const row = resultRow({
      status: "dry_run",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message:
        "Live Amazon patch disabled (AMAZON_ENABLE_LIVE_PATCH is not true). No Amazon API call made.",
      error: "live_patch_disabled",
    });
    return finish([row], { total: 1, succeeded: 0, failed: 0, skipped: 1 }, row.message);
  }

  const submitResult = await submitAmazonOfferRestore({
    client,
    listing,
    patch: { quantity: targetQty },
    preview: wantsPreview || livePatchDisabled,
    syncEnv,
    now,
  });

  if (!submitResult.ok) {
    const row = resultRow({
      status: "failed",
      variantId: candidate.variant_id,
      amazonListingId: String(candidate.amazon_listing_id),
      sellerSku,
      targetQty,
      previousQty: candidate.amazon_current_qty,
      message: submitResult.error || "Amazon inactive restock failed.",
      error: submitResult.error,
      offerRestore: true,
      submissionStatus: submitResult.submissionStatus,
      submissionId: submitResult.submissionId,
      issues: submitResult.issues,
    });
    return finish([row], { total: 1, succeeded: 0, failed: 1, skipped: 0 }, row.message);
  }

  const row = resultRow({
    status: wantsPreview || livePatchDisabled ? "dry_run" : "success",
    variantId: candidate.variant_id,
    amazonListingId: String(candidate.amazon_listing_id),
    sellerSku,
    targetQty,
    previousQty: candidate.amazon_current_qty,
    message: wantsPreview || livePatchDisabled
      ? "Amazon inactive restock validation preview completed."
      : "Amazon inactive FBM offer restore and quantity sync requested.",
    offerRestore: true,
    submissionStatus: submitResult.submissionStatus,
    submissionId: submitResult.submissionId,
    issues: submitResult.issues,
  });

  const summary = {
    total: 1,
    succeeded: row.status === "success" ? 1 : 0,
    failed: 0,
    skipped: row.status === "dry_run" || row.status === "skipped" ? 1 : 0,
  };

  return finish([row], summary, row.message);
}
