-- Migration: Add refund tracking to orders_raw
-- Run this in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/yxdzvzscufkvewecvagq/sql/new

-- 1) Add refund columns to orders_raw
ALTER TABLE orders_raw
  ADD COLUMN IF NOT EXISTS refund_status       text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS refund_amount_cents  int  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at         timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_refund_id    text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text DEFAULT NULL;

-- refund_status values: NULL (no refund), 'partial', 'full'

COMMENT ON COLUMN orders_raw.refund_status IS 'NULL = no refund, partial = partial refund, full = fully refunded';
COMMENT ON COLUMN orders_raw.refund_amount_cents IS 'Total amount refunded in cents';
COMMENT ON COLUMN orders_raw.refunded_at IS 'Timestamp of last refund event';
COMMENT ON COLUMN orders_raw.stripe_refund_id IS 'Latest Stripe refund ID (re_ prefix)';
COMMENT ON COLUMN orders_raw.stripe_payment_intent_id IS 'Stripe payment intent ID for refund lookups';

-- 2) Recreate v_order_financials to include refund data
-- First we need to see the existing view definition. Since we can't reference it,
-- we'll create/replace the view. The existing view computes cost + profit from
-- orders_raw joined to products. We add refund columns.

-- NOTE: Run this AFTER confirming the ALTER TABLE above succeeded.
-- The views below assume the new columns exist.

-- 3) Update v_order_summary_plus to expose refund columns
-- This is a CREATE OR REPLACE so it's safe to re-run.
-- We'll add: refund_status, refund_amount_cents, refunded_at, stripe_refund_id, net_revenue_cents

-- Since the views were created in Dashboard (no migration files), we need to
-- recreate them. The safest approach: add a NEW view for refund data and
-- adjust the JS to read from it. But since v_order_summary_plus is the main
-- source, we'll just add columns to it.

-- Drop and recreate v_order_summary_plus to include refund columns.
-- IMPORTANT: You must first check your existing view definition in Dashboard:
--   SELECT pg_get_viewdef('v_order_summary_plus', true);
-- Then add the refund columns to it.

-- For now, here's a simple approach: create a helper view that joins refund data
-- on top of the existing summary view. This avoids breaking the existing view.

CREATE OR REPLACE VIEW v_order_refunds AS
SELECT
  o.stripe_checkout_session_id,
  o.refund_status,
  o.refund_amount_cents,
  o.refunded_at,
  o.stripe_refund_id,
  o.stripe_payment_intent_id,
  CASE
    WHEN o.refund_status = 'full' THEN 0
    WHEN o.refund_amount_cents > 0 THEN o.total_paid_cents - o.refund_amount_cents
    ELSE o.total_paid_cents
  END AS net_revenue_cents
FROM orders_raw o;

-- 4) Grant access
GRANT SELECT ON v_order_refunds TO anon, authenticated;

-- 5) Index for quick refund filtering
CREATE INDEX IF NOT EXISTS idx_orders_raw_refund_status
  ON orders_raw (refund_status)
  WHERE refund_status IS NOT NULL;
