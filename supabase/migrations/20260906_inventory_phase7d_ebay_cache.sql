-- 20260906_inventory_phase7d_ebay_cache.sql
--
-- Phase 7D — eBay listing quantity/status cache (observational; not inventory truth).

CREATE TABLE IF NOT EXISTS public.ebay_listing_inventory_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id        uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ebay_item_id      text,
  ebay_sku          text NOT NULL,
  listing_status    text,
  current_qty       integer,
  quantity_sold     integer,
  available_qty     integer,
  listing_url       text,
  last_synced_at    timestamptz,
  raw_status        text,
  raw_payload_json  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ebay_listing_inventory_cache IS
  'Observational eBay listing qty/status cache from Inventory API reads. Not inventory truth.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ebay_listing_inventory_cache_product_sku
  ON public.ebay_listing_inventory_cache (product_id, ebay_sku);

CREATE INDEX IF NOT EXISTS idx_ebay_listing_inventory_cache_product
  ON public.ebay_listing_inventory_cache (product_id);

CREATE INDEX IF NOT EXISTS idx_ebay_listing_inventory_cache_variant
  ON public.ebay_listing_inventory_cache (variant_id)
  WHERE variant_id IS NOT NULL;

ALTER TABLE public.ebay_listing_inventory_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY ebay_listing_inventory_cache_service_role_all
  ON public.ebay_listing_inventory_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY ebay_listing_inventory_cache_authenticated_select
  ON public.ebay_listing_inventory_cache FOR SELECT TO authenticated
  USING (true);

GRANT ALL ON public.ebay_listing_inventory_cache TO service_role;
GRANT SELECT ON public.ebay_listing_inventory_cache TO authenticated;

-- Extend sync run mode for cache refresh
ALTER TABLE public.inventory_channel_sync_runs
  DROP CONSTRAINT IF EXISTS inventory_channel_sync_runs_mode_check;

ALTER TABLE public.inventory_channel_sync_runs
  ADD CONSTRAINT inventory_channel_sync_runs_mode_check
  CHECK (mode IN ('dry_run', 'push', 'cache_refresh'));

-- ════════════════════════════════════════════════════════════════
-- v_inventory_channel_sync_candidates — eBay cache join + actions
-- ════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_inventory_channel_sync_candidates;

CREATE VIEW public.v_inventory_channel_sync_candidates AS
WITH variant_reserved AS (
  SELECT
    ir.variant_id,
    COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved'
    AND ir.variant_id IS NOT NULL
    AND COALESCE(ir.is_shadow, false) = false
  GROUP BY ir.variant_id
),
amazon_mapped AS (
  SELECT DISTINCT ON (m.kk_variant_id)
    m.kk_variant_id,
    al.id AS amazon_listing_id,
    al.asin AS amazon_asin,
    al.seller_sku AS amazon_seller_sku,
    al.fbm_quantity AS amazon_current_qty,
    al.fulfillment_channel AS amazon_fulfillment_channel,
    al.fba_fulfillable_quantity,
    al.listing_status AS amazon_listing_status,
    al.listing_status_buyable AS amazon_listing_buyable,
    al.last_synced_at AS amazon_last_synced_at,
    (
      UPPER(COALESCE(al.fulfillment_channel, '')) LIKE '%AMAZON%'
      OR UPPER(COALESCE(al.fulfillment_channel, '')) = 'AFN'
      OR (
        COALESCE(al.fba_fulfillable_quantity, 0) > 0
        AND COALESCE(al.fbm_quantity, 0) <= 0
      )
    ) AS amazon_is_afn
  FROM public.amazon_listing_mappings m
  JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
  WHERE m.mapping_status = 'mapped'
    AND m.kk_variant_id IS NOT NULL
  ORDER BY m.kk_variant_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
product_active_variants AS (
  SELECT product_id, COUNT(*)::integer AS active_variant_count
  FROM public.product_variants
  WHERE COALESCE(is_active, true) = true
  GROUP BY product_id
),
variant_base AS (
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    COALESCE(p.name, 'Unknown') AS product_label,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      p.code || '-' || LEFT(pv.id::text, 8)
    ) AS internal_sku,
    COALESCE(pv.stock, 0) AS on_hand_qty,
    COALESCE(vr.reserved_qty, 0) AS reserved_qty,
    GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) AS available_qty_nonneg,
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS available_qty,
    COALESCE(pv.stock, 0) AS kk_current_qty,
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS kk_target_qty,
    p.ebay_listing_id,
    p.ebay_sku,
    p.ebay_offer_id,
    p.ebay_item_group_key,
    COALESCE(p.ebay_status, 'not_listed') AS ebay_local_status,
    ec.ebay_item_id AS ebay_cache_item_id,
    ec.ebay_sku AS ebay_cache_sku,
    ec.current_qty AS ebay_current_qty,
    ec.available_qty AS ebay_available_qty,
    ec.listing_status AS ebay_cache_status,
    ec.last_synced_at AS ebay_cache_synced_at,
    COALESCE(ec.listing_status, p.ebay_status, 'not_listed') AS ebay_listing_status,
    am.amazon_listing_id,
    am.amazon_asin,
    am.amazon_seller_sku,
    am.amazon_current_qty,
    am.amazon_fulfillment_channel,
    am.amazon_listing_status,
    am.amazon_listing_buyable,
    am.amazon_last_synced_at,
    COALESCE(am.amazon_is_afn, false) AS amazon_is_afn,
    COALESCE(pav.active_variant_count, 0) AS product_active_variant_count,
    COALESCE(pv.is_active, true) AS is_active
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  LEFT JOIN amazon_mapped am ON am.kk_variant_id = pv.id
  LEFT JOIN product_active_variants pav ON pav.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT c.*
    FROM public.ebay_listing_inventory_cache c
    WHERE c.product_id = p.id
      AND (c.variant_id = pv.id OR c.variant_id IS NULL)
    ORDER BY (c.variant_id IS NOT NULL) DESC, c.last_synced_at DESC NULLS LAST
    LIMIT 1
  ) ec ON true
  WHERE COALESCE(pv.is_active, true) = true
    AND COALESCE(p.is_active, true) = true
)
SELECT
  vb.*,
  CASE
    WHEN vb.available_qty < 0 THEN 'negative_available'
    WHEN vb.reserved_qty > 0 AND vb.kk_current_qty <> vb.kk_target_qty THEN 'align_to_available'
    ELSE 'no_change'
  END AS kk_sync_action,
  CASE
    WHEN vb.ebay_listing_id IS NULL
      AND COALESCE(vb.ebay_local_status, 'not_listed') IN ('not_listed', '')
      AND vb.ebay_offer_id IS NULL
      THEN 'no_active_listing'
    WHEN vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL
      THEN 'missing_mapping'
    WHEN LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock', 'withdrawn', 'inactive')
      THEN 'ended_needs_relist'
    WHEN vb.ebay_item_group_key IS NOT NULL
      AND vb.product_active_variant_count > 1
      AND vb.ebay_cache_sku IS NULL
      THEN 'unsupported_variation'
    WHEN vb.ebay_listing_id IS NOT NULL
      AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed', 'ended', 'out_of_stock', 'withdrawn', 'inactive')
      AND vb.ebay_current_qty IS NULL
      THEN 'qty_cache_missing'
    WHEN vb.ebay_current_qty IS NOT NULL
      AND vb.ebay_current_qty <> vb.available_qty
      THEN 'update_qty'
    WHEN vb.ebay_listing_id IS NOT NULL
      AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed')
      THEN 'no_change'
    ELSE 'unavailable'
  END AS ebay_sync_action,
  CASE
    WHEN vb.amazon_is_afn THEN 'afn_skip'
    WHEN vb.amazon_listing_id IS NULL THEN 'missing_mapping'
    WHEN vb.amazon_current_qty IS NOT NULL
      AND vb.amazon_current_qty <> vb.available_qty
      AND LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'suppressed', 'issue')
      THEN 'inactive_can_update'
    WHEN vb.amazon_current_qty IS NOT NULL
      AND vb.amazon_current_qty <> vb.available_qty
      THEN 'update_qty'
    WHEN vb.amazon_listing_id IS NOT NULL THEN 'no_change'
    ELSE 'missing_mapping'
  END AS amazon_sync_action,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN vb.available_qty < 0 THEN 'negative_available' END,
    CASE WHEN vb.reserved_qty > 0 AND vb.kk_current_qty <> vb.kk_target_qty THEN 'kk_uses_on_hand_not_available' END,
    CASE WHEN vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL THEN 'ebay_mapping_incomplete' END,
    CASE WHEN LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock') THEN 'ebay_listing_ended' END,
    CASE WHEN vb.ebay_listing_id IS NOT NULL
      AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed', 'ended', 'out_of_stock', 'withdrawn', 'inactive')
      AND vb.ebay_current_qty IS NULL
      THEN 'ebay_qty_cache_missing' END,
    CASE WHEN vb.ebay_item_group_key IS NOT NULL
      AND vb.product_active_variant_count > 1
      AND vb.ebay_cache_sku IS NULL
      THEN 'ebay_unsupported_variation' END,
    CASE WHEN vb.amazon_is_afn THEN 'amazon_afn_skip' END,
    CASE WHEN vb.amazon_listing_id IS NULL AND vb.amazon_seller_sku IS NULL THEN 'amazon_not_mapped' END,
    CASE
      WHEN NOT vb.amazon_is_afn
        AND vb.amazon_current_qty IS NOT NULL
        AND vb.amazon_current_qty <> vb.available_qty
      THEN 'amazon_qty_mismatch'
    END
  ]::text[], NULL) AS issue_flags,
  GREATEST(vb.amazon_last_synced_at, vb.ebay_cache_synced_at) AS last_synced_at
FROM variant_base vb;

COMMENT ON VIEW public.v_inventory_channel_sync_candidates IS
  'Channel sync candidates: available=on_hand-reserved. eBay qty from ebay_listing_inventory_cache when present.';

GRANT SELECT ON public.v_inventory_channel_sync_candidates TO authenticated, service_role;
