# Parcel Imports — Migration 001 Validation Report

**Status:** Passed  
**Date:** 2026-06-08  
**Target:** Linked project `yxdzvzscufkvewecvagq` (Karry Kraze Website)  
**Migration:** `supabase/migrations/20260818_create_parcel_imports.sql`  
**Checklist source:** [004_migration_001_plan.md](./004_migration_001_plan.md) §14

---

## 1. Apply

### Commands attempted

| Step | Command | Result |
|------|---------|--------|
| Preferred | `npx supabase db push` | **Failed** — remote migration history drift; CLI reported many local files “to be inserted before the last migration on remote” and suggested `--include-all` (unsafe for this project). |
| **Applied via** | `npx supabase db query --linked -f supabase/migrations/20260818_create_parcel_imports.sql` | **Success** (exit 0) |
| History repair | `npx supabase migration repair --linked --status applied 20260818` | **Success** — recorded version in `supabase_migrations.schema_migrations` |

### Apply result

Migration DDL applied successfully. All six `parcel_*` tables created on linked DB.

**Note:** Direct `-f` apply is the repo’s established fallback (`scripts/supabase/dbConnect.mjs`, `apply-amazon-migrations.mjs`). `db push` remains blocked by long-standing local/remote migration history mismatch unrelated to this migration.

---

## 2. Schema existence (§14)

| Table | Exists |
|-------|--------|
| `public.parcel_imports` | Yes |
| `public.parcel_import_items` | Yes |
| `public.parcel_import_item_mappings` | Yes |
| `public.parcel_import_cost_allocations` | Yes |
| `public.parcel_import_events` | Yes |
| `public.parcel_mapping_memory` | Yes |

**FK on `parcel_imports.expense_id`:** Present — `FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL`.

**Auth audit FKs:** `approved_by`, `voided_by` → `auth.users(id) ON DELETE SET NULL`.

---

## 3. Constraint tests (§14)

Executed via `scripts/supabase/validate-parcel-migration-001.sql` (PL/pgSQL `DO` block with explicit cleanup). All passed.

| Test | Expected | Result |
|------|----------|--------|
| Invalid `status` (`bogus_status`) | `CHECK` violation | **Pass** — rejected |
| Negative `actual_shipment_fee_cny` (-1) | `CHECK` violation | **Pass** — rejected |
| Duplicate `(parcel_import_id, row_number)` on items | `UNIQUE` violation | **Pass** — rejected |
| Duplicate `parcel_import_item_id` on mappings | `UNIQUE` violation | **Pass** — rejected |
| Duplicate `approval_idempotency_key` when not null | Partial unique violation | **Pass** — rejected |
| Duplicate `parcel_id` across two import rows | Allowed | **Pass** — count = 2 |

**Cleanup:** Zero rows with `parcel_id LIKE 'val-%'` after validation.

---

## 4. FK cascade (§14)

Tested in validation script: insert header → item → mapping → allocation → event → `DELETE` header.

| Child table | Rows after parent delete | Result |
|-------------|--------------------------|--------|
| `parcel_import_items` | 0 | Pass |
| `parcel_import_item_mappings` | 0 | Pass |
| `parcel_import_cost_allocations` | 0 | Pass |
| `parcel_import_events` | 0 | Pass |

`ON DELETE CASCADE` from `parcel_imports` confirmed.

**Not tested this run:** `DELETE products` → mapping `product_id` SET NULL (deferred; FK definition confirmed at apply time).

---

## 5. RLS / policies (§14)

Queried `pg_class.relrowsecurity` and `pg_policy` for all six tables.

| Check | Result |
|-------|--------|
| RLS enabled on all six tables | **Pass** (`relrowsecurity = true`) |
| No anon policies | **Pass** (zero rows with `anon` role) |
| `authenticated` ALL policy per table | **Pass** (6 policies) |
| `service_role` ALL policy per table | **Pass** (6 policies) |

**Policy names:**

- `parcel_imports_authenticated_all` / `parcel_imports_service_role_all`
- `parcel_import_items_authenticated_all` / `parcel_import_items_service_role_all`
- `parcel_import_item_mappings_authenticated_all` / `parcel_import_item_mappings_service_role_all`
- `parcel_import_cost_allocations_authenticated_all` / `parcel_import_cost_allocations_service_role_all`
- `parcel_import_events_authenticated_all` / `parcel_import_events_service_role_all`
- `parcel_mapping_memory_authenticated_all` / `parcel_mapping_memory_service_role_all`

**Not tested live:** Anon REST `SELECT` denial and authenticated JWT insert (requires browser/session or service key). RLS metadata matches `expenses` / Amazon admin pattern; live JWT smoke deferred to Phase 6 API wiring.

---

## 6. Triggers (§14)

### Existence

| Trigger | Table | Result |
|---------|-------|--------|
| `trg_parcel_imports_updated_at` | `parcel_imports` | Present |
| `trg_parcel_import_item_mappings_updated_at` | `parcel_import_item_mappings` | Present |
| `trg_parcel_mapping_memory_updated_at` | `parcel_mapping_memory` | Present |

No `updated_at` triggers on `parcel_import_items`, `parcel_import_cost_allocations`, or `parcel_import_events` (as planned).

### Behavior

Tested in **separate committed queries** (required because `set_updated_at()` uses `now()`, which is transaction-stable):

1. `INSERT` → `updated_at = 2026-06-08 22:48:16.095606+00`
2. `UPDATE` (2s later) → `updated_at = 2026-06-08 22:48:23.28009+00`

**Pass** — `updated_at` advanced after update.

**Note:** Trigger test inside a single `DO`/transaction block will falsely fail because `now()` does not advance within one transaction.

---

## 7. Forbidden side-effect grep (§14)

Searched `supabase/migrations/20260818_create_parcel_imports.sql`:

| Pattern | Found |
|---------|-------|
| `UPDATE public.products` | No |
| `UPDATE public.product_variants` | No |
| `INSERT INTO stock_ledger` | No |
| `CREATE TABLE inventory_receipts` | No |
| `CREATE FUNCTION approve` / `CREATE OR REPLACE FUNCTION approve` | No |

**Allowed:** `CREATE OR REPLACE FUNCTION public.set_updated_at()` (idempotent helper).  
**Allowed:** `DROP TRIGGER IF EXISTS` before trigger recreation (repo convention).

Repo-wide grep shows unrelated `UPDATE public.product_variants` only in older migration `20260719_product_variants_phase1_backfill.sql` — not introduced by this migration.

---

## 8. Warnings / deviations

| Item | Detail |
|------|--------|
| `db push` blocked | Long-standing migration history drift between repo and remote; used linked `-f` apply instead. |
| History repair | Ran `migration repair --status applied 20260818` after manual apply so CLI history matches live DDL. |
| Trigger test method | Must use separate queries, not one transaction block. |
| Anon/auth live RLS | Inspected via `pg_policy`; JWT/REST smoke not run (no Phase 6 API). |
| `products` SET NULL | FK cascade on product delete not exercised in this validation run. |

---

## 9. Validation artifacts

| Artifact | Path |
|----------|------|
| Migration SQL | `supabase/migrations/20260818_create_parcel_imports.sql` |
| Runnable constraint/cascade tests | `scripts/supabase/validate-parcel-migration-001.sql` |
| This report | `docs/pages/admin/parcelImport/implementation/005_migration_001_validation.md` |

### Re-run validation

```powershell
cd d:\SMOJO\Online\Buisness\kk6\justinlmcneal.github.io

# Schema + RLS + triggers (read-only)
npx supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'parcel_%' ORDER BY table_name;"

# Constraint + cascade (cleans up val-* rows)
npx supabase db query --linked -f scripts/supabase/validate-parcel-migration-001.sql
```

---

## 10. Final status

| Criterion | Status |
|-----------|--------|
| Migration applied successfully | **Pass** |
| All six tables exist | **Pass** |
| Constraints validated | **Pass** |
| FK cascade validated | **Pass** |
| RLS/policies inspected | **Pass** |
| `updated_at` trigger validated | **Pass** |
| Forbidden side-effect grep clean | **Pass** |
| Validation doc created | **Pass** |
| No app code changed | **Pass** |
| No Phase 6 work started | **Pass** |

**Overall: PASSED**

---

## 11. Next recommended step

1. **Phase 6 planning only** — write `006_api_save_draft_plan.md` (payload shape, upsert/replace strategy for items/mappings/preview allocations, event logging).
2. **Do not** wire `js/admin/parcelImports/` to Supabase until Save Draft API design is reviewed.
3. Optional: add `20260818_create_parcel_imports.sql` to a future unified migration runner doc if `db push` history is repaired project-wide.
