-- ============================================
-- Cron Job for Instagram Insights Sync
-- ============================================
-- Runs every 6 hours to update engagement metrics for recent posts

-- Enable pg_cron extension (if not already enabled)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the insights sync job
-- Runs at 00:00, 06:00, 12:00, and 18:00 UTC daily
SELECT cron.schedule(
  'instagram-insights-sync',
  '0 */6 * * *',  -- Every 6 hours
  $$
  SELECT net.http_post(
    url := (SELECT current_setting('app.settings.supabase_url') || '/functions/v1/instagram-insights'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT current_setting('app.settings.service_role_key'))
    ),
    body := jsonb_build_object(
      'syncAll', false,
      'daysBack', 7
    )
  );
  $$
);

-- Optional: Add a job to do a full sync weekly (looks back 30 days)
SELECT cron.schedule(
  'instagram-insights-weekly-sync',
  '0 3 * * 0',  -- Every Sunday at 3:00 AM UTC
  $$
  SELECT net.http_post(
    url := (SELECT current_setting('app.settings.supabase_url') || '/functions/v1/instagram-insights'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT current_setting('app.settings.service_role_key'))
    ),
    body := jsonb_build_object(
      'syncAll', true,
      'daysBack', 30
    )
  );
  $$
);

-- View scheduled jobs
-- SELECT * FROM cron.job;

-- To unschedule:
-- SELECT cron.unschedule('instagram-insights-sync');
-- SELECT cron.unschedule('instagram-insights-weekly-sync');
