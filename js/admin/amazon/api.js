import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const LISTINGS_VIEW = "v_amazon_listing_workspace";
const UNMAPPED_VIEW = "v_amazon_unmapped_listings";
const READY_TO_PUSH_VIEW = "v_amazon_ready_to_push_products";

const READY_TO_PUSH_COLUMNS = [
  "kk_product_id",
  "kk_sku",
  "kk_product_title",
  "kk_price",
  "kk_stock",
  "image_url",
  "category",
  "created_at",
  "updated_at",
  "draft_id",
  "draft_status",
  "has_active_draft",
  "last_draft_updated_at",
  "has_stock",
  "has_image",
  "has_category",
  "has_price",
  "eligibility_status",
  "eligibility_warnings",
].join(",");

const UNMAPPED_COLUMNS = [
  "amazon_listing_id",
  "seller_account_id",
  "marketplace_id",
  "asin",
  "seller_sku",
  "amazon_title",
  "product_type",
  "listing_status",
  "price",
  "currency",
  "fbm_quantity",
  "last_synced_at",
].join(",");

const LISTINGS_COLUMNS = [
  "amazon_listing_id",
  "seller_account_id",
  "marketplace_id",
  "asin",
  "seller_sku",
  "amazon_title",
  "product_type",
  "listing_status",
  "listing_status_buyable",
  "listing_status_discoverable",
  "price",
  "currency",
  "fulfillment_channel",
  "fbm_quantity",
  "fba_fulfillable_quantity",
  "fba_reserved_quantity",
  "fba_inbound_quantity",
  "last_synced_at",
  "mapping_status",
  "mapping_confidence",
  "kk_product_id",
  "kk_sku",
  "kk_product_title",
  "kk_price",
  "kk_stock",
  "open_issue_count",
  "highest_issue_severity",
  "is_stale",
  "stale_reason",
  "hours_since_sync",
  "kk_unit_cost",
  "kk_weight_g",
  "kk_cogs",
  "est_referral_fee_rate",
  "est_referral_fee",
  "est_amazon_fees",
  "est_profit",
  "profit_calc_status",
  "price_compare_status",
  "has_price_mismatch",
  "price_delta",
  "price_delta_pct",
  "is_fba_managed",
  "amazon_fulfillable_qty",
  "inventory_compare_status",
  "has_inventory_mismatch",
  "inventory_delta",
  "error_issue_count",
  "warning_issue_count",
  "info_issue_count",
  "latest_issue_at",
  "latest_issue_message",
  "latest_issue_code",
  "latest_issue_source",
  "recent_sync_error_count",
  "latest_sync_error_message",
  "latest_sync_error_at",
  "listing_health_status",
  "listing_health_reasons",
  "has_listing_health_issue",
  "fulfillment_mode",
  "fulfillment_channel_label",
  "has_fba_reserved",
  "has_fba_inbound",
].join(",");

async function getAccessToken() {
  const sb = getSupabaseClient();
  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session?.access_token) {
    const err = new Error("unauthorized");
    err.code = "unauthorized";
    throw err;
  }
  return session.access_token;
}

async function getAccessTokenWithTimeout(timeoutMs = 8000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error("auth_timeout");
      err.code = "auth_timeout";
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([getAccessToken(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutErr = new Error("timeout");
      timeoutErr.code = "timeout";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} name
 * @param {RequestInit & { body?: unknown }} [options]
 */
async function callEdgeFunction(name, options = {}) {
  const token = await getAccessToken();
  const method = options.method || "POST";
  const headers = {
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_ANON_KEY,
    ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
  });

  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok || data.ok === false) {
    const err = new Error(data.error || "request_failed");
    err.code = data.error || "request_failed";
    err.status = resp.status;
    if (Array.isArray(data.validationErrors)) err.validationErrors = data.validationErrors;
    if (Array.isArray(data.amazonIssues)) err.amazonIssues = data.amazonIssues;
    if (data.draftStatus) err.draftStatus = data.draftStatus;
    if (data.submissionStatus) err.submissionStatus = data.submissionStatus;
    if (Array.isArray(data.reasons)) err.reasons = data.reasons;
    if (Array.isArray(data.issues)) err.issues = data.issues;
    if (data.hint) err.hint = data.hint;
    throw err;
  }

  return data;
}

export async function getAmazonAuthStatus(sellerAccountId) {
  const token = await getAccessTokenWithTimeout();
  const url = new URL(`${SUPABASE_URL}/functions/v1/amazon-auth-status`);
  if (sellerAccountId) url.searchParams.set("sellerAccountId", sellerAccountId);

  let resp;
  try {
    resp = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
  } catch (err) {
    if (err?.code === "timeout") throw err;
    const networkErr = new Error("network_error");
    networkErr.code = "network_error";
    throw networkErr;
  }

  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (resp.status === 404) {
    const err = new Error("status_unavailable");
    err.code = "status_unavailable";
    err.status = 404;
    throw err;
  }

  if (!resp.ok || data.ok === false) {
    const err = new Error(data.error || "request_failed");
    err.code = data.error || "request_failed";
    err.status = resp.status;
    throw err;
  }

  return data;
}

export async function startAmazonAuth(options = {}) {
  return callEdgeFunction("amazon-auth-start", {
    method: "POST",
    body: {
      region: options.region,
      marketplaceIds: options.marketplaceIds,
      redirectAfter: options.redirectAfter || "/pages/admin/amazon.html",
    },
  });
}

export async function disconnectAmazon(sellerAccountId) {
  return callEdgeFunction("amazon-auth-disconnect", {
    method: "POST",
    body: sellerAccountId ? { sellerAccountId } : {},
  });
}

export async function syncAmazonListings(options = {}) {
  return callEdgeFunction("amazon-sync-listings", {
    method: "POST",
    body: {
      sellerAccountId: options.sellerAccountId,
      marketplaceIds: options.marketplaceIds,
      syncType: options.syncType || "manual",
      maxPages: options.maxPages ?? 1,
      sellerSku: options.sellerSku,
    },
  });
}

export async function syncAmazonListingSku(sellerSku, options = {}) {
  return syncAmazonListings({
    ...options,
    syncType: "single_sku",
    sellerSku,
    maxPages: 1,
  });
}

/** @param {{ amazonListingId: string, price?: number, quantity?: number, preview?: boolean }} payload */
export async function patchAmazonListing(payload) {
  return callEdgeFunction("amazon-patch-listing", {
    method: "POST",
    body: payload,
  });
}

/** @param {{ amazonListingIds: string[], operation: string, value?: number, preview?: boolean }} payload */
export async function bulkPatchAmazonListings(payload) {
  return callEdgeFunction("amazon-bulk-patch-listings", {
    method: "POST",
    body: payload,
  });
}

export async function fetchAmazonListings(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 50));

  let query = sb
    .from(LISTINGS_VIEW)
    .select(LISTINGS_COLUMNS)
    .eq("mapping_status", "mapped")
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (options.marketplaceId) {
    query = query.eq("marketplace_id", options.marketplaceId);
  }

  const { data, error } = await query;
  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  return data || [];
}

export async function fetchAmazonUnmappedListings(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 50));

  let query = sb
    .from(UNMAPPED_VIEW)
    .select(UNMAPPED_COLUMNS)
    .order("last_synced_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (options.marketplaceId) {
    query = query.eq("marketplace_id", options.marketplaceId);
  }

  const { data, error } = await query;
  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  return data || [];
}

export async function fetchAmazonReadyToPushProducts(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 50));

  const { data, error } = await sb
    .from(READY_TO_PUSH_VIEW)
    .select(READY_TO_PUSH_COLUMNS)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  return data || [];
}

export async function searchKkProducts(query) {
  const sb = getSupabaseClient();
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];

  const safe = trimmed.replace(/[%_,]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await sb
    .from("products")
    .select("id, name, code, price, product_variants(stock, is_active)")
    .eq("is_active", true)
    .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
    .order("name")
    .limit(20);

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    throw err;
  }

  return (data || []).map((row) => {
    const variants = Array.isArray(row.product_variants) ? row.product_variants : [];
    const stock = variants.reduce((sum, variant) => {
      if (!variant?.is_active) return sum;
      const qty = Number(variant.stock);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    return {
      id: row.id,
      name: row.name,
      code: row.code,
      price: row.price,
      stock,
    };
  });
}

export async function saveAmazonMapping(payload) {
  return callEdgeFunction("amazon-map-listing", {
    method: "POST",
    body: {
      amazonListingId: payload.amazonListingId,
      kkProductId: payload.kkProductId,
      kkSku: payload.kkSku,
      mappingStatus: payload.mappingStatus || "mapped",
      mappingConfidence: payload.mappingConfidence || "manual",
      notes: payload.notes,
    },
  });
}

const DRAFTS_VIEW = "v_amazon_drafts_issues";

const DRAFTS_COLUMNS = [
  "draft_id",
  "amazon_listing_id",
  "kk_product_id",
  "kk_sku",
  "kk_product_title",
  "marketplace_id",
  "seller_sku",
  "asin",
  "matched_asin",
  "product_type",
  "draft_status",
  "submission_status",
  "validation_errors",
  "last_validation_result",
  "last_submission_response",
  "issue_count",
  "latest_issue_severity",
  "draft_payload",
  "verify_attempts",
  "last_verify_attempt_at",
  "next_verify_after",
  "verify_status",
  "verify_last_error",
  "updated_at",
  "created_at",
].join(",");

export async function saveAmazonDraft(payload) {
  return callEdgeFunction("amazon-save-draft", {
    method: "POST",
    body: payload,
  });
}

export async function fetchAmazonDraftsIssues(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 50));

  const { data, error } = await sb
    .from(DRAFTS_VIEW)
    .select(DRAFTS_COLUMNS)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    throw err;
  }

  return data || [];
}

export async function fetchAmazonDraftById(draftId) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from(DRAFTS_VIEW)
    .select(DRAFTS_COLUMNS)
    .eq("draft_id", draftId)
    .maybeSingle();

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    throw err;
  }

  return data;
}

export async function getAmazonProductTypeDefinition(payload) {
  return callEdgeFunction("amazon-product-type-definition", {
    method: "POST",
    body: {
      sellerAccountId: payload.sellerAccountId,
      marketplaceId: payload.marketplaceId || "ATVPDKIKX0DER",
      productType: payload.productType,
      requirements: payload.requirements || "LISTING",
      requirementsEnforced: payload.requirementsEnforced || "ENFORCED",
      locale: payload.locale || "en_US",
      forceRefresh: payload.forceRefresh === true,
    },
  });
}

export async function searchAmazonProductTypes(payload) {
  return callEdgeFunction("amazon-search-product-types", {
    method: "POST",
    body: {
      sellerAccountId: payload.sellerAccountId,
      marketplaceId: payload.marketplaceId || "ATVPDKIKX0DER",
      query: payload.query,
      locale: payload.locale || "en_US",
      source: payload.source,
    },
  });
}

export async function previewAmazonDraft(payload) {
  return callEdgeFunction("amazon-preview-draft", {
    method: "POST",
    body: payload,
  });
}

export async function submitAmazonDraftPreview(draftId, options = {}) {
  return callEdgeFunction("amazon-submit-draft-preview", {
    method: "POST",
    body: {
      draftId,
      forceLocalPreview: options.forceLocalPreview !== false,
    },
  });
}

export async function submitAmazonDraftLive(payload) {
  const data = await callEdgeFunction("amazon-submit-draft", {
    method: "POST",
    body: {
      draftId: payload.draftId,
      confirmation: payload.confirmation,
    },
  });
  return data;
}

/** @param {string} draftId @param {{ runSingleSkuSync?: boolean }} [options] */
export async function verifySubmittedAmazonDraft(draftId, options = {}) {
  return callEdgeFunction("amazon-verify-submitted-draft", {
    method: "POST",
    body: {
      draftId,
      runSingleSkuSync: options.runSingleSkuSync !== false,
    },
  });
}

/** @param {string} draftId */
export async function requeueAmazonDraftVerification(draftId) {
  return callEdgeFunction("amazon-requeue-draft-verification", {
    method: "POST",
    body: { draftId },
  });
}

/** @param {string} draftId */
export async function deleteAmazonDraft(draftId) {
  return callEdgeFunction("amazon-delete-draft", {
    method: "POST",
    body: { draftId },
  });
}

/** @param {string[]} amazonListingIds */
export async function estimateAmazonListingFees(amazonListingIds) {
  return callEdgeFunction("amazon-estimate-listing-fees", {
    method: "POST",
    body: { amazonListingIds },
  });
}

/** @param {{ draftIds?: string[], allMaxAttempts?: boolean }} [payload] */
export async function bulkRequeueAmazonDraftVerification(payload = {}) {
  return callEdgeFunction("amazon-bulk-requeue-draft-verification", {
    method: "POST",
    body: {
      draftIds: payload.draftIds,
      allMaxAttempts: payload.allMaxAttempts !== false,
    },
  });
}

/** @param {Array<Record<string, unknown>>} rows */
export function computeAmazonStats(rows) {
  const list = rows || [];
  let active = 0;
  let lowStock = 0;
  let issues = 0;

  for (const row of list) {
    const status = String(row.listing_status || "");
    const kkStock = Number(row.kk_stock);
    const openIssues = Number(row.open_issue_count || 0);

    if (status === "active") active += 1;
    if (status === "low_stock" || (Number.isFinite(kkStock) && kkStock <= 5)) {
      lowStock += 1;
    }
    if (
      openIssues > 0 ||
      status === "issue" ||
      status === "suppressed"
    ) {
      issues += 1;
    }
  }

  return {
    total: list.length,
    active,
    lowStock,
    issues,
  };
}

/** @param {Array<Record<string, unknown>>} rows */
export function countStaleListings(rows) {
  return (rows || []).filter((row) => row.is_stale === true).length;
}

/** @returns {Promise<Array<Record<string, unknown>>>} */
export async function fetchAmazonSyncRuns(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));

  let query = sb
    .from("amazon_sync_runs")
    .select([
      "id",
      "seller_account_id",
      "sync_type",
      "marketplace_id",
      "status",
      "started_at",
      "finished_at",
      "records_seen",
      "records_created",
      "records_updated",
      "records_failed",
      "triggered_by",
      "created_at",
      "summary",
    ].join(","))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.syncType) {
    query = query.eq("sync_type", String(options.syncType));
  }

  if (options.status) {
    query = query.eq("status", String(options.status));
  }

  if (Array.isArray(options.statuses) && options.statuses.length > 0) {
    query = query.in("status", options.statuses);
  }

  const { data, error } = await query;
  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  return data || [];
}

/** @param {string} syncRunId */
export async function fetchAmazonSyncRunErrors(syncRunId) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("amazon_sync_errors")
    .select("id, seller_sku, asin, error_code, message, created_at")
    .eq("sync_run_id", syncRunId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  return data || [];
}

/** @returns {Promise<Array<Record<string, unknown>>>} */
export async function fetchAmazonSyncSummary() {
  return fetchAmazonSyncRuns({
    limit: 10,
    statuses: ["success", "partial_success", "failed"],
  });
}
