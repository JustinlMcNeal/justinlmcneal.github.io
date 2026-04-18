-- ============================================================
-- Shippo Phase 0: Foundation Migration
-- Adds columns to fulfillment_shipments, creates package_presets
-- and shippo_webhook_events tables, seeds initial package presets,
-- stores sender address in site_settings.
-- ============================================================

-- -----------------------------------------------
-- 1. Add Shippo columns to fulfillment_shipments
-- -----------------------------------------------
ALTER TABLE fulfillment_shipments
  ADD COLUMN IF NOT EXISTS shippo_transaction_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS shippo_rate_id        TEXT,
  ADD COLUMN IF NOT EXISTS label_url             TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url           TEXT,
  ADD COLUMN IF NOT EXISTS in_transit_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_tracking_sync_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_delivery     TIMESTAMPTZ;

-- -----------------------------------------------
-- 2. Create package_presets table
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS package_presets (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  length_in  NUMERIC NOT NULL,
  width_in   NUMERIC NOT NULL,
  height_in  NUMERIC,            -- NULL for flat/mailer packages
  weight_oz  NUMERIC,            -- optional default tare weight
  is_default BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial presets
INSERT INTO package_presets (name, length_in, width_in, height_in, is_default, sort_order) VALUES
  ('Small Flat',    8,  6,  NULL, true,  0),
  ('Medium Flat',  14, 10,  NULL, false, 1),
  ('Standard Box', 15, 12,  10,   false, 2)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------
-- 3. Create shippo_webhook_events table
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS shippo_webhook_events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type      TEXT NOT NULL,
  tracking_number TEXT,
  carrier         TEXT,
  payload_json    JSONB NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT now(),
  status          TEXT DEFAULT 'processed',  -- 'processed', 'error', 'ignored'
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookups by tracking number
CREATE INDEX IF NOT EXISTS idx_webhook_events_tracking
  ON shippo_webhook_events (tracking_number);

-- Index for monitoring queries (status + created_at)
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON shippo_webhook_events (status, created_at);

-- -----------------------------------------------
-- 4. Store sender address in site_settings
-- -----------------------------------------------
INSERT INTO site_settings (key, value)
VALUES (
  'ship_from_address',
  '{"name":"Karry Kraze","street1":"1283 Lynx Crt","city":"Hampton","state":"GA","zip":"30228","country":"US","phone":"4704350296","email":"support@karrykraze.com"}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
