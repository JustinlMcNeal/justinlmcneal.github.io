-- ================================================================
-- SMS Analytics Views
-- 6 views for immediate visibility into SMS system performance
-- ================================================================

-- ────────────────────────────────────────────────────────────
-- VIEW 1: Flow Performance
-- Sends, clicks, conversions, revenue, profit per flow/campaign
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sms_v_flow_performance AS
SELECT
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
  SUM(s.cost)                                           AS total_sms_cost,
  COALESCE(SUM(oa.total_paid_cents), 0) / 100.0          AS attributed_revenue,
  COALESCE(SUM(oa.total_savings_cents), 0) / 100.0       AS total_discount_given,
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
         ELSE 0 END, 4)                                 AS profit_per_sms,
  MIN(s.created_at)                                     AS first_send,
  MAX(s.created_at)                                     AS last_send
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
    SUM(total_paid_cents) AS total_paid_cents,
    SUM(order_cost_total_cents) AS total_cost_cents,
    SUM(order_savings_total_cents) AS total_savings_cents
  FROM orders_raw
  WHERE sms_attributed = true AND sms_send_id IS NOT NULL
  GROUP BY sms_send_id
) oa ON oa.sms_send_id = s.id
GROUP BY s.flow, s.campaign, s.intent
ORDER BY total_sends DESC;

-- ────────────────────────────────────────────────────────────
-- VIEW 2: Coupon Cohort Comparison
-- 15% initial vs 20% escalation: redemption rate, AOV, profit
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sms_v_coupon_cohorts AS
WITH coupon_data AS (
  SELECT
    CASE
      WHEN s.flow = 'coupon_escalation' THEN 'escalation_20pct'
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
  WHERE s.flow IN ('signup', 'coupon_escalation')
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

-- ────────────────────────────────────────────────────────────
-- VIEW 3: Send Outcome Aging
-- pending/converted/not_converted by flow/campaign + age
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sms_v_outcome_aging AS
SELECT
  flow,
  campaign,
  outcome,
  COUNT(*)                                                          AS send_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(converted_at, NOW()) - created_at)) / 3600), 1) AS avg_hours_to_resolve,
  MIN(created_at)                                                   AS oldest_send,
  MAX(created_at)                                                   AS newest_send,
  SUM(cost)                                                         AS total_cost
FROM sms_sends
GROUP BY flow, campaign, outcome
ORDER BY flow, campaign, outcome;

-- ────────────────────────────────────────────────────────────
-- VIEW 4: Click-to-Purchase Lag
-- How long after SMS click do people buy?
-- Validates the 48-hour attribution window
-- ────────────────────────────────────────────────────────────
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
    ELSE 'click_attribution'
  END AS attribution_method,
  s.flow,
  s.campaign
FROM orders_raw o
LEFT JOIN sms_sends s ON s.id = o.sms_send_id
WHERE o.sms_attributed = true
ORDER BY o.order_date DESC;

-- ────────────────────────────────────────────────────────────
-- VIEW 5: Subscriber Funnel
-- subscribed → clicked → redeemed → purchased
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sms_v_subscriber_funnel AS
WITH contacts AS (
  SELECT
    cc.id,
    cc.phone,
    cc.status,
    cc.coupon_code,
    cc.opted_in_at,
    cc.opted_out_at
  FROM customer_contacts cc
),
clicks AS (
  SELECT DISTINCT phone
  FROM sms_events
  WHERE event_type = 'sms_clicked'
),
redemptions AS (
  SELECT DISTINCT cc.phone
  FROM customer_contacts cc
  JOIN promotions p ON p.code = cc.coupon_code
  WHERE p.usage_count >= p.usage_limit
),
purchases AS (
  SELECT DISTINCT cc.phone
  FROM customer_contacts cc
  JOIN orders_raw o ON o.sms_attributed = true AND o.sms_send_id IS NOT NULL
  JOIN sms_sends s ON s.id = o.sms_send_id AND s.contact_id = cc.id
)
SELECT
  COUNT(*)                                                              AS total_subscribers,
  SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END)                 AS active_subscribers,
  SUM(CASE WHEN c.status = 'unsubscribed' THEN 1 ELSE 0 END)           AS unsubscribed,
  SUM(CASE WHEN cl.phone IS NOT NULL THEN 1 ELSE 0 END)                AS clicked,
  SUM(CASE WHEN r.phone IS NOT NULL THEN 1 ELSE 0 END)                 AS redeemed_coupon,
  SUM(CASE WHEN p.phone IS NOT NULL THEN 1 ELSE 0 END)                 AS purchased,
  -- Funnel rates
  ROUND(CASE WHEN COUNT(*) > 0
    THEN SUM(CASE WHEN cl.phone IS NOT NULL THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100
    ELSE 0 END, 1)                                                      AS click_rate_pct,
  ROUND(CASE WHEN SUM(CASE WHEN cl.phone IS NOT NULL THEN 1 ELSE 0 END) > 0
    THEN SUM(CASE WHEN r.phone IS NOT NULL THEN 1 ELSE 0 END)::numeric
         / SUM(CASE WHEN cl.phone IS NOT NULL THEN 1 ELSE 0 END) * 100
    ELSE 0 END, 1)                                                      AS click_to_redeem_pct,
  ROUND(CASE WHEN SUM(CASE WHEN r.phone IS NOT NULL THEN 1 ELSE 0 END) > 0
    THEN SUM(CASE WHEN p.phone IS NOT NULL THEN 1 ELSE 0 END)::numeric
         / SUM(CASE WHEN r.phone IS NOT NULL THEN 1 ELSE 0 END) * 100
    ELSE 0 END, 1)                                                      AS redeem_to_purchase_pct,
  ROUND(CASE WHEN COUNT(*) > 0
    THEN SUM(CASE WHEN p.phone IS NOT NULL THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100
    ELSE 0 END, 1)                                                      AS overall_conversion_pct
FROM contacts c
LEFT JOIN clicks cl ON cl.phone = c.phone
LEFT JOIN redemptions r ON r.phone = c.phone
LEFT JOIN purchases p ON p.phone = c.phone;

-- ────────────────────────────────────────────────────────────
-- VIEW 6: Message Fatigue & Unsubscribe Monitor
-- Sends per contact, STOP rate, bounce rate, fatigue buckets
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sms_v_fatigue_monitor AS
WITH contact_stats AS (
  SELECT
    cc.id,
    cc.phone,
    cc.status,
    cc.fatigue_score,
    cc.opted_in_at,
    cc.opted_out_at,
    COUNT(s.id)                                                         AS total_sends,
    SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS sends_7d,
    SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS sends_30d,
    COUNT(DISTINCT CASE WHEN e.event_type = 'sms_clicked' THEN e.id END) AS total_clicks,
    MAX(s.created_at)                                                   AS last_send_at
  FROM customer_contacts cc
  LEFT JOIN sms_sends s ON s.contact_id = cc.id
  LEFT JOIN sms_events e ON e.phone = cc.phone
  GROUP BY cc.id, cc.phone, cc.status, cc.fatigue_score, cc.opted_in_at, cc.opted_out_at
)
SELECT
  -- Summary stats
  COUNT(*)                                                               AS total_contacts,
  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)                    AS active,
  SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END)              AS stopped,
  SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END)                   AS bounced,
  ROUND(CASE WHEN COUNT(*) > 0
    THEN SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100
    ELSE 0 END, 1)                                                       AS stop_rate_pct,
  ROUND(CASE WHEN COUNT(*) > 0
    THEN SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100
    ELSE 0 END, 1)                                                       AS bounce_rate_pct,
  -- Fatigue buckets
  SUM(CASE WHEN COALESCE(fatigue_score, 0) < 3 THEN 1 ELSE 0 END)       AS fatigue_low,
  SUM(CASE WHEN fatigue_score >= 3 AND fatigue_score < 5 THEN 1 ELSE 0 END) AS fatigue_medium,
  SUM(CASE WHEN fatigue_score >= 5 THEN 1 ELSE 0 END)                   AS fatigue_high,
  -- Engagement
  ROUND(AVG(total_sends), 1)                                             AS avg_sends_per_contact,
  ROUND(AVG(sends_7d), 1)                                                AS avg_sends_7d,
  ROUND(AVG(total_clicks), 1)                                            AS avg_clicks_per_contact,
  -- Time-based
  ROUND(AVG(CASE WHEN status = 'unsubscribed' AND opted_out_at IS NOT NULL AND opted_in_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (opted_out_at - opted_in_at)) / 86400
    ELSE NULL END), 1)                                                   AS avg_days_to_stop
FROM contact_stats;

-- ────────────────────────────────────────────────────────────
-- VIEW 6b: Per-Contact Fatigue Detail
-- For drilling into individual contact health
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sms_v_contact_fatigue AS
SELECT
  cc.id,
  cc.phone,
  cc.status,
  cc.fatigue_score,
  cc.coupon_code,
  cc.opted_in_at,
  cc.opted_out_at,
  COUNT(s.id)                                                           AS total_sends,
  SUM(CASE WHEN s.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS sends_7d,
  COUNT(DISTINCT CASE WHEN e.event_type = 'sms_clicked' THEN e.id END) AS clicks,
  SUM(CASE WHEN s.outcome = 'converted' THEN 1 ELSE 0 END)             AS conversions,
  MAX(s.created_at)                                                     AS last_sms_at,
  MAX(CASE WHEN e.event_type = 'sms_clicked' THEN e.created_at END)     AS last_click_at
FROM customer_contacts cc
LEFT JOIN sms_sends s ON s.contact_id = cc.id
LEFT JOIN sms_events e ON e.phone = cc.phone
GROUP BY cc.id, cc.phone, cc.status, cc.fatigue_score, cc.coupon_code, cc.opted_in_at, cc.opted_out_at
ORDER BY total_sends DESC;
