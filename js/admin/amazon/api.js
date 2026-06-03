import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const LISTINGS_VIEW = "v_amazon_listing_workspace";
const UNMAPPED_VIEW = "v_amazon_unmapped_listings";
const READY_TO_PUSH_VIEW = "v_amazon_ready_to_push_products";

const READY_TO_PUSH_COLUMNS = [
  "kk_product_id",
  "kk_variant_id",
  "kk_variant_label",
  "variants_total",
  "variants_mapped",
  "suggested_seller_sku",
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
  "draft_variation_role",
  "ready_row_kind",
  "parent_listing_ready",
  "has_stock",
  "has_image",
  "has_category",
  "has_price",
  "eligibility_status",
  "eligibility_warnings",
].join(",");

const READY_TO_PUSH_COLUMNS_LEGACY = READY_TO_PUSH_COLUMNS
  .split(",")
  .map((col) => col.trim())
  .filter((col) => col !== "ready_row_kind" && col !== "parent_listing_ready")
  .join(",");

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
  "main_image_url",
  "last_synced_at",
].join(",");

const UNMAPPED_COLUMNS_LEGACY = UNMAPPED_COLUMNS
  .split(",")
  .filter((col) => col !== "main_image_url")
  .join(",");

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
  "kk_variant_id",
  "kk_variant_label",
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
    if (data.reason) err.reason = data.reason;
    if (Array.isArray(data.reasons)) err.reasons = data.reasons;
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

export async function importAmazonSelfAuthToken(payload = {}) {
  return callEdgeFunction("amazon-auth-import-self", {
    method: "POST",
    body: {
      sellerId: payload.sellerId,
      refreshToken: payload.refreshToken,
      region: payload.region,
      marketplaceIds: payload.marketplaceIds,
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
      maxPages: options.maxPages ?? 5,
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

/** @param {{ amazonListingId: string, price?: number, quantity?: number, imageUrls?: string[], preview?: boolean }} payload */
export async function patchAmazonListing(payload) {
  return callEdgeFunction("amazon-patch-listing", {
    method: "POST",
    body: payload,
  });
}

/** @param {string} amazonListingId */
export async function fetchAmazonListingRaw(amazonListingId) {
  const sb = getSupabaseClient();
  const id = String(amazonListingId || "").trim();
  if (!id) return null;

  const { data, error } = await sb
    .from("amazon_listings")
    .select("id, marketplace_id, raw_listing, product_type")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/** @param {{ amazonListingIds: string[], operation: string, value?: number, preview?: boolean }} payload */
export async function bulkPatchAmazonListings(payload) {
  return callEdgeFunction("amazon-bulk-patch-listings", {
    method: "POST",
    body: payload,
  });
}

/** @param {string} amazonListingId */
export async function fetchAmazonListingBasics(amazonListingId) {
  const sb = getSupabaseClient();
  const id = String(amazonListingId || "").trim();
  if (!id) return null;

  const { data, error } = await sb
    .from("amazon_listings")
    .select([
      "id",
      "asin",
      "seller_sku",
      "amazon_title",
      "listing_status",
      "listing_status_buyable",
      "price",
      "currency",
      "fbm_quantity",
      "fba_fulfillable_quantity",
      "fulfillment_channel",
      "product_type",
      "marketplace_id",
    ].join(","))
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return { ...data, amazon_listing_id: data.id };
}

/** @param {string} amazonListingId */
export async function fetchAmazonListingOpenIssues(amazonListingId) {
  const sb = getSupabaseClient();
  const id = String(amazonListingId || "").trim();
  if (!id) return [];

  const { data, error } = await sb
    .from("amazon_listing_issues")
    .select("severity, message, issue_code, attribute_names, source, created_at")
    .eq("amazon_listing_id", id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(15);

  if (error) return [];
  return data || [];
}

async function enrichAmazonListingImages(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const productIds = [...new Set(
    rows.map((row) => row.kk_product_id).filter(Boolean),
  )];
  if (!productIds.length) return rows;

  const sb = getSupabaseClient();
  const { data: products, error } = await sb
    .from("products")
    .select("id, primary_image_url, catalog_image_url, product_variants(id, preview_image_url, is_active)")
    .in("id", productIds);

  if (error || !products?.length) return rows;

  const productById = new Map(products.map((product) => [product.id, product]));

  return rows.map((row) => {
    const product = row.kk_product_id ? productById.get(row.kk_product_id) : null;
    if (!product) return row;

    let imageUrl = null;
    if (row.kk_variant_id) {
      const variant = (product.product_variants || []).find(
        (entry) => String(entry.id) === String(row.kk_variant_id),
      );
      const preview = String(variant?.preview_image_url || "").trim();
      if (preview) imageUrl = preview;
    }

    if (!imageUrl) {
      imageUrl = product.primary_image_url || product.catalog_image_url || null;
    }

    if (!imageUrl) return row;
    if (row.kk_variant_id || !row.image_url) {
      return { ...row, image_url: imageUrl };
    }
    return row;
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

  const [{ data, error }, absentResult] = await Promise.all([
    query,
    sb.from("amazon_listings").select("id").not("amazon_sku_absent_at", "is", null),
  ]);

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  const absentIds = new Set((absentResult.data || []).map((row) => String(row.id)));
  const visibleRows = (data || []).filter(
    (row) => !absentIds.has(String(row.amazon_listing_id || "")),
  );

  return enrichAmazonListingImages(visibleRows);
}

export async function fetchAmazonUnmappedListings(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 500));

  async function runQuery(columns) {
    let query = sb
      .from(UNMAPPED_VIEW)
      .select(columns)
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (options.marketplaceId) {
      query = query.eq("marketplace_id", options.marketplaceId);
    }

    return query;
  }

  let { data, error } = await runQuery(UNMAPPED_COLUMNS);
  if (error && /main_image_url/i.test(String(error.message || ""))) {
    ({ data, error } = await runQuery(UNMAPPED_COLUMNS_LEGACY));
  }

  if (error) {
    const err = new Error("database_error");
    err.code = "database_error";
    err.details = error.message;
    throw err;
  }

  return data || [];
}

/** @type {"unknown" | "legacy" | "full"} */
let readyToPushColumnMode = "unknown";

function resolveReadyToPushSelect() {
  if (readyToPushColumnMode === "full") return READY_TO_PUSH_COLUMNS;
  if (readyToPushColumnMode === "legacy") return READY_TO_PUSH_COLUMNS_LEGACY;

  try {
    const flag = sessionStorage.getItem("kk.amazon.readyToPush.shellColumns");
    if (flag === "full") {
      readyToPushColumnMode = "full";
      return READY_TO_PUSH_COLUMNS;
    }
    if (flag === "legacy") {
      readyToPushColumnMode = "legacy";
      return READY_TO_PUSH_COLUMNS_LEGACY;
    }
  } catch {
    /* sessionStorage unavailable */
  }

  readyToPushColumnMode = "legacy";
  return READY_TO_PUSH_COLUMNS_LEGACY;
}

function rememberReadyToPushColumnMode(mode) {
  readyToPushColumnMode = mode;
  try {
    sessionStorage.setItem(
      "kk.amazon.readyToPush.shellColumns",
      mode === "full" ? "full" : "legacy",
    );
  } catch {
    /* ignore */
  }
}

/** Call after migration 20260602 is applied so Ready to Push uses DB parent-shell columns. */
export function markAmazonReadyToPushShellColumnsAvailable() {
  rememberReadyToPushColumnMode("full");
}

export async function fetchAmazonReadyToPushProducts(options = {}) {
  const sb = getSupabaseClient();
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 500));
  const orderOpts = { ascending: false, nullsFirst: false };
  const preferFull = options.preferShellColumns === true;
  let columns = preferFull ? READY_TO_PUSH_COLUMNS : resolveReadyToPushSelect();

  let { data, error } = await sb
    .from(READY_TO_PUSH_VIEW)
    .select(columns)
    .order("updated_at", orderOpts)
    .limit(limit);

  if (error && columns !== READY_TO_PUSH_COLUMNS_LEGACY) {
    rememberReadyToPushColumnMode("legacy");
    columns = READY_TO_PUSH_COLUMNS_LEGACY;
    ({ data, error } = await sb
      .from(READY_TO_PUSH_VIEW)
      .select(columns)
      .order("updated_at", orderOpts)
      .limit(limit));
  } else if (!error && preferFull) {
    rememberReadyToPushColumnMode("full");
  }

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
    .select("id, name, code, price, primary_image_url, catalog_image_url, product_variants(stock, is_active)")
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
      imageUrl: row.primary_image_url || row.catalog_image_url || null,
    };
  });
}

/** Full product row for push modal (includes gallery images for image picker). */
export async function fetchKkProductForPush(kkProductId) {
  const sb = getSupabaseClient();
  const id = String(kkProductId || "").trim();
  if (!id) return null;

  const { data, error } = await sb
    .from("products")
    .select([
      "id",
      "name",
      "code",
      "price",
      "primary_image_url",
      "catalog_image_url",
      "catalog_hover_url",
      "product_gallery_images(url, position, is_active)",
      "product_variants(id, option_name, option_value, title, stock, sku, preview_image_url, sort_order, is_active)",
    ].join(","))
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;

  const variants = Array.isArray(data.product_variants)
    ? [...data.product_variants]
        .filter((v) => v?.is_active !== false)
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    : [];
  const stock = variants.reduce((sum, variant) => {
    const qty = Number(variant.stock);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);

  return {
    ...data,
    product_variants: variants,
    stock,
    imageUrl: data.primary_image_url || data.catalog_image_url || null,
  };
}

export async function saveAmazonMapping(payload) {
  return callEdgeFunction("amazon-map-listing", {
    method: "POST",
    body: {
      amazonListingId: payload.amazonListingId,
      kkProductId: payload.kkProductId,
      kkVariantId: payload.kkVariantId || undefined,
      kkSku: payload.kkSku,
      mappingStatus: payload.mappingStatus || "mapped",
      mappingConfidence: payload.mappingConfidence || "manual",
      notes: payload.notes,
    },
  });
}

/** Hide a stale mapped listing from the synced dashboard and unmap for repush. */
export async function dismissAmazonListing(amazonListingId, options = {}) {
  const { notes = "Hidden from dashboard for repush" } = options;

  return saveAmazonMapping({
    amazonListingId,
    mappingStatus: "ignored",
    notes,
  });
}

/** @param {string} kkProductId @param {string} [kkVariantId] */
export async function fetchAmazonReadyToPushBlockers(kkProductId, kkVariantId = null) {
  const sb = getSupabaseClient();
  const id = String(kkProductId || "").trim();
  if (!id) return [];

  let mappedQuery = sb.from("amazon_listing_mappings")
    .select("id")
    .eq("kk_product_id", id)
    .eq("mapping_status", "mapped")
    .limit(1);
  if (kkVariantId) {
    mappedQuery = mappedQuery.eq("kk_variant_id", kkVariantId);
  } else {
    mappedQuery = mappedQuery.is("kk_variant_id", null);
  }

  let submittedQuery = sb.from("amazon_listing_drafts")
    .select("id")
    .eq("kk_product_id", id)
    .eq("draft_status", "submitted")
    .limit(1);
  if (kkVariantId) {
    submittedQuery = submittedQuery.eq("kk_variant_id", kkVariantId);
  } else {
    submittedQuery = submittedQuery.is("kk_variant_id", null);
  }

  const [mappedResult, submittedResult] = await Promise.all([
    mappedQuery,
    submittedQuery,
  ]);

  /** @type {string[]} */
  const blockers = [];
  if (mappedResult.data?.length) blockers.push("still_mapped");
  if (submittedResult.data?.length) blockers.push("submitted_draft");
  return blockers;
}

/** @param {string} kkProductId @param {string} [marketplaceId] */
export async function fetchAmazonCatalogHintForProduct(kkProductId, marketplaceId = "ATVPDKIKX0DER") {
  const sb = getSupabaseClient();
  const id = String(kkProductId || "").trim();
  if (!id) return null;

  const { data, error } = await sb
    .from("amazon_listing_mappings")
    .select("mapping_status, amazon_listings(asin, product_type, seller_sku, marketplace_id)")
    .eq("kk_product_id", id)
    .in("mapping_status", ["mapped", "legacy"]);

  if (error || !Array.isArray(data) || !data.length) return null;

  const sorted = [...data].sort((a, b) => {
    if (a.mapping_status === "mapped" && b.mapping_status !== "mapped") return -1;
    if (b.mapping_status === "mapped" && a.mapping_status !== "mapped") return 1;
    return 0;
  });

  for (const entry of sorted) {
    const listing = entry?.amazon_listings;
    const row = Array.isArray(listing) ? listing[0] : listing;
    if (!row?.asin) continue;
    if (row.marketplace_id && row.marketplace_id !== marketplaceId) continue;
    return {
      asin: String(row.asin),
      productType: row.product_type ? String(row.product_type) : "",
      sellerSku: row.seller_sku ? String(row.seller_sku) : "",
      mappingStatus: entry.mapping_status ? String(entry.mapping_status) : "",
    };
  }

  return null;
}

function isParentVariationDraftRowClient(row) {
  if (!row) return false;
  if (String(row.variation_role || "") === "parent") return true;
  const sku = String(row.seller_sku || "").trim().toUpperCase();
  return sku.endsWith("-PARENT");
}

/** @param {string} kkProductId @param {string} [marketplaceId] */
export async function fetchAmazonVariationFamilyContext(kkProductId, marketplaceId = "ATVPDKIKX0DER") {
  const sb = getSupabaseClient();
  const id = String(kkProductId || "").trim();
  if (!id) return null;

  const { data: draftRows, error } = await sb
    .from("amazon_listing_drafts")
    .select("id, seller_sku, product_type, variation_theme, draft_status, submission_status, variation_role, marketplace_id")
    .eq("kk_product_id", id)
    .neq("draft_status", "archived")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (!error && Array.isArray(draftRows)) {
    for (const row of draftRows) {
      if (!isParentVariationDraftRowClient(row)) continue;
      if (row.marketplace_id && row.marketplace_id !== marketplaceId) continue;
      return {
        parentDraft: row,
        parentSellerSku: row.seller_sku ? String(row.seller_sku) : null,
        parentProductType: row.product_type ? String(row.product_type) : null,
        variationTheme: row.variation_theme ? String(row.variation_theme) : null,
      };
    }
  }

  const { data: product } = await sb
    .from("products")
    .select("code")
    .eq("id", id)
    .maybeSingle();

  const parentSku = product?.code ? `${String(product.code).trim()}-PARENT` : "";
  if (!parentSku) return null;

  const { data: listing } = await sb
    .from("amazon_listings")
    .select("seller_sku, product_type, asin")
    .eq("seller_sku", parentSku)
    .eq("marketplace_id", marketplaceId)
    .maybeSingle();

  if (!listing?.asin || !listing.seller_sku) return null;

  return {
    parentDraft: null,
    parentSellerSku: String(listing.seller_sku),
    parentProductType: listing.product_type ? String(listing.product_type) : null,
    variationTheme: null,
    parentOnAmazonOnly: true,
  };
}

const DRAFTS_VIEW = "v_amazon_drafts_issues";

const DRAFTS_COLUMNS = [
  "draft_id",
  "amazon_listing_id",
  "kk_product_id",
  "kk_variant_id",
  "kk_variant_label",
  "variation_role",
  "parent_draft_id",
  "parent_seller_sku",
  "variation_theme",
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
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 500));

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

export async function amazonAiAutofill(payload) {
  return callEdgeFunction("amazon-ai-autofill", {
    method: "POST",
    body: {
      productName: payload.productName,
      productCode: payload.productCode,
      productType: payload.productType,
      category: payload.category,
      price: payload.price,
      imageUrls: payload.imageUrls || [],
      requiredAttributes: payload.requiredAttributes || [],
      recommendedAttributes: payload.recommendedAttributes || [],
      attributeHints: payload.attributeHints || [],
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
