-- 20260510_ebay_finance_transactions.sql
-- Purpose: raw per-order eBay Finance API transaction storage + derived eBay profit view
-- eBay orders only. Does NOT modify shared order tables, views, or the expenses table.
--
-- Double-count note:
--   ebay-sync-finances continues to aggregate SALE fees monthly into the `expenses` table
--   for accounting purposes. The new ebay_finance_transactions table provides the same fee
--   data at per-order granularity for the line items page profit display. These two paths
--   serve different consumers: the accounting ledger vs per-order profit UI. Do not
--   subtract eBay monthly expense rows from a total P&L that already uses per-order eBay
--   net profit from this table or v_ebay_order_profit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── TABLE: ebay_finance_transactions ────────────────────────────────────────
-- One row per eBay Finance API transaction, keyed by transactionId.
-- Upserted by ebay-sync-finances on each sync run.
-- SALE transactions contain the per-order seller earnings and fee breakdown.

CREATE TABLE IF NOT EXISTS public.ebay_finance_transactions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id           text        UNIQUE NOT NULL,       -- eBay transactionId
  ebay_order_id            text,                               -- eBay orderId (may be null for some types)
  stripe_checkout_session_id text,                             -- derived: 'ebay_api_{orderId}'
  transaction_type         text        NOT NULL DEFAULT '',    -- SALE | SHIPPING_LABEL | REFUND | CREDIT | NON_SALE_CHARGE
  transaction_status       text,
  transaction_date         timestamptz,
  booking_entry            text,                               -- CREDIT | DEBIT
  amount_cents             integer     NOT NULL DEFAULT 0,     -- seller net proceeds for SALE (positive = CREDIT to seller)
  total_fee_cents          integer     NOT NULL DEFAULT 0,     -- sum of all eBay marketplace fees for this transaction
  fee_final_value_cents    integer     NOT NULL DEFAULT 0,     -- FINAL_VALUE_FEE + FINAL_VALUE_FEE_FIXED_PER_ORDER
  fee_ad_cents             integer     NOT NULL DEFAULT 0,     -- AD_FEES / PROMOTED_LISTING_FEE
  fee_regulatory_cents     integer     NOT NULL DEFAULT 0,     -- REGULATORY_OP_FEE
  fee_international_cents  integer     NOT NULL DEFAULT 0,     -- INTERNATIONAL_FEE
  fee_other_cents          integer     NOT NULL DEFAULT 0,     -- all other unclassified fee types
  fee_breakdown            jsonb,                              -- raw marketplaceFees array from Finances API
  raw_payload              jsonb,                              -- full transaction object from Finances API
  synced_at                timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ebay_finance_transactions IS
  'Per-order eBay Finance API transactions upserted by ebay-sync-finances. SALE.amount_cents is the seller net proceeds after eBay fee deductions and tax remittance. Used by v_ebay_order_profit for accurate eBay-side order profit.';

COMMENT ON COLUMN public.ebay_finance_transactions.amount_cents IS
  'For SALE: seller net proceeds = buyer total minus eBay-collected tax minus all eBay fees. This is the payout-equivalent amount. Stored as positive integer cents.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_eft_ebay_order_id
  ON public.ebay_finance_transactions (ebay_order_id);
CREATE INDEX IF NOT EXISTS idx_eft_session_id
  ON public.ebay_finance_transactions (stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_eft_type
  ON public.ebay_finance_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_eft_date
  ON public.ebay_finance_transactions (transaction_date);

-- RLS
ALTER TABLE public.ebay_finance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eft_service_role_all"
  ON public.ebay_finance_transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "eft_authenticated_read"
  ON public.ebay_finance_transactions
  FOR SELECT
  TO authenticated
  USING (true);

-- ─── VIEW: v_ebay_order_profit ─────────────────────────────────────────────────
-- Per-order eBay accurate profit view. eBay orders only.
--
-- Revenue base: ebay_order_earnings_cents (SALE.amount from Finances API)
--   - This is the seller's actual payout-equivalent: buyer total minus eBay-collected tax
--     minus all marketplace fees. It is the only reliable revenue number for eBay profit.
--   - orders_raw.total_paid_cents maps only the item subtotal from the Fulfillment API and
--     does NOT include buyer-paid tax; do not use it as revenue base for eBay profit.
--
-- Product cost: uses unit_cost * qty (dollars → cents). Modal JS adds supplier shipping.
--
-- Finance status:
--   complete         - eBay SALE earnings AND Shippo label cost both known; profit is reliable
--   partial          - eBay earnings known, label not yet purchased; profit omits label cost
--   pending_finances - Shippo label purchased, eBay SALE transaction not yet synced (lag up to 1 day)
--   missing          - Neither earnings nor label available; no finance data

CREATE OR REPLACE VIEW public.v_ebay_order_profit AS
WITH sale_txn AS (
  SELECT
    stripe_checkout_session_id,
    ebay_order_id,
    amount_cents              AS ebay_order_earnings_cents,
    total_fee_cents           AS ebay_total_fee_cents,
    fee_final_value_cents,
    fee_ad_cents,
    fee_regulatory_cents,
    fee_international_cents,
    fee_other_cents,
    fee_breakdown,
    transaction_date          AS finance_synced_at
  FROM public.ebay_finance_transactions
  WHERE transaction_type = 'SALE'
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

  -- Buyer-side amounts (from orders_raw)
  -- Note: tax_cents may be 0 due to eBay Fulfillment API mapping; buyer tax is embedded
  -- in the eBay pricingSummary.tax field which may not have been captured at sync time.
  o.subtotal_paid_cents                                AS buyer_subtotal_cents,
  o.tax_cents                                          AS buyer_tax_cents,
  o.total_paid_cents                                   AS buyer_total_cents,

  -- eBay financial data from Finances API (authoritative for seller revenue)
  st.ebay_order_earnings_cents,
  st.ebay_total_fee_cents,
  st.fee_final_value_cents,
  st.fee_ad_cents,
  st.fee_regulatory_cents,
  st.fee_international_cents,
  st.fee_other_cents,
  st.fee_breakdown,
  st.finance_synced_at,

  -- Internal seller costs
  COALESCE(ic.product_cost_cents, 0)                   AS product_cost_cents,
  fs.label_cost_cents                                  AS shippo_label_cost_cents,

  -- Net profit using Finance API earnings as revenue base
  -- (product_cost_cents uses DB unit_cost only; modal JS also adds supplier shipping)
  CASE
    WHEN st.ebay_order_earnings_cents IS NOT NULL
      THEN st.ebay_order_earnings_cents
           - COALESCE(ic.product_cost_cents, 0)
           - COALESCE(fs.label_cost_cents, 0)
    ELSE NULL
  END                                                  AS ebay_net_profit_cents,

  -- Finance sync status
  CASE
    WHEN st.ebay_order_earnings_cents IS NOT NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'complete'
    WHEN st.ebay_order_earnings_cents IS NOT NULL
         AND fs.label_cost_cents IS NULL
      THEN 'partial'
    WHEN st.ebay_order_earnings_cents IS NULL
         AND fs.label_cost_cents IS NOT NULL
      THEN 'pending_finances'
    ELSE 'missing'
  END                                                  AS finance_status

FROM public.orders_raw o
LEFT JOIN sale_txn             st ON st.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN item_costs           ic ON ic.stripe_checkout_session_id = o.stripe_checkout_session_id
LEFT JOIN public.fulfillment_shipments fs
                               ON fs.stripe_checkout_session_id = o.stripe_checkout_session_id
WHERE o.stripe_checkout_session_id LIKE 'ebay_api_%'
   OR o.stripe_checkout_session_id LIKE 'ebay_%';

GRANT SELECT ON public.v_ebay_order_profit TO anon, authenticated, service_role;
