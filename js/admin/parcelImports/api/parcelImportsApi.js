/** Supabase RPC client for Parcel Imports (Phase 6A/6B/7). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const HISTORY_SELECT =
  "id, parcel_id, status, imported_at, xls_total_items, actual_total_charge_cny, products_affected_count, rows_needing_mapping_count, expense_id, inventory_received_at, source_file_name, file_hash, xls_charged_weight_grams, usd_equivalent";

/** @returns {Promise<import('@supabase/supabase-js').Session>} */
export async function requireAuthenticatedSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw new Error(`Session error: ${error.message}`);
  if (!session) {
    throw new Error("Admin session required. Log in to the admin area first.");
  }
  return session;
}

/** @param {object} payload */
export async function saveParcelImportDraft(payload) {
  await requireAuthenticatedSession();

  const { data, error } = await supabase.rpc("save_parcel_import_draft", {
    payload,
  });

  if (error) throw new Error(error.message || "Save draft failed");
  return data;
}

/** @param {string} importId */
export async function fetchImportSmokeCounts(importId) {
  await requireAuthenticatedSession();

  const [itemsRes, allocsRes, eventsRes] = await Promise.all([
    supabase
      .from("parcel_import_items")
      .select("id", { count: "exact", head: true })
      .eq("parcel_import_id", importId),
    supabase
      .from("parcel_import_cost_allocations")
      .select("id", { count: "exact", head: true })
      .eq("parcel_import_id", importId)
      .eq("allocation_run_type", "preview"),
    supabase
      .from("parcel_import_events")
      .select("event_type, created_at")
      .eq("parcel_import_id", importId)
      .order("created_at", { ascending: true }),
  ]);

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (allocsRes.error) throw new Error(allocsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  return {
    itemCount: itemsRes.count ?? 0,
    allocationCount: allocsRes.count ?? 0,
    events: eventsRes.data ?? [],
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {{ limit?: number, status?: string, search?: string, importId?: string, offset?: number }} [opts] */
export async function listParcelImports(opts = {}) {
  await requireAuthenticatedSession();

  const { limit = 25, status, search, importId, offset = 0 } = opts;

  if (importId) {
    const { data, error } = await supabase
      .from("parcel_imports")
      .select(HISTORY_SELECT)
      .eq("id", importId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? [data] : [];
  }

  let query = supabase
    .from("parcel_imports")
    .select(HISTORY_SELECT)
    .order("imported_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const term = search?.trim();
  if (term) {
    if (UUID_RE.test(term)) {
      query = query.eq("id", term);
    } else {
      query = query.or(
        `parcel_id.ilike.%${term}%,source_file_name.ilike.%${term}%`,
      );
    }
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** @param {{ parcelId?: string, fileHash?: string, currentImportId?: string | null }} params */
export async function checkDuplicateParcelImport({
  parcelId,
  fileHash,
  currentImportId,
}) {
  await requireAuthenticatedSession();

  const duplicateSelect =
    "id, parcel_id, source_file_name, imported_at, status, file_hash";
  const result = {
    fileHashMatches: [],
    parcelIdMatches: [],
    hasFileHashDuplicate: false,
    hasParcelIdDuplicate: false,
  };

  if (fileHash) {
    let query = supabase
      .from("parcel_imports")
      .select(duplicateSelect)
      .eq("file_hash", fileHash);
    if (currentImportId) query = query.neq("id", currentImportId);
    const { data, error } = await query.limit(5);
    if (error) throw new Error(error.message);
    result.fileHashMatches = data ?? [];
    result.hasFileHashDuplicate = result.fileHashMatches.length > 0;
  }

  if (parcelId) {
    let query = supabase
      .from("parcel_imports")
      .select(duplicateSelect)
      .eq("parcel_id", parcelId);
    if (currentImportId) query = query.neq("id", currentImportId);
    const { data, error } = await query.limit(5);
    if (error) throw new Error(error.message);
    result.parcelIdMatches = data ?? [];
    result.hasParcelIdDuplicate = result.parcelIdMatches.length > 0;
  }

  return result;
}

/** @param {string} importId */
export async function fetchParcelImportHeader(importId) {
  await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from("parcel_imports")
    .select("*")
    .eq("id", importId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Import not found");
  return data;
}

/** @param {string} importId */
export async function fetchParcelImportItems(importId) {
  await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from("parcel_import_items")
    .select("*")
    .eq("parcel_import_id", importId)
    .order("row_number", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** @param {string} importId */
export async function fetchParcelImportMappings(importId) {
  await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from("parcel_import_item_mappings")
    .select(
      "parcel_import_item_id, row_type, mapping_status, mapped_product_label, mapped_variant_label, product_id, product_variant_id, mapping_source, notes",
    )
    .eq("parcel_import_id", importId);

  if (error) throw new Error(error.message);
  return data ?? [];
}
