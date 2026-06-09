# Parcel Imports — Phase 6A: API Mappers + RPC Smoke Harness

**Status:** Implemented — manual browser smoke **pending**  
**Date:** 2026-06-08  
**Prerequisites:** Migrations 001 + 002 applied ([008_migration_002_validation.md](./008_migration_002_validation.md))

**Goal:** Client payload/mapping layer + dev-only authenticated RPC smoke runner. **No Save Draft button wiring.**

---

## 1. Files created

| File | Lines | Purpose |
|------|-------|---------|
| `js/admin/parcelImports/api/parcelImportsMappers.js` | 289 | Enum codec, payload builder, status intent, SHA-256 |
| `js/admin/parcelImports/api/parcelImportsApi.js` | 66 | Supabase RPC + session gate + smoke count queries |
| `js/admin/parcelImports/api/saveDraftSmokeTest.js` | 85 | Dev console smoke test (create + update) |

## 2. Files updated

| File | Lines | Changes |
|------|-------|---------|
| `js/admin/parcelImports/state.js` | 240 | `currentImportId`, `saveStatus`, `saveMessage`, setters |
| `js/admin/parcelImports/index.js` | 42 | Localhost dev hook → `window.ParcelImports` |

**Not changed:** `parcelImports.html`, `events.js`, Save Draft button, Previous Imports table.

---

## 3. Mapper capabilities

### Enum codec

| Function | Direction |
|----------|-----------|
| `encodeRowType` / `decodeRowType` | UI label ↔ DB snake_case |
| `encodeMappingStatus` / `decodeMappingStatus` | UI label ↔ DB snake_case |
| `encodeAllocationMethod` | `weight` / `equal` → `weight_based` / `equal_split` |

### Payload builder

`buildSaveDraftPayload(state)` (async):

- Builds CPI preview via `buildCpiPreview()`
- Strips `overrides.dirtyFields`
- Nulls NaN/undefined numerics
- Ensures one mapping per item (synthesizes `unknown` / `needs_mapping` if missing)
- Sets `productId` / `productVariantId` to `null`
- Computes `statusIntent` via `computeStatusIntent()`
- Hashes `currentFile` with Web Crypto SHA-256 when present

### Status intent (conservative)

| Status | When |
|--------|------|
| `ready_to_approve` | `cpiPreview.summary.readyToUpdate` and no override field errors |
| `needs_review` | Parser errors, override errors, mapping issues, CPI/parser warnings, etc. |
| `draft` | Otherwise |

---

## 4. API module

`parcelImportsApi.js`:

- `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` — same pattern as `expenses/api.js`
- `requireAuthenticatedSession()` — throws if no JWT
- `saveParcelImportDraft(payload)` → `supabase.rpc('save_parcel_import_draft', { payload })`
- `fetchImportSmokeCounts(importId)` — item/allocation counts + events list

**No service role.** Anon key + authenticated session only.

---

## 5. How to run smoke test

### Prerequisites

1. Local dev server (smoke harness loads on `localhost` / `127.0.0.1` only)
2. Admin logged in (Supabase Auth JWT in localStorage)
3. Baestao fixture parsed in UI

### Steps

1. Open `pages/admin/parcelImports.html` via local server
2. Log in to admin (same session as expenses/line items pages)
3. Upload `docs/pages/admin/parcelImport/fixtures/sample_baestao_waybill_227461.xls`
4. Optionally set FX to `7.21` in overrides
5. Open browser console:

```js
await ParcelImports.runSaveDraftSmokeTest()
```

### Expected results

| Check | Expected |
|-------|----------|
| Create RPC `created` | `true` |
| Update RPC `created` | `false` |
| `item_count` | `11` |
| `allocation_count` | `11` |
| DB `parcel_import_items` count after update | `11` (not 22) |
| DB preview allocations count | `11` |
| Events (in order) | `parsed`, `draft_saved`, `draft_saved` |
| `state.currentImportId` | Set to returned UUID |

Console logs `[parcelImports smoke] PASSED` with `checks` object when all pass.

---

## 6. Actual result

**Run:** 2026-06-08 via `node scripts/verify-parcel-phase6a-smoke.mjs` (Playwright + magic-link admin session on `127.0.0.1:9882`, fixture `sample_baestao_waybill_227461.xls`).

| Field | Value |
|-------|-------|
| Tested by | automated smoke script |
| Create `created` | `true` |
| Update `created` | `false` |
| Item/allocation counts | `11` / `11` (RPC + DB) |
| Events | `parsed`, `draft_saved`, `draft_saved` |
| Pass/fail | **PASS** |

`import_id`: `2f16381c-9b46-4dd4-8175-6da650add1ed` · `status`: `needs_review`

Manual browser equivalent: log in → upload fixture → DevTools console:

```js
await ParcelImports.runSaveDraftSmokeTest()
```

(PowerShell cannot run `await`; use Chrome/Edge DevTools console only.)

---

## 7. Safety grep (Phase 6A JS)

Searched `js/admin/parcelImports/api/*.js`:

- No `products` / `product_variants` table writes
- No `stock_ledger` / `expenses` inserts
- No approve / inventory calls

Only RPC: `save_parcel_import_draft` + read-only count queries on parcel tables.

---

## 8. Issues / deviations

| Item | Detail |
|------|--------|
| Smoke harness host | Exposed only on `localhost` / `127.0.0.1` (matches existing dev console pattern) |
| Deployed `github.io` admin | Use local dev server for smoke, or import modules manually in console on live site |
| `ready_to_approve` on fixture | Unlikely without full product matching — expect `needs_review` or `draft` for default mappings |
| Browser smoke | Passed 2026-06-08 (see §6) |

---

## 9. Next step (Phase 6B)

1. Wire **Save Draft** button (`ui/saveDraft.js`) — not smoke harness
2. `requireAdminSession()` on page init (expenses pattern)
3. Duplicate warning via `checkDuplicateParcelImport` (client queries)
4. Previous Imports list (`ui/historyTable.js`)
5. Load draft rehydration (decode enums back to UI)

Do **not** start approval, CPI product updates, expenses, or inventory.
