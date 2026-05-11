-- 20260511_ebay_finance_v3_cpi.sql
--
-- Reconciliation: consistent CPI cost basis for eBay profit across all three surfaces.
--
-- Audit findings (order EBAY-25-14595-84685):
--   Table row  : ebay_net_profit_cents = -$0.35 (unit_cost $0.62 only — missing supplier ship)
--   Modal      : profitCents           = -$1.38 (CPI = unit_cost $0.62 + supplier_ship $1.03 ✓)
--   KPI        : v_order_financials    = +$2.89 (WRONG — uses total_paid_cents not eBay earnings)
--
-- Fix 1: Recreate v_ebay_order_profit with CPI in item_costs.
--   Supplier shipping formula mirrors js/admin/pStorage/profitCalc.js (EUB/HK-UPS):
--     EUB    : (88 + weight_g*30*0.12)   * 0.1437 / 30  [totalWeight ≤ 2000g]
--     HK-UPS : (297 + weight_g*30*0.0523)* 0.1437 / 30  [totalWeight > 2000g]
--   product_cost_cents = (unit_cost + supplier_ship_per_unit) * quantity
--
-- Fix 2: Recreate v_order_summary_plus to override profit_cents for eBay orders.
--   When finance_status is 'complete' or 'estimated_no_ad_fee', use ebay_net_profit_cents
--   (which now uses CPI + correct eBay earnings as revenue). All other orders are unchanged.
--   This fixes the KPI, which sums v_order_summary_plus.profit_cents.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Recreate v_ebay_order_profit with CPI ────────────────────────────

DROP VIEW IF EXISTS public.v_ebay_order_profit;

CREATE VIEW public.v_ebay_order_profit AS
WITH sale_txn AS (
  SELECT
    stripe_checkout_session_id,
    ebay_order_id,
    amount_cents                  AS sale_amount_cents,
    total_fee_cents               AS sale_fee_cents,
    fee_final_value_cents,
    fee_regulatory_cents,
    fee_international_cents,
    fee_other_cents,
    fee_breakdown                 AS sale_fee_breakdown,
    transaction_date              AS finance_synced_at
  FROM public.ebay_finance_transactions
  WHERE transaction_type = 'SALE'
),
order_charges AS (
  SELECT
    stripe_checkout_session_id,
    SUM(amount_cents)             AS total_charge_cents,
    jsonb_agg(
      jsonb_build_object(
        'transaction_id', transaction_id,
        'amount_cents',   amount_cents,
        'fee_breakdown',  fee_breakdown
      )
    )                             AS charge_rows
  FROM public.ebay_finance_transactions
  WHERE transaction_type = 'NON_SALE_CHARGE'
  GROUP BY stripe_checkout_session_id
),
item_costs AS (
  -- CPI = unit_cost + supplier_ship_per_unit, matching js/admin/pStorage/profitCalc.js.
  -- Supplier ship uses EUB for totalWeight (weight_g * 30) ≤ 2000g, HK-UPS above that.
  -- CNY→USD rate: 0.1437 (same constant as JS).
  SELECT
    li.stripe_checkout_session_id,
    ROUND(
      SUM(
        (
          COALESCE(p.unit_cost, 0::numeric)
          +
          CASE
            WHEN COALESCE(p.weight_g, 0::numeric) <= 0 THEN 0
            WHEN p.weight_g * 30 <= 2000 THEN
              ((88 + p.weight_g * 30 * 0.12) * 0.1437) / 30
            ELSE
              ((297 + p.weight_g * 30 * 0.0523) * 0.1437) / 30
          END
        ) * li.quantity::numeric
      ) * 100
    )::integer AS product_cost_cents
  FROM public.line_items_raw li
  LEFT JOIN public.products p ON p.code = li.product_id
  GROUP BY li.stripe_checkout_session_id
)
SELECT
  o.stripe_checkout_session_id,
  o.kk_order_id,

  -- Buyer-side amounts (from orders_raw, sourced from Fulfillment API)
  o.subtotal_paid_cents                                    AS buyer_subtotal_cents,
  o.tax_cents                                              AS buyer_tax_cents,
  o.total_paid_cents                                       AS buyer_total_cents,

  -- SALE transaction details from Finances API
  st.sale_amount_cents,
  st.sale_fee_cents,
  st.fee_final_value_cents,
  st.fee_regulatory_cents,
  st.fee_international_cents,
  st.fee_other_cents,
  st.sale_fee_breakdown,
  st.finance_synced_at,

  -- Per-order ad / promoted listing charges captured from NON_SALE_CHARGE rows
  COALESCE(oc.total_charge_cents, 0)                       AS per_order_ad_fee_cents,
  oc.charge_rows                                           AS ad_fee_breakdown,

  -- True eBay seller earnings for this order:
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
      THEN st.sale_amount_cents - COALESCE(oc.total_charge_cents, 0)
    ELSE NULL
  END                                                      AS ebay_order_earnings_cents,

  -- Combined eBay fee total visible to the UI
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
      THEN st.sale_fee_cents + COALESCE(oc.total_charge_cents, 0)
    ELSE NULL
  END                                                      AS ebay_total_fee_cents,

  -- Internal seller costs (CPI = unit_cost + supplier_ship from weight formula)
  COALESCE(ic.product_cost_cents, 0)                       AS product_cost_cents,
  fs.label_cost_cents                                      AS shippo_label_cost_cents,

  -- Net profit using CPI cost basis.
  -- Returns NULL for estimated status (ad fee not yet captured → profit unknown).
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
         AND (oc.total_charge_cents IS NOT NULL OR
              st.finance_synced_at < NOW() - INTERVAL '2 days')
         AND fs.label_cost_cents IS NOT NULL
      THEN (st.sale_amount_cents - COALESCE(oc.total_charge_cents, 0))
           - COALESCE(ic.product_cost_cents, 0)
           - COALESCE(fs.label_cost_cents, 0)
    ELSE NULL
  END                                                      AS ebay_net_profit_cents,

  -- Finance status
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NOT NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'complete'
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NULL
         AND st.finance_synced_at >= NOW() - INTERVAL '2 days'
         AND fs.label_cost_cents IS NOT NULL
      THEN 'estimated'
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NULL
         AND st.finance_synced_at < NOW() - INTERVAL '2 days'
         AND fs.label_cost_cents IS NOT NULL
      THEN 'estimated_no_ad_fee'
    WHEN st.sale_amount_cents IS NOT NULL
         AND fs.label_cost_cents IS NULL
      THEN 'partial'
    WHEN st.sale_amount_cents IS NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'pending_finances'
    ELSE 'missing'
  END                                                      AS finance_status

FROM public.orders_raw o
LEFT JOIN sale_txn       st ON st.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN order_charges  oc ON oc.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN item_costs     ic ON ic.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN public.fulfillment_shipments fs
                         ON fs.stripe_checkout_session_id = o.stripe_checkout_session_id
WHERE o.stripe_checkout_session_id LIKE 'ebay_api_%'
   OR o.stripe_checkout_session_id LIKE 'ebay_%';

GRANT SELECT ON public.v_ebay_order_profit TO anon, authenticated, service_role;


-- ── Step 2: Recreate v_order_summary_plus to override profit_cents for eBay orders ──
--
-- JOIN v_ebay_order_profit and substitute ebay_net_profit_cents for complete/estimated_no_ad_fee
-- eBay orders. Non-eBay orders are unchanged (use v_order_financials.profit_cents as before).
-- This fixes the KPI total, which sums this view's profit_cents.

CREATE OR REPLACE VIEW public.v_order_summary_plus AS
SELECT
  s.*,
  f.product_cost_total_cents,
  f.label_cost_cents,
  f.label_status,
  -- For eBay orders where Finance API profit is reliable, use it (correct revenue + CPI).
  -- For all other orders (non-eBay, or eBay without complete finance data), use the
  -- standard v_order_financials profit (total_paid_cents - unit_cost - label).
  COALESCE(
    CASE
      WHEN ep.finance_status IN ('complete', 'estimated_no_ad_fee')
      THEN ep.ebay_net_profit_cents::integer
    END,
    f.profit_cents
  )                              AS profit_cents,
  f.refund_status,
  f.refund_reason,
  f.refund_amount_cents
FROM public.v_order_summary s
LEFT JOIN public.v_order_financials  f  USING (stripe_checkout_session_id)
LEFT JOIN public.v_ebay_order_profit ep USING (stripe_checkout_session_id);

GRANT SELECT ON public.v_order_summary_plus TO anon, authenticated;
