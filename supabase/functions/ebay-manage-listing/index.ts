// ebay-manage-listing — Unified handler for eBay Inventory API operations
// Actions: create_item, create_offer, publish, update_item, update_offer,
//          withdraw, delete_item, get_item, list_items, get_offers, bulk_update, get_policies, setup_location
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  createServiceClient,
  getAccessToken,
  EBAY_API,
} from "../_shared/ebayUtils.ts";

function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as { role?: string };
    return parsed.role || null;
  } catch {
    return null;
  }
}

const INV_API = `${EBAY_API}/sell/inventory/v1`;
const ACCT_API = `${EBAY_API}/sell/account/v1`;
const MKTG_API = `${EBAY_API}/sell/marketing/v1`;

/** Make an authenticated request to eBay Inventory/Account API */
async function ebayFetch(
  token: string,
  method: string,
  url: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; headers: Headers }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Language": "en-US",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Language"] = "en-US";
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Some endpoints return 204 No Content on success (PUT inventory_item)
  if (resp.status === 204) {
    return { ok: true, status: 204, data: null, headers: resp.headers };
  }

  const text = await resp.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawResponse: text.slice(0, 500) };
  }

  if (!resp.ok) {
    console.error(`[ebay-listing] ${method} ${url} → ${resp.status}:`, text.slice(0, 500));
  }

  return { ok: resp.ok, status: resp.status, data, headers: resp.headers };
}

async function deleteEbayResource(accessToken: string, url: string): Promise<{ ok: boolean; skipped?: boolean; status?: number; data?: unknown }> {
  const result = await ebayFetch(accessToken, "DELETE", url);
  if (result.ok || result.status === 204 || result.status === 404) {
    return { ok: true, skipped: result.status === 404, status: result.status };
  }
  return { ok: false, status: result.status, data: result.data, skipped: false };
}

// Detects eBay eventual-consistency errors: 25604 (Product not found at publish) and 25709 (Invalid InventoryItemBundleKey)
function isEbayProductNotFoundPublishError(data: unknown): boolean {
  const payload = data as { errors?: Array<{ errorId?: number }> } | null;
  return Boolean(payload?.errors?.some((e) => e?.errorId === 25604 || e?.errorId === 25709));
}

function getEbayErrors(data: unknown): Array<{ errorId?: number; message?: string }> {
  const payload = data as { errors?: Array<{ errorId?: number; message?: string }> } | null;
  return Array.isArray(payload?.errors) ? payload.errors : [];
}

function classifyOfferLookupFailure(status: number, data: unknown, hasGroupKey: boolean): { code: string; state: string; message: string } {
  const errors = getEbayErrors(data);
  const rawMessage = errors[0]?.message || `Offer lookup failed (${status})`;
  const detail = `${rawMessage} ${JSON.stringify(data || {})}`;
  if (/invalid value for a sku|invalid sku/i.test(detail)) {
    return {
      code: hasGroupKey ? "INVALID_GROUP_OFFER_LOOKUP_PATH" : "INVALID_SKU_OFFER_LOOKUP",
      state: "offer_mapping_unresolved",
      message: hasGroupKey
        ? "The eBay group offer lookup used an invalid SKU lookup path. Refresh this page and try again."
        : "The eBay offer lookup used an invalid SKU. Refresh/relink this listing before editing.",
    };
  }
  if (/offer is not available|this offer is not available/i.test(detail)) {
    return {
      code: hasGroupKey ? "GROUP_OFFER_NOT_AVAILABLE" : "OFFER_NOT_AVAILABLE",
      state: "offer_mapping_unresolved",
      message: hasGroupKey
        ? "This variant listing's eBay group offer is not available. Refresh/relink this listing before editing."
        : "This eBay offer is not available. Refresh/relink this listing before editing.",
    };
  }
  if (status === 404 || /not found|does not exist/i.test(detail)) {
    return {
      code: hasGroupKey ? "STALE_OFFER_MAPPING" : "OFFER_NOT_AVAILABLE",
      state: "offer_mapping_unresolved",
      message: "The saved local eBay offer mapping appears stale or missing. Refresh/relink this listing before editing.",
    };
  }
  if (status >= 500) {
    return {
      code: "EBAY_OFFER_LOOKUP_FAILED",
      state: "ebay_api_failure",
      message: "eBay offer verification failed due to an upstream API error. Try again later before saving edits.",
    };
  }
  return {
    code: "RELINK_REQUIRED",
    state: "offer_mapping_unresolved",
    message: rawMessage,
  };
}

function normalizeSkuList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((sku) => typeof sku === "string" ? sku.trim() : "").filter(Boolean))];
}

function diagnosticMessage(diagnostic: Record<string, unknown>, fallback: string): string {
  const reasonCode = typeof diagnostic.reasonCode === "string" ? diagnostic.reasonCode : "";
  const mismatched = normalizeSkuList(diagnostic.mismatchedLocalSkus);
  if (mismatched.length) {
    return "Local variant SKUs do not match eBay’s variant SKUs. Review/relink before saving.";
  }
  const unavailable = normalizeSkuList(diagnostic.unavailableOfferSkus);
  if (unavailable.length) {
    return `eBay could not find active child offers for: ${unavailable.join(", ")}. These variants may be ended, sold out, removed, or renamed.`;
  }
  const missing = normalizeSkuList(diagnostic.missingOfferSkus);
  if (missing.length) {
    return `eBay could not find active child offers for: ${missing.join(", ")}. These variants may be ended, sold out, removed, or renamed.`;
  }
  if (reasonCode === "ACTIVE_ZERO_QUANTITY") return "Sold out on eBay — quantity is 0. Restock to make this listing purchasable again.";
  if (reasonCode === "STALE_LOCAL_GROUP_KEY") return "Saved local eBay group key is stale or missing on eBay. Clear stale link or relink before saving.";
  if (reasonCode === "EBAY_API_FAILURE") return "eBay verification failed due to an upstream API error. Try again later before saving edits.";
  const activeListingIds = normalizeSkuList(diagnostic.activeListingIds);
  if (!activeListingIds.length) {
    return "No active eBay group listing found. Clear stale link or relist later after your account restriction is resolved.";
  }
  return fallback;
}

async function getVariantSkusForGroup(accessToken: string, inventoryItemGroupKey: string): Promise<{ ok: boolean; skus: string[]; status?: number; data?: unknown }> {
  const result = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`);
  if (!result.ok) return { ok: false, skus: [], status: result.status, data: result.data };
  const group = isRecord(result.data) ? result.data : {};
  return { ok: true, skus: normalizeSkuList(group.variantSKUs) };
}

async function getOffersBySkus(accessToken: string, skus: string[]): Promise<{ ok: boolean; offers: Record<string, unknown>[]; failures: Array<{ sku: string; status: number; data: unknown }> }> {
  const offers: Record<string, unknown>[] = [];
  const failures: Array<{ sku: string; status: number; data: unknown }> = [];

  for (const sku of normalizeSkuList(skus)) {
    const result = await ebayFetch(accessToken, "GET", `${INV_API}/offer?sku=${encodeURIComponent(sku)}`);
    if (!result.ok) {
      failures.push({ sku, status: result.status, data: result.data });
      continue;
    }
    const payload = isRecord(result.data) ? result.data : {};
    const rows = Array.isArray(payload.offers) ? payload.offers.filter(isRecord) : [];
    offers.push(...rows);
  }

  return { ok: failures.length === 0, offers, failures };
}

async function diagnoseGroupOfferMapping(accessToken: string, inventoryItemGroupKey: string, localExpectedSkusInput?: unknown, productCodeInput?: unknown): Promise<{ ok: boolean; diagnostic: Record<string, unknown>; offers: Record<string, unknown>[]; failures: Array<{ sku: string; status: number; data: unknown }>; message: string }> {
  const localExpectedSkus = normalizeSkuList(localExpectedSkusInput);
  const productCode = typeof productCodeInput === "string" && productCodeInput.trim() ? productCodeInput.trim() : "";
  const groupLookup = await getVariantSkusForGroup(accessToken, inventoryItemGroupKey);
  const ebayGroupVariantSkus = groupLookup.skus;
  const mismatchedLocalSkus = [
    ...localExpectedSkus.filter((sku) => !ebayGroupVariantSkus.includes(sku)),
    ...ebayGroupVariantSkus.filter((sku) => localExpectedSkus.length && !localExpectedSkus.includes(sku)),
  ];
  const diagnostic: Record<string, unknown> = {
    ...(productCode ? { productCode } : {}),
    inventoryItemGroupKey,
    localExpectedSkus,
    ebayGroupVariantSkus,
    foundOfferSkus: [],
    missingOfferSkus: [],
    unavailableOfferSkus: [],
    mismatchedLocalSkus: [...new Set(mismatchedLocalSkus)],
    activeListingIds: [],
  };

  if (!groupLookup.ok) {
    diagnostic.reasonCode = (groupLookup.status || 0) >= 500 ? "EBAY_API_FAILURE" : "STALE_LOCAL_GROUP_KEY";
    diagnostic.upstreamStatus = groupLookup.status;
    diagnostic.upstream = groupLookup.data;
    return { ok: false, diagnostic, offers: [], failures: [], message: diagnosticMessage(diagnostic, "Could not load eBay group variant SKUs. Refresh/relink this listing before saving.") };
  }

  if (!groupLookup.skus.length) {
    diagnostic.reasonCode = "GROUP_VARIANT_SKUS_MISSING";
    return { ok: false, diagnostic, offers: [], failures: [], message: diagnosticMessage(diagnostic, "This eBay inventory item group has no variant SKUs to verify. Refresh/relink this listing before saving.") };
  }

  const lookupSkus = groupLookup.skus;
  const grouped = await getOffersBySkus(accessToken, lookupSkus);
  const activeOffers = grouped.offers.filter(isActiveOffer);
  const foundOfferSkus = [...new Set(activeOffers.map((offer) => typeof offer.sku === "string" ? offer.sku.trim() : "").filter(Boolean))];
  const activeListingIds = [...new Set(activeOffers.map(getOfferListingId).filter((value): value is string => Boolean(value)))];
  const activeOfferQuantities = await Promise.all(activeOffers.map(async (offer) => {
    const offerSku = typeof offer.sku === "string" && offer.sku.trim() ? offer.sku.trim() : null;
    let itemQuantity: number | null = null;
    if (offerSku) {
      const itemResult = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item/${encodeURIComponent(offerSku)}`);
      if (itemResult.ok && isRecord(itemResult.data)) itemQuantity = inventoryItemQuantity(itemResult.data);
    }
    return {
      sku: offerSku,
      offerQuantity: offerAvailableQuantity(offer),
      inventoryQuantity: itemQuantity,
    };
  }));
  const unavailableOfferSkus = grouped.failures
    .filter((failure) => classifyOfferLookupFailure(failure.status, failure.data, false).code === "OFFER_NOT_AVAILABLE")
    .map((failure) => failure.sku);
  const missingOfferSkus = lookupSkus.filter((sku) => !foundOfferSkus.includes(sku));
  const firstFailure = grouped.failures[0];
  const firstFailureCode = firstFailure ? classifyOfferLookupFailure(firstFailure.status, firstFailure.data, false).code : "";
  const hasEbayApiFailure = grouped.failures.some((failure) => failure.status >= 500 || classifyOfferLookupFailure(failure.status, failure.data, false).state === "ebay_api_failure");
  const allActiveOffersZeroQuantity = activeOffers.length > 0 && activeOfferQuantities.every((q) => (q.offerQuantity ?? q.inventoryQuantity ?? 0) <= 0 || (q.inventoryQuantity ?? q.offerQuantity ?? 0) <= 0);

  diagnostic.foundOfferSkus = foundOfferSkus;
  diagnostic.missingOfferSkus = missingOfferSkus;
  diagnostic.unavailableOfferSkus = unavailableOfferSkus;
  diagnostic.activeListingIds = activeListingIds;
  diagnostic.offerQuantities = activeOfferQuantities;
  diagnostic.reasonCode = normalizeSkuList(diagnostic.mismatchedLocalSkus).length
    ? "LOCAL_VARIANT_SKU_MISMATCH"
    : hasEbayApiFailure
      ? "EBAY_API_FAILURE"
      : unavailableOfferSkus.length
        ? "OFFER_NOT_AVAILABLE"
        : missingOfferSkus.length
          ? "GROUP_CHILD_OFFERS_MISSING"
          : !activeListingIds.length
            ? "NO_ACTIVE_EBAY_MATCH"
            : allActiveOffersZeroQuantity
              ? "ACTIVE_ZERO_QUANTITY"
              : firstFailureCode || "LINK_HEALTHY";
  if (grouped.failures.length) diagnostic.failures = grouped.failures;

  const ok = grouped.ok
    && !normalizeSkuList(diagnostic.mismatchedLocalSkus).length
    && !missingOfferSkus.length
    && !unavailableOfferSkus.length
    && activeListingIds.length > 0
    && !allActiveOffersZeroQuantity;
  return {
    ok,
    diagnostic,
    offers: grouped.offers,
    failures: grouped.failures,
    message: diagnosticMessage(diagnostic, ok ? "eBay group child offer mapping is healthy." : "This variant listing could not be matched to active eBay offers. Refresh/relink this listing before saving."),
  };
}

function isTransientGetItemError(status: number, data: unknown): boolean {
  const errors = getEbayErrors(data);
  return status >= 500 || errors.some((e) => e?.errorId === 25001 || /system error/i.test(e?.message || ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function configuredLocationKey(): string {
  return Deno.env.get("EBAY_LOCATION_KEY") || "default";
}

function isLocationInfoNotFoundError(data: unknown): boolean {
  const errors = getEbayErrors(data);
  return errors.some((e) => e?.errorId === 25002 && /location information not found/i.test(e?.message || ""))
    || /location information not found/i.test(JSON.stringify(data || {}));
}

function getOfferListingId(offer: Record<string, unknown>): string | null {
  const listing = offer.listing;
  if (!isRecord(listing)) return null;
  const value = listing.listingId || listing.legacyItemId || listing.ebayItemId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getOfferStatus(offer: Record<string, unknown>): string {
  const value = offer.statusEnum || offer.status || offer.offerStatus;
  return typeof value === "string" ? value.toUpperCase() : "";
}

function isActiveOffer(offer: Record<string, unknown>): boolean {
  const listingId = getOfferListingId(offer);
  if (!listingId) return false;
  const status = getOfferStatus(offer);
  return !["ENDED", "WITHDRAWN", "UNPUBLISHED", "ARCHIVED", "INACTIVE"].includes(status);
}

function offerPriceCents(offer: Record<string, unknown>): number | null {
  const pricing = isRecord(offer.pricingSummary) ? offer.pricingSummary : {};
  const price = isRecord(pricing.price) ? pricing.price : {};
  const raw = price.value;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function offerCategoryId(offer: Record<string, unknown>): string | null {
  return typeof offer.categoryId === "string" && offer.categoryId.trim() ? offer.categoryId.trim() : null;
}

function offerIdValue(offer: Record<string, unknown>): string | null {
  return typeof offer.offerId === "string" && offer.offerId.trim() ? offer.offerId.trim() : null;
}

function positiveQuantity(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const qty = Math.floor(parsed);
  return qty > 0 ? qty : null;
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

function stripOfferReadonlyFields(offer: Record<string, unknown>): Record<string, unknown> {
  const writable = { ...offer };
  ["offerId", "listing", "statusEnum", "auditInfo", "format", "marketplaceId"].forEach((k) => delete writable[k]);
  return writable;
}

function hasAspectValue(aspects: Record<string, unknown>, aspectName: string): boolean {
  return Object.keys(aspects).some((key) => key.toLowerCase() === aspectName.toLowerCase()
    && (Array.isArray(aspects[key])
      ? (aspects[key] as unknown[]).some((value) => typeof value === "string" && value.trim())
      : typeof aspects[key] === "string" && (aspects[key] as string).trim()));
}

function defaultTypeAspect(title: unknown): string {
  const text = typeof title === "string" ? title.toLowerCase() : "";
  if (/key\s*chain|keychain/.test(text)) return "Keychain";
  if (/charm/.test(text)) return "Charm";
  if (/beanie/.test(text)) return "Beanie";
  if (/hat|cap/.test(text)) return "Hat";
  if (/earring/.test(text)) return "Earrings";
  if (/necklace/.test(text)) return "Necklace";
  if (/bracelet/.test(text)) return "Bracelet";
  if (/ring/.test(text)) return "Ring";
  if (/bag|tote|purse/.test(text)) return "Bag";
  if (/hoodie/.test(text)) return "Hoodie";
  if (/plush/.test(text)) return "Plush";
  return "Accessory";
}

function defaultRequiredAspectValue(aspectName: string, title?: unknown): string {
  const key = aspectName.toLowerCase();
  if (key === "brand") return "Unbranded";
  if (key === "type") return defaultTypeAspect(title);
  if (key === "department") return "Unisex Adults";
  if (key === "color") return "Multicolor";
  if (key === "style") return "Novelty";
  if (key === "theme") return "Novelty";
  if (key === "material") return "Mixed Materials";
  return "Not Specified";
}

function missingItemSpecificNames(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.errors)) return [];
  const names = new Set<string>();
  for (const err of data.errors) {
    if (!isRecord(err)) continue;
    const message = typeof err.message === "string" ? err.message : "";
    const fromMessage = message.match(/item specific\s+(.+?)\s+is missing/i)?.[1]?.trim();
    if (fromMessage) names.add(fromMessage);
    const params = Array.isArray(err.parameters) ? err.parameters : [];
    for (const param of params) {
      if (!isRecord(param)) continue;
      if (param.name === "2" && typeof param.value === "string" && param.value.trim()) names.add(param.value.trim());
    }
  }
  return [...names];
}

function normalizeProductAspects(aspects: unknown, title?: unknown, requiredAspectNames: string[] = []): Record<string, unknown> {
  const normalized = isRecord(aspects) ? { ...aspects } : {};
  for (const aspectName of ["Brand", "Type", "Department", ...requiredAspectNames]) {
    if (!hasAspectValue(normalized, aspectName)) normalized[aspectName] = [defaultRequiredAspectValue(aspectName, title)];
  }
  return normalized;
}

async function ensureInventoryItemRequiredAspects(accessToken: string, sku: string | undefined, requiredAspectNames: string[] = []): Promise<{ ok: boolean; repaired?: boolean; error?: string; details?: Record<string, unknown> }> {
  if (!sku) return { ok: true };
  const currentItem = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item/${encodeURIComponent(sku)}`);
  if (!currentItem.ok) {
    return { ok: false, error: `Get inventory item failed (${currentItem.status})`, details: { sku, upstreamStatus: currentItem.status, upstream: currentItem.data } };
  }
  if (!isRecord(currentItem.data)) return { ok: false, error: "Inventory item response was invalid", details: { sku } };
  const item = currentItem.data;
  const product = isRecord(item.product) ? { ...item.product } : {};
  const before = isRecord(product.aspects) ? product.aspects : {};
  const required = ["Brand", "Type", "Department", ...requiredAspectNames].filter((name, index, arr) => arr.findIndex((v) => v.toLowerCase() === name.toLowerCase()) === index);
  const after = normalizeProductAspects(before, product.title, requiredAspectNames);
  const missingAspects = required.filter((name) => !hasAspectValue(before, name));
  if (!missingAspects.length) return { ok: true, repaired: false };

  product.aspects = after;
  const updateBody: Record<string, unknown> = {
    condition: item.condition || "NEW",
    availability: isRecord(item.availability) ? item.availability : { shipToLocationAvailability: { quantity: 1 } },
    product,
  };
  if (item.packageWeightAndSize) updateBody.packageWeightAndSize = item.packageWeightAndSize;
  if (item.lotSize) updateBody.lotSize = item.lotSize;
  const update = await ebayFetch(accessToken, "PUT", `${INV_API}/inventory_item/${encodeURIComponent(sku)}`, updateBody);
  if (!update.ok && update.status !== 204) {
    return { ok: false, error: `Repair required item specifics failed (${update.status})`, details: { sku, missingAspects, upstreamStatus: update.status, upstream: update.data } };
  }
  return { ok: true, repaired: true, details: { sku, repairedAspects: missingAspects } };
}

async function ensurePublishQuantity(accessToken: string, offerId: string, fallbackSku: string | undefined, desiredQuantity: number | null): Promise<{ ok: boolean; sku?: string; quantity?: number; error?: string; details?: Record<string, unknown> }> {
  const currentOffer = await ebayFetch(accessToken, "GET", `${INV_API}/offer/${offerId}`);
  if (!currentOffer.ok) {
    return { ok: false, error: `Get offer failed (${currentOffer.status})`, details: { offerId, upstreamStatus: currentOffer.status, upstream: currentOffer.data } };
  }

  const offer = isRecord(currentOffer.data) ? currentOffer.data : {};
  const offerSku = typeof offer.sku === "string" && offer.sku.trim() ? offer.sku.trim() : fallbackSku;
  const offerQty = positiveQuantity(offer.availableQuantity);
  let repairedQuantity = offerQty;

  if (!offerQty) {
    if (!desiredQuantity) {
      return { ok: false, sku: offerSku, error: "Publish requires quantity greater than 0 before eBay will accept the listing.", details: { offerId, sku: offerSku, availableQuantity: offer.availableQuantity } };
    }
    const updatedOffer = stripOfferReadonlyFields(offer);
    updatedOffer.availableQuantity = desiredQuantity;
    const offerUpdate = await ebayFetch(accessToken, "PUT", `${INV_API}/offer/${offerId}`, updatedOffer);
    if (!offerUpdate.ok && offerUpdate.status !== 204) {
      return { ok: false, sku: offerSku, error: `Repair offer quantity failed (${offerUpdate.status})`, details: { offerId, sku: offerSku, upstreamStatus: offerUpdate.status, upstream: offerUpdate.data } };
    }
    repairedQuantity = desiredQuantity;
  }

  if (offerSku) {
    const currentItem = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item/${encodeURIComponent(offerSku)}`);
    if (currentItem.ok && isRecord(currentItem.data)) {
      const itemQty = positiveQuantity(inventoryItemQuantity(currentItem.data));
      if (!itemQty) {
        if (!desiredQuantity) {
          return { ok: false, sku: offerSku, error: "Publish requires inventory item quantity greater than 0 before eBay will accept the listing.", details: { offerId, sku: offerSku, inventoryQuantity: inventoryItemQuantity(currentItem.data) } };
        }
        const existingItem = currentItem.data;
        const availability = isRecord(existingItem.availability) ? { ...existingItem.availability } : {};
        availability.shipToLocationAvailability = {
          ...(isRecord(availability.shipToLocationAvailability) ? availability.shipToLocationAvailability : {}),
          quantity: desiredQuantity,
        };
        const itemUpdateBody: Record<string, unknown> = {
          condition: existingItem.condition || "NEW",
          availability,
          product: isRecord(existingItem.product) ? existingItem.product : {},
        };
        if (existingItem.packageWeightAndSize) itemUpdateBody.packageWeightAndSize = existingItem.packageWeightAndSize;
        if (existingItem.lotSize) itemUpdateBody.lotSize = existingItem.lotSize;
        const itemUpdate = await ebayFetch(accessToken, "PUT", `${INV_API}/inventory_item/${encodeURIComponent(offerSku)}`, itemUpdateBody);
        if (!itemUpdate.ok && itemUpdate.status !== 204) {
          return { ok: false, sku: offerSku, error: `Repair inventory quantity failed (${itemUpdate.status})`, details: { offerId, sku: offerSku, upstreamStatus: itemUpdate.status, upstream: itemUpdate.data } };
        }
        repairedQuantity = desiredQuantity;
      }
    }
  }

  return { ok: true, sku: offerSku, quantity: repairedQuantity || desiredQuantity || undefined };
}

function structuredOfferFailure(
  code: string,
  message: string,
  details: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({ success: false, code, message, error: message, details }),
    { headers: corsHeaders },
  );
}

async function verifyMerchantLocation(accessToken: string, locationKey: string): Promise<Record<string, unknown>> {
  const result = await ebayFetch(
    accessToken,
    "GET",
    `${INV_API}/location/${encodeURIComponent(locationKey)}`,
  );
  const data = isRecord(result.data) ? result.data : {};
  const merchantLocationStatus = typeof data.merchantLocationStatus === "string" ? data.merchantLocationStatus : "";
  const ok = result.ok && !/disabled|deleted/i.test(merchantLocationStatus);
  return {
    ok,
    locationKey,
    status: result.status,
    merchantLocationStatus,
    upstream: result.ok ? undefined : result.data,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Admin auth guard ─────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  if (decodeJwtRole(authHeader) !== "service_role") {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const caller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin");
    if (adminErr || !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }
  }

  try {
    const supabase = createServiceClient();
    const accessToken = await getAccessToken(supabase);
    const body = await req.json();
    const { action } = body;

    // ── DISCARD LOCAL/EBAY DRAFT ─────────────────────────
    if (action === "discard_draft") {
      const { productCode, sku, offerId, inventoryItemGroupKey } = body;
      const dbCode = typeof productCode === "string" && productCode.trim() ? productCode.trim() : (typeof sku === "string" ? sku.trim() : "");
      if (!dbCode) throw new Error("productCode is required");

      const { data: productRow, error: productErr } = await supabase
        .from("products")
        .select("code, ebay_status, ebay_sku, ebay_offer_id, ebay_item_group_key")
        .eq("code", dbCode)
        .maybeSingle();
      if (productErr) throw productErr;
      if (productRow && productRow.ebay_status === "active") {
        throw new Error("Refusing to discard an active eBay listing. Use End instead.");
      }

      const baseSku = typeof sku === "string" && sku.trim() ? sku.trim() : (typeof productRow?.ebay_sku === "string" && productRow.ebay_sku.trim() ? productRow.ebay_sku.trim() : dbCode);
      const offerToDelete = typeof offerId === "string" && offerId.trim() ? offerId.trim() : (typeof productRow?.ebay_offer_id === "string" ? productRow.ebay_offer_id.trim() : "");
      const groupToDelete = typeof inventoryItemGroupKey === "string" && inventoryItemGroupKey.trim() ? inventoryItemGroupKey.trim() : (typeof productRow?.ebay_item_group_key === "string" ? productRow.ebay_item_group_key.trim() : "");
      const deleted: Array<Record<string, unknown>> = [];
      const skusToDelete = new Set<string>([baseSku]);

      if (groupToDelete) {
        const offersForGroup = await ebayFetch(accessToken, "GET", `${INV_API}/offer?inventory_item_group_key=${encodeURIComponent(groupToDelete)}`);
        const groupOffers = offersForGroup.ok && isRecord(offersForGroup.data) && Array.isArray(offersForGroup.data.offers) ? offersForGroup.data.offers.filter(isRecord) : [];
        for (const offer of groupOffers) {
          const liveOfferId = offerIdValue(offer);
          const liveSku = typeof offer.sku === "string" && offer.sku.trim() ? offer.sku.trim() : "";
          if (liveSku) skusToDelete.add(liveSku);
          if (liveOfferId) {
            const delOffer = await deleteEbayResource(accessToken, `${INV_API}/offer/${liveOfferId}`);
            if (!delOffer.ok) throw new Error(`Delete draft offer failed (${delOffer.status}): ${JSON.stringify(delOffer.data)}`);
            deleted.push({ type: "offer", id: liveOfferId, skipped: delOffer.skipped });
          }
        }
        const delGroup = await deleteEbayResource(accessToken, `${INV_API}/inventory_item_group/${encodeURIComponent(groupToDelete)}`);
        if (!delGroup.ok) throw new Error(`Delete draft group failed (${delGroup.status}): ${JSON.stringify(delGroup.data)}`);
        deleted.push({ type: "group", id: groupToDelete, skipped: delGroup.skipped });
      } else if (offerToDelete) {
        const delOffer = await deleteEbayResource(accessToken, `${INV_API}/offer/${offerToDelete}`);
        if (!delOffer.ok) throw new Error(`Delete draft offer failed (${delOffer.status}): ${JSON.stringify(delOffer.data)}`);
        deleted.push({ type: "offer", id: offerToDelete, skipped: delOffer.skipped });
      }

      for (const itemSku of skusToDelete) {
        const delItem = await deleteEbayResource(accessToken, `${INV_API}/inventory_item/${encodeURIComponent(itemSku)}`);
        if (!delItem.ok) throw new Error(`Delete draft inventory item failed (${delItem.status}): ${JSON.stringify(delItem.data)}`);
        deleted.push({ type: "inventory_item", id: itemSku, skipped: delItem.skipped });
      }

      await supabase.from("products").update({
        ebay_sku: null,
        ebay_offer_id: null,
        ebay_listing_id: null,
        ebay_status: "not_listed",
        ebay_category_id: null,
        ebay_price_cents: null,
        ebay_item_group_key: null,
        updated_at: new Date().toISOString(),
      }).eq("code", dbCode);

      return new Response(JSON.stringify({ success: true, discarded: true, deleted }), { headers: corsHeaders });
    }

    // ── DELETE INVENTORY ITEM ─────────────────────────────
    if (action === "delete_item") {
      const { sku, baseCode } = body;
      if (!sku) throw new Error("sku is required");
      const result = await ebayFetch(accessToken, "DELETE", `${INV_API}/inventory_item/${encodeURIComponent(sku)}`);
      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete item failed (${result.status}): ${JSON.stringify(result.data)}`);
      }
      // For variant SKUs (e.g. HAT001-RED), use the parent product code for the DB update
      const dbKey = baseCode || (sku.includes("-") ? sku.split("-")[0] : sku);
      await supabase.from("products").update({
        ebay_sku: null, ebay_offer_id: null, ebay_listing_id: null,
        ebay_status: "not_listed", ebay_category_id: null, ebay_price_cents: null,
        ebay_item_group_key: null,
        updated_at: new Date().toISOString(),
      }).eq("code", dbKey);
      return new Response(JSON.stringify({ success: true, deleted: sku }), { headers: corsHeaders });
    }

    // ── GET SINGLE INVENTORY ITEM ───────────────────────────
    if (action === "get_item") {
      const { sku } = body;
      if (!sku) throw new Error("sku is required");
      const result = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item/${encodeURIComponent(sku)}`);
      if (!result.ok) {
        const transient = isTransientGetItemError(result.status, result.data);
        return new Response(
          JSON.stringify({
            success: false,
            action: "get_item",
            sku,
            status: result.status,
            upstreamStatus: result.status,
            transient,
            error: `Get item failed (${result.status}): ${JSON.stringify(result.data)}`,
            upstream: result.data,
          }),
          { headers: corsHeaders }
        );
      }
      return new Response(JSON.stringify({ success: true, item: result.data }), { headers: corsHeaders });
    }

    // ── CREATE / UPDATE INVENTORY ITEM ──────────────────────
    if (action === "create_item" || action === "update_item") {
      const { sku, product, packageWeightAndSize } = body;
      if (!sku) throw new Error("sku is required");

      // product = { title, description, imageUrls[], aspects{}, condition, quantity, lotSize }
      const invItem: Record<string, unknown> = {
        condition: product.condition || "NEW",
        availability: {
          shipToLocationAvailability: {
            quantity: product.quantity ?? 0,
          },
        },
        product: {
          title: product.title,
          description: product.description || "",
          imageUrls: product.imageUrls || [],
          aspects: normalizeProductAspects(product.aspects, product.title),
        },
      };

      if (product.lotSize && product.lotSize > 1) {
        invItem.lotSize = product.lotSize;
      }

      if (packageWeightAndSize) {
        invItem.packageWeightAndSize = packageWeightAndSize;
      }

      // PUT /inventory_item/{sku} — creates or replaces
      const result = await ebayFetch(
        accessToken,
        "PUT",
        `${INV_API}/inventory_item/${encodeURIComponent(sku)}`,
        invItem
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Create inventory item failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      // Update products table
      // Only set ebay_status=draft when CREATING — never downgrade an already-published listing
      const itemDbUpdates: Record<string, unknown> = {
        ebay_sku: sku,
        updated_at: new Date().toISOString(),
      };
      if (action === "create_item") itemDbUpdates.ebay_status = "draft";
      await supabase
        .from("products")
        .update(itemDbUpdates)
        .eq("code", sku);

      return new Response(
        JSON.stringify({ success: true, sku, action }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE OFFER ────────────────────────────────────────
    if (action === "create_offer") {
      const { sku, categoryId, priceCents, quantity, policies, bestOfferTerms, storeCategoryNames } = body;
      if (!sku || !categoryId) throw new Error("sku and categoryId are required");

      const priceValue = ((priceCents || 0) / 100).toFixed(2);

      const offer: Record<string, unknown> = {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: quantity ?? 1,
        categoryId,
        pricingSummary: {
          price: { value: priceValue, currency: "USD" },
        },
        listingPolicies: {
          fulfillmentPolicyId: policies?.fulfillmentPolicyId || Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") || "",
          returnPolicyId: policies?.returnPolicyId || Deno.env.get("EBAY_RETURN_POLICY_ID") || "",
          paymentPolicyId: policies?.paymentPolicyId || Deno.env.get("EBAY_PAYMENT_POLICY_ID") || "",
        },
        merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") || "default",
      };

      if (bestOfferTerms?.bestOfferEnabled) {
        (offer.listingPolicies as Record<string, unknown>).bestOfferTerms = {
          bestOfferEnabled: true,
          ...(bestOfferTerms.autoAcceptPrice ? { autoAcceptPrice: { value: bestOfferTerms.autoAcceptPrice, currency: "USD" } } : {}),
          ...(bestOfferTerms.autoDeclinePrice ? { autoDeclinePrice: { value: bestOfferTerms.autoDeclinePrice, currency: "USD" } } : {}),
        };
      }

      if (storeCategoryNames?.length) {
        offer.storeCategoryNames = storeCategoryNames;
      }

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer`,
        offer
      );

      if (!result.ok) {
        // Handle 25002 "Offer entity already exists" — reuse the existing offer
        const errData25 = result.data as { errors?: Array<{ errorId?: number; parameters?: Array<{ name: string; value: string }> }> };
        const dup25 = errData25?.errors?.find((e) => e.errorId === 25002);
        const existingOfferId = dup25?.parameters?.find((p) => p.name === "offerId")?.value;
        if (existingOfferId) {
          await supabase.from("products").update({
            ebay_offer_id: existingOfferId,
            ebay_category_id: categoryId,
            ebay_price_cents: priceCents,
            updated_at: new Date().toISOString(),
          }).eq("code", sku);
          return new Response(JSON.stringify({ success: true, offerId: existingOfferId }), { headers: corsHeaders });
        }
        throw new Error(`Create offer failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const offerId = (result.data as Record<string, string>)?.offerId;

      // Update products table with offer ID and price
      await supabase
        .from("products")
        .update({
          ebay_offer_id: offerId,
          ebay_category_id: categoryId,
          ebay_price_cents: priceCents,
          updated_at: new Date().toISOString(),
        })
        .eq("code", sku);

      return new Response(
        JSON.stringify({ success: true, offerId }),
        { headers: corsHeaders }
      );
    }

    // ── PUBLISH OFFER ───────────────────────────────────────
    if (action === "publish") {
      const { offerId, sku, categoryId: pubCategoryId, priceCents: pubPriceCents, quantity: publishQty } = body;
      if (!offerId) throw new Error("offerId is required");

      const quantityCheck = await ensurePublishQuantity(accessToken, offerId, sku, positiveQuantity(publishQty));
      if (!quantityCheck.ok) {
        return structuredOfferFailure(
          "PUBLISH_QUANTITY_REQUIRED",
          `${quantityCheck.error || "Publish requires quantity greater than 0."} Set a quantity greater than 0, then publish again.`,
          { offerId, sku, publishQty, ...quantityCheck.details },
        );
      }
      const aspectCheck = await ensureInventoryItemRequiredAspects(accessToken, quantityCheck.sku || sku);
      if (!aspectCheck.ok) {
        return structuredOfferFailure(
          "PUBLISH_ASPECTS_REQUIRED",
          `${aspectCheck.error || "A required item specific is missing."} Add the missing item specific to this listing and try publishing again.`,
          { offerId, sku, ...aspectCheck.details },
        );
      }

      let result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/${offerId}/publish`,
        {}
      );

      // eBay can intermittently return API_INVENTORY 25604 immediately after item/offer creation.
      // Retry briefly to handle eventual consistency on their side.
      if (!result.ok && result.status === 500 && isEbayProductNotFoundPublishError(result.data)) {
        for (const waitMs of [1500, 3000, 5000]) {
          await delay(waitMs);
          result = await ebayFetch(
            accessToken,
            "POST",
            `${INV_API}/offer/${offerId}/publish`,
            {}
          );
          if (result.ok) break;
          if (!(result.status === 500 && isEbayProductNotFoundPublishError(result.data))) break;
        }
      }

      if (!result.ok) {
        const missingSpecifics = missingItemSpecificNames(result.data);
        if (missingSpecifics.length) {
          const repairCheck = await ensureInventoryItemRequiredAspects(accessToken, quantityCheck.sku || sku, missingSpecifics);
          if (!repairCheck.ok) {
            return structuredOfferFailure(
              "PUBLISH_ASPECTS_REQUIRED",
              `${repairCheck.error || `Required item specifics missing: ${missingSpecifics.join(", ")}.`} Add the missing item specific to this listing and try publishing again.`,
              { offerId, sku, missingSpecifics, ...repairCheck.details },
            );
          }
          result = await ebayFetch(
            accessToken,
            "POST",
            `${INV_API}/offer/${offerId}/publish`,
            {},
          );
        }
      }

      if (!result.ok) {
        throw new Error(`Publish failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const listingId = (result.data as Record<string, string>)?.listingId;

      // Update products table
      if (sku) {
        const pubUpdates: Record<string, unknown> = {
          ebay_listing_id: listingId,
          ebay_status: "active",
          updated_at: new Date().toISOString(),
        };
        if (pubCategoryId) pubUpdates.ebay_category_id = pubCategoryId;
        if (pubPriceCents) pubUpdates.ebay_price_cents = pubPriceCents;
        await supabase.from("products").update(pubUpdates).eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, listingId }),
        { headers: corsHeaders }
      );
    }

    // ── PUBLISH OFFER BY INVENTORY ITEM GROUP ───────────────
    if (action === "publish_group") {
      const { inventoryItemGroupKey, sku, categoryId: grpCategoryId, priceCents: grpPriceCents, variantQuantities } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const offersForGroup = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/offer?inventory_item_group_key=${encodeURIComponent(inventoryItemGroupKey)}`,
      );
      if (offersForGroup.ok) {
        const groupOffers = isRecord(offersForGroup.data) && Array.isArray(offersForGroup.data.offers) ? offersForGroup.data.offers.filter(isRecord) : [];
        if (groupOffers.length < 2) {
          return structuredOfferFailure(
            "PUBLISH_GROUP_REQUIRES_VARIATIONS",
            "This saved eBay group has fewer than two variant offers. Publish it as a normal offer or rebuild it in a category that supports multi-variation listings.",
            { inventoryItemGroupKey, sku, offerCount: groupOffers.length },
          );
        }
        for (const offer of groupOffers) {
          const offerId = offerIdValue(offer);
          const offerSku = typeof offer.sku === "string" ? offer.sku : undefined;
          if (!offerId) continue;
          const desiredQty = isRecord(variantQuantities) && offerSku ? positiveQuantity(variantQuantities[offerSku]) : null;
          const quantityCheck = await ensurePublishQuantity(accessToken, offerId, offerSku, desiredQty);
          if (!quantityCheck.ok) {
            return structuredOfferFailure(
              "PUBLISH_QUANTITY_REQUIRED",
              `${quantityCheck.error || "Publish requires every variant quantity to be greater than 0."} Set variant quantity greater than 0, then publish again.`,
              { inventoryItemGroupKey, offerId, sku: offerSku, variantQuantities, ...quantityCheck.details },
            );
          }
          const aspectCheck = await ensureInventoryItemRequiredAspects(accessToken, quantityCheck.sku || offerSku);
          if (!aspectCheck.ok) {
            return structuredOfferFailure(
              "PUBLISH_ASPECTS_REQUIRED",
              `${aspectCheck.error || "A required item specific is missing."} Add the missing item specific to this variant and try publishing again.`,
              { inventoryItemGroupKey, offerId, sku: offerSku, ...aspectCheck.details },
            );
          }
        }
      }

      let result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/publish_by_inventory_item_group`,
        { inventoryItemGroupKey, marketplaceId: "EBAY_US" }
      );

      // Retry briefly for eBay eventual consistency windows.
      if (!result.ok && isEbayProductNotFoundPublishError(result.data)) {
        for (const waitMs of [1500, 3000, 5000]) {
          await delay(waitMs);
          result = await ebayFetch(
            accessToken,
            "POST",
            `${INV_API}/offer/publish_by_inventory_item_group`,
            { inventoryItemGroupKey, marketplaceId: "EBAY_US" }
          );
          if (result.ok) break;
          if (!isEbayProductNotFoundPublishError(result.data)) break;
        }
      }

      if (!result.ok && offersForGroup.ok) {
        const missingSpecifics = missingItemSpecificNames(result.data);
        if (missingSpecifics.length) {
          const groupOffers = isRecord(offersForGroup.data) && Array.isArray(offersForGroup.data.offers) ? offersForGroup.data.offers.filter(isRecord) : [];
          for (const offer of groupOffers) {
            const offerSku = typeof offer.sku === "string" ? offer.sku : undefined;
            const repairCheck = await ensureInventoryItemRequiredAspects(accessToken, offerSku, missingSpecifics);
            if (!repairCheck.ok) {
              return structuredOfferFailure(
                "PUBLISH_ASPECTS_REQUIRED",
                `${repairCheck.error || `Required item specifics missing: ${missingSpecifics.join(", ")}.`} Add the missing item specific to this variant and try publishing again.`,
                { inventoryItemGroupKey, sku: offerSku, missingSpecifics, ...repairCheck.details },
              );
            }
          }
          result = await ebayFetch(
            accessToken,
            "POST",
            `${INV_API}/offer/publish_by_inventory_item_group`,
            { inventoryItemGroupKey, marketplaceId: "EBAY_US" },
          );
        }
      }

      if (!result.ok) {
        throw new Error(`Publish group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const listingId = (result.data as Record<string, unknown>)?.listingId as string | undefined;

      if (sku) {
        const grpUpdates: Record<string, unknown> = {
          ebay_listing_id: listingId || null,
          ebay_status: "active",
          updated_at: new Date().toISOString(),
        };
        if (grpCategoryId) grpUpdates.ebay_category_id = grpCategoryId;
        if (grpPriceCents) grpUpdates.ebay_price_cents = grpPriceCents;
        await supabase.from("products").update(grpUpdates).eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, listingId: listingId || null, data: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── UPDATE OFFER (price, quantity) ──────────────────────
    if (action === "update_offer") {
      const { offerId, sku, expectedSku, listingId, priceCents, quantity, categoryId, policies, bestOfferTerms, storeCategoryNames } = body;
      if (!offerId) throw new Error("offerId is required");

      // First GET current offer to preserve fields we're not changing
      const current = await ebayFetch(accessToken, "GET", `${INV_API}/offer/${offerId}`);
      if (!current.ok) {
        const stale = current.status === 404 || /not found|does not exist/i.test(JSON.stringify(current.data || {}));
        if (stale) {
          return structuredOfferFailure(
            "STALE_OFFER_RELINK_REQUIRED",
            "This saved eBay offer could not be found. It was likely replaced by manual relist activity; refresh/relink this listing before editing.",
            { offerId, sku, expectedSku, listingId, upstreamStatus: current.status, upstream: current.data },
          );
        }
        throw new Error(`Get offer failed (${current.status}): ${JSON.stringify(current.data)}`);
      }

      const existing = current.data as Record<string, unknown>;
      const liveSku = typeof existing.sku === "string" ? existing.sku : "";
      const expectedLiveSku = typeof expectedSku === "string" && expectedSku ? expectedSku : (typeof sku === "string" ? sku : "");
      const liveListingId = getOfferListingId(existing);
      if (expectedLiveSku && liveSku && liveSku !== expectedLiveSku) {
        return structuredOfferFailure(
          "STALE_OFFER_RELINK_REQUIRED",
          "This eBay offer no longer matches the local SKU linkage. It was likely changed by manual relist activity; refresh/relink this listing before editing.",
          { offerId, sku, expectedSku: expectedLiveSku, liveSku, listingId, liveListingId },
        );
      }
      if (listingId && liveListingId && liveListingId !== listingId) {
        return structuredOfferFailure(
          "STALE_OFFER_RELINK_REQUIRED",
          "This eBay offer points at a different live listing than the local record. Refresh/relink this listing before editing.",
          { offerId, sku, expectedSku: expectedLiveSku, listingId, liveListingId },
        );
      }

      const updatedOffer: Record<string, unknown> = {
        ...existing,
        availableQuantity: quantity ?? existing.availableQuantity,
        categoryId: categoryId || existing.categoryId,
      };
      // Remove eBay read-only fields that cause 85001 errors on PUT /offer
      const EBAY_OFFER_READONLY = ["offerId", "listing", "statusEnum", "auditInfo", "format", "marketplaceId"];
      EBAY_OFFER_READONLY.forEach((k) => delete updatedOffer[k]);

      if (priceCents !== undefined) {
        updatedOffer.pricingSummary = {
          price: {
            value: (priceCents / 100).toFixed(2),
            currency: "USD",
          },
        };
      }

      if (policies) {
        updatedOffer.listingPolicies = {
          ...(existing.listingPolicies as Record<string, unknown> || {}),
          ...policies,
        };
      }

      if (bestOfferTerms !== undefined) {
        const lp = (updatedOffer.listingPolicies || existing.listingPolicies || {}) as Record<string, unknown>;
        if (bestOfferTerms.bestOfferEnabled) {
          lp.bestOfferTerms = {
            bestOfferEnabled: true,
            ...(bestOfferTerms.autoAcceptPrice ? { autoAcceptPrice: { value: bestOfferTerms.autoAcceptPrice, currency: "USD" } } : {}),
            ...(bestOfferTerms.autoDeclinePrice ? { autoDeclinePrice: { value: bestOfferTerms.autoDeclinePrice, currency: "USD" } } : {}),
          };
        } else {
          lp.bestOfferTerms = { bestOfferEnabled: false };
        }
        updatedOffer.listingPolicies = lp;
      }

      if (storeCategoryNames?.length) {
        updatedOffer.storeCategoryNames = storeCategoryNames;
      } else if (storeCategoryNames !== undefined) {
        updatedOffer.storeCategoryNames = [];
      }

      const existingLocationKey = typeof existing.merchantLocationKey === "string" ? existing.merchantLocationKey.trim() : "";
      const defaultLocationKey = configuredLocationKey();
      let repairedLocation = false;
      let locationCheck: Record<string, unknown> | null = null;

      if (existingLocationKey) {
        locationCheck = await verifyMerchantLocation(accessToken, existingLocationKey);
        if (!locationCheck.ok) {
          return structuredOfferFailure(
            "OFFER_LOCATION_RELINK_REQUIRED",
            "The eBay offer references an inventory location that is missing or disabled. Rebuild/relink the offer from the current eBay state before editing.",
            { offerId, sku, expectedSku: expectedLiveSku, listingId, liveListingId, merchantLocationKey: existingLocationKey, locationCheck },
          );
        }
      } else {
        locationCheck = await verifyMerchantLocation(accessToken, defaultLocationKey);
        if (!locationCheck.ok) {
          return structuredOfferFailure(
            "OFFER_LOCATION_RELINK_REQUIRED",
            "This eBay offer is missing location data, and the configured default inventory location could not be confirmed. Run location setup or relink the listing before editing.",
            { offerId, sku, expectedSku: expectedLiveSku, listingId, liveListingId, configuredLocationKey: defaultLocationKey, locationCheck },
          );
        }
        updatedOffer.merchantLocationKey = defaultLocationKey;
        repairedLocation = true;
      }

      const result = await ebayFetch(
        accessToken,
        "PUT",
        `${INV_API}/offer/${offerId}`,
        updatedOffer
      );

      if (!result.ok && result.status !== 204) {
        if (isLocationInfoNotFoundError(result.data)) {
          return structuredOfferFailure(
            "STALE_OFFER_RELINK_REQUIRED",
            "eBay rejected this offer update because its location-backed offer state is missing or stale. Refresh/relink this listing before editing; the same offer update should not be retried blindly.",
            { offerId, sku, expectedSku: expectedLiveSku, listingId, liveListingId, merchantLocationKey: updatedOffer.merchantLocationKey || null, repairedLocation, locationCheck, upstreamStatus: result.status, upstream: result.data },
          );
        }
        throw new Error(`Update offer failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      // Update local DB
      if (sku) {
        const updates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (priceCents !== undefined) updates.ebay_price_cents = priceCents;
        if (categoryId) updates.ebay_category_id = categoryId;
        await supabase.from("products").update(updates).eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, offerId, repairedLocation }),
        { headers: corsHeaders }
      );
    }

    // ── WITHDRAW (end listing) ──────────────────────────────
    if (action === "withdraw") {
      const { offerId, sku } = body;
      if (!offerId) throw new Error("offerId is required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/${offerId}/withdraw`,
        {}
      );

      if (!result.ok) {
        throw new Error(`Withdraw failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      if (sku) {
        await supabase
          .from("products")
          .update({
            ebay_status: "ended",
            updated_at: new Date().toISOString(),
          })
          .eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, withdrawn: true }),
        { headers: corsHeaders }
      );
    }

    // ── WITHDRAW BY INVENTORY ITEM GROUP (variation listing) ─
    if (action === "withdraw_group") {
      const { inventoryItemGroupKey, sku } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/withdraw_by_inventory_item_group`,
        {
          inventoryItemGroupKey,
          marketplaceId: "EBAY_US",
        }
      );

      if (!result.ok) {
        throw new Error(`Withdraw group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      if (sku) {
        await supabase
          .from("products")
          .update({
            ebay_status: "ended",
            updated_at: new Date().toISOString(),
          })
          .eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, withdrawn: true }),
        { headers: corsHeaders }
      );
    }

    // ── DELETE OFFER (cleanup stale/unpublished offers) ───
    if (action === "delete_offer") {
      const { offerId } = body;
      if (!offerId) throw new Error("offerId is required");

      const result = await ebayFetch(
        accessToken,
        "DELETE",
        `${INV_API}/offer/${offerId}`,
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete offer failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, deleted: true, offerId }),
        { headers: corsHeaders }
      );
    }

    // ── LIST INVENTORY ITEMS ────────────────────────────────
    if (action === "list_items") {
      const limit = body.limit || 100;
      const offset = body.offset || 0;

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/inventory_item?limit=${limit}&offset=${offset}`
      );

      if (!result.ok) {
        throw new Error(`List items failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, ...(result.data as Record<string, unknown>) }),
        { headers: corsHeaders }
      );
    }

    // ── READ-ONLY GROUP OFFER MAPPING DIAGNOSTIC ────────────
    if (action === "diagnose_group_offer_mapping") {
      const { productCode, inventoryItemGroupKey, expectedSkus, localExpectedSkus } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");
      const diagnosed = await diagnoseGroupOfferMapping(accessToken, String(inventoryItemGroupKey), localExpectedSkus || expectedSkus, productCode);
      return new Response(
        JSON.stringify({
          success: diagnosed.ok,
          action: "diagnose_group_offer_mapping",
          code: diagnosed.ok ? "GROUP_OFFER_MAPPING_HEALTHY" : "GROUP_OFFER_MAPPING_UNRESOLVED",
          state: diagnosed.ok ? "healthy" : "offer_mapping_unresolved",
          message: diagnosed.message,
          error: diagnosed.ok ? undefined : diagnosed.message,
          diagnostic: diagnosed.diagnostic,
        }),
        { headers: corsHeaders },
      );
    }

    // ── GET OFFERS FOR SKU / VARIANT GROUP ──────────────────
    if (action === "get_offers") {
      const { productCode, sku, inventoryItemGroupKey, variantSKUs, localExpectedSkus, limit, offset } = body;

      if (inventoryItemGroupKey) {
        const localSkus = normalizeSkuList(localExpectedSkus).length ? localExpectedSkus : variantSKUs;
        const diagnosed = await diagnoseGroupOfferMapping(accessToken, String(inventoryItemGroupKey), localSkus, productCode || sku);
        if (!diagnosed.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              action: "get_offers",
              code: "GROUP_CHILD_OFFER_LOOKUP_FAILED",
              reasonCode: diagnosed.diagnostic.reasonCode || "GROUP_CHILD_OFFERS_MISSING",
              state: "offer_mapping_unresolved",
              message: diagnosed.message,
              error: diagnosed.message,
              inventoryItemGroupKey,
              variantSKUs: diagnosed.diagnostic.ebayGroupVariantSkus,
              failures: diagnosed.failures,
              diagnostic: diagnosed.diagnostic,
            }),
            { headers: corsHeaders },
          );
        }

        return new Response(
          JSON.stringify({ success: true, offers: diagnosed.offers, total: diagnosed.offers.length, inventoryItemGroupKey, variantSKUs: diagnosed.diagnostic.ebayGroupVariantSkus, diagnostic: diagnosed.diagnostic }),
          { headers: corsHeaders },
        );
      }

      const qp = new URLSearchParams();
      if (sku) qp.set("sku", String(sku));
      if (limit) qp.set("limit", String(limit));
      if (offset) qp.set("offset", String(offset));

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/offer${qp.toString() ? `?${qp.toString()}` : ""}`
      );

      if (!result.ok) {
        const classified = classifyOfferLookupFailure(result.status, result.data, Boolean(inventoryItemGroupKey));
        console.warn("[ebay-listing] get_offers failed", {
          sku,
          inventoryItemGroupKey,
          status: result.status,
          code: classified.code,
          upstream: result.data,
        });
        return new Response(
          JSON.stringify({
            success: false,
            action: "get_offers",
            code: classified.code,
            state: classified.state,
            message: classified.message,
            error: classified.message,
            sku,
            inventoryItemGroupKey,
            status: 200,
            upstreamStatus: result.status,
            upstream: result.data,
          }),
          { headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({ success: true, ...(result.data as Record<string, unknown>) }),
        { headers: corsHeaders }
      );
    }

    // ── RECONCILE LOCAL LINKAGE AGAINST CURRENT ACTIVE OFFER ─
    if (action === "reconcile_listing") {
      const { productCode, sku, inventoryItemGroupKey, expectedSkus, localOfferId, localListingId, relink } = body;
      const normalizedSku = typeof sku === "string" && sku.trim() ? sku.trim() : "";
      const normalizedGroupKey = typeof inventoryItemGroupKey === "string" && inventoryItemGroupKey.trim() ? inventoryItemGroupKey.trim() : "";
      const dbCode = typeof productCode === "string" && productCode.trim() ? productCode.trim() : normalizedSku;
      if (!normalizedSku && !normalizedGroupKey) throw new Error("sku or inventoryItemGroupKey is required");

      let offerPayload: Record<string, unknown> = {};
      if (normalizedGroupKey) {
        const diagnosed = await diagnoseGroupOfferMapping(accessToken, normalizedGroupKey, expectedSkus, dbCode);
        if (!diagnosed.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              action: "reconcile_listing",
              code: "RECONCILE_GROUP_CHILD_OFFERS_FAILED",
              reasonCode: diagnosed.diagnostic.reasonCode || "GROUP_CHILD_OFFERS_MISSING",
              state: "offer_mapping_unresolved",
              stale: true,
              safeRelink: false,
              message: diagnosed.message,
              error: diagnosed.message,
              sku: normalizedSku || null,
              inventoryItemGroupKey: normalizedGroupKey,
              failures: diagnosed.failures,
              diagnostic: diagnosed.diagnostic,
            }),
            { headers: corsHeaders },
          );
        }
        offerPayload = { offers: diagnosed.offers, diagnostic: diagnosed.diagnostic };
      } else {
        const result = await ebayFetch(accessToken, "GET", `${INV_API}/offer?sku=${encodeURIComponent(normalizedSku)}`);
        if (!result.ok) {
          const classified = classifyOfferLookupFailure(result.status, result.data, false);
          return new Response(
            JSON.stringify({
              success: false,
              action: "reconcile_listing",
              code: "RECONCILE_OFFERS_FAILED",
              reasonCode: classified.code,
              state: classified.state,
              stale: true,
              safeRelink: false,
              message: classified.message,
              error: classified.message,
              sku: normalizedSku || null,
              inventoryItemGroupKey: normalizedGroupKey || null,
              upstreamStatus: result.status,
              upstream: result.data,
            }),
            { headers: corsHeaders }
          );
        }
        offerPayload = isRecord(result.data) ? result.data : {};
      }

      const payload = offerPayload;
      const offers = Array.isArray(payload.offers) ? payload.offers.filter(isRecord) : [];
      const activeOffers = offers.filter(isActiveOffer);
      const activeOfferQuantities = await Promise.all(activeOffers.map(async (offer) => {
        const offerSku = typeof offer.sku === "string" && offer.sku.trim() ? offer.sku.trim() : null;
        let itemQuantity: number | null = null;
        if (offerSku) {
          const itemResult = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item/${encodeURIComponent(offerSku)}`);
          if (itemResult.ok && isRecord(itemResult.data)) itemQuantity = inventoryItemQuantity(itemResult.data);
        }
        return {
          offerId: offerIdValue(offer),
          listingId: getOfferListingId(offer),
          sku: offerSku,
          status: getOfferStatus(offer) || null,
          offerQuantity: offerAvailableQuantity(offer),
          inventoryQuantity: itemQuantity,
        };
      }));
      const activeListingIds = [...new Set(activeOffers.map(getOfferListingId).filter((v): v is string => Boolean(v)))];
      const activeOfferIds = [...new Set(activeOffers.map(offerIdValue).filter((v): v is string => Boolean(v)))];
      const localOffer = typeof localOfferId === "string" && localOfferId.trim() ? localOfferId.trim() : "";
      const localListing = typeof localListingId === "string" && localListingId.trim() ? localListingId.trim() : "";
      const localOfferActive = Boolean(localOffer && activeOfferIds.includes(localOffer));
      const localListingActive = Boolean(localListing && activeListingIds.includes(localListing));

      let state = "healthy";
      let code = "LINK_HEALTHY";
      let message = "Local eBay linkage matches the current active eBay offer.";
      let safeRelink = false;
      if (!activeOffers.length) {
        state = "no_active_match";
        code = "NO_ACTIVE_EBAY_MATCH";
        message = "No active eBay offer/listing was found for this SKU or inventory group.";
      } else if (activeListingIds.length > 1) {
        state = "ambiguous";
        code = "AMBIGUOUS_ACTIVE_EBAY_MATCH";
        message = "Multiple active eBay listings were found for this SKU or inventory group; manual review is required before relinking.";
      } else if ((localListing && !localListingActive) || (localOffer && !localOfferActive)) {
        state = "stale";
        code = localListing && !localListingActive ? "STALE_LISTING_ID" : "STALE_OFFER_ID";
        message = "Local eBay link may be stale. Active eBay listing may be different. Refresh/relink before editing.";
        safeRelink = true;
      } else {
        const purchasable = activeOfferQuantities.some((q) => (q.offerQuantity ?? q.inventoryQuantity ?? 0) > 0 && (q.inventoryQuantity ?? q.offerQuantity ?? 0) > 0);
        if (!purchasable) {
          state = "out_of_stock";
          code = "ACTIVE_ZERO_QUANTITY";
          message = "Sold out on eBay — quantity is 0. Restock to make this listing purchasable again.";
        }
      }

      const preferredOffer = activeOffers.find((offer) => offerIdValue(offer) === localOffer) || activeOffers[0] || null;
      const preferredQty = preferredOffer ? activeOfferQuantities.find((q) => q.offerId === offerIdValue(preferredOffer)) : null;
      const activeMatch = preferredOffer ? {
        offerId: offerIdValue(preferredOffer),
        listingId: getOfferListingId(preferredOffer),
        sku: typeof preferredOffer.sku === "string" ? preferredOffer.sku : null,
        status: getOfferStatus(preferredOffer) || null,
        categoryId: offerCategoryId(preferredOffer),
        priceCents: offerPriceCents(preferredOffer),
        offerQuantity: preferredQty?.offerQuantity ?? null,
        inventoryQuantity: preferredQty?.inventoryQuantity ?? null,
      } : null;

      if (relink) {
        if (!safeRelink || state !== "stale" || activeListingIds.length !== 1 || !activeMatch?.listingId || !activeMatch?.offerId) {
          return new Response(
            JSON.stringify({
              success: false,
              action: "reconcile_listing",
              code: "RELINK_NOT_SAFE",
              message: "Relink was not performed because there is not exactly one high-confidence active eBay match.",
              state,
              activeMatch,
              matches: activeOffers.map((offer) => ({ offerId: offerIdValue(offer), listingId: getOfferListingId(offer), sku: typeof offer.sku === "string" ? offer.sku : null, status: getOfferStatus(offer) || null })),
            }),
            { headers: corsHeaders }
          );
        }
        if (!dbCode) throw new Error("productCode is required to relink");
        const updates: Record<string, unknown> = {
          ebay_offer_id: activeMatch.offerId,
          ebay_listing_id: activeMatch.listingId,
          ebay_status: "active",
          updated_at: new Date().toISOString(),
        };
        if (normalizedSku) updates.ebay_sku = normalizedSku;
        if (activeMatch.categoryId) updates.ebay_category_id = activeMatch.categoryId;
        if (activeMatch.priceCents !== null) updates.ebay_price_cents = activeMatch.priceCents;
        const { error: updateErr } = await supabase.from("products").update(updates).eq("code", dbCode);
        if (updateErr) throw new Error(`Relink update failed: ${updateErr.message}`);
        return new Response(
          JSON.stringify({ success: true, action: "reconcile_listing", relinked: true, state: "relinked", code: "RELINKED", message: "Local product was relinked to the single active eBay match.", activeMatch, updates }),
          { headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          action: "reconcile_listing",
          state,
          code,
          message,
          stale: state === "stale" || state === "no_active_match" || state === "ambiguous",
          safeRelink,
          local: { offerId: localOffer || null, listingId: localListing || null, offerActive: localOfferActive, listingActive: localListingActive },
          activeMatch,
          matches: activeOfferQuantities,
          diagnostic: isRecord(payload.diagnostic) ? payload.diagnostic : undefined,
        }),
        { headers: corsHeaders }
      );
    }

    // ── CLEAR LOCAL STALE LINK ONLY ─────────────────────────
    if (action === "clear_stale_listing_link") {
      const { productCode } = body;
      const dbCode = typeof productCode === "string" && productCode.trim() ? productCode.trim() : "";
      if (!dbCode) throw new Error("productCode is required");

      const updates = {
        ebay_offer_id: null,
        ebay_listing_id: null,
        ebay_item_group_key: null,
        ebay_status: "ended",
        updated_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabase
        .from("products")
        .update(updates)
        .eq("code", dbCode);
      if (updateErr) throw new Error(`Clear stale link failed: ${updateErr.message}`);

      return new Response(
        JSON.stringify({
          success: true,
          action: "clear_stale_listing_link",
          productCode: dbCode,
          message: "Cleared stale local eBay offer/listing IDs and marked the product ended. No eBay listing was created, edited, or ended.",
          updates,
        }),
        { headers: corsHeaders }
      );
    }

    // ── BULK UPDATE PRICE/QUANTITY ──────────────────────────
    if (action === "bulk_update") {
      const { items } = body;
      if (!items?.length) throw new Error("items array is required");

      // items = [{ sku, priceCents, quantity }]
      const requests = items.map((item: Record<string, unknown>) => {
        const req: Record<string, unknown> = {
          sku: item.sku,
          shipToLocationAvailability: {
            quantity: item.quantity ?? 0,
          },
        };
        if (item.priceCents !== undefined && item.priceCents !== null) {
          req.offers = [
            {
              offerId: item.offerId,
              availableQuantity: item.quantity ?? 0,
              price: {
                value: ((item.priceCents as number) / 100).toFixed(2),
                currency: "USD",
              },
            },
          ];
        }
        return req;
      });

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/bulk_update_price_quantity`,
        { requests }
      );

      if (!result.ok) {
        throw new Error(`Bulk update failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, responses: (result.data as Record<string, unknown>)?.responses }),
        { headers: corsHeaders }
      );
    }

    // ── GET FULFILLMENT/RETURN/PAYMENT POLICIES ─────────────
    if (action === "get_policies") {
      const results: Record<string, unknown> = {};
      const errors: Record<string, unknown> = {};

      for (const type of ["fulfillment_policy", "return_policy", "payment_policy"]) {
        const resp = await ebayFetch(
          accessToken,
          "GET",
          `${ACCT_API}/${type}?marketplace_id=EBAY_US`
        );
        if (resp.ok) {
          results[type] = resp.data;
        } else {
          errors[type] = { status: resp.status, data: resp.data };
        }
      }

      return new Response(
        JSON.stringify({ success: true, policies: results, ...(Object.keys(errors).length ? { errors } : {}) }),
        { headers: corsHeaders }
      );
    }

    // ── OPT IN TO BUSINESS POLICIES ────────────────────────
    if (action === "opt_in_policies") {
      const result = await ebayFetch(
        accessToken,
        "POST",
        `${ACCT_API}/program/opt_in`,
        { programType: "SELLING_POLICY_MANAGEMENT" }
      );
      return new Response(
        JSON.stringify({ success: result.ok, status: result.status, data: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE DEFAULT BUSINESS POLICIES ─────────────────────
    if (action === "create_default_policies") {
      const created: Record<string, unknown> = {};
      const errs: Record<string, unknown> = {};

      // 1. Fulfillment policy — Economy Shipping via USPS, 1-3 day handling
      const fulfillment = await ebayFetch(accessToken, "POST", `${ACCT_API}/fulfillment_policy`, {
        name: "Standard Shipping",
        description: "Economy shipping via USPS, 1-3 business day handling",
        marketplaceId: "EBAY_US",
        handlingTime: { value: 3, unit: "DAY" },
        shippingOptions: [{
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [{
            shippingServiceCode: "USPSFirstClass",
            shippingCost: { value: "0.00", currency: "USD" },
            additionalShippingCost: { value: "0.00", currency: "USD" },
            freeShipping: true,
            sortOrder: 1,
            buyerResponsibleForShipping: false,
          }],
        }],
      });
      if (fulfillment.ok) created.fulfillment = fulfillment.data;
      else errs.fulfillment = { status: fulfillment.status, data: fulfillment.data };

      // 2. Return policy — 30-day returns, buyer pays return shipping
      const returns = await ebayFetch(accessToken, "POST", `${ACCT_API}/return_policy`, {
        name: "30-Day Returns",
        description: "30-day returns accepted, buyer pays return shipping",
        marketplaceId: "EBAY_US",
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
      });
      if (returns.ok) created.returns = returns.data;
      else errs.returns = { status: returns.status, data: returns.data };

      // 3. Payment policy — immediate payment (eBay managed payments)
      const payment = await ebayFetch(accessToken, "POST", `${ACCT_API}/payment_policy`, {
        name: "Immediate Payment",
        description: "Immediate payment required",
        marketplaceId: "EBAY_US",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        immediatePay: true,
      });
      if (payment.ok) created.payment = payment.data;
      else errs.payment = { status: payment.status, data: payment.data };

      return new Response(
        JSON.stringify({ success: Object.keys(errs).length === 0, created, ...(Object.keys(errs).length ? { errors: errs } : {}) }),
        { headers: corsHeaders }
      );
    }

    // ── SETUP INVENTORY LOCATION ────────────────────────────
    if (action === "setup_location") {
      const supabase2 = createServiceClient();
      const { data: setting } = await supabase2
        .from("site_settings")
        .select("value")
        .eq("key", "ship_from_address")
        .single();

      const addr = setting?.value;
      if (!addr) throw new Error("No ship_from_address in site_settings");

      const locationKey = body.locationKey || "default";

      const location = {
        location: {
          address: {
            addressLine1: addr.street1,
            city: addr.city,
            stateOrProvince: addr.state,
            postalCode: addr.zip,
            country: addr.country || "US",
          },
        },
        name: addr.name || "Karry Kraze",
        merchantLocationStatus: "ENABLED",
        locationTypes: ["WAREHOUSE"],
      };

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/location/${encodeURIComponent(locationKey)}`,
        location
      );

      // 204 = created, 200 = ok, 409 = already exists (all fine)
      if (!result.ok && result.status !== 204 && result.status !== 409) {
        throw new Error(`Setup location failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, locationKey }),
        { headers: corsHeaders }
      );
    }

    // ── SETUP WEBHOOK NOTIFICATIONS ───────────────────────
    if (action === "setup_webhook_config") {
      // Step 1: Create alert configuration
      const alertEmail = body.alertEmail || "justinlmcneal@gmail.com";
      const configResult = await ebayFetch(
        accessToken,
        "PUT",
        `${EBAY_API}/commerce/notification/v1/config`,
        { alertEmail },
      );
      if (!configResult.ok) {
        return new Response(
          JSON.stringify({ success: false, status: configResult.status, error: JSON.stringify(configResult.data) }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, action: "setup_webhook_config", data: configResult.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "delete_webhook_destination") {
      const destinationId = body.destinationId;
      if (!destinationId) throw new Error("destinationId required");
      const result = await ebayFetch(
        accessToken,
        "DELETE",
        `${EBAY_API}/commerce/notification/v1/destination/${destinationId}`,
      );
      if (!result.ok && result.status !== 204) {
        return new Response(
          JSON.stringify({ success: false, status: result.status, error: JSON.stringify(result.data) }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, action: "delete_webhook_destination", destinationId, data: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "create_webhook_destination") {
      // Step 2: Create destination endpoint (eBay will challenge-verify it)
      const endpointUrl = body.endpointUrl;
      const verificationToken = body.verificationToken;
      if (!endpointUrl || !verificationToken) throw new Error("endpointUrl and verificationToken required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${EBAY_API}/commerce/notification/v1/destination`,
        {
          name: "KarryKraze-Webhook",
          status: "ENABLED",
          deliveryConfig: {
            endpoint: endpointUrl,
            verificationToken,
            protocol: "HTTPS",
            method: "POST",
          },
        },
      );

      // destinationId is in the Location header
      const locationHeader = result.headers?.get?.("location") || "";
      const destinationId = locationHeader.split("/").pop() || (result.data as Record<string, unknown>)?.destinationId || "";

      if (!result.ok) {
        return new Response(
          JSON.stringify({ success: false, status: result.status, error: JSON.stringify(result.data) }),
          { headers: corsHeaders },
        );
      }
      if (!destinationId) {
        return new Response(
          JSON.stringify({ success: false, error: "create_webhook_destination: no destinationId in Location header" }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, action: "create_webhook_destination", destinationId, data: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "create_webhook_subscription") {
      // Step 3: Subscribe to a notification topic
      const topicId = body.topicId;
      const destinationId = body.destinationId;
      const schemaVersion = body.schemaVersion || "1.0";
      if (!topicId || !destinationId) throw new Error("topicId and destinationId required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${EBAY_API}/commerce/notification/v1/subscription`,
        {
          topicId,
          status: "ENABLED",
          payload: {
            format: "JSON",
            schemaVersion,
            deliveryProtocol: "HTTPS",
          },
          destinationId,
        },
      );

      const locationHeader = result.headers?.get?.("location") || "";
      const subscriptionId = locationHeader.split("/").pop() || (result.data as Record<string, unknown>)?.subscriptionId || "";

      if (!result.ok) {
        return new Response(
          JSON.stringify({ success: false, status: result.status, error: JSON.stringify(result.data) }),
          { headers: corsHeaders },
        );
      }
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ success: false, error: "create_webhook_subscription: no subscriptionId in Location header" }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, action: "create_webhook_subscription", subscriptionId, topicId, data: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "list_webhook_subscriptions") {
      const result = await ebayFetch(
        accessToken,
        "GET",
        `${EBAY_API}/commerce/notification/v1/subscription`,
      );
      if (!result.ok) {
        return new Response(
          JSON.stringify({ success: false, status: result.status, error: JSON.stringify(result.data) }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, subscriptions: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "list_webhook_destinations") {
      const result = await ebayFetch(
        accessToken,
        "GET",
        `${EBAY_API}/commerce/notification/v1/destination`,
      );
      if (!result.ok) {
        return new Response(
          JSON.stringify({ success: false, status: result.status, error: JSON.stringify(result.data) }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, destinations: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "get_notification_topics") {
      const result = await ebayFetch(
        accessToken,
        "GET",
        `${EBAY_API}/commerce/notification/v1/topic`,
      );
      if (!result.ok) {
        return new Response(
          JSON.stringify({ success: false, status: result.status, error: JSON.stringify(result.data) }),
          { headers: corsHeaders },
        );
      }
      return new Response(
        JSON.stringify({ success: true, topics: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "test_webhook_subscription") {
      const subscriptionId = body.subscriptionId;
      if (!subscriptionId) throw new Error("subscriptionId required");
      const result = await ebayFetch(
        accessToken,
        "POST",
        `${EBAY_API}/commerce/notification/v1/subscription/${subscriptionId}/test`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "test_webhook_subscription", data: result.data }),
        { headers: corsHeaders },
      );
    }

    // ── CREATE / UPDATE INVENTORY ITEM GROUP ─────────────
    if (action === "create_item_group" || action === "update_item_group") {
      const { inventoryItemGroupKey, title, description, imageUrls, aspects, variantSKUs, variesBy } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");
      if (!variantSKUs?.length) throw new Error("variantSKUs array is required");

      const groupBody: Record<string, unknown> = {
        title: title || "",
        description: description || "",
        imageUrls: imageUrls || [],
        aspects: normalizeProductAspects(aspects, title),
        variantSKUs,
        variesBy: variesBy || {},
      };

      const result = await ebayFetch(
        accessToken,
        "PUT",
        `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`,
        groupBody
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`${action} failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      // Store group key in products table (on the base product code)
      // Only set ebay_status=draft when CREATING — never downgrade a published listing
      const baseCode = body.baseProductCode;
      if (baseCode) {
        const groupDbUpdates: Record<string, unknown> = {
          ebay_item_group_key: inventoryItemGroupKey,
          updated_at: new Date().toISOString(),
        };
        if (action === "create_item_group") groupDbUpdates.ebay_status = "draft";
        await supabase
          .from("products")
          .update(groupDbUpdates)
          .eq("code", baseCode);
      }

      return new Response(
        JSON.stringify({ success: true, inventoryItemGroupKey, action }),
        { headers: corsHeaders }
      );
    }

    // ── DELETE INVENTORY ITEM GROUP ──────────────────────
    if (action === "delete_item_group") {
      const { inventoryItemGroupKey } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const result = await ebayFetch(
        accessToken,
        "DELETE",
        `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete item group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, deleted: inventoryItemGroupKey }),
        { headers: corsHeaders }
      );
    }

    // ── GET INVENTORY ITEM GROUP ────────────────────────
    if (action === "get_item_group") {
      const { inventoryItemGroupKey } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`
      );

      if (!result.ok) {
        throw new Error(`Get item group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, itemGroup: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE OFFER FOR ITEM GROUP ─────────────────────
    if (action === "create_group_offer") {
      const { categoryId, priceCents, policies, bestOfferTerms, storeCategoryNames, baseProductCode, variantSKUs, variantQuantities } = body;
      if (!categoryId) throw new Error("categoryId is required");
      if (!variantSKUs?.length) throw new Error("variantSKUs is required");

      const priceValue = ((priceCents || 0) / 100).toFixed(2);
      const offerIds: string[] = [];

      for (const sku of variantSKUs as string[]) {
        const offer: Record<string, unknown> = {
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          availableQuantity: isRecord(variantQuantities) ? positiveQuantity(variantQuantities[sku]) || 1 : 1,
          categoryId,
          pricingSummary: {
            price: { value: priceValue, currency: "USD" },
          },
          listingPolicies: {
            fulfillmentPolicyId: policies?.fulfillmentPolicyId || Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") || "",
            returnPolicyId: policies?.returnPolicyId || Deno.env.get("EBAY_RETURN_POLICY_ID") || "",
            paymentPolicyId: policies?.paymentPolicyId || Deno.env.get("EBAY_PAYMENT_POLICY_ID") || "",
          },
          merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") || "default",
        };

        // Best Offer is not permitted on Inventory Item Group offers (eBay error 25737)

        if (storeCategoryNames?.length) {
          offer.storeCategoryNames = storeCategoryNames;
        }

        let result = await ebayFetch(accessToken, "POST", `${INV_API}/offer`, offer);

        // If an offer already exists, reuse it instead of failing.
        if (!result.ok) {
          // Fast path: eBay returns the existing offerId in error 25002 parameters
          const errData = result.data as { errors?: Array<{ errorId?: number; parameters?: Array<{ name: string; value: string }> }> };
          const dup = errData?.errors?.find((e) => e.errorId === 25002);
          const dupOfferId = dup?.parameters?.find((p) => p.name === "offerId")?.value;
          if (dupOfferId) {
            offerIds.push(dupOfferId);
            continue;
          }
          // Slow path: look up the existing offer by SKU
          const existing = await ebayFetch(accessToken, "GET", `${INV_API}/offer?sku=${encodeURIComponent(sku)}`);
          const existingOffers = (existing.data as { offers?: Array<{ offerId?: string }> })?.offers || [];
          const existingOfferId = existingOffers[0]?.offerId;
          if (existing.ok && existingOfferId) {
            offerIds.push(existingOfferId);
            continue;
          }
          throw new Error(`Create group offer failed (${result.status}): ${JSON.stringify(result.data)}`);
        }

        const offerId = (result.data as Record<string, string>)?.offerId;
        if (offerId) offerIds.push(offerId);
      }

      if (baseProductCode) {
        await supabase
          .from("products")
          .update({
            ebay_category_id: categoryId,
            ebay_price_cents: priceCents,
            updated_at: new Date().toISOString(),
          })
          .eq("code", baseProductCode);
      }

      return new Response(
        JSON.stringify({ success: true, offerIds, count: offerIds.length }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE VOLUME DISCOUNT PROMOTION ─────────────────
    if (action === "create_volume_discount") {
      const { listingId, tiers, productCode } = body;
      if (!listingId) throw new Error("listingId is required");
      if (!tiers?.length) throw new Error("At least one discount tier is required");

      const now = new Date();
      const endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() + 1);

      const sortedTiers = [...tiers]
        .map((t: { minQuantity: number; percentOff: number }) => ({
          minQuantity: Number(t.minQuantity),
          percentOff: Number(t.percentOff || 0),
        }))
        .filter((t) => Number.isFinite(t.minQuantity) && t.minQuantity >= 2)
        .sort((a, b) => a.minQuantity - b.minQuantity);

      // VOLUME_DISCOUNT requires baseline rule: minQuantity=1 with 0% off.
      // Preserve user-provided minQuantity values — do not remap to sequential indices.
      const normalized = [{ minQuantity: 1, percentOff: 0 }, ...sortedTiers].slice(0, 4);

      if (normalized.length < 2) {
        throw new Error("Volume pricing requires at least one tier at quantity 2+");
      }

      const discountRules = normalized.map((t) => ({
        ruleOrder: t.minQuantity,
        discountSpecification: { minQuantity: t.minQuantity },
        discountBenefit: { percentageOffOrder: String(Math.round(t.percentOff)) },
      }));

      let inventoryCriterion: Record<string, unknown> = {
        inventoryCriterionType: "INVENTORY_BY_VALUE",
        listingIds: [listingId],
      };

      // For multi-variation listings, use inventoryItemGroupKey to avoid listing-ID timing/eligibility issues.
      if (productCode) {
        const { data: product } = await supabase
          .from("products")
          .select("ebay_item_group_key")
          .eq("code", productCode)
          .maybeSingle();
        const groupKey = (product as { ebay_item_group_key?: string } | null)?.ebay_item_group_key;
        if (groupKey) {
          inventoryCriterion = {
            inventoryCriterionType: "INVENTORY_BY_VALUE",
            inventoryItems: [
              {
                inventoryReferenceType: "INVENTORY_ITEM_GROUP",
                inventoryReferenceId: groupKey,
              },
            ],
          };
        }
      }

      const promo = {
        name: `Volume Discount — ${productCode || listingId}`,
        marketplaceId: "EBAY_US",
        promotionStatus: "SCHEDULED",
        promotionType: "VOLUME_DISCOUNT",
        applyDiscountToSingleItemOnly: false,
        startDate: now.toISOString(),
        endDate: endDate.toISOString(),
        discountRules,
        inventoryCriterion,
      };

      let result = await ebayFetch(accessToken, "POST", `${MKTG_API}/item_promotion`, promo);
      // Newly published listings can briefly fail validation in Marketing API.
      if (!result.ok) {
        for (const waitMs of [1500, 3000]) {
          await delay(waitMs);
          result = await ebayFetch(accessToken, "POST", `${MKTG_API}/item_promotion`, promo);
          if (result.ok) break;
        }
      }
      if (!result.ok) {
        throw new Error(`Create volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const promotionId = (result.data as Record<string, string>)?.promotionId
        || result.headers.get("Location")?.split("/").pop()
        || null;

      if (productCode && promotionId) {
        await supabase.from("products").update({
          ebay_volume_promo_id: promotionId,
          updated_at: new Date().toISOString(),
        }).eq("code", productCode);
      }

      return new Response(
        JSON.stringify({ success: true, promotionId }),
        { headers: corsHeaders }
      );
    }

    // ── GET VOLUME DISCOUNT PROMOTION ────────────────────
    if (action === "get_volume_discount") {
      const { promotionId } = body;
      if (!promotionId) throw new Error("promotionId is required");

      const result = await ebayFetch(accessToken, "GET", `${MKTG_API}/item_promotion/${promotionId}`);
      if (!result.ok) {
        throw new Error(`Get volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, promotion: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── UPDATE VOLUME DISCOUNT PROMOTION ─────────────────
    if (action === "update_volume_discount") {
      const { promotionId, listingId, tiers } = body;
      if (!promotionId) throw new Error("promotionId is required");
      if (!tiers?.length) throw new Error("At least one discount tier is required");

      // Fetch existing promotion to preserve fields
      const current = await ebayFetch(accessToken, "GET", `${MKTG_API}/item_promotion/${promotionId}`);
      if (!current.ok) {
        throw new Error(`Get promotion failed (${current.status}): ${JSON.stringify(current.data)}`);
      }

      const existing = current.data as Record<string, unknown>;

      const sortedTiers = [...tiers]
        .map((t: { minQuantity: number; percentOff: number }) => ({
          minQuantity: Number(t.minQuantity),
          percentOff: Number(t.percentOff || 0),
        }))
        .filter((t) => Number.isFinite(t.minQuantity) && t.minQuantity >= 2)
        .sort((a, b) => a.minQuantity - b.minQuantity);

      const normalized = [{ minQuantity: 1, percentOff: 0 }, ...sortedTiers]
        .slice(0, 4)
        .map((t, idx) => ({
          minQuantity: idx + 1,
          percentOff: t.percentOff,
        }));

      if (normalized.length < 2) {
        throw new Error("Volume pricing requires at least one tier at quantity 2+");
      }

      const discountRules = normalized.map((t) => ({
        ruleOrder: t.minQuantity,
        discountSpecification: { minQuantity: t.minQuantity },
        discountBenefit: { percentageOffOrder: String(t.percentOff) },
      }));

      const updatedPromo: Record<string, unknown> = {
        ...existing,
        // eBay requires SCHEDULED for update payloads; RUNNING is rejected (38240).
        promotionStatus: "SCHEDULED",
        discountRules,
      };

      // If listingId changed, update inventoryCriterion
      if (listingId) {
        updatedPromo.inventoryCriterion = {
          inventoryCriterionType: "INVENTORY_BY_VALUE",
          listingIds: [listingId],
        };
      }

      const result = await ebayFetch(accessToken, "PUT", `${MKTG_API}/item_promotion/${promotionId}`, updatedPromo);
      if (!result.ok && result.status !== 204) {
        throw new Error(`Update volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, promotionId }),
        { headers: corsHeaders }
      );
    }

    // ── DELETE VOLUME DISCOUNT PROMOTION ─────────────────
    if (action === "delete_volume_discount") {
      const { promotionId, productCode } = body;
      if (!promotionId) throw new Error("promotionId is required");

      const result = await ebayFetch(accessToken, "DELETE", `${MKTG_API}/item_promotion/${promotionId}`);
      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      if (productCode) {
        await supabase.from("products").update({
          ebay_volume_promo_id: null,
          updated_at: new Date().toISOString(),
        }).eq("code", productCode);
      }

      return new Response(
        JSON.stringify({ success: true, deleted: promotionId }),
        { headers: corsHeaders }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: unknown) {
    console.error(
      "[ebay-listing] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
