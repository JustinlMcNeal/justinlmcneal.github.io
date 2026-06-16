/**
 * Read-only Supabase API for Inventory admin (Phase 3A — KPI + ledger panels).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { mapWorkspaceRow } from "../services/mapWorkspaceRow.js";

/** @template T @param {Promise<T>} promise @param {number} ms @param {string} label @returns {Promise<T>} */
export function withFetchTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    }),
  ]);
}

/** @returns {Promise<import('@supabase/supabase-js').Session>} */
export async function requireAuthenticatedSession() {
  const sb = getSupabaseClient();
  const {
    data: { session },
    error,
  } = await sb.auth.getSession();

  if (error) throw new Error(`Session error: ${error.message}`);
  if (!session) {
    throw new Error("Admin session required. Log in to the admin area first.");
  }
  return session;
}

/**
 * @typedef {Object} InventoryKpiData
 * @property {number} totalSkus
 * @property {number} onHandUnits
 * @property {number} reservedUnits
 * @property {number} availableUnits
 * @property {number} lowStock
 * @property {number} unmappedLines
 * @property {number} inventoryIssues
 * @property {string} lastChannelSync
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {InventoryKpiData}
 */
export function mapKpiRow(row) {
  const lastSyncAt = row.last_channel_sync_at;
  let lastChannelSync = "Not wired";
  if (lastSyncAt) {
    const d = new Date(String(lastSyncAt));
    if (!Number.isNaN(d.getTime())) {
      lastChannelSync = d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  return {
    totalSkus: Number(row.total_skus ?? 0),
    onHandUnits: Number(row.on_hand_units ?? 0),
    reservedUnits: Number(row.reserved_units ?? 0),
    availableUnits: Number(row.available_units ?? 0),
    lowStock: Number(row.low_stock ?? 0),
    unmappedLines: Number(row.unmapped_lines ?? 0),
    inventoryIssues: Number(row.inventory_issues ?? 0),
    lastChannelSync,
  };
}

/** @returns {Promise<InventoryKpiData>} */
export async function fetchInventoryKpis() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb.from("v_inventory_kpis").select("*").maybeSingle();

  if (error) throw new Error(error.message || "Failed to load inventory KPIs");
  if (!data) throw new Error("Inventory KPI view returned no data");

  return mapKpiRow(data);
}

const REASON_LABELS = {
  order: "KK Paid Order",
  refund: "KK Refund",
  parcel_receive: "Parcel Receive",
  manual_adjustment: "Manual Adjustment",
};

/**
 * @param {Record<string, unknown>} row
 * @returns {import('../state.js').LedgerEntry}
 */
export function mapLedgerRow(row) {
  const change = Number(row.change ?? 0);
  const sign = change > 0 ? "+" : "";
  const variantLabel = row.variant_label ? String(row.variant_label) : "";
  const productName = String(row.product_name ?? "Unknown product");
  const product =
    variantLabel && variantLabel !== productName
      ? `${productName} · ${variantLabel}`
      : productName;

  const reasonKey = String(row.reason ?? "");
  const reason =
    REASON_LABELS[reasonKey] ||
    reasonKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: String(row.id ?? ""),
    time: row.entry_time ? String(row.entry_time) : "",
    product,
    change: `${sign}${change}`,
    reason,
    reasonKey,
    source: String(row.source ?? "System"),
    reference: row.reference_id ? String(row.reference_id) : "—",
  };
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<import('../state.js').LedgerEntry[]>}
 */
export async function fetchRecentLedgerEntries(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = opts.limit ?? 40;

  const { data, error } = await sb
    .from("v_inventory_ledger_recent")
    .select(
      "id, entry_time, product_name, variant_label, change, reason, source, reference_id",
    )
    .order("entry_time", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(error.message || "Failed to load stock ledger");

  return (data ?? []).map(mapLedgerRow);
}

const WORKSPACE_SELECT =
  "variant_id, product_id, product_title, variant_label, option_name, option_value, variant_sku, internal_sku, short_sku, image_url, on_hand, reserved, available, low_stock_threshold, kk_stock, ebay_stock, ebay_stock_source, ebay_stock_cached_at, ebay_stock_is_stale, ebay_stock_tooltip, amazon_stock, ebay_sku, ebay_listing_id, ebay_offer_id, ebay_listing_status, amazon_listing_id, amazon_asin, amazon_seller_sku, amazon_listing_status, status, has_issue, is_unmapped, sync_state, updated_at, issue_types";

/** @returns {Promise<import('../services/mapWorkspaceRow.js').InventoryRow[]>} */
export async function fetchInventoryWorkspace() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_workspace")
    .select(WORKSPACE_SELECT)
    .order("product_title", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message || "Failed to load inventory workspace");
  return (data ?? []).map(mapWorkspaceRow);
}

const ISSUE_LABELS = {
  negative_stock: "Negative Stock",
  low_stock: "Low Stock",
  missing_sku: "Missing SKU",
  ebay_mapping_missing: "eBay Mapping Missing",
  amazon_mapping_missing: "Amazon Mapping Missing",
  parcel_mapping_missing: "Parcel Mapping Missing",
  unmapped_order_line: "Unmapped Order Lines",
  ebay_listing_ended: "eBay Listing Ended",
  amazon_listing_inactive: "Amazon Listing Inactive",
  negative_available: "Negative Available",
  ebay_qty_cache_missing: "eBay Qty Cache Missing",
  ebay_unsupported_variation: "eBay Unsupported Variation",
  channel_sync_failed: "Channel Sync Failed",
  shipped_finalize_audit_needed: "Shipped Finalize Audit Needed",
  bundle_component_shortage: "Bundle Component Shortage (Preview)",
  bundle_rule_missing: "Bundle-Like SKU (Preview)",
  bundle_self_reference: "Bundle Self-Reference (Preview)",
  bundle_component_return_pending: "Bundle Component Return Pending",
  bundle_component_restock_manual_review: "Bundle Component Restock Review",
  bundle_component_over_restock_attempt: "Bundle Component Over-Restock Blocked",
  bundle_return_expected: "Bundle Return Expected",
  bundle_return_received_not_restocked: "Bundle Return Received — Restock Pending",
  bundle_return_manual_review: "Bundle Return Manual Review",
  refund_without_return_workflow: "Refund Without Return Workflow",
  partial_refund_return_review: "Partial Refund Return Review",
  refund_restock_review_needed: "Refund Restock Review Needed",
  marketplace_refund_review: "Marketplace Refund Review",
  marketplace_cancel_review: "Marketplace Cancel Review",
  afn_return_external_review: "AFN Return External Review",
  marketplace_restock_assist_ready: "Marketplace Restock Assist Ready",
  marketplace_observation_stale: "Marketplace Observation Stale",
  restock_channel_followup_needed: "Restock Channel Follow-Up Needed",
  returns_restock_dashboard_attention: "Returns & Restock Dashboard Attention",
};

/**
 * @param {Record<string, unknown>} row
 * @returns {import('../state.js').InventoryIssueRow}
 */
export function mapIssueRow(row) {
  const issueType = String(row.issue_type ?? "");
  return {
    id: String(row.issue_id ?? issueType),
    type: issueType,
    label: String(row.issue_label ?? ISSUE_LABELS[issueType] ?? issueType),
    severity: String(row.severity ?? "medium"),
    description: String(row.description ?? ""),
    affectedCount: Number(row.affected_count ?? 0),
    source: row.source ? String(row.source) : "",
    reference: row.reference ? String(row.reference) : "",
    workflowStatus: /** @type {import('../state.js').InventoryIssueRow['workflowStatus']} */ (
      String(row.workflow_status ?? "open")
    ),
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
    resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
    issueStateId: row.issue_state_id ? String(row.issue_state_id) : null,
    isActiveWorkflow: row.is_active_workflow !== false,
    isSnoozedActive: Boolean(row.is_snoozed_active),
  };
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {Map<string, { id: string, status: string, snoozedUntil: string|null, resolutionNote: string|null }>} stateByType
 * @returns {import('../state.js').InventoryIssueRow}
 */
function applyIssueWorkflowState(issue, stateByType) {
  const state = stateByType.get(issue.type);
  const workflowStatus = /** @type {import('../state.js').InventoryIssueRow['workflowStatus']} */ (
    state?.status ?? issue.workflowStatus ?? "open"
  );
  const snoozedUntil = state?.snoozedUntil ?? issue.snoozedUntil ?? null;
  const isSnoozedActive =
    workflowStatus === "snoozed" &&
    Boolean(snoozedUntil && new Date(snoozedUntil).getTime() > Date.now());
  const isActiveWorkflow =
    !["resolved", "ignored"].includes(workflowStatus) && !isSnoozedActive;

  return {
    ...issue,
    workflowStatus,
    snoozedUntil,
    resolutionNote: state?.resolutionNote ?? issue.resolutionNote ?? null,
    issueStateId: state?.id ?? issue.issueStateId ?? null,
    isActiveWorkflow,
    isSnoozedActive,
  };
}

/** @returns {Promise<import('../state.js').InventoryIssueRow[]>} */
export async function fetchInventoryIssues() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const [issuesRes, statesRes] = await Promise.all([
    sb
      .from("v_inventory_issues")
      .select(
        "issue_id, issue_type, issue_label, severity, description, affected_count, source, reference, updated_at",
      )
      .order("affected_count", { ascending: false }),
    sb
      .from("inventory_issue_states")
      .select("id, issue_type, status, snoozed_until, resolution_note")
      .like("issue_key", "group:%"),
  ]);

  if (issuesRes.error) {
    throw new Error(issuesRes.error.message || "Failed to load inventory issues");
  }

  /** @type {Map<string, { id: string, status: string, snoozedUntil: string|null, resolutionNote: string|null }>} */
  const stateByType = new Map();
  if (!statesRes.error) {
    for (const row of statesRes.data ?? []) {
      stateByType.set(String(row.issue_type ?? ""), {
        id: String(row.id ?? ""),
        status: String(row.status ?? "open"),
        snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
        resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
      });
    }
  }

  return (issuesRes.data ?? []).map((row) =>
    applyIssueWorkflowState(mapIssueRow(row), stateByType),
  );
}

// Extended issue snapshots refresh ONLY via pg_cron (refresh_inventory_issue_snapshots)
// or service-role CLI — never from browser JS (pool exhaustion risk). See Phase 10Y pool safety doc.

/** @returns {Promise<string|null>} ISO timestamp of last extended snapshot refresh */
export async function fetchIssueSnapshotRefreshedAt() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("inventory_issue_snapshots")
    .select("refreshed_at")
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.refreshed_at) return null;
  return String(data.refreshed_at);
}
