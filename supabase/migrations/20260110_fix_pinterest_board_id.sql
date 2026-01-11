-- ============================================
-- Fix Pinterest Board ID column type
-- Run this in Supabase SQL Editor
-- ============================================

-- Drop the foreign key constraint and change column type to TEXT
-- (Pinterest board IDs are numeric strings, not UUIDs)

ALTER TABLE social_posts 
DROP CONSTRAINT IF EXISTS social_posts_pinterest_board_id_fkey;

ALTER TABLE social_posts 
ALTER COLUMN pinterest_board_id TYPE TEXT;

-- Add comment for clarity
COMMENT ON COLUMN social_posts.pinterest_board_id IS 'Pinterest board ID from Pinterest API (numeric string)';
