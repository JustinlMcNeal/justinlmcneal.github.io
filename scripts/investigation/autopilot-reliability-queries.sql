-- Read-only production investigation — Admin Social automation
-- Run: npx supabase db query --linked -f scripts/investigation/autopilot-reliability-queries.sql

-- 1. social_settings (no secrets)
SELECT setting_key,
  CASE setting_key
    WHEN 'autopilot' THEN setting_value
    WHEN 'autopilot_last_run' THEN setting_value
    WHEN 'auto_queue_last_run' THEN setting_value
    WHEN 'auto_queue' THEN jsonb_build_object(
      'count', setting_value->'count',
      'platforms', setting_value->'platforms',
      'image_asset_policy', setting_value->'image_asset_policy',
      'allow_multi_platform_per_product', setting_value->'allow_multi_platform_per_product',
      'allow_catalog_fallback', setting_value->'allow_catalog_fallback'
    )
    WHEN 'instagram_connected' THEN jsonb_build_object('connected', (setting_value->>'connected')::boolean, 'has_token', (setting_value->'access_token') IS NOT NULL)
    WHEN 'facebook_connected' THEN jsonb_build_object('connected', (setting_value->>'connected')::boolean, 'has_token', (setting_value->'access_token') IS NOT NULL)
    WHEN 'pinterest_connected' THEN jsonb_build_object('connected', (setting_value->>'connected')::boolean, 'has_token', (setting_value->'access_token') IS NOT NULL)
    ELSE jsonb_build_object('keys', (SELECT array_agg(k) FROM jsonb_object_keys(setting_value) k))
  END AS safe_value
FROM social_settings
WHERE setting_key IN (
  'autopilot', 'autopilot_last_run', 'auto_queue_last_run', 'auto_queue',
  'instagram_connected', 'facebook_connected', 'pinterest_connected',
  'pinterest_board_map'
)
ORDER BY setting_key;

-- 2. Post counts by status
SELECT status, COUNT(*) AS cnt
FROM social_posts
GROUP BY status
ORDER BY cnt DESC;

-- 3. Queued/draft in autopilot window (tomorrow + 3 days — adjust days if settings differ)
WITH bounds AS (
  SELECT
    (date_trunc('day', now() AT TIME ZONE 'utc') + interval '1 day') AS tomorrow_start,
    (date_trunc('day', now() AT TIME ZONE 'utc') + interval '4 days') AS window_end
)
SELECT COUNT(*) AS autopilot_window_queued_draft
FROM social_posts p, bounds b
WHERE p.status IN ('queued', 'draft')
  AND p.scheduled_for >= b.tomorrow_start
  AND p.scheduled_for <= b.window_end;

-- 4. Failed posts last 7 days
SELECT id, platform, status, scheduled_for, posted_at, updated_at,
  LEFT(error_message, 200) AS error_preview,
  product_id, pinterest_board_id
FROM social_posts
WHERE status = 'failed'
  AND scheduled_for >= now() - interval '7 days'
ORDER BY scheduled_for DESC
LIMIT 20;

-- 5. Today's due / failed / posted (UTC day)
SELECT id, platform, status, scheduled_for,
  LEFT(error_message, 200) AS error_preview,
  LEFT(caption, 60) AS caption_preview,
  pinterest_board_id,
  image_url IS NOT NULL AS has_image
FROM social_posts
WHERE scheduled_for >= date_trunc('day', now())
  AND scheduled_for < date_trunc('day', now()) + interval '1 day'
ORDER BY scheduled_for;

-- 6. Recent posts any status (7d)
SELECT id, platform, status, scheduled_for, posted_at,
  LEFT(error_message, 120) AS error_preview
FROM social_posts
WHERE scheduled_for >= now() - interval '7 days'
ORDER BY scheduled_for DESC
LIMIT 30;

-- 7. Cron jobs
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname ILIKE '%autopilot%'
   OR jobname ILIKE '%scheduled%'
   OR jobname ILIKE '%instagram%'
   OR jobname ILIKE '%refresh%social%'
   OR jobname ILIKE '%social%'
ORDER BY jobname;

-- 8. Cron run details — autopilot (7d)
SELECT j.jobname, d.status, d.start_time, d.end_time,
  LEFT(d.return_message, 300) AS return_preview
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname ILIKE '%autopilot%'
  AND d.start_time >= now() - interval '7 days'
ORDER BY d.start_time DESC
LIMIT 25;

-- 9. Cron run details — process scheduled (48h)
SELECT j.jobname, d.status, d.start_time, d.end_time,
  LEFT(d.return_message, 200) AS return_preview
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE (j.jobname ILIKE '%process%scheduled%' OR j.command ILIKE '%process-scheduled%')
  AND d.start_time >= now() - interval '48 hours'
ORDER BY d.start_time DESC
LIMIT 15;

-- 10. App settings (presence only, no secret values)
SELECT 'app.settings.supabase_url' AS name,
  (current_setting('app.settings.supabase_url', true) IS NOT NULL AND length(current_setting('app.settings.supabase_url', true)) > 0) AS configured;
SELECT 'app.settings.service_role_key' AS name,
  (current_setting('app.settings.service_role_key', true) IS NOT NULL AND length(current_setting('app.settings.service_role_key', true)) > 0) AS configured;
