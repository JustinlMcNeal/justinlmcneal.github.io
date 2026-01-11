-- ============================================
-- Fix RLS policies for social_category_hashtags
-- Run this in Supabase SQL Editor
-- ============================================

-- Allow public/anon read access to category hashtags
CREATE POLICY "Public can read category hashtags" 
ON social_category_hashtags 
FOR SELECT 
TO anon, authenticated 
USING (true);
