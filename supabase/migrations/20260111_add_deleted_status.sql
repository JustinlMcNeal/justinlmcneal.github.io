-- ============================================
-- Add 'deleted' to allowed status values
-- ============================================
-- The status column has a CHECK constraint that needs to include 'deleted'

-- Drop the old constraint
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;

-- Add new constraint with 'deleted' included
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check 
  CHECK (status IN ('draft', 'pending', 'scheduled', 'queued', 'posting', 'posted', 'failed', 'deleted'));

-- Add comment
COMMENT ON CONSTRAINT social_posts_status_check ON social_posts IS 'Valid status values for social posts';
