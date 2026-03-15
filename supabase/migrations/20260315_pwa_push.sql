-- PWA Push Notifications: DB tables
-- Run on remote Supabase DB

-- Push subscriptions from browsers
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT,
  keys_auth TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  is_admin BOOLEAN DEFAULT false,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  last_push_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_active ON push_subscriptions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_push_subs_admin ON push_subscriptions(is_admin) WHERE is_admin = true;

-- Push notification log
CREATE TABLE IF NOT EXISTS push_notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  image TEXT,
  tag TEXT,
  target TEXT DEFAULT 'all', -- 'all', 'admin', 'customers'
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- PWA events tracking (installs, etc.)
CREATE TABLE IF NOT EXISTS pwa_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- 'install', 'uninstall', 'push_subscribe', 'push_unsubscribe'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_notifications_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE pwa_events ENABLE ROW LEVEL SECURITY;

-- Policies: anon can insert subscriptions and events
CREATE POLICY "anon_insert_push_sub" ON push_subscriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_own_push_sub" ON push_subscriptions FOR DELETE TO anon USING (true);
CREATE POLICY "service_role_all_push_sub" ON push_subscriptions FOR ALL TO service_role USING (true);

CREATE POLICY "anon_insert_push_log" ON push_notifications_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "service_role_all_push_log" ON push_notifications_log FOR ALL TO service_role USING (true);

CREATE POLICY "anon_insert_pwa_events" ON pwa_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "service_role_all_pwa_events" ON pwa_events FOR ALL TO service_role USING (true);
