SELECT cron.schedule(
  'ebay-sync-orders-every-2h',
  '0 */2 * * *',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/ebay-sync-orders',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTczNDk0MCwiZXhwIjoyMDgxMzEwOTQwfQ.a3efcbSIIY9u0iIiKteahNQC_d5K6fbKYyk7Oh8LbSw", "Content-Type": "application/json"}'::jsonb,
    body := '{"days_back": 3}'::jsonb
  )$$
);
