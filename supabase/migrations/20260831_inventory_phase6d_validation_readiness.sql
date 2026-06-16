-- 20260831_inventory_phase6d_validation_readiness.sql
--
-- Phase 6D-Validation — sharpen cutover readiness (historical vs active blockers).
-- Read-only view updates; no stock/reservation/webhook behavior changes.

ALTER TABLE public.inventory_cutover_settings
  ADD COLUMN IF NOT EXISTS shadow_mode_started_at timestamptz;

UPDATE public.inventory_cutover_settings
SET shadow_mode_started_at = COALESCE(shadow_mode_started_at, '2026-06-09 00:00:00+00'::timestamptz)
WHERE id = 1;

COMMENT ON COLUMN public.inventory_cutover_settings.shadow_mode_started_at IS
  'Phase 6C shadow reservation go-live timestamp. Orders/lines after this should produce shadow rows on checkout.';

-- ════════════════════════════════════════════════════════════════
-- v_inventory_cutover_active_blockers — explicit cutover blockers only
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_cutover_active_blockers AS
SELECT
  'missing_variant_paid_unshipped'::text AS blocker_type,
  'critical'::text AS severity,
  c.order_id,
  c.order_item_id,
  c.variant_id,
  c.product_label,
  c.quantity,
  c.paid_at,
  c.fulfillment_status,
  c.refund_status,
  'Paid/unshipped line lacks resolvable variant_id — cannot create active reservation at cutover.'::text AS description
FROM public.v_inventory_kk_paid_unshipped_reservation_candidates c
WHERE c.variant_id IS NULL
   OR c.backfill_action_needed = 'missing_variant'

UNION ALL

SELECT
  'partial_refund_paid_unshipped'::text,
  'high'::text,
  r.stripe_session_id,
  r.order_item_id,
  r.variant_id,
  r.product_label,
  r.ordered_quantity,
  r.order_created_at,
  r.fulfillment_status,
  r.refund_status,
  'Partial refund on unpaid/unshipped line — shadow release not implemented; manual review before cutover.'::text
FROM public.v_inventory_shadow_reservation_reconciliation r
WHERE r.mismatch_reason = 'partial_refund_not_handled_by_shadow'
  AND COALESCE(r.refund_status, '') = 'partial'
  AND COALESCE(r.fulfillment_status, 'pending') NOT IN (
    'shipped', 'delivered', 'cancelled', 'voided'
  )

UNION ALL

SELECT
  'shadow_without_ledger_post_6c'::text,
  'critical'::text,
  r.stripe_session_id,
  r.order_item_id,
  r.variant_id,
  r.product_label,
  r.ordered_quantity,
  r.order_created_at,
  r.fulfillment_status,
  r.refund_status,
  'Post-6C shadow reservation exists but no matching stock_ledger order deduction.'::text
FROM public.v_inventory_shadow_reservation_reconciliation r
CROSS JOIN public.inventory_cutover_settings s
WHERE r.mismatch_reason = 'shadow_without_ledger'
  AND r.shadow_created_at >= s.shadow_mode_started_at
  AND COALESCE(r.refund_status, '') <> 'full';

COMMENT ON VIEW public.v_inventory_cutover_active_blockers IS
  'Active cutover blockers only (paid/unshipped or post-6C). Historical fulfilled-order mismatches excluded.';

-- ════════════════════════════════════════════════════════════════
-- v_inventory_cutover_readiness_summary — historical vs active split
-- ════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_inventory_cutover_readiness_summary;

CREATE VIEW public.v_inventory_cutover_readiness_summary AS
WITH settings AS (
  SELECT kk_reservation_mode, shadow_mode_started_at
  FROM public.inventory_cutover_settings
  WHERE id = 1
),
recon AS (
  SELECT
    COUNT(*)::bigint AS total_kk_lines,
    COUNT(*) FILTER (WHERE is_match)::bigint AS matched_lines,
    COUNT(*) FILTER (WHERE is_match AND shadow_created_at IS NOT NULL)::bigint AS post_6c_matched_lines,
    COUNT(*) FILTER (WHERE NOT is_match)::bigint AS mismatched_lines,
    COUNT(*) FILTER (WHERE mismatch_reason = 'missing_variant')::bigint AS missing_variant_lines,
    COUNT(*) FILTER (WHERE mismatch_reason = 'ledger_without_shadow')::bigint AS ledger_without_shadow,
    COUNT(*) FILTER (
      WHERE mismatch_reason = 'ledger_without_shadow'
        AND stripe_session_id IN (
          SELECT order_id FROM public.v_inventory_kk_paid_unshipped_reservation_candidates
        )
    )::bigint AS paid_unshipped_ledger_without_shadow,
    COUNT(*) FILTER (
      WHERE mismatch_reason = 'ledger_without_shadow'
        AND stripe_session_id NOT IN (
          SELECT order_id FROM public.v_inventory_kk_paid_unshipped_reservation_candidates
        )
    )::bigint AS historical_ledger_without_shadow,
    COUNT(*) FILTER (WHERE mismatch_reason = 'shadow_without_ledger')::bigint AS shadow_without_ledger,
    COUNT(*) FILTER (WHERE mismatch_reason = 'no_ledger_no_shadow')::bigint AS no_ledger_no_shadow,
    COUNT(*) FILTER (WHERE mismatch_reason = 'partial_refund_not_handled_by_shadow')::bigint AS partial_refund_lines,
    COUNT(*) FILTER (
      WHERE mismatch_reason = 'partial_refund_not_handled_by_shadow'
        AND COALESCE(fulfillment_status, 'pending') NOT IN ('shipped', 'delivered', 'cancelled', 'voided')
        AND COALESCE(refund_status, '') = 'partial'
    )::bigint AS partial_refund_active_lines,
    COUNT(*) FILTER (WHERE mismatch_reason = 'shadow_released_on_full_refund')::bigint AS shadow_released_full_refund
  FROM public.v_inventory_shadow_reservation_reconciliation
),
candidates AS (
  SELECT
    COUNT(*)::bigint AS paid_unshipped_line_count,
    COUNT(DISTINCT order_id)::bigint AS paid_unshipped_order_count,
    COALESCE(SUM(quantity), 0)::bigint AS paid_unshipped_unit_total,
    COUNT(*) FILTER (WHERE backfill_action_needed = 'promote_shadow_at_cutover')::bigint AS promote_shadow_lines,
    COUNT(*) FILTER (WHERE backfill_action_needed = 'insert_active_reservation_and_backfill_stock')::bigint AS insert_and_backfill_lines,
    COUNT(*) FILTER (WHERE backfill_action_needed = 'missing_variant')::bigint AS candidate_missing_variant
  FROM public.v_inventory_kk_paid_unshipped_reservation_candidates
),
backfill AS (
  SELECT
    COUNT(*) FILTER (WHERE risk_flag = 'ok')::bigint AS variants_ok,
    COUNT(*) FILTER (WHERE risk_flag <> 'ok')::bigint AS variants_with_risk,
    COALESCE(SUM(paid_unshipped_qty), 0)::bigint AS total_backfill_units,
    COALESCE(SUM(proposed_on_hand_after_backfill - current_stock), 0)::bigint AS total_stock_increase_units
  FROM public.v_inventory_kk_cutover_backfill_dry_run
  WHERE paid_unshipped_qty > 0
),
shadow_kpi AS (
  SELECT shadow_reserved_units, shadow_released_units, shadow_reservation_rows
  FROM public.v_inventory_shadow_kpis
),
blockers AS (
  SELECT COUNT(*)::bigint AS active_cutover_blocker_count
  FROM public.v_inventory_cutover_active_blockers
)
SELECT
  s.kk_reservation_mode AS current_mode,
  s.shadow_mode_started_at,
  r.total_kk_lines,
  r.matched_lines,
  r.post_6c_matched_lines,
  r.mismatched_lines,
  r.missing_variant_lines,
  r.ledger_without_shadow,
  r.paid_unshipped_ledger_without_shadow,
  r.historical_ledger_without_shadow,
  r.shadow_without_ledger,
  r.no_ledger_no_shadow,
  r.partial_refund_lines,
  r.partial_refund_active_lines,
  r.shadow_released_full_refund,
  c.paid_unshipped_line_count,
  c.paid_unshipped_order_count,
  c.paid_unshipped_unit_total,
  c.promote_shadow_lines,
  c.insert_and_backfill_lines,
  c.candidate_missing_variant,
  b.variants_ok,
  b.variants_with_risk,
  b.total_backfill_units,
  b.total_stock_increase_units,
  sk.shadow_reservation_rows,
  sk.shadow_reserved_units,
  sk.shadow_released_units,
  blk.active_cutover_blocker_count,
  (
    r.no_ledger_no_shadow
    + r.historical_ledger_without_shadow
    + r.missing_variant_lines
    - c.candidate_missing_variant
    + GREATEST(r.partial_refund_lines - r.partial_refund_active_lines, 0)
  ) AS historical_warning_count,
  (r.post_6c_matched_lines < 1) AS requires_post_6c_checkout_validation,
  (
    r.post_6c_matched_lines >= 1
    AND blk.active_cutover_blocker_count = 0
    AND s.kk_reservation_mode = 'shadow'
  ) AS safe_to_proceed_hint,
  now() AS computed_at
FROM settings s
CROSS JOIN recon r
CROSS JOIN candidates c
CROSS JOIN backfill b
CROSS JOIN shadow_kpi sk
CROSS JOIN blockers blk;

COMMENT ON VIEW public.v_inventory_cutover_readiness_summary IS
  'KK cutover readiness. safe_to_proceed_hint requires >=1 post-6C matched checkout AND zero active blockers. Historical warnings do not block alone.';

GRANT SELECT ON public.v_inventory_cutover_active_blockers TO authenticated, service_role;
