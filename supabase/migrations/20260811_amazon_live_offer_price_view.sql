-- Use SP-API offers[].price (customer-facing) for workspace price + KK compare fields.

CREATE OR REPLACE FUNCTION public.amazon_listing_live_offer_price(
  raw_listing jsonb,
  marketplace_id text
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(BTRIM(COALESCE(
    o->'price'->>'amount',
    o->'price'->>'value'
  )), '')::numeric
  FROM jsonb_array_elements(COALESCE(raw_listing->'offers', '[]'::jsonb)) AS o
  WHERE (
    marketplace_id IS NULL
    OR BTRIM(marketplace_id) = ''
    OR o->>'marketplaceId' IS NULL
    OR o->>'marketplaceId' = marketplace_id
  )
  ORDER BY CASE
    WHEN o->>'marketplaceId' = marketplace_id THEN 0
    ELSE 1
  END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.amazon_listing_attribute_offer_price(
  raw_listing jsonb,
  marketplace_id text
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(BTRIM(COALESCE(
    raw_listing->'attributes'->'purchasable_offer'->0->'our_price'->0->'schedule'->0->'value_with_tax'->>'value',
    raw_listing->'attributes'->'purchasable_offer'->0->'our_price'->0->'schedule'->0->>'value'
  )), '')::numeric;
$$;

-- Backfill stored price from latest synced raw_listing when manual patch diverged from live offer.
UPDATE public.amazon_listings al
SET
  price = public.amazon_listing_live_offer_price(al.raw_listing, al.marketplace_id),
  price_last_source = 'listings',
  price_synced_at = COALESCE(al.price_synced_at, al.last_synced_at, now()),
  updated_at = now()
WHERE public.amazon_listing_live_offer_price(al.raw_listing, al.marketplace_id) IS NOT NULL
  AND (
    al.price IS NULL
    OR ABS(
      al.price - public.amazon_listing_live_offer_price(al.raw_listing, al.marketplace_id)
    ) >= 0.01
  );

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
    COALESCE(mp.kk_sku, p.code)     AS kk_sku,
    p.name                          AS kk_product_title,
    p.price                         AS kk_price,
    p.unit_cost                     AS kk_unit_cost,
    p.weight_g                      AS kk_weight_g,
    COALESCE(vs.kk_stock_total, 0)  AS kk_stock,
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
  'Denormalized Amazon listing workspace. Price/compare uses live SP-API offer when present.';

GRANT SELECT ON public.v_amazon_listing_workspace TO authenticated, service_role;
