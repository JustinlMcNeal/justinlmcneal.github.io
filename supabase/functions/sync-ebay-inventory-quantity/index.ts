// sync-ebay-inventory-quantity — Admin-only eBay active listing qty sync from inventory available.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";

import { getAccessToken, createServiceClient } from "../_shared/ebayUtils.ts";

import {

  candidatesToEbayPatchItems,

  createInventorySyncRun,

  finalizeInventorySyncRun,

  INVENTORY_EBAY_SYNC_DEFAULT_LIMIT,

  INVENTORY_EBAY_SYNC_MAX,

  loadEbaySyncCandidates,

  logInventorySyncResult,

  processEbayQuantityPatches,

} from "../_shared/inventoryEbaySyncUtils.ts";



const LOG_PREFIX = "[sync-ebay-inventory-quantity]";

const UUID_RE = /^[0-9a-f-]{36}$/i;



type Payload = {

  preview?: unknown;

  variantIds?: unknown;

  productIds?: unknown;

  limit?: unknown;

};



function parseUuidList(value: unknown): string[] {

  if (!Array.isArray(value)) return [];

  const ids: string[] = [];

  for (const entry of value) {

    if (typeof entry === "string" && UUID_RE.test(entry.trim())) ids.push(entry.trim());

  }

  return [...new Set(ids)];

}



function parseLimit(value: unknown): number {

  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) return INVENTORY_EBAY_SYNC_DEFAULT_LIMIT;

  return Math.min(Math.trunc(n), INVENTORY_EBAY_SYNC_MAX);

}



Deno.serve(async (req) => {

  console.log(`${LOG_PREFIX} start`);



  if (req.method === "OPTIONS") {

    return new Response("ok", { status: 200, headers: corsHeadersJson });

  }

  if (req.method !== "POST") {

    return json({ ok: false, error: "method_not_allowed" }, 405);

  }



  const livePatchDisabled = Deno.env.get("EBAY_ENABLE_LIVE_QUANTITY_PATCH") !== "true";



  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {

    return json({ ok: false, error: "server_misconfigured" }, 500);

  }



  const authHeader = req.headers.get("authorization");

  if (!authHeader) return json({ ok: false, error: "unauthorized" }, 401);



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



  const wantsPreview = body.preview === true;

  const variantIds = parseUuidList(body.variantIds);

  const productIds = parseUuidList(body.productIds);

  const limit = parseLimit(body.limit);



  if (livePatchDisabled && !wantsPreview) {

    return json({

      ok: false,

      error: "live_patch_disabled",

      hint: "Set EBAY_ENABLE_LIVE_QUANTITY_PATCH=true or use preview:true for dry-run validation.",

    }, 403);

  }



  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date().toISOString();



  try {

    const candidates = await loadEbaySyncCandidates(serviceClient, {

      variantIds: variantIds.length ? variantIds : undefined,

      productIds: productIds.length ? productIds : undefined,

      limit,

    });



    const run = await createInventorySyncRun(serviceClient, {

      channel: "ebay",

      mode: wantsPreview ? "dry_run" : "push",

      requestedBy: admin.userId ?? null,

      candidateCount: candidates.length,

      notes: wantsPreview

        ? "eBay quantity sync preview (no eBay writes)"

        : "eBay active listing available qty push",

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

        preview: wantsPreview,

        runId: run?.id ?? null,

        candidateCount: 0,

        summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },

        results: [],

        message: "No eligible eBay update_qty candidates. Refresh eBay cache first if listings are active.",

      });

    }



    const ebayClient = createServiceClient();

    let accessToken: string;

    try {

      accessToken = await getAccessToken(ebayClient);

    } catch (err) {

      const msg = err instanceof Error ? err.message : String(err);

      if (run?.id) {

        await finalizeInventorySyncRun(serviceClient, run.id, {

          succeeded: 0,

          failed: candidates.length,

          skipped: 0,

        }, now);

      }

      return json({ ok: false, error: "ebay_not_connected", message: msg }, 503);

    }



    const patchItems = candidatesToEbayPatchItems(candidates);

    const { results, summary } = await processEbayQuantityPatches({

      client: serviceClient,

      accessToken,

      items: patchItems,

      preview: wantsPreview,

      now,

    });



    const candidateByVariant = new Map(candidates.map((c) => [String(c.variant_id), c]));



    if (run?.id) {

      for (const r of results) {

        const cand = candidateByVariant.get(String(r.variantId));

        await logInventorySyncResult(serviceClient, {

          runId: run.id,

          variantId: r.variantId,

          productId: r.productId,

          sellerSku: r.ebaySku,

          marketplaceId: "EBAY_US",

          ebayOfferId: r.offerId,

          ebayListingId: r.listingId,

          previousQty: r.previousQty ?? cand?.ebay_current_qty ?? null,

          targetQty: r.targetQty,

          status: r.status,

          action: "set_quantity",

          errorCode: r.errorCode ?? null,

          errorMessage: r.error ?? null,

          responseRef: r.responseRef ?? null,

        });

      }

      await finalizeInventorySyncRun(serviceClient, run.id, summary, now);

    }



    console.log(

      `${LOG_PREFIX} done preview=${wantsPreview} candidates=${candidates.length} ok=${summary.succeeded} fail=${summary.failed}`,

    );



    return json({

      ok: true,

      preview: wantsPreview,

      runId: run?.id ?? null,

      candidateCount: candidates.length,

      summary,

      results: results.map((r) => {

        const cand = candidateByVariant.get(String(r.variantId));

        return {

          ...r,

          internalSku: cand?.internal_sku ?? null,

          productLabel: cand?.product_label ?? null,

          availableQty: cand?.available_qty ?? null,

        };

      }),

    });

  } catch (err) {

    console.error(`${LOG_PREFIX} error`, err);

    return json({ ok: false, error: "sync_failed" }, 500);

  }

});


