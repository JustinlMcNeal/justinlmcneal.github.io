# Phase 1 Schema Mismatch — Recovery Guide
**Date:** 2026-05-10  
**Error:** `Update variant 73fa5c8e-... failed: Could not find the 'is_default' column of 'product_variants' in the schema cache`

---

## Root cause (confirmed)

The migration `20260718_product_variants_phase1_schema.sql` was **never applied** to the connected Supabase project.

The code in `js/admin/products/api.js → upsertVariants()` writes `is_default` (line 197):

```js
is_default: !!v.is_default,
```

The database does not have that column. This is a pure schema mismatch — no application logic bug.

**All seven Phase 1 columns are missing:**

| Table | Missing columns |
|-------|----------------|
| `product_variants` | `title`, `sku`, `option_values`, `price_override_cents`, `weight_g_override`, `unit_cost_override_cents`, `is_default` |
| `line_items_raw` | `variant_id`, `variant_sku`, `variant_title`, `selected_options` |

---

## Code paths that depend on the missing columns

Leaving the migration unapplied breaks the following at runtime:

| File | Dependency |
|------|-----------|
| `js/admin/products/api.js` | Writes `is_default`, `title`, `option_values`, `sku` on every variant save via `upsertVariants()` — **currently crashing** |
| `js/product/api.js` | SELECTs `is_default`, `title`, `sku`, `option_values` — fails silently or falls back |
| `js/home/api.js` | SELECTs `is_default`, `title`, `sku`, `option_values` for home variant map |
| `js/shared/variantUtils.js` | Reads `variant.title`, `variant.option_values`, `variant.is_default` |
| `supabase/functions/stripe-webhook/index.ts` | Inserts `variant_id`, `variant_sku`, `variant_title`, `selected_options` into `line_items_raw` |
| `supabase/functions/create-checkout-session/index.ts` | Reads `variant_id` to resolve full variant row for Stripe metadata |
| `js/success/index.js` | SELECTs `variant_title` from `line_items_raw` |
| `js/my-orders/index.js` | Displays `variant_title` from `line_items_raw` |
| `supabase/functions/lookup-orders/index.ts` | SELECTs `variant_title` from `line_items_raw` |

---

## Confirm which Supabase project is connected

```powershell
# Show the linked project ref
npx supabase status --linked 2>&1 | Select-String "project"

# Or read it directly from .env
Get-Content .env | Select-String "SUPABASE_URL"
```

Expected: project ref `yxdzvzscufkvewecvagq` (same as used for function deploys).

---

## Confirm the migration was never applied

Run this in the Supabase SQL editor or via the CLI:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'product_variants'
  AND column_name IN ('is_default', 'title', 'sku', 'option_values',
                      'price_override_cents', 'weight_g_override', 'unit_cost_override_cents')
ORDER BY column_name;
```

**If zero rows return → migration was never applied.** Proceed to recovery below.

---

## Recovery steps (exact commands for this repo)

This repo uses `npx supabase db query --linked -f <file>` to apply SQL directly
to the linked remote project. No `supabase migration up` / `db push` is needed.

### Step 1 — Apply the schema migration

```powershell
npx supabase db query --linked -f supabase/migrations/20260718_product_variants_phase1_schema.sql
```

This applies all `ADD COLUMN IF NOT EXISTS` statements. Safe to run — it will not
error if any column already partially exists.

### Step 2 — Apply the backfill migration

```powershell
npx supabase db query --linked -f supabase/migrations/20260719_product_variants_phase1_backfill.sql
```

This:
- Sets `title = option_value` for all existing variant rows (where null)
- Sets `option_values = {"Color": "Black"}` etc. for all existing rows
- Sets `is_default = true` for products with exactly one active variant

Both migrations are idempotent — safe to re-run.

---

## Verification SQL (run after migration)

### Confirm all new columns exist on product_variants

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'product_variants'
  AND column_name IN ('is_default', 'title', 'sku', 'option_values',
                      'price_override_cents', 'weight_g_override', 'unit_cost_override_cents')
ORDER BY column_name;
```

Expected: 7 rows.

### Confirm all new columns exist on line_items_raw

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'line_items_raw'
  AND column_name IN ('variant_id', 'variant_sku', 'variant_title', 'selected_options')
ORDER BY column_name;
```

Expected: 4 rows.

### Confirm backfill ran

```sql
-- title and option_values should be populated on existing rows
SELECT
  COUNT(*) FILTER (WHERE title IS NOT NULL)      AS rows_with_title,
  COUNT(*) FILTER (WHERE option_values != '{}')  AS rows_with_option_values,
  COUNT(*) FILTER (WHERE is_default = true)      AS rows_marked_default,
  COUNT(*)                                        AS total_rows
FROM public.product_variants;
```

Expected: `rows_with_title` ≈ `total_rows`, `rows_with_option_values` ≈ `total_rows`,
`rows_marked_default` ≈ number of products with exactly one active variant.

### Quick sanity check: read the new column directly

```sql
SELECT id, option_name, option_value, title, is_default
FROM public.product_variants
LIMIT 5;
```

This is the exact query that was failing before. It should now work.

---

## After migration — retry admin product editor

1. Reload the admin product editor page (hard refresh: Ctrl+Shift+R).
2. Open your hoodie product.
3. Edit a variant value (e.g. change stock for "M").
4. Save.

The `upsertVariants()` call will now succeed because `is_default`, `title`, and
`option_values` all exist.

---

## Order: schema migration first, then backfill

| Order | Migration | Reason |
|-------|-----------|--------|
| **1st** | `20260718_product_variants_phase1_schema.sql` | Creates the columns |
| **2nd** | `20260719_product_variants_phase1_backfill.sql` | Populates them — requires columns to exist |

Do not run the backfill before the schema migration.

---

## Is it safe to retry editing the existing hoodie after migration?

**Yes.** The `upsertVariants()` function:
- Updates rows in-place by UUID (no delete/reinsert).
- Sets `is_default: false` for all size variants (correct — explicit selection required).
- Sets `title: null` unless you set it (fine — falls back to `option_value`).

The hoodie's existing variant UUIDs will be preserved. Any carts built before the
save will still be valid.
