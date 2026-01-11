-- Add amazon_url column to products table for linking to Amazon product pages
ALTER TABLE products ADD COLUMN IF NOT EXISTS amazon_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN products.amazon_url IS 'Optional Amazon product page URL for "Buy on Amazon" button';
