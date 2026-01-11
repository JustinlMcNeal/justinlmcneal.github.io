-- Add Facebook as a platform option
-- Update the platform check constraint to allow 'facebook'

-- Drop existing constraint
ALTER TABLE social_posts 
DROP CONSTRAINT IF EXISTS social_posts_platform_check;

-- Add new constraint including facebook
ALTER TABLE social_posts 
ADD CONSTRAINT social_posts_platform_check 
CHECK (platform IN ('instagram', 'pinterest', 'facebook'));

-- Also update variations table
ALTER TABLE social_variations 
DROP CONSTRAINT IF EXISTS social_variations_platform_check;

ALTER TABLE social_variations 
ADD CONSTRAINT social_variations_platform_check 
CHECK (platform IN ('instagram', 'pinterest', 'facebook', 'both'));

-- Add Facebook connection status to social_settings
INSERT INTO social_settings (setting_key, setting_value)
VALUES ('facebook_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
