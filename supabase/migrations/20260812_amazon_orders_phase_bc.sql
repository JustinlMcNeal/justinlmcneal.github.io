-- Amazon orders Phase B/C: tracking sync flag, finance transactions, profit view.

ALTER TABLE public.fulfillment_shipments
  ADD COLUMN IF NOT EXISTS tracking_pushed_to_amazon boolean DEFAULT false;

COMMENT ON COLUMN public.fulfillment_shipments.tracking_pushed_to_amazon IS
  'True once Shippo tracking was confirmed to Amazon via confirmShipment.';

CREATE TABLE IF NOT EXISTS public.amazon_finance_transactions (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id             text        UNIQUE NOT NULL,
  amazon_order_id            text,
  stripe_checkout_session_id text,
  transaction_type           text        NOT NULL DEFAULT '',
  transaction_status         text,
  transaction_date           timestamptz,
  amount_cents               integer     NOT NULL DEFAULT 0,
  total_fee_cents            integer     NOT NULL DEFAULT 0,
  fee_referral_cents         integer     NOT NULL DEFAULT 0,
  fee_fba_cents              integer     NOT NULL DEFAULT 0,
  fee_other_cents            integer     NOT NULL DEFAULT 0,
  fee_breakdown              jsonb,
  raw_payload                jsonb,
  synced_at                  timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_finance_transactions IS
  'Per-order Amazon Finances API v2024-06-19 transactions upserted by amazon-sync-finances.';

CREATE INDEX IF NOT EXISTS idx_aft_amazon_order_id
  ON public.amazon_finance_transactions (amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_aft_session_id
  ON public.amazon_finance_transactions (stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_aft_type
  ON public.amazon_finance_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_aft_date
  ON public.amazon_finance_transactions (transaction_date);

ALTER TABLE public.amazon_finance_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'amazon_finance_transactions'
      AND policyname = 'aft_service_role_all'
  ) THEN
    CREATE POLICY aft_service_role_all
      ON public.amazon_finance_transactions FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'amazon_finance_transactions'
      AND policyname = 'aft_authenticated_read'
  ) THEN
    CREATE POLICY aft_authenticated_read
      ON public.amazon_finance_transactions FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

GRANT ALL ON public.amazon_finance_transactions TO service_role;
GRANT SELECT ON public.amazon_finance_transactions TO authenticated;

DROP VIEW IF EXISTS public.v_amazon_order_profit CASCADE;

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
      SUM(COALESCE(p.unit_cost, 0::numeric) * li.quantity::numeric) * 100
    )::integer AS product_cost_cents
  FROM public.line_items_raw li
  LEFT JOIN public.products p ON p.code = li.product_id
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

DROP VIEW IF EXISTS public.v_order_summary_plus CASCADE;

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
      THEN ap.amazon_net_profit_cents::integer
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
