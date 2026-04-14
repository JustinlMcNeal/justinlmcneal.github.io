-- ================================================================
-- Abandoned Cart Infrastructure
-- saved_carts table + RLS policies
-- ================================================================

CREATE TABLE IF NOT EXISTS saved_carts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id      UUID REFERENCES customer_contacts(id) ON DELETE CASCADE,
  phone           TEXT NOT NULL,
  cart_data        JSONB NOT NULL DEFAULT '[]'::jsonb,
  cart_value_cents INT NOT NULL DEFAULT 0,
  item_count       INT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','abandoned','purchased','expired')),
  abandoned_step   INT NOT NULL DEFAULT 0,  -- 0=none, 1=reminder, 2=urgency, 3=discount
  last_sms_at      TIMESTAMPTZ,
  purchased_at     TIMESTAMPTZ
);

-- Index for cron queries: find active carts due for abandonment check
CREATE INDEX IF NOT EXISTS idx_saved_carts_status_updated
  ON saved_carts (status, updated_at)
  WHERE status = 'active';

-- Index for looking up cart by contact
CREATE INDEX IF NOT EXISTS idx_saved_carts_contact
  ON saved_carts (contact_id)
  WHERE status = 'active';

-- Index for looking up cart by phone
CREATE INDEX IF NOT EXISTS idx_saved_carts_phone
  ON saved_carts (phone)
  WHERE status = 'active';

-- RLS
ALTER TABLE saved_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on saved_carts"
  ON saved_carts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
