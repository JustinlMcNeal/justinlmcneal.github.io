-- Schedule process-sale-channel-sync-queue every 10 minutes (Phase 061B).
-- Requires pg_cron + pg_net. Replace <SUPABASE_SERVICE_ROLE_KEY> and <CRON_SECRET>
-- before running in the SQL editor, OR use:
--   node scripts/supabase/schedule-sale-channel-sync-cron.mjs
--
-- Live pushes also require edge secrets:
--   SALE_CHANNEL_SYNC_ENABLED=true
--   AMAZON_ENABLE_LIVE_PATCH=true (for Amazon targets)
--   EBAY_ENABLE_LIVE_QUANTITY_PATCH=true (for eBay targets)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-sale-channel-sync-queue-every-10m') THEN
    PERFORM cron.unschedule('process-sale-channel-sync-queue-every-10m');
  END IF;
END $$;

SELECT cron.schedule(
  'process-sale-channel-sync-queue-every-10m',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/process-sale-channel-sync-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{"limit": 20, "preview": false, "workerId": "pg_cron_sale_sync"}'::jsonb
  );
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'process-sale-channel-sync-queue-every-10m';
