-- ============================================
-- Social posts status alignment (Phase 2a)
-- ============================================
-- Problem: migrations diverged on social_posts.status CHECK values.
--   - fix_social_tables introduced "published" and migrated posted → published
--   - add_deleted_status dropped "published" and "processing"
--   - process-scheduled-posts writes "processing"; publishers write "posted"
--
-- Canonical success status: posted
-- In-progress publish: processing
-- This migration is safe to re-run (idempotent data + constraint replace).

-- 1. Normalize legacy success rows
UPDATE social_posts
SET status = 'posted', updated_at = COALESCE(updated_at, now())
WHERE status = 'published';

-- 2. Replace CHECK constraint with unified allowed set
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;

ALTER TABLE social_posts
ADD CONSTRAINT social_posts_status_check
CHECK (status IN (
  'draft',
  'pending',
  'scheduled',
  'queued',
  'approved',
  'processing',
  'posting',
  'posted',
  'failed',
  'deleted'
));

COMMENT ON CONSTRAINT social_posts_status_check ON social_posts IS
  'Phase 2a: posted = published success; processing = in-flight publish; published removed after data backfill';
