-- Autopilot pg_cron job - runs daily at 6 AM to fill the queue
-- Run this in Supabase SQL Editor

-- Create the cron job for autopilot (runs daily at 6 AM UTC)
SELECT cron.schedule(
  'autopilot-fill-daily',
  '0 6 * * *',  -- 6 AM UTC every day
  $$
  SELECT
    net.http_post(
      url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/autopilot-fill',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'autopilot-fill-daily';

-- To remove the job if needed:
-- SELECT cron.unschedule('autopilot-fill-daily');
