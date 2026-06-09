# Parcel Imports — Migration 002 Validation Report

**Status:** Passed (metadata + grants + auth gate)  
**Date:** 2026-06-08  
**Target:** Linked project `yxdzvzscufkvewecvagq` (Karry Kraze Website)  
**Migration:** `supabase/migrations/20260819_save_parcel_import_draft_rpc.sql`  
**Checklist source:** [007_migration_002_rpc_plan.md](./007_migration_002_rpc_plan.md) §16

---

## 1. Apply

### Commands used

```powershell
cd d:\SMOJO\Online\Buisness\kk6\justinlmcneal.github.io

npx supabase db query --linked -f supabase/migrations/20260819_save_parcel_import_draft_rpc.sql

npx supabase migration repair --linked --status applied 20260819
```

| Step | Result |
|------|--------|
| Linked `-f` apply | **Success** (exit 0) |
| `migration repair 20260819` | **Success** — version recorded in `supabase_migrations.schema_migrations` |

`npx supabase db push` was not used (same history-drift fallback as Migration 001).

---

## 2. Validation script

```powershell
npx supabase db query --linked -f scripts/supabase/validate-parcel-migration-002-rpc.sql
```

**Result:** **Success** (exit 0)

Sections executed:

| # | Check | Result |
|---|-------|--------|
| 1 | `save_parcel_import_draft` exists, `SECURITY INVOKER` | Pass |
| 2 | All 7 helper functions present | Pass |
| 3 | Main RPC: `authenticated` EXECUTE yes, `anon` EXECUTE no | Pass |
| 3b | All 7 helpers: `authenticated` EXECUTE yes, `anon` EXECUTE no | Pass |
| 4 | Unauthenticated call → `Authentication required` | Pass |
| 6–7 | Approved/bad-allocation tests deferred (auth gate first) | Pass (expected deferral) |

---

## 3. Live metadata queries

### RPC security mode

```sql
SELECT proname, prosecdef FROM pg_proc
WHERE proname = 'save_parcel_import_draft';
```

| Field | Value |
|-------|-------|
| `proname` | `save_parcel_import_draft` |
| `prosecdef` | `false` (**SECURITY INVOKER**) |

### EXECUTE grants (summary)

Queried `information_schema.routine_privileges` for main RPC + 7 helpers.

| Function | `authenticated` | `anon` | Notes |
|----------|-----------------|--------|-------|
| `save_parcel_import_draft` | EXECUTE | — | Pass |
| `parcel_jsonb_optional_numeric` | EXECUTE | — | Pass |
| `parcel_jsonb_optional_integer` | EXECUTE | — | Pass |
| `parcel_jsonb_optional_boolean` | EXECUTE | — | Pass |
| `parcel_jsonb_optional_uuid` | EXECUTE | — | Pass |
| `parcel_assert_row_type` | EXECUTE | — | Pass |
| `parcel_assert_mapping_status` | EXECUTE | — | Pass |
| `parcel_build_raw_footer` | EXECUTE | — | Pass |

`postgres` and `service_role` also show EXECUTE (owner/default Supabase grants). **`anon` has no EXECUTE** on any of the above.

---

## 4. Auth gate

```sql
SELECT public.save_parcel_import_draft('{}'::jsonb);
```

**Result:** Error `P0001: Authentication required` (exit 1 from CLI — expected).

Confirms `auth.uid()` check runs before payload processing.

---

## 5. Static forbidden grep

```text
grep patterns on:
  supabase/migrations/20260819_save_parcel_import_draft_rpc.sql
  scripts/supabase/validate-parcel-migration-002-rpc.sql
```

| Pattern | Matches |
|---------|---------|
| `UPDATE public.products` | None |
| `UPDATE public.product_variants` | None |
| `INSERT INTO stock_ledger` | None |
| `INSERT INTO expenses` | None |
| `CREATE TABLE inventory_receipts` | None |
| `CREATE FUNCTION approve` | None |
| `CREATE OR REPLACE FUNCTION approve` | None |

**Clean.**

---

## 6. Warnings / deferred tests

| Item | Detail |
|------|--------|
| Authenticated create/update smoke | **Not run** — requires admin JWT in browser or scripted auth session |
| `parsed` + `draft_saved` event counts | Deferred to browser smoke |
| Child replacement on update | Deferred to browser smoke |
| `approved` import edit rejection (functional) | Validation script defers after auth gate; fixture insert/cleanup ran in script |
| `service_role` EXECUTE on RPC/helpers | Present via Postgres defaults; browser uses `authenticated` only |

---

## 7. Pending: authenticated browser smoke (Phase 6 prep)

When ready (not part of this validation run):

1. Log in as admin → `supabase.rpc('save_parcel_import_draft', { payload })` with fixture-shaped payload
2. Verify `created: true`, item/allocation counts
3. Re-save with `importId` → `created: false`, stable child counts
4. Verify events: `parsed` + `draft_saved` on create; `draft_saved` only on update
5. Verify `approved` import update returns `Import cannot be edited`

---

## 8. Final status

| Criterion | Status |
|-----------|--------|
| Migration applied successfully | **Pass** |
| `save_parcel_import_draft` exists (INVOKER) | **Pass** |
| Main RPC grants (`authenticated` yes, `anon` no) | **Pass** |
| Helper grants (7 × `authenticated` yes, `anon` no) | **Pass** |
| Auth gate (`Authentication required`) | **Pass** |
| Validation script exit 0 | **Pass** |
| Forbidden side-effect grep clean | **Pass** |
| Validation doc created | **Pass** |
| No app code changed | **Pass** |

**Overall: PASSED** (metadata/grants/auth gate). Functional RPC smoke **pending** authenticated browser test.

---

## 9. Next recommended step

Implement Phase 6 app layer per [006_api_save_draft_plan.md](./006_api_save_draft_plan.md):

1. `api/parcelImportsMappers.js` — encode enums, build payload
2. `api/parcelImportsApi.js` — `supabase.rpc('save_parcel_import_draft', { payload })`
3. Wire Save Draft button after mappers + session gate are in place
