-- ================================================================
-- CTA Label Prints: event log for admin-printed CTA insert labels
-- Phase 2C: print analytics (Phase 2D will add scan/QR analytics)
--
-- Chosen approach: separate event table (Option B).
-- Rationale:
--   - Print events are time-stamped analytics events, not fulfillment state.
--   - An order may be printed multiple times (reprints, test prints).
--   - Keeping event data off fulfillment_shipments avoids table churn and
--     preserves the fulfillment table's role as operational state only.
--   - Consistent with other event log tables: coupon_attempt_logs,
--     shippo_webhook_events, ebay_finance_transactions.
-- ================================================================

CREATE TABLE IF NOT EXISTS cta_label_prints (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     text        NOT NULL,     -- stripe_checkout_session_id (or ebay_api_ prefix)
  kk_order_id    text        NULL,         -- null for eBay orders (no kk_order_id)
  order_source   text        NOT NULL      -- 'kk' | 'ebay'
                             CHECK (order_source IN ('kk', 'ebay', 'amazon', 'unknown')),
  label_type     text        NOT NULL      -- 'review_cta' | 'channel_cta'
                             CHECK (label_type IN ('review_cta', 'channel_cta')),
  printed_at     timestamptz NOT NULL DEFAULT now(),
  printed_by     text        NULL,         -- reserved for future admin auth; null in Phase 2C
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb
  -- metadata may include: qr_target, ua hint, etc.
);

-- ── Indexes ───────────────────────────────────────────────────────

-- Most common admin queries: "how many prints for this order?"
CREATE INDEX IF NOT EXISTS idx_cta_label_prints_session_id
  ON cta_label_prints (session_id);

-- KK order ID lookup (join to reviews, coupon tracking in Phase 2D+)
CREATE INDEX IF NOT EXISTS idx_cta_label_prints_kk_order_id
  ON cta_label_prints (kk_order_id)
  WHERE kk_order_id IS NOT NULL;

-- Time-series analytics: "how many labels printed this week?"
CREATE INDEX IF NOT EXISTS idx_cta_label_prints_printed_at
  ON cta_label_prints (printed_at DESC);

-- Filter by label type: "how many review CTA vs. channel CTA?"
CREATE INDEX IF NOT EXISTS idx_cta_label_prints_label_type
  ON cta_label_prints (label_type, printed_at DESC);

-- Filter by source channel
CREATE INDEX IF NOT EXISTS idx_cta_label_prints_order_source
  ON cta_label_prints (order_source, printed_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────
-- RLS decision: authenticated INSERT (not anon INSERT).
--
-- Reason: The lineItemsOrders admin page uses the public anon key, but the
-- Supabase client library automatically restores an authenticated session from
-- localStorage when an admin is logged in. All admin operations on this page
-- therefore run as the 'authenticated' role (not 'anon').
--
-- Using 'anon INSERT' would allow any unauthenticated internet visitor who
-- reads the public env.js (which exposes SUPABASE_ANON_KEY) to insert rows
-- directly into this table via the Supabase REST API. 'authenticated INSERT'
-- prevents that — only users with a valid Supabase Auth JWT can write rows.
--
-- Side effect: if an admin navigates to lineItemsOrders.html without first
-- logging in (i.e., no session in localStorage), trackCtaLabelPrint() will
-- fail silently — which is acceptable since Phase 2C tracking is non-blocking.
-- The print window still opens normally. The admin must be logged in for
-- tracking to record.
--
-- Future: lineItemsOrders/index.js should add requireAdminSession() (same
-- pattern as expenses/index.js and customers/index.js) to redirect
-- unauthenticated visitors. That change is separate from this migration.

ALTER TABLE cta_label_prints ENABLE ROW LEVEL SECURITY;

-- Admin browser JS: insert-only when authenticated (logged-in admin)
CREATE POLICY "cta_label_prints_authenticated_insert"
  ON cta_label_prints
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Edge functions / server-side: full access for future reporting / backfills
CREATE POLICY "cta_label_prints_service_role_all"
  ON cta_label_prints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
