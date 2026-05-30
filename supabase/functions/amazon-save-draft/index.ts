// amazon-save-draft — Admin-only local Amazon listing draft save (no SP-API writes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-save-draft]";

const VALID_ACTIONS = new Set(["save_draft", "save_ready", "preview"]);
const VALID_REQUIREMENTS = new Set(["LISTING", "LISTING_PRODUCT_ONLY", "LISTING_OFFER_ONLY"]);
const VALID_DRAFT_STATUSES = new Set([
  "draft",
  "needs_attributes",
  "ready_to_submit",
  "submitted",
  "rejected",
  "published",
  "archived",
]);

type ValidationIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
};

type DraftPayloadInput = {
  draftId?: unknown;
  kkProductId?: unknown;
  kkSku?: unknown;
  sellerAccountId?: unknown;
  marketplaceId?: unknown;
  sellerSku?: unknown;
  asin?: unknown;
  matchedAsin?: unknown;
  productType?: unknown;
  requirements?: unknown;
  requirementsEnforced?: unknown;
  productTypeVersion?: unknown;
  pushWorkflow?: unknown;
  draftStatus?: unknown;
  draftPayload?: unknown;
  action?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseOptionalText(value: unknown, maxLen = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function asDraftPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function validateLocalDraft(
  sellerSku: string,
  draftPayload: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const title = typeof draftPayload.title === "string" ? draftPayload.title.trim() : "";

  if (!title) {
    issues.push({ field: "title", severity: "error", message: "Amazon title is required." });
  }

  if (!sellerSku.trim()) {
    issues.push({ field: "sellerSku", severity: "error", message: "Seller SKU is required." });
  }

  const price = draftPayload.price;
  const priceNum = typeof price === "number" ? price : Number(price);
  if (price === undefined || price === null || price === "" || !Number.isFinite(priceNum) || priceNum < 0) {
    issues.push({ field: "price", severity: "warning", message: "Amazon price should be set." });
  }

  const quantity = draftPayload.quantity;
  const qtyNum = typeof quantity === "number" ? quantity : Number(quantity);
  if (quantity === undefined || quantity === null || quantity === "" || !Number.isFinite(qtyNum) || qtyNum < 0) {
    issues.push({ field: "quantity", severity: "warning", message: "Quantity should be set." });
  }

  const productType = typeof draftPayload.productType === "string"
    ? draftPayload.productType
    : "";
  if (!productType.trim()) {
    issues.push({ field: "productType", severity: "warning", message: "Product type should be set." });
  }

  return issues;
}

function resolveDraftStatus(
  validationErrors: ValidationIssue[],
  action: string,
  requestedStatus: string | null,
): string {
  const hasError = validationErrors.some((issue) => issue.severity === "error");
  if (hasError) return "needs_attributes";
  if (action === "preview" || action === "save_ready") return "ready_to_submit";
  if (requestedStatus && VALID_DRAFT_STATUSES.has(requestedStatus)) {
    return requestedStatus;
  }
  return validationErrors.some((issue) => issue.severity === "warning") ? "draft" : "draft";
}

async function resolveSellerAccount(
  client: ReturnType<typeof createClient>,
  sellerAccountId: string | null,
): Promise<{ id: string; seller_id: string } | null> {
  if (sellerAccountId) {
    const { data, error } = await client
      .from("amazon_seller_accounts")
      .select("id, seller_id")
      .eq("id", sellerAccountId)
      .maybeSingle();
    if (error) throw new Error("database_error");
    return data as { id: string; seller_id: string } | null;
  }

  const { data, error } = await client
    .from("amazon_seller_accounts")
    .select("id, seller_id")
    .eq("is_active", true)
    .eq("token_status", "active")
    .order("authorized_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("database_error");
  return data as { id: string; seller_id: string } | null;
}

async function syncValidationIssues(
  client: ReturnType<typeof createClient>,
  draftId: string,
  validationErrors: ValidationIssue[],
  now: string,
) {
  await client
    .from("amazon_listing_issues")
    .delete()
    .eq("draft_id", draftId)
    .eq("source", "validation")
    .eq("status", "open");

  if (validationErrors.length === 0) return;

  const rows = validationErrors.map((issue) => ({
    draft_id: draftId,
    issue_code: issue.field,
    issue_type: "draft_validation",
    severity: issue.severity,
    message: issue.message,
    source: "validation",
    status: "open",
    categories: [],
    attribute_names: issue.field ? [issue.field] : [],
    enforcements: {},
    raw_error: issue,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await client.from("amazon_listing_issues").insert(rows);
  if (error) throw new Error("database_error");
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

  let body: DraftPayloadInput = {};
  try {
    body = (await req.json()) as DraftPayloadInput;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const action = typeof body.action === "string" && VALID_ACTIONS.has(body.action)
    ? body.action
    : "save_draft";

  const draftId = body.draftId ? parseUuid(body.draftId) : null;
  const kkProductId = parseUuid(body.kkProductId);
  const sellerAccountId = body.sellerAccountId ? parseUuid(body.sellerAccountId) : null;
  const marketplaceId = parseOptionalText(body.marketplaceId, 32);
  const sellerSku = parseOptionalText(body.sellerSku, 120) || "";
  const draftPayload = asDraftPayload(body.draftPayload);

  if (!kkProductId || !marketplaceId || !draftPayload.title) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const requirements = typeof body.requirements === "string" &&
      VALID_REQUIREMENTS.has(body.requirements)
    ? body.requirements
    : "LISTING";

  const requestedStatus = typeof body.draftStatus === "string" &&
      VALID_DRAFT_STATUSES.has(body.draftStatus)
    ? body.draftStatus
    : null;

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
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

    const { data: marketplace, error: marketplaceErr } = await serviceClient
      .from("amazon_marketplaces")
      .select("marketplace_id")
      .eq("marketplace_id", marketplaceId)
      .eq("is_enabled", true)
      .maybeSingle();

    if (marketplaceErr) {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!marketplace) {
      return json({ ok: false, error: "marketplace_not_found" }, 404);
    }

    const sellerAccount = await resolveSellerAccount(serviceClient, sellerAccountId);
    const validationErrors = validateLocalDraft(sellerSku, {
      ...draftPayload,
      productType: body.productType ?? draftPayload.productType,
    });
    const draftStatus = resolveDraftStatus(validationErrors, action, requestedStatus);
    const kkSku = parseOptionalText(body.kkSku, 120) || product.code || null;

    const baseRow = {
      seller_account_id: sellerAccount?.id ?? null,
      seller_id: sellerAccount?.seller_id ?? null,
      kk_product_id: kkProductId,
      kk_sku: kkSku,
      marketplace_id: marketplaceId,
      asin: parseOptionalText(body.asin, 32),
      matched_asin: parseOptionalText(body.matchedAsin, 32),
      seller_sku: sellerSku,
      product_type: parseOptionalText(body.productType, 120) ||
        parseOptionalText(draftPayload.productType, 120),
      requirements,
      requirements_enforced: parseOptionalText(body.requirementsEnforced, 32) || "ENFORCED",
      product_type_version: parseOptionalText(body.productTypeVersion, 64),
      push_workflow: "create_local_draft_only",
      draft_status: draftStatus,
      draft_payload: draftPayload,
      validation_errors: validationErrors,
      updated_at: now,
    };

    let savedDraftId = draftId;

    if (draftId) {
      const { data: existing, error: existingErr } = await serviceClient
        .from("amazon_listing_drafts")
        .select("id")
        .eq("id", draftId)
        .maybeSingle();

      if (existingErr) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
      if (!existing) {
        return json({ ok: false, error: "draft_not_found" }, 404);
      }

      const updateRow = action === "preview"
        ? { ...baseRow, last_previewed_at: now }
        : baseRow;

      const { error: updateErr } = await serviceClient
        .from("amazon_listing_drafts")
        .update(updateRow)
        .eq("id", draftId);

      if (updateErr) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
    } else {
      const { data: inserted, error: insertErr } = await serviceClient
        .from("amazon_listing_drafts")
        .insert({
          ...baseRow,
          last_previewed_at: action === "preview" ? now : null,
        })
        .select("id")
        .single();

      if (insertErr || !inserted?.id) {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
      savedDraftId = inserted.id as string;
    }

    await syncValidationIssues(serviceClient, savedDraftId!, validationErrors, now);

    console.log(`${LOG_PREFIX} success draftId=${savedDraftId} status=${draftStatus}`);
    return json({
      ok: true,
      draftId: savedDraftId,
      draftStatus,
      validationErrors,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
