-- ================================================================
-- SMS Marketing System — Phase 2 Tables & Upgrades
-- Tables: sms_sends, sms_events, sms_queue
-- Columns added: customer_contacts.last_sms_sent_at, .fatigue_score, .timezone
-- sms_messages: redirect_url, short_code
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. sms_sends — orchestration & analytics layer
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sms_sends (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                   TEXT NOT NULL,
  campaign                TEXT,                              -- e.g. 'sms_signup_coupon'
  flow                    TEXT,                              -- 'signup', 'coupon_reminder', 'welcome', 'abandoned_cart'
  send_reason             TEXT,                              -- what triggered this send
  intent                  TEXT NOT NULL DEFAULT 'marketing'
                            CHECK (intent IN ('marketing', 'transactional', 'system')),
  cost                    NUMERIC(8,4),                      -- Twilio cost per segment (e.g. 0.0079)
  outcome                 TEXT NOT NULL DEFAULT 'pending'
                            CHECK (outcome IN ('pending', 'converted', 'not_converted')),
  expected_value          NUMERIC(10,2),                     -- estimated revenue at send time
  expected_conversion_rate NUMERIC(5,2),                     -- predicted conversion % at send time
  product_context         JSONB,                             -- {product_id, category, price, margin}
  user_state_snapshot     JSONB,                             -- {cart_value, order_count, segment, last_activity, ltv}
  sms_message_id          UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  contact_id              UUID REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  converted_at            TIMESTAMPTZ,                       -- when outcome changed to 'converted'
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sends_phone      ON public.sms_sends (phone);
CREATE INDEX IF NOT EXISTS idx_sends_campaign    ON public.sms_sends (campaign);
CREATE INDEX IF NOT EXISTS idx_sends_flow        ON public.sms_sends (flow);
CREATE INDEX IF NOT EXISTS idx_sends_intent      ON public.sms_sends (intent);
CREATE INDEX IF NOT EXISTS idx_sends_outcome     ON public.sms_sends (outcome);
CREATE INDEX IF NOT EXISTS idx_sends_created     ON public.sms_sends (created_at);
CREATE INDEX IF NOT EXISTS idx_sends_message     ON public.sms_sends (sms_message_id);

ALTER TABLE public.sms_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_sends"
  ON public.sms_sends FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_sends"
  ON public.sms_sends FOR SELECT
  TO authenticated
  USING (true);

GRANT ALL ON public.sms_sends TO service_role;
GRANT SELECT ON public.sms_sends TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. sms_events — click tracking + conversion events
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sms_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('sms_clicked', 'coupon_redeemed', 'order_attributed', 'link_visited')),
  phone           TEXT,
  sms_message_id  UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  sms_send_id     UUID REFERENCES public.sms_sends(id) ON DELETE SET NULL,
  metadata        JSONB,                                    -- flexible event data
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type       ON public.sms_events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_phone      ON public.sms_events (phone);
CREATE INDEX IF NOT EXISTS idx_events_message    ON public.sms_events (sms_message_id);
CREATE INDEX IF NOT EXISTS idx_events_created    ON public.sms_events (created_at);

ALTER TABLE public.sms_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_events"
  ON public.sms_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_events"
  ON public.sms_events FOR SELECT
  TO authenticated
  USING (true);

GRANT ALL ON public.sms_events TO service_role;
GRANT SELECT ON public.sms_events TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. sms_queue — hold queue for quiet hours + deferred sends
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sms_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL,
  payload         JSONB NOT NULL,                            -- {body, campaign, flow, redirect_url, product_context}
  intent          TEXT NOT NULL DEFAULT 'marketing'
                    CHECK (intent IN ('marketing', 'transactional', 'system')),
  scheduled_at    TIMESTAMPTZ NOT NULL,                      -- when to send (next valid window)
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'cancelled')),
  contact_id      UUID REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  sent_message_id UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL,  -- filled after send
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queue_status_sched ON public.sms_queue (status, scheduled_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_queue_phone         ON public.sms_queue (phone);

ALTER TABLE public.sms_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_queue"
  ON public.sms_queue FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.sms_queue TO service_role;

-- ════════════════════════════════════════════════════════════════
-- 4. Add columns to existing tables
-- ════════════════════════════════════════════════════════════════

-- customer_contacts: frequency cap + fatigue tracking
ALTER TABLE public.customer_contacts
  ADD COLUMN IF NOT EXISTS last_sms_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fatigue_score     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timezone          TEXT,
  ADD COLUMN IF NOT EXISTS sms_count_7d      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaign          TEXT;

-- sms_messages: click tracking support
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS redirect_url TEXT,                -- target URL for click tracking
  ADD COLUMN IF NOT EXISTS short_code   TEXT;                -- unique short code for /r/{short_code}

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_short_code ON public.sms_messages (short_code)
  WHERE short_code IS NOT NULL;

-- orders_raw: SMS attribution
ALTER TABLE public.orders_raw
  ADD COLUMN IF NOT EXISTS sms_attributed    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_send_id       UUID,
  ADD COLUMN IF NOT EXISTS sms_click_at      TIMESTAMPTZ;
