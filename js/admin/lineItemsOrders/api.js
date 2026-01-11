// /js/admin/lineItemsOrders/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ switched to the combined view that includes cost/profit columns
const SUMMARY = "v_order_summary_plus";
const SHIP = "fulfillment_shipments";

async function getSessionIdsByStatus(label_status) {
  if (!label_status) return null;
  const { data, error } = await supabase
    .from(SHIP)
    .select("stripe_checkout_session_id")
    .eq("label_status", label_status);

  if (error) throw error;
  return (data || []).map((r) => r.stripe_checkout_session_id).filter(Boolean);
}

async function getShipmentsMap(sessionIds) {
  if (!sessionIds?.length) return new Map();

  const { data, error } = await supabase
    .from(SHIP)
    .select(
      [
        "stripe_checkout_session_id",
        "kk_order_id",
        "label_status",
        "label_purchased_at",
        "shipped_at",
        "carrier",
        "service",
        "tracking_number",
        "pirate_ship_shipment_id",
        "package_weight_g_final",
        "notes",
        "batch_id",
        "printed_at",
        "label_cost_cents",
      ].join(",")
    )
    .in("stripe_checkout_session_id", sessionIds);

  if (error) throw error;

  const m = new Map();
  for (const row of data || []) m.set(row.stripe_checkout_session_id, row);
  return m;
}

function buildSearchOr(q) {
  const like = `%${q}%`;
  return [
    `kk_order_id.ilike.${like}`,
    `email.ilike.${like}`,
    `first_name.ilike.${like}`,
    `last_name.ilike.${like}`,
    `coupon_code_used.ilike.${like}`,
    `stripe_checkout_session_id.ilike.${like}`,
  ].join(",");
}

function applyDateRange(qb, dateFrom, dateTo) {
  if (dateFrom) qb = qb.gte("order_date", `${dateFrom}T00:00:00Z`);
  if (dateTo) qb = qb.lte("order_date", `${dateTo}T23:59:59Z`);
  return qb;
}

export async function fetchOrderSummaryPage({
  q = "",
  status = "",
  dateFrom = "",
  dateTo = "",
  limit = 25,
  offset = 0,
} = {}) {
  const Q = (q || "").trim();
  const L = Math.min(200, Math.max(5, Number(limit || 25)));
  const O = Math.max(0, Number(offset || 0));

  let statusSessionIds = null;
  if (status) {
    statusSessionIds = await getSessionIdsByStatus(status);
    if (!statusSessionIds.length) return { rows: [], totalCount: 0, hasMore: false };
  }

  let countQ = supabase.from(SUMMARY).select("*", { count: "exact", head: true });
  let dataQ = supabase.from(SUMMARY).select("*");

  if (Q) {
    const or = buildSearchOr(Q);
    countQ = countQ.or(or);
    dataQ = dataQ.or(or);
  }

  countQ = applyDateRange(countQ, dateFrom, dateTo);
  dataQ = applyDateRange(dataQ, dateFrom, dateTo);

  if (statusSessionIds) {
    countQ = countQ.in("stripe_checkout_session_id", statusSessionIds);
    dataQ = dataQ.in("stripe_checkout_session_id", statusSessionIds);
  }

  dataQ = dataQ.order("order_date", { ascending: false }).range(O, O + L - 1);

  const [{ count, error: countErr }, { data, error: dataErr }] = await Promise.all([countQ, dataQ]);
  if (countErr) throw countErr;
  if (dataErr) throw dataErr;

  const rows = data || [];
  const sessionIds = rows.map((r) => r.stripe_checkout_session_id).filter(Boolean);

  const shipMap = await getShipmentsMap(sessionIds);
  const merged = rows.map((r) => ({
    ...r,
    shipment: shipMap.get(r.stripe_checkout_session_id) || null,
  }));

  const totalCount = Number(count ?? 0);
  const hasMore = O + merged.length < totalCount;

  return { rows: merged, totalCount, hasMore };
}

export async function fetchOrderSummaryAllForExport(filters = {}) {
  const chunk = 500;
  let offset = 0;
  let all = [];

  while (true) {
    const { rows, hasMore } = await fetchOrderSummaryPage({ ...filters, limit: chunk, offset });
    all = all.concat(rows);
    if (!hasMore || rows.length === 0) break;
    offset += rows.length;
    if (all.length > 50000) break; // safety
  }
  return all;
}

/**
 * ✅ UPSERT into fulfillment_shipments (keyed by stripe_checkout_session_id).
 * Auto timestamps:
 * - if status becomes label_purchased and label_purchased_at is null -> set now
 * - if status becomes shipped and shipped_at is null -> set now
 */
export async function upsertFulfillmentShipment({
  stripe_checkout_session_id,
  kk_order_id,
  patch,
  previousShipment,
} = {}) {
  if (!stripe_checkout_session_id) throw new Error("Missing stripe_checkout_session_id");

  const nowIso = new Date().toISOString();

  const nextStatus = (patch.label_status ?? previousShipment?.label_status ?? "pending") || "pending";

  // auto timestamp rules
  const auto = {};
  if (nextStatus === "label_purchased" && !previousShipment?.label_purchased_at && !patch.label_purchased_at) {
    auto.label_purchased_at = nowIso;
  }
  if (nextStatus === "shipped" && !previousShipment?.shipped_at && !patch.shipped_at) {
    auto.shipped_at = nowIso;
  }

  const upsertRow = {
    stripe_checkout_session_id,
    kk_order_id: kk_order_id || previousShipment?.kk_order_id || null,
    ...patch,
    ...auto,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from(SHIP)
    .upsert(upsertRow, { onConflict: "stripe_checkout_session_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function fetchOrderKpis({ q = "", status = "", dateFrom = "", dateTo = "" } = {}) {
  const { data, error } = await supabase.rpc("rpc_order_kpis", {
    p_q: (q || "").trim() || null,
    p_status: (status || "").trim() || null,
    p_date_from: (dateFrom || "").trim() || null,
    p_date_to: (dateTo || "").trim() || null,
  });

  if (error) throw error;

  // RPC returns an array with 1 row in Supabase JS
  const row = Array.isArray(data) ? data[0] : data;
  return row || { orders_count: 0, revenue_cents: 0, profit_cents: 0, unfulfilled_count: 0 };
}

export async function importPirateShipExport({ batchId, rows } = {}) {
  if (!batchId) throw new Error("Missing batchId");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("No rows to import");

  const { data, error } = await supabase.rpc("rpc_import_pirateship_export", {
    p_batch_id: batchId,
    p_rows: rows,
  });

  if (error) throw error;

  // Supabase RPC returns array with one row
  const r = Array.isArray(data) ? data[0] : data;
  return r || { updated_count: 0, skipped_count: 0 };
}
