-- Add external_id column to social_posts for storing platform-specific post IDs
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Add posted_at column if it doesn't exist
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

-- Add error_message column if it doesn't exist
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add index for looking up posts by external_id
CREATE INDEX IF NOT EXISTS idx_social_posts_external_id ON social_posts(external_id) WHERE external_id IS NOT NULL;
