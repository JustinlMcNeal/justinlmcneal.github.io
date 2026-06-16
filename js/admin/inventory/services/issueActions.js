/**
 * Issue type → action route matrix (Phase 8A).
 * Read-only routing helpers; no automatic resolution.
 */

import { PARCEL_MAPPING_URL } from "../constants/parcelLinks.js";
import { UNMAPPED_ORDER_LINES_URL } from "../constants/orderLinks.js";
import {
  AMAZON_LISTINGS_PAGE,
  EBAY_LISTINGS_PAGE,
  PRODUCTS_PAGE,
} from "../constants/channelLinks.js";

/**
 * @typedef {'critical'|'high'|'medium'|'low'} IssueSeverity
 * @typedef {'open_inventory_row'|'open_parcel_imports'|'open_order_lines'|'open_amazon_admin'|'open_ebay_admin'|'open_relist_assist'|'open_manual_adjustment'|'refresh_ebay_cache'|'refresh_marketplace_observations'|'open_sync_modal'|'open_products_admin'|'open_shipped_audit_modal'|'open_bundle_preview'|'open_restock_assist_queue'|'open_restock_followup_audit'|'no_action'|'open_detail'} IssueActionType
 *
 * @typedef {Object} IssueActionButton
 * @property {string} label
 * @property {IssueActionType} type
 * @property {string} [url]
 * @property {boolean} implemented
 * @property {boolean} safe
 *
 * @typedef {Object} IssueActionDef
 * @property {string} label
 * @property {string} description
 * @property {string} rootCause
 * @property {IssueSeverity} severity
 * @property {string} source
 * @property {'variant'|'product'|'order_line'|'parcel_row'|'sync_run'|'channel_listing'} objectType
 * @property {boolean} autoResolvable
 * @property {IssueActionButton} primary
 * @property {IssueActionButton|null} [secondary]
 * @property {{ tab?: string, issueType?: string, inventoryState?: string }} [tableFilter]
 */

/** @type {Record<string, IssueActionDef>} */
export const ISSUE_ACTIONS = {
  unmapped_order_line: {
    label: "Unmapped Order Lines",
    description: "Paid order lines without a KK variant mapping cannot reserve inventory.",
    rootCause: "Order import or manual order missing variant_id on line item.",
    severity: "high",
    source: "v_inventory_unmapped_order_lines",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Line Items Orders",
      type: "open_order_lines",
      url: UNMAPPED_ORDER_LINES_URL,
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
    tableFilter: { tab: "issues", issueType: "unmapped_order_line" },
  },
  negative_stock: {
    label: "Negative Stock",
    description: "On-hand quantity below zero — physical count may be wrong or oversold.",
    rootCause: "Fulfillment/refund timing, manual error, or unreserved oversell.",
    severity: "critical",
    source: "product_variants.stock",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Filter & Adjust",
      type: "open_manual_adjustment",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
    tableFilter: { tab: "issues", issueType: "negative_stock", inventoryState: "negative" },
  },
  negative_available: {
    label: "Negative Available",
    description: "Reserved quantity exceeds on-hand — storefront available is negative.",
    rootCause: "Reservations not released or on-hand lowered below reserved total.",
    severity: "critical",
    source: "v_inventory_channel_sync_candidates",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Filter Inventory",
      type: "open_inventory_row",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
    tableFilter: { tab: "issues", inventoryState: "negative_available" },
  },
  low_stock: {
    label: "Low Stock",
    description: "Active variants at or below the low-stock threshold (1–3 units).",
    rootCause: "Normal depletion or delayed replenishment.",
    severity: "medium",
    source: "product_variants",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "View Low Stock",
      type: "open_inventory_row",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
    tableFilter: { tab: "lowStock" },
  },
  missing_sku: {
    label: "Missing SKU",
    description: "Variants without an internal SKU or product code — harder to map orders and channels.",
    rootCause: "Product setup incomplete.",
    severity: "high",
    source: "product_variants",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Products",
      type: "open_products_admin",
      url: PRODUCTS_PAGE,
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  parcel_mapping_missing: {
    label: "Parcel Mapping Missing",
    description: "Approved parcel rows not mapped to KK products — stock not received.",
    rootCause: "Parcel import item mapping incomplete before receive.",
    severity: "high",
    source: "parcel_import_item_mappings",
    objectType: "parcel_row",
    autoResolvable: false,
    primary: {
      label: "Open Parcel Imports",
      type: "open_parcel_imports",
      url: PARCEL_MAPPING_URL,
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  amazon_mapping_missing: {
    label: "Amazon Mapping Missing",
    description: "Product has Amazon listings but variant-level mapping is missing.",
    rootCause: "Amazon import mapped at product level only.",
    severity: "high",
    source: "amazon_listing_mappings",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Amazon Admin",
      type: "open_amazon_admin",
      url: AMAZON_LISTINGS_PAGE,
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  ebay_mapping_missing: {
    label: "eBay Mapping Missing",
    description: "eBay offer exists locally but listing id link is incomplete.",
    rootCause: "Offer created but publish/reconcile not finished.",
    severity: "high",
    source: "products",
    objectType: "product",
    autoResolvable: false,
    primary: {
      label: "Open eBay Listings",
      type: "open_ebay_admin",
      url: EBAY_LISTINGS_PAGE,
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  ebay_listing_ended: {
    label: "eBay Listing Ended",
    description: "eBay listing ended or out of stock — restock may require relist.",
    rootCause: "Qty zero auto-end or manual withdraw.",
    severity: "medium",
    source: "products.ebay_status",
    objectType: "product",
    autoResolvable: false,
    primary: {
      label: "Open Relist Assist",
      type: "open_relist_assist",
      implemented: true,
      safe: true,
    },
    secondary: { label: "Open eBay Listings", type: "open_ebay_admin", url: EBAY_LISTINGS_PAGE, implemented: true, safe: true },
  },
  ebay_qty_cache_missing: {
    label: "eBay Qty Cache Missing",
    description: "Active eBay listing but local quantity cache not populated.",
    rootCause: "Cache refresh not run since listing went active.",
    severity: "medium",
    source: "v_inventory_channel_sync_candidates",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Sync Channels",
      type: "refresh_ebay_cache",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  ebay_unsupported_variation: {
    label: "eBay Unsupported Variation",
    description: "Multi-variant eBay group listing needs per-SKU manual handling.",
    rootCause: "Variation group not supported by automated sync/relist.",
    severity: "medium",
    source: "v_inventory_channel_sync_candidates",
    objectType: "product",
    autoResolvable: false,
    primary: {
      label: "Open eBay Listings",
      type: "open_ebay_admin",
      url: EBAY_LISTINGS_PAGE,
      implemented: true,
      safe: true,
    },
    secondary: { label: "Manual Review", type: "no_action", implemented: true, safe: true },
  },
  amazon_listing_inactive: {
    label: "Amazon Listing Inactive",
    description: "Mapped Amazon listing inactive or not buyable.",
    rootCause: "Amazon suppression, incomplete listing, or AFN/FBM status change.",
    severity: "medium",
    source: "amazon_listings",
    objectType: "channel_listing",
    autoResolvable: false,
    primary: {
      label: "Open Amazon Admin",
      type: "open_amazon_admin",
      url: AMAZON_LISTINGS_PAGE,
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  channel_sync_failed: {
    label: "Channel Sync Failed",
    description: "Recent Amazon or eBay quantity sync attempts failed.",
    rootCause: "API error, stale mapping, ended listing, or env gate.",
    severity: "high",
    source: "inventory_channel_sync_results",
    objectType: "sync_run",
    autoResolvable: false,
    primary: {
      label: "Open Sync Channels",
      type: "open_sync_modal",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  shipped_finalize_audit_needed: {
    label: "Shipped Finalize Audit Needed",
    description:
      "Shipped or delivered mapped lines lack a finalized reservation or stock ledger accounting signal.",
    rootCause:
      "Historical marketplace shipment before reserve/finalize automation, or manual fulfillment without ledger.",
    severity: "high",
    source: "v_inventory_shipped_finalize_audit",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Shipped Audit",
      type: "open_shipped_audit_modal",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_component_shortage: {
    label: "Bundle Component Shortage (Preview)",
    description:
      "Preview only: a configured virtual bundle would have zero availability from components. Does not affect checkout or channel sync.",
    rootCause: "Component on-hand/reserved would not support virtual bundle sales at current BOM qty.",
    severity: "low",
    source: "v_inventory_bundle_summary_preview",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
    tableFilter: { tab: "issues", issueType: "bundle_component_shortage" },
  },
  bundle_rule_missing: {
    label: "Bundle-Like SKU (Preview)",
    description:
      "Preview only: pack/bundle/kit pattern detected. Defaults to Model A separate stocked SKU until virtual rules are configured.",
    rootCause: "Heuristic title/SKU pattern match without active virtual bundle rules.",
    severity: "low",
    source: "v_inventory_bundle_like_variants",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
    tableFilter: { tab: "issues", issueType: "bundle_rule_missing" },
  },
  bundle_self_reference: {
    label: "Bundle Self-Reference (Preview)",
    description:
      "Preview only: invalid bundle rule references itself. Fix before enabling live bundle deduction in Phase 10B.",
    rootCause: "bundle_variant_id equals component_variant_id in inventory_bundle_rules.",
    severity: "low",
    source: "inventory_bundle_rules",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_component_return_pending: {
    label: "Bundle Component Return Pending",
    description:
      "Finalized live bundle component lines are eligible for admin-confirmed component restock.",
    rootCause: "Physical return received or expected — component stock can be restored manually.",
    severity: "medium",
    source: "v_inventory_bundle_component_return_candidates",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_component_restock_manual_review: {
    label: "Bundle Component Restock Review",
    description:
      "Refunded or flagged finalized component lines need manual confirmation before restock.",
    rootCause: "Refund recorded but restock requires explicit admin action.",
    severity: "medium",
    source: "v_inventory_bundle_component_return_candidates",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_component_over_restock_attempt: {
    label: "Bundle Component Over-Restock Blocked",
    description: "A restock attempt exceeded the finalized component quantity.",
    rootCause: "Restock RPC rejected duplicate or excessive qty.",
    severity: "high",
    source: "inventory_bundle_live_issues",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_return_expected: {
    label: "Bundle Return Expected",
    description: "RMA/return workflow is open — physical return expected but not yet received.",
    rootCause: "Admin created return workflow awaiting inbound shipment.",
    severity: "medium",
    source: "inventory_return_workflow",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_return_received_not_restocked: {
    label: "Bundle Return Received — Restock Pending",
    description: "Return received and marked resellable — confirmed restock still required for stock change.",
    rootCause: "Workflow tracks physical return; stock unchanged until restock RPC.",
    severity: "medium",
    source: "inventory_return_workflow",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  bundle_return_manual_review: {
    label: "Bundle Return Manual Review",
    description: "Return workflow flagged damaged, missing, or needs manual review.",
    rootCause: "Condition or guidance requires admin decision before restock.",
    severity: "medium",
    source: "inventory_return_workflow",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  refund_without_return_workflow: {
    label: "Refund Without Return Workflow",
    description:
      "Full refund detected on a finalized live bundle component line but no return workflow exists yet.",
    rootCause: "Stripe refund recorded; physical return not tracked in RMA workflow.",
    severity: "medium",
    source: "order_refund_details",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  partial_refund_return_review: {
    label: "Partial Refund Return Review",
    description:
      "Partial refund on a finalized component line — refund amount alone does not prove returned quantity.",
    rootCause: "Order-level or uncertain line-level refund allocation.",
    severity: "medium",
    source: "order_refund_details",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  refund_restock_review_needed: {
    label: "Refund Restock Review Needed",
    description:
      "Refund context suggests reviewing restock — confirm physical return and resellable condition before restock RPC.",
    rootCause: "Full or line-confirmed refund with remaining restockable component qty.",
    severity: "medium",
    source: "order_refund_details",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  marketplace_refund_review: {
    label: "Marketplace Refund Review",
    description:
      "eBay or Amazon refund signal on a finalized component line — confirm physical return before restocking.",
    rootCause: "Marketplace order sync or finance data indicates refund; line-level certainty is limited.",
    severity: "medium",
    source: "v_inventory_marketplace_refund_observations",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  marketplace_cancel_review: {
    label: "Marketplace Cancel Review",
    description:
      "Marketplace cancellation detected — verify whether inventory shipped or needs restock review.",
    rootCause: "Order-level cancel signal from marketplace sync or fulfillment data.",
    severity: "medium",
    source: "v_inventory_marketplace_refund_observations",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  afn_return_external_review: {
    label: "AFN Return External Review",
    description:
      "Amazon AFN/FBA refund or return signal — local inventory restock requires manual review.",
    rootCause: "Fulfilled by Amazon order; physical return handled externally.",
    severity: "medium",
    source: "v_inventory_marketplace_refund_observations",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
    secondary: { label: "View Details", type: "open_detail", implemented: true, safe: true },
  },
  marketplace_restock_assist_ready: {
    label: "Marketplace Restock Assist Ready",
    description:
      "Line-confirmed marketplace observation with physical return confirmed — review in batch restock assist queue.",
    rootCause: "Marketplace finance/order line mapped with line_confirmed confidence.",
    severity: "medium",
    source: "v_inventory_marketplace_restock_assist_queue",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Restock Assist Queue",
      type: "open_restock_assist_queue",
      implemented: true,
      safe: true,
      initialBucket: "ready_to_restock",
    },
    secondary: {
      label: "Open Bundle Preview — Returns",
      type: "open_bundle_preview",
      implemented: true,
      safe: true,
    },
  },
  marketplace_observation_stale: {
    label: "Marketplace Observation Stale",
    description:
      "Marketplace refund/cancel observations are older than 48 hours — refresh before restock decisions.",
    rootCause: "Observation sync lag or missed post-sync refresh.",
    severity: "medium",
    source: "v_inventory_marketplace_restock_assist_queue",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Restock Assist Queue (Stale)",
      type: "open_restock_assist_queue",
      implemented: true,
      safe: true,
      initialBucket: "stale_observation",
    },
    secondary: {
      label: "Refresh Marketplace Observations",
      type: "refresh_marketplace_observations",
      implemented: true,
      safe: true,
    },
  },
  restock_channel_followup_needed: {
    label: "Restock Channel Follow-Up Needed",
    description:
      "Recent component restock may require marketplace quantity or live bundle availability review — informational only.",
    rootCause: "Confirmed restock with mapped marketplace listing or live virtual bundle.",
    severity: "low",
    source: "v_inventory_restock_followup_candidates",
    objectType: "variant",
    autoResolvable: false,
    primary: {
      label: "Open Sync Channels",
      type: "open_sync_modal",
      implemented: true,
      safe: true,
    },
    secondary: {
      label: "Open Restock Audit History",
      type: "open_restock_followup_audit",
      implemented: true,
      safe: true,
    },
  },
  returns_restock_dashboard_attention: {
    label: "Returns & Restock Dashboard Attention",
    description:
      "Unified returns/restock workbench has attention items — review returns, restock assist, and channel follow-ups.",
    rootCause: "Combined open returns, ready restock, stale observations, or channel follow-ups.",
    severity: "low",
    source: "v_inventory_returns_restock_dashboard_worklist",
    objectType: "order_line",
    autoResolvable: false,
    primary: {
      label: "Open Returns & Restock Dashboard",
      type: "open_returns_restock_dashboard",
      implemented: true,
      safe: true,
    },
    secondary: {
      label: "Open Restock Assist Queue",
      type: "open_restock_assist_queue",
      implemented: true,
      safe: true,
      initialBucket: "ready_to_restock",
    },
  },
};

/** @param {string} issueType @returns {IssueActionDef|null} */
export function getIssueActionDef(issueType) {
  return ISSUE_ACTIONS[issueType] ?? null;
}

/** @param {import('../state.js').InventoryIssueRow} issue */
export function getPrimaryActionForIssue(issue) {
  const def = getIssueActionDef(issue.type);
  if (def?.primary?.implemented) return def.primary;
  return {
    label: "Manual Review",
    type: "no_action",
    implemented: true,
    safe: true,
  };
}

/** @param {string} issueType */
export function getIssueTableFilter(issueType) {
  return getIssueActionDef(issueType)?.tableFilter ?? null;
}

/** Routes not yet wired to a destination. */
export const FUTURE_ISSUE_ROUTES = [];
