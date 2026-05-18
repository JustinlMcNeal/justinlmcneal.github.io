SELECT cron.schedule(
  'ebay-sync-orders-every-2h',
  '0 */2 * * *',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/ebay-sync-orders',
    headers := '{"Authorization": "Bearer <SUPABASE_SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{"days_back": 3}'::jsonb
  )$$
);
