-- ================================================================
-- SMS COUPON STRATEGY ANALYSIS
-- Run this in Supabase SQL Editor to determine optimal coupon values
-- ================================================================

-- 1. Overall KPIs
SELECT
  COUNT(*)                                       AS total_orders,
  ROUND(AVG(total_paid_cents) / 100.0, 2)        AS avg_order_value,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_paid_cents) / 100.0, 2) AS median_order_value,
  ROUND(AVG(total_paid_cents - COALESCE(order_cost_total_cents, 0)) / 100.0, 2)   AS avg_profit_per_order,
  ROUND(
    AVG(
      CASE WHEN total_paid_cents > 0
        THEN (total_paid_cents - COALESCE(order_cost_total_cents, 0))::NUMERIC / total_paid_cents * 100
        ELSE 0
      END
    ), 1
  )                                               AS avg_margin_pct
FROM orders_raw
WHERE refund_status IS NULL OR refund_status != 'full';

-- 2. Distribution by bracket
SELECT
  CASE
    WHEN total_paid_cents < 1500  THEN '$0-15'
    WHEN total_paid_cents < 2500  THEN '$15-25'
    WHEN total_paid_cents < 3500  THEN '$25-35'
    WHEN total_paid_cents < 5000  THEN '$35-50'
    WHEN total_paid_cents < 7500  THEN '$50-75'
    ELSE '$75+'
  END AS bracket,
  COUNT(*) AS orders,
  ROUND(COUNT(*)::NUMERIC / SUM(COUNT(*)) OVER () * 100, 1) AS pct_of_orders,
  ROUND(AVG(total_paid_cents) / 100.0, 2) AS avg_value
FROM orders_raw
WHERE refund_status IS NULL OR refund_status != 'full'
GROUP BY 1
ORDER BY MIN(total_paid_cents);

-- 3. Coupon usage patterns
SELECT
  CASE WHEN coupon_code_used IS NOT NULL AND coupon_code_used != '' THEN 'with_coupon' ELSE 'no_coupon' END AS segment,
  COUNT(*) AS orders,
  ROUND(AVG(total_paid_cents) / 100.0, 2) AS avg_order_value,
  ROUND(AVG(order_savings_total_cents) / 100.0, 2) AS avg_savings
FROM orders_raw
WHERE refund_status IS NULL OR refund_status != 'full'
GROUP BY 1;

-- ================================================================
-- AFTER REVIEWING: Update site_settings with your chosen values
-- Example (15% off $40+ minimum):
--
-- INSERT INTO site_settings (key, value) VALUES ('sms_coupon', '{
--   "type": "percentage",
--   "value": 15,
--   "min_order_amount": 40,
--   "expiry_days": 2,
--   "prefix": "SMS",
--   "scope_type": "all"
-- }')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- ================================================================
