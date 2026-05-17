-- ================================================================
-- CTA Label Links + Scans: token-based QR scan tracking
-- Phase 2D: one tracking link per printed label (cta_label_links)
--           one event row per customer scan  (cta_label_scans)
--
-- Flow:
--   Admin prints label → create-cta-label-link Edge Function
--     → generates token → inserts cta_label_links row
--   Customer scans QR  → /r/?t=<token> → cta-label-redirect Edge Function
--     → inserts cta_label_scans row → 302 to destination_url
--
-- Security:
--   Both tables: service_role ALL, authenticated SELECT only.
--   No anon or authenticated INSERT from browser.
--   The redirect Edge Function holds the service role key.
--   Raw IP is never stored; ip_hash = SHA-256(ip).
-- ================================================================

-- ── cta_label_links ───────────────────────────────────────────────
-- One row per CTA label print event.
-- token is embedded in the QR URL: karrykraze.com/r/?t=<token>
-- print_id references cta_label_prints for join analytics.

CREATE TABLE IF NOT EXISTS cta_label_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text        UNIQUE NOT NULL,
  print_id        uuid        NULL REFERENCES cta_label_prints(id) ON DELETE SET NULL,
  session_id      text        NOT NULL,
  kk_order_id     text        NULL,
  order_source    text        NOT NULL
                              CHECK (order_source IN ('kk', 'ebay', 'amazon', 'unknown')),
  label_type      text        NOT NULL
                              CHECK (label_type IN ('review_cta', 'channel_cta')),
  destination_url text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NULL,         -- NULL = never expires
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cta_label_links_token
  ON cta_label_links (token);

CREATE INDEX IF NOT EXISTS idx_cta_label_links_print_id
  ON cta_label_links (print_id);

CREATE INDEX IF NOT EXISTS idx_cta_label_links_session_id
  ON cta_label_links (session_id);

CREATE INDEX IF NOT EXISTS idx_cta_label_links_kk_order_id
  ON cta_label_links (kk_order_id)
  WHERE kk_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cta_label_links_created_at
  ON cta_label_links (created_at DESC);

ALTER TABLE cta_label_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cta_label_links_service_role_all"
  ON cta_label_links FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "cta_label_links_authenticated_select"
  ON cta_label_links FOR SELECT
  TO authenticated
  USING (true);

-- ── cta_label_scans ───────────────────────────────────────────────
-- One row per customer QR scan event.
-- token, session_id, order_source, label_type are denormalized from
-- cta_label_links for fast analytics without joins.
-- ip_hash = SHA-256(raw_ip). Raw IP is never stored.

CREATE TABLE IF NOT EXISTS cta_label_scans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text        NOT NULL,
  link_id         uuid        NULL REFERENCES cta_label_links(id) ON DELETE SET NULL,
  print_id        uuid        NULL REFERENCES cta_label_prints(id) ON DELETE SET NULL,
  session_id      text        NULL,
  order_source    text        NULL,
  label_type      text        NULL,
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  user_agent      text        NULL,
  ip_hash         text        NULL,      -- SHA-256 of IP — raw IP never stored
  referrer        text        NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_token
  ON cta_label_scans (token);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_link_id
  ON cta_label_scans (link_id);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_print_id
  ON cta_label_scans (print_id);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_session_id
  ON cta_label_scans (session_id);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_scanned_at
  ON cta_label_scans (scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_order_source
  ON cta_label_scans (order_source);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_label_type
  ON cta_label_scans (label_type);

ALTER TABLE cta_label_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cta_label_scans_service_role_all"
  ON cta_label_scans FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "cta_label_scans_authenticated_select"
  ON cta_label_scans FOR SELECT
  TO authenticated
  USING (true);
