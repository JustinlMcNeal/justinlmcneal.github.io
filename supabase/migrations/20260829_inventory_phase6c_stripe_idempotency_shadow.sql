-- 20260829_inventory_phase6c_stripe_idempotency_shadow.sql
--
-- Phase 6C — Stripe webhook idempotency + KK shadow reservations.
-- Adds inventory_event_dedup, is_shadow on inventory_reservations,
-- updates official views to exclude shadow rows, adds shadow audit views.
-- No stock semantics cutover (Stripe still deducts product_variants.stock directly).

-- ════════════════════════════════════════════════════════════════
-- inventory_event_dedup — guard stock-affecting Stripe webhook actions
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventory_event_dedup (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id  text        NOT NULL,
  action_type      text        NOT NULL,
  reference_id     text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_event_dedup_unique
    UNIQUE (stripe_event_id, action_type)
);

CREATE INDEX IF NOT EXISTS idx_inventory_event_dedup_reference
  ON public.inventory_event_dedup (reference_id);

COMMENT ON TABLE public.inventory_event_dedup IS
  'Idempotency guard for Stripe webhook stock mutations. One row per stripe_event_id + action_type.';

ALTER TABLE public.inventory_event_dedup ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'inventory_event_dedup'
      AND policyname = 'inventory_event_dedup_service_role_all'
  ) THEN
    CREATE POLICY inventory_event_dedup_service_role_all
      ON public.inventory_event_dedup FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.inventory_event_dedup TO service_role;

-- ════════════════════════════════════════════════════════════════
-- inventory_reservations.is_shadow — exclude from official reserved totals
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS is_shadow boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_reservations.is_shadow IS
  'True for Phase 6C KK shadow rows (parallel to direct stock deduct). Excluded from official reserved KPIs until Phase 6D cutover.';

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_is_shadow
  ON public.inventory_reservations (is_shadow)
  WHERE is_shadow = true;

-- ════════════════════════════════════════════════════════════════
-- Official views — reserved excludes is_shadow = true
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_kpis AS
WITH active_variants AS (
  SELECT pv.id, COALESCE(pv.stock, 0) AS stock
  FROM public.product_variants pv
  WHERE COALESCE(pv.is_active, true) = true
),
reserved_totals AS (
  SELECT COALESCE(SUM(ir.quantity), 0)::bigint AS units
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved'
    AND COALESCE(ir.is_shadow, false) = false
),
parcel_unmapped AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM public.parcel_import_item_mappings m
  JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
  WHERE pi.status = 'approved'
    AND pi.inventory_received_at IS NULL
    AND m.row_type = 'business_inventory'
    AND (
      m.mapping_status <> 'matched'
      OR m.product_variant_id IS NULL
    )
),
unmapped_order_lines AS (
  SELECT COUNT(*)::bigint AS cnt
  FROM public.v_inventory_unmapped_order_lines u
  WHERE u.reason <> 'afn_skip'
)
SELECT
  (SELECT COUNT(*)::bigint FROM active_variants) AS total_skus,
  (SELECT COALESCE(SUM(stock), 0)::bigint FROM active_variants) AS on_hand_units,
  (SELECT units FROM reserved_totals) AS reserved_units,
  (
    (SELECT COALESCE(SUM(stock), 0)::bigint FROM active_variants)
    - (SELECT units FROM reserved_totals)
  ) AS available_units,
  (
    SELECT COUNT(*)::bigint
    FROM active_variants av
    WHERE av.stock > 0 AND av.stock <= 3
  ) AS low_stock,
  (SELECT cnt FROM parcel_unmapped) AS unmapped_lines,
  (
    SELECT COUNT(*)::bigint
    FROM active_variants av
    WHERE av.stock < 0
  )
  + (SELECT cnt FROM parcel_unmapped)
  + (SELECT cnt FROM unmapped_order_lines) AS inventory_issues,
  NULL::timestamptz AS last_channel_sync_at;

COMMENT ON VIEW public.v_inventory_kpis IS
  'Official KPIs. reserved excludes is_shadow rows until Phase 6D cutover.';

CREATE OR REPLACE VIEW public.v_inventory_workspace AS
WITH ledger_latest AS (
  SELECT
    sl.variant_id,
    MAX(sl.created_at) AS last_ledger_at
  FROM public.stock_ledger sl
  GROUP BY sl.variant_id
),
variant_reserved AS (
  SELECT
    ir.variant_id,
    COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved'
    AND ir.variant_id IS NOT NULL
    AND COALESCE(ir.is_shadow, false) = false
  GROUP BY ir.variant_id
),
amazon_variant AS (
  SELECT DISTINCT ON (m.kk_variant_id)
    m.kk_variant_id,
    al.id AS amazon_listing_id,
    al.asin AS amazon_asin,
    al.seller_sku AS amazon_seller_sku,
    al.fbm_quantity AS amazon_stock,
    al.listing_status AS amazon_listing_status,
    al.listing_status_buyable AS amazon_listing_buyable,
    al.last_synced_at AS amazon_last_synced_at
  FROM public.amazon_listing_mappings m
  JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
  WHERE m.mapping_status = 'mapped'
    AND m.kk_variant_id IS NOT NULL
  ORDER BY m.kk_variant_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
product_amazon_mapped AS (
  SELECT DISTINCT kk_product_id AS product_id
  FROM public.amazon_listing_mappings
  WHERE mapping_status = 'mapped'
    AND kk_product_id IS NOT NULL
),
parcel_variant_unmapped AS (
  SELECT
    m.product_variant_id AS variant_id,
    COUNT(*)::bigint AS unmapped_parcel_rows
  FROM public.parcel_import_item_mappings m
  JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
  WHERE m.row_type = 'business_inventory'
    AND pi.status = 'approved'
    AND pi.inventory_received_at IS NULL
    AND m.product_variant_id IS NOT NULL
    AND (
      m.mapping_status <> 'matched'
      OR m.product_variant_id IS NULL
    )
  GROUP BY m.product_variant_id
),
variant_base AS (
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    p.name AS product_title,
    COALESCE(
      NULLIF(BTRIM(pv.title), ''),
      NULLIF(BTRIM(pv.option_value), ''),
      'Default'
    ) AS variant_label,
    NULLIF(BTRIM(pv.option_name), '') AS option_name,
    NULLIF(BTRIM(pv.option_value), '') AS option_value,
    NULLIF(BTRIM(pv.sku), '') AS variant_sku,
    p.code AS short_sku,
    COALESCE(
      NULLIF(BTRIM(pv.preview_image_url), ''),
      NULLIF(BTRIM(p.primary_image_url), ''),
      NULLIF(BTRIM(p.catalog_image_url), '')
    ) AS image_url,
    COALESCE(pv.stock, 0) AS on_hand,
    COALESCE(vr.reserved_qty, 0) AS reserved,
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS available,
    3::integer AS low_stock_threshold,
    COALESCE(pv.stock, 0) AS kk_stock,
    NULL::integer AS ebay_stock,
    av.amazon_stock,
    p.ebay_sku,
    p.ebay_listing_id,
    p.ebay_offer_id,
    COALESCE(p.ebay_status, 'not_listed') AS ebay_listing_status,
    av.amazon_listing_id,
    av.amazon_asin,
    av.amazon_seller_sku,
    av.amazon_listing_status,
    av.amazon_listing_buyable,
    av.amazon_last_synced_at,
    ll.last_ledger_at,
    COALESCE(pvu.unmapped_parcel_rows, 0) AS parcel_unmapped_rows,
    (pam.product_id IS NOT NULL) AS product_has_amazon_mapping,
    (av.amazon_listing_id IS NOT NULL) AS has_amazon_mapping,
    (
      p.ebay_listing_id IS NOT NULL
      AND COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
    ) AS has_ebay_mapping,
    true AS has_kk_mapping,
    (COALESCE(pvu.unmapped_parcel_rows, 0) > 0) AS has_parcel_unmapped,
    LOWER(REGEXP_REPLACE(COALESCE(c.name, ''), '[^a-zA-Z0-9]+', '_', 'g')) AS category_slug
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN ledger_latest ll ON ll.variant_id = pv.id
  LEFT JOIN amazon_variant av ON av.kk_variant_id = pv.id
  LEFT JOIN product_amazon_mapped pam ON pam.product_id = p.id
  LEFT JOIN parcel_variant_unmapped pvu ON pvu.variant_id = pv.id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  WHERE COALESCE(pv.is_active, true) = true
)
SELECT
  vb.*,
  COALESCE(
    NULLIF(BTRIM(vb.variant_sku), ''),
    vb.short_sku || '-' || LEFT(vb.variant_id::text, 8)
  ) AS internal_sku,
  CASE
    WHEN vb.on_hand < 0 THEN 'issue'
    WHEN vb.on_hand > 0 AND vb.on_hand <= vb.low_stock_threshold THEN 'low'
    WHEN vb.on_hand < 0
      OR vb.variant_sku IS NULL
      OR vb.has_parcel_unmapped
      OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
      OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
      OR (
        vb.amazon_listing_id IS NOT NULL
        AND (
          COALESCE(vb.amazon_listing_buyable, false) = false
          OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
        )
      )
      OR (
        vb.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
      )
      OR (vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand)
    THEN 'issue'
    ELSE 'healthy'
  END AS status,
  (
    vb.on_hand < 0
    OR vb.variant_sku IS NULL
    OR vb.has_parcel_unmapped
    OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
    OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
    OR (
      vb.amazon_listing_id IS NOT NULL
      AND (
        COALESCE(vb.amazon_listing_buyable, false) = false
        OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
      )
    )
    OR (
      vb.ebay_listing_id IS NOT NULL
      AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
    )
    OR (vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand)
  ) AS has_issue,
  (
    vb.variant_sku IS NULL
    OR vb.has_parcel_unmapped
    OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
    OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
  ) AS is_unmapped,
  CASE
    WHEN vb.amazon_listing_id IS NULL
      AND NOT (
        vb.ebay_listing_id IS NOT NULL
        AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed')
      )
    THEN 'never'
    WHEN vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand THEN 'mismatch'
    WHEN vb.amazon_last_synced_at IS NOT NULL
      AND vb.amazon_last_synced_at < (now() - interval '24 hours')
    THEN 'stale'
    WHEN vb.amazon_listing_id IS NOT NULL
      OR (
        vb.ebay_listing_id IS NOT NULL
        AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed')
      )
    THEN 'synced'
    ELSE 'never'
  END AS sync_state,
  COALESCE(vb.last_ledger_at, now()) AS updated_at,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN vb.on_hand < 0 THEN 'negative_stock' END,
    CASE WHEN vb.on_hand > 0 AND vb.on_hand <= vb.low_stock_threshold THEN 'low_stock' END,
    CASE WHEN vb.variant_sku IS NULL THEN 'missing_sku' END,
    CASE
      WHEN vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL
      THEN 'ebay_mapping_missing'
    END,
    CASE
      WHEN vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping
      THEN 'amazon_mapping_missing'
    END,
    CASE WHEN vb.has_parcel_unmapped THEN 'parcel_mapping_missing' END,
    CASE
      WHEN vb.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
      THEN 'ebay_listing_ended'
    END,
    CASE
      WHEN vb.amazon_listing_id IS NOT NULL
        AND (
          COALESCE(vb.amazon_listing_buyable, false) = false
          OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
        )
      THEN 'amazon_listing_inactive'
    END
  ]::text[], NULL) AS issue_types
FROM variant_base vb;

COMMENT ON VIEW public.v_inventory_workspace IS
  'Workspace rows. reserved excludes is_shadow reservations until Phase 6D cutover.';

-- ════════════════════════════════════════════════════════════════
-- Shadow audit views (read-only; do not affect official KPIs)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_shadow_reservation_audit AS
SELECT
  ir.id AS reservation_id,
  ir.channel,
  ir.order_id,
  ir.order_item_id,
  ir.variant_id,
  ir.product_id,
  COALESCE(p.name, 'Unknown product') AS product_label,
  COALESCE(
    NULLIF(BTRIM(pv.title), ''),
    NULLIF(BTRIM(pv.option_value), ''),
    NULLIF(BTRIM(pv.sku), ''),
    'Default'
  ) AS variant_label,
  ir.quantity AS reservation_quantity,
  ir.status AS reservation_status,
  ir.is_shadow,
  ir.idempotency_key,
  ir.source_reference,
  ir.notes,
  ir.created_at,
  ir.updated_at,
  o.kk_order_id,
  o.order_date AS order_placed_at
FROM public.inventory_reservations ir
LEFT JOIN public.products p ON p.id = ir.product_id
LEFT JOIN public.product_variants pv ON pv.id = ir.variant_id
LEFT JOIN public.orders_raw o ON o.stripe_checkout_session_id = ir.order_id
WHERE COALESCE(ir.is_shadow, false) = true
ORDER BY ir.created_at DESC;

COMMENT ON VIEW public.v_inventory_shadow_reservation_audit IS
  'KK shadow reservations for Phase 6C audit — parallel to direct Stripe stock deduct.';

CREATE OR REPLACE VIEW public.v_inventory_shadow_kpis AS
SELECT
  COUNT(*)::bigint AS shadow_reservation_rows,
  COALESCE(SUM(ir.quantity) FILTER (WHERE ir.status = 'reserved'), 0)::bigint AS shadow_reserved_units,
  COALESCE(SUM(ir.quantity) FILTER (WHERE ir.status = 'released'), 0)::bigint AS shadow_released_units,
  MAX(ir.created_at) AS last_shadow_created_at
FROM public.inventory_reservations ir
WHERE COALESCE(ir.is_shadow, false) = true;

COMMENT ON VIEW public.v_inventory_shadow_kpis IS
  'Aggregate shadow reservation counts — not included in official v_inventory_kpis.';

GRANT SELECT ON public.v_inventory_shadow_reservation_audit TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_shadow_kpis TO authenticated, service_role;
