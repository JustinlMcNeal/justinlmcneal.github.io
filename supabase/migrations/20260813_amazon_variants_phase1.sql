-- Phase 7A ? Amazon variant infrastructure (mappings, ready-to-push, workspace variant columns).

-- Views must be dropped before column layout changes (CREATE OR REPLACE cannot rename columns).
DROP VIEW IF EXISTS public.v_amazon_listing_workspace CASCADE;
DROP VIEW IF EXISTS public.v_amazon_drafts_issues CASCADE;
DROP VIEW IF EXISTS public.v_amazon_ready_to_push_products CASCADE;

-- ?? 1. Schema: kk_variant_id on mappings + drafts ???????????????????????????

ALTER TABLE public.amazon_listing_mappings
  ADD COLUMN IF NOT EXISTS kk_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.amazon_listing_drafts
  ADD COLUMN IF NOT EXISTS kk_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS kk_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.amazon_listing_mappings.kk_variant_id IS
  'KK product_variants.id when this Amazon SKU maps to a specific variant (color/size). NULL = legacy product-level mapping.';

CREATE INDEX IF NOT EXISTS idx_amazon_listing_mappings_variant
  ON public.amazon_listing_mappings (kk_product_id, kk_variant_id)
  WHERE mapping_status = 'mapped';

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_listing_mappings_one_mapped_variant
  ON public.amazon_listing_mappings (kk_product_id, kk_variant_id)
  WHERE mapping_status = 'mapped' AND kk_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_variant
  ON public.amazon_listing_drafts (kk_product_id, kk_variant_id);

-- ?? 2. Variant-aware Ready to Push (one row per unmapped variant target) ???????

CREATE OR REPLACE VIEW public.v_amazon_ready_to_push_products AS
WITH
active_variant_counts AS (
  SELECT
    product_id,
    COUNT(*)::int AS active_variant_count
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
    0,
    COALESCE(vc.variants_mapped, 0),
    p.code
  FROM public.products p
  LEFT JOIN public.categories c
    ON c.id = p.category_id
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
    d.id         AS draft_id,
    d.kk_product_id,
    d.kk_variant_id,
    d.draft_status,
    d.updated_at AS last_draft_updated_at
  FROM public.amazon_listing_drafts d
  WHERE d.kk_product_id IS NOT NULL
    AND d.draft_status NOT IN ('published', 'archived')
  ORDER BY
    d.kk_product_id,
    COALESCE(d.kk_variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    d.updated_at DESC NULLS LAST
),
ready_base AS (
  SELECT
    vt.*,
    ld.draft_id,
    ld.draft_status,
    (ld.draft_id IS NOT NULL)                         AS has_active_draft,
    ld.last_draft_updated_at,
    (COALESCE(vt.kk_stock, 0) > 0)                  AS has_stock,
    (
      vt.image_url IS NOT NULL
      AND BTRIM(vt.image_url) <> ''
    )                                                 AS has_image,
    (vt.category IS NOT NULL AND BTRIM(vt.category) <> '') AS has_category,
    (vt.kk_price IS NOT NULL AND vt.kk_price > 0)     AS has_price
  FROM variant_targets vt
  LEFT JOIN latest_draft ld
    ON ld.kk_product_id = vt.kk_product_id
   AND (
     (vt.kk_variant_id IS NOT NULL AND ld.kk_variant_id = vt.kk_variant_id)
     OR (vt.kk_variant_id IS NULL AND ld.kk_variant_id IS NULL)
   )
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
  'Variant-aware KK targets for Amazon push. One row per unmapped active variant (or one implicit row when no variants).';

GRANT SELECT ON public.v_amazon_ready_to_push_products TO authenticated, service_role;

-- ?? 3. Drafts / Issues view ? expose variant on draft rows ???????????????????

CREATE OR REPLACE VIEW public.v_amazon_drafts_issues AS
WITH issue_stats AS (
  SELECT
    i.draft_id,
    COUNT(*) FILTER (WHERE i.status = 'open') AS issue_count,
    MAX(
      CASE i.severity
        WHEN 'error'   THEN 3
        WHEN 'warning' THEN 2
        WHEN 'info'    THEN 1
        ELSE 0
      END
    ) FILTER (WHERE i.status = 'open') AS latest_issue_severity_rank
  FROM public.amazon_listing_issues i
  WHERE i.draft_id IS NOT NULL
  GROUP BY i.draft_id
)
SELECT
  d.id                              AS draft_id,
  d.published_amazon_listing_id     AS amazon_listing_id,
  d.kk_product_id,
  d.kk_variant_id,
  pv.option_value                   AS kk_variant_label,
  d.kk_sku,
  p.name                            AS kk_product_title,
  d.marketplace_id,
  d.seller_sku,
  d.asin,
  d.matched_asin,
  d.product_type,
  d.draft_status,
  d.submission_status,
  d.validation_errors,
  d.last_validation_result,
  d.last_submission_response,
  COALESCE(ist.issue_count, 0)    AS issue_count,
  CASE COALESCE(ist.latest_issue_severity_rank, 0)
    WHEN 3 THEN 'error'
    WHEN 2 THEN 'warning'
    WHEN 1 THEN 'info'
    ELSE NULL
  END                               AS latest_issue_severity,
  d.draft_payload,
  d.verify_attempts,
  d.last_verify_attempt_at,
  d.next_verify_after,
  d.verify_status,
  d.verify_last_error,
  d.updated_at,
  d.created_at
FROM public.amazon_listing_drafts d
LEFT JOIN public.products p
  ON p.id = d.kk_product_id
LEFT JOIN public.product_variants pv
  ON pv.id = d.kk_variant_id
LEFT JOIN issue_stats ist
  ON ist.draft_id = d.id
WHERE d.draft_status NOT IN ('published', 'archived');

GRANT SELECT ON public.v_amazon_drafts_issues TO authenticated, service_role;

-- -- 4. Synced workspace ? variant label + per-variant stock -----------------

CREATE OR REPLACE VIEW public.v_amazon_listing_workspace AS
WITH
variant_stats AS (
  SELECT
    product_id,
    COALESCE(SUM(COALESCE(stock, 0)) FILTER (WHERE is_active), 0) AS kk_stock_total
  FROM public.product_variants
  GROUP BY product_id
),
mapped AS (
  SELECT DISTINCT ON (m.amazon_listing_id)
    m.amazon_listing_id,
    m.id                AS mapping_id,
    m.kk_product_id,
    m.kk_variant_id,
    m.kk_sku,
    m.mapping_status,
    m.mapping_confidence,
    m.mapped_at
  FROM public.amazon_listing_mappings m
  WHERE m.mapping_status = 'mapped'
  ORDER BY m.amazon_listing_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
issue_stats AS (
  SELECT
    i.amazon_listing_id,
    COUNT(*) FILTER (WHERE i.status = 'open') AS open_issue_count,
    COUNT(*) FILTER (WHERE i.status = 'open' AND i.severity = 'error') AS error_issue_count,
    COUNT(*) FILTER (WHERE i.status = 'open' AND i.severity = 'warning') AS warning_issue_count,
    COUNT(*) FILTER (WHERE i.status = 'open' AND i.severity = 'info') AS info_issue_count,
    MAX(
      CASE i.severity
        WHEN 'error'   THEN 3
        WHEN 'warning' THEN 2
        WHEN 'info'    THEN 1
        ELSE 0
      END
    ) FILTER (WHERE i.status = 'open') AS highest_issue_severity_rank
  FROM public.amazon_listing_issues i
  WHERE i.amazon_listing_id IS NOT NULL
  GROUP BY i.amazon_listing_id
),
latest_open_issue AS (
  SELECT DISTINCT ON (i.amazon_listing_id)
    i.amazon_listing_id,
    i.issue_code AS latest_issue_code,
    i.message    AS latest_issue_message,
    i.source     AS latest_issue_source,
    i.created_at AS latest_issue_at
  FROM public.amazon_listing_issues i
  WHERE i.status = 'open'
    AND i.amazon_listing_id IS NOT NULL
  ORDER BY i.amazon_listing_id, i.created_at DESC
),
sync_error_stats AS (
  SELECT
    al.id AS amazon_listing_id,
    COUNT(*)::int AS recent_sync_error_count
  FROM public.amazon_listings al
  INNER JOIN public.amazon_sync_errors se
    ON se.created_at >= (now() - interval '7 days')
    AND (
      (se.seller_sku IS NOT NULL AND al.seller_sku IS NOT NULL AND se.seller_sku = al.seller_sku)
      OR (se.asin IS NOT NULL AND al.asin IS NOT NULL AND se.asin = al.asin)
    )
  GROUP BY al.id
),
latest_sync_error AS (
  SELECT DISTINCT ON (al.id)
    al.id AS amazon_listing_id,
    se.message   AS latest_sync_error_message,
    se.created_at AS latest_sync_error_at
  FROM public.amazon_listings al
  INNER JOIN public.amazon_sync_errors se
    ON se.created_at >= (now() - interval '7 days')
    AND (
      (se.seller_sku IS NOT NULL AND al.seller_sku IS NOT NULL AND se.seller_sku = al.seller_sku)
      OR (se.asin IS NOT NULL AND al.asin IS NOT NULL AND se.asin = al.asin)
    )
  ORDER BY al.id, se.created_at DESC
),
listing_base AS (
  SELECT
    al.id                          AS amazon_listing_id,
    al.seller_account_id,
    al.seller_id,
    al.marketplace_id,
    al.asin,
    al.seller_sku,
    al.amazon_title,
    al.product_type,
    al.listing_status,
    al.listing_status_buyable,
    al.listing_status_discoverable,
    al.price                         AS stored_price,
    public.amazon_listing_live_offer_price(al.raw_listing, al.marketplace_id) AS live_offer_price,
    public.amazon_listing_attribute_offer_price(al.raw_listing, al.marketplace_id) AS attribute_price,
    COALESCE(
      public.amazon_listing_live_offer_price(al.raw_listing, al.marketplace_id),
      al.price
    )                              AS price,
    al.currency,
    al.fulfillment_channel,
    al.fbm_quantity,
    al.fba_fulfillable_quantity,
    al.fba_reserved_quantity,
    al.fba_inbound_quantity,
    al.last_synced_at,
    mp.mapping_status,
    mp.mapping_confidence,
    mp.kk_product_id,
    mp.kk_variant_id,
    pv_map.option_value AS kk_variant_label,
    COALESCE(mp.kk_sku, p.code)     AS kk_sku,
    p.name                          AS kk_product_title,
    p.price                         AS kk_price,
    p.unit_cost                     AS kk_unit_cost,
    p.weight_g                      AS kk_weight_g,
    COALESCE(
      CASE WHEN mp.kk_variant_id IS NOT NULL THEN COALESCE(pv_map.stock, 0) END,
      vs.kk_stock_total,
      0
    ) AS kk_stock,
    COALESCE(ist.open_issue_count, 0) AS open_issue_count,
    COALESCE(ist.error_issue_count, 0) AS error_issue_count,
    COALESCE(ist.warning_issue_count, 0) AS warning_issue_count,
    COALESCE(ist.info_issue_count, 0) AS info_issue_count,
    CASE COALESCE(ist.highest_issue_severity_rank, 0)
      WHEN 3 THEN 'error'
      WHEN 2 THEN 'warning'
      WHEN 1 THEN 'info'
      ELSE NULL
    END                             AS highest_issue_severity,
    loi.latest_issue_at,
    loi.latest_issue_code,
    loi.latest_issue_message,
    loi.latest_issue_source,
    COALESCE(ses.recent_sync_error_count, 0) AS recent_sync_error_count,
    lse.latest_sync_error_message,
    lse.latest_sync_error_at,
    CASE
      WHEN al.last_synced_at IS NULL THEN true
      WHEN al.last_synced_at < (now() - interval '24 hours') THEN true
      ELSE false
    END                             AS is_stale,
    CASE
      WHEN al.last_synced_at IS NULL THEN 'never_synced'
      WHEN al.last_synced_at < (now() - interval '24 hours') THEN 'sync_older_than_24h'
      ELSE NULL
    END                             AS stale_reason,
    CASE
      WHEN al.last_synced_at IS NULL THEN NULL
      ELSE ROUND(
        EXTRACT(EPOCH FROM (now() - al.last_synced_at)) / 3600.0,
        1
      )
    END                             AS hours_since_sync,
    CASE
      WHEN UPPER(COALESCE(al.fulfillment_channel, '')) LIKE '%AMAZON%'
        OR UPPER(COALESCE(al.fulfillment_channel, '')) = 'AFN'
        OR (
          COALESCE(al.fba_fulfillable_quantity, 0) > 0
          AND COALESCE(al.fbm_quantity, 0) <= 0
        )
      THEN true
      ELSE false
    END                             AS is_fba_managed
  FROM public.amazon_listings al
  LEFT JOIN mapped mp
    ON mp.amazon_listing_id = al.id
  LEFT JOIN public.products p
    ON p.id = mp.kk_product_id
  LEFT JOIN public.product_variants pv_map
    ON pv_map.id = mp.kk_variant_id
  LEFT JOIN variant_stats vs
    ON vs.product_id = p.id
  LEFT JOIN issue_stats ist
    ON ist.amazon_listing_id = al.id
  LEFT JOIN latest_open_issue loi
    ON loi.amazon_listing_id = al.id
  LEFT JOIN sync_error_stats ses
    ON ses.amazon_listing_id = al.id
  LEFT JOIN latest_sync_error lse
    ON lse.amazon_listing_id = al.id
),
health_enriched AS (
  SELECT
    lb.*,
    CASE
      WHEN lb.is_fba_managed THEN 'fba'
      WHEN lb.fulfillment_channel IS NOT NULL OR lb.fbm_quantity IS NOT NULL THEN 'fbm'
      ELSE 'unknown'
    END AS fulfillment_mode,
    CASE
      WHEN lb.is_fba_managed THEN 'FBA'
      WHEN UPPER(COALESCE(lb.fulfillment_channel, '')) IN ('DEFAULT', 'MERCHANT', '')
        OR NOT lb.is_fba_managed THEN 'FBM'
      WHEN lb.fulfillment_channel IS NOT NULL THEN lb.fulfillment_channel
      ELSE 'Unknown'
    END AS fulfillment_channel_label,
    (COALESCE(lb.fba_reserved_quantity, 0) > 0) AS has_fba_reserved,
    (COALESCE(lb.fba_inbound_quantity, 0) > 0) AS has_fba_inbound,
    CASE
      WHEN lb.listing_status = 'suppressed' THEN 'suppressed'
      WHEN COALESCE(lb.error_issue_count, 0) > 0 THEN 'error'
      WHEN lb.listing_status = 'issue' THEN 'error'
      WHEN COALESCE(lb.recent_sync_error_count, 0) > 0 THEN 'sync_error'
      WHEN (
        (lb.price IS NULL OR lb.price <= 0 OR lb.listing_status_buyable = false)
        AND lb.listing_status IN ('active', 'low_stock')
      ) THEN 'warning'
      WHEN COALESCE(lb.warning_issue_count, 0) > 0
        OR lb.listing_status IN ('inactive', 'unknown') THEN 'warning'
      WHEN COALESCE(lb.open_issue_count, 0) = 0
        AND lb.listing_status = 'active' THEN 'healthy'
      ELSE 'unknown'
    END AS listing_health_status,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN lb.listing_status = 'suppressed' THEN 'Suppressed listing' END,
      CASE
        WHEN COALESCE(lb.error_issue_count, 0) > 0 OR lb.listing_status = 'issue'
        THEN 'Open Amazon error'
      END,
      CASE WHEN COALESCE(lb.warning_issue_count, 0) > 0 THEN 'Open warning' END,
      CASE WHEN COALESCE(lb.recent_sync_error_count, 0) > 0 THEN 'Recent sync error' END,
      CASE
        WHEN (lb.price IS NULL OR lb.price <= 0)
          AND lb.listing_status IN ('active', 'low_stock')
        THEN 'Missing offer (no price)'
      END,
      CASE
        WHEN lb.listing_status_buyable = false
          AND lb.listing_status IN ('active', 'low_stock')
        THEN 'Not buyable on Amazon'
      END,
      CASE WHEN lb.listing_status = 'unknown' THEN 'Unknown listing status' END,
      CASE WHEN lb.listing_status = 'inactive' THEN 'Inactive listing' END,
      CASE WHEN lb.asin IS NULL OR BTRIM(lb.asin) = '' THEN 'Missing ASIN' END
    ]::text[], NULL) AS listing_health_reasons
  FROM listing_base lb
)
SELECT
  he.*,
  (
    COALESCE(he.kk_unit_cost, 0)
    + CASE
        WHEN COALESCE(he.kk_weight_g, 0) <= 0 THEN 0::numeric
        WHEN he.kk_weight_g * 30 <= 2000 THEN
          ((88 + he.kk_weight_g * 30 * 0.12) * 0.1437) / 30
        ELSE
          ((297 + he.kk_weight_g * 30 * 0.0523) * 0.1437) / 30
      END
  )::numeric(12, 2) AS kk_cogs,
  0.15::numeric(5, 4) AS est_referral_fee_rate,
  CASE
    WHEN he.kk_product_id IS NULL THEN 'unmapped'
    WHEN he.price IS NULL OR he.price <= 0 THEN 'missing_price'
    WHEN COALESCE(he.kk_unit_cost, 0) <= 0 THEN 'missing_cogs'
    ELSE 'complete'
  END AS profit_calc_status,
  CASE
    WHEN he.kk_product_id IS NULL THEN 'unmapped'
    WHEN he.price IS NULL OR he.price <= 0 THEN 'missing_amazon_price'
    WHEN he.kk_price IS NULL OR he.kk_price <= 0 THEN 'missing_kk_price'
    WHEN ABS(he.price - he.kk_price) <= 0.01 THEN 'match'
    WHEN he.price > he.kk_price THEN 'amazon_higher'
    ELSE 'amazon_lower'
  END AS price_compare_status,
  (
    he.kk_product_id IS NOT NULL
    AND he.price IS NOT NULL AND he.price > 0
    AND he.kk_price IS NOT NULL AND he.kk_price > 0
    AND ABS(he.price - he.kk_price) > 0.01
  ) AS has_price_mismatch,
  CASE
    WHEN he.price IS NOT NULL AND he.kk_price IS NOT NULL
      AND he.price > 0 AND he.kk_price > 0
    THEN ROUND(he.price - he.kk_price, 2)
    ELSE NULL
  END AS price_delta,
  CASE
    WHEN he.price IS NOT NULL AND he.kk_price IS NOT NULL
      AND he.price > 0 AND he.kk_price > 0
    THEN ROUND(((he.price - he.kk_price) / he.kk_price) * 100, 1)
    ELSE NULL
  END AS price_delta_pct,
  CASE
    WHEN he.is_fba_managed THEN he.fba_fulfillable_quantity
    ELSE he.fbm_quantity
  END AS amazon_fulfillable_qty,
  CASE
    WHEN he.kk_product_id IS NULL THEN 'unmapped'
    WHEN he.is_fba_managed THEN 'fba_managed'
    WHEN he.fbm_quantity IS NULL THEN 'missing_amazon_qty'
    WHEN he.fbm_quantity = he.kk_stock THEN 'match'
    WHEN he.fbm_quantity > he.kk_stock THEN 'amazon_higher'
    ELSE 'amazon_lower'
  END AS inventory_compare_status,
  (
    he.kk_product_id IS NOT NULL
    AND he.is_fba_managed = false
    AND he.fbm_quantity IS NOT NULL
    AND he.fbm_quantity <> he.kk_stock
  ) AS has_inventory_mismatch,
  CASE
    WHEN he.kk_product_id IS NOT NULL
      AND he.is_fba_managed = false
      AND he.fbm_quantity IS NOT NULL
    THEN he.fbm_quantity - he.kk_stock
    ELSE NULL
  END AS inventory_delta,
  (he.listing_health_status <> 'healthy') AS has_listing_health_issue,
  CASE
    WHEN he.kk_product_id IS NULL
      OR he.price IS NULL
      OR he.price <= 0
      OR COALESCE(he.kk_unit_cost, 0) <= 0 THEN NULL
    ELSE ROUND(he.price * 0.15, 2)
  END AS est_referral_fee,
  CASE
    WHEN he.kk_product_id IS NULL
      OR he.price IS NULL
      OR he.price <= 0
      OR COALESCE(he.kk_unit_cost, 0) <= 0 THEN NULL
    ELSE ROUND(he.price * 0.15, 2)
  END AS est_amazon_fees,
  CASE
    WHEN he.kk_product_id IS NULL
      OR he.price IS NULL
      OR he.price <= 0
      OR COALESCE(he.kk_unit_cost, 0) <= 0 THEN NULL
    ELSE ROUND(
      he.price
      - (
        COALESCE(he.kk_unit_cost, 0)
        + CASE
            WHEN COALESCE(he.kk_weight_g, 0) <= 0 THEN 0::numeric
            WHEN he.kk_weight_g * 30 <= 2000 THEN
              ((88 + he.kk_weight_g * 30 * 0.12) * 0.1437) / 30
            ELSE
              ((297 + he.kk_weight_g * 30 * 0.0523) * 0.1437) / 30
          END
      )
      - (he.price * 0.15),
      2
    )
  END AS est_profit
FROM health_enriched he;

COMMENT ON VIEW public.v_amazon_listing_workspace IS
  'Denormalized Amazon listing workspace with variant mapping. Price/compare uses live SP-API offer when present.';

GRANT SELECT ON public.v_amazon_listing_workspace TO authenticated, service_role;

