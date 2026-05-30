-- Phase 2R — Ready to Push eligibility flags on v_amazon_ready_to_push_products.

CREATE OR REPLACE VIEW public.v_amazon_ready_to_push_products AS
WITH
variant_stats AS (
  SELECT
    product_id,
    COALESCE(SUM(COALESCE(stock, 0)) FILTER (WHERE is_active), 0) AS kk_stock
  FROM public.product_variants
  GROUP BY product_id
),
latest_draft AS (
  SELECT DISTINCT ON (d.kk_product_id)
    d.id         AS draft_id,
    d.kk_product_id,
    d.draft_status,
    d.updated_at AS last_draft_updated_at
  FROM public.amazon_listing_drafts d
  WHERE d.kk_product_id IS NOT NULL
    AND d.draft_status NOT IN ('published', 'archived')
  ORDER BY d.kk_product_id, d.updated_at DESC NULLS LAST
),
ready_base AS (
  SELECT
    p.id                                              AS kk_product_id,
    p.code                                            AS kk_sku,
    p.name                                            AS kk_product_title,
    p.price                                           AS kk_price,
    COALESCE(vs.kk_stock, 0)                         AS kk_stock,
    COALESCE(p.primary_image_url, p.catalog_image_url) AS image_url,
    c.name                                            AS category,
    p.created_at,
    p.updated_at,
    ld.draft_id,
    ld.draft_status,
    (ld.draft_id IS NOT NULL)                         AS has_active_draft,
    ld.last_draft_updated_at,
    (COALESCE(vs.kk_stock, 0) > 0)                  AS has_stock,
    (
      COALESCE(p.primary_image_url, p.catalog_image_url) IS NOT NULL
      AND BTRIM(COALESCE(p.primary_image_url, p.catalog_image_url, '')) <> ''
    )                                                 AS has_image,
    (c.name IS NOT NULL AND BTRIM(c.name) <> '')      AS has_category,
    (p.price IS NOT NULL AND p.price > 0)             AS has_price
  FROM public.products p
  LEFT JOIN variant_stats vs
    ON vs.product_id = p.id
  LEFT JOIN public.categories c
    ON c.id = p.category_id
  LEFT JOIN latest_draft ld
    ON ld.kk_product_id = p.id
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.amazon_listing_mappings m
      WHERE m.kk_product_id = p.id
        AND m.mapping_status = 'mapped'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.amazon_listing_drafts d
      WHERE d.kk_product_id = p.id
        AND d.draft_status = 'submitted'
    )
)
SELECT
  rb.*,
  CASE
    WHEN NOT rb.has_stock OR NOT rb.has_price THEN 'blocked'
    WHEN NOT rb.has_image OR NOT rb.has_category THEN 'needs_review'
    ELSE 'ready'
  END AS eligibility_status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT rb.has_stock THEN 'Missing stock' END,
    CASE WHEN NOT rb.has_price THEN 'Missing price' END,
    CASE WHEN NOT rb.has_image THEN 'Missing image' END,
    CASE WHEN NOT rb.has_category THEN 'Missing category' END
  ], NULL) AS eligibility_warnings
FROM ready_base rb;

COMMENT ON VIEW public.v_amazon_ready_to_push_products IS
  'Active KK products not mapped to Amazon, with eligibility flags for push workflow.';

GRANT SELECT ON public.v_amazon_ready_to_push_products TO authenticated, service_role;
