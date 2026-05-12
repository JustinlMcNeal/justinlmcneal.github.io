-- Migration: 20260509_sms_click_to_purchase_vip_label
-- Fix: attribution_method CASE now labels both SMS-% and VIP-% orders as 'direct_coupon'.
-- Previously only 'SMS-%' was matched; VIP- orders were incorrectly labeled 'click_attribution'.

CREATE OR REPLACE VIEW sms_v_click_to_purchase AS
SELECT
  o.id AS order_id,
  o.phone_number,
  o.coupon_code_used,
  o.total_paid_cents / 100.0 AS order_total,
  (o.total_paid_cents - COALESCE(o.order_cost_total_cents, 0)) / 100.0 AS order_profit,
  o.sms_click_at,
  o.order_date,
  ROUND(EXTRACT(EPOCH FROM (o.order_date - o.sms_click_at)) / 3600, 1) AS hours_click_to_purchase,
  CASE
    WHEN o.coupon_code_used LIKE 'SMS-%' THEN 'direct_coupon'
    WHEN o.coupon_code_used LIKE 'VIP-%' THEN 'direct_coupon'
    ELSE 'click_attribution'
  END AS attribution_method,
  s.flow,
  s.campaign
FROM orders_raw o
LEFT JOIN sms_sends s ON s.id = o.sms_send_id
WHERE o.sms_attributed = true
ORDER BY o.order_date DESC;
