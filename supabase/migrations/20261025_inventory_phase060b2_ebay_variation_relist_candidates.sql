-- 20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql
--
-- Phase 060B.2 — Read-only ended eBay variation group relist candidates.
-- One row per KK parent product in an eBay variation group.
-- No inventory mutations; narrow joins only.

CREATE OR REPLACE VIEW public.v_inventory_ebay_variation_relist_candidates AS
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
product_images AS (
  SELECT
    pgi.product_id,
    COUNT(*) FILTER (WHERE COALESCE(pgi.is_active, true) = true)::integer AS gallery_image_count
  FROM public.product_gallery_images pgi
  GROUP BY pgi.product_id
),
variation_children AS (
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    p.code AS product_code,
    COALESCE(NULLIF(BTRIM(p.name), ''), p.code) AS title,
    NULLIF(BTRIM(COALESCE(p.name, p.code)), '') AS description,
    p.ebay_item_group_key,
    p.ebay_listing_id AS old_ebay_listing_id,
    COALESCE(p.ebay_status, 'not_listed') AS parent_local_status,
    p.ebay_category_id,
    p.ebay_price_cents,
    pv.option_name,
    pv.option_value,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      p.code || '-' || LEFT(pv.id::text, 8)
    ) AS variant_sku,
    GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) AS kk_available_qty,
    COALESCE(pav.active_variant_count, 0) AS product_active_variant_count,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      CASE
        WHEN LEFT(REGEXP_REPLACE(UPPER(COALESCE(pv.option_value, '')), '[^A-Z0-9]', '', 'g'), 6) <> ''
          THEN p.code || '-' || LEFT(REGEXP_REPLACE(UPPER(COALESCE(pv.option_value, '')), '[^A-Z0-9]', '', 'g'), 6)
        ELSE NULL
      END
    ) AS expected_ebay_sku,
    (
      NULLIF(BTRIM(COALESCE(p.catalog_image_url, p.primary_image_url, '')), '') IS NOT NULL
      OR COALESCE(pi.gallery_image_count, 0) > 0
      OR NULLIF(BTRIM(COALESCE(pv.preview_image_url, '')), '') IS NOT NULL
    ) AS child_has_image
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  LEFT JOIN product_active_variants pav ON pav.product_id = p.id
  LEFT JOIN product_images pi ON pi.product_id = p.id
  WHERE COALESCE(pv.is_active, true) = true
    AND COALESCE(p.is_active, true) = true
    AND p.ebay_item_group_key IS NOT NULL
    AND BTRIM(p.ebay_item_group_key) <> ''
    AND COALESCE(pav.active_variant_count, 0) > 1
),
cache_matches AS (
  SELECT
    vc.variant_id,
    vc.product_id,
    c.id AS cache_row_id,
    c.ebay_sku AS cache_ebay_sku,
    c.current_qty AS previous_ebay_qty,
    c.listing_status AS child_listing_status,
    NULLIF(BTRIM(c.raw_payload_json->>'offerId'), '') AS previous_offer_id
  FROM variation_children vc
  LEFT JOIN public.ebay_listing_inventory_cache c
    ON c.product_id = vc.product_id
    AND (
      c.variant_id = vc.variant_id
      OR (vc.expected_ebay_sku IS NOT NULL AND c.ebay_sku = vc.expected_ebay_sku)
      OR (
        NULLIF(BTRIM(vc.variant_sku), '') IS NOT NULL
        AND c.ebay_sku = NULLIF(BTRIM(vc.variant_sku), '')
      )
    )
),
cache_agg AS (
  SELECT
    variant_id,
    COUNT(cache_row_id)::integer AS match_count,
    MAX(cache_ebay_sku) FILTER (WHERE cache_row_id IS NOT NULL) AS cache_ebay_sku,
    MAX(previous_ebay_qty) FILTER (WHERE cache_row_id IS NOT NULL) AS previous_ebay_qty,
    MAX(child_listing_status) FILTER (WHERE cache_row_id IS NOT NULL) AS child_listing_status,
    MAX(previous_offer_id) FILTER (WHERE cache_row_id IS NOT NULL) AS previous_offer_id
  FROM cache_matches
  GROUP BY variant_id
),
child_classified AS (
  SELECT
    vc.*,
    COALESCE(ca.match_count, 0) AS match_count,
    ca.cache_ebay_sku,
    ca.previous_ebay_qty,
    ca.child_listing_status,
    ca.previous_offer_id,
    CASE
      WHEN vc.expected_ebay_sku IS NULL OR BTRIM(vc.expected_ebay_sku) = '' THEN 'missing'
      WHEN COALESCE(ca.match_count, 0) > 1 THEN 'ambiguous'
      WHEN COALESCE(ca.match_count, 0) = 0 THEN 'missing'
      WHEN ca.cache_ebay_sku IS NOT NULL AND ca.cache_ebay_sku <> vc.expected_ebay_sku THEN 'conflict'
      ELSE 'clean'
    END AS mapping_state
  FROM variation_children vc
  LEFT JOIN cache_agg ca ON ca.variant_id = vc.variant_id
),
child_dedup AS (
  SELECT * FROM child_classified
),
child_payload AS (
  SELECT
    product_id,
    jsonb_agg(
      jsonb_build_object(
        'variantId', variant_id,
        'sku', expected_ebay_sku,
        'optionValue', option_value,
        'availableQty', kk_available_qty,
        'includeInRelist', (kk_available_qty > 0),
        'previousOfferId', previous_offer_id,
        'previousEbayQty', previous_ebay_qty,
        'mappingState', mapping_state
      )
      ORDER BY option_value NULLS LAST, variant_id
    ) AS child_payload_json
  FROM child_dedup
  GROUP BY product_id
),
group_agg AS (
  SELECT
    cd.product_id,
    MAX(cd.product_code) AS product_code,
    MAX(cd.title) AS title,
    MAX(cd.description) AS description,
    MAX(cd.ebay_item_group_key) AS ebay_item_group_key,
    MAX(cd.old_ebay_listing_id) AS old_ebay_listing_id,
    MAX(cd.parent_local_status) AS parent_listing_status,
    MAX(cd.ebay_category_id) AS ebay_category_id,
    MAX(cd.product_active_variant_count) AS variant_count,
    COUNT(*)::integer AS mapped_child_count_raw,
    COUNT(*) FILTER (WHERE cd.mapping_state = 'clean')::integer AS mapped_child_count,
    COUNT(*) FILTER (WHERE cd.mapping_state = 'missing')::integer AS missing_child_count,
    COUNT(*) FILTER (WHERE cd.mapping_state = 'ambiguous')::integer AS ambiguous_child_count,
    COUNT(*) FILTER (WHERE cd.mapping_state = 'conflict')::integer AS conflict_child_count,
    COUNT(*) FILTER (WHERE cd.kk_available_qty > 0)::integer AS in_stock_child_count,
    COUNT(*) FILTER (WHERE cd.kk_available_qty <= 0)::integer AS out_of_stock_child_count,
    ARRAY_AGG(cd.expected_ebay_sku ORDER BY cd.option_value, cd.variant_id)
      FILTER (WHERE cd.expected_ebay_sku IS NOT NULL) AS child_skus,
    ARRAY_AGG(cd.expected_ebay_sku ORDER BY cd.option_value, cd.variant_id)
      FILTER (WHERE cd.kk_available_qty > 0 AND cd.expected_ebay_sku IS NOT NULL) AS in_stock_child_skus,
    ARRAY_AGG(cd.expected_ebay_sku ORDER BY cd.option_value, cd.variant_id)
      FILTER (WHERE cd.mapping_state = 'missing' AND cd.expected_ebay_sku IS NOT NULL) AS missing_child_skus,
    ARRAY_AGG(cd.expected_ebay_sku ORDER BY cd.option_value, cd.variant_id)
      FILTER (WHERE cd.mapping_state = 'conflict' AND cd.expected_ebay_sku IS NOT NULL) AS conflict_child_skus,
    BOOL_OR(cd.child_has_image) AS has_any_child_image,
    COUNT(DISTINCT NULLIF(BTRIM(cd.option_name), ''))::integer AS distinct_option_names,
    COUNT(*) FILTER (WHERE cd.option_value IS NULL OR BTRIM(cd.option_value) = '')::integer AS missing_option_values,
    (MAX(cd.ebay_category_id) IS NOT NULL AND BTRIM(MAX(cd.ebay_category_id)) <> '') AS has_category,
    (
      NULLIF(BTRIM(MAX(cd.title)), '') IS NOT NULL
      AND NULLIF(BTRIM(MAX(cd.description)), '') IS NOT NULL
    ) AS has_core_metadata,
    (
      NULLIF(BTRIM(MAX(cd.title)), '') IS NOT NULL
      AND NULLIF(BTRIM(MAX(cd.description)), '') IS NOT NULL
      AND (MAX(cd.ebay_category_id) IS NOT NULL AND BTRIM(MAX(cd.ebay_category_id)) <> '')
      AND COUNT(DISTINCT NULLIF(BTRIM(cd.option_name), '')) = 1
      AND COUNT(*) FILTER (WHERE cd.option_value IS NULL OR BTRIM(cd.option_value) = '') = 0
    ) AS has_variation_options,
    false AS has_policy_data,
  CASE
      WHEN MAX(cd.ebay_category_id) IS NOT NULL
        AND NULLIF(BTRIM(MAX(cd.description)), '') IS NOT NULL
        AND COUNT(DISTINCT NULLIF(BTRIM(cd.option_name), '')) = 1
        AND COUNT(*) FILTER (WHERE cd.option_value IS NULL OR BTRIM(cd.option_value) = '') = 0
        THEN false
      ELSE false
    END AS has_required_aspects,
    (
      LOWER(COALESCE(MAX(cd.parent_local_status), '')) IN ('active', 'published')
      AND LOWER(COALESCE(MAX(cd.parent_local_status), '')) NOT IN ('ended', 'out_of_stock', 'withdrawn', 'inactive')
    ) AS is_parent_active
  FROM child_dedup cd
  GROUP BY cd.product_id
),
classified AS (
  SELECT
    ga.*,
    cp.child_payload_json,
    (
      ga.has_any_child_image
      OR NULLIF(BTRIM(ga.title), '') IS NOT NULL
    ) AS has_images,
    COALESCE(array_length(ga.child_skus, 1), 0)::integer AS image_count_proxy,
    ga.distinct_option_names = 1 AND ga.missing_option_values = 0 AS has_variation_options_flag,
    ga.distinct_option_names = 1 AS variation_option_name_ok,
    CASE ga.distinct_option_names
      WHEN 1 THEN (SELECT MAX(cd.option_name) FROM child_dedup cd WHERE cd.product_id = ga.product_id)
      ELSE NULL
    END AS variation_option_name,
    CASE
      WHEN ga.is_parent_active THEN 'variation_group_active'
      WHEN ga.variant_count < 2 THEN 'variation_group_unsupported_structure'
      WHEN ga.ebay_item_group_key IS NULL OR BTRIM(ga.ebay_item_group_key) = '' THEN 'variation_group_unsupported_structure'
      WHEN NOT ga.has_core_metadata THEN 'variation_group_missing_metadata'
      WHEN NOT ga.has_category THEN 'variation_group_missing_metadata'
      WHEN NOT (ga.has_any_child_image OR NULLIF(BTRIM(ga.title), '') IS NOT NULL) THEN 'variation_group_missing_images'
      WHEN NOT ga.has_variation_options THEN 'variation_group_missing_metadata'
      WHEN ga.ambiguous_child_count > 0 THEN 'variation_group_mapping_ambiguous'
      WHEN ga.conflict_child_count > 0 THEN 'variation_group_child_offer_conflict'
      WHEN ga.missing_child_count > 0 OR ga.mapped_child_count < ga.variant_count THEN 'variation_group_mapping_missing'
      WHEN ga.in_stock_child_count = 0 THEN 'variation_group_no_in_stock_children'
      WHEN NOT ga.has_required_aspects THEN 'variation_group_missing_aspects'
      WHEN NOT ga.has_policy_data THEN 'variation_group_missing_metadata'
      WHEN ga.mapped_child_count = ga.variant_count
        AND ga.in_stock_child_count > 0
        AND ga.has_category
        AND (ga.has_any_child_image OR NULLIF(BTRIM(ga.title), '') IS NOT NULL)
        AND ga.has_variation_options
        AND ga.has_core_metadata
        THEN 'variation_group_ready_to_relist'
      ELSE 'variation_group_manual'
    END AS candidate_state,
    CASE
      WHEN ga.is_parent_active THEN 'parent_listing_active_use_060a'
      WHEN ga.variant_count < 2 THEN 'requires_multi_variant_group'
      WHEN NOT ga.has_core_metadata THEN 'missing_title_or_description'
      WHEN NOT ga.has_category THEN 'missing_ebay_category_id'
      WHEN NOT (ga.has_any_child_image OR NULLIF(BTRIM(ga.title), '') IS NOT NULL) THEN 'missing_product_or_variant_images'
      WHEN NOT ga.has_variation_options THEN 'missing_or_inconsistent_variation_options'
      WHEN ga.ambiguous_child_count > 0 THEN 'ambiguous_child_cache_rows'
      WHEN ga.conflict_child_count > 0 THEN 'child_cache_sku_conflicts_with_expected'
      WHEN ga.missing_child_count > 0 THEN 'child_sku_or_cache_missing'
      WHEN ga.in_stock_child_count = 0 THEN 'no_child_with_positive_kk_available'
      WHEN NOT ga.has_required_aspects THEN 'required_ebay_aspects_not_persisted_in_db'
      WHEN NOT ga.has_policy_data THEN 'policy_data_env_only_unknown_in_db'
      WHEN ga.mapped_child_count = ga.variant_count AND ga.in_stock_child_count > 0
        THEN 'ended_group_mapping_and_metadata_complete'
      ELSE 'unclassified_variation_group_relist_state'
    END AS candidate_reason
  FROM group_agg ga
  JOIN child_payload cp ON cp.product_id = ga.product_id
)
SELECT
  product_id,
  product_code,
  title,
  ebay_item_group_key,
  old_ebay_listing_id,
  parent_listing_status,
  ebay_category_id,
  NULL::text AS condition_id,
  has_images,
  image_count_proxy AS image_count,
  has_category,
  has_policy_data,
  has_required_aspects,
  has_variation_options_flag AS has_variation_options,
  variation_option_name,
  variant_count,
  in_stock_child_count,
  out_of_stock_child_count,
  mapped_child_count,
  ambiguous_child_count,
  missing_child_count,
  child_skus,
  in_stock_child_skus,
  missing_child_skus,
  conflict_child_skus,
  child_payload_json,
  candidate_state,
  candidate_reason,
  (candidate_state IN ('variation_group_ready_to_relist', 'variation_group_relist_dry_run_ready')) AS is_actionable,
  (candidate_state LIKE 'variation_group_%'
    AND candidate_state NOT IN (
      'variation_group_ready_to_relist',
      'variation_group_relist_dry_run_ready',
      'variation_group_active',
      'variation_group_no_change'
    )) AS requires_manual_review,
  CASE
    WHEN candidate_state IN ('variation_group_mapping_missing', 'variation_group_mapping_ambiguous', 'variation_group_child_offer_conflict', 'variation_group_unsupported_structure', 'variation_group_manual')
      THEN 'none'
    WHEN mapped_child_count = variant_count AND ambiguous_child_count = 0 AND conflict_child_count = 0
      THEN 'high'
    WHEN mapped_child_count > 0 AND ambiguous_child_count = 0
      THEN 'medium'
    ELSE 'low'
  END AS mapping_confidence
FROM classified;

COMMENT ON VIEW public.v_inventory_ebay_variation_relist_candidates IS
  'Phase 060B.2: ended eBay variation group relist candidates (one row per parent product). Read-only. has_policy_data/has_required_aspects conservative — unknown DB fields force manual until edge validates.';

GRANT SELECT ON public.v_inventory_ebay_variation_relist_candidates TO authenticated, service_role;
