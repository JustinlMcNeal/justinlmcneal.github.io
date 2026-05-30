// Product Type Definitions fetch, cache, and schema parsing.

import { signSpApiRequest } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";

export type PtdRequestParams = {
  sellerAccountId: string;
  sellerId: string;
  marketplaceId: string;
  productType: string;
  requirements: string;
  requirementsEnforced: string;
  locale: string;
};

export type PtdSchemaSummary = {
  productType: string;
  requirements: string;
  requirementsEnforced: string;
  productTypeVersion: string | null;
  schemaUrl: string | null;
  metaSchemaUrl: string | null;
  schemaChecksum: string | null;
  requiredAttributes: string[];
  recommendedAttributes: string[];
  attributeCount: number;
  schemaSnapshot: Record<string, unknown>;
};

const VALID_REQUIREMENTS = new Set(["LISTING", "LISTING_PRODUCT_ONLY", "LISTING_OFFER_ONLY"]);
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseLinkUrl(value: unknown): string | null {
  const rec = asRecord(value);
  const link = asRecord(rec?.link);
  const resource = typeof link?.resource === "string" ? link.resource.trim() : "";
  return resource || null;
}

export function buildPtdUrl(
  endpoint: string,
  productType: string,
  params: {
    marketplaceId: string;
    requirements: string;
    requirementsEnforced: string;
    locale: string;
    sellerId?: string;
  },
): string {
  const query = new URLSearchParams({
    marketplaceIds: params.marketplaceId,
    requirements: params.requirements,
    requirementsEnforced: params.requirementsEnforced,
    locale: params.locale,
  });
  if (params.sellerId?.trim()) query.set("sellerId", params.sellerId.trim());
  const base = endpoint.replace(/\/$/, "");
  return `${base}/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}?${query.toString()}`;
}

export function buildProductTypesSearchUrl(
  endpoint: string,
  params: { marketplaceId: string; keywords?: string; itemName?: string; locale: string },
): string {
  const query = new URLSearchParams({
    marketplaceIds: params.marketplaceId,
    locale: params.locale,
  });
  if (params.itemName?.trim()) {
    query.set("itemName", params.itemName.trim());
  } else if (params.keywords?.trim()) {
    query.set("keywords", params.keywords.trim());
  }
  const base = endpoint.replace(/\/$/, "");
  return `${base}/definitions/2020-09-01/productTypes?${query.toString()}`;
}

export type ProductTypeSuggestion = {
  name: string;
  displayName: string;
  marketplaceIds: string[];
};

function formatProductTypeDisplayName(name: string): string {
  return name
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseProductTypeSearchResponse(
  data: Record<string, unknown>,
): ProductTypeSuggestion[] {
  return asArray(data.productTypes)
    .map((entry) => {
      const rec = asRecord(entry);
      const name = typeof rec?.name === "string" ? rec.name.trim() : "";
      if (!name) return null;
      const marketplaceIds = asArray(rec?.marketplaceIds)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
      const displayName = typeof rec?.displayName === "string" && rec.displayName.trim()
        ? rec.displayName.trim()
        : formatProductTypeDisplayName(name);
      return { name, displayName, marketplaceIds };
    })
    .filter((entry): entry is ProductTypeSuggestion => Boolean(entry));
}

export function pickRecommendedProductType(
  productTypes: ProductTypeSuggestion[],
): ProductTypeSuggestion | null {
  return productTypes[0] ?? null;
}

export async function searchDefinitionsProductTypes(
  creds: AmazonCredentials,
  params: {
    marketplaceId: string;
    locale: string;
    keywords?: string;
    itemName?: string;
  },
): Promise<{ ok: true; productTypes: ProductTypeSuggestion[]; source: "itemName" | "keywords" } | { ok: false; error: string }> {
  const itemName = params.itemName?.trim() || "";
  const keywords = params.keywords?.trim() || "";
  if (!itemName && !keywords) return { ok: false, error: "invalid_request" };

  const useItemName = Boolean(itemName);
  const url = buildProductTypesSearchUrl(creds.endpoint, {
    marketplaceId: params.marketplaceId,
    locale: params.locale,
    itemName: useItemName ? itemName : undefined,
    keywords: useItemName ? undefined : keywords,
  });
  const result = await spApiGet(url, creds.accessToken, creds.aws);
  if (!result.ok) return result;
  return {
    ok: true,
    productTypes: parseProductTypeSearchResponse(result.data),
    source: useItemName ? "itemName" : "keywords",
  };
}

async function spApiGet(
  url: string,
  accessToken: string,
  aws?: AmazonCredentials["aws"],
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const baseHeaders: Record<string, string> = {
    "x-amz-access-token": accessToken,
    "content-type": "application/json",
    "user-agent": "KarryKraze-AmazonPTD/1.0",
  };

  let headers = baseHeaders;
  if (aws) {
    headers = await signSpApiRequest({
      method: "GET",
      url,
      region: aws.region,
      service: "execute-api",
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey,
      sessionToken: aws.sessionToken,
      headers: baseHeaders,
    });
  }

  const resp = await fetch(url, { method: "GET", headers });
  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return { ok: false, error: "ptd_request_failed" };
  }

  if (!resp.ok) return { ok: false, error: "ptd_request_failed" };
  return { ok: true, data };
}

export function extractRequiredAttributes(schema: Record<string, unknown>): string[] {
  const required = asArray(schema.required)
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  if (required.length > 0) return [...new Set(required)];

  const propertyGroups = asRecord(schema.propertyGroups);
  const fromGroups: string[] = [];
  if (propertyGroups) {
    for (const group of Object.values(propertyGroups)) {
      const rec = asRecord(group);
      for (const name of asArray(rec?.propertyNames)) {
        if (typeof name === "string" && name.trim()) fromGroups.push(name.trim());
      }
    }
  }
  return [...new Set(fromGroups)].slice(0, 40);
}

export function extractRecommendedAttributes(
  schema: Record<string, unknown>,
  requiredAttributes: string[],
): string[] {
  const requiredSet = new Set(requiredAttributes);
  const properties = asRecord(schema.properties);
  const propertyNames = properties ? Object.keys(properties) : [];
  return propertyNames.filter((name) => !requiredSet.has(name)).slice(0, 8);
}

export function countSchemaAttributes(schema: Record<string, unknown>): number {
  const properties = asRecord(schema.properties);
  if (properties) return Object.keys(properties).length;
  const groups = asRecord(schema.propertyGroups);
  if (!groups) return 0;
  const names = new Set<string>();
  for (const group of Object.values(groups)) {
    const rec = asRecord(group);
    for (const name of asArray(rec?.propertyNames)) {
      if (typeof name === "string") names.add(name);
    }
  }
  return names.size;
}

async function readPtdCache(
  // deno-lint-ignore no-explicit-any
  client: any,
  params: PtdRequestParams,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("amazon_product_type_cache")
    .select("*")
    .eq("seller_account_id", params.sellerAccountId)
    .eq("marketplace_id", params.marketplaceId)
    .eq("product_type", params.productType)
    .eq("requirements", params.requirements)
    .eq("requirements_enforced", params.requirementsEnforced)
    .eq("locale", params.locale)
    .maybeSingle();

  if (error) throw new Error("database_error");
  return asRecord(data);
}

function summaryFromCacheRow(row: Record<string, unknown>): PtdSchemaSummary {
  const snapshot = asRecord(row.schema_snapshot) ?? {};
  const requiredAttributes = asArray(snapshot.requiredAttributes)
    .filter((v): v is string => typeof v === "string");
  const recommendedAttributes = asArray(snapshot.recommendedAttributes)
    .filter((v): v is string => typeof v === "string");

  return {
    productType: String(row.product_type || snapshot.productType || ""),
    requirements: String(row.requirements || snapshot.requirements || "LISTING"),
    requirementsEnforced: String(row.requirements_enforced || snapshot.requirementsEnforced || "ENFORCED"),
    productTypeVersion: typeof row.product_type_version === "string" ? row.product_type_version : null,
    schemaUrl: typeof row.schema_url === "string" ? row.schema_url : null,
    metaSchemaUrl: typeof row.meta_schema_url === "string" ? row.meta_schema_url : null,
    schemaChecksum: typeof row.schema_checksum === "string" ? row.schema_checksum : null,
    requiredAttributes,
    recommendedAttributes,
    attributeCount: typeof snapshot.attributeCount === "number"
      ? snapshot.attributeCount
      : requiredAttributes.length,
    schemaSnapshot: snapshot,
  };
}

function isCacheValid(row: Record<string, unknown>, nowMs: number): boolean {
  const expiresAt = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

async function fetchAndParsePtd(
  creds: AmazonCredentials,
  params: PtdRequestParams,
): Promise<{ ok: true; summary: PtdSchemaSummary } | { ok: false; error: string }> {
  const ptdUrl = buildPtdUrl(creds.endpoint, params.productType, {
    marketplaceId: params.marketplaceId,
    requirements: params.requirements,
    requirementsEnforced: params.requirementsEnforced,
    locale: params.locale,
    sellerId: params.sellerId,
  });

  const ptdResult = await spApiGet(ptdUrl, creds.accessToken, creds.aws);
  if (!ptdResult.ok) return { ok: false, error: "ptd_request_failed" };

  const schemaUrl = parseLinkUrl(ptdResult.data.schema);
  const metaSchemaUrl = parseLinkUrl(ptdResult.data.metaSchema);
  const schemaChecksum = typeof asRecord(ptdResult.data.schema)?.checksum === "string"
    ? String(asRecord(ptdResult.data.schema)?.checksum)
    : null;

  let parsedSchema: Record<string, unknown> = {};
  if (schemaUrl) {
    const schemaResult = await spApiGet(schemaUrl, creds.accessToken, creds.aws);
    if (schemaResult.ok) parsedSchema = schemaResult.data;
  }

  const propertyGroups = asRecord(ptdResult.data.propertyGroups);
  if (propertyGroups && !parsedSchema.propertyGroups) {
    parsedSchema = { ...parsedSchema, propertyGroups };
  }

  const requiredAttributes = extractRequiredAttributes(parsedSchema);
  const recommendedAttributes = extractRecommendedAttributes(parsedSchema, requiredAttributes);
  const attributeCount = countSchemaAttributes(parsedSchema) || requiredAttributes.length;

  const summary: PtdSchemaSummary = {
    productType: params.productType,
    requirements: params.requirements,
    requirementsEnforced: params.requirementsEnforced,
    productTypeVersion: typeof ptdResult.data.productTypeVersion === "string"
      ? ptdResult.data.productTypeVersion
      : null,
    schemaUrl,
    metaSchemaUrl,
    schemaChecksum,
    requiredAttributes,
    recommendedAttributes,
    attributeCount,
    schemaSnapshot: {
      productType: params.productType,
      requirements: params.requirements,
      requirementsEnforced: params.requirementsEnforced,
      productTypeVersion: ptdResult.data.productTypeVersion ?? null,
      requiredAttributes,
      recommendedAttributes,
      attributeCount,
      fetchedAt: new Date().toISOString(),
    },
  };

  return { ok: true, summary };
}

async function writePtdCache(
  // deno-lint-ignore no-explicit-any
  client: any,
  params: PtdRequestParams,
  summary: PtdSchemaSummary,
  now: string,
) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  const row = {
    seller_account_id: params.sellerAccountId,
    marketplace_id: params.marketplaceId,
    product_type: params.productType,
    requirements: params.requirements,
    requirements_enforced: params.requirementsEnforced,
    locale: params.locale,
    product_type_version: summary.productTypeVersion,
    schema_url: summary.schemaUrl,
    meta_schema_url: summary.metaSchemaUrl,
    schema_checksum: summary.schemaChecksum,
    schema_snapshot: summary.schemaSnapshot,
    expires_at: expiresAt,
    updated_at: now,
  };

  const { error } = await client.from("amazon_product_type_cache").upsert(row, {
    onConflict: "marketplace_id,product_type,requirements,requirements_enforced,locale,seller_account_id",
  });
  if (error) throw new Error("database_error");
}

export async function getOrFetchPtdSummary(
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  creds: AmazonCredentials,
  params: PtdRequestParams,
  forceRefresh: boolean,
): Promise<{ ok: true; summary: PtdSchemaSummary; source: "cache" | "amazon" } | { ok: false; error: string }> {
  if (!VALID_REQUIREMENTS.has(params.requirements)) {
    return { ok: false, error: "invalid_request" };
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  if (!forceRefresh) {
    try {
      const cached = await readPtdCache(serviceClient, params);
      if (cached && isCacheValid(cached, nowMs)) {
        return { ok: true, summary: summaryFromCacheRow(cached), source: "cache" };
      }
    } catch {
      return { ok: false, error: "database_error" };
    }
  }

  const fetched = await fetchAndParsePtd(creds, params);
  if (!fetched.ok) return fetched;

  try {
    await writePtdCache(serviceClient, params, fetched.summary, now);
  } catch {
    return { ok: false, error: "database_error" };
  }

  return { ok: true, summary: fetched.summary, source: "amazon" };
}

export function toPublicPtdResponse(summary: PtdSchemaSummary, source: "cache" | "amazon") {
  return {
    ok: true,
    source: source === "cache" ? "cache" : "amazon",
    productType: summary.productType,
    requirements: summary.requirements,
    requirementsEnforced: summary.requirementsEnforced,
    productTypeVersion: summary.productTypeVersion,
    schemaUrl: summary.schemaUrl,
    requiredAttributes: summary.requiredAttributes,
    recommendedAttributes: summary.recommendedAttributes,
    attributeCount: summary.attributeCount,
  };
}
