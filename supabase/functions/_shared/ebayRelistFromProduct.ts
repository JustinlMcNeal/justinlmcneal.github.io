/** eBay ended single-SKU relist from product (Phase 059D.2). */

import type { InventorySyncRunContext } from "./inventoryAmazonSyncUtils.ts";
import {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
} from "./inventoryAmazonSyncUtils.ts";
import {
  buildImageUrlsFromProduct,
  buildPackageWeightFromGrams,
  createEbayInventoryItem,
  createEbayOffer,
  fetchInventoryItemAspects,
  normalizeProductAspects,
  publishEbayOffer,
  wrapDescription,
} from "./ebayListingPublishUtils.ts";
import {
  isVariationBlocked,
  loadChannelSyncAction,
  loadProductForRelist,
  loadRelistCandidate,
  resolvePriceCents,
  resolveSellerSku,
  type RelistCandidateRow,
} from "./ebayRelistCandidateLoaders.ts";

export type RelistOutcomeStatus = "success" | "failed" | "skipped" | "manual" | "dry_run";

export type RelistFromProductResponse = {
  ok: boolean;
  status: RelistOutcomeStatus;
  mode: "ebay_relist_from_product";
  productId: string;
  variantId: string;
  quantity: number;
  listingId?: string;
  offerId?: string;
  sellerSku?: string;
  runId?: string | null;
  message: string;
  errors?: string[];
  warnings?: string[];
  syncContext?: InventorySyncRunContext;
  preview?: boolean;
  oldListingId?: string | null;
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function buildResponse(partial: Omit<RelistFromProductResponse, "ok" | "mode">): RelistFromProductResponse {
  const ok = partial.status === "success" || partial.status === "dry_run";
  return { ok, mode: "ebay_relist_from_product", ...partial };
}

export type HandleRelistParams = {
  // deno-lint-ignore no-explicit-any
  client: any;
  accessToken: string | null;
  productId: string;
  variantId: string;
  quantity: number;
  wantsPreview: boolean;
  liveRelistDisabled: boolean;
  syncCtx: InventorySyncRunContext;
  requestedBy: string | null;
  now: string;
};

export async function handleEbayRelistFromProduct(params: HandleRelistParams): Promise<RelistFromProductResponse> {
  const { client, accessToken, productId, variantId, quantity, wantsPreview, liveRelistDisabled, syncCtx, requestedBy, now } = params;
  const dryRun = wantsPreview || liveRelistDisabled;
  const reqQty = positiveInt(quantity);

  if (!UUID_RE.test(productId) || !UUID_RE.test(variantId)) {
    return buildResponse({ status: "skipped", productId, variantId, quantity, message: "Invalid productId or variantId.", errors: ["invalid_ids"], syncContext: syncCtx });
  }
  if (!reqQty) {
    return buildResponse({ status: "skipped", productId, variantId, quantity, message: "Relist quantity must be greater than zero.", errors: ["quantity_required"], syncContext: syncCtx });
  }

  const candidate = await loadRelistCandidate(client, productId, variantId);
  const channelAction = await loadChannelSyncAction(client, variantId);
  const run = await createInventorySyncRun(client, {
    channel: "ebay",
    mode: dryRun ? "dry_run" : "push",
    requestedBy,
    candidateCount: candidate ? 1 : 0,
    notes: dryRun ? "eBay relist from product preview" : "eBay relist from product live publish",
    triggerSource: syncCtx.triggerSource,
    triggerReferenceType: syncCtx.triggerReferenceType,
    triggerReferenceId: syncCtx.triggerReferenceId,
    stockLedgerId: syncCtx.stockLedgerId,
    orchestrationId: syncCtx.orchestrationId,
  });

  const finish = async (response: RelistFromProductResponse): Promise<RelistFromProductResponse> => {
    if (run?.id) {
      const logStatus = response.status === "success" ? "success" : response.status === "dry_run" || response.status === "skipped" ? "skipped" : "failed";
      await logInventorySyncResult(client, {
        runId: run.id, variantId, productId, sellerSku: response.sellerSku ?? null, targetQty: reqQty,
        ebayOfferId: response.offerId ?? null, ebayListingId: response.listingId ?? null,
        status: logStatus, action: "relist_from_product",
        errorMessage: response.status === "failed" ? response.message : null,
      });
      await finalizeInventorySyncRun(run.id, {
        succeeded: response.status === "success" || response.status === "dry_run" ? 1 : 0,
        failed: response.status === "failed" ? 1 : 0,
        skipped: response.status === "skipped" || response.status === "manual" ? 1 : 0,
      }, now);
    }
    return { ...response, runId: run?.id ?? null };
  };

  const early = validateCandidate(candidate, channelAction, reqQty, productId, variantId, syncCtx);
  if (early) return finish(early);

  const product = await loadProductForRelist(client, productId);
  if (!product) {
    return finish(buildResponse({ status: "manual", productId, variantId, quantity: reqQty, message: "Product not found.", errors: ["product_not_found"], syncContext: syncCtx }));
  }

  const metaResult = validateMetadata(product, candidate!, reqQty, productId, variantId, syncCtx);
  if ("status" in metaResult) return finish(metaResult);
  const { sellerSku, categoryId, priceCents, imageUrls, title } = metaResult;
  let aspects = normalizeProductAspects(
    accessToken && !dryRun ? await fetchInventoryItemAspects(accessToken, sellerSku) : null,
    title,
  );
  const description = wrapDescription(title, typeof product.description === "string" ? product.description : "");

  if (dryRun) {
    const gateNote = liveRelistDisabled && !wantsPreview ? "Live relist disabled (EBAY_ENABLE_LIVE_RELIST is not true)." : "Preview mode — no eBay publish.";
    return finish(buildResponse({
      status: "dry_run", productId, variantId, quantity: reqQty, sellerSku,
      message: `${gateNote} Relist candidate validated.`,
      warnings: [JSON.stringify({ sellerSku, title, categoryId, priceCents, quantity: reqQty, imageCount: imageUrls.length, oldListingId: candidate!.old_ebay_listing_id })],
      syncContext: syncCtx, preview: true, oldListingId: candidate!.old_ebay_listing_id,
    }));
  }

  if (!accessToken) {
    return finish(buildResponse({ status: "failed", productId, variantId, quantity: reqQty, message: "eBay access token unavailable.", errors: ["ebay_not_connected"], syncContext: syncCtx }));
  }

  return finish(await executeLiveRelist({
    client, accessToken, productId, variantId, reqQty, sellerSku, categoryId, priceCents, imageUrls, title, description, aspects,
    product, candidate: candidate!, syncCtx, now,
  }));
}

function validateCandidate(
  candidate: RelistCandidateRow | null,
  channelAction: string | null,
  reqQty: number,
  productId: string,
  variantId: string,
  syncCtx: InventorySyncRunContext,
): RelistFromProductResponse | null {
  if (!candidate) {
    return buildResponse({ status: "skipped", productId, variantId, quantity: reqQty, message: "No relist candidate row for this variant.", errors: ["candidate_not_found"], syncContext: syncCtx });
  }
  if (channelAction && channelAction !== "ended_needs_relist") {
    return buildResponse({ status: "skipped", productId, variantId, quantity: reqQty, message: `Channel sync action is ${channelAction}, not ended_needs_relist.`, errors: ["not_ended_listing"], syncContext: syncCtx, oldListingId: candidate.old_ebay_listing_id });
  }
  if (isVariationBlocked(candidate)) {
    return buildResponse({ status: "manual", productId, variantId, quantity: reqQty, message: "eBay variation listing requires manual handling.", errors: ["unsupported_variation"], syncContext: syncCtx, oldListingId: candidate.old_ebay_listing_id });
  }
  if (candidate.relist_action !== "ready_to_relist") {
    const action = candidate.relist_action || "manual_review";
    const status = action === "missing_required_listing_data" || action === "needs_mapping" ? "manual" : "skipped";
    return buildResponse({ status, productId, variantId, quantity: reqQty, message: `Relist candidate is ${action}, not ready_to_relist.`, errors: [action], syncContext: syncCtx, oldListingId: candidate.old_ebay_listing_id });
  }
  if (Number(candidate.available_qty) <= 0) {
    return buildResponse({ status: "skipped", productId, variantId, quantity: reqQty, message: "Available quantity is not positive.", errors: ["no_available_stock"], syncContext: syncCtx, oldListingId: candidate.old_ebay_listing_id });
  }
  return null;
}

type ValidatedMeta = { sellerSku: string; categoryId: string; priceCents: number; imageUrls: string[]; title: string };

function validateMetadata(
  product: Record<string, unknown>,
  candidate: RelistCandidateRow,
  reqQty: number,
  productId: string,
  variantId: string,
  syncCtx: InventorySyncRunContext,
): RelistFromProductResponse | ValidatedMeta {
  const sellerSku = resolveSellerSku(product, candidate);
  const categoryId = String(product.ebay_category_id || candidate.ebay_category_id || "").trim();
  const priceCents = resolvePriceCents(product, candidate);
  const imageUrls = buildImageUrlsFromProduct(product);
  const title = String(product.name || "").trim();
  const base = { productId, variantId, quantity: reqQty, syncContext: syncCtx, oldListingId: candidate.old_ebay_listing_id };

  if (!sellerSku || !categoryId || !priceCents || !title) {
    return buildResponse({ ...base, status: "manual", sellerSku: sellerSku ?? undefined, message: "Missing required listing data (SKU, category, price, or title). Open eBay Listings / Relist Assist.", errors: ["missing_required_listing_data"] });
  }
  if (!imageUrls.length) {
    return buildResponse({ ...base, status: "manual", sellerSku, message: "Missing product images for eBay relist. Open eBay Listings / Relist Assist.", errors: ["missing_images"] });
  }
  return { sellerSku, categoryId, priceCents, imageUrls, title };
}

async function executeLiveRelist(opts: {
  // deno-lint-ignore no-explicit-any
  client: any;
  accessToken: string;
  productId: string;
  variantId: string;
  reqQty: number;
  sellerSku: string;
  categoryId: string;
  priceCents: number;
  imageUrls: string[];
  title: string;
  description: string;
  aspects: Record<string, unknown>;
  product: Record<string, unknown>;
  candidate: RelistCandidateRow;
  syncCtx: InventorySyncRunContext;
  now: string;
}): Promise<RelistFromProductResponse> {
  const { client, accessToken, productId, variantId, reqQty, sellerSku, categoryId, priceCents, imageUrls, title, description, aspects, product, candidate, syncCtx, now } = opts;
  const base = { productId, variantId, quantity: reqQty, sellerSku, syncContext: syncCtx, oldListingId: candidate.old_ebay_listing_id };
  const warnings: string[] = [];

  const createItem = await createEbayInventoryItem(accessToken, sellerSku, { title, description, imageUrls, aspects, condition: "NEW", quantity: reqQty }, buildPackageWeightFromGrams(Number(product.weight_g)));
  if (!createItem.ok) return buildResponse({ ...base, status: "failed", message: createItem.error || "Create inventory item failed.", errors: ["create_item_failed"] });

  const createOffer = await createEbayOffer(accessToken, { sku: sellerSku, categoryId, priceCents, quantity: reqQty });
  if (!createOffer.ok || !createOffer.offerId) return buildResponse({ ...base, status: "failed", message: createOffer.error || "Create offer failed.", errors: ["create_offer_failed"] });

  const publish = await publishEbayOffer(accessToken, { offerId: createOffer.offerId, sku: sellerSku, quantity: reqQty });
  if (!publish.ok) {
    if (publish.missingAspects?.length) {
      return buildResponse({ ...base, status: "manual", offerId: createOffer.offerId, message: "Missing required eBay aspects. Open eBay Listings / Relist Assist.", errors: publish.missingAspects });
    }
    return buildResponse({ ...base, status: "failed", offerId: createOffer.offerId, message: publish.error || "Publish failed.", errors: ["publish_failed"], warnings: ["Offer may exist on eBay — verify Seller Hub before retry."] });
  }

  const { error: reconcileErr } = await client.from("products").update({
    ebay_sku: sellerSku, ebay_offer_id: createOffer.offerId, ebay_listing_id: publish.listingId,
    ebay_status: "active", ebay_category_id: categoryId, ebay_price_cents: priceCents, updated_at: now,
  }).eq("id", productId);

  if (reconcileErr) {
    return buildResponse({ ...base, status: "failed", listingId: publish.listingId, offerId: createOffer.offerId, message: "Listing published on eBay but local reconciliation failed. Update product mapping manually.", errors: [reconcileErr.message], warnings: ["eBay publish succeeded but local DB reconciliation failed."] });
  }
  if (candidate.old_ebay_listing_id && candidate.old_ebay_listing_id !== publish.listingId) {
    warnings.push(`Old ended listing ${candidate.old_ebay_listing_id} was not reactivated; new listing ${publish.listingId} is active.`);
  }
  return buildResponse({ ...base, status: "success", listingId: publish.listingId, offerId: createOffer.offerId, message: "eBay listing relisted and local mapping reconciled.", warnings: warnings.length ? warnings : undefined });
}
