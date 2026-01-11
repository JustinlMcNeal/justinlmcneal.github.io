-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule the process-scheduled-posts function to run every minute
-- This will check for posts that are due and process them
SELECT cron.schedule(
  'process-scheduled-posts',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-scheduled-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Note: The above may not work directly. For Supabase hosted, you need to:
-- 1. Go to Database > Extensions > Enable pg_cron
-- 2. Go to Database > Cron Jobs > Add job
-- Or use the Supabase Dashboard to set up the cron job

-- Alternative: Use pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a function that calls the edge function
CREATE OR REPLACE FUNCTION process_scheduled_posts_trigger()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url text;
  service_key text;
BEGIN
  -- Get settings from environment or secrets
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  
  -- If settings not available, try to get from vault
  IF supabase_url IS NULL THEN
    SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  END IF;
  
  IF service_key IS NULL THEN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  END IF;

  -- Make HTTP request to edge function
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/process-scheduled-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- Note: For Supabase Cloud, you'll need to set up the cron job manually in the dashboard:
-- 1. Go to Database > Cron Jobs
-- 2. Click "Create Job"
-- 3. Name: process-scheduled-posts
-- 4. Schedule: * * * * * (every minute)
-- 5. Command: SELECT net.http_post(...)

COMMENT ON FUNCTION process_scheduled_posts_trigger IS 
'Triggers the process-scheduled-posts edge function to post due scheduled social media posts';
