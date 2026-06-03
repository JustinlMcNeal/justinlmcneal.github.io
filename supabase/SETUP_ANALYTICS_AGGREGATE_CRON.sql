-- Schedule analytics aggregate refresh daily at 08:20 UTC
-- Dependency order:
--   06:00 ebay-sync-finances
--   07:00 amazon-sync-finances
--   */4  amazon-sync-orders + ebay-sync-orders
--   08:20 analytics-aggregate

SELECT cron.schedule(
  'analytics-aggregate-daily',
  '20 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/analytics-aggregate',
    headers := '{"Authorization":"Bearer <SUPABASE_SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
    body := '{"days":30,"refresh":true}'::jsonb
  ) AS request_id;
  $$
);

-- Verify job exists
SELECT jobid, jobname, schedule
FROM cron.job
WHERE jobname = 'analytics-aggregate-daily';
