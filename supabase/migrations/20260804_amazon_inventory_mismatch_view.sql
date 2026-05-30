-- Phase 5D: KK warehouse vs Amazon fulfillable inventory comparison on workspace view.

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
    al.price,
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
    COALESCE(mp.kk_sku, p.code)     AS kk_sku,
    p.name                          AS kk_product_title,
    p.price                         AS kk_price,
    p.unit_cost                     AS kk_unit_cost,
    p.weight_g                      AS kk_weight_g,
    COALESCE(vs.kk_stock_total, 0)  AS kk_stock,
    COALESCE(ist.open_issue_count, 0) AS open_issue_count,
    CASE COALESCE(ist.highest_issue_severity_rank, 0)
      WHEN 3 THEN 'error'
      WHEN 2 THEN 'warning'
      WHEN 1 THEN 'info'
      ELSE NULL
    END                             AS highest_issue_severity,
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
  LEFT JOIN variant_stats vs
    ON vs.product_id = p.id
  LEFT JOIN issue_stats ist
    ON ist.amazon_listing_id = al.id
)
SELECT
  lb.*,
  (
    COALESCE(lb.kk_unit_cost, 0)
    + CASE
        WHEN COALESCE(lb.kk_weight_g, 0) <= 0 THEN 0::numeric
        WHEN lb.kk_weight_g * 30 <= 2000 THEN
          ((88 + lb.kk_weight_g * 30 * 0.12) * 0.1437) / 30
        ELSE
          ((297 + lb.kk_weight_g * 30 * 0.0523) * 0.1437) / 30
      END
  )::numeric(12, 2) AS kk_cogs,
  0.15::numeric(5, 4) AS est_referral_fee_rate,
  CASE
    WHEN lb.kk_product_id IS NULL THEN 'unmapped'
    WHEN lb.price IS NULL OR lb.price <= 0 THEN 'missing_price'
    WHEN COALESCE(lb.kk_unit_cost, 0) <= 0 THEN 'missing_cogs'
    ELSE 'complete'
  END AS profit_calc_status,
  CASE
    WHEN lb.kk_product_id IS NULL THEN 'unmapped'
    WHEN lb.price IS NULL OR lb.price <= 0 THEN 'missing_amazon_price'
    WHEN lb.kk_price IS NULL OR lb.kk_price <= 0 THEN 'missing_kk_price'
    WHEN ABS(lb.price - lb.kk_price) <= 0.01 THEN 'match'
    WHEN lb.price > lb.kk_price THEN 'amazon_higher'
    ELSE 'amazon_lower'
  END AS price_compare_status,
  (
    lb.kk_product_id IS NOT NULL
    AND lb.price IS NOT NULL AND lb.price > 0
    AND lb.kk_price IS NOT NULL AND lb.kk_price > 0
    AND ABS(lb.price - lb.kk_price) > 0.01
  ) AS has_price_mismatch,
  CASE
    WHEN lb.price IS NOT NULL AND lb.kk_price IS NOT NULL
      AND lb.price > 0 AND lb.kk_price > 0
    THEN ROUND(lb.price - lb.kk_price, 2)
    ELSE NULL
  END AS price_delta,
  CASE
    WHEN lb.price IS NOT NULL AND lb.kk_price IS NOT NULL
      AND lb.price > 0 AND lb.kk_price > 0
    THEN ROUND(((lb.price - lb.kk_price) / lb.kk_price) * 100, 1)
    ELSE NULL
  END AS price_delta_pct,
  CASE
    WHEN lb.is_fba_managed THEN lb.fba_fulfillable_quantity
    ELSE lb.fbm_quantity
  END AS amazon_fulfillable_qty,
  CASE
    WHEN lb.kk_product_id IS NULL THEN 'unmapped'
    WHEN lb.is_fba_managed THEN 'fba_managed'
    WHEN lb.fbm_quantity IS NULL THEN 'missing_amazon_qty'
    WHEN lb.fbm_quantity = lb.kk_stock THEN 'match'
    WHEN lb.fbm_quantity > lb.kk_stock THEN 'amazon_higher'
    ELSE 'amazon_lower'
  END AS inventory_compare_status,
  (
    lb.kk_product_id IS NOT NULL
    AND lb.is_fba_managed = false
    AND lb.fbm_quantity IS NOT NULL
    AND lb.fbm_quantity <> lb.kk_stock
  ) AS has_inventory_mismatch,
  CASE
    WHEN lb.kk_product_id IS NOT NULL
      AND lb.is_fba_managed = false
      AND lb.fbm_quantity IS NOT NULL
    THEN lb.fbm_quantity - lb.kk_stock
    ELSE NULL
  END AS inventory_delta,
  CASE
    WHEN lb.kk_product_id IS NULL
      OR lb.price IS NULL
      OR lb.price <= 0
      OR COALESCE(lb.kk_unit_cost, 0) <= 0 THEN NULL
    ELSE ROUND(lb.price * 0.15, 2)
  END AS est_referral_fee,
  CASE
    WHEN lb.kk_product_id IS NULL
      OR lb.price IS NULL
      OR lb.price <= 0
      OR COALESCE(lb.kk_unit_cost, 0) <= 0 THEN NULL
    ELSE ROUND(lb.price * 0.15, 2)
  END AS est_amazon_fees,
  CASE
    WHEN lb.kk_product_id IS NULL
      OR lb.price IS NULL
      OR lb.price <= 0
      OR COALESCE(lb.kk_unit_cost, 0) <= 0 THEN NULL
    ELSE ROUND(
      lb.price
      - (
        COALESCE(lb.kk_unit_cost, 0)
        + CASE
            WHEN COALESCE(lb.kk_weight_g, 0) <= 0 THEN 0::numeric
            WHEN lb.kk_weight_g * 30 <= 2000 THEN
              ((88 + lb.kk_weight_g * 30 * 0.12) * 0.1437) / 30
            ELSE
              ((297 + lb.kk_weight_g * 30 * 0.0523) * 0.1437) / 30
          END
      )
      - (lb.price * 0.15),
      2
    )
  END AS est_profit
FROM listing_base lb;

COMMENT ON VIEW public.v_amazon_listing_workspace IS
  'Denormalized Amazon listing workspace. Stale detection, profit, price/inventory compare (Phase 5C–5D).';

GRANT SELECT ON public.v_amazon_listing_workspace TO authenticated, service_role;
