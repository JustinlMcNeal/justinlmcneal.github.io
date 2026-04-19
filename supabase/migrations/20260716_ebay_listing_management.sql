-- ============================================================
-- eBay Phase 1: Listing Management
-- Adds eBay listing columns to products table,
-- creates ebay_category_cache table.
-- ============================================================

-- -----------------------------------------------
-- 1. Add eBay listing columns to products
-- -----------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ebay_sku          TEXT,
  ADD COLUMN IF NOT EXISTS ebay_offer_id     TEXT,
  ADD COLUMN IF NOT EXISTS ebay_listing_id   TEXT,
  ADD COLUMN IF NOT EXISTS ebay_status       TEXT DEFAULT 'not_listed',
  ADD COLUMN IF NOT EXISTS ebay_category_id  TEXT,
  ADD COLUMN IF NOT EXISTS ebay_price_cents  INTEGER;

-- -----------------------------------------------
-- 2. Create eBay category cache table
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS ebay_category_cache (
  category_id   TEXT PRIMARY KEY,
  category_name TEXT NOT NULL,
  aspects       JSONB,
  cached_at     TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS (admin-only via service role)
ALTER TABLE ebay_category_cache ENABLE ROW LEVEL SECURITY;
