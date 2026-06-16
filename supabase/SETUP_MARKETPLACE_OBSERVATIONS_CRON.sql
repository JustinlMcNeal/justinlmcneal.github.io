-- Phase 10P — Scheduled marketplace observation refresh (every 6 hours).
-- Requires pg_cron + pg_net (same pattern as SETUP_EBAY_SYNC_CRON.sql).
-- Replace placeholders before running in Supabase SQL editor.

SELECT cron.schedule(
  'marketplace-observations-refresh-every-6h',
  '0 */6 * * *',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/marketplace-refresh-observations-cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{"days_back": 14}'::jsonb
  )$$
);
