-- Schedule analytics aggregate refresh daily at 08:20 UTC
-- Dependency order:
--   06:00 ebay-sync-finances
--   08:00 ebay-sync-orders fallback
--   08:20 analytics-aggregate

SELECT cron.schedule(
  'analytics-aggregate-daily',
  '20 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/analytics-aggregate',
    headers := '{"Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTczNDk0MCwiZXhwIjoyMDgxMzEwOTQwfQ.a3efcbSIIY9u0iIiKteahNQC_d5K6fbKYyk7Oh8LbSw","Content-Type":"application/json"}'::jsonb,
    body := '{"days":30,"refresh":true}'::jsonb
  ) AS request_id;
  $$
);

-- Verify job exists
SELECT jobid, jobname, schedule
FROM cron.job
WHERE jobname = 'analytics-aggregate-daily';
