// Convert amazon_listing_drafts payload into conservative Listings Items PUT body.

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import type { ValidationIssue } from "./amazonDraftValidationUtils.ts";

export type DraftRowForListing = {
  seller_sku: string | null;
  marketplace_id: string | null;
  product_type: string | null;
  requirements: string | null;
  matched_asin: string | null;
  asin: string | null;
  draft_payload: Record<string, unknown> | null;
};

export type ListingsItemRequestBody = {
  productType: string;
  requirements: string;
  attributes: Record<string, unknown>;
};

export type PutListingsResult =
  | {
    ok: true;
    httpStatus: number;
    submissionId: string | null;
    submissionStatus: string;
    issues: Record<string, unknown>[];
    rawResponse: Record<string, unknown>;
  }
  | { ok: false; error: string; httpStatus?: number; hint?: string };

/** @deprecated Use PutListingsResult */
export type PutListingsPreviewResult = PutListingsResult;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numericValue(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function marketplaceAttribute(
  marketplaceId: string,
  value: string,
  languageTag = "en_US",
): Record<string, unknown>[] {
  return [{
    marketplace_id: marketplaceId,
    language_tag: languageTag,
    value,
  }];
}

function buildBulletPoints(
  draftPayload: Record<string, unknown>,
  marketplaceId: string,
): Record<string, unknown>[] | null {
  const raw = draftPayload.bulletPoints ?? draftPayload.bullet_point;
  const lines = Array.isArray(raw)
    ? raw.map((entry) => String(entry).trim()).filter(Boolean)
    : typeof raw === "string"
    ? raw.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];

  if (!lines.length) return null;
  return lines.map((line) => ({
    marketplace_id: marketplaceId,
    language_tag: "en_US",
    value: line,
  }));
}

export function buildListingsItemRequestBody(
  draft: DraftRowForListing,
): { ok: true; body: ListingsItemRequestBody } | { ok: false; error: string } {
  const draftPayload = asRecord(draft.draft_payload) ?? {};
  const marketplaceId = textValue(draft.marketplace_id);
  const productType = textValue(draft.product_type) ||
    textValue(draftPayload.productType);
  const requirements = textValue(draft.requirements) || "LISTING";

  if (!marketplaceId || !productType) {
    return { ok: false, error: "listing_payload_error" };
  }

  const attributes: Record<string, unknown> = {};
  const title = textValue(draftPayload.title) || textValue(draftPayload.item_name);
  const brand = textValue(draftPayload.brand);
  const description = textValue(draftPayload.description) ||
    textValue(draftPayload.product_description);

  if (title) attributes.item_name = marketplaceAttribute(marketplaceId, title);
  if (brand) attributes.brand = marketplaceAttribute(marketplaceId, brand);
  if (description) {
    attributes.product_description = marketplaceAttribute(marketplaceId, description);
  }

  const bullets = buildBulletPoints(draftPayload, marketplaceId);
  if (bullets) attributes.bullet_point = bullets;

  const conditionType = textValue(draftPayload.conditionType) ||
    textValue(draftPayload.condition_type) ||
    "new_new";
  attributes.condition_type = [{ value: conditionType, marketplace_id: marketplaceId }];

  const price = numericValue(draftPayload.price);
  if (price !== null && price >= 0) {
    attributes.purchasable_offer = [{
      marketplace_id: marketplaceId,
      currency: "USD",
      our_price: [{
        schedule: [{ value_with_tax: price }],
      }],
    }];
  }

  const quantity = numericValue(draftPayload.quantity);
  const fulfillmentChannel = textValue(draftPayload.fulfillmentChannel) ||
    textValue(draftPayload.fulfillment_channel) ||
    "DEFAULT";
  if (quantity !== null && quantity >= 0) {
    attributes.fulfillment_availability = [{
      fulfillment_channel_code: fulfillmentChannel,
      quantity,
    }];
  }

  const matchedAsin = textValue(draft.matched_asin) || textValue(draft.asin) ||
    textValue(draftPayload.matchedAsin) || textValue(draftPayload.asin);
  if (matchedAsin) {
    attributes.merchant_suggested_asin = [{
      value: matchedAsin,
      marketplace_id: marketplaceId,
    }];
  }

  if (Object.keys(attributes).length === 0) {
    return { ok: false, error: "listing_payload_error" };
  }

  return {
    ok: true,
    body: {
      productType,
      requirements,
      attributes,
    },
  };
}

export function mapAmazonListingIssues(
  issues: unknown[],
  fallbackMessage = "Amazon validation issue reported during preview submit.",
): ValidationIssue[] {
  const rows: ValidationIssue[] = [];

  for (const issue of issues) {
    const rec = asRecord(issue);
    if (!rec) continue;
    const severityRaw = String(rec.severity || "warning").toLowerCase();
    const severity = severityRaw === "error" ? "error" : "warning";
    const attributeNames = asArray(rec.attributeNames).map((name) => String(name));
    const field = attributeNames[0] || String(rec.code || "amazon_issue");
    const message = typeof rec.message === "string" && rec.message.trim()
      ? rec.message.trim()
      : fallbackMessage;

    rows.push({ field, severity, message });
  }

  return rows;
}

export function resolveDraftStatusAfterAmazonPreview(input: {
  submissionStatus: string;
  amazonIssues: ValidationIssue[];
  localIssues: ValidationIssue[];
}): string {
  const submissionStatus = input.submissionStatus.toUpperCase();
  const hasAmazonErrors = input.amazonIssues.some((issue) => issue.severity === "error");
  const hasLocalErrors = input.localIssues.some((issue) => issue.severity === "error");

  if (submissionStatus === "INVALID" || hasAmazonErrors) {
    return hasLocalErrors ? "needs_attributes" : "rejected";
  }
  if (submissionStatus === "VALID" || submissionStatus === "ACCEPTED") {
    const hasWarnings = input.amazonIssues.some((issue) => issue.severity === "warning") ||
      input.localIssues.some((issue) => issue.severity === "warning");
    return hasWarnings ? "draft" : "ready_to_submit";
  }
  return "needs_attributes";
}

export function resolveDraftStatusAfterLiveSubmit(input: {
  submissionStatus: string;
  amazonIssues: ValidationIssue[];
}): string {
  const submissionStatus = input.submissionStatus.toUpperCase();
  const hasAmazonErrors = input.amazonIssues.some((issue) => issue.severity === "error");

  if (submissionStatus === "INVALID" || hasAmazonErrors) {
    return "rejected";
  }
  if (submissionStatus === "ACCEPTED") {
    return "submitted";
  }
  return "needs_attributes";
}

export type LiveSubmitBlockReason =
  | "draft_status_not_ready"
  | "missing_product_type"
  | "missing_last_validation_result"
  | "ptd_preview_required"
  | "amazon_validation_preview_required"
  | "open_validation_errors"
  | "open_push_errors";

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isPtdPreviewCurrent(draft: Record<string, unknown>): boolean {
  const lastResult = asRecord(draft.last_validation_result);
  if (!lastResult) return false;

  const previewedAt = parseIsoMs(lastResult.previewedAt);
  if (previewedAt === null) return false;

  const productType = textValue(draft.product_type);
  const previewProductType = textValue(lastResult.productType);
  if (!productType || previewProductType !== productType) return false;

  const updatedAt = parseIsoMs(draft.updated_at);
  if (updatedAt === null) return true;

  const amazonPreviewAt = parseIsoMs(lastResult.amazonPreviewAt);
  const freshnessAnchor = amazonPreviewAt !== null && amazonPreviewAt >= previewedAt
    ? amazonPreviewAt
    : previewedAt;

  return updatedAt <= freshnessAnchor;
}

export function evaluateDraftLiveSubmitReadiness(
  draft: Record<string, unknown>,
  openIssues: Array<{ source?: string; severity?: string }>,
): { ready: boolean; reasons: LiveSubmitBlockReason[] } {
  const reasons: LiveSubmitBlockReason[] = [];

  if (String(draft.draft_status) !== "ready_to_submit") {
    reasons.push("draft_status_not_ready");
  }
  if (!textValue(draft.product_type)) {
    reasons.push("missing_product_type");
  }

  const lastResult = asRecord(draft.last_validation_result);
  if (!lastResult || Object.keys(lastResult).length === 0) {
    reasons.push("missing_last_validation_result");
  }
  if (!isPtdPreviewCurrent(draft)) {
    reasons.push("ptd_preview_required");
  }
  if (!hasRecentValidationPreview(draft)) {
    reasons.push("amazon_validation_preview_required");
  }

  if (openIssues.some((issue) => issue.source === "validation" && issue.severity === "error")) {
    reasons.push("open_validation_errors");
  }
  if (openIssues.some((issue) => issue.source === "push" && issue.severity === "error")) {
    reasons.push("open_push_errors");
  }

  return { ready: reasons.length === 0, reasons };
}

export function hasRecentValidationPreview(draft: Record<string, unknown>): boolean {
  const lastResponse = asRecord(draft.last_submission_response);
  if (!lastResponse || lastResponse.mode !== "VALIDATION_PREVIEW") return false;
  const status = String(draft.submission_status || lastResponse.status || "").toUpperCase();
  return status === "VALID" || status === "ACCEPTED";
}

async function putListingsItemRequest(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  body: ListingsItemRequestBody;
  mode?: "VALIDATION_PREVIEW";
  userAgent: string;
  failureError: string;
}): Promise<PutListingsResult> {
  const query = new URLSearchParams({ marketplaceIds: params.marketplaceId });
  if (params.mode) query.set("mode", params.mode);

  const url =
    `${params.creds.endpoint}/listings/2021-08-01/items/${encodeURIComponent(params.sellerId)}/${encodeURIComponent(params.sellerSku)}?${query.toString()}`;
  const requestBody = JSON.stringify(params.body);

  const baseHeaders: Record<string, string> = {
    "x-amz-access-token": params.creds.accessToken,
    "content-type": "application/json",
    "user-agent": params.userAgent,
  };

  if (!params.creds.aws) {
    return { ok: false, error: "server_misconfigured" };
  }

  const fetchHeaders = await signSpApiRequest({
    method: "PUT",
    url,
    region: params.creds.aws.region,
    service: "execute-api",
    accessKeyId: params.creds.aws.accessKeyId,
    secretAccessKey: params.creds.aws.secretAccessKey,
    sessionToken: params.creds.aws.sessionToken,
    headers: baseHeaders,
    body: requestBody,
  });

  const resp = await fetch(url, {
    method: "PUT",
    headers: fetchHeaders,
    body: requestBody,
  });

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: params.failureError,
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: params.failureError,
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  const issues = asArray(data.issues)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return {
    ok: true,
    httpStatus: resp.status,
    submissionId: typeof data.submissionId === "string" ? data.submissionId : null,
    submissionStatus: typeof data.status === "string" ? data.status : "INVALID",
    issues,
    rawResponse: data,
  };
}

export async function putListingsItemValidationPreview(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  body: ListingsItemRequestBody;
}): Promise<PutListingsResult> {
  return putListingsItemRequest({
    ...params,
    mode: "VALIDATION_PREVIEW",
    userAgent: "KarryKraze-AmazonSubmitPreview/1.0",
    failureError: "sp_api_validation_failed",
  });
}

export async function putListingsItemLiveSubmit(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  body: ListingsItemRequestBody;
}): Promise<PutListingsResult> {
  return putListingsItemRequest({
    ...params,
    userAgent: "KarryKraze-AmazonLiveSubmit/1.0",
    failureError: "sp_api_submit_failed",
  });
}

export async function syncPushIssues(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  amazonIssues: ValidationIssue[],
  submissionId: string | null,
  now: string,
  issueType = "amazon_validation",
) {
  await client
    .from("amazon_listing_issues")
    .delete()
    .eq("draft_id", draftId)
    .eq("source", "push")
    .eq("status", "open");

  if (amazonIssues.length === 0) return;

  const rows = amazonIssues.map((issue) => ({
    draft_id: draftId,
    issue_code: issue.field,
    issue_type: issueType,
    severity: issue.severity,
    message: issue.message,
    source: "push",
    status: "open",
    categories: [],
    attribute_names: issue.field ? [issue.field] : [],
    enforcements: {},
    raw_error: issue,
    source_submission_id: submissionId,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await client.from("amazon_listing_issues").insert(rows);
  if (error) throw new Error("database_error");
}
