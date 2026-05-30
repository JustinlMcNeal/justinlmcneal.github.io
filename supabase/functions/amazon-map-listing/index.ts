// amazon-map-listing — Admin-only Amazon listing → KK product mapping (no SP-API writes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-map-listing]";

const VALID_MAPPING_STATUSES = new Set([
  "mapped",
  "ignored",
  "legacy",
  "needs_review",
]);

const VALID_CONFIDENCE = new Set([
  "high",
  "medium",
  "low",
  "manual",
  "unknown",
]);

type MapPayload = {
  amazonListingId?: unknown;
  kkProductId?: unknown;
  kkSku?: unknown;
  mappingStatus?: unknown;
  mappingConfidence?: unknown;
  notes?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseOptionalText(value: unknown, maxLen = 2000): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.log(`${LOG_PREFIX} server_misconfigured`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    console.log(`${LOG_PREFIX} unauthorized`);
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

  let body: MapPayload = {};
  try {
    body = (await req.json()) as MapPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const amazonListingId = parseUuid(body.amazonListingId);
  if (!amazonListingId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const mappingStatus = typeof body.mappingStatus === "string" &&
      VALID_MAPPING_STATUSES.has(body.mappingStatus)
    ? body.mappingStatus
    : "mapped";

  const mappingConfidenceRaw = typeof body.mappingConfidence === "string"
    ? body.mappingConfidence
    : null;
  const mappingConfidence = mappingStatus === "mapped"
    ? (mappingConfidenceRaw && VALID_CONFIDENCE.has(mappingConfidenceRaw)
      ? mappingConfidenceRaw
      : "manual")
    : (mappingConfidenceRaw && VALID_CONFIDENCE.has(mappingConfidenceRaw)
      ? mappingConfidenceRaw
      : null);

  const kkProductId = body.kkProductId === null || body.kkProductId === undefined || body.kkProductId === ""
    ? null
    : parseUuid(body.kkProductId);

  const kkSku = parseOptionalText(body.kkSku, 120);
  const notes = parseOptionalText(body.notes, 2000);

  if (mappingStatus === "mapped" && !kkProductId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    const { data: listing, error: listingErr } = await serviceClient
      .from("amazon_listings")
      .select("id, seller_sku")
      .eq("id", amazonListingId)
      .maybeSingle();

    if (listingErr) {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!listing) {
      return json({ ok: false, error: "listing_not_found" }, 404);
    }

    let resolvedKkSku = kkSku;
    if (mappingStatus === "mapped" && kkProductId) {
      const { data: product, error: productErr } = await serviceClient
        .from("products")
        .select("id, code")
        .eq("id", kkProductId)
        .maybeSingle();

      if (productErr) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
      if (!product) {
        return json({ ok: false, error: "product_not_found" }, 404);
      }
      if (!resolvedKkSku) resolvedKkSku = product.code ?? null;
    }

    await serviceClient
      .from("amazon_listing_mappings")
      .update({
        mapping_status: "legacy",
        updated_at: now,
      })
      .eq("amazon_listing_id", amazonListingId)
      .eq("mapping_status", "mapped");

    if (mappingStatus === "mapped") {
      const { data: inserted, error: insertErr } = await serviceClient
        .from("amazon_listing_mappings")
        .insert({
          amazon_listing_id: amazonListingId,
          kk_product_id: kkProductId,
          kk_sku: resolvedKkSku,
          mapping_status: "mapped",
          mapping_confidence: mappingConfidence,
          mapped_by: admin.userId,
          mapped_at: now,
          notes,
          updated_at: now,
        })
        .select("id")
        .single();

      if (insertErr || !inserted?.id) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }

      console.log(`${LOG_PREFIX} success mapped listing=${amazonListingId}`);
      return json({
        ok: true,
        mappingId: inserted.id,
        amazonListingId,
        mappingStatus: "mapped",
      });
    }

    const { data: existingRow, error: existingErr } = await serviceClient
      .from("amazon_listing_mappings")
      .select("id")
      .eq("amazon_listing_id", amazonListingId)
      .eq("mapping_status", mappingStatus)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }

    let mappingId: string;

    if (existingRow?.id) {
      const { data: updated, error: updateErr } = await serviceClient
        .from("amazon_listing_mappings")
        .update({
          kk_product_id: kkProductId,
          kk_sku: resolvedKkSku,
          mapping_confidence: mappingConfidence,
          mapped_by: admin.userId,
          mapped_at: now,
          notes,
          updated_at: now,
        })
        .eq("id", existingRow.id)
        .select("id")
        .single();

      if (updateErr || !updated?.id) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
      mappingId = updated.id as string;
    } else {
      const { data: inserted, error: insertErr } = await serviceClient
        .from("amazon_listing_mappings")
        .insert({
          amazon_listing_id: amazonListingId,
          kk_product_id: kkProductId,
          kk_sku: resolvedKkSku,
          mapping_status: mappingStatus,
          mapping_confidence: mappingConfidence,
          mapped_by: admin.userId,
          mapped_at: now,
          notes,
          updated_at: now,
        })
        .select("id")
        .single();

      if (insertErr || !inserted?.id) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
      mappingId = inserted.id as string;
    }

    console.log(`${LOG_PREFIX} success status=${mappingStatus} listing=${amazonListingId}`);
    return json({
      ok: true,
      mappingId,
      amazonListingId,
      mappingStatus,
    });
  } catch {
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
