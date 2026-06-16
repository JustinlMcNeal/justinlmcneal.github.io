-- 20260830_inventory_phase6d_prep_cutover_readiness.sql
--
-- Phase 6D-Prep — read-only KK cutover readiness views + settings placeholder.
-- No stock mutations, reservation writes, or webhook behavior changes.
--

-- ════════════════════════════════════════════════════════════════
-- inventory_cutover_settings — future feature flag (not read by webhook yet)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventory_cutover_settings (
  id                   smallint    PRIMARY KEY DEFAULT 1,
  kk_reservation_mode  text        NOT NULL DEFAULT 'shadow',
  notes                text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_cutover_settings_singleton CHECK (id = 1),
  CONSTRAINT inventory_cutover_settings_mode_check
    CHECK (kk_reservation_mode IN ('legacy_direct_deduct', 'shadow', 'reserve_only'))
);

COMMENT ON TABLE public.inventory_cutover_settings IS
  'Planned KK inventory mode flag. Phase 6D-Prep: shadow default; stripe-webhook reads in Phase 6D.';

INSERT INTO public.inventory_cutover_settings (id, kk_reservation_mode, notes)
VALUES (
  1,
  'shadow',
  'Phase 6D-Prep: direct stock deduct + shadow reservations. Webhook does not read this row until Phase 6D.'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.inventory_cutover_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inventory_cutover_settings'
      AND policyname = 'inventory_cutover_settings_authenticated_read'
  ) THEN
    CREATE POLICY inventory_cutover_settings_authenticated_read
      ON public.inventory_cutover_settings FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inventory_cutover_settings'
      AND policyname = 'inventory_cutover_settings_service_role_all'
  ) THEN
    CREATE POLICY inventory_cutover_settings_service_role_all
      ON public.inventory_cutover_settings FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON public.inventory_cutover_settings TO authenticated;
GRANT ALL ON public.inventory_cutover_settings TO service_role;

-- ════════════════════════════════════════════════════════════════
-- Shared: KK order lines with resolved variant_id
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_kk_order_lines_resolved AS
SELECT
  o.stripe_checkout_session_id,
  o.kk_order_id,
  o.order_date,
  o.refund_status,
  o.refund_amount_cents,
  o.refunded_at,
  fs.label_status AS fulfillment_status,
  li.stripe_line_item_id,
  li.product_id AS line_product_code,
  li.product_name,
  li.variant AS line_variant_text,
  li.variant_id AS line_variant_id,
  li.quantity AS ordered_quantity,
  COALESCE(
    li.variant_id,
    (
      SELECT pv2.id
      FROM public.product_variants pv2
      JOIN public.products p2 ON p2.id = pv2.product_id
      WHERE p2.code = li.product_id
        AND li.variant_id IS NULL
        AND li.product_id IS NOT NULL
        AND (
          (
            NULLIF(BTRIM(li.variant), '') IS NOT NULL
            AND lower(trim(pv2.option_value)) = lower(trim(li.variant))
          )
          OR (
            NULLIF(BTRIM(li.variant), '') IS NULL
            AND pv2.is_default = true
          )
        )
      ORDER BY pv2.is_default DESC, pv2.created_at ASC
      LIMIT 1
    )
  ) AS resolved_variant_id,
  (
    SELECT p3.id
    FROM public.products p3
    WHERE p3.code = li.product_id
    LIMIT 1
  ) AS resolved_product_id
FROM public.line_items_raw li
JOIN public.orders_raw o
  ON o.stripe_checkout_session_id = li.stripe_checkout_session_id
LEFT JOIN public.fulfillment_shipments fs
  ON fs.stripe_checkout_session_id = li.stripe_checkout_session_id
WHERE o.stripe_checkout_session_id NOT LIKE 'ebay%'
  AND o.stripe_checkout_session_id NOT LIKE 'amazon%';

COMMENT ON VIEW public.v_inventory_kk_order_lines_resolved IS
  'KK store order lines (excludes eBay/Amazon session prefixes) with variant_id resolved from line or product+option fallback.';

-- ════════════════════════════════════════════════════════════════
-- v_inventory_shadow_reservation_reconciliation
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_shadow_reservation_reconciliation AS
WITH kk_lines AS (
  SELECT * FROM public.v_inventory_kk_order_lines_resolved
),
ledger_order AS (
  SELECT
    kl.stripe_checkout_session_id,
    kl.stripe_line_item_id,
    kl.resolved_variant_id AS variant_id,
    COALESCE(SUM(ABS(sl.change)) FILTER (
      WHERE sl.reason = 'order' AND sl.change < 0
    ), 0)::integer AS ledger_deducted_qty
  FROM kk_lines kl
  LEFT JOIN public.stock_ledger sl
    ON sl.variant_id = kl.resolved_variant_id
   AND sl.reason = 'order'
   AND sl.change < 0
   AND (
     sl.reference_id = kl.stripe_checkout_session_id
     OR sl.reference_id = kl.kk_order_id
   )
  GROUP BY kl.stripe_checkout_session_id, kl.stripe_line_item_id, kl.resolved_variant_id
),
shadow AS (
  SELECT
    ir.order_id,
    ir.order_item_id,
    ir.variant_id,
    ir.quantity,
    ir.status,
    ir.is_shadow,
    ir.created_at AS shadow_created_at
  FROM public.inventory_reservations ir
  WHERE ir.channel = 'kk'
)
SELECT
  kl.stripe_checkout_session_id AS stripe_session_id,
  kl.kk_order_id,
  kl.stripe_line_item_id AS order_item_id,
  kl.resolved_variant_id AS variant_id,
  kl.resolved_product_id AS product_id,
  COALESCE(p.name, kl.product_name, 'Unknown') AS product_label,
  COALESCE(
    NULLIF(BTRIM(pv.title), ''),
    NULLIF(BTRIM(pv.option_value), ''),
    NULLIF(BTRIM(kl.line_variant_text), ''),
    'Default'
  ) AS variant_label,
  kl.ordered_quantity,
  lo.ledger_deducted_qty,
  sh.quantity AS shadow_reserved_quantity,
  sh.status AS shadow_status,
  sh.is_shadow,
  kl.refund_status,
  kl.fulfillment_status,
  kl.order_date AS order_created_at,
  sh.shadow_created_at,
  (
    kl.resolved_variant_id IS NOT NULL
    AND COALESCE(sh.quantity, 0) = kl.ordered_quantity
    AND COALESCE(lo.ledger_deducted_qty, 0) >= kl.ordered_quantity
    AND sh.status = 'reserved'
    AND COALESCE(sh.is_shadow, false) = true
    AND COALESCE(kl.refund_status, '') <> 'full'
  ) AS is_match,
  CASE
    WHEN kl.resolved_variant_id IS NULL THEN 'missing_variant'
    WHEN COALESCE(kl.refund_status, '') = 'full' AND sh.status = 'released' THEN 'shadow_released_on_full_refund'
    WHEN COALESCE(kl.refund_status, '') = 'full' AND sh.status = 'reserved' THEN 'full_refund_shadow_still_reserved'
    WHEN COALESCE(kl.refund_status, '') = 'partial' THEN 'partial_refund_not_handled_by_shadow'
    WHEN sh.order_item_id IS NULL AND lo.ledger_deducted_qty > 0 THEN 'ledger_without_shadow'
    WHEN sh.order_item_id IS NOT NULL AND lo.ledger_deducted_qty = 0 THEN 'shadow_without_ledger'
    WHEN sh.order_item_id IS NULL AND lo.ledger_deducted_qty = 0 THEN 'no_ledger_no_shadow'
    WHEN sh.quantity IS DISTINCT FROM kl.ordered_quantity THEN 'qty_mismatch'
    WHEN lo.ledger_deducted_qty > 0
      AND lo.ledger_deducted_qty <> kl.ordered_quantity
      THEN 'ledger_qty_mismatch'
    WHEN sh.status IS DISTINCT FROM 'reserved'
      AND COALESCE(kl.refund_status, '') <> 'full'
      THEN 'shadow_not_reserved'
    ELSE 'match'
  END AS mismatch_reason
FROM kk_lines kl
LEFT JOIN ledger_order lo
  ON lo.stripe_checkout_session_id = kl.stripe_checkout_session_id
 AND lo.stripe_line_item_id = kl.stripe_line_item_id
LEFT JOIN shadow sh
  ON sh.order_id = kl.stripe_checkout_session_id
 AND sh.order_item_id = kl.stripe_line_item_id
LEFT JOIN public.product_variants pv ON pv.id = kl.resolved_variant_id
LEFT JOIN public.products p ON p.id = kl.resolved_product_id;

COMMENT ON VIEW public.v_inventory_shadow_reservation_reconciliation IS
  'Line-level shadow vs stock_ledger order deduction reconciliation for KK orders. Ledger is variant+order scoped (may duplicate across lines sharing a variant).';

-- ════════════════════════════════════════════════════════════════
-- v_inventory_kk_paid_unshipped_reservation_candidates
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_kk_paid_unshipped_reservation_candidates AS
WITH kk_lines AS (
  SELECT * FROM public.v_inventory_kk_order_lines_resolved
),
reservations AS (
  SELECT
    ir.order_id,
    ir.order_item_id,
    ir.status,
    ir.is_shadow,
    ir.quantity
  FROM public.inventory_reservations ir
  WHERE ir.channel = 'kk'
)
SELECT
  kl.stripe_checkout_session_id AS order_id,
  kl.kk_order_id,
  kl.stripe_line_item_id AS order_item_id,
  kl.resolved_variant_id AS variant_id,
  kl.resolved_product_id AS product_id,
  COALESCE(p.name, kl.product_name, 'Unknown') AS product_label,
  COALESCE(
    NULLIF(BTRIM(pv.title), ''),
    NULLIF(BTRIM(pv.option_value), ''),
    NULLIF(BTRIM(kl.line_variant_text), ''),
    'Default'
  ) AS variant_label,
  kl.ordered_quantity AS quantity,
  kl.order_date AS paid_at,
  kl.fulfillment_status,
  kl.refund_status,
  EXISTS (
    SELECT 1
    FROM public.stock_ledger sl
    WHERE sl.variant_id = kl.resolved_variant_id
      AND sl.reason = 'order'
      AND sl.change < 0
      AND (
        sl.reference_id = kl.stripe_checkout_session_id
        OR sl.reference_id = kl.kk_order_id
      )
  ) AS stock_already_deducted,
  r.status AS reservation_status,
  r.is_shadow AS reservation_is_shadow,
  r.quantity AS reservation_quantity,
  CASE
    WHEN kl.resolved_variant_id IS NULL THEN 'missing_variant'
    WHEN r.order_item_id IS NOT NULL AND r.is_shadow = true AND r.status = 'reserved'
      THEN 'promote_shadow_at_cutover'
    WHEN r.order_item_id IS NOT NULL AND r.is_shadow = false AND r.status = 'reserved'
      THEN 'already_active_reserved'
    WHEN r.order_item_id IS NULL AND EXISTS (
      SELECT 1 FROM public.stock_ledger sl2
      WHERE sl2.variant_id = kl.resolved_variant_id
        AND sl2.reason = 'order'
        AND sl2.change < 0
        AND (sl2.reference_id = kl.stripe_checkout_session_id OR sl2.reference_id = kl.kk_order_id)
    ) THEN 'insert_active_reservation_and_backfill_stock'
    WHEN r.order_item_id IS NULL THEN 'insert_active_reservation_only'
    WHEN r.status IN ('released', 'canceled') THEN 'none_already_released'
    ELSE 'review_manually'
  END AS backfill_action_needed
FROM kk_lines kl
LEFT JOIN reservations r
  ON r.order_id = kl.stripe_checkout_session_id
 AND r.order_item_id = kl.stripe_line_item_id
LEFT JOIN public.product_variants pv ON pv.id = kl.resolved_variant_id
LEFT JOIN public.products p ON p.id = kl.resolved_product_id
WHERE COALESCE(kl.refund_status, '') <> 'full'
  AND COALESCE(kl.fulfillment_status, 'pending') NOT IN (
    'shipped', 'delivered', 'cancelled', 'voided'
  );

COMMENT ON VIEW public.v_inventory_kk_paid_unshipped_reservation_candidates IS
  'KK paid-but-not-shipped line items that should become active reservations at cutover. Excludes full refunds and shipped/voided/cancelled fulfillment.';

-- ════════════════════════════════════════════════════════════════
-- v_inventory_kk_cutover_backfill_dry_run — variant-level backfill math
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_kk_cutover_backfill_dry_run AS
WITH candidates AS (
  SELECT
    variant_id,
    SUM(quantity)::integer AS paid_unshipped_qty
  FROM public.v_inventory_kk_paid_unshipped_reservation_candidates
  WHERE variant_id IS NOT NULL
    AND backfill_action_needed NOT IN ('none_already_released', 'already_active_reserved', 'missing_variant')
  GROUP BY variant_id
),
shadow AS (
  SELECT
    ir.variant_id,
    COALESCE(SUM(ir.quantity) FILTER (
      WHERE ir.status = 'reserved' AND COALESCE(ir.is_shadow, false) = true
    ), 0)::integer AS shadow_reserved_qty,
    COALESCE(SUM(ir.quantity) FILTER (
      WHERE ir.status = 'reserved' AND COALESCE(ir.is_shadow, false) = false
    ), 0)::integer AS active_reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.channel = 'kk'
    AND ir.variant_id IS NOT NULL
  GROUP BY ir.variant_id
)
SELECT
  pv.id AS variant_id,
  p.id AS product_id,
  p.name AS product_label,
  COALESCE(
    NULLIF(BTRIM(pv.title), ''),
    NULLIF(BTRIM(pv.option_value), ''),
    NULLIF(BTRIM(pv.sku), ''),
    p.code
  ) AS variant_label,
  COALESCE(pv.stock, 0) AS current_stock,
  COALESCE(c.paid_unshipped_qty, 0) AS paid_unshipped_qty,
  COALESCE(s.shadow_reserved_qty, 0) AS shadow_reserved_qty,
  COALESCE(s.active_reserved_qty, 0) AS active_reserved_qty,
  COALESCE(pv.stock, 0) + COALESCE(c.paid_unshipped_qty, 0) AS proposed_on_hand_after_backfill,
  COALESCE(c.paid_unshipped_qty, 0) AS proposed_active_reserved_after_cutover,
  COALESCE(pv.stock, 0) AS proposed_available_after_cutover,
  CASE
    WHEN c.variant_id IS NULL THEN 'no_paid_unshipped'
    WHEN COALESCE(s.shadow_reserved_qty, 0) <> COALESCE(c.paid_unshipped_qty, 0)
      THEN 'shadow_candidate_qty_mismatch'
    WHEN COALESCE(s.active_reserved_qty, 0) > 0 THEN 'has_active_reservations_already'
    WHEN COALESCE(pv.stock, 0) + COALESCE(c.paid_unshipped_qty, 0) < 0 THEN 'negative_proposed_on_hand'
    ELSE 'ok'
  END AS risk_flag,
  CASE
    WHEN c.variant_id IS NULL THEN 'No paid/unshipped candidates for this variant.'
    ELSE format(
      'Backfill +%s units to stock; promote/insert %s active reservations. available stays %s.',
      COALESCE(c.paid_unshipped_qty, 0),
      COALESCE(c.paid_unshipped_qty, 0),
      COALESCE(pv.stock, 0)
    )
  END AS notes
FROM public.product_variants pv
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN candidates c ON c.variant_id = pv.id
LEFT JOIN shadow s ON s.variant_id = pv.id
WHERE COALESCE(pv.is_active, true) = true
  AND (
    c.variant_id IS NOT NULL
    OR COALESCE(s.shadow_reserved_qty, 0) > 0
    OR COALESCE(s.active_reserved_qty, 0) > 0
  );

COMMENT ON VIEW public.v_inventory_kk_cutover_backfill_dry_run IS
  'Dry-run only: proposed stock backfill (+paid_unshipped_qty) so on_hand reflects physical units after cutover. Does not mutate data.';

-- ════════════════════════════════════════════════════════════════
-- v_inventory_cutover_readiness_summary — single-row dashboard
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_cutover_readiness_summary AS
WITH recon AS (
  SELECT
    COUNT(*)::bigint AS total_kk_lines,
    COUNT(*) FILTER (WHERE is_match)::bigint AS matched_lines,
    COUNT(*) FILTER (WHERE NOT is_match)::bigint AS mismatched_lines,
    COUNT(*) FILTER (WHERE mismatch_reason = 'missing_variant')::bigint AS missing_variant_lines,
    COUNT(*) FILTER (WHERE mismatch_reason = 'ledger_without_shadow')::bigint AS ledger_without_shadow,
    COUNT(*) FILTER (WHERE mismatch_reason = 'shadow_without_ledger')::bigint AS shadow_without_ledger,
    COUNT(*) FILTER (WHERE mismatch_reason = 'no_ledger_no_shadow')::bigint AS no_ledger_no_shadow,
    COUNT(*) FILTER (WHERE mismatch_reason = 'partial_refund_not_handled_by_shadow')::bigint AS partial_refund_lines,
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
settings AS (
  SELECT kk_reservation_mode FROM public.inventory_cutover_settings WHERE id = 1
)
SELECT
  s.kk_reservation_mode AS current_mode,
  r.total_kk_lines,
  r.matched_lines,
  r.mismatched_lines,
  r.missing_variant_lines,
  r.ledger_without_shadow,
  r.shadow_without_ledger,
  r.no_ledger_no_shadow,
  r.partial_refund_lines,
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
  (
    c.candidate_missing_variant = 0
    AND b.variants_with_risk = 0
    AND r.ledger_without_shadow = 0
  ) AS safe_to_proceed_hint,
  now() AS computed_at
FROM settings s
CROSS JOIN recon r
CROSS JOIN candidates c
CROSS JOIN backfill b
CROSS JOIN shadow_kpi sk;

COMMENT ON VIEW public.v_inventory_cutover_readiness_summary IS
  'Single-row KK cutover readiness snapshot. safe_to_proceed_hint is advisory only — review reconciliation before Phase 6D.';

GRANT SELECT ON public.v_inventory_kk_order_lines_resolved TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_shadow_reservation_reconciliation TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_kk_paid_unshipped_reservation_candidates TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_kk_cutover_backfill_dry_run TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_cutover_readiness_summary TO authenticated, service_role;
