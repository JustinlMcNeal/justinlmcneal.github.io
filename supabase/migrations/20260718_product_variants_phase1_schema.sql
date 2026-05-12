-- ============================================================
-- Migration: 20260718_product_variants_phase1_schema.sql
-- Phase 1 — Sizes schema foundation
--
-- Adds nullable/safe columns to product_variants and line_items_raw
-- to support future size rollout.
--
-- Apply with:
--   npx supabase db query --linked -f supabase/migrations/20260718_product_variants_phase1_schema.sql
--
-- All additions are non-destructive (ADD COLUMN IF NOT EXISTS).
-- No existing rows or constraints are modified.
-- No NOT NULL constraints are added to new columns (except is_default which has a safe DEFAULT).
-- ============================================================

-- ─── product_variants: new columns ───────────────────────────────────────────

-- Variant-level display title.
-- Preferred display name; falls back to option_value in application code.
-- Null for existing rows until backfill migration runs.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Variant-level SKU (e.g. "KK-1001-M").
-- Optional — null is allowed. Must be globally unique when set.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS sku TEXT;

-- Structured option key-value map.
-- Example: { "Size": "M" } or { "Color": "Black" } or { "Size": "L", "Color": "Black" }
-- Defaults to empty object — backfill migration will populate from existing option_name/option_value.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS option_values JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Per-variant price override in cents.
-- Null = use product-level price. Set only if this variant costs more/less.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS price_override_cents INTEGER;

-- Per-variant weight override in grams.
-- Null = use product-level weight_g.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS weight_g_override INTEGER;

-- Per-variant unit cost override in cents.
-- Null = use product-level unit_cost.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS unit_cost_override_cents INTEGER;

-- Default variant flag.
-- True for single-variant products or admin-selected default.
-- Backfill migration sets this for products with exactly one active variant.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- ─── product_variants: indexes ────────────────────────────────────────────────

-- Partial unique index on SKU — enforces uniqueness only where SKU is set.
-- Allows null SKU without constraint violation.
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_unique
  ON public.product_variants (sku)
  WHERE sku IS NOT NULL;

-- GIN index on option_values for JSON containment queries (@>) when filtering
-- variants by a specific option (e.g. WHERE option_values @> '{"Size": "M"}').
CREATE INDEX IF NOT EXISTS idx_product_variants_option_values_gin
  ON public.product_variants USING gin (option_values);

-- ─── line_items_raw: new columns ─────────────────────────────────────────────

-- Durable FK-compatible reference to product_variants.id at purchase time.
-- Nullable: legacy orders, eBay/Amazon imports, and generic carrier imports
-- will not have an internal variant UUID. This MUST remain nullable.
ALTER TABLE public.line_items_raw
  ADD COLUMN IF NOT EXISTS variant_id UUID;

-- Variant SKU snapshot taken at purchase time.
-- Allows SKU lookup in fulfillment even if variant is later edited.
ALTER TABLE public.line_items_raw
  ADD COLUMN IF NOT EXISTS variant_sku TEXT;

-- Variant title snapshot taken at purchase time.
-- Human-readable label ("Large", "Black / Small") for admin/fulfillment.
ALTER TABLE public.line_items_raw
  ADD COLUMN IF NOT EXISTS variant_title TEXT;

-- Structured option snapshot taken at purchase time.
-- Example: { "Size": "L" } or { "Color": "Black", "Size": "M" }
-- Allows rendering "Size: L" in admin without re-querying product_variants.
ALTER TABLE public.line_items_raw
  ADD COLUMN IF NOT EXISTS selected_options JSONB;

-- ─── line_items_raw: indexes ──────────────────────────────────────────────────

-- Index for joining or filtering line items by variant_id.
CREATE INDEX IF NOT EXISTS idx_line_items_raw_variant_id
  ON public.line_items_raw (variant_id);

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.product_variants.title
  IS 'Explicit display title for this variant (e.g. "Large"). Falls back to option_value in application code if null.';

COMMENT ON COLUMN public.product_variants.sku
  IS 'Variant-level SKU (e.g. KK-1001-M). Optional; unique where set. Null means SKU is inherited from product.code or not assigned.';

COMMENT ON COLUMN public.product_variants.option_values
  IS 'Structured option map: { "Size": "M" } or { "Color": "Black" }. Backfilled from option_name + option_value for existing rows.';

COMMENT ON COLUMN public.product_variants.price_override_cents
  IS 'Variant-level price override in cents. Null = use product-level price.';

COMMENT ON COLUMN public.product_variants.weight_g_override
  IS 'Variant-level weight override in grams. Null = use product-level weight_g.';

COMMENT ON COLUMN public.product_variants.unit_cost_override_cents
  IS 'Variant-level unit cost override in cents. Null = use product-level unit_cost.';

COMMENT ON COLUMN public.product_variants.is_default
  IS 'True for the default/primary variant of a product. Set for single-variant products by backfill; admin can designate default for multi-variant.';

COMMENT ON COLUMN public.line_items_raw.variant_id
  IS 'Reference to product_variants.id at purchase time. Nullable; legacy and imported orders will not have this.';

COMMENT ON COLUMN public.line_items_raw.variant_sku
  IS 'Variant SKU snapshot at purchase time.';

COMMENT ON COLUMN public.line_items_raw.variant_title
  IS 'Variant title snapshot at purchase time (e.g. "Large", "Black / M").';

COMMENT ON COLUMN public.line_items_raw.selected_options
  IS 'Structured option snapshot at purchase time, e.g. { "Size": "L" }. Allows display without re-querying product_variants.';
