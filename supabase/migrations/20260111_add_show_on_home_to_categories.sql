-- Add show_on_home column to categories table for controlling homepage visibility
-- This allows explicit control over which categories appear in the home category strip

ALTER TABLE categories ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN categories.show_on_home IS 'Controls whether this category appears in the homepage category strip';

-- Update the v_home_categories view to filter by show_on_home
CREATE OR REPLACE VIEW v_home_categories AS
SELECT 
  c.id,
  c.name,
  c.slug,
  c.home_image_path,
  c.home_sort_order,
  c.show_on_home,
  COUNT(p.id) AS product_count
FROM categories c
LEFT JOIN products p ON p.category_id = c.id AND p.is_active = true
WHERE c.is_active = true 
  AND c.show_on_home = true
GROUP BY c.id, c.name, c.slug, c.home_image_path, c.home_sort_order, c.show_on_home
ORDER BY c.home_sort_order ASC, c.name ASC;
