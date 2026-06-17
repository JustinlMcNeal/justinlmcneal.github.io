// sync-amazon-inventory-quantity — Admin-only Amazon FBM qty sync from inventory available.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";

import { BULK_PATCH_MAX_ITEMS } from "../_shared/amazonBulkPatchUtils.ts";

import { handleAmazonInactiveRestockSync } from "../_shared/inventoryAmazonInactiveRestock.ts";

import {

  candidatesToPatchItems,

  createInventorySyncRun,

  finalizeInventorySyncRun,

  INVENTORY_AMAZON_SYNC_DEFAULT_LIMIT,

  loadAmazonSyncCandidates,

  logInventorySyncResult,

  parseInventorySyncRunContext,

  processPerListingQuantityPatches,

} from "../_shared/inventoryAmazonSyncUtils.ts";

import { readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";



const LOG_PREFIX = "[sync-amazon-inventory-quantity]";



type SyncMode = "update_qty" | "inactive_restock";



type Payload = {

  preview?: unknown;

  mode?: unknown;

  variantIds?: unknown;

  amazonListingIds?: unknown;

  limit?: unknown;

  syncContext?: unknown;

};



function parseUuidList(value: unknown): string[] {

  if (!Array.isArray(value)) return [];

  const ids: string[] = [];

  for (const entry of value) {

    if (typeof entry === "string" && UUID_RE.test(entry.trim())) {

      ids.push(entry.trim());

    }

  }

  return [...new Set(ids)];

}



function parseSyncMode(value: unknown): SyncMode {

  if (value === "inactive_restock") return "inactive_restock";

  return "update_qty";

}



function parseLimit(value: unknown, syncMode: SyncMode): number {

  const n = Number(value);

  if (syncMode === "inactive_restock") return 1;

  if (!Number.isFinite(n) || n <= 0) return INVENTORY_AMAZON_SYNC_DEFAULT_LIMIT;

  return Math.min(Math.trunc(n), BULK_PATCH_MAX_ITEMS);

}



Deno.serve(async (req) => {

  console.log(`${LOG_PREFIX} start`);



  if (req.method === "OPTIONS") {

    return new Response("ok", { status: 200, headers: corsHeadersJson });

  }



  if (req.method !== "POST") {

    return json({ ok: false, error: "method_not_allowed" }, 405);

  }



  const livePatchDisabled = Deno.env.get("AMAZON_ENABLE_LIVE_PATCH") !== "true";



  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const syncEnv = readSyncEnvConfig();



  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey ||

    !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {

    return json({ ok: false, error: "server_misconfigured" }, 500);

  }



  const authHeader = req.headers.get("authorization");

  if (!authHeader) {

    return json({ ok: false, error: "unauthorized" }, 401);

  }



  const admin = await requireAdminJson(

    createClient,

    supabaseUrl,

    supabaseAnonKey,

    authHeader,

    LOG_PREFIX,

  );

  if (!admin.ok) return admin.response;



  let body: Payload = {};

  try {

    body = (await req.json()) as Payload;

  } catch {

    body = {};

  }



  const syncMode = parseSyncMode(body.mode);

  const wantsPreview = body.preview === true;

  const variantIds = parseUuidList(body.variantIds);

  const amazonListingIds = parseUuidList(body.amazonListingIds);

  const limit = parseLimit(body.limit, syncMode);

  const syncCtx = parseInventorySyncRunContext(body.syncContext);



  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date().toISOString();

  const requestedBy = admin.userId ?? null;



  try {

    if (syncMode === "inactive_restock") {

      if (variantIds.length !== 1) {

        return json({

          ok: false,

          error: "invalid_request",

          message: "inactive_restock requires exactly one variantId.",

        }, 400);

      }

      if (amazonListingIds.length) {

        return json({

          ok: false,

          error: "invalid_request",

          message: "amazonListingIds are not supported for inactive_restock.",

        }, 400);

      }

      if (Number(body.limit) > 1) {

        return json({

          ok: false,

          error: "invalid_request",

          message: "inactive_restock limit must be 1.",

        }, 400);

      }



      const inactiveResult = await handleAmazonInactiveRestockSync({

        client: serviceClient,

        variantId: variantIds[0],

        wantsPreview,

        livePatchDisabled,

        syncEnv,

        syncCtx,

        requestedBy,

        now,

      });



      console.log(

        `${LOG_PREFIX} inactive_restock variant=${variantIds[0]} ok=${inactiveResult.summary.succeeded}`,

      );



      return json(inactiveResult);

    }



    if (livePatchDisabled && !wantsPreview) {

      return json({

        ok: false,

        error: "live_patch_disabled",

        hint: "Set AMAZON_ENABLE_LIVE_PATCH=true or use preview:true for dry-run validation.",

      }, 403);

    }



    const candidates = await loadAmazonSyncCandidates(serviceClient, {

      variantIds: variantIds.length ? variantIds : undefined,

      amazonListingIds: amazonListingIds.length ? amazonListingIds : undefined,

      limit,

    });



    const run = await createInventorySyncRun(serviceClient, {

      mode: wantsPreview ? "dry_run" : "push",

      requestedBy,

      candidateCount: candidates.length,

      notes: wantsPreview ? "SP-API validation preview" : "Amazon FBM available qty push",

      triggerSource: syncCtx.triggerSource,

      triggerReferenceType: syncCtx.triggerReferenceType,

      triggerReferenceId: syncCtx.triggerReferenceId,

      stockLedgerId: syncCtx.stockLedgerId,

      orchestrationId: syncCtx.orchestrationId,

    });



    if (!candidates.length) {

      if (run?.id) {

        await finalizeInventorySyncRun(serviceClient, run.id, {

          succeeded: 0,

          failed: 0,

          skipped: 0,

        }, now);

      }

      return json({

        ok: true,

        mode: "update_qty",

        preview: wantsPreview,

        runId: run?.id ?? null,

        candidateCount: 0,

        summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },

        results: [],

        message: "No Amazon FBM update_qty candidates.",

      });

    }



    const patchItems = candidatesToPatchItems(candidates);

    const { results, summary } = await processPerListingQuantityPatches({

      client: serviceClient,

      items: patchItems,

      preview: wantsPreview,

      syncEnv,

      now,

    });



    const candidateByListing = new Map(

      candidates.map((c) => [String(c.amazon_listing_id), c]),

    );



    if (run?.id) {

      for (const r of results) {

        const cand = candidateByListing.get(r.amazonListingId);

        await logInventorySyncResult(serviceClient, {

          runId: run.id,

          variantId: cand?.variant_id ?? null,

          productId: cand?.product_id ?? null,

          amazonListingId: r.amazonListingId,

          sellerSku: r.sellerSku ?? cand?.amazon_seller_sku ?? null,

          previousQty: cand?.amazon_current_qty ?? null,

          targetQty: r.patch?.quantity ?? null,

          status: r.status,

          action: "set_quantity",

          errorCode: r.error ?? null,

          errorMessage: r.error ?? null,

        });

      }

      await finalizeInventorySyncRun(serviceClient, run.id, summary, now);

    }



    console.log(

      `${LOG_PREFIX} done preview=${wantsPreview} candidates=${candidates.length} ok=${summary.succeeded} fail=${summary.failed}`,

    );



    return json({

      ok: true,

      mode: "update_qty",

      preview: wantsPreview,

      runId: run?.id ?? null,

      candidateCount: candidates.length,

      summary,

      results: results.map((r) => {

        const cand = candidateByListing.get(r.amazonListingId);

        return {

          ...r,

          variantId: cand?.variant_id ?? null,

          internalSku: cand?.internal_sku ?? null,

          previousQty: cand?.amazon_current_qty ?? null,

          targetQty: r.patch?.quantity ?? null,

          availableQty: cand?.available_qty ?? null,

        };

      }),

    });

  } catch (err: unknown) {

    console.error(`${LOG_PREFIX} error`, err);

    return json({ ok: false, error: "sync_failed" }, 500);

  }

});


