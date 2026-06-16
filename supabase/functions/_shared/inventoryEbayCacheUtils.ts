/** eBay listing inventory cache read helpers (Phase 7D). Read-only eBay API. */

import { EBAY_API } from "./ebayUtils.ts";

const INV_API = `${EBAY_API}/sell/inventory/v1`;
export const EBAY_CACHE_REFRESH_DEFAULT_LIMIT = 25;
export const EBAY_CACHE_REFRESH_MAX = 50;
export const EBAY_CACHE_DELAY_MS = 220;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quantityValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function inventoryItemQuantity(item: Record<string, unknown>): number | null {
  const availability = isRecord(item.availability) ? item.availability : {};
  const ship = isRecord(availability.shipToLocationAvailability) ? availability.shipToLocationAvailability : {};
  return quantityValue(ship.quantity);
}

function offerAvailableQuantity(offer: Record<string, unknown>): number | null {
  return quantityValue(offer.availableQuantity);
}

function getOfferStatus(offer: Record<string, unknown>): string | null {
  const raw = offer.statusEnum ?? offer.status ?? offer.offerStatus;
  return typeof raw === "string" && raw.trim() ? raw.trim().toUpperCase() : null;
}

function getOfferListingId(offer: Record<string, unknown>): string | null {
  const listing = isRecord(offer.listing) ? offer.listing : {};
  const id = listing.listingId ?? listing.legacyItemId ?? offer.ebayItemId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function offerIdValue(offer: Record<string, unknown>): string | null {
  return typeof offer.offerId === "string" && offer.offerId.trim() ? offer.offerId.trim() : null;
}

const INACTIVE_OFFER_STATUSES = new Set(["ENDED", "WITHDRAWN", "UNPUBLISHED", "ARCHIVED", "INACTIVE"]);

export function isActiveOffer(offer: Record<string, unknown>): boolean {
  const status = getOfferStatus(offer);
  if (status && INACTIVE_OFFER_STATUSES.has(status)) return false;
  return Boolean(getOfferListingId(offer) || status === "PUBLISHED");
}

export function mapOfferListingStatus(offer: Record<string, unknown>): string {
  const status = getOfferStatus(offer);
  if (!status) return "unknown";
  if (INACTIVE_OFFER_STATUSES.has(status)) return "ended";
  if (status === "PUBLISHED") return "active";
  return status.toLowerCase();
}

export function variantSkuFromOption(baseCode: string, optionValue: string): string {
  const suffix = String(optionValue || "").toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
  return `${baseCode}-${suffix}`;
}

export async function ebayInventoryFetch(
  token: string,
  method: string,
  url: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
  });
  if (resp.status === 204) return { ok: true, status: 204, data: null };
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { rawResponse: text.slice(0, 500) };
  }
  return { ok: resp.ok, status: resp.status, data };
}

export type EbayCacheRowInput = {
  product_id: string;
  variant_id?: string | null;
  ebay_item_id?: string | null;
  ebay_sku: string;
  listing_status?: string | null;
  current_qty?: number | null;
  available_qty?: number | null;
  listing_url?: string | null;
  raw_status?: string | null;
  raw_payload_json?: Record<string, unknown> | null;
};

export type ProductRefreshTarget = {
  id: string;
  code: string;
  ebay_sku: string | null;
  ebay_listing_id: string | null;
  ebay_offer_id: string | null;
  ebay_status: string | null;
  ebay_item_group_key: string | null;
};

export type VariantRow = {
  id: string;
  sku: string | null;
  option_value: string | null;
};

function resolveCurrentQty(offerQty: number | null, itemQty: number | null): number | null {
  if (offerQty != null) return offerQty;
  return itemQty;
}

function listingUrl(itemId: string | null | undefined): string | null {
  const id = String(itemId || "").trim();
  return id ? `https://www.ebay.com/itm/${id}` : null;
}

async function readSkuCache(
  accessToken: string,
  product: ProductRefreshTarget,
  sku: string,
  variantId: string | null,
  fallbackListingId: string | null,
): Promise<{ ok: true; row: EbayCacheRowInput } | { ok: false; error: string }> {
  const offersRes = await ebayInventoryFetch(
    accessToken,
    "GET",
    `${INV_API}/offer?sku=${encodeURIComponent(sku)}`,
  );
  if (!offersRes.ok) {
    return { ok: false, error: `offer_lookup_failed_${offersRes.status}` };
  }

  const payload = isRecord(offersRes.data) ? offersRes.data : {};
  const offers = Array.isArray(payload.offers) ? payload.offers.filter(isRecord) : [];
  const offer = offers.find(isActiveOffer) || offers[0] || null;

  let itemQty: number | null = null;
  const itemRes = await ebayInventoryFetch(
    accessToken,
    "GET",
    `${INV_API}/inventory_item/${encodeURIComponent(sku)}`,
  );
  if (itemRes.ok && isRecord(itemRes.data)) {
    itemQty = inventoryItemQuantity(itemRes.data);
  }

  const offerQty = offer ? offerAvailableQuantity(offer) : null;
  const listingId = offer ? getOfferListingId(offer) : fallbackListingId;
  const listingStatus = offer
    ? mapOfferListingStatus(offer)
    : (product.ebay_status || "unknown");

  return {
    ok: true,
    row: {
      product_id: product.id,
      variant_id: variantId,
      ebay_item_id: listingId,
      ebay_sku: sku,
      listing_status: listingStatus,
      current_qty: resolveCurrentQty(offerQty, itemQty),
      available_qty: resolveCurrentQty(offerQty, itemQty),
      listing_url: listingUrl(listingId),
      raw_status: offer ? getOfferStatus(offer) : null,
      raw_payload_json: {
        offerId: offer ? offerIdValue(offer) : null,
        offerQuantity: offerQty,
        inventoryQuantity: itemQty,
      },
    },
  };
}

export async function refreshProductEbayCache(
  accessToken: string,
  product: ProductRefreshTarget,
  variants: VariantRow[],
): Promise<{ rows: EbayCacheRowInput[]; errors: string[] }> {
  const rows: EbayCacheRowInput[] = [];
  const errors: string[] = [];
  const baseSku = String(product.ebay_sku || product.code || "").trim();
  if (!baseSku && !product.ebay_item_group_key) {
    errors.push("missing_ebay_sku");
    return { rows, errors };
  }

  if (product.ebay_item_group_key) {
    const groupRes = await ebayInventoryFetch(
      accessToken,
      "GET",
      `${INV_API}/offer?inventory_item_group_key=${encodeURIComponent(product.ebay_item_group_key)}`,
    );
    if (!groupRes.ok) {
      errors.push(`group_offer_lookup_failed_${groupRes.status}`);
      return { rows, errors };
    }
    const payload = isRecord(groupRes.data) ? groupRes.data : {};
    const offers = Array.isArray(payload.offers) ? payload.offers.filter(isRecord) : [];
    for (const offer of offers) {
      const sku = typeof offer.sku === "string" ? offer.sku.trim() : "";
      if (!sku) continue;
      const variant = variants.find((v) => {
        const generated = variantSkuFromOption(product.code, v.option_value || "");
        return sku === generated || sku === String(v.sku || "").trim();
      });
      const result = await readSkuCache(
        accessToken,
        product,
        sku,
        variant?.id ?? null,
        product.ebay_listing_id,
      );
      if (result.ok) rows.push(result.row);
      else errors.push(`${sku}:${result.error}`);
    }
    return { rows, errors };
  }

  const result = await readSkuCache(
    accessToken,
    product,
    baseSku,
    variants.length === 1 ? variants[0]?.id ?? null : null,
    product.ebay_listing_id,
  );
  if (result.ok) rows.push(result.row);
  else errors.push(result.error);
  return { rows, errors };
}

export async function upsertEbayCacheRows(
  // deno-lint-ignore no-explicit-any
  client: any,
  rows: EbayCacheRowInput[],
  now: string,
): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    ...r,
    last_synced_at: now,
    updated_at: now,
  }));
  const { error } = await client
    .from("ebay_listing_inventory_cache")
    .upsert(payload, { onConflict: "product_id,ebay_sku" });
  if (error) throw new Error(error.message || "cache_upsert_failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep };
