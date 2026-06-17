/**
 * eBay ended variation group relist orchestration (Phase 060B.3).
 */

import type { InventorySyncRunContext } from "./inventoryAmazonSyncUtils.ts";
import {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
} from "./inventoryAmazonSyncUtils.ts";
import {
  loadEbayVariationGroupRelistCandidate,
} from "./ebayVariationGroupRelistCandidateLoaders.ts";
import {
  buildGroupRelistPlan,
  loadProductForGroupRelist,
  resolveGroupRelistMetadata,
  validateStructuralGroupCandidate,
  type GroupRelistPlan,
} from "./ebayVariationGroupRelistValidation.ts";
import {
  executeVariationGroupLivePublish,
  type ChildPublishResult,
} from "./ebayVariationGroupRelistPublish.ts";

export type VariationGroupRelistStatus = "success" | "dry_run" | "manual" | "skipped" | "failed";

export type EbayVariationGroupRelistResult = {
  ok: boolean;
  status: VariationGroupRelistStatus;
  mode: "variation_group_relist";
  productId: string;
  listingId?: string;
  groupKey?: string;
  offerIds?: string[];
  childResults?: ChildPublishResult[];
  runId?: string | null;
  message: string;
  errors?: string[];
  warnings?: string[];
  syncContext?: InventorySyncRunContext;
  preview?: boolean;
  oldListingId?: string | null;
};

function buildResult(
  partial: Omit<EbayVariationGroupRelistResult, "ok" | "mode">,
): EbayVariationGroupRelistResult {
  const ok = partial.status === "success" || partial.status === "dry_run";
  return { ok, mode: "variation_group_relist", ...partial };
}

function dryRunSummary(plan: GroupRelistPlan): string {
  return JSON.stringify({
    groupKey: plan.groupKey,
    childCount: plan.children.length,
    inStockChildren: plan.children.filter((c) => c.quantity > 0).length,
    variantQuantities: plan.variantQuantities,
    metadataSources: plan.metadataSources,
    categoryId: plan.categoryId,
    priceCents: plan.priceCents,
    oldListingId: plan.oldListingId,
  });
}

async function reconcileGroupRelist(
  // deno-lint-ignore no-explicit-any
  client: any,
  plan: GroupRelistPlan,
  listingId: string,
  offerIds: string[],
  now: string,
): Promise<{ ok: boolean; error?: string }> {
  const updates: Record<string, unknown> = {
    ebay_listing_id: listingId,
    ebay_status: "active",
    ebay_item_group_key: plan.groupKey,
    ebay_category_id: plan.categoryId,
    ebay_price_cents: plan.priceCents,
    updated_at: now,
  };
  if (offerIds[0]) updates.ebay_offer_id = offerIds[0];

  const { error } = await client
    .from("products")
    .update(updates)
    .eq("id", plan.productId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type RelistEbayVariationGroupParams = {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  accessToken: string | null;
  productId: string;
  triggeringVariantId?: string | null;
  preview?: boolean;
  liveEnabled: boolean;
  syncContext?: InventorySyncRunContext | null;
  requestedBy?: string | null;
  now?: string;
};

export async function relistEbayVariationGroup(
  params: RelistEbayVariationGroupParams,
): Promise<EbayVariationGroupRelistResult> {
  const {
    supabase,
    accessToken,
    productId,
    preview = false,
    liveEnabled,
    syncContext = {},
    requestedBy = null,
    now = new Date().toISOString(),
  } = params;

  const syncCtx = syncContext || {};
  const dryRun = preview || !liveEnabled;

  const candidate = await loadEbayVariationGroupRelistCandidate({ supabase, productId });
  const run = await createInventorySyncRun(supabase, {
    channel: "ebay",
    mode: dryRun ? "dry_run" : "push",
    requestedBy,
    candidateCount: candidate ? 1 : 0,
    notes: dryRun ? "eBay variation group relist preview" : "eBay variation group relist live publish",
    triggerSource: syncCtx.triggerSource,
    triggerReferenceType: syncCtx.triggerReferenceType,
    triggerReferenceId: syncCtx.triggerReferenceId,
    stockLedgerId: syncCtx.stockLedgerId,
    orchestrationId: syncCtx.orchestrationId,
  });

  const finish = async (response: EbayVariationGroupRelistResult): Promise<EbayVariationGroupRelistResult> => {
    if (run?.id && candidate) {
      const logStatus = response.status === "success" ? "success"
        : response.status === "dry_run" || response.status === "skipped" ? "skipped"
        : "failed";
      await logInventorySyncResult(supabase, {
        runId: run.id,
        variantId: params.triggeringVariantId ?? candidate.child_payload_json?.[0]?.variantId ?? null,
        productId,
        sellerSku: candidate.product_code,
        targetQty: candidate.in_stock_child_count,
        ebayOfferId: response.offerIds?.[0] ?? null,
        ebayListingId: response.listingId ?? null,
        status: logStatus,
        action: "variation_group_relist",
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

  const structural = validateStructuralGroupCandidate(candidate);
  if (!candidate) {
    return finish(buildResult({
      status: "manual",
      productId,
      message: "No variation group relist candidate found for this product.",
      errors: ["candidate_not_found"],
      syncContext: syncCtx,
    }));
  }

  if (structural.skipped) {
    const status = structural.reason.includes("no_child") ? "skipped" : "skipped";
    return finish(buildResult({
      status,
      productId,
      groupKey: candidate.ebay_item_group_key ?? undefined,
      message: `Variation group relist skipped: ${structural.reason}`,
      syncContext: syncCtx,
      oldListingId: candidate.old_ebay_listing_id,
    }));
  }

  if (!structural.ok) {
    return finish(buildResult({
      status: "manual",
      productId,
      groupKey: candidate.ebay_item_group_key ?? undefined,
      message: `Variation group relist requires manual review: ${structural.reason}`,
      errors: [structural.reason],
      syncContext: syncCtx,
      oldListingId: candidate.old_ebay_listing_id,
    }));
  }

  const product = await loadProductForGroupRelist(supabase, productId);
  if (!product) {
    return finish(buildResult({
      status: "manual",
      productId,
      message: "Product not found.",
      errors: ["product_not_found"],
      syncContext: syncCtx,
      oldListingId: candidate.old_ebay_listing_id,
    }));
  }

  const metadataResult = await resolveGroupRelistMetadata({
    candidate,
    product,
    accessToken: dryRun ? null : accessToken,
  });

  if (!metadataResult.ok) {
    return finish(buildResult({
      status: "manual",
      productId,
      groupKey: candidate.ebay_item_group_key ?? undefined,
      message: `Missing required metadata for variation group relist: ${metadataResult.reason}`,
      errors: metadataResult.missing.length ? metadataResult.missing : [metadataResult.reason],
      syncContext: syncCtx,
      oldListingId: candidate.old_ebay_listing_id,
    }));
  }

  const planResult = await buildGroupRelistPlan({
    candidate,
    product,
    metadata: metadataResult.metadata,
  });

  if (!planResult.ok) {
    return finish(buildResult({
      status: "manual",
      productId,
      groupKey: metadataResult.metadata.groupKey,
      message: `Cannot build variation group relist plan: ${planResult.reason}`,
      errors: [planResult.reason],
      syncContext: syncCtx,
      oldListingId: candidate.old_ebay_listing_id,
    }));
  }

  const plan = planResult.plan;
  const warnings = [...plan.warnings];

  const outOfStockSiblings = plan.children.filter((c) => c.quantity <= 0);
  if (outOfStockSiblings.length > 0) {
    warnings.push(
      `Group includes ${outOfStockSiblings.length} qty-0 sibling variant(s); eBay publish may reject zero-quantity offers.`,
    );
  }

  if (dryRun) {
    const gateNote = !liveEnabled && !preview
      ? "Live variation relist disabled (EBAY_ENABLE_LIVE_VARIATION_RELIST is not true)."
      : "Preview mode — no eBay publish.";
    return finish(buildResult({
      status: "dry_run",
      productId,
      groupKey: plan.groupKey,
      message: `${gateNote} eBay variation group relist was previewed only. Live variation relist is disabled.`,
      warnings: [dryRunSummary(plan), ...warnings],
      childResults: plan.children.map((c) => ({
        variantId: c.variantId,
        sku: c.sku,
        quantity: c.quantity,
        status: c.includeInRelist ? "planned_in_stock" : "planned_out_of_stock",
      })),
      syncContext: syncCtx,
      preview: true,
      oldListingId: plan.oldListingId,
    }));
  }

  if (!accessToken) {
    return finish(buildResult({
      status: "failed",
      productId,
      groupKey: plan.groupKey,
      message: "eBay access token unavailable for live variation group relist.",
      errors: ["ebay_not_connected"],
      syncContext: syncCtx,
      oldListingId: plan.oldListingId,
    }));
  }

  const live = await executeVariationGroupLivePublish(
    accessToken,
    plan,
    Number(product.weight_g),
  );

  if (!live.ok) {
    return finish(buildResult({
      status: "failed",
      productId,
      groupKey: plan.groupKey,
      offerIds: live.offerIds,
      childResults: live.childResults,
      message: live.error || "eBay variation group relist publish failed.",
      errors: [live.error || "publish_failed"],
      warnings: live.offerIds?.length
        ? ["Some offers may exist on eBay — verify Seller Hub before retry."]
        : undefined,
      syncContext: syncCtx,
      oldListingId: plan.oldListingId,
    }));
  }

  const reconcile = await reconcileGroupRelist(
    supabase,
    plan,
    live.listingId!,
    live.offerIds || [],
    now,
  );

  if (!reconcile.ok) {
    return finish(buildResult({
      status: "failed",
      productId,
      listingId: live.listingId,
      groupKey: plan.groupKey,
      offerIds: live.offerIds,
      childResults: live.childResults,
      message: "eBay may have published the variation group, but DB reconciliation failed.",
      errors: [reconcile.error || "reconciliation_failed"],
      warnings: [
        "eBay publish succeeded but local DB reconciliation failed.",
        ...(plan.oldListingId && plan.oldListingId !== live.listingId
          ? [`Old ended listing ${plan.oldListingId} was not reactivated; new listing ${live.listingId} is active.`]
          : []),
      ],
      syncContext: syncCtx,
      oldListingId: plan.oldListingId,
    }));
  }

  if (plan.oldListingId && plan.oldListingId !== live.listingId) {
    warnings.push(
      `Old ended listing ${plan.oldListingId} was not reactivated; new listing ${live.listingId} is active.`,
    );
  }

  return finish(buildResult({
    status: "success",
    productId,
    listingId: live.listingId,
    groupKey: plan.groupKey,
    offerIds: live.offerIds,
    childResults: live.childResults,
    message: "eBay variation group relisted and local mapping reconciled.",
    warnings: warnings.length ? warnings : undefined,
    syncContext: syncCtx,
    oldListingId: plan.oldListingId,
  }));
}
