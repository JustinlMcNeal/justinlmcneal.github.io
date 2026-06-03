-- Use marketplace Finances API earnings for analytics channel_day revenue when available.
-- Falls back to orders_raw.total_paid_cents (buyer total) when finance data is missing.
-- Website channel is unchanged (Stripe checkout totals).

DROP FUNCTION IF EXISTS analytics_order_revenue_cents(text, integer, integer, text, integer);

CREATE OR REPLACE FUNCTION analytics_order_revenue_cents(
  p_session_id text,
  p_total_paid_cents integer,
  p_ebay_earnings_cents bigint,
  p_ebay_finance_status text,
  p_amazon_earnings_cents bigint
)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN p_session_id LIKE 'ebay_%'
         AND p_ebay_earnings_cents IS NOT NULL
         AND COALESCE(p_ebay_finance_status, '') <> 'estimated'
      THEN p_ebay_earnings_cents
    WHEN p_session_id LIKE 'amazon_%'
         AND p_amazon_earnings_cents IS NOT NULL
      THEN p_amazon_earnings_cents
    ELSE COALESCE(p_total_paid_cents, 0)
  END;
$function$;

CREATE OR REPLACE FUNCTION analytics_refresh_day(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_channel_rows integer := 0;
  v_product_rows integer := 0;
  v_abandoned integer := 0;
  v_recovered integer := 0;
BEGIN
  INSERT INTO analytics_daily (
    metric_date, channel, grain_type, product_bucket,
    orders_count, units_sold, revenue_cents,
    abandoned_carts, recovered_carts, views
  )
  WITH order_base AS (
    SELECT
      analytics_channel_from_session(o.stripe_checkout_session_id) AS channel,
      o.stripe_checkout_session_id,
      analytics_order_revenue_cents(
        o.stripe_checkout_session_id,
        o.total_paid_cents,
        ep.ebay_order_earnings_cents,
        ep.finance_status,
        ap.amazon_order_earnings_cents
      ) AS revenue_cents
    FROM orders_raw o
    LEFT JOIN v_ebay_order_profit ep
      ON ep.stripe_checkout_session_id = o.stripe_checkout_session_id
    LEFT JOIN v_amazon_order_profit ap
      ON ap.stripe_checkout_session_id = o.stripe_checkout_session_id
    WHERE (o.order_date AT TIME ZONE 'UTC')::date = p_day
  ),
  unit_base AS (
    SELECT
      analytics_channel_from_session(li.stripe_checkout_session_id) AS channel,
      SUM(COALESCE(li.quantity, 0))::int AS units_sold
    FROM line_items_raw li
    WHERE (li.order_date AT TIME ZONE 'UTC')::date = p_day
    GROUP BY 1
  )
  SELECT
    p_day,
    ob.channel,
    'channel_day',
    '__channel__',
    COUNT(DISTINCT ob.stripe_checkout_session_id)::int,
    COALESCE(ub.units_sold, 0),
    SUM(ob.revenue_cents)::int,
    0,
    0,
    0
  FROM order_base ob
  LEFT JOIN unit_base ub ON ub.channel = ob.channel
  GROUP BY ob.channel, ub.units_sold
  ON CONFLICT (metric_date, channel, grain_type, product_bucket)
  DO UPDATE SET
    orders_count = EXCLUDED.orders_count,
    units_sold = EXCLUDED.units_sold,
    revenue_cents = EXCLUDED.revenue_cents,
    abandoned_carts = EXCLUDED.abandoned_carts,
    recovered_carts = EXCLUDED.recovered_carts,
    views = EXCLUDED.views,
    updated_at = now();

  GET DIAGNOSTICS v_channel_rows = ROW_COUNT;

  SELECT COUNT(*)::int
  INTO v_abandoned
  FROM saved_carts s
  WHERE s.abandoned_at IS NOT NULL
    AND (s.abandoned_at AT TIME ZONE 'UTC')::date = p_day;

  SELECT COUNT(*)::int
  INTO v_recovered
  FROM saved_carts s
  WHERE s.purchased_at IS NOT NULL
    AND s.abandoned_at IS NOT NULL
    AND (s.purchased_at AT TIME ZONE 'UTC')::date = p_day;

  INSERT INTO analytics_daily (
    metric_date, channel, grain_type, product_bucket,
    orders_count, units_sold, revenue_cents,
    abandoned_carts, recovered_carts, views
  )
  VALUES (
    p_day, 'website', 'channel_day', '__channel__',
    0, 0, 0,
    COALESCE(v_abandoned, 0), COALESCE(v_recovered, 0), 0
  )
  ON CONFLICT (metric_date, channel, grain_type, product_bucket)
  DO UPDATE SET
    abandoned_carts = EXCLUDED.abandoned_carts,
    recovered_carts = EXCLUDED.recovered_carts,
    updated_at = now();

  INSERT INTO analytics_daily (
    metric_date, channel, grain_type, product_bucket,
    product_code, product_id,
    orders_count, units_sold, revenue_cents,
    abandoned_carts, recovered_carts, views
  )
  SELECT
    p_day,
    analytics_channel_from_session(li.stripe_checkout_session_id) AS channel,
    'product_day' AS grain_type,
    COALESCE(p.id::text, '__unmatched__') AS product_bucket,
    COALESCE(NULLIF(li.product_id, ''), '__unmatched__') AS product_code,
    p.id AS product_id,
    COUNT(DISTINCT li.stripe_checkout_session_id)::int AS orders_count,
    SUM(COALESCE(li.quantity, 0))::int AS units_sold,
    SUM(COALESCE(li.post_discount_unit_price_cents, li.unit_price_cents, 0) * COALESCE(li.quantity, 0))::int AS revenue_cents,
    0,
    0,
    0
  FROM line_items_raw li
  LEFT JOIN products p ON p.code = li.product_id
  WHERE (li.order_date AT TIME ZONE 'UTC')::date = p_day
  GROUP BY 1,2,3,4,5,6
  ON CONFLICT (metric_date, channel, grain_type, product_bucket)
  DO UPDATE SET
    product_code = EXCLUDED.product_code,
    product_id = EXCLUDED.product_id,
    orders_count = EXCLUDED.orders_count,
    units_sold = EXCLUDED.units_sold,
    revenue_cents = EXCLUDED.revenue_cents,
    abandoned_carts = EXCLUDED.abandoned_carts,
    recovered_carts = EXCLUDED.recovered_carts,
    views = EXCLUDED.views,
    updated_at = now();

  GET DIAGNOSTICS v_product_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'metric_date', p_day,
    'channel_rows_upserted', v_channel_rows,
    'product_rows_upserted', v_product_rows,
    'website_abandoned_carts', COALESCE(v_abandoned, 0),
    'website_recovered_carts', COALESCE(v_recovered, 0)
  );
END;
$function$;

COMMENT ON FUNCTION analytics_order_revenue_cents IS
  'Analytics revenue helper: eBay/Amazon use Finances API earnings when synced; otherwise buyer total_paid_cents.';

GRANT EXECUTE ON FUNCTION analytics_order_revenue_cents TO authenticated;
