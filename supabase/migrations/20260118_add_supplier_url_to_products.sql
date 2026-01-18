-- Add supplier_url column to products table for internal supplier/purchase links
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_url TEXT;

-- Add comment
COMMENT ON COLUMN products.supplier_url IS 'Internal: Supplier product page URL (1688, Alibaba, etc.)';
