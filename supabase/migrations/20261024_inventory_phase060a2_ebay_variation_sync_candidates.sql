-- 20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql
--
-- Phase 060A.2 — Read-only eBay variation child qty sync candidates.
-- One row per KK variant in an active eBay variation group.
-- No inventory mutations; narrow joins only (no issue/dashboard views).

CREATE OR REPLACE VIEW public.v_inventory_ebay_variation_sync_candidates AS
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
product_active_variants AS (
  SELECT product_id, COUNT(*)::integer AS active_variant_count
  FROM public.product_variants
  WHERE COALESCE(is_active, true) = true
  GROUP BY product_id
),
variation_base AS (
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    p.code AS product_code,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      p.code || '-' || LEFT(pv.id::text, 8)
    ) AS variant_sku,
    pv.option_name,
    pv.option_value,
    p.ebay_item_group_key,
    p.ebay_listing_id AS parent_ebay_listing_id,
    COALESCE(p.ebay_status, 'not_listed') AS parent_local_status,
    GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) AS kk_available_qty,
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS kk_available_qty_raw,
    COALESCE(pav.active_variant_count, 0) AS product_active_variant_count,
    LEFT(REGEXP_REPLACE(UPPER(COALESCE(pv.option_value, '')), '[^A-Z0-9]', '', 'g'), 6) AS option_suffix,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      CASE
        WHEN LEFT(REGEXP_REPLACE(UPPER(COALESCE(pv.option_value, '')), '[^A-Z0-9]', '', 'g'), 6) <> ''
          THEN p.code || '-' || LEFT(REGEXP_REPLACE(UPPER(COALESCE(pv.option_value, '')), '[^A-Z0-9]', '', 'g'), 6)
        ELSE NULL
      END
    ) AS expected_ebay_sku
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  LEFT JOIN product_active_variants pav ON pav.product_id = p.id
  WHERE COALESCE(pv.is_active, true) = true
    AND COALESCE(p.is_active, true) = true
    AND p.ebay_item_group_key IS NOT NULL
    AND BTRIM(p.ebay_item_group_key) <> ''
    AND COALESCE(pav.active_variant_count, 0) > 1
),
cache_matches AS (
  SELECT
    vb.variant_id,
    c.id AS cache_row_id,
    c.ebay_sku AS cache_ebay_sku,
    c.current_qty AS ebay_child_qty,
    c.listing_status AS child_listing_status,
    NULLIF(BTRIM(c.raw_payload_json->>'offerId'), '') AS child_offer_id,
    c.last_synced_at AS cache_last_synced_at,
    (c.variant_id IS NOT DISTINCT FROM vb.variant_id) AS matched_by_variant_id,
    (c.ebay_sku = vb.expected_ebay_sku) AS matched_by_expected_sku
  FROM variation_base vb
  LEFT JOIN public.ebay_listing_inventory_cache c
    ON c.product_id = vb.product_id
    AND (
      c.variant_id = vb.variant_id
      OR (vb.expected_ebay_sku IS NOT NULL AND c.ebay_sku = vb.expected_ebay_sku)
      OR (
        NULLIF(BTRIM(vb.variant_sku), '') IS NOT NULL
        AND c.ebay_sku = NULLIF(BTRIM(vb.variant_sku), '')
      )
    )
),
cache_agg AS (
  SELECT
    variant_id,
    COUNT(cache_row_id)::integer AS match_count,
    MAX(cache_ebay_sku) FILTER (WHERE cache_row_id IS NOT NULL) AS cache_ebay_sku,
    MAX(ebay_child_qty) FILTER (WHERE cache_row_id IS NOT NULL) AS ebay_child_qty,
    MAX(child_listing_status) FILTER (WHERE cache_row_id IS NOT NULL) AS child_listing_status,
    MAX(child_offer_id) FILTER (WHERE cache_row_id IS NOT NULL) AS child_offer_id,
    MAX(cache_last_synced_at) FILTER (WHERE cache_row_id IS NOT NULL) AS cache_last_synced_at,
    BOOL_OR(matched_by_variant_id) AS has_variant_id_match,
    BOOL_OR(matched_by_expected_sku) AS has_expected_sku_match
  FROM cache_matches
  GROUP BY variant_id
),
classified AS (
  SELECT
    vb.*,
    ca.match_count,
    CASE WHEN ca.match_count = 1 THEN ca.cache_ebay_sku ELSE NULL END AS cache_ebay_sku,
    CASE WHEN ca.match_count = 1 THEN ca.ebay_child_qty ELSE NULL END AS ebay_child_qty,
    CASE WHEN ca.match_count = 1 THEN ca.child_listing_status ELSE NULL END AS child_listing_status,
    CASE WHEN ca.match_count = 1 THEN ca.child_offer_id ELSE NULL END AS child_offer_id,
    ca.cache_last_synced_at,
    ca.has_variant_id_match,
    ca.has_expected_sku_match,
  CASE
    WHEN vb.expected_ebay_sku IS NULL OR BTRIM(vb.expected_ebay_sku) = ''
      OR vb.parent_ebay_listing_id IS NULL OR BTRIM(vb.parent_ebay_listing_id) = ''
      THEN 'variation_mapping_missing'
    WHEN LOWER(vb.parent_local_status) IN ('ended', 'withdrawn', 'inactive', 'out_of_stock')
      OR (
        ca.match_count = 1
        AND LOWER(COALESCE(ca.child_listing_status, '')) IN ('ended', 'withdrawn', 'inactive', 'out_of_stock')
      )
      THEN 'variation_parent_inactive'
    WHEN ca.match_count > 1
      THEN 'variation_mapping_ambiguous'
    WHEN ca.match_count = 0 OR ca.cache_ebay_sku IS NULL
      THEN 'variation_qty_cache_missing'
    WHEN ca.child_offer_id IS NULL OR BTRIM(ca.child_offer_id) = ''
      THEN 'variation_child_offer_missing'
    WHEN vb.kk_available_qty <= 0
      THEN 'variation_manual'
    WHEN ca.ebay_child_qty IS NOT NULL AND ca.ebay_child_qty = vb.kk_available_qty
      THEN 'variation_no_change'
    WHEN ca.ebay_child_qty IS NOT NULL AND ca.ebay_child_qty <> vb.kk_available_qty
      THEN 'variation_update_qty'
    ELSE 'variation_manual'
  END AS candidate_state,
  CASE
    WHEN vb.expected_ebay_sku IS NULL OR BTRIM(vb.expected_ebay_sku) = ''
      OR vb.parent_ebay_listing_id IS NULL
      THEN 'missing_group_or_parent_listing_or_expected_sku'
    WHEN LOWER(vb.parent_local_status) IN ('ended', 'withdrawn', 'inactive', 'out_of_stock')
      THEN 'parent_listing_inactive'
    WHEN ca.match_count > 1
      THEN 'multiple_cache_rows_match_variant'
    WHEN ca.match_count = 0
      THEN 'no_child_cache_row'
    WHEN ca.child_offer_id IS NULL OR BTRIM(ca.child_offer_id) = ''
      THEN 'child_offer_id_missing_in_cache_payload'
    WHEN vb.kk_available_qty <= 0
      THEN 'kk_available_not_positive'
    WHEN ca.ebay_child_qty IS NOT NULL AND ca.ebay_child_qty = vb.kk_available_qty
      THEN 'ebay_qty_matches_kk_available'
    WHEN ca.ebay_child_qty IS NOT NULL AND ca.ebay_child_qty <> vb.kk_available_qty
      THEN 'ebay_qty_differs_from_kk_available'
    ELSE 'unclassified_variation_state'
  END AS candidate_reason
  FROM variation_base vb
  LEFT JOIN cache_agg ca ON ca.variant_id = vb.variant_id
)
SELECT
  product_id,
  variant_id,
  product_code,
  variant_sku,
  option_name,
  option_value,
  ebay_item_group_key,
  parent_ebay_listing_id,
  expected_ebay_sku,
  cache_ebay_sku,
  child_offer_id,
  child_listing_status,
  kk_available_qty,
  ebay_child_qty,
  (ebay_child_qty - kk_available_qty) AS qty_delta,
  candidate_state,
  candidate_reason,
  (candidate_state IN ('variation_update_qty', 'variation_qty_cache_missing')) AS is_actionable,
  (
    candidate_state = 'variation_qty_cache_missing'
    OR cache_last_synced_at IS NULL
    OR cache_last_synced_at < (now() - interval '7 days')
  ) AS requires_cache_refresh,
  CASE
    WHEN candidate_state IN ('variation_mapping_missing', 'variation_mapping_ambiguous', 'variation_child_offer_missing', 'variation_parent_inactive', 'variation_manual')
      THEN 'none'
    WHEN match_count = 1 AND has_variant_id_match AND has_expected_sku_match
      THEN 'high'
    WHEN match_count = 1 AND (has_variant_id_match OR has_expected_sku_match)
      THEN 'medium'
    WHEN match_count = 1
      THEN 'low'
    ELSE 'none'
  END AS mapping_confidence,
  cache_last_synced_at,
  product_active_variant_count
FROM classified;

COMMENT ON VIEW public.v_inventory_ebay_variation_sync_candidates IS
  'Phase 060A.2: per-variant eBay variation group qty sync candidates. Read-only. Child offer ID from ebay_listing_inventory_cache.raw_payload_json.offerId.';

GRANT SELECT ON public.v_inventory_ebay_variation_sync_candidates TO authenticated, service_role;
