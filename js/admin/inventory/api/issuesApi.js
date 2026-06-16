/**
 * Issue samples + sync failure reads (Phase 8A — read-only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import {
  unmappedOrderLineKey,
  negativeStockKey,
  negativeAvailableKey,
  ebayQtyCacheMissingKey,
  ebayUnsupportedVariationKey,
  ebayListingEndedKey,
  channelSyncFailedKey,
  parcelMappingMissingKey,
  shippedFinalizeAuditKey,
} from "../services/issueKeys.js";

/**
 * @typedef {Object} IssueSampleRow
 * @property {string} label
 * @property {string} detail
 * @property {string} [ref]
 * @property {string} [bundleVariantId]
 * @property {string} [issueKey]
 * @property {string} [sourceChannel]
 * @property {string} [sourceOrderId]
 * @property {string} [sourceOrderItemId]
 * @property {boolean} [mappingAssistEligible]
 * @property {boolean} [manualFinalizeEligible]
 * @property {string} [guidanceStatus]
 * @property {number|null} [suggestedRestockQty]
 * @property {number|null} [maxRestockableQty]
 */

/**
 * @param {string} issueType
 * @param {number} [limit]
 * @returns {Promise<IssueSampleRow[]>}
 */
export async function fetchIssueSamples(issueType, limit = 8) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const cap = Math.min(Math.max(1, limit), 12);

  switch (issueType) {
    case "unmapped_order_line": {
      const { data, error } = await sb
        .from("v_inventory_unmapped_order_lines")
        .select("source_channel, source_order_id, source_order_item_id, title, quantity, reason, sku")
        .neq("reason", "afn_skip")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.title || r.source_order_item_id || "Order line"),
        detail: `${r.source_channel || "order"} · Qty ${r.quantity ?? "—"} · ${r.reason || "unmapped"}`,
        ref: String(r.source_order_id || ""),
        sourceChannel: String(r.source_channel || ""),
        sourceOrderId: String(r.source_order_id || ""),
        sourceOrderItemId: String(r.source_order_item_id || ""),
        mappingAssistEligible: true,
        issueKey: unmappedOrderLineKey(r.source_channel, r.source_order_id, r.source_order_item_id),
      }));
    }
    case "amazon_mapping_missing": {
      const { data, error } = await sb
        .from("v_inventory_mapping_suggestions")
        .select("source_order_item_id, source_sku, source_title, source_asin, source_listing_id, confidence, match_type")
        .eq("issue_type", "amazon_mapping_missing")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.source_title || r.source_sku || "Amazon variant gap"),
        detail: `${r.match_type || "gap"} · ${r.confidence || "—"} · ASIN ${r.source_asin || "—"}`,
        ref: String(r.source_order_item_id || ""),
        sourceOrderId: null,
        sourceOrderItemId: String(r.source_order_item_id || ""),
        mappingAssistEligible: true,
      }));
    }
    case "negative_stock": {
      const { data, error } = await sb
        .from("v_inventory_workspace")
        .select("variant_id, product_title, internal_sku, on_hand")
        .lt("on_hand", 0)
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.product_title || r.internal_sku || "Variant"),
        detail: `On hand: ${r.on_hand}`,
        ref: String(r.variant_id || ""),
        issueKey: negativeStockKey(r.variant_id),
      }));
    }
    case "negative_available": {
      const { data, error } = await sb
        .from("v_inventory_channel_sync_candidates")
        .select("internal_sku, product_label, available_qty, on_hand_qty, reserved_qty, variant_id")
        .lt("available_qty", 0)
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.internal_sku || r.product_label || "Variant"),
        detail: `Avail ${r.available_qty} (on ${r.on_hand_qty}, res ${r.reserved_qty})`,
        ref: String(r.internal_sku || ""),
        issueKey: negativeAvailableKey(r.variant_id || r.internal_sku),
      }));
    }
    case "ebay_qty_cache_missing":
    case "ebay_unsupported_variation": {
      const action = issueType === "ebay_qty_cache_missing" ? "qty_cache_missing" : "unsupported_variation";
      const { data, error } = await sb
        .from("v_inventory_channel_sync_candidates")
        .select("internal_sku, product_label, ebay_sync_action, ebay_listing_status, available_qty, variant_id, product_id")
        .eq("ebay_sync_action", action)
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.internal_sku || r.product_label || "SKU"),
        detail: `${r.ebay_sync_action} · avail ${r.available_qty ?? "—"}`,
        ref: String(r.internal_sku || ""),
        issueKey:
          issueType === "ebay_qty_cache_missing"
            ? ebayQtyCacheMissingKey(r.variant_id || r.internal_sku)
            : ebayUnsupportedVariationKey(r.product_id || r.internal_sku),
      }));
    }
    case "ebay_listing_ended": {
      const { data, error } = await sb
        .from("v_inventory_ebay_relist_candidates")
        .select("internal_sku, product_label, relist_action, available_qty, old_ebay_listing_id, product_id")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.internal_sku || r.product_label || "Listing"),
        detail: `${r.relist_action} · avail ${r.available_qty ?? 0}`,
        ref: String(r.old_ebay_listing_id || ""),
        issueKey: ebayListingEndedKey(r.product_id, r.old_ebay_listing_id),
      }));
    }
    case "channel_sync_failed": {
      return fetchRecentSyncFailures(cap);
    }
    case "parcel_mapping_missing": {
      const { data, error } = await sb
        .from("parcel_import_item_mappings")
        .select("id, parcel_import_id, row_type, mapping_status, product_variant_id")
        .neq("mapping_status", "matched")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: `Parcel row ${String(r.id || "").slice(0, 8)}`,
        detail: `${r.mapping_status || "unmapped"} · ${r.row_type || "row"}`,
        ref: String(r.parcel_import_id || ""),
        issueKey: parcelMappingMissingKey(r.parcel_import_id, r.id),
      }));
    }
    case "shipped_finalize_audit_needed": {
      const { data, error } = await sb
        .from("v_inventory_shipped_finalize_audit")
        .select(
          "source_channel, source_order_id, source_order_item_id, title, product_label, sku, quantity, suggested_audit_status, reason, variant_id, is_finalize_eligible",
        )
        .eq("needs_audit_issue", true)
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.title || r.product_label || r.source_order_item_id || "Shipped line"),
        detail: `${r.source_channel || "order"} · qty ${r.quantity ?? "—"} · ${r.suggested_audit_status || "audit"} · ${r.reason || ""}`,
        ref: String(r.source_order_id || ""),
        sourceChannel: String(r.source_channel || ""),
        sourceOrderId: String(r.source_order_id || ""),
        sourceOrderItemId: String(r.source_order_item_id || ""),
        manualFinalizeEligible: Boolean(r.is_finalize_eligible),
        issueKey: shippedFinalizeAuditKey(r.source_channel, r.source_order_id, r.source_order_item_id),
      }));
    }
    case "bundle_component_shortage": {
      const { data, error } = await sb
        .from("v_inventory_bundle_summary_preview")
        .select("bundle_variant_id, bundle_label, bundle_sku, virtual_bundle_available, preview_warning, current_model")
        .eq("current_model", "model_b_virtual_preview")
        .or("virtual_bundle_available.is.null,virtual_bundle_available.lte.0")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.bundle_label || r.bundle_sku || "Bundle"),
        detail: `Preview avail ${r.virtual_bundle_available ?? 0} · ${r.preview_warning || "component shortage"}`,
        ref: String(r.bundle_variant_id || ""),
        bundleVariantId: String(r.bundle_variant_id || ""),
      }));
    }
    case "bundle_rule_missing": {
      const { data, error } = await sb
        .from("v_inventory_bundle_like_variants")
        .select("variant_id, product_label, internal_sku, variant_label, detection_reason, on_hand")
        .eq("has_virtual_rules", false)
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: String(r.product_label || r.internal_sku || "Bundle-like SKU"),
        detail: `${r.detection_reason || "pattern"} · stock ${r.on_hand ?? 0} · Model A default`,
        ref: String(r.variant_id || ""),
        bundleVariantId: String(r.variant_id || ""),
      }));
    }
    case "bundle_self_reference": {
      const { data, error } = await sb
        .from("inventory_bundle_rules")
        .select("id, bundle_variant_id, component_variant_id")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || [])
        .filter((r) => r.bundle_variant_id === r.component_variant_id)
        .map((r) => ({
          label: `Rule ${String(r.id || "").slice(0, 8)}`,
          detail: "Self-reference — bundle equals component",
          ref: String(r.id || ""),
        }));
    }
    case "bundle_component_return_pending":
    case "bundle_component_restock_manual_review":
    case "bundle_return_expected":
    case "bundle_return_received_not_restocked":
    case "bundle_return_manual_review":
    case "refund_without_return_workflow":
    case "partial_refund_return_review":
    case "refund_restock_review_needed":
    case "marketplace_refund_review":
    case "marketplace_cancel_review":
    case "afn_return_external_review":
    case "marketplace_restock_assist_ready":
    case "marketplace_observation_stale": {
      let q = sb
        .from("v_inventory_bundle_component_return_workflow_guidance")
        .select(
          "reservation_id, parent_bundle_label, component_product_label, component_sku, source_order_id, source_order_item_id, parent_bundle_variant_id, guidance_status, guidance_reason, suggested_restock_qty, max_restockable_qty, refund_status, refunded_amount_cents, refund_guidance_status, refund_guidance_status_resolved, refund_confidence, refund_detail_count, latest_refund_at, suggested_panel_action, workflow_id, workflow_status, workflow_condition, workflow_next_action, workflow_rma_number, workflow_quantity_received, workflow_quantity_restocked, refund_source_channel, order_channel, is_amazon_afn, marketplace_observation_count, latest_marketplace_obs_at, persisted_observation_count, latest_persisted_obs_at, marketplace_sync_source, marketplace_assist_status, marketplace_assist_reason, marketplace_suggested_restock_qty, marketplace_observation_confidence",
        )
        .limit(cap);
      if (issueType === "bundle_component_return_pending") {
        q = q.in("guidance_status", ["restock_available", "full_refund_after_finalize"]).gt("max_restockable_qty", 0);
      } else if (issueType === "bundle_component_restock_manual_review") {
        q = q.eq("guidance_status", "partial_refund_review").gt("max_restockable_qty", 0);
      } else if (issueType === "bundle_return_expected") {
        q = q.not("workflow_id", "is", null).in("workflow_status", ["open", "return_expected"]);
      } else if (issueType === "bundle_return_received_not_restocked") {
        q = q
          .not("workflow_id", "is", null)
          .in("workflow_status", ["received", "partially_received", "inspected"])
          .eq("workflow_condition", "resellable")
          .gt("max_restockable_qty", 0);
      } else if (issueType === "refund_without_return_workflow") {
        q = q.eq("refund_guidance_status_resolved", "refund_without_return_workflow").gt("max_restockable_qty", 0);
      } else if (issueType === "partial_refund_return_review") {
        q = q
          .eq("refund_guidance_status_resolved", "partial_refund_detected")
          .gt("max_restockable_qty", 0)
          .in("refund_confidence", ["low", "medium"]);
      } else if (issueType === "refund_restock_review_needed") {
        q = q.eq("refund_guidance_status_resolved", "refund_restock_review_needed");
      } else if (issueType === "marketplace_refund_review") {
        q = q.eq("refund_guidance_status_resolved", "marketplace_refund_review").gt("max_restockable_qty", 0);
      } else if (issueType === "marketplace_cancel_review") {
        q = q.eq("refund_guidance_status_resolved", "cancellation_detected").gt("max_restockable_qty", 0);
      } else if (issueType === "afn_return_external_review") {
        q = q.eq("refund_guidance_status_resolved", "afn_external_fulfillment_review").gt("max_restockable_qty", 0);
      } else if (issueType === "marketplace_restock_assist_ready") {
        q = q.eq("marketplace_assist_status", "eligible_line_confirmed").gt("max_restockable_qty", 0);
      } else if (issueType === "marketplace_observation_stale") {
        q = q
          .gt("max_restockable_qty", 0)
          .or(
            "refund_guidance_status_resolved.in.(marketplace_refund_review,cancellation_detected,return_detected,marketplace_restock_assist_ready),marketplace_observation_confidence.not.is.null,persisted_observation_count.gt.0",
          )
          .lt("latest_persisted_obs_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
      } else if (issueType === "bundle_return_manual_review") {
        q = q.not("workflow_id", "is", null).or(
          "workflow_condition.in.(damaged,missing),workflow_next_action.eq.manual_review",
        );
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: `${r.parent_bundle_label || "Bundle"} → ${r.component_product_label || "Component"}`,
        detail: `${r.refund_guidance_status_resolved || r.refund_guidance_status || "no refund"} · ${r.workflow_status || "no workflow"} · ${r.workflow_next_action || r.guidance_status || "guidance"} · max ${r.max_restockable_qty ?? 0}${r.workflow_rma_number ? ` · RMA ${r.workflow_rma_number}` : ""} · ${r.guidance_reason || ""}`,
        ref: String(r.source_order_id || ""),
        sourceOrderId: String(r.source_order_id || ""),
        sourceOrderItemId: r.source_order_item_id ? String(r.source_order_item_id) : null,
        bundleVariantId: r.parent_bundle_variant_id ? String(r.parent_bundle_variant_id) : null,
        guidanceStatus: String(r.guidance_status || ""),
        workflowStatus: r.workflow_status ? String(r.workflow_status) : null,
        suggestedRestockQty: r.suggested_restock_qty == null ? null : Number(r.suggested_restock_qty),
        maxRestockableQty: r.max_restockable_qty == null ? null : Number(r.max_restockable_qty),
      }));
    }
    case "bundle_component_over_restock_attempt": {
      const { data, error } = await sb
        .from("inventory_bundle_live_issues")
        .select("order_id, order_item_id, bundle_variant_id, component_variant_id, details, created_at")
        .eq("issue_type", "bundle_component_over_restock_attempt")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        label: `Over-restock blocked · order ${String(r.order_id || "").slice(0, 16)}`,
        detail: JSON.stringify(r.details || {}),
        ref: String(r.order_id || ""),
        sourceOrderId: String(r.order_id || ""),
        sourceOrderItemId: r.order_item_id ? String(r.order_item_id) : null,
        bundleVariantId: r.bundle_variant_id ? String(r.bundle_variant_id) : null,
      }));
    }
    default: {
      const { data, error } = await sb
        .from("v_inventory_workspace")
        .select("variant_id, product_title, internal_sku, on_hand, available")
        .limit(cap);
      if (error) throw new Error(error.message);
      return (data || []).slice(0, 3).map((r) => ({
        label: String(r.product_title || r.internal_sku || "Variant"),
        detail: `On hand ${r.on_hand} · avail ${r.available}`,
        ref: String(r.variant_id || ""),
      }));
    }
  }
}

/**
 * @typedef {Object} SyncFailureRow
 * @property {string} channel
 * @property {string} sellerSku
 * @property {number|null} previousQty
 * @property {number|null} targetQty
 * @property {string} status
 * @property {string|null} errorMessage
 * @property {string} createdAt
 */

/** @param {number} [limit] @returns {Promise<IssueSampleRow[]>} */
export async function fetchRecentSyncFailures(limit = 8) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("inventory_channel_sync_results")
    .select("seller_sku, previous_qty, target_qty, status, error_message, created_at, run_id, action")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 12));

  if (error) throw new Error(error.message);

  const runIds = [...new Set((data || []).map((r) => r.run_id).filter(Boolean))];
  let runChannel = {};
  if (runIds.length) {
    const { data: runs } = await sb
      .from("inventory_channel_sync_runs")
      .select("id, channel, mode")
      .in("id", runIds);
    runChannel = Object.fromEntries((runs || []).map((r) => [r.id, r.channel]));
  }

  return (data || []).map((r) => ({
    label: String(r.seller_sku || "—"),
    detail: `${runChannel[r.run_id] || "channel"} ${r.action || "sync"} · ${r.error_message || "failed"}`,
    ref: String(r.run_id || ""),
    issueKey: channelSyncFailedKey(runChannel[r.run_id] || "unknown", r.run_id, r.seller_sku),
  }));
}

/** @param {number} [limit] @returns {Promise<SyncFailureRow[]>} */
export async function fetchRecentSyncFailureRows(limit = 6) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("inventory_channel_sync_results")
    .select("seller_sku, previous_qty, target_qty, status, error_message, created_at, run_id")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 12));

  if (error) throw new Error(error.message);

  const runIds = [...new Set((data || []).map((r) => r.run_id).filter(Boolean))];
  let runChannel = {};
  if (runIds.length) {
    const { data: runs } = await sb
      .from("inventory_channel_sync_runs")
      .select("id, channel")
      .in("id", runIds);
    runChannel = Object.fromEntries((runs || []).map((r) => [r.id, r.channel]));
  }

  return (data || []).map((r) => ({
    channel: String(runChannel[r.run_id] || "unknown"),
    sellerSku: String(r.seller_sku || "—"),
    previousQty: r.previous_qty,
    targetQty: r.target_qty,
    status: String(r.status),
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdAt: String(r.created_at || ""),
  }));
}
