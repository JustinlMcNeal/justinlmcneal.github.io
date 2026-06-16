-- 20260823_inventory_phase3a_read_views.sql
--
-- Phase 3A — read-only inventory KPI + recent ledger views for admin Inventory page.
-- No stock mutations, reservations, or order deduction logic.
--

-- ── Baseline stock_ledger (idempotent — prod may already have this table) ───────

CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid        NOT NULL,
  product_id    uuid        NOT NULL,
  change        integer     NOT NULL,
  reason        text        NOT NULL,
  reference_id  text,
  stock_before  integer,
  stock_after   integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_ledger
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_stock_ledger_variant_id
  ON public.stock_ledger (variant_id);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_created_at
  ON public.stock_ledger (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_reason
  ON public.stock_ledger (reason);

COMMENT ON TABLE public.stock_ledger IS
  'Audit trail for product_variants.stock changes (orders, refunds, parcel receive, future manual adjust).';

-- ── v_inventory_kpis — single-row aggregates for KPI cards ────────────────────

CREATE OR REPLACE VIEW public.v_inventory_kpis AS
WITH active_variants AS (
  SELECT pv.id, coalesce(pv.stock, 0) AS stock
  FROM public.product_variants pv
  WHERE coalesce(pv.is_active, true) = true
),
parcel_unmapped AS (
  SELECT count(*)::bigint AS cnt
  FROM public.parcel_import_item_mappings m
  JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
  WHERE pi.status = 'approved'
    AND pi.inventory_received_at IS NULL
    AND m.row_type = 'business_inventory'
    AND (
      m.mapping_status <> 'matched'
      OR m.product_variant_id IS NULL
    )
)
SELECT
  (SELECT count(*)::bigint FROM active_variants) AS total_skus,
  (SELECT coalesce(sum(stock), 0)::bigint FROM active_variants) AS on_hand_units,
  0::bigint AS reserved_units,
  (SELECT coalesce(sum(stock), 0)::bigint FROM active_variants) AS available_units,
  (
    SELECT count(*)::bigint
    FROM active_variants av
    WHERE av.stock > 0 AND av.stock <= 3
  ) AS low_stock,
  (SELECT cnt FROM parcel_unmapped) AS unmapped_lines,
  (
    SELECT count(*)::bigint
    FROM active_variants av
    WHERE av.stock < 0
  ) + (SELECT cnt FROM parcel_unmapped) AS inventory_issues,
  NULL::timestamptz AS last_channel_sync_at;

COMMENT ON VIEW public.v_inventory_kpis IS
  'Inventory admin KPI aggregates. reserved=0 until reservations table exists; last_channel_sync placeholder until Phase 7.';

-- ── v_inventory_ledger_recent — ledger rows joined to product/variant labels ──

CREATE OR REPLACE VIEW public.v_inventory_ledger_recent AS
SELECT
  sl.id,
  sl.created_at AS entry_time,
  coalesce(p.name, 'Unknown product') AS product_name,
  nullif(
    trim(
      coalesce(
        nullif(pv.title, ''),
        nullif(pv.option_value, ''),
        nullif(pv.sku, ''),
        ''
      )
    ),
    ''
  ) AS variant_label,
  sl.change,
  sl.reason,
  CASE sl.reason
    WHEN 'order' THEN 'KK Store'
    WHEN 'refund' THEN 'KK Store'
    WHEN 'parcel_receive' THEN 'Parcel Import'
    ELSE 'System'
  END AS source,
  sl.reference_id,
  sl.stock_before,
  sl.stock_after,
  sl.variant_id,
  sl.product_id
FROM public.stock_ledger sl
LEFT JOIN public.product_variants pv ON pv.id = sl.variant_id
LEFT JOIN public.products p ON p.id = sl.product_id;

COMMENT ON VIEW public.v_inventory_ledger_recent IS
  'Recent stock_ledger entries with product/variant labels for Inventory admin footer panel.';

GRANT SELECT ON public.v_inventory_kpis TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_ledger_recent TO authenticated, service_role;
