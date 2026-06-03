// Shared sync-run helpers for amazon-sync-listings (read-only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeListingIssues,
  normalizeListingItem,
  reconcileNormalizedListingStatus,
  searchListingsItemsPage,
} from "./amazonSpApiUtils.ts";

export type SyncType = "manual" | "incremental" | "full" | "single_sku";

export type ServiceClient = ReturnType<typeof createClient>;

export const VALID_SYNC_TYPES = new Set<string>([
  "manual",
  "incremental",
  "full",
  "single_sku",
]);

export const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000;
const RATE_LIMIT_RETRY_MS = 2000;

export type SyncRunSummary = {
  syncRunId: string;
  marketplaceId: string;
  status: string;
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  recordsMarkedAbsent: number;
  pagesFetched: number;
  warnings: string[];
};

export type AwsSigningConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  region: string;
};

type SellerAccount = {
  id: string;
  seller_id: string;
};

export function parseSyncType(value: unknown): SyncType {
  return typeof value === "string" && VALID_SYNC_TYPES.has(value)
    ? value as SyncType
    : "manual";
}

/** Pagination defaults and caps by sync mode. */
export function resolveMaxPages(syncType: SyncType, maxPagesRaw: unknown): number {
  const limits: Record<SyncType, { defaultPages: number; maxCap: number }> = {
    manual: { defaultPages: 1, maxCap: 5 },
    incremental: { defaultPages: 5, maxCap: 10 },
    full: { defaultPages: 10, maxCap: 25 },
    single_sku: { defaultPages: 1, maxCap: 1 },
  };

  const { defaultPages, maxCap } = limits[syncType];
  if (syncType === "single_sku") return 1;

  const parsed = typeof maxPagesRaw === "number"
    ? maxPagesRaw
    : Number(maxPagesRaw ?? defaultPages);

  if (!Number.isFinite(parsed)) return defaultPages;
  return Math.min(maxCap, Math.max(1, Math.floor(parsed)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertSyncError(
  client: ServiceClient,
  syncRunId: string,
  message: string,
  errorCode: string,
  extra: Record<string, unknown> = {},
) {
  await client.from("amazon_sync_errors").insert({
    sync_run_id: syncRunId,
    error_code: errorCode,
    message,
    raw_error: extra,
  });
}

async function finalizeSyncRun(
  client: ServiceClient,
  syncRunId: string,
  patch: Record<string, unknown>,
) {
  await client.from("amazon_sync_runs").update(patch).eq("id", syncRunId);
}

/** Derive incremental watermark from prior successful runs (5-minute overlap). */
export async function deriveIncrementalCursor(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("amazon_sync_runs")
    .select("finished_at, summary, sync_cursor")
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .in("status", ["success", "partial_success"])
    .in("sync_type", ["manual", "incremental", "full"])
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const summary = data.summary as Record<string, unknown> | null;
  const cursor = data.sync_cursor as Record<string, unknown> | null;
  const anchor =
    (typeof summary?.completedAt === "string" ? summary.completedAt : null) ||
    (typeof cursor?.completedAt === "string" ? cursor.completedAt : null) ||
    (typeof data.finished_at === "string" ? data.finished_at : null);

  if (!anchor) return null;

  const date = new Date(anchor);
  if (Number.isNaN(date.getTime())) return null;
  date.setTime(date.getTime() - INCREMENTAL_OVERLAP_MS);
  return date.toISOString();
}

/** Resume an incomplete full sync from stored pagination token. */
export async function deriveFullSyncPageToken(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
): Promise<string | null> {
  const { data } = await client
    .from("amazon_sync_runs")
    .select("sync_cursor, summary")
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .eq("sync_type", "full")
    .eq("status", "partial_success")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const summary = data?.summary as Record<string, unknown> | null;
  const cursor = data?.sync_cursor as Record<string, unknown> | null;
  if (summary?.hasMore === true && typeof cursor?.nextToken === "string") {
    return cursor.nextToken;
  }
  return null;
}

async function loadExistingSkus(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
  skus: string[],
): Promise<Set<string>> {
  if (skus.length === 0) return new Set();

  const { data, error } = await client
    .from("amazon_listings")
    .select("seller_sku")
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .in("seller_sku", skus);

  if (error || !data) return new Set();
  return new Set(data.map((row) => String(row.seller_sku)));
}

type ExistingListingQtyRow = {
  seller_sku: string;
  fbm_quantity: number | null;
  quantity_last_source: string | null;
  quantity_synced_at: string | null;
  price: number | null;
  price_last_source: string | null;
  price_synced_at: string | null;
};

const MANUAL_PATCH_GRACE_MS = 30 * 60 * 1000;

async function loadExistingListingOverrides(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
  skus: string[],
): Promise<Map<string, ExistingListingQtyRow>> {
  if (skus.length === 0) return new Map();

  const { data, error } = await client
    .from("amazon_listings")
    .select([
      "seller_sku",
      "fbm_quantity",
      "quantity_last_source",
      "quantity_synced_at",
      "price",
      "price_last_source",
      "price_synced_at",
    ].join(","))
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .in("seller_sku", skus);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [
      String(row.seller_sku),
      {
        seller_sku: String(row.seller_sku),
        fbm_quantity: typeof row.fbm_quantity === "number" ? row.fbm_quantity : null,
        quantity_last_source: typeof row.quantity_last_source === "string"
          ? row.quantity_last_source
          : null,
        quantity_synced_at: typeof row.quantity_synced_at === "string"
          ? row.quantity_synced_at
          : null,
        price: typeof row.price === "number" ? row.price : Number(row.price) || null,
        price_last_source: typeof row.price_last_source === "string"
          ? row.price_last_source
          : null,
        price_synced_at: typeof row.price_synced_at === "string"
          ? row.price_synced_at
          : null,
      },
    ]),
  );
}

function withinManualPatchGrace(syncedAt: string | null | undefined): boolean {
  if (!syncedAt) return false;
  return Date.now() - new Date(syncedAt).getTime() <= MANUAL_PATCH_GRACE_MS;
}

function preserveManualQuantity(
  normalized: ReturnType<typeof normalizeListingItem>,
  existing: ExistingListingQtyRow | undefined,
): ReturnType<typeof normalizeListingItem> {
  if (!normalized || !existing || existing.quantity_last_source !== "manual") {
    return normalized;
  }

  if (!withinManualPatchGrace(existing.quantity_synced_at)) return normalized;

  if (normalized.fbm_quantity === existing.fbm_quantity) {
    normalized.quantity_last_source = "listings";
    return normalized;
  }

  normalized.fbm_quantity = existing.fbm_quantity;
  normalized.quantity_last_source = "manual";
  normalized.quantity_synced_at = existing.quantity_synced_at;
  return normalized;
}

function preserveManualPrice(
  normalized: ReturnType<typeof normalizeListingItem>,
  _existing: ExistingListingQtyRow | undefined,
): ReturnType<typeof normalizeListingItem> {
  // Always keep sync-derived live offer price in `price`; manual patches only set metadata.
  return normalized;
}

async function unmapProductsForListing(
  client: ServiceClient,
  amazonListingId: string,
  now: string,
) {
  const { data: mappedRows } = await client
    .from("amazon_listing_mappings")
    .select("kk_product_id")
    .eq("amazon_listing_id", amazonListingId)
    .eq("mapping_status", "mapped");

  const productIds = new Set(
    (mappedRows || [])
      .map((row) => row?.kk_product_id)
      .filter(Boolean)
      .map(String),
  );

  await client
    .from("amazon_listing_mappings")
    .update({ mapping_status: "legacy", updated_at: now })
    .eq("amazon_listing_id", amazonListingId)
    .eq("mapping_status", "mapped");

  for (const productId of productIds) {
    await client
      .from("amazon_listing_mappings")
      .update({ mapping_status: "legacy", updated_at: now })
      .eq("kk_product_id", productId)
      .eq("mapping_status", "mapped");
  }

  return [...productIds];
}

async function markSkuAbsent(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
  sellerSku: string,
  now: string,
) {
  const { data: listing } = await client
    .from("amazon_listings")
    .select("id")
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .eq("seller_sku", sellerSku)
    .maybeSingle();

  if (listing?.id) {
    await unmapProductsForListing(client, String(listing.id), now);
  }

  await client
    .from("amazon_listings")
    .update({
      amazon_sku_absent_at: now,
      updated_at: now,
    })
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .eq("seller_sku", sellerSku);
}

async function clearSkuAbsent(
  client: ServiceClient,
  listingId: string,
  now: string,
) {
  await client
    .from("amazon_listings")
    .update({
      amazon_sku_absent_at: null,
      updated_at: now,
    })
    .eq("id", listingId)
    .not("amazon_sku_absent_at", "is", null);
}

/** SKUs accumulated across resumed full-sync pages (partial_success cursor). */
async function loadFullSyncSeenSkus(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
): Promise<Set<string>> {
  const seen = new Set<string>();
  const { data } = await client
    .from("amazon_sync_runs")
    .select("sync_cursor")
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .eq("sync_type", "full")
    .eq("status", "partial_success")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const cursor = data?.sync_cursor as Record<string, unknown> | null;
  const stored = cursor?.seenSellerSkus;
  if (!Array.isArray(stored)) return seen;

  for (const entry of stored) {
    const sku = typeof entry === "string" ? entry.trim() : "";
    if (sku) seen.add(sku);
  }
  return seen;
}

/**
 * After a complete full catalog sync, hide local rows whose SKU was not returned by Amazon.
 */
async function reconcileAbsentAfterFullSync(
  client: ServiceClient,
  sellerAccountId: string,
  marketplaceId: string,
  seenSkus: Set<string>,
  now: string,
): Promise<number> {
  const { data: localRows, error } = await client
    .from("amazon_listings")
    .select("id, seller_sku")
    .eq("seller_account_id", sellerAccountId)
    .eq("marketplace_id", marketplaceId)
    .is("amazon_sku_absent_at", null);

  if (error || !localRows?.length) return 0;

  let marked = 0;
  for (const row of localRows) {
    const sku = String(row.seller_sku || "").trim();
    if (!sku || seenSkus.has(sku)) continue;
    await markSkuAbsent(client, sellerAccountId, marketplaceId, sku, now);
    marked += 1;
  }
  return marked;
}

async function fetchListingsPageWithRetry(
  params: Parameters<typeof searchListingsItemsPage>[0],
) {
  let result = await searchListingsItemsPage(params);
  if (!result.ok && result.httpStatus === 429) {
    await delay(RATE_LIMIT_RETRY_MS);
    result = await searchListingsItemsPage(params);
  }
  return result;
}

function aggregateStatus(runs: SyncRunSummary[]): string {
  if (runs.length === 0) return "failed";
  const statuses = runs.map((run) => run.status);
  if (statuses.every((s) => s === "success")) return "success";
  if (statuses.every((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "success" || s === "partial_success")) {
    return "partial_success";
  }
  return "failed";
}

export type RunMarketplaceSyncParams = {
  client: ServiceClient;
  account: SellerAccount;
  marketplaceId: string;
  syncType: SyncType;
  maxPages: number;
  accessToken: string;
  endpoint: string;
  aws?: AwsSigningConfig;
  triggeredBy: string | null;
  sellerSku?: string | null;
  now: string;
};

/** Execute one marketplace sync run (read-only). */
export async function runMarketplaceSync(
  params: RunMarketplaceSyncParams,
): Promise<SyncRunSummary> {
  const {
    client,
    account,
    marketplaceId,
    syncType,
    maxPages,
    accessToken,
    endpoint,
    aws,
    triggeredBy,
    sellerSku,
    now,
  } = params;

  const warnings: string[] = [];

  let lastUpdatedAfter: string | null = null;
  let initialPageToken: string | null = null;
  const seenSellerSkus = new Set<string>();

  if (syncType === "incremental") {
    lastUpdatedAfter = await deriveIncrementalCursor(client, account.id, marketplaceId);
    if (!lastUpdatedAfter) {
      warnings.push("incremental_no_prior_watermark_used_full_scan");
    }
  }

  if (syncType === "full") {
    initialPageToken = await deriveFullSyncPageToken(client, account.id, marketplaceId);
    if (initialPageToken) {
      warnings.push("full_sync_resumed_from_stored_page_token");
      const priorSeen = await loadFullSyncSeenSkus(client, account.id, marketplaceId);
      for (const sku of priorSeen) seenSellerSkus.add(sku);
    }
  }

  if (syncType === "single_sku" && !sellerSku?.trim()) {
    throw new Error("invalid_request");
  }

  const searchParams: {
    sellerSku?: string;
    lastUpdatedAfter?: string;
  } = {};

  if (syncType === "single_sku" && sellerSku) {
    searchParams.sellerSku = sellerSku.trim();
  } else if (lastUpdatedAfter) {
    searchParams.lastUpdatedAfter = lastUpdatedAfter;
  }

  const { data: syncRun, error: syncRunErr } = await client
    .from("amazon_sync_runs")
    .insert({
      seller_account_id: account.id,
      sync_type: syncType,
      marketplace_id: marketplaceId,
      status: "running",
      started_at: now,
      triggered_by: triggeredBy,
      sync_cursor: {
        lastUpdatedAfter: searchParams.lastUpdatedAfter ?? null,
        nextToken: initialPageToken,
      },
      summary: {
        marketplaceId,
        syncType,
        sigv4: Boolean(aws),
        awsSigningRegion: aws?.region ?? null,
        staleHandling: syncType === "full"
          ? "catalog_reconcile:pending"
          : "not_applicable",
      },
    })
    .select("id")
    .single();

  if (syncRunErr || !syncRun?.id) {
    throw new Error("database_error");
  }

  const syncRunId = syncRun.id as string;
  let pageToken: string | null = initialPageToken;
  let recordsMarkedAbsent = 0;
  let pagesFetched = 0;
  let recordsSeen = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;
  let rateLimited = false;
  let spApiFailed = false;

  while (pagesFetched < maxPages) {
    const pageResult = await fetchListingsPageWithRetry({
      endpoint,
      sellerId: account.seller_id,
      marketplaceId,
      accessToken,
      pageSize: syncType === "single_sku" ? 1 : 20,
      pageToken,
      aws,
      sellerSku: searchParams.sellerSku,
      lastUpdatedAfter: searchParams.lastUpdatedAfter,
    });

    pagesFetched += 1;

    if (!pageResult.ok) {
      if (pageResult.httpStatus === 429) {
        rateLimited = true;
        warnings.push("rate_limited");
      } else {
        spApiFailed = true;
      }
      if (pageResult.hint) warnings.push(pageResult.hint);

      await insertSyncError(
        client,
        syncRunId,
        "Amazon searchListingsItems request failed",
        pageResult.httpStatus === 429 ? "rate_limited" : "sp_api_request_failed",
        { httpStatus: pageResult.httpStatus, hint: pageResult.hint ?? null },
      );

      break;
    }

    recordsSeen += pageResult.items.length;

    if (syncType === "full") {
      for (const item of pageResult.items) {
        const sku = typeof item.sku === "string" ? item.sku.trim() : "";
        if (sku) seenSellerSkus.add(sku);
      }
    }

    const pageSkus = pageResult.items
      .map((item) => (typeof item.sku === "string" ? item.sku.trim() : ""))
      .filter(Boolean);
    const existingSkus = await loadExistingSkus(
      client,
      account.id,
      marketplaceId,
      pageSkus,
    );
    const existingQtyBySku = await loadExistingListingOverrides(
      client,
      account.id,
      marketplaceId,
      pageSkus,
    );

    for (const item of pageResult.items) {
      try {
        let normalized = normalizeListingItem(item, {
          sellerAccountId: account.id,
          sellerId: account.seller_id,
          marketplaceId,
          now,
        });

        if (!normalized) {
          recordsFailed += 1;
          await insertSyncError(
            client,
            syncRunId,
            "Listing item missing seller SKU",
            "normalize_failed",
            { reason: "missing_sku" },
          );
          continue;
        }

        normalized = preserveManualQuantity(
          normalized,
          existingQtyBySku.get(normalized.seller_sku),
        );
        normalized = preserveManualPrice(
          normalized,
          existingQtyBySku.get(normalized.seller_sku),
        );
        normalized = reconcileNormalizedListingStatus(normalized);

        const isCreate = !existingSkus.has(normalized.seller_sku);

        const { data: upserted, error: upsertErr } = await client
          .from("amazon_listings")
          .upsert(normalized, {
            onConflict: "seller_account_id,marketplace_id,seller_sku",
          })
          .select("id")
          .single();

        if (upsertErr || !upserted?.id) {
          recordsFailed += 1;
          await insertSyncError(
            client,
            syncRunId,
            "Failed to upsert amazon_listings row",
            "database_error",
            { seller_sku: normalized.seller_sku },
          );
          continue;
        }

        if (isCreate) {
          recordsCreated += 1;
          existingSkus.add(normalized.seller_sku);
        } else {
          recordsUpdated += 1;
        }

        const listingId = upserted.id as string;

        await clearSkuAbsent(client, listingId, now);

        await client
          .from("amazon_listing_issues")
          .delete()
          .eq("amazon_listing_id", listingId)
          .eq("source", "sync")
          .eq("status", "open");

        const issueRows = normalizeListingIssues(item).map((row) => ({
          ...row,
          amazon_listing_id: listingId,
          created_at: now,
          updated_at: now,
        }));

        if (issueRows.length > 0) {
          const { error: issueErr } = await client
            .from("amazon_listing_issues")
            .insert(issueRows);
          if (issueErr) warnings.push("issue_insert_partial_failure");
        }
      } catch {
        recordsFailed += 1;
        await insertSyncError(
          client,
          syncRunId,
          "Unexpected row normalization failure",
          "normalize_failed",
          {},
        );
      }
    }

    pageToken = pageResult.nextToken;
    if (!pageToken || pagesFetched >= maxPages) break;
  }

  if (
    syncType === "single_sku" &&
    sellerSku?.trim() &&
    recordsSeen === 0 &&
    !spApiFailed &&
    !rateLimited
  ) {
    await markSkuAbsent(client, account.id, marketplaceId, sellerSku.trim(), now);
    warnings.push("single_sku_not_found_marked_absent");
  }

  const finishedAt = new Date().toISOString();
  const hasMore = Boolean(pageToken);
  let finalStatus = "success";

  if (spApiFailed || rateLimited) {
    finalStatus = recordsSeen > 0 || recordsCreated > 0 || recordsUpdated > 0
      ? "partial_success"
      : "failed";
  } else if (recordsFailed > 0) {
    finalStatus = recordsCreated > 0 || recordsUpdated > 0
      ? "partial_success"
      : "failed";
  }

  if (hasMore && finalStatus !== "failed") {
    warnings.push("pagination_incomplete_more_pages_available");
  }

  const canReconcileCatalog = syncType === "full"
    && !hasMore
    && !spApiFailed
    && !rateLimited
    && finalStatus === "success";

  if (canReconcileCatalog) {
    recordsMarkedAbsent = await reconcileAbsentAfterFullSync(
      client,
      account.id,
      marketplaceId,
      seenSellerSkus,
      now,
    );
    if (recordsMarkedAbsent > 0) {
      warnings.push(`catalog_reconcile:marked_${recordsMarkedAbsent}_absent`);
    } else {
      warnings.push("catalog_reconcile:no_stale_rows");
    }
  } else if (syncType === "full" && hasMore) {
    warnings.push("catalog_reconcile:skipped_pagination_incomplete");
  } else if (syncType === "full" && finalStatus !== "success") {
    warnings.push("catalog_reconcile:skipped_run_not_success");
  }

  const staleHandling = canReconcileCatalog
    ? `catalog_reconcile:marked_${recordsMarkedAbsent}_absent`
    : syncType === "full"
    ? "catalog_reconcile:deferred"
    : "not_applicable";

  await finalizeSyncRun(client, syncRunId, {
    status: finalStatus,
    finished_at: finishedAt,
    records_seen: recordsSeen,
    records_created: recordsCreated,
    records_updated: recordsUpdated,
    records_failed: recordsFailed,
    sync_cursor: {
      lastUpdatedAfter: searchParams.lastUpdatedAfter ?? null,
      nextToken: pageToken,
      completedAt: finishedAt,
      seenSellerSkus: syncType === "full" && hasMore
        ? [...seenSellerSkus]
        : null,
    },
    summary: {
      marketplaceId,
      syncType,
      pagesFetched,
      hasMore,
      nextTokenStored: hasMore,
      completedAt: finishedAt,
      lastUpdatedAfter: searchParams.lastUpdatedAfter ?? null,
      sigv4: Boolean(aws),
      awsSigningRegion: aws?.region ?? null,
      includedData:
        "summaries,attributes,issues,offers,fulfillmentAvailability,relationships,productTypes",
      staleHandling,
      recordsMarkedAbsent,
      seenSellerSkuCount: syncType === "full" ? seenSellerSkus.size : null,
      warnings,
    },
  });

  return {
    syncRunId,
    marketplaceId,
    status: finalStatus,
    recordsSeen,
    recordsCreated,
    recordsUpdated,
    recordsFailed,
    recordsMarkedAbsent,
    pagesFetched,
    warnings,
  };
}

export function buildAggregateSyncResponse(runs: SyncRunSummary[]) {
  const totals = runs.reduce(
    (acc, run) => {
      acc.recordsSeen += run.recordsSeen;
      acc.recordsCreated += run.recordsCreated;
      acc.recordsUpdated += run.recordsUpdated;
      acc.recordsFailed += run.recordsFailed;
      acc.recordsMarkedAbsent += run.recordsMarkedAbsent;
      acc.pagesFetched += run.pagesFetched;
      for (const warning of run.warnings) {
        if (!acc.warnings.includes(warning)) acc.warnings.push(warning);
      }
      return acc;
    },
    {
      recordsSeen: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      recordsMarkedAbsent: 0,
      pagesFetched: 0,
      warnings: [] as string[],
    },
  );

  const firstRun = runs[0];
  const status = aggregateStatus(runs);

  return {
    ok: true,
    syncRunId: firstRun?.syncRunId ?? null,
    status,
    recordsSeen: totals.recordsSeen,
    recordsCreated: totals.recordsCreated,
    recordsUpdated: totals.recordsUpdated,
    recordsFailed: totals.recordsFailed,
    recordsMarkedAbsent: totals.recordsMarkedAbsent,
    pagesFetched: totals.pagesFetched,
    runs: runs.map((run) => ({
      syncRunId: run.syncRunId,
      marketplaceId: run.marketplaceId,
      status: run.status,
      recordsSeen: run.recordsSeen,
      recordsCreated: run.recordsCreated,
      recordsUpdated: run.recordsUpdated,
      recordsFailed: run.recordsFailed,
      recordsMarkedAbsent: run.recordsMarkedAbsent,
      pagesFetched: run.pagesFetched,
    })),
    marketplacesSynced: runs.length,
    warnings: totals.warnings,
  };
}
