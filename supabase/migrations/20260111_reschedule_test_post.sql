-- Update the queued Pinterest post to run now for testing
UPDATE social_posts 
SET scheduled_for = NOW() - INTERVAL '1 minute'
WHERE id = 'ee54bcb1-1ff3-495a-8e9a-f3ea9ef44bb0' 
  AND status = 'queued';
