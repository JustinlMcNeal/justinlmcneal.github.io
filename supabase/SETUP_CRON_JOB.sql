-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR TO ENABLE CRON
-- =====================================================

-- Step 1: Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 2: Create the cron job that runs every minute
-- Replace YOUR_SUPABASE_URL and YOUR_SERVICE_ROLE_KEY with actual values

SELECT cron.schedule(
  'process-scheduled-social-posts',  -- Job name
  '* * * * *',                        -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/process-scheduled-posts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To check if the job was created:
-- SELECT * FROM cron.job;

-- To see job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- To delete the job if needed:
-- SELECT cron.unschedule('process-scheduled-social-posts');
