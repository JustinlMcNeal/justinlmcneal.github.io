-- Add ebay_store_category to products table so the selected store category
-- persists locally and doesn't depend on eBay's GET offer response reliably
-- returning storeCategoryNames.

ALTER TABLE products ADD COLUMN IF NOT EXISTS ebay_store_category TEXT;
