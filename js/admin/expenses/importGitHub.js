// /js/admin/expenses/importGitHub.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Parse GitHub billing / payment history text.
 *
 * Expected paste format (tab-separated or 2+ spaces):
 *   2026-02-23  0DEGCROG  Visa ending in 8647  $39.00  Success
 *
 * Columns: Date, ID, Payment Method, Amount, Status, (Receipt, Invoice — ignored)
 *
 * Returns array of { id, expense_date, amount_cents, payment_method, status, raw }
 */
export function parseGitHubBilling(text) {
  const lines = text.trim().split(/\n/).map(l => l.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    // Skip obvious header row
    if (/^date\s/i.test(line)) continue;
    if (/^showing/i.test(line)) continue;

    // Split by tab first, then fall back to 2+ spaces
    const parts = line.includes("\t")
      ? line.split("\t").map(s => s.trim()).filter(Boolean)
      : line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

    // Need at least: Date, ID, Payment Method, Amount, Status
    if (parts.length < 5) continue;

    const dateStr = parts[0];          // "2026-02-23"
    const txnId = parts[1];            // "0DEGCROG"
    const paymentMethod = parts[2];    // "Visa ending in 8647"
    const amountStr = parts[3];        // "$39.00"
    const status = parts[4];           // "Success"

    // Parse date — accept YYYY-MM-DD directly
    const expense_date = parseGHDate(dateStr);
    if (!expense_date) continue;

    // Parse amount
    const dollars = parseFloat(amountStr.replace(/[^0-9.]/g, "")) || 0;
    const amount_cents = Math.round(dollars * 100);
    if (amount_cents <= 0) continue;

    results.push({
      id: txnId,
      expense_date,
      amount_cents,
      payment_method: paymentMethod,
      status,
      raw: line,
    });
  }

  return results;
}

function parseGHDate(str) {
  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Try "Mon DD, YYYY" format
  const match = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!match) return null;

  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const m = months[match[1].toLowerCase().slice(0, 3)];
  const d = match[2].padStart(2, "0");
  const y = match[3];
  return m ? `${y}-${m}-${d}` : null;
}

/**
 * Check which GitHub billing IDs already exist in the database.
 * Returns a Set of IDs already imported.
 */
export async function findExistingGitHubExpenses(txnIds) {
  if (!txnIds.length) return new Set();

  const orFilters = txnIds.map(id => `description.ilike.%${id}%`).join(",");
  const { data, error } = await supabase
    .from("expenses")
    .select("description")
    .or(orFilters);

  if (error) throw error;

  const existing = new Set();
  for (const row of (data || [])) {
    for (const id of txnIds) {
      if (row.description && row.description.includes(id)) {
        existing.add(id);
      }
    }
  }
  return existing;
}

/**
 * Bulk-insert parsed GitHub billing entries as expenses.
 */
export async function bulkInsertGitHubExpenses(entries) {
  const rows = entries.map(e => ({
    expense_date: e.expense_date,
    category: "Software",
    description: `GitHub Copilot — ${e.id}`,
    amount_cents: e.amount_cents,
    vendor: "GitHub",
    notes: `Auto-imported from GitHub billing. ${e.payment_method}. Status: ${e.status}`,
    miles: null,
    mileage_rate: null,
  }));

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
