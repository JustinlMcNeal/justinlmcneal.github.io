-- Setup Instagram Insights Sync Cron Job
-- Runs every 6 hours to fetch engagement metrics for recent posts
-- Syncs posts that haven't been updated in 6+ hours (default behavior of the edge function)

SELECT cron.schedule(
  'sync-instagram-insights',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/instagram-insights',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTczNDk0MCwiZXhwIjoyMDgxMzEwOTQwfQ.a3efcbSIIY9u0iIiKteahNQC_d5K6fbKYyk7Oh8LbSw"}'::jsonb,
    body := '{"syncAll": false}'::jsonb
  ) AS request_id;
  $$
);

-- Verify the job was created
SELECT jobid, jobname, schedule FROM cron.job WHERE jobname = 'sync-instagram-insights';
