/**
 * eBay variation group relist — live publish chain (Phase 060B.3).
 * create/update child inventory items → item group → group offers → publish_by_inventory_item_group
 */

import { EBAY_API } from "./ebayUtils.ts";
import { ebayInventoryFetch } from "./inventoryEbayCacheUtils.ts";
import {
  createEbayInventoryItem,
  buildPackageWeightFromGrams,
  normalizeProductAspects,
} from "./ebayListingPublishUtils.ts";
import type { GroupRelistPlan, ChildRelistPlan } from "./ebayVariationGroupRelistValidation.ts";

const INV_API = `${EBAY_API}/sell/inventory/v1`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveQuantity(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isEbayProductNotFoundPublishError(data: unknown): boolean {
  const payload = data as { errors?: Array<{ errorId?: number }> } | null;
  return Boolean(payload?.errors?.some((e) => e?.errorId === 25604 || e?.errorId === 25709));
}

export type ChildPublishResult = {
  variantId: string;
  sku: string;
  quantity: number;
  status: string;
  offerId?: string;
  message?: string;
};

export async function createChildInventoryItems(
  accessToken: string,
  plan: GroupRelistPlan,
  weightG: number | null | undefined,
): Promise<{ ok: boolean; error?: string; childResults: ChildPublishResult[] }> {
  const pkg = buildPackageWeightFromGrams(weightG);
  const childResults: ChildPublishResult[] = [];

  for (const child of plan.children) {
    const result = await createEbayInventoryItem(
      accessToken,
      child.sku,
      {
        title: plan.title,
        description: plan.description,
        imageUrls: plan.imageUrls,
        aspects: child.aspects,
        condition: plan.condition,
        quantity: child.quantity,
      },
      pkg,
    );
    childResults.push({
      variantId: child.variantId,
      sku: child.sku,
      quantity: child.quantity,
      status: result.ok ? "item_created" : "item_failed",
      message: result.error,
    });
    if (!result.ok) {
      return { ok: false, error: result.error || `create_item_failed:${child.sku}`, childResults };
    }
  }
  return { ok: true, childResults };
}

export async function createOrUpdateInventoryItemGroup(
  accessToken: string,
  plan: GroupRelistPlan,
): Promise<{ ok: boolean; error?: string }> {
  const groupBody: Record<string, unknown> = {
    title: plan.title,
    description: plan.description,
    imageUrls: plan.imageUrls.slice(0, 24),
    aspects: normalizeProductAspects(plan.groupAspects, plan.title),
    variantSKUs: plan.allVariantSkus,
    variesBy: plan.variesBy,
  };

  const result = await ebayInventoryFetch(
    accessToken,
    "PUT",
    `${INV_API}/inventory_item_group/${encodeURIComponent(plan.groupKey)}`,
    groupBody,
  );
  if (!result.ok && result.status !== 204) {
    return { ok: false, error: `create_item_group failed (${result.status})` };
  }
  return { ok: true };
}

export async function createGroupOffers(
  accessToken: string,
  plan: GroupRelistPlan,
): Promise<{ ok: boolean; error?: string; offerIds: string[]; childResults: ChildPublishResult[] }> {
  const priceValue = (plan.priceCents / 100).toFixed(2);
  const offerIds: string[] = [];
  const childResults: ChildPublishResult[] = [];

  for (const child of plan.children) {
    const offer: Record<string, unknown> = {
      sku: child.sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: positiveQuantity(plan.variantQuantities[child.sku]) ?? 0,
      categoryId: plan.categoryId,
      pricingSummary: { price: { value: priceValue, currency: "USD" } },
      listingPolicies: {
        fulfillmentPolicyId: plan.policies.fulfillmentPolicyId,
        returnPolicyId: plan.policies.returnPolicyId,
        paymentPolicyId: plan.policies.paymentPolicyId,
      },
      merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") || "default",
    };

    let result = await ebayInventoryFetch(accessToken, "POST", `${INV_API}/offer`, offer);
    let offerId: string | undefined;

    if (!result.ok) {
      const errData = result.data as { errors?: Array<{ errorId?: number; parameters?: Array<{ name: string; value: string }> }> };
      const dup = errData?.errors?.find((e) => e.errorId === 25002);
      offerId = dup?.parameters?.find((p) => p.name === "offerId")?.value;
      if (!offerId) {
        childResults.push({
          variantId: child.variantId,
          sku: child.sku,
          quantity: child.quantity,
          status: "offer_failed",
          message: `Create group offer failed (${result.status})`,
        });
        return { ok: false, error: `create_group_offer failed for ${child.sku}`, offerIds, childResults };
      }
    } else {
      offerId = isRecord(result.data) && typeof result.data.offerId === "string" ? result.data.offerId : undefined;
    }

    if (!offerId) {
      return { ok: false, error: `create_group_offer returned no offerId for ${child.sku}`, offerIds, childResults };
    }

    offerIds.push(offerId);
    childResults.push({
      variantId: child.variantId,
      sku: child.sku,
      quantity: child.quantity,
      status: "offer_created",
      offerId,
    });
  }

  return { ok: true, offerIds, childResults };
}

export async function publishInventoryItemGroup(
  accessToken: string,
  groupKey: string,
): Promise<{ ok: boolean; listingId?: string; error?: string }> {
  let result = await ebayInventoryFetch(
    accessToken,
    "POST",
    `${INV_API}/offer/publish_by_inventory_item_group`,
    { inventoryItemGroupKey: groupKey, marketplaceId: "EBAY_US" },
  );

  if (!result.ok && isEbayProductNotFoundPublishError(result.data)) {
    for (const waitMs of [1500, 3000, 5000]) {
      await delay(waitMs);
      result = await ebayInventoryFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/publish_by_inventory_item_group`,
        { inventoryItemGroupKey: groupKey, marketplaceId: "EBAY_US" },
      );
      if (result.ok) break;
      if (!isEbayProductNotFoundPublishError(result.data)) break;
    }
  }

  if (!result.ok) {
    return { ok: false, error: `publish_by_inventory_item_group failed (${result.status})` };
  }

  const listingId = isRecord(result.data) && typeof result.data.listingId === "string"
    ? result.data.listingId
    : undefined;
  if (!listingId) return { ok: false, error: "publish succeeded but no listingId returned" };
  return { ok: true, listingId };
}

export async function executeVariationGroupLivePublish(
  accessToken: string,
  plan: GroupRelistPlan,
  weightG: number | null | undefined,
): Promise<{
  ok: boolean;
  listingId?: string;
  offerIds?: string[];
  childResults: ChildPublishResult[];
  error?: string;
}> {
  const items = await createChildInventoryItems(accessToken, plan, weightG);
  if (!items.ok) return { ok: false, childResults: items.childResults, error: items.error };

  const group = await createOrUpdateInventoryItemGroup(accessToken, plan);
  if (!group.ok) return { ok: false, childResults: items.childResults, error: group.error };

  const offers = await createGroupOffers(accessToken, plan);
  if (!offers.ok) {
    return { ok: false, childResults: offers.childResults, offerIds: offers.offerIds, error: offers.error };
  }

  const publish = await publishInventoryItemGroup(accessToken, plan.groupKey);
  if (!publish.ok) {
    return {
      ok: false,
      childResults: offers.childResults,
      offerIds: offers.offerIds,
      error: publish.error,
    };
  }

  return {
    ok: true,
    listingId: publish.listingId,
    offerIds: offers.offerIds,
    childResults: offers.childResults,
  };
}
