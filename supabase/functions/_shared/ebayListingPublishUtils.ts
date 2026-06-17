/** Single-SKU eBay listing publish helpers (Phase 059D.2 — extracted for relist). */

import { EBAY_API } from "./ebayUtils.ts";
import { ebayInventoryFetch } from "./inventoryEbayCacheUtils.ts";

const INV_API = `${EBAY_API}/sell/inventory/v1`;

export type ListingProductPayload = {
  title: string;
  description: string;
  imageUrls: string[];
  aspects: Record<string, unknown>;
  condition: string;
  quantity: number;
};

export type PackageWeightAndSize = {
  weight: { value: string; unit: "OUNCE" | "POUND" };
  dimensions?: { length: string; width: string; height: string; unit: "INCH" };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveQuantity(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function hasAspectValue(aspects: Record<string, unknown>, aspectName: string): boolean {
  return Object.keys(aspects).some((key) => key.toLowerCase() === aspectName.toLowerCase()
    && (Array.isArray(aspects[key])
      ? (aspects[key] as unknown[]).some((v) => typeof v === "string" && v.trim())
      : typeof aspects[key] === "string" && (aspects[key] as string).trim()));
}

function defaultTypeAspect(title: unknown): string {
  const text = typeof title === "string" ? title.toLowerCase() : "";
  if (/key\s*chain|keychain/.test(text)) return "Keychain";
  if (/charm/.test(text)) return "Charm";
  if (/beanie/.test(text)) return "Beanie";
  if (/hat|cap/.test(text)) return "Hat";
  if (/plush/.test(text)) return "Plush";
  return "Accessory";
}

function defaultRequiredAspectValue(aspectName: string, title?: unknown): string {
  const key = aspectName.toLowerCase();
  if (key === "brand") return "Unbranded";
  if (key === "type") return defaultTypeAspect(title);
  if (key === "department") return "Unisex Adults";
  if (key === "color") return "Multicolor";
  return "Not Specified";
}

export function normalizeProductAspects(
  aspects: unknown,
  title?: unknown,
  requiredAspectNames: string[] = [],
): Record<string, unknown> {
  const normalized = isRecord(aspects) ? { ...aspects } : {};
  for (const aspectName of ["Brand", "Type", "Department", ...requiredAspectNames]) {
    if (!hasAspectValue(normalized, aspectName)) {
      normalized[aspectName] = [defaultRequiredAspectValue(aspectName, title)];
    }
  }
  return normalized;
}

function missingItemSpecificNames(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.errors)) return [];
  const names = new Set<string>();
  for (const err of data.errors) {
    if (!isRecord(err)) continue;
    const message = typeof err.message === "string" ? err.message : "";
    const fromMessage = message.match(/item specific\s+(.+?)\s+is missing/i)?.[1]?.trim();
    if (fromMessage) names.add(fromMessage);
  }
  return [...names];
}

function isEbayProductNotFoundPublishError(data: unknown): boolean {
  const payload = data as { errors?: Array<{ errorId?: number }> } | null;
  return Boolean(payload?.errors?.some((e) => e?.errorId === 25604 || e?.errorId === 25709));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchInventoryItemAspects(
  accessToken: string,
  sku: string,
): Promise<Record<string, unknown> | null> {
  const result = await ebayInventoryFetch(
    accessToken,
    "GET",
    `${INV_API}/inventory_item/${encodeURIComponent(sku)}`,
  );
  if (!result.ok || !isRecord(result.data)) return null;
  const product = isRecord(result.data.product) ? result.data.product : {};
  return isRecord(product.aspects) ? { ...product.aspects } : null;
}

export async function createEbayInventoryItem(
  accessToken: string,
  sku: string,
  product: ListingProductPayload,
  packageWeightAndSize?: PackageWeightAndSize | null,
): Promise<{ ok: boolean; error?: string }> {
  const invItem: Record<string, unknown> = {
    condition: product.condition || "NEW",
    availability: { shipToLocationAvailability: { quantity: product.quantity } },
    product: {
      title: product.title,
      description: product.description || product.title,
      imageUrls: product.imageUrls.slice(0, 24),
      aspects: normalizeProductAspects(product.aspects, product.title),
    },
  };
  if (packageWeightAndSize) invItem.packageWeightAndSize = packageWeightAndSize;

  const result = await ebayInventoryFetch(
    accessToken,
    "PUT",
    `${INV_API}/inventory_item/${encodeURIComponent(sku)}`,
    invItem,
  );
  if (!result.ok && result.status !== 204) {
    return { ok: false, error: `Create inventory item failed (${result.status})` };
  }
  return { ok: true };
}

export async function createEbayOffer(
  accessToken: string,
  params: {
    sku: string;
    categoryId: string;
    priceCents: number;
    quantity: number;
    policies?: { fulfillmentPolicyId?: string; returnPolicyId?: string; paymentPolicyId?: string } | null;
  },
): Promise<{ ok: boolean; offerId?: string; error?: string }> {
  const { sku, categoryId, priceCents, quantity } = params;
  const priceValue = (priceCents / 100).toFixed(2);
  const offer: Record<string, unknown> = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: quantity,
    categoryId,
    pricingSummary: { price: { value: priceValue, currency: "USD" } },
    listingPolicies: {
      fulfillmentPolicyId: params.policies?.fulfillmentPolicyId || Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") || "",
      returnPolicyId: params.policies?.returnPolicyId || Deno.env.get("EBAY_RETURN_POLICY_ID") || "",
      paymentPolicyId: params.policies?.paymentPolicyId || Deno.env.get("EBAY_PAYMENT_POLICY_ID") || "",
    },
    merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") || "default",
  };

  const result = await ebayInventoryFetch(accessToken, "POST", `${INV_API}/offer`, offer);
  if (!result.ok) {
    const errData = result.data as { errors?: Array<{ errorId?: number; parameters?: Array<{ name: string; value: string }> }> };
    const dup = errData?.errors?.find((e) => e.errorId === 25002);
    const existingOfferId = dup?.parameters?.find((p) => p.name === "offerId")?.value;
    if (existingOfferId) return { ok: true, offerId: existingOfferId };
    return { ok: false, error: `Create offer failed (${result.status})` };
  }
  const offerId = isRecord(result.data) && typeof result.data.offerId === "string"
    ? result.data.offerId
    : undefined;
  if (!offerId) return { ok: false, error: "Create offer returned no offerId" };
  return { ok: true, offerId };
}

export async function publishEbayOffer(
  accessToken: string,
  params: { offerId: string; sku: string; quantity: number },
): Promise<{ ok: boolean; listingId?: string; error?: string; missingAspects?: string[] }> {
  const { offerId, sku, quantity } = params;

  let result = await ebayInventoryFetch(
    accessToken,
    "POST",
    `${INV_API}/offer/${offerId}/publish`,
    {},
  );

  if (!result.ok && result.status === 500 && isEbayProductNotFoundPublishError(result.data)) {
    for (const waitMs of [1500, 3000]) {
      await delay(waitMs);
      result = await ebayInventoryFetch(accessToken, "POST", `${INV_API}/offer/${offerId}/publish`, {});
      if (result.ok) break;
    }
  }

  if (!result.ok) {
    const missing = missingItemSpecificNames(result.data);
    if (missing.length) {
      return {
        ok: false,
        error: `Required item specifics missing: ${missing.join(", ")}`,
        missingAspects: missing,
      };
    }
    return { ok: false, error: `Publish failed (${result.status})` };
  }

  const listingId = isRecord(result.data) && typeof result.data.listingId === "string"
    ? result.data.listingId
    : undefined;
  if (!listingId) return { ok: false, error: "Publish succeeded but no listingId returned" };

  const qty = positiveQuantity(quantity);
  if (!qty) return { ok: false, error: "Publish requires quantity greater than 0" };

  return { ok: true, listingId };
}

export function buildPackageWeightFromGrams(weightG: number | null | undefined): PackageWeightAndSize | null {
  if (!weightG || weightG <= 0) {
    return { weight: { value: "4.0", unit: "OUNCE" } };
  }
  return { weight: { value: (weightG / 28.3495).toFixed(1), unit: "OUNCE" } };
}

export function buildImageUrlsFromProduct(product: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: unknown) => {
    if (typeof url === "string" && url.trim() && !seen.has(url)) {
      seen.add(url);
      urls.push(url.trim());
    }
  };
  add(product.catalog_image_url);
  add(product.primary_image_url);
  add(product.catalog_hover_url);
  const gallery = Array.isArray(product.product_gallery_images) ? product.product_gallery_images : [];
  for (const row of gallery) {
    if (!isRecord(row) || row.is_active === false) continue;
    add(row.url);
  }
  return urls.slice(0, 24);
}

export function wrapDescription(title: string, bodyHtml: string): string {
  const safe = bodyHtml?.trim() || `<p>${title}</p>`;
  return safe;
}
