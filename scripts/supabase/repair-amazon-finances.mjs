#!/usr/bin/env node
/**
 * Re-parse all amazon_finance_transactions from stored raw_payload using the
 * fixed amount/fee parser (see amazonFinanceSyncUtils.ts).
 *
 * Usage:
 *   node scripts/supabase/repair-amazon-finances.mjs
 *   node scripts/supabase/repair-amazon-finances.mjs --sync-api
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function loadEnv() {
  try {
    const raw = readFileSync(resolve(repoRoot, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const syncApi = process.argv.includes("--sync-api");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readAmount(value) {
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

function amountToCents(value) {
  const n = readAmount(value);
  if (n == null) return 0;
  return Math.round(Math.abs(n) * 100);
}

function signedAmountCents(value) {
  const n = readAmount(value);
  if (n == null) return 0;
  return Math.round(n * 100);
}

function extractAmazonOrderId(txn) {
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

function isAmazonFeeBreakdownType(type) {
  if (type.includes("COMMISSION") || type.includes("REFERRAL")) return true;
  if (type.includes("FBA") || type.includes("FULFILLMENT")) return true;
  if (type.includes("CLOSING")) return true;
  if (type.includes("SHIPPINGHB")) return true;
  if (type.includes("FEE")) return true;
  if (type.includes("POSTAGE") || type.includes("BILLING")) return true;
  if (type.includes("SERVICECHARGE")) return true;
  return false;
}

function classifyAmazonFees(breakdowns) {
  let feeReferral = 0;
  let feeFba = 0;
  let feeOther = 0;
  const feeBreakdown = [];

  function walk(entries) {
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

      if (nested.length) {
        walk(nested);
      }
    }
  }

  walk(breakdowns);
  return { fee_referral_cents: feeReferral, fee_fba_cents: feeFba, fee_other_cents: feeOther, fee_breakdown: feeBreakdown };
}

function mapFinanceTransactionRow(txn) {
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
    updated_at: new Date().toISOString(),
  };
}

function repairFinanceRowFromRaw(row) {
  const raw = asRecord(row.raw_payload);
  if (!raw) return null;
  const mapped = mapFinanceTransactionRow(raw);
  if (!mapped) return null;
  return {
    ...mapped,
    transaction_id: row.transaction_id ?? mapped.transaction_id,
    synced_at: row.synced_at ?? mapped.synced_at,
  };
}

async function fetchAllTransactions() {
  const rows = [];
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/amazon_finance_transactions` +
      `?select=transaction_id,synced_at,raw_payload,amount_cents,total_fee_cents` +
      `&order=transaction_id.asc&limit=${pageSize}&offset=${offset}`;
    const resp = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${await resp.text()}`);
    const page = await resp.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function upsertChunk(chunk) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/amazon_finance_transactions?on_conflict=transaction_id`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    },
  );
  if (!resp.ok) throw new Error(`Upsert failed (${resp.status}): ${await resp.text()}`);
}

async function syncFinancesApi(daysBack = 90) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/amazon-sync-finances`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ days_back: daysBack }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `API sync failed (${resp.status})`);
  }
  return data;
}

async function main() {
  console.log("Fetching amazon_finance_transactions…");
  const existing = await fetchAllTransactions();
  console.log(`Found ${existing.length} row(s).`);

  const repaired = [];
  let skipped = 0;
  let changed = 0;

  for (const row of existing) {
    const next = repairFinanceRowFromRaw(row);
    if (!next) {
      skipped += 1;
      continue;
    }
    if (
      next.amount_cents !== row.amount_cents ||
      next.total_fee_cents !== row.total_fee_cents
    ) {
      changed += 1;
    }
    repaired.push(next);
  }

  console.log(`Repaired ${repaired.length} row(s), ${changed} with amount/fee changes, ${skipped} skipped.`);

  const chunkSize = 50;
  for (let i = 0; i < repaired.length; i += chunkSize) {
    await upsertChunk(repaired.slice(i, i + chunkSize));
    process.stdout.write(`Upserted ${Math.min(i + chunkSize, repaired.length)}/${repaired.length}\r`);
  }
  console.log("\nRepair upsert complete.");

  if (syncApi) {
    console.log("Running amazon-sync-finances API (90 days)…");
    const apiResult = await syncFinancesApi(90);
    console.log("API sync:", apiResult);
  }

  const verify = await fetch(
    `${SUPABASE_URL}/rest/v1/v_amazon_order_profit?select=kk_order_id,amazon_order_earnings_cents,amazon_total_fee_cents,amazon_net_profit_cents&kk_order_id=eq.AMZ-8135402`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const sample = await verify.json();
  if (sample[0]) {
    console.log("Sample AMZ-8135402 after repair:", sample[0]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
