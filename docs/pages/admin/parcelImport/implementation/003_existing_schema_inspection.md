# Parcel Imports — Existing Schema Inspection (Phase 5b)

**Status:** Documentation / inspection only — **no migrations, no app code changes**  
**Prerequisite:** [002_schema_sketch.md](./002_schema_sketch.md)  
**Goal:** Ground the Parcel Imports migration plan in **real** table/column names and patterns already used in Karry Kraze.

*Last updated: 2026-06-03*

---

## 1. Inspection summary

### What was inspected

| Area | Locations searched |
|------|-------------------|
| SQL migrations | `supabase/migrations/` (all `*product*`, `*expense*`, `*stock*`, `*inventory*`, RLS policies) |
| Product admin | `js/admin/products/`, `js/shared/productContract.js`, `js/admin/pCalc/` |
| Expenses admin | `js/admin/expenses/`, `pages/admin/expenses.html`, `import-legacy-expenses.mjs` |
| Amazon / eBay | `supabase/migrations/20260721_*`, `20260813_*`, `20260510_*`, `20260511_*` |
| Stock / orders | `supabase/functions/stripe-webhook/index.ts`, `docs/audit/system/items/sizes/000_sizes_system_audit.md` |
| CPI / cost semantics | `js/admin/pStorage/profitCalc.js`, `supabase/migrations/20260116_add_unit_cost_to_products.sql` |
| Parcel wiring docs | `docs/pages/admin/parcelImport/implementation/001_wiring_plan.md`, `002_schema_sketch.md` |

### High-level findings

| Topic | Finding |
|-------|---------|
| **`products`** | Base table predates repo migrations (no `CREATE TABLE` in migrations). Documented live columns in sizes audit. `unit_cost NUMERIC(10,2)` **USD** per unit. `supplier_url TEXT` for sourcing hints. |
| **`product_variants`** | Variant-centric stock (`stock INTEGER`). Phase 1 schema adds `unit_cost_override_cents`, `title`, `sku`, `option_values`, etc. **Override cents column exists but is not read/written in JS yet.** |
| **`expenses`** | Business table `public.expenses` — DDL documented in `import-legacy-expenses.mjs`, not created in tracked migrations. `amount_cents INTEGER`, free-text `category`. **`Inventory` is a valid UI category.** |
| **CPI today** | No `latest_cpi` or weighted-average column. `products.unit_cost` is **product cost in USD**, not full Baestao landed CPI. Profit views add **estimated** supplier ship from weight formula. |
| **Stock** | Source of truth: **`product_variants.stock`**. Mutations via **`stock_ledger`** (audit). No `inventory_receipts` table in repo. |
| **`stock_ledger`** | Used in production code (`stripe-webhook`) and sizes audit — **no `CREATE TABLE` in `supabase/migrations/`** (legacy/dashboard DDL). |
| **RLS** | `expenses`: authenticated full CRUD. Amazon finance: `service_role` ALL + `authenticated` SELECT. Social admin: authenticated ALL. **`products` / `product_variants` RLS not defined in tracked migrations.** |
| **`updated_at`** | `expenses` has `update_expenses_updated_at()` trigger (in import script DDL). Other admin tables use app-set `updated_at` or triggers per migration. |

---

## 2. `products` table

### Migration files (alter only — no base CREATE in repo)

| File | Change |
|------|--------|
| `supabase/migrations/20260108_add_amazon_url_to_products.sql` | `amazon_url TEXT` |
| `supabase/migrations/20260116_add_unit_cost_to_products.sql` | `unit_cost NUMERIC(10,2)` — comment: *"Cost per unit in USD for profit margin calculations"* |
| `supabase/migrations/20260118_add_supplier_url_to_products.sql` | `supplier_url TEXT` — 1688/Alibaba-style internal link |
| `supabase/migrations/20260111_add_product_post_tracking.sql` | `last_social_post_at TIMESTAMPTZ` |
| `supabase/migrations/20260716_ebay_listing_management.sql` | `ebay_sku`, `ebay_offer_id`, `ebay_listing_id`, `ebay_status`, `ebay_category_id`, `ebay_price_cents` |
| `supabase/migrations/20260717_ebay_store_category.sql` | `ebay_store_category TEXT` |

### Primary key

- `id UUID` (inferred from all JS queries and audits)

### Relevant columns (confirmed)

| Column | Type (inferred) | Parcel Imports relevance |
|--------|-----------------|--------------------------|
| `id` | `UUID` PK | FK target for `parcel_import_item_mappings.product_id` |
| `code` | `TEXT` UNIQUE | Product SKU, e.g. `KK-####` |
| `slug` | `TEXT` UNIQUE | Catalog URL |
| `name` | `TEXT` | Display name (not `title`) |
| `category_id` | `UUID` | FK → `categories` |
| `price` | `NUMERIC` | Retail price USD |
| `weight_g` | `NUMERIC` | Product-level weight grams |
| `unit_cost` | `NUMERIC(10,2)` | **USD** unit cost — current CPI/COGS field |
| `shipping_status` | `TEXT` | e.g. `mto` |
| `supplier_url` | `TEXT` | Sourcing URL hint for mapping memory |
| `amazon_url` | `TEXT` | Amazon listing link |
| `catalog_image_url`, `catalog_hover_url`, `primary_image_url` | `TEXT` | Images |
| `is_active` | `BOOLEAN` | |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |
| eBay columns | various | Not parcel-related |

**No `seller_url` or `source_url` column** — use `supplier_url`.

### RLS policies

- **Not found** in `supabase/migrations/` for `products`.
- Catalog reads use anon Supabase client on public pages; admin writes use authenticated client (`js/admin/products/api.js`).
- Parcel imports should **not** assume `products` has the same RLS as `expenses` until live policies are confirmed in Supabase dashboard.

### Important code references

| File | Usage |
|------|--------|
| `js/shared/productContract.js` | `PRODUCT_SELECT` — canonical column list for reads |
| `js/admin/products/api.js` | CRUD, `upsertProduct`, `quickUpdateProduct`, variant upsert |
| `js/admin/products/modalEditor.js` | Edits `unit_cost`, `supplier_url`, `weight_g` |
| `js/admin/pCalc/api.js` | Reads `unit_cost` + `weight_g` for calculator |
| `js/admin/pStorage/profitCalc.js` | CPI projection = `unit_cost` + estimated supplier ship |
| `supabase/migrations/20260511_ebay_finance_v4_status.sql` | SQL CPI uses `p.unit_cost` + weight-based supplier ship |
| `docs/audit/system/items/sizes/000_sizes_system_audit.md` | Live schema snapshot (2026-05-09) |

---

## 3. `product_variants` table

### Migration files

| File | Change |
|------|--------|
| `supabase/migrations/20260718_product_variants_phase1_schema.sql` | `title`, `sku`, `option_values`, `price_override_cents`, `weight_g_override`, `unit_cost_override_cents`, `is_default` |
| `supabase/migrations/20260719_product_variants_phase1_backfill.sql` | Backfill `title`, `option_values`, `is_default` |

**Base `CREATE TABLE product_variants` is not in repo migrations** — table predates tracked migrations.

### Primary key & FK

- `id UUID PRIMARY KEY`
- `product_id UUID NOT NULL` → `products(id)`

### Core columns (from sizes audit + migrations)

| Column | Type | Notes |
|--------|------|-------|
| `option_name` | `TEXT NOT NULL` | Today mostly `'Color'` |
| `option_value` | `TEXT NOT NULL` | Variant label, e.g. `Blue / Purple` |
| `option_name_key`, `option_value_key` | `TEXT` | Normalized keys for uniqueness |
| `stock` | `INTEGER NOT NULL DEFAULT 0` | **Variant stock SOT** |
| `preview_image_url` | `TEXT` | |
| `sort_order` | `INTEGER` | |
| `is_active` | `BOOLEAN` | |
| `title` | `TEXT` | Display title (Phase 1) |
| `sku` | `TEXT` | Partial unique index where not null |
| `option_values` | `JSONB` | e.g. `{"Color":"Black"}` |
| `price_override_cents` | `INTEGER` | Null → use `products.price` |
| `weight_g_override` | `INTEGER` | Null → use `products.weight_g` |
| `unit_cost_override_cents` | `INTEGER` | Null → use `products.unit_cost` (comment in migration) |

Constraint: `product_variants_unique_per_product` on `(product_id, option_name_key, option_value_key)`.

### RLS

- Not defined in tracked migrations (same caveat as `products`).

### Important code references

| File | Usage |
|------|--------|
| `js/admin/products/api.js` | `upsertVariants()` — updates `stock`, `option_value`, `title`, `is_default` |
| `js/product/api.js` | Storefront variant fetch |
| `supabase/functions/stripe-webhook/index.ts` | Decrement/increment `product_variants.stock` |
| `supabase/migrations/20260813_amazon_variants_phase1.sql` | `kk_variant_id` mapping to `product_variants.id` |
| `docs/audit/system/items/sizes/000_sizes_system_audit.md` | Confirms all products have ≥1 active variant |

**Note:** `unit_cost_override_cents` has **zero JS references** in `js/` as of this inspection. Schema-ready, not app-wired.

---

## 4. `expenses` table

### Migration files

| File | Change |
|------|--------|
| *(none)* | **No `CREATE TABLE expenses` in `supabase/migrations/`** |
| `supabase/migrations/20260221_align_expense_categories.sql` | Data migration docs — maps categories including **`Inventory`** |
| `supabase/migrations/20260615_add_mileage_to_expenses.sql` | `miles NUMERIC`, `mileage_rate NUMERIC` |

### Canonical DDL (from `import-legacy-expenses.mjs`)

```sql
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_date  DATE NOT NULL,
  category      TEXT NOT NULL,
  description   TEXT,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  vendor        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
-- Plus: miles, mileage_rate (20260615 migration)
```

### Field summary

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` PK | FK target for `parcel_imports.expense_id` |
| `expense_date` | `DATE` | Required |
| `category` | `TEXT` | **No DB CHECK constraint** — free text enforced in UI |
| `description` | `TEXT` | |
| `amount_cents` | `INTEGER` | **USD cents** |
| `vendor` | `TEXT` | |
| `notes` | `TEXT` | |
| `miles`, `mileage_rate` | `NUMERIC` | Mileage category only |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

### Category taxonomy (UI + align migration)

From `pages/admin/expenses.html` and `20260221_align_expense_categories.sql`:

**COGS-style:** `Inventory`, `Supplies`  
**Operating:** `Advertising`, `Platform Fees`, `Shipping`, `Software`, `Website / Hosting`, `Office`, `Phone / Internet`, `Travel / Meals`, `Professional Fees`, `Bank Fees`, `Vehicle`, `Mileage`, `Other`

**`Inventory` is valid** — explicitly used for product purchases (Baestao clothing example in align migration).

### RLS (from import script)

```sql
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
-- authenticated: SELECT, INSERT, UPDATE, DELETE — all USING (true)
```

`js/admin/expenses/api.js` uses **`SUPABASE_ANON_KEY`** (admin page is gate-kept at app level, not Supabase Auth per request in this module).

### Separate table: `personal_expenses`

- `supabase/migrations/20260221_create_personal_expenses.sql`
- Personal budget only — **do not link parcel imports here**.

### Important code references

| File | Usage |
|------|--------|
| `js/admin/expenses/api.js` | `getExpensesList`, `upsertExpense`, `deleteExpense` |
| `pages/admin/expenses.html` | Category dropdown including `Inventory` |
| `import-legacy-expenses.mjs` | Table bootstrap DDL + RLS + `updated_at` trigger |

---

## 5. Inventory / stock model

### Where stock lives

| Layer | Location |
|-------|----------|
| **Quantity SOT** | `product_variants.stock` |
| **Audit ledger** | `stock_ledger` |
| **Admin summary** | `inventory_summary` view (queried in `js/admin/products/api.js` — view DDL not in tracked migrations) |

### `stock_ledger` (confirmed in code, not in migrations)

From `docs/audit/system/items/sizes/000_sizes_system_audit.md` and `stripe-webhook`:

| Column | Purpose |
|--------|---------|
| `variant_id` | `UUID NOT NULL` |
| `product_id` | `UUID NOT NULL` |
| `change` | `INTEGER` (+/-) |
| `reason` | `TEXT` — e.g. `order`, `refund` |
| `reference_id` | `TEXT` — order session id |
| `stock_before`, `stock_after` | snapshot |

### Stock mutation patterns in repo

| Flow | File | Behavior |
|------|------|----------|
| Order placed | `supabase/functions/stripe-webhook/index.ts` ~797–821 | `stock -= qty`, ledger `reason: order`, `change: -qty` |
| Refund | same file ~246–262 | `stock += qty`, ledger `reason: refund` |
| Admin edit | `js/admin/products/api.js` `upsertVariants()` | Direct `stock` field on variant row — **no ledger insert in admin path** |

### `inventory_receipts` / stock movement tables

- **No `inventory_receipts` table** in repo.
- **No `CREATE TABLE stock_ledger`** in `supabase/migrations/`.
- No admin “receive inventory” flow found for Baestao parcels.

### Recommendation for Parcel Imports receiving (later)

1. **Do not** only bump `product_variants.stock` without audit.
2. **Follow `stripe-webhook` pattern:** update `product_variants.stock` + insert `stock_ledger` row with:
   - `reason: 'parcel_receive'` (new)
   - `reference_id: parcel_import_item_id` or `parcel_import_id`
   - `change: +quantity`
3. Add **`parcel_import_items.inventory_received_at`** or header-level `inventory_received_at` + idempotency flag to prevent double receive.
4. Optional future `inventory_receipts` table if ledger alone is insufficient for reporting — not required if `stock_ledger` + parcel FK in `reference_id` is enough.
5. Confirm live `stock_ledger` DDL (and whether `reference_id` length/FK is needed) in Supabase before migration.

---

## 6. Existing admin RLS / security patterns

### Pattern A — Authenticated admin full access

**Example:** `expenses`, `social_*` tables (`20260109_create_social_media_tables.sql`)

```sql
CREATE POLICY "Admin write social_posts" ON social_posts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### Pattern B — Service role + authenticated read

**Example:** `amazon_finance_transactions` (`20260812_amazon_orders_phase_bc.sql`)

- `service_role`: ALL
- `authenticated`: SELECT only
- Writes via edge functions (`amazon-sync-finances`)

### Pattern C — Anon permissive (avoid for parcels)

**Example:** `personal_expenses` — anon CRUD (personal budget page)

### Parcel Imports recommendation

| Rule | Suggestion |
|------|------------|
| Access | **`authenticated` admin only** — no anon |
| Writes | Admin UI via authenticated client; **approve / CPI update / stock receive** via **service_role** edge function or RPC |
| Read | Authenticated SELECT on drafts + history |
| Approved rows | Trigger or RLS to block UPDATE on immutable fields |
| PII | Raw footer JSON may contain name/address — treat as admin-only; consider redaction on save |

Align with **Pattern B** for approval side effects, **Pattern A** for draft editing.

---

## 7. Updated_at / audit patterns

### `expenses` trigger (reusable pattern)

From `import-legacy-expenses.mjs`:

```sql
CREATE OR REPLACE FUNCTION update_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_expenses_updated_at();
```

### Other patterns

| Pattern | Example |
|---------|---------|
| App sets `updated_at = now()` | Many Amazon sync migrations, `saved_carts` |
| Dedicated event tables | `pwa_events`, `sms_events`, `cta_label_scans` |
| Finance sync audit | `amazon_finance_transactions.raw_payload` |

### Parcel Imports recommendation

- Reuse **`update_*_updated_at` trigger** on `parcel_imports`, `parcel_import_item_mappings`.
- Add **`parcel_import_events`** early (matches 002 sketch) — mirrors finance/sms event style.
- No existing generic `audit_log` table to reuse.

---

## 8. CPI write target recommendation

### What “CPI” means in the repo today

| Context | Definition |
|---------|------------|
| `products.unit_cost` | **USD** product unit cost entered in admin (`20260116` comment) |
| `profitCalc.js` / eBay SQL | CPI ≈ `unit_cost` + **estimated** supplier ship from weight (not Baestao actuals) |
| Parcel Imports Phase 4 | **Landed CPI** = product cost + seller freight + allocated parcel fees (CNY → USD) |

**These are not the same number.** Parcel landed CPI is **more complete** than current `unit_cost` semantics.

### Is weighted average CPI stored?

- **No** dedicated column or history table on `products` / `product_variants`.
- Only single-point `unit_cost` (product) and optional `unit_cost_override_cents` (variant, unused in JS).

### Safest v1 approach

| Step | Recommendation |
|------|----------------|
| 1. **Persist parcel history first** | `parcel_import_cost_allocations` (`allocation_run_type = final`) + `parcel_imports.final_*` columns — **authoritative audit** |
| 2. **Do not overwrite product cost on Save Draft** | Draft saves snapshot only |
| 3. **On Approve (Phase 8)** | Update cost fields from **final** allocation |
| 4. **Product-level vs variant-level** | If `product_variant_id` is set → write **`product_variants.unit_cost_override_cents`** (USD cents, landed CPI per unit). Else → **`products.unit_cost`** (USD numeric). |
| 5. **Weighted average** | Compute at approve time from: prior cost (if any) + new parcel quantity — formula must be documented in approve RPC. Store inputs in `parcel_import_events` payload. **Do not** add `latest_cpi` column until formula is validated. |
| 6. **Do not merge** with `profitCalc` supplier-ship estimate | Parcel imports replace/refresh **actual** landed cost, not the weight-formula estimate |

**Summary:** Parcel tables own CPI history; product fields are **downstream mirrors** updated only on idempotent approve. Variant-level write preferred when mapping includes variant.

---

## 9. Expense linkage recommendation

### FK approach

**Yes** — `parcel_imports.expense_id UUID NULL REFERENCES public.expenses(id) ON DELETE SET NULL` is correct for v1.

Join table deferred until multi-expense per parcel is required (Baestao top-up splitting).

### Category

**Yes** — `expenses.category = 'Inventory'` matches existing taxonomy (`pages/admin/expenses.html`, `20260221_align_expense_categories.sql`).

### Amount & FX

| Field | Where | Value |
|-------|-------|-------|
| Card charge USD | `expenses.amount_cents` | Operator-entered USD cents (e.g. card statement) |
| Baestao CNY charges | `parcel_imports.actual_*` columns | Shipment, service, insurance, total CNY |
| FX | `parcel_imports.effective_fx_rate`, `usd_equivalent` | Manual override; derive if needed |

**Do not** store CNY in `expenses.amount_cents` — that table is USD cents throughout the admin UI.

Optional `expenses.notes` or `description` template: `Baestao parcel {parcel_id} import {id}`.

Vendor: `Baestao` or card issuer name per operator preference.

---

## 10. Migration plan impact on `002_schema_sketch.md`

| 002 assumption | Inspection result | Suggested update |
|----------------|-------------------|------------------|
| `products` has `supplier_url` | **Confirmed** | Keep; map to `parcel_mapping_memory.source_url` hints |
| `unit_cost` is CPI write target | **Partially** — USD product cost, not landed CPI | Clarify approve writes **landed CPI USD** into `unit_cost` / override cents |
| `product_variants.unit_cost_override_cents` | **Schema exists, JS unused** | Phase 8 must wire cents conversion; prefer variant FK writes |
| `expenses` FK | **Confirmed** table shape | Use exact column names from §4 |
| `Inventory` category | **Confirmed** | No sketch change |
| `stock_ledger` / receipts | Ledger exists in prod, **not in migrations** | Add migration step: verify/create `stock_ledger` if missing on fresh env |
| `approved_by uuid` | No `approved_by` pattern found in repo | Keep uuid → `auth.users`; confirm admin auth usage |
| Weighted avg CPI on products | **Does not exist** | Keep in `parcel_imports.final_*` only for v1 |
| RLS like expenses | products/variants RLS unknown | Inspect dashboard before copying expenses pattern |

---

## 11. Open questions remaining

### Resolved by this inspection

- [x] Products table name: `public.products`
- [x] Variants table name: `public.product_variants`
- [x] Expenses table name: `public.expenses` (not `personal_expenses`)
- [x] Cost field: `products.unit_cost` (USD), `product_variants.unit_cost_override_cents` (cents)
- [x] Supplier URL: `products.supplier_url`
- [x] Stock SOT: `product_variants.stock`
- [x] `Inventory` expense category: valid
- [x] `inventory_receipts` table: **does not exist** in repo
- [x] Weighted avg CPI storage: **does not exist** today

### Still unclear — need Supabase dashboard / live query

| # | Question |
|---|----------|
| 1 | Full live DDL for `products`, `product_variants`, `stock_ledger`, `inventory_summary` (base tables may predate migrations) |
| 2 | Actual RLS policies on `products` and `product_variants` in production |
| 3 | Whether `unit_cost` is intended to include inbound shipping today (operators may be entering partial costs manually) |
| 4 | Exact weighted-average formula business rule for approve (qty-weighted across imports?) |
| 5 | Should parcel approve update **both** `unit_cost` and leave `profitCalc` supplier ship as zero for Baestao-sourced SKUs? |
| 6 | `stock_ledger` columns: is there `created_at`? FK constraints? |
| 7 | Raw Baestao file blob storage vs JSON-only for v1 |
| 8 | Supplies rows: expense allocation without SKU — bookkeeping category? |
| 9 | Baestao top-up ledger — still deferred |

### Next recommended step

Create **`004_migration_001_plan.md`** with:

1. `CREATE TABLE` statements using inspected column names
2. Prerequisite migration to dump/verify `stock_ledger` DDL
3. FK references: `products(id)`, `product_variants(id)`, `expenses(id)`
4. Approve RPC outline (idempotency + CPI write + ledger insert stub)
5. No implementation until live DDL confirmation

---

## 12. Acceptance criteria (this document)

- [x] `003_existing_schema_inspection.md` exists
- [x] Cites concrete repo files and migrations inspected
- [x] Confirms real `products` / `product_variants` / `expenses` columns
- [x] Confirms no `inventory_receipts` in repo; `stock_ledger` used but not migrated in repo
- [x] Recommends CPI write target (parcel history first; approve → `unit_cost` / `unit_cost_override_cents`)
- [x] Recommends expense linkage (`expense_id` FK, `Inventory`, USD `amount_cents`)
- [x] No SQL migrations created
- [x] No application code changed

---

## Appendix — File index (inspection citations)

| Path | Why cited |
|------|-----------|
| `supabase/migrations/20260116_add_unit_cost_to_products.sql` | `unit_cost` definition |
| `supabase/migrations/20260118_add_supplier_url_to_products.sql` | `supplier_url` |
| `supabase/migrations/20260718_product_variants_phase1_schema.sql` | Variant overrides |
| `supabase/migrations/20260221_align_expense_categories.sql` | `Inventory` category |
| `supabase/migrations/20260615_add_mileage_to_expenses.sql` | Mileage columns |
| `import-legacy-expenses.mjs` | `expenses` DDL + RLS + trigger |
| `js/shared/productContract.js` | Product column contract |
| `js/admin/products/api.js` | Product/variant CRUD, stock |
| `js/admin/expenses/api.js` | Expense CRUD |
| `js/admin/pStorage/profitCalc.js` | CPI semantics in UI |
| `js/admin/pCalc/api.js` | `unit_cost` read path |
| `supabase/functions/stripe-webhook/index.ts` | Stock + `stock_ledger` |
| `docs/audit/system/items/sizes/000_sizes_system_audit.md` | Live schema audit |
| `pages/admin/expenses.html` | Category taxonomy UI |
| `supabase/migrations/20260812_amazon_orders_phase_bc.sql` | Admin RLS pattern B |
