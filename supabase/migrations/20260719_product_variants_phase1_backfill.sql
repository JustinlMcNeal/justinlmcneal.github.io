-- ============================================================
-- Migration: 20260719_product_variants_phase1_backfill.sql
-- Phase 1 — Sizes data backfill
--
-- Safely populates the new columns added by 20260718_product_variants_phase1_schema.sql
-- for all existing product_variants rows.
--
-- IMPORTANT: Run this AFTER 20260718 schema migration is applied.
--
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/20260719_product_variants_phase1_backfill.sql
--
-- This migration is idempotent — safe to run multiple times.
-- ============================================================

-- ─── Backfill: title ─────────────────────────────────────────────────────────
--
-- Set title = option_value for all rows where title is currently null or empty.
-- This makes the new title column immediately populated and meaningful.
-- Future admin UI may let merchants set a custom title (e.g. "Dark Navy" instead of "#003087").
--
UPDATE public.product_variants
SET title = option_value
WHERE (title IS NULL OR title = '')
  AND option_value IS NOT NULL
  AND option_value != '';

-- ─── Backfill: option_values ──────────────────────────────────────────────────
--
-- Populate option_values JSONB from existing option_name + option_value pairs.
-- Only updates rows where option_values is currently the empty object default.
-- Example result: { "Color": "Black" } or { "Size": "M" }
--
-- This allows future reads to use: WHERE option_values @> '{"Color": "Black"}'
-- and to format display labels via the option_values structure.
--
-- CAUTION: Only fills rows where option_values = '{}' to avoid overwriting
-- any rows that were already set by other means.
--
UPDATE public.product_variants
SET option_values = jsonb_build_object(option_name, option_value)
WHERE option_values = '{}'::jsonb
  AND option_name IS NOT NULL
  AND option_name != ''
  AND option_value IS NOT NULL
  AND option_value != '';

-- ─── Backfill: is_default ─────────────────────────────────────────────────────
--
-- Mark the single active variant as is_default=true for products that have
-- exactly one active variant row.
--
-- Logic:
--   - Count active variants per product.
--   - For products with exactly 1 active variant, set that variant's is_default = true.
--   - For products with 0 or multiple active variants, do nothing (leave false).
--
-- Rationale:
--   - Products with one variant (e.g. a bag that only comes in black) have
--     an unambiguous default.
--   - Products with multiple variants (e.g. a hoodie in S/M/L) need the admin
--     or a future phase to designate a default intentionally.
--   - is_default is safe to leave false for multi-variant products; application
--     code must not require it to be set.
--
UPDATE public.product_variants pv
SET is_default = true
FROM (
  SELECT product_id
  FROM public.product_variants
  WHERE is_active = true
  GROUP BY product_id
  HAVING COUNT(*) = 1
) single_variant_products
WHERE pv.product_id = single_variant_products.product_id
  AND pv.is_active = true
  AND pv.is_default = false;  -- idempotent: skip already-set rows

-- ─── Verification queries (informational, not executed) ───────────────────────
--
-- Run these manually to confirm backfill results:
--
-- SELECT COUNT(*) FROM product_variants WHERE title IS NULL;
--   Expected: 0 (all rows should have title after backfill)
--
-- SELECT COUNT(*) FROM product_variants WHERE option_values = '{}'::jsonb;
--   Expected: 0 (all rows should have option_values set, assuming all had option_name + option_value)
--
-- SELECT COUNT(*) FROM product_variants WHERE is_default = true;
--   Expected: 28 (one per product with exactly one active variant, per pre-migration audit)
--
-- SELECT option_name, COUNT(*) FROM product_variants GROUP BY option_name;
--   Expected: only 'Color' rows (171 total), confirming no unintended data changes
