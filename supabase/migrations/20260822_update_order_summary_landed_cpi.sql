-- 20260822_update_order_summary_landed_cpi.sql
--
-- Reflect Parcel Imports landed CPI in order summary / profit views.
-- Variant override (unit_cost_override_cents) = all-in landed CPI per unit.
-- Product fallback = unit_cost + estimated China supplier ship (profitCalc formula).
-- Outbound USPS label and platform fees remain separate.
--
-- Touches: v_order_financials, v_ebay_order_profit, v_amazon_order_profit, v_order_summary_plus
-- Read-only: no product/variant/stock mutations.

-- ── Helpers (immutable, match js/shared/landedCpi.js + profitCalc.js) ─────────

CREATE OR REPLACE FUNCTION public.order_supplier_ship_per_unit_usd(p_weight_g numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN COALESCE(p_weight_g, 0::numeric) <= 0::numeric THEN 0::numeric
    WHEN (p_weight_g * 30::numeric) <= 2000::numeric THEN
      ((88::numeric + p_weight_g * 30::numeric * 0.12) * 0.1437) / 30::numeric
    ELSE
      ((297::numeric + p_weight_g * 30::numeric * 0.0523) * 0.1437) / 30::numeric
  END;
$$;

COMMENT ON FUNCTION public.order_supplier_ship_per_unit_usd(numeric) IS
  'Estimated China supplier ship per unit (EUB/HK-UPS). Mirrors js/admin/pStorage/profitCalc.js.';

CREATE OR REPLACE FUNCTION public.order_line_cpi_usd(
  p_unit_cost numeric,
  p_variant_override_cents numeric,
  p_weight_g numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_variant_override_cents IS NOT NULL THEN
      p_variant_override_cents / 100.0
    WHEN COALESCE(p_unit_cost, 0::numeric) > 0::numeric THEN
      p_unit_cost + public.order_supplier_ship_per_unit_usd(p_weight_g)
    ELSE
      0::numeric
  END;
$$;

COMMENT ON FUNCTION public.order_line_cpi_usd(numeric, numeric, numeric) IS
  'Per-unit landed CPI: variant override cents when set, else product unit_cost + est. supplier ship.';

-- ── Drop dependent views (dependency order) ───────────────────────────────────

DROP VIEW IF EXISTS public.v_order_summary_plus CASCADE;
DROP VIEW IF EXISTS public.v_ebay_order_profit CASCADE;
DROP VIEW IF EXISTS public.v_amazon_order_profit CASCADE;
DROP VIEW IF EXISTS public.v_order_financials CASCADE;

-- ── v_order_financials (KK / default profit path) ─────────────────────────────

CREATE VIEW public.v_order_financials AS
WITH item_costs AS (
  SELECT
    li.stripe_checkout_session_id,
    SUM(
      public.order_line_cpi_usd(
        p.unit_cost,
        pv.unit_cost_override_cents,
        p.weight_g
      ) * li.quantity::numeric
    ) AS product_cost_total,
    SUM(COALESCE(p.weight_g, 0::numeric) * li.quantity::numeric) AS total_weight_g
  FROM public.line_items_raw li
  LEFT JOIN public.products p ON p.code = li.product_id
  LEFT JOIN public.product_variants pv
    ON pv.product_id = p.id
   AND NULLIF(TRIM(li.variant), '') IS NOT NULL
   AND lower(trim(pv.option_value)) = lower(trim(li.variant))
  GROUP BY li.stripe_checkout_session_id
),
ship AS (
  SELECT
    fs.stripe_checkout_session_id,
    fs.label_cost_cents,
    fs.label_status
  FROM public.fulfillment_shipments fs
)
SELECT
  o.stripe_checkout_session_id,
  o.total_paid_cents,
  o.refund_status,
  o.refund_reason,
  o.refund_amount_cents,
  ROUND(ic.product_cost_total * 100::numeric)::integer AS product_cost_total_cents,
  COALESCE(s.label_cost_cents, 0) AS label_cost_cents,
  s.label_status,
  CASE
    WHEN o.refund_status = 'full'
     AND COALESCE(o.refund_reason, 'cancelled_before_ship') = 'cancelled_before_ship'
      THEN 0
    WHEN o.refund_reason = 'returned'
      THEN o.total_paid_cents
           - COALESCE(o.refund_amount_cents, 0)
           - ROUND(ic.product_cost_total * 100::numeric)::integer
    WHEN o.refund_reason = 'refunded_kept_item'
      THEN o.total_paid_cents
           - COALESCE(o.refund_amount_cents, 0)
           - ROUND(ic.product_cost_total * 100::numeric)::integer
           - COALESCE(s.label_cost_cents, 0)
    ELSE
      o.total_paid_cents
      - COALESCE(o.refund_amount_cents, 0)
      - ROUND(ic.product_cost_total * 100::numeric)::integer
      - COALESCE(s.label_cost_cents, 0)
  END AS profit_cents
FROM public.orders_raw o
LEFT JOIN item_costs ic USING (stripe_checkout_session_id)
LEFT JOIN ship s USING (stripe_checkout_session_id);

GRANT SELECT ON public.v_order_financials TO anon, authenticated;

-- ── v_ebay_order_profit ───────────────────────────────────────────────────────

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
  SELECT
    li.stripe_checkout_session_id,
    ROUND(
      SUM(
        public.order_line_cpi_usd(
          p.unit_cost,
          pv.unit_cost_override_cents,
          p.weight_g
        ) * li.quantity::numeric
      ) * 100
    )::integer AS product_cost_cents
  FROM public.line_items_raw li
  LEFT JOIN public.products p ON p.code = li.product_id
  LEFT JOIN public.product_variants pv
    ON pv.product_id = p.id
   AND NULLIF(TRIM(li.variant), '') IS NOT NULL
   AND lower(trim(pv.option_value)) = lower(trim(li.variant))
  GROUP BY li.stripe_checkout_session_id
)
SELECT
  o.stripe_checkout_session_id,
  o.kk_order_id,
  o.subtotal_paid_cents                                    AS buyer_subtotal_cents,
  o.tax_cents                                              AS buyer_tax_cents,
  o.total_paid_cents                                       AS buyer_total_cents,
  st.sale_amount_cents,
  st.sale_fee_cents,
  st.fee_final_value_cents,
  st.fee_regulatory_cents,
  st.fee_international_cents,
  st.fee_other_cents,
  st.sale_fee_breakdown,
  st.finance_synced_at,
  COALESCE(oc.total_charge_cents, 0)                       AS per_order_ad_fee_cents,
  oc.charge_rows                                           AS ad_fee_breakdown,
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
      THEN st.sale_amount_cents - COALESCE(oc.total_charge_cents, 0)
    ELSE NULL
  END                                                      AS ebay_order_earnings_cents,
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
      THEN st.sale_fee_cents + COALESCE(oc.total_charge_cents, 0)
    ELSE NULL
  END                                                      AS ebay_total_fee_cents,
  COALESCE(ic.product_cost_cents, 0)                       AS product_cost_cents,
  fs.label_cost_cents                                      AS shippo_label_cost_cents,
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
         AND (oc.total_charge_cents IS NOT NULL OR
              st.finance_synced_at < NOW() - INTERVAL '1 hour')
         AND fs.label_cost_cents IS NOT NULL
      THEN (st.sale_amount_cents - COALESCE(oc.total_charge_cents, 0))
           - COALESCE(ic.product_cost_cents, 0)
           - COALESCE(fs.label_cost_cents, 0)
    ELSE NULL
  END                                                      AS ebay_net_profit_cents,
  CASE
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NOT NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'complete'
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NULL
         AND st.finance_synced_at >= NOW() - INTERVAL '1 hour'
         AND fs.label_cost_cents IS NOT NULL
      THEN 'estimated'
    WHEN st.sale_amount_cents IS NOT NULL
         AND oc.total_charge_cents IS NULL
         AND st.finance_synced_at < NOW() - INTERVAL '1 hour'
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

-- ── v_amazon_order_profit ─────────────────────────────────────────────────────

CREATE VIEW public.v_amazon_order_profit AS
WITH sale_txn AS (
  SELECT DISTINCT ON (stripe_checkout_session_id)
    stripe_checkout_session_id,
    amazon_order_id,
    amount_cents              AS amazon_order_earnings_cents,
    total_fee_cents           AS amazon_total_fee_cents,
    fee_referral_cents,
    fee_fba_cents,
    fee_other_cents,
    fee_breakdown,
    transaction_date          AS finance_synced_at
  FROM public.amazon_finance_transactions
  WHERE transaction_type ILIKE '%Shipment%'
     OR transaction_type ILIKE '%Order%'
  ORDER BY stripe_checkout_session_id, transaction_date DESC NULLS LAST, synced_at DESC
),
item_costs AS (
  SELECT
    li.stripe_checkout_session_id,
    ROUND(
      SUM(
        public.order_line_cpi_usd(
          p.unit_cost,
          pv.unit_cost_override_cents,
          p.weight_g
        ) * li.quantity::numeric
      ) * 100
    )::integer AS product_cost_cents
  FROM public.line_items_raw li
  LEFT JOIN public.products p ON p.code = li.product_id
  LEFT JOIN public.product_variants pv
    ON pv.product_id = p.id
   AND NULLIF(TRIM(li.variant), '') IS NOT NULL
   AND lower(trim(pv.option_value)) = lower(trim(li.variant))
  GROUP BY li.stripe_checkout_session_id
)
SELECT
  o.stripe_checkout_session_id,
  o.kk_order_id,
  o.subtotal_paid_cents                                AS buyer_subtotal_cents,
  o.tax_cents                                          AS buyer_tax_cents,
  o.total_paid_cents                                   AS buyer_total_cents,
  st.amazon_order_earnings_cents,
  st.amazon_total_fee_cents,
  st.fee_referral_cents,
  st.fee_fba_cents,
  st.fee_other_cents,
  st.fee_breakdown,
  st.finance_synced_at,
  COALESCE(ic.product_cost_cents, 0)                   AS product_cost_cents,
  fs.label_cost_cents                                  AS shippo_label_cost_cents,
  CASE
    WHEN st.amazon_order_earnings_cents IS NOT NULL
      THEN st.amazon_order_earnings_cents
           - COALESCE(ic.product_cost_cents, 0)
           - COALESCE(fs.label_cost_cents, 0)
    ELSE NULL
  END                                                  AS amazon_net_profit_cents,
  CASE
    WHEN st.amazon_order_earnings_cents IS NOT NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'complete'
    WHEN st.amazon_order_earnings_cents IS NOT NULL
         AND fs.label_cost_cents IS NULL
      THEN 'partial'
    WHEN st.amazon_order_earnings_cents IS NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'pending_finances'
    ELSE 'missing'
  END                                                  AS finance_status
FROM public.orders_raw o
LEFT JOIN sale_txn st ON st.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN item_costs ic ON ic.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN public.fulfillment_shipments fs
  ON fs.stripe_checkout_session_id = o.stripe_checkout_session_id
WHERE o.stripe_checkout_session_id LIKE 'amazon_%';

GRANT SELECT ON public.v_amazon_order_profit TO anon, authenticated, service_role;

-- ── v_order_summary_plus (unchanged profit precedence; new landed CPI underneath) ─

CREATE VIEW public.v_order_summary_plus AS
SELECT
  s.*,
  f.product_cost_total_cents,
  f.label_cost_cents,
  f.label_status,
  COALESCE(
    CASE
      WHEN ep.finance_status IN ('complete', 'estimated_no_ad_fee')
      THEN ep.ebay_net_profit_cents::integer
    END,
    CASE
      WHEN ap.finance_status IN ('complete', 'partial')
      THEN ap.amazon_net_profit_cents
    END,
    f.profit_cents
  )                              AS profit_cents,
  f.refund_status,
  f.refund_reason,
  f.refund_amount_cents
FROM public.v_order_summary s
LEFT JOIN public.v_order_financials f USING (stripe_checkout_session_id)
LEFT JOIN public.v_ebay_order_profit ep USING (stripe_checkout_session_id)
LEFT JOIN public.v_amazon_order_profit ap USING (stripe_checkout_session_id);

GRANT SELECT ON public.v_order_summary_plus TO anon, authenticated;
