-- Ready to Push: dedicated parent-shell row; variant rows no longer inherit parent draft as has_active_draft.

DROP VIEW IF EXISTS public.v_amazon_ready_to_push_products CASCADE;

CREATE VIEW public.v_amazon_ready_to_push_products AS
WITH
active_variant_counts AS (
  SELECT product_id, COUNT(*)::int AS active_variant_count
  FROM public.product_variants
  WHERE is_active = true
  GROUP BY product_id
),
variant_coverage AS (
  SELECT
    m.kk_product_id,
    COUNT(*) FILTER (WHERE m.kk_variant_id IS NOT NULL)::int AS variants_mapped
  FROM public.amazon_listing_mappings m
  WHERE m.mapping_status = 'mapped'
    AND m.kk_product_id IS NOT NULL
  GROUP BY m.kk_product_id
),
parent_listing_ready AS (
  SELECT DISTINCT d.kk_product_id
  FROM public.amazon_listing_drafts d
  WHERE d.kk_product_id IS NOT NULL
    AND d.variation_role = 'parent'
    AND (
      d.draft_status = 'published'
      OR d.published_amazon_listing_id IS NOT NULL
      OR (
        d.draft_status IN ('submitted', 'published')
        AND UPPER(COALESCE(d.submission_status, '')) IN ('ACCEPTED', 'VALID')
      )
    )
),
variant_targets AS (
  SELECT
    p.id                                              AS kk_product_id,
    pv.id                                             AS kk_variant_id,
    pv.option_value                                   AS kk_variant_label,
    p.code                                            AS kk_sku,
    p.name                                            AS kk_product_title,
    p.price                                           AS kk_price,
    COALESCE(pv.stock, 0)                             AS kk_stock,
    COALESCE(
      NULLIF(BTRIM(pv.preview_image_url), ''),
      p.primary_image_url,
      p.catalog_image_url
    )                                                 AS image_url,
    c.name                                            AS category,
    p.created_at,
    p.updated_at,
    COALESCE(avc.active_variant_count, 0)             AS variants_total,
    COALESCE(vc.variants_mapped, 0)                   AS variants_mapped,
    COALESCE(
      NULLIF(BTRIM(pv.sku), ''),
      p.code || '-' || UPPER(SUBSTRING(REGEXP_REPLACE(COALESCE(pv.option_value, ''), '[^A-Za-z0-9]', '', 'g') FROM 1 FOR 6))
    )                                                 AS suggested_seller_sku
  FROM public.products p
  INNER JOIN public.product_variants pv
    ON pv.product_id = p.id
   AND pv.is_active = true
  LEFT JOIN public.categories c
    ON c.id = p.category_id
  LEFT JOIN active_variant_counts avc
    ON avc.product_id = p.id
  LEFT JOIN variant_coverage vc
    ON vc.kk_product_id = p.id
  WHERE p.is_active = true

  UNION ALL

  SELECT
    p.id,
    NULL::uuid,
    NULL::text,
    p.code,
    p.name,
    p.price,
    COALESCE((
      SELECT COALESCE(SUM(COALESCE(stock, 0)), 0)
      FROM public.product_variants pv2
      WHERE pv2.product_id = p.id AND pv2.is_active = true
    ), 0),
    COALESCE(p.primary_image_url, p.catalog_image_url),
    c.name,
    p.created_at,
    p.updated_at,
    COALESCE(avc.active_variant_count, 0),
    COALESCE(vc.variants_mapped, 0),
    p.code
  FROM public.products p
  LEFT JOIN public.categories c
    ON c.id = p.category_id
  LEFT JOIN active_variant_counts avc
    ON avc.product_id = p.id
  LEFT JOIN variant_coverage vc
    ON vc.kk_product_id = p.id
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv3
      WHERE pv3.product_id = p.id AND pv3.is_active = true
    )
),
latest_draft AS (
  SELECT DISTINCT ON (d.kk_product_id, COALESCE(d.kk_variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    d.id              AS draft_id,
    d.kk_product_id,
    d.kk_variant_id,
    d.variation_role  AS draft_variation_role,
    d.draft_status,
    d.updated_at      AS last_draft_updated_at
  FROM public.amazon_listing_drafts d
  WHERE d.kk_product_id IS NOT NULL
    AND d.draft_status NOT IN ('published', 'archived')
    AND COALESCE(d.variation_role, 'standalone') <> 'parent'
  ORDER BY
    d.kk_product_id,
    COALESCE(d.kk_variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    d.updated_at DESC NULLS LAST
),
parent_draft AS (
  SELECT DISTINCT ON (d.kk_product_id)
    d.id              AS draft_id,
    d.kk_product_id,
    d.variation_role  AS draft_variation_role,
    d.draft_status,
    d.updated_at      AS last_draft_updated_at
  FROM public.amazon_listing_drafts d
  WHERE d.kk_product_id IS NOT NULL
    AND d.variation_role = 'parent'
    AND d.draft_status NOT IN ('published', 'archived')
  ORDER BY d.kk_product_id, d.updated_at DESC NULLS LAST
),
variant_ready_base AS (
  SELECT
    vt.*,
    'variant'::text                                         AS ready_row_kind,
    ld.draft_id,
    ld.draft_status,
    ld.draft_id IS NOT NULL                                 AS has_active_draft,
    ld.last_draft_updated_at,
    COALESCE(plr.kk_product_id IS NOT NULL, false)          AS parent_listing_ready,
    (COALESCE(vt.kk_stock, 0) > 0)                          AS has_stock,
    (
      vt.image_url IS NOT NULL
      AND BTRIM(vt.image_url) <> ''
    )                                                       AS has_image,
    (vt.category IS NOT NULL AND BTRIM(vt.category) <> '')   AS has_category,
    (vt.kk_price IS NOT NULL AND vt.kk_price > 0)           AS has_price,
    COALESCE(ld.draft_variation_role, '')                   AS draft_variation_role
  FROM variant_targets vt
  LEFT JOIN latest_draft ld
    ON ld.kk_product_id = vt.kk_product_id
   AND (
     (vt.kk_variant_id IS NOT NULL AND ld.kk_variant_id = vt.kk_variant_id)
     OR (vt.kk_variant_id IS NULL AND ld.kk_variant_id IS NULL)
   )
  LEFT JOIN parent_listing_ready plr
    ON plr.kk_product_id = vt.kk_product_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.amazon_listing_mappings m
    WHERE m.kk_product_id = vt.kk_product_id
      AND m.mapping_status = 'mapped'
      AND (
        (vt.kk_variant_id IS NOT NULL AND m.kk_variant_id = vt.kk_variant_id)
        OR (
          vt.kk_variant_id IS NULL
          AND m.kk_variant_id IS NULL
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.amazon_listing_drafts d
    WHERE d.kk_product_id = vt.kk_product_id
      AND d.draft_status = 'submitted'
      AND (
        (vt.kk_variant_id IS NOT NULL AND d.kk_variant_id = vt.kk_variant_id)
        OR (vt.kk_variant_id IS NULL AND d.kk_variant_id IS NULL)
      )
  )
),
parent_shell_base AS (
  SELECT DISTINCT ON (vt.kk_product_id)
    vt.kk_product_id,
    NULL::uuid                                                AS kk_variant_id,
    NULL::text                                                AS kk_variant_label,
    vt.kk_sku,
    vt.kk_product_title,
    vt.kk_price,
    0::int                                                    AS kk_stock,
    vt.image_url,
    vt.category,
    vt.created_at,
    vt.updated_at,
    vt.variants_total,
    vt.variants_mapped,
    BTRIM(vt.kk_sku) || '-PARENT'                             AS suggested_seller_sku,
    'parent_shell'::text                                      AS ready_row_kind,
    pd.draft_id,
    pd.draft_status,
    pd.draft_id IS NOT NULL                                   AS has_active_draft,
    pd.last_draft_updated_at,
    false                                                     AS parent_listing_ready,
    true                                                      AS has_stock,
    (
      vt.image_url IS NOT NULL
      AND BTRIM(vt.image_url) <> ''
    )                                                         AS has_image,
    (vt.category IS NOT NULL AND BTRIM(vt.category) <> '')     AS has_category,
    (vt.kk_price IS NOT NULL AND vt.kk_price > 0)             AS has_price,
    COALESCE(pd.draft_variation_role, 'parent')               AS draft_variation_role
  FROM variant_targets vt
  LEFT JOIN parent_draft pd
    ON pd.kk_product_id = vt.kk_product_id
  LEFT JOIN parent_listing_ready plr
    ON plr.kk_product_id = vt.kk_product_id
  WHERE vt.kk_variant_id IS NOT NULL
    AND vt.variants_total > 1
    AND plr.kk_product_id IS NULL
  ORDER BY vt.kk_product_id, vt.updated_at DESC
),
ready_union AS (
  SELECT * FROM variant_ready_base
  UNION ALL
  SELECT * FROM parent_shell_base
)
SELECT
  ru.*,
  CASE
    WHEN ru.ready_row_kind = 'parent_shell' THEN 'ready'
    WHEN NOT ru.has_stock OR NOT ru.has_price THEN 'blocked'
    WHEN NOT ru.has_image OR NOT ru.has_category THEN 'needs_review'
    ELSE 'ready'
  END AS eligibility_status,
  CASE
    WHEN ru.ready_row_kind = 'parent_shell' THEN ARRAY[]::text[]
    ELSE ARRAY_REMOVE(ARRAY[
      CASE WHEN NOT ru.has_stock THEN 'Missing stock' END,
      CASE WHEN NOT ru.has_price THEN 'Missing price' END,
      CASE WHEN NOT ru.has_image THEN 'Missing image' END,
      CASE WHEN NOT ru.has_category THEN 'Missing category' END
    ], NULL)
  END AS eligibility_warnings
FROM ready_union ru;

COMMENT ON VIEW public.v_amazon_ready_to_push_products IS
  'Variant-aware KK targets for Amazon push. Multi-variant families include a parent_shell row (KK-XXXX-PARENT) separate from color/size children.';

GRANT SELECT ON public.v_amazon_ready_to_push_products TO authenticated, service_role;
