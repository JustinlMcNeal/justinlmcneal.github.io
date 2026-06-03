// amazon-search-product-types — Admin-only PTD product type search (read-only SP-API).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import {
  pickRecommendedProductType,
  searchDefinitionsProductTypes,
} from "../_shared/amazonPtdUtils.ts";
import { readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-search-product-types]";

type SearchPayload = {
  sellerAccountId?: unknown;
  marketplaceId?: unknown;
  query?: unknown;
  locale?: unknown;
  source?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseText(value: unknown, maxLen = 120): string | null {
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
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {
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

  let body: SearchPayload = {};
  try {
    body = (await req.json()) as SearchPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const sellerAccountId = body.sellerAccountId ? parseUuid(body.sellerAccountId) : null;
  const marketplaceId = parseText(body.marketplaceId, 32);
  const query = parseText(body.query, 80);
  const locale = parseText(body.locale, 16) || "en_US";
  const useItemName = body.source === "itemName";

  if (!marketplaceId || !query || query.length < 2) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: marketplace, error: marketplaceErr } = await serviceClient
      .from("amazon_marketplaces")
      .select("marketplace_id")
      .eq("marketplace_id", marketplaceId)
      .eq("is_enabled", true)
      .maybeSingle();

    if (marketplaceErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!marketplace) {
      return json({ ok: false, error: "invalid_request" }, 404);
    }

    const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);

    if (!credResult.ok) {
      const status = credResult.error === "server_misconfigured" ? 500
        : credResult.error === "token_refresh_failed" ? 502
        : credResult.error === "aws_assume_role_failed" ? 502
        : 400;
      return json({ ok: false, error: credResult.error }, status);
    }

    let responseSource: "itemName" | "keywords" = useItemName ? "itemName" : "keywords";
    let searchResult = await searchDefinitionsProductTypes(credResult.creds, {
      marketplaceId,
      locale,
      itemName: useItemName ? query : undefined,
      keywords: useItemName ? undefined : query,
    });

    if (searchResult.ok && useItemName && searchResult.productTypes.length === 0) {
      responseSource = "keywords";
      searchResult = await searchDefinitionsProductTypes(credResult.creds, {
        marketplaceId,
        locale,
        keywords: query,
      });
    }

    if (!searchResult.ok) {
      const status = searchResult.error === "invalid_request" ? 400 : 502;
      return json({ ok: false, error: searchResult.error }, status);
    }

    const recommended = pickRecommendedProductType(searchResult.productTypes);

    console.log(`${LOG_PREFIX} success count=${searchResult.productTypes.length} source=${responseSource}`);
    return json({
      ok: true,
      source: responseSource,
      productTypes: searchResult.productTypes,
      recommendedProductType: recommended
        ? { name: recommended.name, displayName: recommended.displayName }
        : null,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});

