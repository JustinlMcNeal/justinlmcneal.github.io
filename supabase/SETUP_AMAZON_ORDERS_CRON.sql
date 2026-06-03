-- Schedule Amazon order sync every 4 hours (mirrors eBay cadence, lighter SP-API rate limits).
-- Uses service role auth on amazon-sync-orders (same pattern as ebay-sync-orders).
-- Replace <SUPABASE_SERVICE_ROLE_KEY> with your project service role key.

SELECT cron.schedule(
  'amazon-sync-orders-every-4h',
  '0 */4 * * *',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/amazon-sync-orders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{"days_back": 3}'::jsonb
  )$$
);

-- Daily Amazon finance sync at 7 AM UTC (after eBay finances at 6 AM, before analytics at 8:20).
SELECT cron.schedule(
  'amazon-sync-finances-daily',
  '0 7 * * *',
  $$SELECT net.http_post(
    url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/amazon-sync-finances',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{"days_back": 30}'::jsonb
  )$$
);
