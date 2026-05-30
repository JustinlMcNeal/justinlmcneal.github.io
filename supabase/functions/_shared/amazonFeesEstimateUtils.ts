/** Product Fees API v0 — getMyFeesEstimates batch helpers. */

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";

export const FEES_ESTIMATE_MAX_ITEMS = 20;

export type FeesListingInput = {
  amazonListingId: string;
  sellerSku: string;
  asin: string | null;
  marketplaceId: string;
  price: number;
  currency: string;
  fulfillmentChannel: string;
  kkCogs?: number | null;
};

export type FeeDetailLine = {
  feeType: string;
  label: string;
  amount: number;
  currency: string;
};

export type ListingFeeEstimateResult = {
  amazonListingId: string;
  sellerSku: string | null;
  status: "success" | "failed" | "skipped";
  error?: string;
  totalFees?: number;
  currency?: string;
  feeDetails?: FeeDetailLine[];
  estProfit?: number | null;
  source: "product_fees_api";
};

const FEE_TYPE_LABELS: Record<string, string> = {
  ReferralFee: "Referral",
  FBAFees: "FBA fulfillment",
  FBAPickAndPack: "FBA pick & pack",
  FBAWeightHandling: "FBA weight handling",
  VariableClosingFee: "Variable closing",
  PerItemFee: "Per-item",
  ShippingHB: "Shipping",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function moneyAmount(value: unknown): { amount: number; currency: string } | null {
  const row = asRecord(value);
  if (!row) return null;
  const amount = Number(row.Amount ?? row.amount);
  if (!Number.isFinite(amount)) return null;
  const currency = String(row.CurrencyCode ?? row.currencyCode ?? "USD");
  return { amount, currency };
}

export function isAmazonFulfilledChannel(channel: string): boolean {
  const normalized = String(channel || "").toUpperCase();
  return normalized.includes("AMAZON") || normalized === "AFN";
}

export function buildFeesEstimateBatchRequest(items: FeesListingInput[]): unknown[] {
  return items.map((item) => {
    const idType = item.sellerSku ? "SellerSKU" : "ASIN";
    const idValue = item.sellerSku || String(item.asin || "").trim();
    return {
      IdType: idType,
      IdValue: idValue,
      FeesEstimateRequest: {
        MarketplaceId: item.marketplaceId,
        IsAmazonFulfilled: isAmazonFulfilledChannel(item.fulfillmentChannel),
        PriceToEstimateFees: {
          ListingPrice: {
            CurrencyCode: item.currency || "USD",
            Amount: item.price,
          },
        },
        Identifier: item.amazonListingId,
      },
    };
  });
}

function feeLabel(feeType: string): string {
  return FEE_TYPE_LABELS[feeType] || feeType.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function parseFeeDetails(list: unknown[]): FeeDetailLine[] {
  const lines: FeeDetailLine[] = [];
  for (const entry of list) {
    const row = asRecord(entry);
    if (!row) continue;
    const feeType = String(row.FeeType || row.feeType || "Fee");
    const money = moneyAmount(row.FeeAmount || row.feeAmount);
    if (!money) continue;
    lines.push({
      feeType,
      label: feeLabel(feeType),
      amount: Math.round(money.amount * 100) / 100,
      currency: money.currency,
    });
  }
  return lines;
}

function parseSingleFeesEstimateEntry(
  entry: unknown,
  inputById: Map<string, FeesListingInput>,
): ListingFeeEstimateResult | null {
  const root = asRecord(entry);
  if (!root) return null;

  const result = asRecord(root.FeesEstimateResult) || root;
  const identifier = asRecord(result.FeesEstimateIdentifier) ||
    asRecord(root.FeesEstimateIdentifier);
  const listingId = String(
    identifier?.SellerInputIdentifier ||
      identifier?.Identifier ||
      root.Identifier ||
      "",
  ).trim();

  const input = inputById.get(listingId);
  const sellerSku = input?.sellerSku || String(identifier?.IdValue || "") || null;

  const status = String(result.Status || root.Status || "").trim();
  if (status && status !== "Success") {
    const err = asRecord(result.Error || root.Error);
    return {
      amazonListingId: listingId || String(input?.amazonListingId || ""),
      sellerSku,
      status: "failed",
      error: String(err?.Message || err?.Code || status || "fees_estimate_failed"),
      source: "product_fees_api",
    };
  }

  const estimate = asRecord(result.FeesEstimate || root.FeesEstimate);
  if (!estimate) {
    return {
      amazonListingId: listingId || String(input?.amazonListingId || ""),
      sellerSku,
      status: "failed",
      error: "fees_estimate_missing",
      source: "product_fees_api",
    };
  }

  const total = moneyAmount(estimate.TotalFeesEstimate);
  if (!total) {
    return {
      amazonListingId: listingId || String(input?.amazonListingId || ""),
      sellerSku,
      status: "failed",
      error: "fees_total_missing",
      source: "product_fees_api",
    };
  }

  const feeDetails = parseFeeDetails(asArray(estimate.FeeDetailList));
  const kkCogs = input?.kkCogs;
  const estProfit = input && Number.isFinite(Number(kkCogs)) && input.price > 0
    ? Math.round((input.price - Number(kkCogs) - total.amount) * 100) / 100
    : null;

  return {
    amazonListingId: listingId || String(input?.amazonListingId || ""),
    sellerSku,
    status: "success",
    totalFees: total.amount,
    currency: total.currency,
    feeDetails,
    estProfit,
    source: "product_fees_api",
  };
}

export function parseFeesEstimateBatchResponse(
  payload: unknown,
  inputs: FeesListingInput[],
): ListingFeeEstimateResult[] {
  const inputById = new Map(inputs.map((row) => [row.amazonListingId, row]));
  const entries = Array.isArray(payload) ? payload : [payload];
  const parsed: ListingFeeEstimateResult[] = [];

  for (const entry of entries) {
    const row = parseSingleFeesEstimateEntry(entry, inputById);
    if (row) parsed.push(row);
  }

  const seen = new Set(parsed.map((row) => row.amazonListingId));
  for (const input of inputs) {
    if (seen.has(input.amazonListingId)) continue;
    parsed.push({
      amazonListingId: input.amazonListingId,
      sellerSku: input.sellerSku,
      status: "failed",
      error: "fees_estimate_missing",
      source: "product_fees_api",
    });
  }

  return parsed;
}

export async function callGetMyFeesEstimates(params: {
  creds: AmazonCredentials;
  items: FeesListingInput[];
}): Promise<
  | { ok: true; results: ListingFeeEstimateResult[] }
  | { ok: false; error: string; hint?: string; httpStatus?: number }
> {
  if (!params.items.length) {
    return { ok: true, results: [] };
  }

  if (!params.creds.aws) {
    return { ok: false, error: "server_misconfigured" };
  }

  const url = `${params.creds.endpoint}/products/fees/v0/feesEstimate`;
  const body = JSON.stringify(buildFeesEstimateBatchRequest(params.items));

  const fetchHeaders = await signSpApiRequest({
    method: "POST",
    url,
    region: params.creds.aws.region,
    service: "execute-api",
    accessKeyId: params.creds.aws.accessKeyId,
    secretAccessKey: params.creds.aws.secretAccessKey,
    sessionToken: params.creds.aws.sessionToken,
    headers: {
      "x-amz-access-token": params.creds.accessToken,
      "content-type": "application/json",
      "user-agent": "KarryKraze-AmazonFeesEstimate/1.0",
    },
    body,
  });

  const resp = await fetch(url, { method: "POST", headers: fetchHeaders, body });

  let data: unknown = [];
  try {
    data = await resp.json();
  } catch {
    return {
      ok: false,
      error: "sp_api_fees_failed",
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: "sp_api_fees_failed",
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  return {
    ok: true,
    results: parseFeesEstimateBatchResponse(data, params.items),
  };
}

export async function estimateListingFeesForAccount(params: {
  creds: AmazonCredentials;
  items: FeesListingInput[];
}): Promise<ListingFeeEstimateResult[]> {
  const results: ListingFeeEstimateResult[] = [];
  for (let offset = 0; offset < params.items.length; offset += FEES_ESTIMATE_MAX_ITEMS) {
    const chunk = params.items.slice(offset, offset + FEES_ESTIMATE_MAX_ITEMS);
    const call = await callGetMyFeesEstimates({ creds: params.creds, items: chunk });
    if (!call.ok) {
      for (const item of chunk) {
        results.push({
          amazonListingId: item.amazonListingId,
          sellerSku: item.sellerSku,
          status: "failed",
          error: call.error,
          source: "product_fees_api",
        });
      }
      continue;
    }
    results.push(...call.results);
  }
  return results;
}
