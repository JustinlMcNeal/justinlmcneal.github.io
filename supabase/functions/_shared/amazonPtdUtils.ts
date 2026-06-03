// Product Type Definitions fetch, cache, and schema parsing.

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
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
  attributeEnums: Record<string, string[]>;
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

type SpApiGetResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; httpStatus?: number; hint?: string };

function isPresignedSchemaUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes("x-amz-algorithm=") || lower.includes("x-amz-signature=")) return true;
  if (lower.includes(".amazonaws.com/") && !lower.includes("sellingpartnerapi")) return true;
  return lower.includes("cloudfront.net/");
}

function ptdErrorForHttpStatus(httpStatus: number): string {
  if (httpStatus === 404) return "invalid_product_type";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "sp_api_unavailable";
  return "ptd_request_failed";
}

async function spApiGet(
  url: string,
  accessToken: string,
  aws?: AmazonCredentials["aws"],
): Promise<SpApiGetResult> {
  const signed = Boolean(aws);
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
  let data: Record<string, unknown> = {};
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    if (!resp.ok) {
      console.log("[amazonPtdUtils] spApiGet_non_json", resp.status, url.slice(0, 120));
      return {
        ok: false,
        error: ptdErrorForHttpStatus(resp.status),
        httpStatus: resp.status,
        hint: spApiHintForHttpStatus(resp.status, signed),
      };
    }
    return { ok: true, data: {} };
  }

  if (!resp.ok) {
    const errors = asArray(data.errors)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    const amazonMessage = errors
      .map((entry) => {
        const code = typeof entry.code === "string" ? entry.code : "";
        const message = typeof entry.message === "string" ? entry.message : "";
        return [code, message].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join("; ");
    if (amazonMessage) {
      console.log("[amazonPtdUtils] spApiGet_failed", resp.status, amazonMessage.slice(0, 300));
    } else {
      console.log("[amazonPtdUtils] spApiGet_failed", resp.status, url.slice(0, 120));
    }
    return {
      ok: false,
      error: ptdErrorForHttpStatus(resp.status),
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, signed) || amazonMessage.slice(0, 200) || undefined,
    };
  }
  return { ok: true, data };
}

async function fetchSchemaDocument(url: string): Promise<SpApiGetResult> {
  const resp = await fetch(url, {
    method: "GET",
    headers: { "user-agent": "KarryKraze-AmazonPTD/1.0" },
  });
  let data: Record<string, unknown> = {};
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    console.log("[amazonPtdUtils] schema_fetch_non_json", resp.status, url.slice(0, 120));
    return {
      ok: false,
      error: "schema_fetch_failed",
      httpStatus: resp.status,
    };
  }
  if (!resp.ok) {
    console.log("[amazonPtdUtils] schema_fetch_failed", resp.status, url.slice(0, 120));
    return {
      ok: false,
      error: "schema_fetch_failed",
      httpStatus: resp.status,
    };
  }
  return { ok: true, data };
}

const OFFER_ONLY_REQUIRED_ATTRIBUTES = [
  "merchant_suggested_asin",
  "condition_type",
  "purchasable_offer",
  "fulfillment_availability",
] as const;

/** Attributes that appear in conditional schema branches but rarely apply to KK catalog items. */
const PTD_CONDITIONAL_NOISE_ATTRIBUTES = new Set([
  "battery",
  "num_batteries",
  "batteries_included",
  "lithium_battery",
  "number_of_lithium_ion_cells",
  "number_of_lithium_metal_cells",
  "contains_battery_or_cell",
  "battery_contains_free_unabsorbed_liquid",
  "is_battery_non_spillable",
  "non_lithium_battery_packaging",
  "has_less_than_30_percent_state_of_charge",
  "battery_installation_device_type",
  "has_multiple_battery_powered_components",
  "has_replaceable_battery",
  "non_lithium_battery_energy_content",
  "ghs",
  "ghs_chemical_h_code",
  "hazmat",
  "safety_data_sheet_url",
  "fcc_radio_frequency_emission_compliance",
  "pesticide_marking",
  "regulatory_compliance_certification",
  "gpsr_safety_attestation",
  "gpsr_manufacturer_reference",
  "compliance_media",
  "dsa_responsible_party_address",
  "baa_taa_compliance_acknowledgement",
  "baa_taa_regulation_compliance",
  "taa_compliant_country",
  "government_contract_information",
  "ring",
  "lens",
  "flavor",
  "edition",
  "orientation",
  "team_name",
  "league_name",
  "scent",
  "base",
  "length_range",
  "width_range",
  "flower_count",
  "plant_style",
  "set_name",
  "plant_type",
  "merchant_shipping_group",
  "item_display_weight",
  "list_price",
  "variation_theme",
  "child_parent_sku_relationship",
  "externally_assigned_product_identifier",
  "merchant_suggested_asin",
]);

export function extractRequiredAttributes(
  schema: Record<string, unknown>,
  requirements = "LISTING",
): string[] {
  if (requirements === "LISTING_OFFER_ONLY") {
    return [...OFFER_ONLY_REQUIRED_ATTRIBUTES];
  }

  const required = asArray(schema.required)
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return [...new Set(required)];
}

export function extractRecommendedAttributes(
  schema: Record<string, unknown>,
  requiredAttributes: string[],
  requirements = "LISTING",
): string[] {
  if (requirements === "LISTING_OFFER_ONLY") return [];

  const requiredSet = new Set(requiredAttributes);
  const properties = asRecord(schema.properties);
  const propertyNames = properties ? Object.keys(properties) : [];
  return propertyNames
    .filter((name) => !requiredSet.has(name) && !PTD_CONDITIONAL_NOISE_ATTRIBUTES.has(name))
    .slice(0, 16);
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

function collectStringEnums(value: unknown): string[] {
  const rec = asRecord(value);
  if (!rec) return [];
  if (Array.isArray(rec.enum)) {
    return rec.enum.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  for (const branch of asArray(rec.anyOf)) {
    const branchRec = asRecord(branch);
    if (Array.isArray(branchRec?.enum)) {
      return branchRec.enum.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
  }
  return [];
}

function extractPropertyValueEnums(propertySchema: unknown): string[] {
  const prop = asRecord(propertySchema);
  const items = asRecord(prop?.items);
  if (!items) return [];

  const directValue = collectStringEnums(items.properties?.value);
  if (directValue.length) return directValue;

  const nestedType = asRecord(asRecord(items.properties)?.type);
  const nestedItems = asRecord(nestedType?.items);
  const nestedValue = collectStringEnums(nestedItems?.properties?.value);
  if (nestedValue.length) return nestedValue;

  return [];
}

/** Extract Amazon enum options for attribute dropdowns in the push UI. */
export function extractAttributeEnums(
  schema: Record<string, unknown>,
  attributeNames: string[],
): Record<string, string[]> {
  const properties = asRecord(schema.properties) ?? {};
  const out: Record<string, string[]> = {};

  for (const name of attributeNames) {
    const enums = extractPropertyValueEnums(properties[name]);
    if (enums.length) out[name] = enums;
  }

  return out;
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
  const requirements = String(row.requirements || snapshot.requirements || "LISTING");
  const requiredAttributes = requirements === "LISTING_OFFER_ONLY"
    ? extractRequiredAttributes({}, requirements)
    : asArray(snapshot.requiredAttributes)
      .filter((v): v is string => typeof v === "string");
  const recommendedAttributes = requirements === "LISTING_OFFER_ONLY"
    ? []
    : asArray(snapshot.recommendedAttributes)
      .filter((v): v is string => typeof v === "string");
  const attributeEnumsRaw = asRecord(snapshot.attributeEnums);
  const attributeEnums: Record<string, string[]> = {};
  if (attributeEnumsRaw) {
    for (const [key, value] of Object.entries(attributeEnumsRaw)) {
      if (!Array.isArray(value)) continue;
      const enums = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
      if (enums.length) attributeEnums[key] = enums;
    }
  }

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
    attributeEnums,
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
): Promise<
  | { ok: true; summary: PtdSchemaSummary }
  | { ok: false; error: string; httpStatus?: number; hint?: string }
> {
  const ptdUrl = buildPtdUrl(creds.endpoint, params.productType, {
    marketplaceId: params.marketplaceId,
    requirements: params.requirements,
    requirementsEnforced: params.requirementsEnforced,
    locale: params.locale,
    sellerId: params.sellerId,
  });

  const ptdResult = await spApiGet(ptdUrl, creds.accessToken, creds.aws);
  if (!ptdResult.ok) {
    return {
      ok: false,
      error: ptdResult.error,
      httpStatus: ptdResult.httpStatus,
      hint: ptdResult.hint,
    };
  }

  const schemaUrl = parseLinkUrl(ptdResult.data.schema);
  const metaSchemaUrl = parseLinkUrl(ptdResult.data.metaSchema);
  const schemaChecksum = typeof asRecord(ptdResult.data.schema)?.checksum === "string"
    ? String(asRecord(ptdResult.data.schema)?.checksum)
    : null;

  let parsedSchema: Record<string, unknown> = {};
  if (schemaUrl) {
    const schemaResult = isPresignedSchemaUrl(schemaUrl)
      ? await fetchSchemaDocument(schemaUrl)
      : await spApiGet(schemaUrl, creds.accessToken, creds.aws);
    if (schemaResult.ok) {
      parsedSchema = schemaResult.data;
    } else {
      console.log("[amazonPtdUtils] schema_parse_skipped", schemaResult.error);
    }
  }

  const propertyGroups = asRecord(ptdResult.data.propertyGroups);
  if (propertyGroups && !parsedSchema.propertyGroups) {
    parsedSchema = { ...parsedSchema, propertyGroups };
  }

  const requiredAttributes = extractRequiredAttributes(parsedSchema, params.requirements);
  const recommendedAttributes = extractRecommendedAttributes(
    parsedSchema,
    requiredAttributes,
    params.requirements,
  );
  const attributeCount = countSchemaAttributes(parsedSchema) || requiredAttributes.length;
  const schemaProperties = asRecord(parsedSchema.properties) ?? {};
  const enumAttributeNames = Object.keys(schemaProperties);
  const attributeEnums = extractAttributeEnums(parsedSchema, enumAttributeNames);

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
    attributeEnums,
    schemaSnapshot: {
      productType: params.productType,
      requirements: params.requirements,
      requirementsEnforced: params.requirementsEnforced,
      productTypeVersion: ptdResult.data.productTypeVersion ?? null,
      requiredAttributes,
      recommendedAttributes,
      attributeCount,
      attributeEnums,
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
): Promise<void> {
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

  const { data: existing, error: lookupErr } = await client
    .from("amazon_product_type_cache")
    .select("id")
    .eq("seller_account_id", params.sellerAccountId)
    .eq("marketplace_id", params.marketplaceId)
    .eq("product_type", params.productType)
    .eq("requirements", params.requirements)
    .eq("requirements_enforced", params.requirementsEnforced)
    .eq("locale", params.locale)
    .maybeSingle();

  if (lookupErr) {
    console.log("[amazonPtdUtils] cache_lookup_failed", lookupErr.message);
    return;
  }

  if (existing?.id) {
    const { error } = await client
      .from("amazon_product_type_cache")
      .update(row)
      .eq("id", existing.id);
    if (error) console.log("[amazonPtdUtils] cache_update_failed", error.message);
    return;
  }

  const { error: insertErr } = await client.from("amazon_product_type_cache").insert(row);
  if (insertErr) console.log("[amazonPtdUtils] cache_insert_failed", insertErr.message);
}

export async function getOrFetchPtdSummary(
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  creds: AmazonCredentials,
  params: PtdRequestParams,
  forceRefresh: boolean,
): Promise<
  | { ok: true; summary: PtdSchemaSummary; source: "cache" | "amazon" }
  | { ok: false; error: string; httpStatus?: number; hint?: string }
> {
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "cache_read_failed";
      console.log("[amazonPtdUtils] cache_read_failed", message);
    }
  }

  const fetched = await fetchAndParsePtd(creds, params);
  if (!fetched.ok) return fetched;

  try {
    await writePtdCache(serviceClient, params, fetched.summary, now);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "cache_write_failed";
    console.log("[amazonPtdUtils] cache_write_failed", message);
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
    attributeEnums: summary.attributeEnums,
  };
}
