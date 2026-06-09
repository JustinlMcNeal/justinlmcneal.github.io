# Parcel Imports — Phase 12: Test Stabilization + History Search

**Status:** Implemented and verified  
**Date:** 2026-06-09  
**Prerequisites:** Phase 11 ([017_phase_11_receive_inventory.md](./017_phase_11_receive_inventory.md))

---

## Flaky test fixes

### Phase 8 — variant cost assertion

**Problem:** Test required `unit_cost_override_cents` to *change*, but repeated runs on a dirty DB often leave the value already at the weighted CPI target.

**Fix:** After approve, derive **expected cents** from final allocation `landed_cpi_usd` + pre-approve stock/cost using the same weighted-average formula as the RPC. Pass if:

- cost **changed**, OR
- cost **equals expected target** (unchanged but correct)

File: `scripts/verify-parcel-phase8-approve-cpi.mjs`

### Phase 10 — history open timeout

**Problem:** Tests clicked the first visible history row; with 25-row cap the saved import was often not in the DOM.

**Fix:**

- Open draft via `openDraft(importId)` directly (no history row required)
- Approved-import check loads latest approved ID from DB, then `openDraft(id)`
- Receive-inventory disabled check runs **before** opening approved import (avoids false failure when receive becomes enabled)

File: `scripts/verify-parcel-phase10-polish.mjs`

### Phase 6B / 7

Already used `openDraft()` fallback from Phase 10; unchanged.

---

## History search / load changes

### API — `listParcelImports(opts)`

Extended options:

| Option | Behavior |
|--------|----------|
| `importId` | Direct single-row fetch by UUID (for tests + lookup) |
| `search` | `parcel_id` / `source_file_name` ilike; UUID-shaped term matches `id` |
| `status` | Filter: draft, needs_review, ready_to_approve, approved |
| `limit` | Page size (default 25) |
| `offset` | Range start for pagination |

### UI — Previous Imports

| Control | ID | Behavior |
|---------|-----|----------|
| Search input | `#parcelHistorySearch` | Parcel ID, filename, or import UUID |
| Status filter | `#parcelHistoryStatusFilter` | All / draft / needs_review / ready_to_approve / approved |
| Search button | `#parcelHistorySearchBtn` | Apply filters (Enter also works) |
| Load more | `#parcelHistoryLoadMoreBtn` | +25 rows when more exist |

**Empty states:**

- No imports at all
- No matches for search/filter
- Import ID lookup not found

**`openDraft(importId)`** loads by ID without requiring a visible history row.

**Load more:** fetches `limit + 1` rows; shows button when a full next page exists.

---

## Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `api/parcelImportsApi.js` | 164 | `importId`, UUID search, offset range |
| `ui/historyTable.js` | 335 | Search/filter/load-more, empty states |
| `dom.js` | 69 | History control refs |
| `pages/admin/parcelImports.html` | — | Search toolbar |
| `scripts/verify-parcel-phase8-approve-cpi.mjs` | — | Expected CPI assertion |
| `scripts/verify-parcel-phase10-polish.mjs` | — | Direct `openDraft`, receive check order |

---

## KPI refresh verification

KPI cards refresh after (unchanged, confirmed wired):

| Action | Module |
|--------|--------|
| Save draft | `saveDraft.js` |
| Approve | `approvalActions.js` |
| Expense link/create | `expenseLinkActions.js` |
| Receive inventory | `inventoryReceiveActions.js` |
| New import | `newImport.js` |
| History load / open draft | `historyTable.js` |
| Parse | `events.js` |

---

## Test results

Two consecutive full-suite runs on linked test DB:

| Script | Result |
|--------|--------|
| Phase 3 | PASS |
| Phase 4 | PASS |
| Phase 6A | PASS |
| Phase 6B | PASS |
| Phase 7 | PASS |
| Phase 8 | PASS (repeatable on dirty DB) |
| Phase 9 | PASS |
| Phase 10 | PASS (repeatable) |
| Phase 11 | PASS |

---

## Safety grep

`js/admin/parcelImports/**`:

| Pattern | Result |
|---------|--------|
| Client `stock_ledger` / `SET stock` | None |
| Client cost writes | None |
| `createExpenseFromParcelImport` | User-initiated only (`expenseLinkActions.js`) |
| `receiveParcelImportInventory` | RPC client only |
| `approveParcelImportCpi` | RPC client only |

No changes to approve/receive RPC logic or expense auto-create behavior.

---

## Remaining issues

| Item | Notes |
|------|--------|
| Export History button | Still unwired (deferred) |
| Full pagination | Load-more only; no page numbers |
| Admin products stock edit | No ledger (pre-existing) |
| Unlink expense | API only, no UI |

---

## Parcel Imports v1 — complete?

**Yes.** Phases 1–12 deliver the full v1 workflow:

1. Upload / parse Baestao XLS  
2. Overrides + CPI preview  
3. Product/variant mapping + memory  
4. Save Draft + history  
5. Approve + CPI update (RPC)  
6. Expense create/link (user action)  
7. Receive inventory (RPC, idempotent)  
8. Stable regression suite + searchable history  

Recommended next work (out of v1 scope): export/reporting, expense unlink UI, history page-size preferences.
