/** Expense create/link for approved parcel imports (Phase 9). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import {
  fetchParcelImportHeader,
  requireAuthenticatedSession,
} from "./parcelImportsApi.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** @param {object} header */
export function computeParcelExpenseAmountCents(header) {
  const usd = header.usd_equivalent;
  if (usd != null && Number(usd) > 0) {
    return Math.round(Number(usd) * 100);
  }

  const cny = header.actual_total_charge_cny;
  const fx = header.effective_fx_rate;
  if (cny != null && Number(cny) > 0 && fx != null && Number(fx) > 0) {
    return Math.round((Number(cny) / Number(fx)) * 100);
  }

  return null;
}

/** @param {object} header @param {string} importId */
function buildExpenseInsertRow(header, importId) {
  const amount_cents = computeParcelExpenseAmountCents(header);
  if (!amount_cents || amount_cents <= 0) {
    throw new Error("Add FX/USD amount before creating expense.");
  }

  const parcelId = header.parcel_id || "unknown";
  const itemCount = header.xls_total_items ?? 0;
  const importedAt = header.imported_at
    ? String(header.imported_at).slice(0, 10)
    : null;
  const approvedAt = header.approved_at
    ? String(header.approved_at).slice(0, 10)
    : null;

  return {
    expense_date: approvedAt || importedAt || new Date().toISOString().slice(0, 10),
    category: "Inventory",
    description: `Baestao Parcel ${parcelId} — ${itemCount} items`,
    amount_cents,
    vendor: "Baestao",
    notes: [
      `parcel_id: ${parcelId}`,
      `source_file_name: ${header.source_file_name || "—"}`,
      `actual_total_charge_cny: ${header.actual_total_charge_cny ?? "—"}`,
      `effective_fx_rate: ${header.effective_fx_rate ?? "—"}`,
      `parcel_import_id: ${importId}`,
    ].join("\n"),
  };
}

/**
 * @param {string} importId
 * @param {object} payload
 * @param {import('@supabase/supabase-js').Session} session
 */
async function insertExpenseLinkedEvent(importId, payload, session) {
  const { error } = await supabase.from("parcel_import_events").insert({
    parcel_import_id: importId,
    event_type: "expense_linked",
    event_message: "Expense linked to parcel import",
    event_payload: payload,
    actor_id: session.user?.id ?? null,
  });

  if (error) throw new Error(error.message);
}

/** @param {string} expenseId */
export async function getLinkedExpense(expenseId) {
  await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from("expenses")
    .select("id, expense_date, category, description, amount_cents, vendor, notes")
    .eq("id", expenseId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Expense not found");
  return data;
}

/** @param {number} [limit] */
export async function searchRecentInventoryExpenses(limit = 8) {
  await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from("expenses")
    .select("id, description, amount_cents, expense_date, vendor")
    .eq("category", "Inventory")
    .order("expense_date", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** @param {string} importId */
export async function createExpenseFromParcelImport(importId) {
  const session = await requireAuthenticatedSession();
  const header = await fetchParcelImportHeader(importId);

  if (header.status !== "approved") {
    throw new Error("Approve the import before linking expense.");
  }
  if (header.expense_id) {
    throw new Error("Expense already linked.");
  }

  const expenseRow = buildExpenseInsertRow(header, importId);

  const { data: expense, error: insertErr } = await supabase
    .from("expenses")
    .insert(expenseRow)
    .select("id, amount_cents, description, expense_date, vendor, category")
    .single();

  if (insertErr) throw new Error(insertErr.message);

  const { data: updated, error: linkErr } = await supabase
    .from("parcel_imports")
    .update({ expense_id: expense.id })
    .eq("id", importId)
    .is("expense_id", null)
    .select("id, expense_id")
    .maybeSingle();

  if (linkErr) throw new Error(linkErr.message);
  if (!updated?.expense_id) {
    throw new Error("Expense already linked.");
  }

  await insertExpenseLinkedEvent(
    importId,
    {
      expense_id: expense.id,
      amount_cents: expense.amount_cents,
      source: "created",
    },
    session,
  );

  return { expense, importId };
}

/**
 * @param {string} importId
 * @param {string} expenseId
 */
export async function linkExpenseToParcelImport(importId, expenseId) {
  const session = await requireAuthenticatedSession();
  const trimmedId = String(expenseId || "").trim();
  if (!trimmedId) throw new Error("Expense ID is required.");

  const header = await fetchParcelImportHeader(importId);
  if (header.status !== "approved") {
    throw new Error("Approve the import before linking expense.");
  }
  if (header.expense_id) {
    throw new Error("Expense already linked.");
  }

  const expense = await getLinkedExpense(trimmedId);

  const { data: conflict } = await supabase
    .from("parcel_imports")
    .select("id, parcel_id")
    .eq("expense_id", trimmedId)
    .neq("id", importId)
    .maybeSingle();

  if (conflict) {
    throw new Error("Expense already linked to another parcel import.");
  }

  const { data: updated, error: linkErr } = await supabase
    .from("parcel_imports")
    .update({ expense_id: trimmedId })
    .eq("id", importId)
    .is("expense_id", null)
    .select("id, expense_id")
    .maybeSingle();

  if (linkErr) throw new Error(linkErr.message);
  if (!updated?.expense_id) {
    throw new Error("Expense already linked.");
  }

  await insertExpenseLinkedEvent(
    importId,
    {
      expense_id: expense.id,
      amount_cents: expense.amount_cents,
      source: "linked_existing",
    },
    session,
  );

  return { expense, importId };
}

/** @param {string} importId */
export async function unlinkExpenseFromParcelImport(importId) {
  const session = await requireAuthenticatedSession();
  const header = await fetchParcelImportHeader(importId);

  if (!header.expense_id) {
    throw new Error("No expense linked.");
  }

  const previousExpenseId = header.expense_id;

  const { error } = await supabase
    .from("parcel_imports")
    .update({ expense_id: null })
    .eq("id", importId)
    .eq("expense_id", previousExpenseId);

  if (error) throw new Error(error.message);

  await supabase.from("parcel_import_events").insert({
    parcel_import_id: importId,
    event_type: "expense_unlinked",
    event_message: "Expense unlinked from parcel import",
    event_payload: { expense_id: previousExpenseId },
    actor_id: session.user?.id ?? null,
  });

  return { importId, previousExpenseId };
}
