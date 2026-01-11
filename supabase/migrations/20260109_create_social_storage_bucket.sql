-- ============================================
-- Create Storage Bucket for Social Media
-- Run this in Supabase SQL Editor
-- ============================================

-- Create the social-media bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('social-media', 'social-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload social media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'social-media');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update social media" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'social-media');

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete social media" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'social-media');

-- Allow public read access (for the images to be accessible)
CREATE POLICY "Public can read social media" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'social-media');
