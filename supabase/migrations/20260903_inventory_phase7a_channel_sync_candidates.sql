-- 20260903_inventory_phase7a_channel_sync_candidates.sql
--
-- Phase 7A — read-only channel sync candidate view (dry-run planner only).
-- No API pushes, stock mutations, or reservation changes.

CREATE OR REPLACE VIEW public.v_inventory_channel_sync_candidates AS
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
    NULL::integer AS ebay_current_qty,
    COALESCE(p.ebay_status, 'not_listed') AS ebay_listing_status,
    am.amazon_listing_id,
    am.amazon_asin,
    am.amazon_seller_sku,
    am.amazon_current_qty,
    am.amazon_fulfillment_channel,
    am.amazon_listing_status,
    am.amazon_listing_buyable,
    am.amazon_last_synced_at,
    COALESCE(am.amazon_is_afn, false) AS amazon_is_afn,
    p.ebay_offer_id,
    COALESCE(pv.is_active, true) AS is_active
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  LEFT JOIN amazon_mapped am ON am.kk_variant_id = pv.id
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
      AND COALESCE(vb.ebay_listing_status, 'not_listed') IN ('not_listed', '')
      AND vb.ebay_offer_id IS NULL
      THEN 'no_active_listing'
    WHEN vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL
      THEN 'missing_mapping'
    WHEN LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
      THEN 'ended_needs_relist'
    WHEN vb.ebay_listing_id IS NOT NULL
      AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed', 'ended', 'out_of_stock')
      AND vb.ebay_current_qty IS NULL
      THEN 'qty_unknown'
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
    CASE
      WHEN vb.ebay_listing_id IS NOT NULL
        AND vb.ebay_current_qty IS NULL
        AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed', 'ended', 'out_of_stock')
      THEN 'ebay_qty_unknown'
    END,
    CASE WHEN vb.amazon_is_afn THEN 'amazon_afn_skip' END,
    CASE WHEN vb.amazon_listing_id IS NULL AND vb.amazon_seller_sku IS NULL THEN 'amazon_not_mapped' END,
    CASE
      WHEN NOT vb.amazon_is_afn
        AND vb.amazon_current_qty IS NOT NULL
        AND vb.amazon_current_qty <> vb.available_qty
      THEN 'amazon_qty_mismatch'
    END
  ]::text[], NULL) AS issue_flags,
  GREATEST(
    vb.amazon_last_synced_at,
    NULL::timestamptz
  ) AS last_synced_at
FROM variant_base vb;

COMMENT ON VIEW public.v_inventory_channel_sync_candidates IS
  'Phase 7A dry-run: per-variant channel sync targets from available=on_hand-reserved. Read-only; no qty push.';

GRANT SELECT ON public.v_inventory_channel_sync_candidates TO authenticated, service_role;
