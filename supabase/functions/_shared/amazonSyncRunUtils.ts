// Shared sync-run helpers for amazon-sync-listings (read-only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeListingIssues,
  normalizeListingItem,
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
  warnings.push("staleHandling:not_implemented_no_purge");

  let lastUpdatedAfter: string | null = null;
  let initialPageToken: string | null = null;

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
        staleHandling: "not_implemented_no_purge",
      },
    })
    .select("id")
    .single();

  if (syncRunErr || !syncRun?.id) {
    throw new Error("database_error");
  }

  const syncRunId = syncRun.id as string;
  let pageToken: string | null = initialPageToken;
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

    const pageSkus = pageResult.items
      .map((item) => (typeof item.sku === "string" ? item.sku.trim() : ""))
      .filter(Boolean);
    const existingSkus = await loadExistingSkus(
      client,
      account.id,
      marketplaceId,
      pageSkus,
    );

    for (const item of pageResult.items) {
      try {
        const normalized = normalizeListingItem(item, {
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
      staleHandling: "not_implemented_no_purge",
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
    pagesFetched: totals.pagesFetched,
    runs: runs.map((run) => ({
      syncRunId: run.syncRunId,
      marketplaceId: run.marketplaceId,
      status: run.status,
      recordsSeen: run.recordsSeen,
      recordsCreated: run.recordsCreated,
      recordsUpdated: run.recordsUpdated,
      recordsFailed: run.recordsFailed,
      pagesFetched: run.pagesFetched,
    })),
    marketplacesSynced: runs.length,
    warnings: totals.warnings,
  };
}
