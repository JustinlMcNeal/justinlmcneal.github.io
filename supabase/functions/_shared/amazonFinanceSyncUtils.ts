// Amazon Finances API v2024-06-19 — sync transactions per order.

import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import { parsePayload, spApiGet } from "./amazonSpApiRequestUtils.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Amazon Finances v2024 uses `{ currencyCode, currencyAmount: number }` on breakdown/total fields. */
function readAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  const rec = asRecord(value);
  if (!rec) return null;

  const direct = rec.currencyAmount ?? rec.CurrencyAmount;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const n = parseFloat(direct);
    if (Number.isFinite(n)) return n;
  }

  const nested = asRecord(direct);
  if (nested) {
    const nestedAmt = nested.amount ?? nested.Amount;
    if (nestedAmt != null) {
      const n = parseFloat(String(nestedAmt));
      if (Number.isFinite(n)) return n;
    }
  }

  const amount = rec.amount ?? rec.Amount;
  if (amount != null) {
    const n = parseFloat(String(amount));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function amountToCents(value: unknown): number {
  const n = readAmount(value);
  if (n == null) return 0;
  return Math.round(Math.abs(n) * 100);
}

function signedAmountCents(value: unknown): number {
  const n = readAmount(value);
  if (n == null) return 0;
  return Math.round(n * 100);
}

export function extractAmazonOrderId(txn: Record<string, unknown>): string | null {
  for (const entry of asArray(txn.relatedIdentifiers)) {
    const rec = asRecord(entry);
    const name = String(rec?.relatedIdentifierName || rec?.name || "").toUpperCase();
    if (name === "ORDER_ID") {
      const value = String(rec?.relatedIdentifierValue || rec?.value || "").trim();
      if (value) return value;
    }
  }
  return null;
}

function isAmazonFeeBreakdownType(type: string): boolean {
  if (type.includes("COMMISSION") || type.includes("REFERRAL")) return true;
  if (type.includes("FBA") || type.includes("FULFILLMENT")) return true;
  if (type.includes("CLOSING")) return true;
  if (type.includes("SHIPPINGHB")) return true;
  if (type.includes("FEE")) return true;
  if (type.includes("POSTAGE") || type.includes("BILLING")) return true;
  if (type.includes("SERVICECHARGE")) return true;
  return false;
}

function classifyAmazonFees(breakdowns: unknown[]): {
  fee_referral_cents: number;
  fee_fba_cents: number;
  fee_other_cents: number;
  fee_breakdown: unknown[];
} {
  let feeReferral = 0;
  let feeFba = 0;
  let feeOther = 0;
  const feeBreakdown: unknown[] = [];

  // Fees are nested (Expenses → AmazonFees → Commission, etc.). Count fee-typed nodes
  // even when they have Base children, but skip revenue lines like ProductCharges.
  function walk(entries: unknown[]) {
    for (const entry of entries) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const nested = asArray(rec.breakdowns).filter((child) => asRecord(child));
      const type = String(rec.breakdownType || rec.feeType || rec.type || "OTHER").toUpperCase();
      const cents = amountToCents(rec.breakdownAmount ?? rec.amount ?? rec.totalAmount);

      if (isAmazonFeeBreakdownType(type) && cents) {
        feeBreakdown.push(rec);
        if (type.includes("COMMISSION") || type.includes("REFERRAL")) feeReferral += cents;
        else if (type.includes("FBA") || type.includes("FULFILLMENT")) feeFba += cents;
        else feeOther += cents;
        continue;
      }

      if (nested.length) walk(nested);
    }
  }

  walk(breakdowns);

  return {
    fee_referral_cents: feeReferral,
    fee_fba_cents: feeFba,
    fee_other_cents: feeOther,
    fee_breakdown: feeBreakdown,
  };
}

function buildTransactionsUrl(
  endpoint: string,
  marketplaceId: string,
  postedAfter: string,
  nextToken?: string | null,
): string {
  const query = new URLSearchParams({
    marketplaceId,
    postedAfter,
  });
  if (nextToken?.trim()) query.set("nextToken", nextToken.trim());
  const base = endpoint.replace(/\/$/, "");
  return `${base}/finances/2024-06-19/transactions?${query.toString()}`;
}

export type AmazonFinanceSyncStats = {
  fetched: number;
  upserted: number;
  skipped: number;
};

export async function fetchAmazonFinanceTransactionsSince(
  creds: AmazonCredentials,
  marketplaceId: string,
  postedAfter: string,
): Promise<{ ok: true; transactions: Record<string, unknown>[] } | { ok: false; error: string; hint?: string }> {
  const transactions: Record<string, unknown>[] = [];
  let nextToken: string | null = null;

  while (true) {
    const url = buildTransactionsUrl(creds.endpoint, marketplaceId, postedAfter, nextToken);
    const result = await spApiGet(url, creds.accessToken, creds.aws);
    if (!result.ok) return result;

    const payload = parsePayload(result.data);
    const page = asArray(payload.transactions)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    transactions.push(...page);
    nextToken = typeof payload.nextToken === "string" ? payload.nextToken : null;
    if (!nextToken) break;
    await sleep(1100);
  }

  return { ok: true, transactions };
}

export function mapFinanceTransactionRow(txn: Record<string, unknown>): Record<string, unknown> | null {
  const transactionId = String(txn.transactionId || txn.id || "").trim();
  if (!transactionId) return null;

  const amazonOrderId = extractAmazonOrderId(txn);
  if (!amazonOrderId) return null;

  const breakdowns = asArray(txn.breakdowns ?? txn.items);
  const classified = classifyAmazonFees(breakdowns);
  const totalFeeCents = classified.fee_referral_cents + classified.fee_fba_cents + classified.fee_other_cents;

  const signedProceeds = signedAmountCents(txn.totalAmount);
  const proceeds = signedProceeds > 0 ? signedProceeds : amountToCents(txn.totalAmount);

  return {
    transaction_id: transactionId,
    amazon_order_id: amazonOrderId,
    stripe_checkout_session_id: `amazon_${amazonOrderId}`,
    transaction_type: String(txn.transactionType || txn.type || "UNKNOWN"),
    transaction_status: String(txn.transactionStatus || txn.status || ""),
    transaction_date: String(txn.postedDate || txn.transactionDate || new Date().toISOString()),
    amount_cents: proceeds,
    total_fee_cents: totalFeeCents,
    fee_referral_cents: classified.fee_referral_cents,
    fee_fba_cents: classified.fee_fba_cents,
    fee_other_cents: classified.fee_other_cents,
    fee_breakdown: classified.fee_breakdown,
    raw_payload: txn,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Re-map a stored row from raw_payload (used by repair scripts after parser fixes). */
export function repairFinanceRowFromRaw(row: Record<string, unknown>): Record<string, unknown> | null {
  const raw = asRecord(row.raw_payload);
  if (!raw) return null;

  const mapped = mapFinanceTransactionRow(raw);
  if (!mapped) return null;

  return {
    ...mapped,
    transaction_id: row.transaction_id ?? mapped.transaction_id,
    synced_at: row.synced_at ?? mapped.synced_at,
    updated_at: new Date().toISOString(),
  };
}

export async function syncAmazonFinancesToDb(
  // deno-lint-ignore no-explicit-any
  client: any,
  creds: AmazonCredentials,
  marketplaceId: string,
  daysBack: number,
): Promise<
  | { ok: true; stats: AmazonFinanceSyncStats }
  | { ok: false; error: string; hint?: string }
> {
  const postedAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const stats: AmazonFinanceSyncStats = { fetched: 0, upserted: 0, skipped: 0 };

  const fetchResult = await fetchAmazonFinanceTransactionsSince(creds, marketplaceId, postedAfter);
  if (!fetchResult.ok) return fetchResult;

  stats.fetched = fetchResult.transactions.length;
  const rows = fetchResult.transactions
    .map(mapFinanceTransactionRow)
    .filter((row): row is Record<string, unknown> => row !== null);

  if (!rows.length) return { ok: true, stats };

  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client
      .from("amazon_finance_transactions")
      .upsert(chunk, { onConflict: "transaction_id" });
    if (error) {
      console.warn("[amazon-sync-finances] upsert failed:", error.message);
      stats.skipped += chunk.length;
    } else {
      stats.upserted += chunk.length;
    }
  }

  return { ok: true, stats };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
