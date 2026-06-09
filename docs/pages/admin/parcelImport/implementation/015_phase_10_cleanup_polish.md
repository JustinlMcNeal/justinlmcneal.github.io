# Parcel Imports — Phase 10: Cleanup & Polish

**Status:** Implemented and verified  
**Date:** 2026-06-08  
**Prerequisites:** Phase 9 ([014_phase_9_expense_linkage.md](./014_phase_9_expense_linkage.md))

---

## Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `api/parcelImportStats.js` | 35 | Live KPI counts from `parcel_imports` |
| `ui/newImport.js` | 51 | New Import reset flow |
| `ui/stats.js` | 80 | Global KPI render + parse overlay |
| `state.js` | 377 | `resetWorkingImport()` |
| `ui/historyTable.js` | 227 | Expense column, Open/Open Draft labels |
| `ui/saveDraft.js` | 189 | Duplicate copy, KPI/history refresh |
| `ui/parcelSummary.js` | 73 | `clearParcelSummary()`, status from DB |
| `ui/overrides.js` | 277 | `clearChargeOverrides()` |
| `ui/itemMappingTable.js` | 175 | Empty mapping state |
| `dom.js` | 64 | New Import + Receive Inventory refs |
| `index.js` | 108 | Init new import + KPI refresh |
| `events.js` | 130 | KPI refresh on parse |
| `ui/approvalActions.js` | 133 | KPI refresh after approve |
| `ui/expenseLinkActions.js` | 199 | KPI/history refresh after expense link |
| `pages/admin/parcelImports.html` | — | Live KPI hooks, history cleanup |
| `scripts/verify-parcel-phase10-polish.mjs` | 235 | Phase 10 test |
| `scripts/verify-parcel-phase6b.mjs` | — | Open-draft message fix |
| `scripts/verify-parcel-phase7-mapping.mjs` | — | `openDraft()` + message fix |
| `scripts/verify-parcel-phase9-expense-link.mjs` | — | History refresh wait |

## Removed

| File | Reason |
|------|--------|
| `ui/matchSuggestions.js` | Unused stub; superseded by `mappingMemory.js` |

---

## New Import behavior

- Button: `data-parcel-action="new-import"` (header)
- Clears file input, parse state, mappings, overrides, CPI, duplicate warning, approval/expense state
- Does **not** delete DB records
- Refreshes KPI cards and history list
- Returns upload-ready empty state

---

## KPI card behavior

| Card | Source |
|------|--------|
| Total Imports | `count(*)` |
| Draft Imports | `status = draft` |
| Awaiting Approval | `status = ready_to_approve` |
| Approved | `status = approved` |
| Needs Review | `status = needs_review` when idle; current unmapped rows when import open |

Hint on card 5 when idle shows `{N} expense linked`.

---

## Test results

| Script | Result |
|--------|--------|
| Phase 3 | PASS |
| Phase 4 | PASS |
| Phase 6A | PASS |
| Phase 6B | PASS |
| Phase 7 | PASS |
| Phase 8 | PASS |
| Phase 9 | PASS |
| **Phase 10 polish** | PASS |

Phase 10 verified: live KPIs (`total: 29`, `approved: 8`, `needsReview: 20`), Save Draft, New Import reset (`importId: null`, upload-ready message), Open Draft restore (11 items), approved Save disabled, Receive Inventory disabled, expense linked in history.

---

## Safety grep

`js/admin/parcelImports/**`:

- No `stock_ledger`
- No `inventory_receipt`
- No product stock writes
- No expense auto-create on approval
- No unauthorized product/variant cost writes (approval RPC only, unchanged)

---

## Remaining issues

| Item | Detail |
|------|--------|
| Receive Inventory | Disabled placeholder — Phase 11 |
| Export buttons | Still unwired |
| Unlink expense | API only, no UI |
| KPI card 5 label | Switches meaning (needs review vs unmapped) — intentional |
| History limit | Table shows 25 newest imports; older rows require search (future) |

---

## Next recommended phase

**Phase 11 — Receive Inventory**: stock updates + `stock_ledger` from approved imports with mapped rows (after expense linkage).
