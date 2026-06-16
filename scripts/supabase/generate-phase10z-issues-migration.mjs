#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(
  join(ROOT, "supabase/migrations/20261015_inventory_phase10u_returns_restock_dashboard.sql"),
  "utf8",
);
const start = src.indexOf("CREATE OR REPLACE VIEW public.v_inventory_issues AS");
const viewSql = src.slice(start);

const oldBlock =
  /live_bundle_issue_counts AS \(\s*SELECT[\s\S]*?\n\)\s*\nSELECT issues\.issue_id/;

const newBlock = `live_issues_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE i.issue_type = 'bundle_component_reservation_failed')::bigint AS bundle_component_reservation_failed,
    COUNT(*) FILTER (WHERE i.issue_type = 'bundle_component_finalize_failed')::bigint AS bundle_component_finalize_failed,
    COUNT(*) FILTER (WHERE i.issue_type = 'bundle_component_over_restock_attempt')::bigint AS bundle_component_over_restock_attempt
  FROM public.inventory_bundle_live_issues i
  WHERE i.resolved_at IS NULL
),
return_candidates_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE c.suggested_action = 'eligible_restock')::bigint AS bundle_component_return_pending,
    COUNT(*) FILTER (WHERE c.suggested_action IN ('manual_review', 'refunded_no_return')
      AND c.quantity_available_to_restock > 0)::bigint AS bundle_component_restock_manual_review
  FROM public.v_inventory_bundle_component_return_candidates c
),
return_guidance_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE wg.workflow_id IS NOT NULL
      AND wg.workflow_status IN ('open', 'return_expected'))::bigint AS bundle_return_expected,
    COUNT(*) FILTER (WHERE wg.workflow_id IS NOT NULL
      AND wg.workflow_status IN ('received', 'partially_received', 'inspected')
      AND wg.workflow_condition = 'resellable'
      AND wg.max_restockable_qty > 0
      AND COALESCE(wg.workflow_quantity_received, 0) > COALESCE(wg.workflow_quantity_restocked, 0))::bigint AS bundle_return_received_not_restocked,
    COUNT(*) FILTER (WHERE wg.workflow_id IS NOT NULL
      AND (wg.workflow_condition IN ('damaged', 'missing')
        OR wg.workflow_next_action = 'manual_review'))::bigint AS bundle_return_manual_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'refund_without_return_workflow'
      AND wg.max_restockable_qty > 0)::bigint AS refund_without_return_workflow,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'partial_refund_detected'
      AND wg.max_restockable_qty > 0
      AND COALESCE(wg.refund_confidence, 'low') IN ('low', 'medium'))::bigint AS partial_refund_return_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'refund_restock_review_needed')::bigint AS refund_restock_review_needed,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'marketplace_refund_review'
      AND wg.max_restockable_qty > 0)::bigint AS marketplace_refund_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'cancellation_detected'
      AND wg.max_restockable_qty > 0)::bigint AS marketplace_cancel_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'afn_external_fulfillment_review'
      AND wg.max_restockable_qty > 0)::bigint AS afn_return_external_review,
    COUNT(*) FILTER (WHERE wg.max_restockable_qty > 0
      AND (
        wg.refund_guidance_status_resolved IN (
          'marketplace_refund_review', 'cancellation_detected', 'return_detected',
          'marketplace_restock_assist_ready'
        )
        OR wg.marketplace_observation_confidence IS NOT NULL
        OR COALESCE(wg.persisted_observation_count, 0) > 0
      )
      AND COALESCE(wg.latest_persisted_obs_at, wg.latest_marketplace_obs_at) < now() - interval '48 hours'
    )::bigint AS marketplace_observation_stale
  FROM public.v_inventory_bundle_component_return_workflow_guidance wg
),
live_bundle_issue_counts AS (
  SELECT
    blr.bundle_live_readiness_blocked,
    bls.bundle_component_shortage_live,
    lia.bundle_component_reservation_failed,
    lia.bundle_component_finalize_failed,
    rca.bundle_component_return_pending,
    rca.bundle_component_restock_manual_review,
    lia.bundle_component_over_restock_attempt,
    rga.bundle_return_expected,
    rga.bundle_return_received_not_restocked,
    rga.bundle_return_manual_review,
    rga.refund_without_return_workflow,
    rga.partial_refund_return_review,
    rga.refund_restock_review_needed,
    rga.marketplace_refund_review,
    rga.marketplace_cancel_review,
    rga.afn_return_external_review,
    mra.marketplace_restock_assist_ready,
    rga.marketplace_observation_stale,
    rf.restock_channel_followup_needed,
    COALESCE(rds.dashboard_attention_count, 0)::bigint AS returns_restock_dashboard_attention
  FROM return_guidance_agg rga
  CROSS JOIN live_issues_agg lia
  CROSS JOIN return_candidates_agg rca
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS bundle_live_readiness_blocked
    FROM public.inventory_bundle_variant_settings vs
    JOIN public.v_inventory_bundle_cutover_readiness r ON r.bundle_variant_id = vs.bundle_variant_id
    WHERE vs.mode = 'live_requested' AND NOT COALESCE(r.is_ready_for_live, false)
  ) blr
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS bundle_component_shortage_live
    FROM public.v_inventory_bundle_summary_preview s
    WHERE public.is_bundle_live_deduction_enabled(s.bundle_variant_id)
      AND COALESCE(s.virtual_bundle_available, 0) <= 0
  ) bls
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS marketplace_restock_assist_ready
    FROM public.v_inventory_marketplace_restock_assist_candidates ma
    WHERE ma.assist_status = 'eligible_line_confirmed'
  ) mra
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS restock_channel_followup_needed
    FROM public.v_inventory_restock_followup_candidates fc
    LEFT JOIN public.inventory_restock_followup_states fs ON fs.restock_action_id = fc.restock_action_id
    WHERE fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
      AND COALESCE(fs.status, 'open') = 'open'
      AND fc.restock_created_at > now() - interval '14 days'
  ) rf
  CROSS JOIN LATERAL (
    SELECT dashboard_attention_count
    FROM public.v_inventory_returns_restock_dashboard_summary
  ) rds
)
SELECT issues.issue_id`;

if (!oldBlock.test(viewSql)) throw new Error("live_bundle_issue_counts block not found");

let patched = viewSql.replace(oldBlock, newBlock);
patched = patched.replace(
  "'Grouped inventory issues including returns/restock dashboard attention (Phase 10U).'",
  "'Grouped inventory issues including returns/restock dashboard attention (Phase 10U; 10Z scan consolidation).'",
);

const withState = `
CREATE OR REPLACE VIEW public.v_inventory_issues_with_state AS
SELECT
  i.issue_id,
  i.issue_type,
  i.issue_label,
  i.severity,
  i.description,
  i.affected_count,
  i.source,
  i.reference,
  i.updated_at,
  COALESCE(s.status, 'open'::text) AS workflow_status,
  s.snoozed_until,
  s.resolution_note,
  s.id AS issue_state_id,
  s.updated_at AS state_updated_at,
  (
    COALESCE(s.status, 'open') NOT IN ('resolved', 'ignored')
    AND NOT (
      COALESCE(s.status, 'open') = 'snoozed'
      AND s.snoozed_until IS NOT NULL
      AND s.snoozed_until > now()
    )
  ) AS is_active_workflow,
  (
    COALESCE(s.status, 'open') = 'snoozed'
    AND s.snoozed_until IS NOT NULL
    AND s.snoozed_until > now()
  ) AS is_snoozed_active
FROM public.v_inventory_issues i
LEFT JOIN public.inventory_issue_states s
  ON s.issue_key = ('group:' || i.issue_type);

GRANT SELECT ON public.v_inventory_issues_with_state TO authenticated, service_role;
`;

const out =
  "-- Phase 10Z — consolidate repeated scans in v_inventory_issues (fixes PostgREST 500/timeouts).\n\n" +
  patched +
  "\n" +
  withState;

writeFileSync(
  join(ROOT, "supabase/migrations/20261019_inventory_phase10z_optimize_issues_view.sql"),
  out,
);
console.log("Wrote migration", out.length, "bytes");
