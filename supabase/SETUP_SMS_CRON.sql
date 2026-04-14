-- ================================================================
-- pg_cron job: Run coupon reminder check every hour
-- Calls the sms-coupon-reminder edge function
-- ================================================================
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- pg_cron extension must be enabled

-- Enable pg_cron if not already
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule: run every hour at :30 (e.g. 9:30, 10:30, etc.)
-- The edge function itself enforces quiet hours (9 AM - 9 PM ET)
SELECT cron.schedule(
  'sms-coupon-reminder',          -- job name
  '30 * * * *',                   -- every hour at :30
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sms-coupon-reminder',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check scheduled jobs:
-- SELECT * FROM cron.job;

-- To remove the job:
-- SELECT cron.unschedule('sms-coupon-reminder');
