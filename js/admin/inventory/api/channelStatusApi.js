/**
 * Read-only channel connection status for Inventory dashboard (Phase 3C).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import { formatRelativeTime } from "../utils/formatters.js";

const MARKETPLACE_LABELS = {
  ATVPDKIKX0DER: "US · Amazon.com",
};

/**
 * @typedef {Object} ChannelBlock
 * @property {string} label
 * @property {boolean|null} connected
 * @property {string} subtitle
 * @property {'connected'|'attention'|'unknown'|'offline'} state
 * @property {string} statusLabel
 */

/**
 * @typedef {Object} ChannelStatusData
 * @property {ChannelBlock} kk
 * @property {ChannelBlock} ebay
 * @property {ChannelBlock} amazon
 * @property {string} lastGlobalSync
 * @property {boolean} live
 * @property {boolean} needsAttention
 */

/** @param {string|null|undefined} ids */
function marketplaceLabel(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return "Amazon";
  return MARKETPLACE_LABELS[list[0]] || list[0];
}

/** @returns {Promise<Record<string, unknown>|null>} */
async function fetchAmazonAuthStatus() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.access_token) return null;

  const url = `${SUPABASE_URL}/functions/v1/amazon-auth-status`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.ok ? data : null;
}

/** @returns {Promise<Record<string, unknown>|null>} */
async function fetchEbayTokenMeta() {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("marketplace_tokens")
    .select("platform, token_expires_at, updated_at, extra")
    .eq("platform", "ebay")
    .maybeSingle();

  if (error) return null;
  return data;
}

/** @param {Record<string, unknown>|null} row */
function mapSyncRow(row) {
  return {
    amazonLastSync: row?.amazon_last_listing_sync_at
      ? String(row.amazon_last_listing_sync_at)
      : null,
    lastStockActivity: row?.last_stock_activity_at
      ? String(row.last_stock_activity_at)
      : null,
    ebayActiveListings: Number(row?.ebay_active_listing_count ?? 0),
    ebayEndedListings: Number(row?.ebay_ended_listing_count ?? 0),
    amazonListingCount: Number(row?.amazon_listing_count ?? 0),
  };
}

/** @param {string|null} iso */
function pickLatestSync(...isoValues) {
  let latest = null;
  let latestMs = 0;
  for (const iso of isoValues) {
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latest = iso;
    }
  }
  if (!latest) return "No sync recorded";
  return formatRelativeTime(latest);
}

/**
 * @returns {Promise<ChannelStatusData>}
 */
export async function fetchChannelStatus() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const [syncRes, amazonAuth, ebayMeta] = await Promise.all([
    sb.from("v_inventory_channel_status").select("*").maybeSingle(),
    fetchAmazonAuthStatus().catch(() => null),
    fetchEbayTokenMeta().catch(() => null),
  ]);

  if (syncRes.error) {
    throw new Error(syncRes.error.message || "Failed to load channel status");
  }

  const sync = mapSyncRow(syncRes.data);

  const amazonConnected = amazonAuth?.connected === true;
  const amazonTokenStatus = String(amazonAuth?.tokenStatus || "unknown");
  const amazonNeedsAttention =
    !amazonConnected ||
    amazonTokenStatus === "expired" ||
    amazonTokenStatus === "error" ||
    amazonTokenStatus === "revoked";

  const ebayExtra = /** @type {Record<string, unknown>|null} */ (
    ebayMeta?.extra && typeof ebayMeta.extra === "object" ? ebayMeta.extra : null
  );
  const ebayOAuthConnected =
    ebayExtra?.connected === true ||
    (ebayMeta?.token_expires_at &&
      new Date(String(ebayMeta.token_expires_at)).getTime() > Date.now());

  let ebayConnected = null;
  let ebayState = /** @type {'connected'|'attention'|'unknown'|'offline'} */ ("unknown");
  let ebayStatusLabel = "Status unverified";
  let ebaySubtitle = "ebay.com/usr/karrykrazestore";

  if (ebayOAuthConnected) {
    ebayConnected = true;
    ebayState = sync.ebayEndedListings > 0 ? "attention" : "connected";
    ebayStatusLabel =
      sync.ebayEndedListings > 0 ? "Connected · listings need attention" : "Connected";
    ebaySubtitle = `${sync.ebayActiveListings} active listing(s) on eBay`;
  } else if (sync.ebayActiveListings > 0) {
    ebayConnected = null;
    ebayState = "attention";
    ebayStatusLabel = "Listings present · OAuth not verified";
    ebaySubtitle = `${sync.ebayActiveListings} product listing(s) · qty cache N/A`;
  } else {
    ebayConnected = false;
    ebayState = "offline";
    ebayStatusLabel = "Not connected";
    ebaySubtitle = "No active eBay listings detected";
  }

  const amazonSubtitle = amazonConnected
    ? `${marketplaceLabel(amazonAuth?.marketplaceIds)} · ${sync.amazonListingCount} listing(s)`
    : amazonAuth
      ? "Amazon account not connected"
      : "Connection status unavailable";

  const amazonState = amazonConnected
    ? "connected"
    : amazonNeedsAttention
      ? "attention"
      : amazonAuth
        ? "offline"
        : "unknown";

  const needsAttention =
    amazonState === "attention" ||
    ebayState === "attention" ||
    sync.ebayEndedListings > 0;

  return {
    kk: {
      label: "KK Store",
      connected: true,
      subtitle: "karrykrazestore.com",
      state: "connected",
      statusLabel: "Online",
    },
    ebay: {
      label: "eBay",
      connected: ebayConnected,
      subtitle: ebaySubtitle,
      state: ebayState,
      statusLabel: ebayStatusLabel,
    },
    amazon: {
      label: "Amazon",
      connected: amazonConnected,
      subtitle: amazonSubtitle,
      state: amazonState,
      statusLabel: amazonConnected
        ? "Connected"
        : amazonNeedsAttention
          ? "Needs attention"
          : amazonAuth
            ? "Not connected"
            : "Status unavailable",
    },
    lastGlobalSync: pickLatestSync(
      sync.amazonLastSync,
      sync.lastStockActivity,
      amazonAuth?.lastTokenRefreshAt ? String(amazonAuth.lastTokenRefreshAt) : null,
      ebayMeta?.updated_at ? String(ebayMeta.updated_at) : null,
    ),
    live: true,
    needsAttention,
  };
}

/** @returns {ChannelStatusData} */
export function mockChannelStatus() {
  return {
    kk: {
      label: "KK Store",
      connected: true,
      subtitle: "karrykrazestore.com",
      state: "connected",
      statusLabel: "Online",
    },
    ebay: {
      label: "eBay",
      connected: null,
      subtitle: "Channel status unavailable",
      state: "unknown",
      statusLabel: "Fallback",
    },
    amazon: {
      label: "Amazon",
      connected: null,
      subtitle: "Channel status unavailable",
      state: "unknown",
      statusLabel: "Fallback",
    },
    lastGlobalSync: "Not available",
    live: false,
    needsAttention: false,
  };
}
