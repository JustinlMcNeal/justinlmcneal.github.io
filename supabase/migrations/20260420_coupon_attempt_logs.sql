-- Track invalid coupon attempts for abuse monitoring and margin-loss analysis
CREATE TABLE IF NOT EXISTS coupon_attempt_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code text,
  reason text NOT NULL,
  detail text,
  subtotal_cents integer DEFAULT 0,
  min_required_cents integer DEFAULT 0,
  kk_order_id text,
  ip_address text,
  user_agent text,
  context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_attempt_logs_created_at
  ON coupon_attempt_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_attempt_logs_coupon_code
  ON coupon_attempt_logs (coupon_code);

CREATE INDEX IF NOT EXISTS idx_coupon_attempt_logs_reason
  ON coupon_attempt_logs (reason);
