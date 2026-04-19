-- Schedule ebay-sync-finances to run daily at 6 AM UTC
-- (After ebay-sync-orders which runs every 2 hours)
-- Pulls last 30 days of transactions, deduplicates against existing expenses
SELECT cron.schedule(
  'ebay-sync-finances-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/ebay-sync-finances',
    headers := '{"Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTczNDk0MCwiZXhwIjoyMDgxMzEwOTQwfQ.a3efcbSIIY9u0iIiKteahNQC_d5K6fbKYyk7Oh8LbSw","Content-Type":"application/json"}'::jsonb,
    body := '{"days_back":30}'::jsonb
  );
  $$
);
