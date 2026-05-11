-- 20260511_ebay_finance_v2.sql
-- Reconciliation fix for v_ebay_order_profit.
--
-- Root cause:
--   SALE.amount_cents is the seller payout after eBay deducts only the fees embedded in that
--   SALE transaction (Final Value Fee, Fixed Per Order Fee). Promoted Listing / Ad fees are
--   billed as SEPARATE NON_SALE_CHARGE transactions with the same orderId.  These were
--   previously captured only in the expenses table; they are now also stored in
--   ebay_finance_transactions (transaction_type = 'NON_SALE_CHARGE') by the updated
--   ebay-sync-finances edge function.
--
-- Fix:
--   1. Add `order_charges` CTE that sums all NON_SALE_CHARGE rows per order.
--   2. Redefine ebay_order_earnings_cents = SALE.amount_cents - per_order_charges.
--   3. Expose per_order_ad_fee_cents so the UI can show the exact deduction.
--   4. Tighten finance_status so `complete` requires ad fees explicitly captured.
--      - complete:          SALE + per-order charges row(s) + label
--      - estimated:         SALE + label, NO per-order charge rows
--                           (profit shown with ≈ badge — possible ad fee not yet synced)
--      - partial:           SALE only, no label yet
--      - pending_finances:  label purchased, SALE not yet synced by Finances API
--      - missing:           neither SALE nor label
-- ─────────────────────────────────────────────────────────────────────────────

-- DROP the old view first because we are changing column names.
-- Nothing in the DB schema depends on v_ebay_order_profit (only queried by JS frontend).
DROP VIEW IF EXISTS public.v_ebay_order_profit;

CREATE VIEW public.v_ebay_order_profit AS
WITH sale_txn AS (
  -- One SALE row per order (the primary credit to the seller)
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
  -- Per-order NON_SALE_CHARGE rows (e.g. Promoted Listings - General fee).
  -- These are DEBITs billed after the sale, not inside the SALE transaction.
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
  SELECT
    li.stripe_checkout_session_id,
    ROUND(
      SUM(COALESCE(p.unit_cost, 0::numeric) * li.quantity::numeric) * 100
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
  --   SALE.amount already deducts eBay-collected tax and embedded FVF.
  --   We additionally subtract per-order NON_SALE_CHARGE (promoted listing / ad fees).
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
      THEN st.sale_amount_cents - COALESCE(oc.total_charge_cents, 0)
    ELSE NULL
  END                                                      AS ebay_order_earnings_cents,

  -- Combined eBay fee total visible to the UI
  -- (embedded FVF in SALE + separately billed ad fees)
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
      THEN st.sale_fee_cents + COALESCE(oc.total_charge_cents, 0)
    ELSE NULL
  END                                                      AS ebay_total_fee_cents,

  -- Internal seller costs
  COALESCE(ic.product_cost_cents, 0)                       AS product_cost_cents,
  fs.label_cost_cents                                      AS shippo_label_cost_cents,

  -- Net profit:
  --   Use ebay_order_earnings_cents as revenue (true seller proceeds after all eBay
  --   order-attributable fees).
  --   product_cost_cents is DB unit_cost only; modal JS adds supplier shipping per item.
  --   Returns NULL when finance_status = 'estimated' to avoid overstating profit when
  --   ad fees may not yet be captured.
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
         AND (oc.total_charge_cents IS NOT NULL OR -- ad fee explicitly captured
              st.finance_synced_at < NOW() - INTERVAL '2 days')  -- old enough, assume no ad fee
         AND fs.label_cost_cents IS NOT NULL
      THEN (st.sale_amount_cents - COALESCE(oc.total_charge_cents, 0))
           - COALESCE(ic.product_cost_cents, 0)
           - COALESCE(fs.label_cost_cents, 0)
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS     NULL  -- ad fee unknown (fresh sale, not yet billed)
         AND st.finance_synced_at >= NOW() - INTERVAL '2 days'
         AND fs.label_cost_cents IS NOT NULL
      -- Return best-case (overstated) as negative sentinel so UI knows to badge it
      THEN NULL
    ELSE NULL
  END                                                      AS ebay_net_profit_cents,

  -- Finance sync completeness status.
  -- complete:         SALE + per-order charge rows present + label — profit is reliable
  -- estimated:        SALE + label, ad fee not yet captured (sale < 2 days old)
  --                   OR SALE + label, sale is old enough that no ad fee is expected
  -- estimated_profit: SALE + label, sale is > 2 days old, no ad fee was captured
  --                   (ad fee either didn't apply or is definitively absent)
  -- partial:          SALE only, label not yet purchased
  -- pending_finances: label exists, SALE transaction not yet posted by eBay Finances API
  -- missing:          neither SALE nor label available
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NOT NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'complete'
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NULL
         AND st.finance_synced_at >= NOW() - INTERVAL '2 days'
         AND fs.label_cost_cents IS NOT NULL
      THEN 'estimated'  -- ad fee not yet billed by eBay (can take 1-2 days post-sale)
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NULL
         AND st.finance_synced_at < NOW() - INTERVAL '2 days'
         AND fs.label_cost_cents IS NOT NULL
      THEN 'estimated_no_ad_fee'  -- old sale, no ad fee captured → likely not promoted
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
