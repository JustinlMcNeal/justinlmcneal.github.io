# 004 — Sizes Build Decisions

**Project:** Karry Kraze product size / variant rollout  
**Date:** 2026-05-09  
**Phase:** Phase 1 — Schema foundation + read compatibility  
**Status:** Decisions locked. Implementation underway.

---

## Source of Truth

All architecture decisions in this file follow from:

- `000_sizes_system_audit.md` — actual codebase + database findings
- `001_sizes_architecture_recommendation.md` — approved direction
- `002_sizes_implementation_plan.md` — build order
- `003_sizes_testing_and_rollout_checklist.md` — verification criteria

Do not override these decisions without updating the audit chain.

---

## Locked Decisions

### 1. Size-only products first; no size+color combinations in this pass

The first apparel products (hoodies, etc.) use a single option dimension: `option_name = 'Size'`.

No combination variant support (`Size=M + Color=Black` on a single cart line) is in scope for phases 1 or 2. The existing unique index `(product_id, option_name_key, option_value_key)` supports one option dimension per variant row. Size+color combinations would require a separate design and are deferred until explicitly needed.

### 2. `product_variants` remains the canonical purchasable-unit table

We do **not** add a separate `product_sizes` table or `sizes TEXT[]` column to `products`. The existing `product_variants` table is extended to be the full purchasable-unit identity source.

### 3. `variant_id` is the preferred durable identifier going forward

Phase 1 prepares the schema and shared utilities so that `variant_id` can flow through cart → checkout → saved cart → order lines. The cart store does **not yet** persist `variant_id` (that is a phase 2 change), but the foundations are in place.

### 4. `variant_id` must remain nullable in historical/imported order contexts

`line_items_raw.variant_id` is a nullable UUID with no `NOT NULL` constraint. All historical orders, eBay imports, Amazon imports, generic carrier imports, and any non-website order path do not require a `variant_id`. This can never be made required without breaking existing order imports.

### 5. Variant SKU column is added now but may remain null

`product_variants.sku` is added as a nullable `TEXT` column with a partial unique index (`WHERE sku IS NOT NULL`). No variant SKUs are assigned in phase 1. This is ready for phase 3 (admin editor support).

### 6. Size products require explicit size selection — but this enforcement is deferred to phase 2/product-page work

Phase 1 does **not** change add-to-cart validation. The current product page auto-selects the first variant. For a size product, that would mean auto-selecting a size (e.g. S), which is intentional behavior for phase 1. Full enforcement of "must pick a size" belongs in phase 2 alongside the size selector UI.

### 7. Quick-add behavior for size products is deferred to phase 2

Current quick-add in `js/catalog/index.js` redirects when `data-has-variants="true"`. This is correct for products with multiple variants including sizes. No changes needed for phase 1. Phase 2 will evaluate whether quick-add for single-size or default-size products makes sense.

### 8. Non-sized / current color products must remain fully compatible

Every schema change is additive with `ADD COLUMN IF NOT EXISTS`. Every new column is nullable or has a safe default. Existing storefront behavior for color products must be unchanged.

### 9. Destructive delete/reinsert in admin variant editing is a known blocker

`js/admin/products/api.js:replaceVariants()` currently deletes all variants and reinserts them on save. This will be unsafe once `variant_id` becomes a durable identity referenced in cart lines, saved carts, and order lines. This pattern is noted here as a known blocker for phases 3+ (admin size editing). It is **not** fixed in phase 1 unless a read-path conflict is discovered.

### 10. `is_default` flag is added but not enforced by cart or checkout yet

Phase 1 sets `is_default = true` for products with exactly one active variant. Future phases may use this as the fallback for non-sized products in cart/checkout fallback logic.

---

## What Phase 1 Does

1. **Schema additions to `product_variants`:**
   - `sku TEXT` — variant-level SKU (nullable, unique where non-null)
   - `title TEXT` — explicit display title (nullable, falls back to `option_value`)
   - `option_values JSONB NOT NULL DEFAULT '{}'::jsonb` — structured option map (e.g. `{ "Size": "M" }`)
   - `price_override_cents INTEGER` — variant-level price override (nullable)
   - `weight_g_override INTEGER` — variant-level weight override (nullable)
   - `unit_cost_override_cents INTEGER` — variant-level unit cost override (nullable)
   - `is_default BOOLEAN NOT NULL DEFAULT false` — default variant flag

2. **Schema additions to `line_items_raw`:**
   - `variant_id UUID` — FK-compatible nullable reference to `product_variants.id`
   - `variant_sku TEXT` — variant SKU snapshot at order time
   - `variant_title TEXT` — variant title snapshot at order time
   - `selected_options JSONB` — structured option snapshot at order time

3. **Indexes added:**
   - Partial unique index on `product_variants.sku WHERE sku IS NOT NULL`
   - GIN index on `product_variants.option_values`
   - Index on `line_items_raw.variant_id`

4. **Backfill of existing `product_variants` rows:**
   - `title` backfilled from `option_value` where currently null/empty
   - `option_values` backfilled from `{ option_name: option_value }` where currently empty (`'{}'`)
   - `is_default = true` set for products with exactly one active variant

5. **Read path updates:**
   - `js/product/api.js:fetchVariants()` now selects the new columns
   - `js/home/api.js:fetchVariantsForProducts()` now selects the new columns
   - Existing consumers of these functions receive the new fields transparently
   - No existing rendering logic is broken (new fields are additional, not replacement)

6. **Shared variant utilities:**
   - `js/shared/variantUtils.js` — utility functions for display name resolution, option formatting, cart line key generation, option type detection

---

## What Phase 1 Does Not Do

- Does not change customer-facing add-to-cart, product page rendering, or cart UI behavior.
- Does not add size selector UI to the product page.
- Does not require size selection before add-to-cart.
- Does not persist `variant_id` in `cartStore.addToCart()` (phase 2).
- Does not change cart line identity (still `id::variant` text key, phase 2).
- Does not update `cart-sync` / `saved_carts` (phase 2).
- Does not update `create-checkout-session` payload (phase 2).
- Does not update `stripe-webhook` stock decrement/refund to prefer `variant_id` (phase 2/3).
- Does not add `Size` support to admin product editor UI (phase 3).
- Does not fix the destructive delete/reinsert variant admin pattern (phase 3).
- Does not add quick-add behavior for size products (phase 2).
- Does not update fulfillment/admin display to show size clearly (phase 3).
- Does not create a real-product pilot hoodie with sizes in production.

---

## Known Deferred Work (Later Phases)

| Phase | Work Item |
|---|---|
| Phase 2 | Persist `variant_id` in `cartStore.addToCart()` |
| Phase 2 | Carry `variant_id` + `selected_options` through checkout payload to `create-checkout-session` |
| Phase 2 | Carry `variant_id` + snapshots from `stripe-webhook` to `line_items_raw` |
| Phase 2 | Store `variant_id` in `saved_carts.cart_data` |
| Phase 3 | Admin product editor: stop hardcoding `option_name = 'Color'`, support `Size` |
| Phase 3 | Admin product editor: preserve variant IDs on save (replace destructive delete/reinsert) |
| Phase 3 | Create pilot hoodie product with `S/M/L/XL` size variants in production |
| Phase 3 | Admin order/fulfillment visibility: show size clearly in order detail, raw line items, packing |
| Phase 4 | Product page size selector UI (`<button>` group for `Size` options, swatches for `Color`) |
| Phase 4 | Require explicit size selection for size products (block add-to-cart until size chosen) |
| Phase 4 | Quick-add flow update for size products |
| Phase 4 | `stripe-webhook` stock decrement/refund to prefer `variant_id` |
| Phase 5 | Broader apparel rollout beyond pilot |
| Phase 5 | Variant SKU conventions and stock-per-variant fulfillment display |

---

## Migration Apply Commands

Phase 1 migrations must be applied in order using `db query --linked -f` (never `db push`):

```bash
# Step 1: Schema additions
npx supabase db query --linked -f supabase/migrations/20260718_product_variants_phase1_schema.sql

# Step 2: Backfill existing data
npx supabase db query --linked -f supabase/migrations/20260719_product_variants_phase1_backfill.sql
```

Verify after each step with the verification queries in `003_sizes_testing_and_rollout_checklist.md`, Schema Readiness section.
