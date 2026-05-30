// Shared Amazon SP-API helpers for read-only sync (LWA + AWS SigV4).

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";

export { getAwsRegionForSpApiRegion } from "./amazonSigV4Utils.ts";

export const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export const SP_API_ENDPOINTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
export const LISTINGS_INCLUDED_DATA =
  "summaries,attributes,issues,offers,fulfillmentAvailability,relationships,productTypes";

export type RefreshTokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: string; revoked?: boolean };

export type SearchListingsResult =
  | {
    ok: true;
    items: Record<string, unknown>[];
    nextToken: string | null;
    httpStatus: number;
  }
  | { ok: false; error: string; httpStatus: number; hint?: string };

export type NormalizedListingRow = {
  seller_account_id: string;
  seller_id: string;
  marketplace_id: string;
  seller_sku: string;
  asin: string | null;
  fn_sku: string | null;
  amazon_title: string | null;
  product_type: string | null;
  condition_type: string | null;
  listing_status: string;
  listing_status_buyable: boolean;
  listing_status_discoverable: boolean;
  price: number | null;
  currency: string;
  fulfillment_channel: string | null;
  fbm_quantity: number | null;
  quantity_last_source: string;
  quantity_synced_at: string;
  price_synced_at: string | null;
  last_synced_at: string;
  relationships: Record<string, unknown>;
  enforcements: Record<string, unknown>;
  raw_listing: Record<string, unknown>;
  updated_at: string;
};

export type NormalizedIssueRow = {
  issue_code: string | null;
  issue_type: string;
  severity: string;
  message: string;
  source: string;
  status: string;
  categories: string[];
  attribute_names: string[];
  enforcements: Record<string, unknown>;
  raw_error: Record<string, unknown>;
  source_submission_id: string | null;
};

export function getAmazonEndpoint(region: string, override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed.replace(/\/$/, "");
  return SP_API_ENDPOINTS[region] ?? SP_API_ENDPOINTS.na;
}

export function safeAmazonErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid_grant") || msg.includes("revoked")) return "token_revoked";
    if (msg.includes("fetch")) return "network_error";
  }
  return "unknown_error";
}

export async function refreshAmazonAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<RefreshTokenResult> {
  const resp = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return { ok: false, error: "token_refresh_failed" };
  }

  if (!resp.ok || typeof data.error === "string") {
    const err = String(data.error || "token_refresh_failed");
    const revoked = err === "invalid_grant" || err === "invalid_token";
    return { ok: false, error: "token_refresh_failed", revoked };
  }

  const accessToken = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!accessToken) {
    return { ok: false, error: "token_refresh_failed" };
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return { ok: true, accessToken, expiresIn };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickSummary(
  item: Record<string, unknown>,
  marketplaceId: string,
): Record<string, unknown> | null {
  const summaries = asArray(item.summaries);
  for (const entry of summaries) {
    const rec = asRecord(entry);
    if (rec && rec.marketplaceId === marketplaceId) return rec;
  }
  return asRecord(summaries[0]) ?? null;
}

function statusFlags(summary: Record<string, unknown> | null): {
  buyable: boolean;
  discoverable: boolean;
} {
  const statuses = asArray(summary?.status).map((s) => String(s).toUpperCase());
  return {
    buyable: statuses.includes("BUYABLE"),
    discoverable: statuses.includes("DISCOVERABLE"),
  };
}

function fulfillmentQuantity(item: Record<string, unknown>): {
  channel: string | null;
  quantity: number | null;
} {
  const rows = asArray(item.fulfillmentAvailability);
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const qtyRaw = rec.quantity;
    const qty = typeof qtyRaw === "number" ? qtyRaw : Number(qtyRaw);
    return {
      channel: typeof rec.fulfillmentChannelCode === "string" ? rec.fulfillmentChannelCode : null,
      quantity: Number.isFinite(qty) ? qty : null,
    };
  }
  return { channel: null, quantity: null };
}

function extractPrice(item: Record<string, unknown>): { price: number | null; currency: string } {
  const offers = asArray(item.offers);
  for (const offer of offers) {
    const rec = asRecord(offer);
    const priceRec = asRecord(rec?.price) ?? asRecord(rec?.listingPrice);
    if (priceRec) {
      const amount = priceRec.amount ?? priceRec.value;
      const currency = typeof priceRec.currencyCode === "string" ? priceRec.currencyCode : "USD";
      const num = typeof amount === "number" ? amount : Number(amount);
      if (Number.isFinite(num)) return { price: num, currency };
    }
  }

  const attrs = asRecord(item.attributes);
  const purchasable = asArray(attrs?.purchasable_offer);
  for (const entry of purchasable) {
    const rec = asRecord(entry);
    const ourPrice = asArray(rec?.our_price);
    for (const priceEntry of ourPrice) {
      const priceRec = asRecord(priceEntry);
      const schedule = asArray(priceRec?.schedule);
      const first = asRecord(schedule[0]);
      const valueWithTax = asRecord(first?.value_with_tax);
      const amount = valueWithTax?.value ?? first?.value;
      const num = typeof amount === "number" ? amount : Number(amount);
      if (Number.isFinite(num)) {
        return {
          price: num,
          currency: typeof valueWithTax?.currency === "string" ? valueWithTax.currency : "USD",
        };
      }
    }
  }

  return { price: null, currency: "USD" };
}

export function normalizeListingStatus(
  summary: Record<string, unknown> | null,
  issues: unknown[],
  fulfillmentQty: number | null,
): {
  listing_status: string;
  listing_status_buyable: boolean;
  listing_status_discoverable: boolean;
} {
  const flags = statusFlags(summary);
  const hasErrorIssue = issues.some((issue) => {
    const rec = asRecord(issue);
    return String(rec?.severity || "").toLowerCase() === "error";
  });

  if (hasErrorIssue) {
    return { listing_status: "issue", ...flags };
  }

  if (fulfillmentQty === 0) {
    return { listing_status: "out_of_stock", ...flags };
  }

  if (flags.buyable) {
    return { listing_status: "active", ...flags };
  }

  const statuses = asArray(summary?.status).map((s) => String(s).toUpperCase());
  if (statuses.some((s) => s.includes("SUPPRESSED"))) {
    return { listing_status: "suppressed", ...flags };
  }

  if (statuses.length > 0) {
    return { listing_status: "inactive", ...flags };
  }

  return { listing_status: "unknown", ...flags };
}

export function normalizeListingItem(
  item: Record<string, unknown>,
  ctx: {
    sellerAccountId: string;
    sellerId: string;
    marketplaceId: string;
    now: string;
  },
): NormalizedListingRow | null {
  const sku = typeof item.sku === "string" ? item.sku.trim() : "";
  if (!sku) return null;

  const summary = pickSummary(item, ctx.marketplaceId);
  const issues = asArray(item.issues);
  const fulfillment = fulfillmentQuantity(item);
  const status = normalizeListingStatus(summary, issues, fulfillment.quantity);
  const { price, currency } = extractPrice(item);

  const relationshipsRaw = asRecord(item.relationships) ?? {};
  const enforcementsFromIssues = issues.reduce<Record<string, unknown>>((acc, issue) => {
    const rec = asRecord(issue);
    if (rec?.enforcements) Object.assign(acc, asRecord(rec.enforcements) ?? {});
    return acc;
  }, {});

  return {
    seller_account_id: ctx.sellerAccountId,
    seller_id: ctx.sellerId,
    marketplace_id: ctx.marketplaceId,
    seller_sku: sku,
    asin: typeof summary?.asin === "string" ? summary.asin : null,
    fn_sku: typeof summary?.fnSku === "string" ? summary.fnSku : null,
    amazon_title: typeof summary?.itemName === "string" ? summary.itemName : null,
    product_type: typeof summary?.productType === "string"
      ? summary.productType
      : (typeof asArray(item.productTypes)[0] === "string"
        ? String(asArray(item.productTypes)[0])
        : null),
    condition_type: typeof summary?.conditionType === "string" ? summary.conditionType : null,
    listing_status: status.listing_status,
    listing_status_buyable: status.listing_status_buyable,
    listing_status_discoverable: status.listing_status_discoverable,
    price,
    currency,
    fulfillment_channel: fulfillment.channel,
    fbm_quantity: fulfillment.quantity,
    quantity_last_source: "listings",
    quantity_synced_at: ctx.now,
    price_synced_at: price !== null ? ctx.now : null,
    last_synced_at: ctx.now,
    relationships: relationshipsRaw,
    enforcements: enforcementsFromIssues,
    raw_listing: item,
    updated_at: ctx.now,
  };
}

export function normalizeListingIssues(item: Record<string, unknown>): NormalizedIssueRow[] {
  const issues = asArray(item.issues);
  const rows: NormalizedIssueRow[] = [];

  for (const issue of issues) {
    const rec = asRecord(issue);
    if (!rec) continue;
    const severityRaw = String(rec.severity || "warning").toLowerCase();
    const severity = severityRaw === "error" || severityRaw === "info" || severityRaw === "warning"
      ? severityRaw
      : "warning";

    rows.push({
      issue_code: typeof rec.code === "string" ? rec.code : null,
      issue_type: "listing_issue",
      severity,
      message: typeof rec.message === "string" ? rec.message : "Listing issue reported by Amazon",
      source: "sync",
      status: "open",
      categories: asArray(rec.categories).map((c) => String(c)),
      attribute_names: asArray(rec.attributeNames).map((c) => String(c)),
      enforcements: asRecord(rec.enforcements) ?? {},
      raw_error: rec,
      source_submission_id: extractSubmissionId(rec),
    });
  }

  return rows;
}

function extractSubmissionId(rec: Record<string, unknown>): string | null {
  if (typeof rec.submissionId === "string" && rec.submissionId.trim()) {
    return rec.submissionId.trim();
  }
  const enforcements = asRecord(rec.enforcements);
  if (typeof enforcements?.submissionId === "string" && enforcements.submissionId.trim()) {
    return enforcements.submissionId.trim();
  }
  return null;
}

export async function searchListingsItemsPage(params: {
  endpoint: string;
  sellerId: string;
  marketplaceId: string;
  accessToken: string;
  pageSize?: number;
  pageToken?: string | null;
  sellerSku?: string;
  lastUpdatedAfter?: string;
  issueSeverity?: string;
  aws?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | null;
    region: string;
  };
}): Promise<SearchListingsResult> {
  const pageSize = params.pageSize ?? 20;
  const query = new URLSearchParams({
    marketplaceIds: params.marketplaceId,
    includedData: LISTINGS_INCLUDED_DATA,
    pageSize: String(pageSize),
  });
  if (params.pageToken) query.set("pageToken", params.pageToken);

  if (params.sellerSku?.trim()) {
    query.set("identifiers", params.sellerSku.trim());
    query.set("identifiersType", "SKU");
  }

  if (params.lastUpdatedAfter?.trim()) {
    query.set("lastUpdatedAfter", params.lastUpdatedAfter.trim());
  }

  if (params.issueSeverity?.trim()) {
    query.set("issueSeverity", params.issueSeverity.trim());
  }

  if (!params.sellerSku?.trim() && !params.pageToken) {
    query.set("sortBy", "lastUpdatedDate");
    query.set("sortOrder", "DESC");
  }

  const url =
    `${params.endpoint}/listings/2021-08-01/items/${encodeURIComponent(params.sellerId)}?${query.toString()}`;

  const baseHeaders: Record<string, string> = {
    "x-amz-access-token": params.accessToken,
    "content-type": "application/json",
    "user-agent": "KarryKraze-AmazonSync/1.0",
  };

  let fetchHeaders: Record<string, string> = baseHeaders;
  const signed = Boolean(params.aws);

  if (params.aws) {
    fetchHeaders = await signSpApiRequest({
      method: "GET",
      url,
      region: params.aws.region,
      service: "execute-api",
      accessKeyId: params.aws.accessKeyId,
      secretAccessKey: params.aws.secretAccessKey,
      sessionToken: params.aws.sessionToken,
      headers: baseHeaders,
    });
  }

  const resp = await fetch(url, {
    method: "GET",
    headers: fetchHeaders,
  });

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: "sp_api_request_failed",
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, signed),
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: "sp_api_request_failed",
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, signed),
    };
  }

  const items = asArray(data.items)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const pagination = asRecord(data.pagination);
  const nextToken = typeof pagination?.nextToken === "string" ? pagination.nextToken : null;

  return { ok: true, items, nextToken, httpStatus: resp.status };
}
