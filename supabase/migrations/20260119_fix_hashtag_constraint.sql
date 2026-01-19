-- Add unique constraint to social_hashtag_analytics for upsert operations
-- This allows ON CONFLICT (post_id, hashtag) to work properly

-- First, remove any duplicate entries (keep the most recent)
DELETE FROM social_hashtag_analytics a
USING social_hashtag_analytics b
WHERE a.post_id = b.post_id 
  AND a.hashtag = b.hashtag 
  AND a.tracked_at < b.tracked_at;

-- Now add the unique constraint
ALTER TABLE social_hashtag_analytics 
ADD CONSTRAINT unique_post_hashtag UNIQUE (post_id, hashtag);
