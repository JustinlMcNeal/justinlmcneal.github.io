-- ================================================================
-- Migration: sms_v_flow_performance_dated
-- Companion view to sms_v_flow_performance that adds a sent_date
-- DATE dimension, enabling date-bounded queries from the V1 report
-- script and any future tooling.
--
-- The existing sms_v_flow_performance view is NOT modified.
-- ================================================================

CREATE OR REPLACE VIEW sms_v_flow_performance_dated AS
SELECT
  DATE(s.created_at AT TIME ZONE 'America/New_York')      AS sent_date,
  s.flow,
  s.campaign,
  s.intent,
  COUNT(*)                                              AS total_sends,
  SUM(CASE WHEN m.status = 'delivered' THEN 1
           WHEN m.status = 'sent'      THEN 1
           ELSE 0 END)                                  AS delivered,
  COUNT(DISTINCT e_click.phone)                         AS unique_clicks,
  SUM(CASE WHEN s.outcome = 'converted' THEN 1 ELSE 0 END) AS conversions,
  ROUND(
    CASE WHEN COUNT(*) > 0
         THEN SUM(CASE WHEN s.outcome = 'converted' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100
         ELSE 0 END, 2)                                 AS conversion_rate_pct,
  SUM(s.cost)                                           AS sms_cost,
  COALESCE(SUM(oa.total_paid_cents), 0) / 100.0          AS attributed_revenue,
  COALESCE(SUM(oa.total_savings_cents), 0) / 100.0       AS discounts_issued,
  -- Profit = revenue - cost_of_goods - sms_cost
  ROUND(
    (COALESCE(SUM(oa.total_paid_cents), 0)
     - COALESCE(SUM(oa.total_cost_cents), 0)
    ) / 100.0
    - COALESCE(SUM(s.cost), 0), 2)                      AS estimated_profit,
  -- Profit per SMS
  ROUND(
    CASE WHEN COUNT(*) > 0
         THEN ((COALESCE(SUM(oa.total_paid_cents), 0) - COALESCE(SUM(oa.total_cost_cents), 0)) / 100.0
               - COALESCE(SUM(s.cost), 0)) / COUNT(*)
         ELSE 0 END, 4)                                 AS profit_per_sms
FROM sms_sends s
LEFT JOIN sms_messages m ON m.id = s.sms_message_id
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (ev.phone) ev.phone
  FROM sms_events ev
  WHERE ev.event_type = 'sms_clicked'
    AND ev.sms_send_id = s.id
) e_click ON true
-- Pre-aggregate orders per send to prevent row multiplication
LEFT JOIN (
  SELECT sms_send_id,
    SUM(total_paid_cents)          AS total_paid_cents,
    SUM(order_cost_total_cents)    AS total_cost_cents,
    SUM(order_savings_total_cents) AS total_savings_cents
  FROM orders_raw
  WHERE sms_attributed = true AND sms_send_id IS NOT NULL
  GROUP BY sms_send_id
) oa ON oa.sms_send_id = s.id
GROUP BY DATE(s.created_at AT TIME ZONE 'America/New_York'), s.flow, s.campaign, s.intent;

-- ────────────────────────────────────────────────────────────
-- Grants (mirror pattern of existing sms_v_* views)
-- ────────────────────────────────────────────────────────────
GRANT SELECT ON sms_v_flow_performance_dated TO anon;
GRANT SELECT ON sms_v_flow_performance_dated TO authenticated;
GRANT SELECT ON sms_v_flow_performance_dated TO service_role;
