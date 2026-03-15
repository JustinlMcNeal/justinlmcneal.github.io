-- =====================================================
-- KARRY KRAZE — CRON JOB SETUP
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- =====================================================
-- 
-- BEFORE RUNNING: Replace YOUR_SERVICE_ROLE_KEY below with your actual
-- Supabase service role key. Find it at:
--   Dashboard → Settings → API → service_role (secret)
--
-- =====================================================

-- Step 1: Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ─────────────────────────────────────────────────────
-- JOB 1: Process Scheduled Posts (every minute)
-- Publishes queued social posts when their scheduled time arrives.
-- ─────────────────────────────────────────────────────
SELECT cron.schedule(
  'process-scheduled-social-posts',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/process-scheduled-posts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ─────────────────────────────────────────────────────
-- JOB 2: Autopilot Fill (daily at 2:00 AM UTC)
-- Checks content calendar gaps and auto-generates posts
-- to keep the queue full for the next 7 days.
-- ─────────────────────────────────────────────────────
SELECT cron.schedule(
  'autopilot-fill-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/autopilot-fill',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- ─────────────────────────────────────────────────────
-- JOB 3: Token Refresh (daily at 3:00 AM UTC)
-- Auto-refreshes Instagram/Facebook tokens before the
-- 60-day expiry, and Pinterest tokens via refresh_token.
-- ─────────────────────────────────────────────────────
SELECT cron.schedule(
  'refresh-social-tokens-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/refresh-tokens',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);


-- =====================================================
-- USEFUL COMMANDS (run these to check/manage jobs)
-- =====================================================

-- See all registered cron jobs:
-- SELECT * FROM cron.job;

-- See recent job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 30;

-- Delete a specific job:
-- SELECT cron.unschedule('process-scheduled-social-posts');
-- SELECT cron.unschedule('autopilot-fill-daily');
-- SELECT cron.unschedule('refresh-social-tokens-daily');

-- Delete ALL jobs (nuclear option):
-- SELECT cron.unschedule(jobname) FROM cron.job;
