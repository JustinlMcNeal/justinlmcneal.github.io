-- ================================================================
-- pg_cron job for abandoned cart SMS checks
-- Runs every 5 minutes to detect and notify abandoned carts
-- ================================================================

-- Run abandoned cart checks every 5 minutes
SELECT cron.schedule(
  'sms-abandoned-cart-check',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url    := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sms-abandoned-cart',
    body   := '{}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MzQ5NDAsImV4cCI6MjA4MTMxMDk0MH0.cuCteItNo6yFCYcot0Vx7kUOUtV0r-iCwJ_ACAiKGso'
    )
  );
  $$
);
