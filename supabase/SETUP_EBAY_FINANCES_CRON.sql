-- Schedule ebay-sync-finances to run daily at 6 AM UTC
-- (After ebay-sync-orders which runs every 2 hours)
-- Pulls last 30 days of transactions, deduplicates against existing expenses
SELECT cron.schedule(
  'ebay-sync-finances-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/ebay-sync-finances',
    headers := '{"Authorization":"Bearer <SUPABASE_SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
    body := '{"days_back":30}'::jsonb
  );
  $$
);
