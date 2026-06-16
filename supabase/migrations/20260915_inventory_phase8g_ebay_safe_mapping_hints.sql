-- Phase 8G — eBay-safe mapping hints for historical shipped/unmapped lines.
-- Suggestion/assist only — no auto-mapping, no stock/reservation changes.

-- Grouped visibility for repeated unmapped eBay patterns (read-only).
CREATE OR REPLACE VIEW public.v_inventory_ebay_unmapped_group_counts AS
WITH ebay_unmapped AS (
  SELECT
    u.source_order_id,
    u.source_order_item_id,
    NULLIF(BTRIM(u.sku), '') AS sku,
    NULLIF(BTRIM(u.title), '') AS title,
    p.ebay_listing_id
  FROM public.v_inventory_unmapped_order_lines u
  LEFT JOIN public.products p ON BTRIM(p.code) = BTRIM(u.sku)
  WHERE u.source_channel = 'ebay'
    AND u.reason <> 'afn_skip'
)
SELECT 'sku'::text AS group_type,
  sku AS group_key,
  COUNT(*)::int AS line_count,
  COUNT(DISTINCT source_order_id)::int AS order_count
FROM ebay_unmapped
WHERE sku IS NOT NULL
GROUP BY sku
HAVING COUNT(*) > 1

UNION ALL

SELECT 'title'::text,
  title,
  COUNT(*)::int,
  COUNT(DISTINCT source_order_id)::int
FROM ebay_unmapped
WHERE title IS NOT NULL
GROUP BY title
HAVING COUNT(*) > 1

UNION ALL

SELECT 'ebay_listing_id'::text,
  ebay_listing_id,
  COUNT(*)::int,
  COUNT(DISTINCT source_order_id)::int
FROM ebay_unmapped
WHERE ebay_listing_id IS NOT NULL
GROUP BY ebay_listing_id
HAVING COUNT(*) > 1;

COMMENT ON VIEW public.v_inventory_ebay_unmapped_group_counts IS
  'Repeated unmapped eBay order-line patterns for mapping assist visibility (Phase 8G).';

GRANT SELECT ON public.v_inventory_ebay_unmapped_group_counts TO authenticated, service_role;

-- Enhanced mapping suggestions with eBay-specific match types.
CREATE OR REPLACE VIEW public.v_inventory_mapping_suggestions AS
WITH unmapped_base AS (
  SELECT
    u.*,
    li.variant AS line_variant,
    li.variant_title AS line_variant_title,
    li.selected_options AS line_selected_options
  FROM public.v_inventory_unmapped_order_lines u
  JOIN public.line_items_raw li
    ON li.stripe_checkout_session_id = u.source_order_id
   AND li.stripe_line_item_id = u.source_order_item_id
  WHERE u.reason <> 'afn_skip'
),
unmapped_ranked AS (
  SELECT
    'unmapped_order_line'::text AS issue_type,
    u.source_channel,
    u.source_order_id,
    u.source_order_item_id,
    u.sku AS source_sku,
    u.title AS source_title,
    u.listing_id AS source_asin,
    COALESCE(p_ev.ebay_listing_id, u.ebay_item_id) AS source_listing_id,
    u.reason AS source_reason,
    u.recommended_action,
    cand.suggested_product_id,
    cand.suggested_variant_id,
    cand.suggested_product_label,
    cand.suggested_internal_sku,
    cand.match_type,
    cand.confidence,
    cand.confidence_reason,
    cand.is_safe_auto_apply,
    cand.variant_pick_required,
    cand.evidence_ebay_listing_id,
    cand.evidence_ebay_offer_id,
    cand.evidence_ebay_sku,
    cand.evidence_product_code,
    cand.evidence_variant_suffix,
    cand.evidence_ebay_status,
    cand.evidence_ebay_cache_qty,
    ROW_NUMBER() OVER (
      PARTITION BY u.source_order_id, u.source_order_item_id
      ORDER BY cand.rank_score DESC, cand.suggested_variant_id NULLS LAST
    ) AS rn
  FROM unmapped_base u
  LEFT JOIN public.products p_ev ON BTRIM(p_ev.code) = BTRIM(u.sku)
  LEFT JOIN LATERAL (
    SELECT * FROM (
      -- Universal exact variant SKU
      SELECT
        p.id AS suggested_product_id,
        pv.id AS suggested_variant_id,
        p.name AS suggested_product_label,
        COALESCE(pv.sku, p.code) AS suggested_internal_sku,
        CASE WHEN u.source_channel = 'ebay' THEN 'ebay_exact_sku'::text ELSE 'exact_sku'::text END AS match_type,
        'high'::text AS confidence,
        CASE WHEN u.source_channel = 'ebay'
          THEN 'Exact SKU matched variant (eBay line SKU = KK variant SKU)'
          ELSE 'Variant SKU matches order line SKU'
        END AS confidence_reason,
        true AS is_safe_auto_apply,
        false AS variant_pick_required,
        p.ebay_listing_id AS evidence_ebay_listing_id,
        p.ebay_offer_id AS evidence_ebay_offer_id,
        p.ebay_sku AS evidence_ebay_sku,
        p.code AS evidence_product_code,
        COALESCE(u.line_variant, u.line_variant_title) AS evidence_variant_suffix,
        p.ebay_status AS evidence_ebay_status,
        ec.available_qty AS evidence_ebay_cache_qty,
        100 AS rank_score
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      LEFT JOIN public.ebay_listing_inventory_cache ec
        ON ec.product_id = p.id AND ec.variant_id = pv.id
      WHERE COALESCE(pv.is_active, true)
        AND COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(pv.sku) = BTRIM(u.sku)

      UNION ALL

      -- eBay: listing id on product (single active variant)
      SELECT
        p.id, pv.id, p.name, COALESCE(pv.sku, p.code),
        'ebay_listing_id'::text, 'high'::text,
        'Listing ID matched product with one active variant'::text,
        true, false,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, ec.available_qty,
        95
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      LEFT JOIN public.ebay_listing_inventory_cache ec ON ec.product_id = p.id AND ec.variant_id = pv.id
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND NULLIF(BTRIM(p.ebay_listing_id), '') IS NOT NULL
        AND COALESCE(p.is_active, true)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) = 1

      UNION ALL

      -- eBay: listing id on product (multi-variant — product only)
      SELECT
        p.id, NULL::uuid, p.name, p.code,
        'ebay_listing_id'::text, 'medium'::text,
        'Listing ID matched product but variant requires review'::text,
        false, true,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, NULL::integer,
        75
      FROM public.products p
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND NULLIF(BTRIM(p.ebay_listing_id), '') IS NOT NULL
        AND COALESCE(p.is_active, true)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) > 1

      UNION ALL

      -- eBay: offer id on product + single variant
      SELECT
        p.id, pv.id, p.name, COALESCE(pv.sku, p.code),
        'ebay_offer_id'::text, 'high'::text,
        'eBay offer ID matched product with one active variant'::text,
        true, false,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, ec.available_qty,
        88
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      LEFT JOIN public.ebay_listing_inventory_cache ec ON ec.product_id = p.id AND ec.variant_id = pv.id
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND NULLIF(BTRIM(p.ebay_offer_id), '') IS NOT NULL
        AND COALESCE(p.is_active, true)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) = 1

      UNION ALL

      -- eBay: cache SKU → variant
      SELECT
        p.id, pv.id, p.name, COALESCE(pv.sku, p.code),
        'ebay_exact_sku'::text, 'high'::text,
        'eBay inventory cache SKU matched variant'::text,
        true, false,
        p.ebay_listing_id, p.ebay_offer_id, ec.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, ec.available_qty,
        92
      FROM public.ebay_listing_inventory_cache ec
      JOIN public.products p ON p.id = ec.product_id
      JOIN public.product_variants pv ON pv.id = ec.variant_id
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(ec.ebay_sku) = BTRIM(u.sku)
        AND COALESCE(pv.is_active, true)
        AND COALESCE(p.is_active, true)

      UNION ALL

      -- eBay: unsupported variation group
      SELECT
        p.id, NULL::uuid, p.name, p.code,
        'ebay_item_group_key'::text, 'low'::text,
        'Multi-variation eBay group listing — manual variant selection required'::text,
        false, true,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, NULL::integer,
        12
      FROM public.products p
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND NULLIF(BTRIM(p.ebay_item_group_key), '') IS NOT NULL
        AND COALESCE(p.is_active, true)

      UNION ALL

      -- Product code + single active variant
      SELECT
        p.id, pv.id, p.name, COALESCE(pv.sku, p.code),
        CASE WHEN u.source_channel = 'ebay' THEN 'product_code_from_sku'::text ELSE 'product_code'::text END,
        'high'::text,
        CASE WHEN u.source_channel = 'ebay'
          THEN 'Product code matched and product has one active variant'
          ELSE 'Product code matches and product has one active variant'
        END,
        true, false,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, ec.available_qty,
        90
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      LEFT JOIN public.ebay_listing_inventory_cache ec ON ec.product_id = p.id AND ec.variant_id = pv.id
      WHERE COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) = 1

      UNION ALL

      -- eBay: variant suffix from buyer selection
      SELECT
        p.id, pv.id, p.name, COALESCE(pv.sku, p.code),
        'variant_suffix_from_sku'::text, 'medium'::text,
        'Buyer variation matched variant option/suffix — confirm carefully'::text,
        false, true,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, ec.available_qty,
        80
      FROM public.products p
      JOIN public.product_variants pv ON pv.product_id = p.id AND COALESCE(pv.is_active, true)
      LEFT JOIN public.ebay_listing_inventory_cache ec ON ec.product_id = p.id AND ec.variant_id = pv.id
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(COALESCE(u.line_variant, u.line_variant_title, '')), '') IS NOT NULL
        AND (
          pv.option_value ILIKE '%' || BTRIM(COALESCE(u.line_variant, u.line_variant_title, '')) || '%'
          OR pv.sku ILIKE '%' || BTRIM(COALESCE(u.line_variant, u.line_variant_title, '')) || '%'
          OR pv.title ILIKE '%' || BTRIM(COALESCE(u.line_variant, u.line_variant_title, '')) || '%'
        )

      UNION ALL

      -- Product code multi-variant — product only
      SELECT
        p.id, NULL::uuid, p.name, p.code,
        CASE WHEN u.source_channel = 'ebay' THEN 'product_code_from_sku'::text ELSE 'product_code'::text END,
        'medium'::text,
        'Product code matches — confirm correct variant'::text,
        false, true,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, NULL::integer,
        70
      FROM public.products p
      WHERE COALESCE(p.is_active, true)
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND (SELECT COUNT(*) FROM public.product_variants pv2
             WHERE pv2.product_id = p.id AND COALESCE(pv2.is_active, true)) > 1

      UNION ALL

      -- eBay: title similarity (low)
      SELECT
        p.id, NULL::uuid, p.name, p.code,
        'title_similarity'::text, 'low'::text,
        'Title-only suggestion; confirm carefully'::text,
        false, true,
        p.ebay_listing_id, p.ebay_offer_id, p.ebay_sku, p.code,
        COALESCE(u.line_variant, u.line_variant_title), p.ebay_status, NULL::integer,
        30
      FROM public.products p
      WHERE u.source_channel = 'ebay'
        AND NULLIF(BTRIM(u.title), '') IS NOT NULL
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(p.code) = BTRIM(u.sku)
        AND COALESCE(p.is_active, true)
        AND p.name ILIKE '%' || LEFT(BTRIM(u.title), 24) || '%'

      UNION ALL

      -- Amazon seller SKU listing exists
      SELECT
        p.id, pv.id, p.name, COALESCE(pv.sku, al.seller_sku),
        'seller_sku'::text, 'high'::text,
        'Amazon listing seller SKU matches line SKU'::text,
        false, false,
        NULL::text, NULL::text, NULL::text, p.code, NULL::text, NULL::text, NULL::integer,
        85
      FROM public.amazon_listings al
      LEFT JOIN public.amazon_listing_mappings m
        ON m.amazon_listing_id = al.id AND m.mapping_status = 'mapped'
      LEFT JOIN public.products p ON p.id = m.kk_product_id
      LEFT JOIN public.product_variants pv ON pv.id = m.kk_variant_id
      WHERE u.source_channel = 'amazon'
        AND NULLIF(BTRIM(u.sku), '') IS NOT NULL
        AND BTRIM(al.seller_sku) = BTRIM(u.sku)
        AND p.id IS NOT NULL
        AND pv.id IS NOT NULL
    ) s
  ) cand ON true
),
amazon_gaps AS (
  SELECT
    pv.id AS variant_id,
    pv.product_id,
    pv.sku AS variant_sku,
    p.name AS product_name,
    p.code AS product_code
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE COALESCE(pv.is_active, true)
    AND COALESCE(p.is_active, true)
    AND EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m2
      WHERE m2.kk_product_id = p.id AND m2.mapping_status = 'mapped'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m3
      WHERE m3.kk_variant_id = pv.id AND m3.mapping_status = 'mapped'
    )
),
amazon_ranked AS (
  SELECT
    'amazon_mapping_missing'::text AS issue_type,
    'amazon'::text AS source_channel,
    NULL::text AS source_order_id,
    ag.variant_id::text AS source_order_item_id,
    COALESCE(al.seller_sku, ag.variant_sku, ag.product_code) AS source_sku,
    ag.product_name AS source_title,
    al.asin AS source_asin,
    al.id::text AS source_listing_id,
    'missing_variant_mapping'::text AS source_reason,
    'Map Amazon listing to KK variant'::text AS recommended_action,
    ag.product_id AS suggested_product_id,
    ag.variant_id AS suggested_variant_id,
    ag.product_name AS suggested_product_label,
    COALESCE(ag.variant_sku, ag.product_code) AS suggested_internal_sku,
    CASE
      WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, '')) THEN 'exact_sku'
      WHEN al.id IS NOT NULL THEN 'seller_sku'
      ELSE 'manual_required'
    END AS match_type,
    CASE
      WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, '')) THEN 'high'
      WHEN al.id IS NOT NULL THEN 'medium'
      ELSE 'low'
    END AS confidence,
    CASE
      WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, ''))
        THEN 'Variant SKU matches Amazon seller SKU'
      WHEN al.id IS NOT NULL THEN 'Product-level Amazon listing exists — confirm variant'
      ELSE 'Select Amazon listing and variant manually'
    END AS confidence_reason,
    (
      al.seller_sku IS NOT NULL
      AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, ''))
    ) AS is_safe_auto_apply,
    false AS variant_pick_required,
    NULL::text AS evidence_ebay_listing_id,
    NULL::text AS evidence_ebay_offer_id,
    NULL::text AS evidence_ebay_sku,
    NULL::text AS evidence_product_code,
    NULL::text AS evidence_variant_suffix,
    NULL::text AS evidence_ebay_status,
    NULL::integer AS evidence_ebay_cache_qty,
    ROW_NUMBER() OVER (
      PARTITION BY ag.variant_id
      ORDER BY
        CASE WHEN al.seller_sku IS NOT NULL AND BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, '')) THEN 0 ELSE 1 END,
        al.last_synced_at DESC NULLS LAST
    ) AS rn
  FROM amazon_gaps ag
  LEFT JOIN public.amazon_listings al
    ON BTRIM(al.seller_sku) = BTRIM(COALESCE(ag.variant_sku, ag.product_code, ''))
    OR al.id IN (
      SELECT m.amazon_listing_id
      FROM public.amazon_listing_mappings m
      WHERE m.kk_product_id = ag.product_id
        AND m.mapping_status = 'mapped'
    )
),
combined AS (
  SELECT
    ur.issue_type, ur.source_channel, ur.source_order_id, ur.source_order_item_id,
    ur.source_sku, ur.source_title, ur.source_asin, ur.source_listing_id,
    ur.source_reason, ur.recommended_action,
    ur.suggested_product_id, ur.suggested_variant_id,
    ur.suggested_product_label, ur.suggested_internal_sku,
    ur.match_type, ur.confidence, ur.confidence_reason, ur.is_safe_auto_apply,
    ur.variant_pick_required,
    ur.evidence_ebay_listing_id, ur.evidence_ebay_offer_id, ur.evidence_ebay_sku,
    ur.evidence_product_code, ur.evidence_variant_suffix, ur.evidence_ebay_status,
    ur.evidence_ebay_cache_qty,
    (
      SELECT COUNT(*)::int FROM public.v_inventory_unmapped_order_lines u2
      WHERE u2.source_channel = 'ebay' AND BTRIM(u2.sku) = BTRIM(ur.source_sku)
        AND ur.source_channel = 'ebay' AND NULLIF(BTRIM(ur.source_sku), '') IS NOT NULL
    ) AS group_sku_count,
    (
      SELECT COUNT(*)::int FROM public.v_inventory_unmapped_order_lines u2
      WHERE u2.source_channel = 'ebay' AND BTRIM(u2.title) = BTRIM(ur.source_title)
        AND ur.source_channel = 'ebay' AND NULLIF(BTRIM(ur.source_title), '') IS NOT NULL
    ) AS group_title_count,
    (
      SELECT COUNT(*)::int FROM public.v_inventory_unmapped_order_lines u2
      LEFT JOIN public.products p2 ON BTRIM(p2.code) = BTRIM(u2.sku)
      WHERE u2.source_channel = 'ebay'
        AND ur.source_channel = 'ebay'
        AND p2.ebay_listing_id IS NOT NULL
        AND p2.ebay_listing_id = ur.evidence_ebay_listing_id
        AND ur.evidence_ebay_listing_id IS NOT NULL
    ) AS group_listing_count
  FROM unmapped_ranked ur
  WHERE ur.rn = 1

  UNION ALL

  SELECT
    ar.issue_type, ar.source_channel, ar.source_order_id, ar.source_order_item_id,
    ar.source_sku, ar.source_title, ar.source_asin, ar.source_listing_id,
    ar.source_reason, ar.recommended_action,
    ar.suggested_product_id, ar.suggested_variant_id,
    ar.suggested_product_label, ar.suggested_internal_sku,
    ar.match_type, ar.confidence, ar.confidence_reason, ar.is_safe_auto_apply,
    ar.variant_pick_required,
    ar.evidence_ebay_listing_id, ar.evidence_ebay_offer_id, ar.evidence_ebay_sku,
    ar.evidence_product_code, ar.evidence_variant_suffix, ar.evidence_ebay_status,
    ar.evidence_ebay_cache_qty,
    0, 0, 0
  FROM amazon_ranked ar
  WHERE ar.rn = 1
)
SELECT * FROM combined;

COMMENT ON VIEW public.v_inventory_mapping_suggestions IS
  'Mapping suggestions for assist wizard including eBay-safe hints (Phase 8G). Not auto-applied.';

GRANT SELECT ON public.v_inventory_mapping_suggestions TO authenticated, service_role;
