// /js/admin/expenses/importAmazonTxn.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── CSV helpers ──────────────────────────────────────────────────

function parseCSVRow(line) {
  const cells = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseDate(str) {
  // "3/7/2026" → "2026-03-07"
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function cents(str) {
  const n = parseFloat((str || "0").replace(/[^0-9.\-]/g, ""));
  return Math.round(Math.abs(n) * 100);
}

// ── Parser ───────────────────────────────────────────────────────

/**
 * Parse Amazon Seller "Transactions" CSV.
 *
 * Columns: Date, Transaction Status, Transaction type, Order ID,
 *          Product Details, Total product charges, Total promotional rebates,
 *          Amazon fees, Other, Total (USD)
 *
 * Extracts:
 *  - shippingLabels: "Shipping services purchased through Amazon" rows
 *  - subscriptionFees: "Service Fees" rows
 *  - sellingFees: Amazon fees from "Order Payment" rows
 */
export function parseAmazonTransactions(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors = [];

  // Find header row
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const row = parseCSVRow(lines[i]);
    if (row.some(c => /date/i.test(c)) && row.some(c => /transaction type/i.test(c))) {
      headers = row.map(h => h.toLowerCase().trim());
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    errors.push("Could not find header row (expected 'Date' and 'Transaction type' columns).");
    return { shippingLabels: [], subscriptionFees: [], sellingFees: [], errors };
  }

  const col = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 && idx < row.length ? row[idx].trim() : "";
  };

  const shippingLabels = [];   // Update order shipping costs
  const subscriptionFees = []; // Amazon Professional subscription → expenses
  const sellingFees = [];      // Per-order Amazon fees → expenses (aggregated monthly)

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 5) continue;

    const txnType = col(row, "transaction type");
    const date = parseDate(col(row, "date"));
    const orderId = col(row, "order id");
    const productDetails = col(row, "product details");
    const totalStr = col(row, "total (usd)");

    if (!txnType || !date) continue;

    switch (txnType) {
      case "Shipping services purchased through Amazon": {
        // Shipping label purchase — negative total means money spent
        const costCents = cents(totalStr);
        if (costCents <= 0) break;

        shippingLabels.push({
          date,
          orderNumber: orderId || null,
          costCents,
          productDetails,
        });
        break;
      }

      case "Service Fees": {
        // Subscription ($39.99/month) or other service fees
        const amazonFees = cents(col(row, "amazon fees"));
        const totalCents = cents(totalStr);
        const amountCents = amazonFees || totalCents;
        if (amountCents <= 0) break;

        subscriptionFees.push({
          date,
          amountCents,
          description: productDetails || "Amazon Subscription Fee",
        });
        break;
      }

      case "Order Payment": {
        // Extract Amazon selling fees from order rows
        const feeCents = cents(col(row, "amazon fees"));
        if (feeCents <= 0) break;

        sellingFees.push({
          date,
          orderId,
          feeCents,
          productDetails: productDetails || orderId,
        });
        break;
      }

      // Skip: "Paid to Amazon | Seller repayment", "Micro Deposit", etc.
    }
  }

  return { shippingLabels, subscriptionFees, sellingFees, errors };
}

// ── Update order shipping costs ──────────────────────────────────

export async function updateAmazonShippingCosts(shippingLabels) {
  let updated = 0;
  let skipped = 0;

  for (const label of shippingLabels) {
    if (!label.orderNumber || label.orderNumber === "---") { skipped++; continue; }

    // Amazon orders are stored with session_id = "amz_{orderId}"
    const sessionId = `amz_${label.orderNumber}`;

    const { error } = await supabase
      .from("fulfillment_shipments")
      .update({
        label_cost_cents: label.costCents,
        carrier: "Amazon",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_checkout_session_id", sessionId);

    if (error) {
      console.warn(`Failed to update shipping for ${label.orderNumber}:`, error.message);
      skipped++;
    } else {
      updated++;
    }
  }

  return { updated, skipped };
}

// ── Dupe detection ───────────────────────────────────────────────

export async function findExistingAmazonExpenses(referenceIds) {
  if (!referenceIds.length) return new Set();

  // Ref IDs are stored in the `notes` field, e.g. "Ref: amz_sub_2026-02-16"
  const orFilters = referenceIds.map(id => `notes.ilike.%${id}%`).join(",");
  const { data, error } = await supabase
    .from("expenses")
    .select("notes")
    .or(orFilters);

  if (error) throw error;

  const existing = new Set();
  for (const row of (data || [])) {
    for (const id of referenceIds) {
      if (row.notes && row.notes.includes(id)) {
        existing.add(id);
      }
    }
  }
  return existing;
}

// ── Import as expenses ───────────────────────────────────────────

export async function importAmazonExpenses({ subscriptionFees, sellingFees, existingRefs }) {
  const rows = [];

  // Subscription fees
  for (const fee of subscriptionFees) {
    const refId = `amz_sub_${fee.date}`;
    if (existingRefs.has(refId)) continue;

    rows.push({
      expense_date: fee.date,
      category: "Software",
      description: `Amazon Seller — ${fee.description} (${fee.date})`,
      amount_cents: fee.amountCents,
      vendor: "Amazon",
      notes: `Auto-imported from Amazon Transactions CSV. Ref: ${refId}`,
      miles: null,
      mileage_rate: null,
    });
  }

  // Selling fees (aggregated monthly)
  const monthlyFees = {};
  for (const sf of sellingFees) {
    const month = sf.date.slice(0, 7);
    if (!monthlyFees[month]) monthlyFees[month] = { cents: 0, count: 0 };
    monthlyFees[month].cents += sf.feeCents;
    monthlyFees[month].count++;
  }

  for (const [month, agg] of Object.entries(monthlyFees)) {
    const refId = `amz_selling_fees_${month}`;
    if (existingRefs.has(refId)) continue;

    rows.push({
      expense_date: `${month}-01`,
      category: "Fees",
      description: `Amazon Selling Fees — ${month} (${agg.count} orders)`,
      amount_cents: agg.cents,
      vendor: "Amazon",
      notes: `Auto-imported. Monthly aggregate of Amazon referral/closing fees. Ref: ${refId}`,
      miles: null,
      mileage_rate: null,
    });
  }

  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("expenses").insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }

  return inserted;
}
