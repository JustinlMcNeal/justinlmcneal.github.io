-- Phase 10W — Scheduled returns/restock digest (daily + optional weekly).
-- Requires pg_cron + pg_net. Replace placeholders before running in Supabase SQL editor.
-- Guard: x-cron-secret must match CRON_SECRET env on the edge function.

-- Daily digest (default 14:00 UTC ≈ 9–10 AM US Eastern; adjust cron expression as needed)
SELECT cron.schedule(
  'inventory-returns-restock-digest-daily',
  '0 14 * * *',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/inventory-returns-restock-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{"mode":"send","run_type":"daily"}'::jsonb
  )$$
);

-- Optional weekly summary (Mondays 14:00 UTC)
SELECT cron.schedule(
  'inventory-returns-restock-digest-weekly',
  '0 14 * * 1',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/inventory-returns-restock-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{"mode":"send","run_type":"weekly"}'::jsonb
  )$$
);

-- Email delivery (optional): set Supabase secrets before enabling cron sends:
--   RESEND_API_KEY
--   RETURNS_RESTOCK_DIGEST_EMAIL_TO  (recipient)
--   RETURNS_RESTOCK_DIGEST_EMAIL_FROM (optional; falls back to Amazon alert from-address)
--
-- Duplicate safety: inventory_returns_restock_digest_runs unique index on (run_type, schedule_window)
-- where status = 'sent' prevents repeat daily/weekly sends for the same window.
