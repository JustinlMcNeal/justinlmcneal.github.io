-- ================================================================
-- Abandoned Cart Analytics View
-- Shows funnel metrics, recovery rate, and step-level performance
-- ================================================================

CREATE OR REPLACE VIEW sms_v_abandoned_cart AS
WITH cart_stats AS (
  SELECT
    status,
    COUNT(*)                                    AS cart_count,
    SUM(cart_value_cents)                        AS total_value_cents,
    AVG(cart_value_cents)                        AS avg_value_cents,
    AVG(item_count)                             AS avg_items,
    COUNT(*) FILTER (WHERE step_1_sent_at IS NOT NULL) AS step1_sent,
    COUNT(*) FILTER (WHERE step_2_sent_at IS NOT NULL) AS step2_sent,
    COUNT(*) FILTER (WHERE step_3_sent_at IS NOT NULL) AS step3_sent
  FROM saved_carts
  GROUP BY status
),
recovery AS (
  SELECT
    COUNT(*)                        AS purchased_count,
    SUM(cart_value_cents)            AS recovered_value_cents,
    AVG(EXTRACT(EPOCH FROM (purchased_at - abandoned_at)) / 3600)
      FILTER (WHERE abandoned_at IS NOT NULL AND purchased_at IS NOT NULL)
                                     AS avg_hours_to_purchase,
    COUNT(*) FILTER (WHERE step_1_sent_at IS NOT NULL AND step_2_sent_at IS NULL)
                                     AS converted_at_step1,
    COUNT(*) FILTER (WHERE step_2_sent_at IS NOT NULL AND step_3_sent_at IS NULL)
                                     AS converted_at_step2,
    COUNT(*) FILTER (WHERE step_3_sent_at IS NOT NULL)
                                     AS converted_at_step3
  FROM saved_carts
  WHERE status = 'purchased'
),
abandoner_profile AS (
  SELECT
    COUNT(*) FILTER (WHERE abandon_count = 0)  AS first_time,
    COUNT(*) FILTER (WHERE abandon_count = 1)  AS second_time,
    COUNT(*) FILTER (WHERE abandon_count = 2)  AS third_time,
    COUNT(*) FILTER (WHERE abandon_count >= 3) AS serial_abandoners
  FROM saved_carts
  WHERE status IN ('active', 'expired')
)
SELECT
  -- Funnel totals
  COALESCE((SELECT SUM(cart_count) FROM cart_stats), 0)                     AS total_carts,
  COALESCE((SELECT cart_count FROM cart_stats WHERE status = 'active'), 0)  AS active_carts,
  COALESCE((SELECT cart_count FROM cart_stats WHERE status = 'purchased'), 0) AS purchased_carts,
  COALESCE((SELECT cart_count FROM cart_stats WHERE status = 'expired'), 0)  AS expired_carts,

  -- Step send counts
  COALESCE((SELECT SUM(step1_sent) FROM cart_stats), 0) AS step1_sends,
  COALESCE((SELECT SUM(step2_sent) FROM cart_stats), 0) AS step2_sends,
  COALESCE((SELECT SUM(step3_sent) FROM cart_stats), 0) AS step3_sends,

  -- Recovery metrics
  COALESCE(r.purchased_count, 0)                        AS total_recovered,
  COALESCE(r.recovered_value_cents, 0)                  AS recovered_value_cents,
  ROUND(COALESCE(r.avg_hours_to_purchase, 0)::numeric, 1) AS avg_hours_to_purchase,

  -- Step-level conversion
  COALESCE(r.converted_at_step1, 0) AS converted_at_step1,
  COALESCE(r.converted_at_step2, 0) AS converted_at_step2,
  COALESCE(r.converted_at_step3, 0) AS converted_at_step3,

  -- Recovery rate
  CASE WHEN COALESCE((SELECT SUM(step1_sent) FROM cart_stats), 0) > 0
    THEN ROUND(COALESCE(r.purchased_count, 0)::numeric
         / (SELECT SUM(step1_sent) FROM cart_stats)::numeric * 100, 1)
    ELSE 0 END                                          AS recovery_rate_pct,

  -- Abandoner profile
  COALESCE(ap.first_time, 0)       AS first_time_abandoners,
  COALESCE(ap.second_time, 0)      AS second_time_abandoners,
  COALESCE(ap.third_time, 0)       AS third_time_abandoners,
  COALESCE(ap.serial_abandoners, 0) AS serial_abandoners

FROM recovery r
CROSS JOIN abandoner_profile ap;
