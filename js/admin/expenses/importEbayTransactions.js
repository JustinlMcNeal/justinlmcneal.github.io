// /js/admin/expenses/importEbayTransactions.js
// Parses the eBay Transaction Report CSV and:
//  1. Imports fees/expenses (subscription fees, shipping labels) into the expenses table
//  2. Updates existing eBay orders' label_cost_cents + tracking_number in fulfillment_shipments

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── CSV parser (RFC 4180) ───────────────────────────────────────

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseCSV(text) {
  const raw = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let i = 0;

  function readField() {
    if (i >= raw.length) return "";
    if (raw[i] === '"') {
      i++;
      let val = "";
      while (i < raw.length) {
        if (raw[i] === '"') {
          if (raw[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += raw[i]; i++; }
      }
      return val;
    } else {
      let val = "";
      while (i < raw.length && raw[i] !== "," && raw[i] !== "\n") { val += raw[i]; i++; }
      return val;
    }
  }

  while (i < raw.length) {
    const row = [];
    while (true) {
      row.push(readField());
      if (i < raw.length && raw[i] === ",") { i++; continue; }
      if (i < raw.length && raw[i] === "\n") { i++; break; }
      break;
    }
    rows.push(row);
  }
  return rows;
}

// ── helpers ─────────────────────────────────────────────────────

function dollars(str) {
  if (!str || str === "--") return 0;
  const n = parseFloat(str.replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : n;
}

function cents(str) {
  return Math.round(Math.abs(dollars(str)) * 100);
}

/**
 * Parse eBay date like "Dec 30, 2025" → "2025-12-30"
 */
function parseDate(str) {
  if (!str || str === "--") return null;
  str = str.trim();
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── parseEbayTransactions ───────────────────────────────────────

export function parseEbayTransactions(text) {
  const csvRows = parseCSV(text);
  const errors = [];

  // Find the header row (contains "Transaction creation date" or "Type")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(csvRows.length, 20); i++) {
    const joined = csvRows[i].join(",").toLowerCase();
    if (joined.includes("transaction creation date") && joined.includes("type")) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    errors.push("Could not find header row — is this an eBay Transaction Report CSV?");
    return { shippingLabels: [], fees: [], sellingFees: [], errors };
  }

  const headers = csvRows[headerIdx].map(h => h.trim());
  const col = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 && idx < row.length ? row[idx].trim() : "";
  };

  const shippingLabels = [];  // For updating orders
  const fees = [];             // Subscription fees, other fees → expenses
  const sellingFees = [];      // Per-order selling fees → expenses (aggregated)

  for (let i = headerIdx + 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (!row || row.length < 5) continue;

    const type = col(row, "Type");
    const date = parseDate(col(row, "Transaction creation date"));
    const orderNumber = col(row, "Order number");
    const netAmount = col(row, "Net amount");
    const grossAmount = col(row, "Gross transaction amount");
    const description = col(row, "Description");
    const referenceId = col(row, "Reference ID");
    const itemTitle = col(row, "Item title");

    if (!type || !date) continue;

    switch (type) {
      case "Shipping label": {
        // Extract tracking number from description ("Tracking no. XXXX")
        let tracking = null;
        if (description) {
          const tm = description.match(/Tracking\s+no\.\s*(\S+)/i);
          if (tm) tracking = tm[1];
        }
        // Also check Reference ID field
        if (!tracking && referenceId) {
          const tm2 = referenceId.match(/Tracking\s+no\.\s*(\S+)/i);
          if (tm2) tracking = tm2[1];
        }

        const costCents = cents(grossAmount || netAmount);

        shippingLabels.push({
          date,
          orderNumber: orderNumber || null,
          costCents,
          tracking,
          carrier: col(row, "Description")?.includes("USPS") ? "USPS" :
                   col(row, "Description")?.includes("UPS") ? "UPS" :
                   col(row, "Description")?.includes("FedEx") ? "FedEx" : "USPS",
        });
        break;
      }

      case "Other fee": {
        const amountCents = cents(grossAmount || netAmount);
        if (amountCents === 0) break;

        // Extract fee description from "Description" or "Reference ID" field
        let feeDesc = description || referenceId || "eBay Fee";

        fees.push({
          date,
          amountCents,
          description: feeDesc,
          referenceId: referenceId || null,
        });
        break;
      }

      case "Order": {
        // Extract selling fees from order rows
        const fvfFixed = cents(col(row, "Final Value Fee - fixed"));
        const fvfVariable = cents(col(row, "Final Value Fee - variable"));
        const regFee = cents(col(row, "Regulatory operating fee"));
        const intlFee = cents(col(row, "International fee"));
        const vhindFee = cents(col(row, 'Very high "item not as described" fee'));
        const bspFee = cents(col(row, "Below standard performance fee"));

        const totalFeeCents = fvfFixed + fvfVariable + regFee + intlFee + vhindFee + bspFee;
        if (totalFeeCents > 0) {
          sellingFees.push({
            date,
            orderNumber,
            amountCents: totalFeeCents,
            itemTitle: itemTitle || orderNumber,
            fvfFixed,
            fvfVariable,
            regFee,
            intlFee,
          });
        }
        break;
      }

      // Skip: Payout, Charge, Adjustment, etc.
    }
  }

  return { shippingLabels, fees, sellingFees, errors };
}

// ── Update order shipping costs ─────────────────────────────────

export async function updateOrderShippingCosts(shippingLabels) {
  let updated = 0;
  let skipped = 0;

  for (const label of shippingLabels) {
    if (!label.orderNumber) { skipped++; continue; }

    const sessionId = `ebay_${label.orderNumber}`;

    const updateFields = { label_cost_cents: label.costCents };
    if (label.tracking) updateFields.tracking_number = label.tracking;
    if (label.carrier) updateFields.carrier = label.carrier;
    updateFields.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("fulfillment_shipments")
      .update(updateFields)
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

// ── Import fees as expenses ─────────────────────────────────────

export async function findExistingEbayExpenses(referenceIds) {
  if (!referenceIds.length) return new Set();

  const orFilters = referenceIds.map(id => `description.ilike.%${id}%`).join(",");
  const { data, error } = await supabase
    .from("expenses")
    .select("description")
    .or(orFilters);

  if (error) throw error;

  const existing = new Set();
  for (const row of (data || [])) {
    for (const id of referenceIds) {
      if (row.description && row.description.includes(id)) {
        existing.add(id);
      }
    }
  }
  return existing;
}

export async function importEbayExpenses({ fees, sellingFees, existingRefs }) {
  const rows = [];

  // Other fees (subscriptions, etc.)
  for (const fee of fees) {
    const refId = fee.referenceId || `ebay_fee_${fee.date}_${fee.amountCents}`;
    if (existingRefs.has(refId)) continue;

    rows.push({
      expense_date: fee.date,
      category: "Software",    // eBay subscription fees
      description: `eBay — ${fee.description}`,
      amount_cents: fee.amountCents,
      vendor: "eBay",
      notes: `Auto-imported from eBay Transaction Report. Ref: ${refId}`,
      miles: null,
      mileage_rate: null,
    });
  }

  // Selling fees (aggregated per month for cleaner view)
  const monthlyFees = {};
  for (const sf of sellingFees) {
    const month = sf.date.slice(0, 7); // "2025-12"
    if (!monthlyFees[month]) monthlyFees[month] = { cents: 0, count: 0 };
    monthlyFees[month].cents += sf.amountCents;
    monthlyFees[month].count++;
  }

  for (const [month, agg] of Object.entries(monthlyFees)) {
    const refId = `ebay_selling_fees_${month}`;
    if (existingRefs.has(refId)) continue;

    rows.push({
      expense_date: `${month}-01`,
      category: "Fees",
      description: `eBay Selling Fees — ${month} (${agg.count} orders)`,
      amount_cents: agg.cents,
      vendor: "eBay",
      notes: `Auto-imported. Monthly aggregate of Final Value Fees + regulatory fees. Ref: ${refId}`,
      miles: null,
      mileage_rate: null,
    });
  }

  // Insert
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
