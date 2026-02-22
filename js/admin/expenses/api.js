// /js/admin/expenses/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function normalizeSort(sortBy) {
  switch (sortBy) {
    case "date_asc":    return { col: "expense_date", asc: true };
    case "amount_desc": return { col: "amount_cents", asc: false };
    case "amount_asc":  return { col: "amount_cents", asc: true };
    case "category":    return { col: "category", asc: true };
    case "date_desc":
    default:            return { col: "expense_date", asc: false };
  }
}

/**
 * Fetch expenses list with search, category filter, sort, and pagination.
 */
export async function getExpensesList({ q = "", category = "", sortBy = "date_desc", limit = 50, offset = 0 } = {}) {
  const sort = normalizeSort(sortBy);

  let query = supabase
    .from("expenses")
    .select("*", { count: "exact" });

  if (q) {
    const like = `%${q}%`;
    query = query.or([
      `description.ilike.${like}`,
      `vendor.ilike.${like}`,
      `category.ilike.${like}`,
      `notes.ilike.${like}`
    ].join(","));
  }

  if (category) {
    query = query.eq("category", category);
  }

  query = query
    .order(sort.col, { ascending: sort.asc, nullsFirst: false })
    .order("created_at", { ascending: false })  // secondary sort
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return { rows: data || [], total: count ?? null };
}

/**
 * Insert or update an expense.
 */
export async function upsertExpense(payload) {
  const row = {
    expense_date: payload.expense_date || null,
    category: (payload.category || "").trim() || null,
    description: (payload.description || "").trim() || null,
    amount_cents: payload.amount_cents ?? 0,
    vendor: (payload.vendor || "").trim() || null,
    notes: (payload.notes || "").trim() || null
  };

  if (!row.expense_date) throw new Error("Date is required.");
  if (!row.category) throw new Error("Category is required.");
  if (!row.amount_cents || row.amount_cents <= 0) throw new Error("Amount must be greater than $0.");

  if (payload.id) {
    // Update
    const { error } = await supabase
      .from("expenses")
      .update(row)
      .eq("id", payload.id);
    if (error) throw error;
  } else {
    // Insert
    const { error } = await supabase
      .from("expenses")
      .insert(row);
    if (error) throw error;
  }
}

/**
 * Delete an expense by ID.
 */
export async function deleteExpense(id) {
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Fetch KPI aggregates (all-time total, this month, count, top category).
 */
export async function getExpenseKpis() {
  // Fetch all expenses (just the columns we need for KPIs)
  const { data, error } = await supabase
    .from("expenses")
    .select("amount_cents,expense_date,category");

  if (error) throw error;

  const rows = data || [];
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let totalCents = 0;
  let monthCents = 0;
  const catTotals = {};

  for (const r of rows) {
    const amt = r.amount_cents || 0;
    totalCents += amt;

    if (r.expense_date && r.expense_date.startsWith(thisMonth)) {
      monthCents += amt;
    }

    const cat = r.category || "Other";
    catTotals[cat] = (catTotals[cat] || 0) + amt;
  }

  // Find top category
  let topCategory = "—";
  let topAmount = 0;
  for (const [cat, total] of Object.entries(catTotals)) {
    if (total > topAmount) {
      topAmount = total;
      topCategory = cat;
    }
  }

  return {
    totalCents,
    monthCents,
    count: rows.length,
    topCategory
  };
}
