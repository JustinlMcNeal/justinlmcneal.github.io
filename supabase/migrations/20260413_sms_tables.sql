-- ================================================================
-- SMS Marketing System — Phase 1 Tables
-- Tables: customer_contacts, sms_consent_logs, sms_messages
-- + site_settings row for SMS coupon config
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. customer_contacts — multi-channel contact hub
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  email         TEXT,

  -- overall status
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'unsubscribed', 'bounced')),

  -- per-channel consent flags
  sms_consent   BOOLEAN NOT NULL DEFAULT false,
  email_consent BOOLEAN NOT NULL DEFAULT false,
  push_consent  BOOLEAN NOT NULL DEFAULT false,

  -- acquisition
  source        TEXT NOT NULL,                   -- e.g. 'landing_page_coupon'
  coupon_code   TEXT,                            -- code given at signup (matches promotions.code)

  -- timestamps
  opted_in_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  opted_out_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- phone format constraint: US E.164 only (+1 followed by 10 digits)
  CONSTRAINT valid_us_phone CHECK (phone ~ E'^\\+1[2-9]\\d{9}$')
);

CREATE INDEX IF NOT EXISTS idx_contacts_status     ON public.customer_contacts (status);
CREATE INDEX IF NOT EXISTS idx_contacts_coupon_code ON public.customer_contacts (coupon_code);
CREATE INDEX IF NOT EXISTS idx_contacts_source      ON public.customer_contacts (source);

-- RLS: service_role only (edge functions write, admin reads)
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_contacts"
  ON public.customer_contacts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_contacts"
  ON public.customer_contacts FOR SELECT
  TO authenticated
  USING (true);

GRANT ALL ON public.customer_contacts TO service_role;
GRANT SELECT ON public.customer_contacts TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. sms_consent_logs — immutable audit trail
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sms_consent_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          TEXT NOT NULL,
  consent_type   TEXT NOT NULL CHECK (consent_type IN ('opt_in', 'opt_out')),
  consent_text   TEXT NOT NULL,                  -- exact text shown to user
  source         TEXT NOT NULL,                  -- 'landing_page_coupon', 'twilio_stop', etc.
  page_url       TEXT,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_phone      ON public.sms_consent_logs (phone);
CREATE INDEX IF NOT EXISTS idx_consent_type        ON public.sms_consent_logs (consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_created     ON public.sms_consent_logs (created_at);

-- RLS: service_role insert + read, authenticated read
ALTER TABLE public.sms_consent_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_consent"
  ON public.sms_consent_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_consent"
  ON public.sms_consent_logs FOR SELECT
  TO authenticated
  USING (true);

GRANT ALL ON public.sms_consent_logs TO service_role;
GRANT SELECT ON public.sms_consent_logs TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. sms_messages — delivery log
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id           UUID REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  phone                TEXT NOT NULL,
  message_body         TEXT NOT NULL,
  message_type         TEXT NOT NULL
                         CHECK (message_type IN ('coupon_delivery', 'reminder', 'campaign', 'transactional')),
  campaign             TEXT,                     -- e.g. 'sms_signup_coupon' for revenue attribution
  status               TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'undelivered')),
  provider             TEXT NOT NULL DEFAULT 'twilio',
  provider_message_sid TEXT,                     -- Twilio MessageSid
  error_code           TEXT,
  error_message        TEXT,
  cost_cents           INTEGER,                  -- Twilio per-segment cost
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_contact       ON public.sms_messages (contact_id);
CREATE INDEX IF NOT EXISTS idx_sms_status         ON public.sms_messages (status);
CREATE INDEX IF NOT EXISTS idx_sms_sid            ON public.sms_messages (provider_message_sid);
CREATE INDEX IF NOT EXISTS idx_sms_campaign       ON public.sms_messages (campaign);

-- RLS: service_role only
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_sms"
  ON public.sms_messages FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_sms"
  ON public.sms_messages FOR SELECT
  TO authenticated
  USING (true);

GRANT ALL ON public.sms_messages TO service_role;
GRANT SELECT ON public.sms_messages TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. Default SMS coupon config in site_settings
-- ════════════════════════════════════════════════════════════════
INSERT INTO public.site_settings (key, value)
VALUES ('sms_coupon', '{
  "type": "percentage",
  "value": 15,
  "min_order_amount": 40,
  "expiry_days": 2,
  "prefix": "SMS",
  "scope_type": "all"
}')
ON CONFLICT (key) DO NOTHING;
