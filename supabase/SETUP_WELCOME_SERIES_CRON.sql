-- pg_cron job for sms-welcome-series
-- Runs hourly at :45 (offset from coupon-reminder at :30)
-- Invokes the edge function which handles Day 2 and Day 5 logic
SELECT cron.schedule(
  'sms-welcome-series',
  '45 * * * *',
  $$
  SELECT net.http_post(
    url   := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sms-welcome-series',
    body  := '{}',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MzQ5NDAsImV4cCI6MjA4MTMxMDk0MH0.cuCteItNo6yFCYcot0Vx7kUOUtV0r-iCwJ_ACAiKGso'
    )
  );
  $$
);
