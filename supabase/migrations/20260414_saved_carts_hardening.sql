-- ================================================================
-- Abandoned Cart Hardening
-- Adds: cart_hash, abandoned_at, step timestamps, abandon_count
-- ================================================================

ALTER TABLE saved_carts
  ADD COLUMN IF NOT EXISTS cart_hash        TEXT,
  ADD COLUMN IF NOT EXISTS abandoned_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS step_1_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS step_2_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS step_3_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandon_count    INT NOT NULL DEFAULT 0;

-- Index for dedup: quickly find recent abandoned-cart sends per phone
CREATE INDEX IF NOT EXISTS idx_saved_carts_phone_status
  ON saved_carts (phone, status);
