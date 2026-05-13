-- ─────────────────────────────────────────────────────────────────────────────
-- 20260512_ebay_listing_workspace_view.sql
-- Phase 1: eBay Listing Workspace read-only view.
--
-- Creates public.v_ebay_listing_workspace — a single denormalized read model
-- for the eBay Listings admin page that surfaces product data, eBay local state,
-- product readiness, and per-product eBay sales metrics in one query.
--
-- ── Join strategy ─────────────────────────────────────────────────────────────
--
--   Sales data:
--     line_items_raw.product_id = products.code
--     This join is already established in production by v_ebay_order_profit's
--     item_costs CTE. Confirmed reliable.
--
--   eBay order filter:
--     orders_raw.stripe_checkout_session_id LIKE 'ebay_api_%'
--     OR orders_raw.stripe_checkout_session_id LIKE 'ebay_%'
--     Exact same filter used in v_ebay_order_profit.
--
--   Time windows:
--     orders_raw.order_date (timestamptz) — confirmed column from import RPC.
--
-- ── Blocked metrics (NULL in Phase 1) ─────────────────────────────────────────
--
--   ebay_profit_cents_90d:
--     v_ebay_order_profit computes net profit at the order level, not the
--     line-item level. Attributing order-level profit to individual products
--     in multi-item orders requires revenue proration which adds complexity
--     and risk of misleading numbers. Deferred to Phase 2.
--
--   ebay_ad_fees_cents_90d:
--     ebay_finance_transactions NON_SALE_CHARGE rows are per-order, not
--     per-product. Same proration blocker as above. Deferred to Phase 2.
--
-- ── Issue flags logic ─────────────────────────────────────────────────────────
--
--   Five conservative, deterministic flags based on local data only:
--     missing_listing_id  — active status but ebay_listing_id is NULL
--     missing_category    — listed/draft/ended but no ebay_category_id
--     missing_ebay_price  — listed/draft/ended but no ebay_price_cents
--     low_image_count     — listed/draft/ended with < 3 gallery images
--     no_sales_30d        — active listing with 0 eBay units sold in 30 days
--
--   Flags use jsonb_strip_nulls so only triggered flags appear in the object.
--   issue_count is the integer sum of triggered flags for easy filtering.
--
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_ebay_listing_workspace AS
WITH

-- ── Variant readiness ─────────────────────────────────────────────────────────
-- Joins on products.id (UUID). Active-only counts and stock totals.
variant_stats AS (
  SELECT
    product_id,
    COUNT(*) FILTER (WHERE is_active)                             AS active_variant_count,
    COALESCE(SUM(COALESCE(stock, 0)) FILTER (WHERE is_active), 0) AS active_variant_stock_total
  FROM public.product_variants
  GROUP BY product_id
),

-- ── Gallery image readiness ───────────────────────────────────────────────────
-- Joins on products.id (UUID). Active-only image count.
gallery_stats AS (
  SELECT
    product_id,
    COUNT(*) FILTER (WHERE is_active) AS gallery_image_count
  FROM public.product_gallery_images
  GROUP BY product_id
),

-- ── eBay sales aggregates by product code ─────────────────────────────────────
-- Uses the established line_items_raw.product_id = products.code join.
-- Filters to eBay-only orders via the session_id prefix pattern.
-- Time windows are computed at query time using NOW().
-- avg_sold_price_cents_90d: simple average of line-item unit price in cents.
--   Null when no eBay sales in window.
ebay_sales AS (
  SELECT
    li.product_id                                                      AS product_code,

    COALESCE(SUM(li.quantity) FILTER (
      WHERE o.order_date >= NOW() - INTERVAL '30 days'
    ), 0)                                                              AS sold_qty_30d,

    COALESCE(SUM(li.quantity) FILTER (
      WHERE o.order_date >= NOW() - INTERVAL '90 days'
    ), 0)                                                              AS sold_qty_90d,

    MAX(o.order_date)                                                  AS last_sold_at,

    ROUND(
      AVG(li.unit_price_cents) FILTER (
        WHERE o.order_date >= NOW() - INTERVAL '90 days'
      )
    )::integer                                                         AS avg_sold_price_cents_90d

  FROM public.line_items_raw li
  JOIN public.orders_raw o
       ON o.stripe_checkout_session_id = li.stripe_checkout_session_id
  WHERE (
      o.stripe_checkout_session_id LIKE 'ebay_api_%'
   OR o.stripe_checkout_session_id LIKE 'ebay_%'
  )
    AND li.product_id IS NOT NULL
  GROUP BY li.product_id
)

-- ── Main query ────────────────────────────────────────────────────────────────
SELECT
  -- Product identity
  p.id                                                               AS product_id,
  p.code                                                             AS product_code,
  p.name                                                             AS product_name,
  p.slug,
  p.is_active,
  ROUND(p.price::numeric * 100)::integer                            AS kk_price_cents,
  p.weight_g,
  p.catalog_image_url,
  p.primary_image_url,

  -- eBay local state (persisted on products table)
  p.ebay_sku,
  p.ebay_offer_id,
  p.ebay_listing_id,
  p.ebay_status,
  p.ebay_category_id,
  p.ebay_price_cents,
  p.ebay_item_group_key,
  p.ebay_volume_promo_id,
  p.ebay_store_category,

  -- Product readiness
  COALESCE(vs.active_variant_count, 0)                              AS active_variant_count,
  COALESCE(vs.active_variant_stock_total, 0)                        AS active_variant_stock_total,
  COALESCE(gs.gallery_image_count, 0)                               AS gallery_image_count,

  -- Sales metrics (eBay only, product-level, real values).
  -- Sourced from line_items_raw JOIN orders_raw filtered by eBay session prefix.
  COALESCE(es.sold_qty_30d, 0)                                      AS sold_qty_30d,
  COALESCE(es.sold_qty_90d, 0)                                      AS sold_qty_90d,
  es.last_sold_at,
  es.avg_sold_price_cents_90d,

  -- Profit metrics: NULL in Phase 1.
  -- Blocked: v_ebay_order_profit is order-level. Attributing order profit to
  -- individual products in multi-item orders requires revenue proration that
  -- could produce misleading numbers. Implement in Phase 2.
  NULL::integer                                                     AS ebay_profit_cents_90d,

  -- Blocked: ebay_finance_transactions NON_SALE_CHARGE rows are per-order,
  -- not per-product. Same proration blocker as above. Phase 2.
  NULL::integer                                                     AS ebay_ad_fees_cents_90d,

  -- Issue flags: deterministic, conservative, local-data only.
  -- Uses jsonb_strip_nulls — only triggered flags appear in the returned object.
  -- Undefined/not-applicable flags are dropped (NULL → stripped by jsonb_strip_nulls).
  jsonb_strip_nulls(jsonb_build_object(

    'missing_listing_id',
      CASE WHEN COALESCE(p.ebay_status, 'not_listed') = 'active'
                AND p.ebay_listing_id IS NULL
           THEN TRUE ELSE NULL END,

    'missing_category',
      CASE WHEN COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
                AND p.ebay_category_id IS NULL
           THEN TRUE ELSE NULL END,

    'missing_ebay_price',
      CASE WHEN COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
                AND p.ebay_price_cents IS NULL
           THEN TRUE ELSE NULL END,

    'low_image_count',
      CASE WHEN COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
                AND COALESCE(gs.gallery_image_count, 0) < 3
           THEN TRUE ELSE NULL END,

    'no_sales_30d',
      CASE WHEN COALESCE(p.ebay_status, 'not_listed') = 'active'
                AND COALESCE(es.sold_qty_30d, 0) = 0
           THEN TRUE ELSE NULL END

  ))                                                                AS issue_flags,

  -- issue_count: integer count of triggered flags (for easy filtering/badging).
  -- Mirrors the flag logic above — must be kept in sync.
  (
    CASE WHEN COALESCE(p.ebay_status, 'not_listed') = 'active'
              AND p.ebay_listing_id IS NULL
         THEN 1 ELSE 0 END
    +
    CASE WHEN COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
              AND p.ebay_category_id IS NULL
         THEN 1 ELSE 0 END
    +
    CASE WHEN COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
              AND p.ebay_price_cents IS NULL
         THEN 1 ELSE 0 END
    +
    CASE WHEN COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
              AND COALESCE(gs.gallery_image_count, 0) < 3
         THEN 1 ELSE 0 END
    +
    CASE WHEN COALESCE(p.ebay_status, 'not_listed') = 'active'
              AND COALESCE(es.sold_qty_30d, 0) = 0
         THEN 1 ELSE 0 END
  )                                                                 AS issue_count

FROM public.products p
LEFT JOIN variant_stats vs ON vs.product_id = p.id
LEFT JOIN gallery_stats gs ON gs.product_id = p.id
LEFT JOIN ebay_sales    es ON es.product_code = p.code;

-- ── Permissions ───────────────────────────────────────────────────────────────
-- Matches pattern used by v_ebay_order_profit (see 20260511_ebay_finance_v4_status.sql).
-- anon not granted — this is admin-only data.
GRANT SELECT ON public.v_ebay_listing_workspace TO authenticated, service_role;
