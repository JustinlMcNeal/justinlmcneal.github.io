// /js/admin/expenses/importInvoices.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Parse OpenAI billing table text.
 * Expected format (tab-separated, one invoice per line):
 *   FW0GGVST-0021	Paid	$10.00	Mar 15, 2026, 2:14 PM
 *
 * Returns array of { invoice, status, amount_cents, expense_date, raw }
 */
export function parseOpenAIInvoices(text) {
  const lines = text.trim().split(/\n/).map(l => l.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    // Skip header row
    if (/^invoice\s/i.test(line)) continue;
    if (/^showing invoices/i.test(line)) continue;

    // Split by tab (or 2+ spaces as fallback)
    const parts = line.includes("\t")
      ? line.split("\t").map(s => s.trim()).filter(Boolean)
      : line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

    if (parts.length < 4) continue;

    const invoice = parts[0];        // e.g. "FW0GGVST-0021"
    const status = parts[1];         // e.g. "Paid"
    const amountStr = parts[2];      // e.g. "$10.00"
    const dateStr = parts[3];        // e.g. "Mar 15, 2026, 2:14 PM"

    // Parse amount
    const dollars = parseFloat(amountStr.replace(/[^0-9.]/g, "")) || 0;
    const amount_cents = Math.round(dollars * 100);

    // Parse date → YYYY-MM-DD
    const expense_date = parseInvoiceDate(dateStr);

    if (amount_cents > 0 && expense_date) {
      results.push({ invoice, status, amount_cents, expense_date, raw: line });
    }
  }

  return results;
}

function parseInvoiceDate(str) {
  // "Mar 15, 2026, 2:14 PM" → extract just the date portion
  // Remove time portion after the year
  const match = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!match) return null;

  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };

  const m = months[match[1].toLowerCase().slice(0, 3)];
  const d = match[2].padStart(2, "0");
  const y = match[3];

  return m ? `${y}-${m}-${d}` : null;
}

/**
 * Check which invoice IDs already exist in the database.
 * Returns a Set of invoice strings that are already imported.
 */
export async function findExistingInvoices(invoiceIds) {
  if (!invoiceIds.length) return new Set();

  // Fetch expenses whose description contains any of these invoice IDs
  const orFilters = invoiceIds.map(id => `description.ilike.%${id}%`).join(",");
  const { data, error } = await supabase
    .from("expenses")
    .select("description")
    .or(orFilters);

  if (error) throw error;

  const existing = new Set();
  for (const row of (data || [])) {
    for (const id of invoiceIds) {
      if (row.description && row.description.includes(id)) {
        existing.add(id);
      }
    }
  }
  return existing;
}

/**
 * Bulk-insert parsed invoices as expenses.
 */
export async function bulkInsertInvoices(entries, vendor = "OpenAI") {
  const rows = entries.map(e => ({
    expense_date: e.expense_date,
    category: "Software",
    description: `${vendor} API — ${e.invoice}`,
    amount_cents: e.amount_cents,
    vendor,
    notes: `Auto-imported from ${vendor} billing. Status: ${e.status}`,
    miles: null,
    mileage_rate: null
  }));

  // Insert in chunks of 50
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
