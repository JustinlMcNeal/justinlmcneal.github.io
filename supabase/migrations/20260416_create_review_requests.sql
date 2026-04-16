-- Create review_requests table for SMS→review funnel tracking
CREATE TABLE IF NOT EXISTS review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_session_id text NOT NULL,
  product_id      text NOT NULL,
  phone           text NOT NULL,
  token_hash      text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  clicked_at      timestamptz,
  reviewed_at     timestamptz,
  status          text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'clicked', 'completed', 'expired', 'failed')),

  -- Prevent duplicate SMS sends for the same product on the same order
  CONSTRAINT review_requests_order_product_unique
    UNIQUE (order_session_id, product_id)
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_review_requests_token_hash
  ON review_requests (token_hash);

CREATE INDEX IF NOT EXISTS idx_review_requests_status
  ON review_requests (status);

CREATE INDEX IF NOT EXISTS idx_review_requests_sent_at
  ON review_requests (sent_at);

-- RLS: only service role should access this table
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role key)
-- No anon/public access needed

-- Update review_settings with SMS request defaults
INSERT INTO review_settings (key, value)
VALUES (
  'sms_request',
  '{"enabled": false, "delay_days": 7, "mto_delay_days": 14, "max_products_per_order": 3}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
