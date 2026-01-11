-- Create social_category_hashtags table for storing hashtags by category
-- Run this in Supabase SQL Editor

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS social_category_hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  hashtags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category_id)
);

-- Enable RLS
ALTER TABLE social_category_hashtags ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "Allow authenticated read" ON social_category_hashtags
  FOR SELECT TO authenticated USING (true);

-- Allow all authenticated users to insert/update
CREATE POLICY "Allow authenticated insert" ON social_category_hashtags
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON social_category_hashtags
  FOR UPDATE TO authenticated USING (true);

-- Seed some default hashtags for common categories
-- You can customize these based on your actual category IDs
INSERT INTO social_category_hashtags (category_id, hashtags)
SELECT 
  c.id,
  CASE 
    WHEN LOWER(c.name) LIKE '%headwear%' OR LOWER(c.name) LIKE '%hat%' OR LOWER(c.name) LIKE '%beanie%'
      THEN ARRAY['#headwear', '#fashion', '#style', '#accessories', '#karrykraze', '#hats', '#beanies']
    WHEN LOWER(c.name) LIKE '%shirt%' OR LOWER(c.name) LIKE '%top%'
      THEN ARRAY['#shirts', '#fashion', '#style', '#ootd', '#karrykraze', '#streetwear']
    WHEN LOWER(c.name) LIKE '%accessori%'
      THEN ARRAY['#accessories', '#fashion', '#style', '#karrykraze', '#trending']
    ELSE ARRAY['#fashion', '#style', '#karrykraze', '#shopnow', '#trending']
  END
FROM categories c
WHERE c.id NOT IN (SELECT category_id FROM social_category_hashtags WHERE category_id IS NOT NULL);

-- Comment
COMMENT ON TABLE social_category_hashtags IS 'Stores default hashtags for each product category';
