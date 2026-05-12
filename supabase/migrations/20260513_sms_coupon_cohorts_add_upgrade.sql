-- 20260513_sms_coupon_cohorts_add_upgrade.sql
-- Extends sms_v_coupon_cohorts to include the 'upgrade' (VIP coupon) flow
-- as a new vip_upgrade cohort. Two changes from the original view:
--   1. CASE expression: added WHEN s.flow = 'upgrade' THEN 'vip_upgrade'
--   2. WHERE clause: added 'upgrade' to the flow IN list
-- Everything else is verbatim from 20260414_sms_analytics_views.sql.

CREATE OR REPLACE VIEW sms_v_coupon_cohorts AS
WITH coupon_data AS (
  SELECT
    CASE
      WHEN s.flow = 'coupon_escalation' THEN 'escalation_20pct'
      WHEN s.flow = 'upgrade'           THEN 'vip_upgrade'
      ELSE 'initial_15pct'
    END AS cohort,
    s.id AS send_id,
    s.phone,
    s.outcome,
    s.cost AS sms_cost,
    s.created_at AS send_at,
    p.code AS coupon_code,
    p.value AS coupon_value,
    p.usage_count,
    p.usage_limit
  FROM sms_sends s
  JOIN customer_contacts cc ON cc.id = s.contact_id
  LEFT JOIN promotions p ON p.code = cc.coupon_code
  WHERE s.flow IN ('signup', 'coupon_escalation', 'upgrade')
)
SELECT
  cohort,
  COUNT(*) AS total_coupons_issued,
  SUM(CASE WHEN usage_count >= usage_limit THEN 1 ELSE 0 END)  AS redeemed,
  ROUND(
    CASE WHEN COUNT(*) > 0
         THEN SUM(CASE WHEN usage_count >= usage_limit THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100
         ELSE 0 END, 2)                                          AS redemption_rate_pct,
  SUM(CASE WHEN outcome = 'converted' THEN 1 ELSE 0 END)        AS sms_attributed_orders,
  -- Join to pre-aggregated orders for AOV
  ROUND(AVG(
    CASE WHEN oa.total_paid_cents IS NOT NULL THEN oa.total_paid_cents / 100.0 END
  ), 2)                                                           AS avg_order_value,
  ROUND(AVG(
    CASE WHEN oa.total_paid_cents IS NOT NULL
         THEN (oa.total_paid_cents - COALESCE(oa.total_cost_cents, 0)) / 100.0
    END
  ), 2)                                                           AS avg_profit_per_order,
  SUM(COALESCE(oa.total_savings_cents, 0)) / 100.0                AS total_discounts_given,
  SUM(sms_cost)                                                   AS total_sms_cost
FROM coupon_data cd
-- Pre-aggregate orders per send to prevent row multiplication
LEFT JOIN (
  SELECT sms_send_id,
    SUM(total_paid_cents) AS total_paid_cents,
    SUM(order_cost_total_cents) AS total_cost_cents,
    SUM(order_savings_total_cents) AS total_savings_cents,
    COUNT(*) AS order_count
  FROM orders_raw
  WHERE sms_attributed = true AND sms_send_id IS NOT NULL
  GROUP BY sms_send_id
) oa ON oa.sms_send_id = cd.send_id
GROUP BY cohort
ORDER BY cohort;
