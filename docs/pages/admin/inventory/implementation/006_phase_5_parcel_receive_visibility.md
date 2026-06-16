# Phase 5 — Parcel Receive + Ledger Visibility (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 4 (manual ledger adjustments)  
**Page:** `pages/admin/inventory.html`

---

## Summary

Phase 5 surfaces parcel receive activity on the Inventory dashboard and routes users to the existing Parcel Imports receive flow. **No new stock mutations**, no changes to `receive_parcel_import_inventory`, CPI approval, or parcel receive RPC logic.

---

## Migration / view

**File:** `supabase/migrations/20260827_inventory_phase5_parcel_receive_summary.sql`

**View:** `v_inventory_parcel_receive_summary` (read-only, single row)

| Column | Meaning |
|--------|---------|
| `awaiting_mapping` | Approved, unreceived parcel mapping rows not matched to a variant |
| `ready_to_receive` | Approved imports with `inventory_received_at IS NULL` |
| `recently_received` | Imports received in the last 30 days |
| `last_parcel_receive_at` | Latest `inventory_received_at` timestamp |
| `parcel_ledger_entries` | Total `stock_ledger` rows with `reason = parcel_receive` |

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260827_inventory_phase5_parcel_receive_summary.sql` | Summary view |
| `js/admin/inventory/constants/parcelLinks.js` | Deep-link URLs + tooltip copy |
| `js/admin/inventory/api/parcelReceiveApi.js` | Read summary view |
| `js/admin/inventory/services/mapParcelSummary.js` | Row mapper + mock fallback |
| `js/admin/inventory/renderers/renderParcelSummary.js` | Summary card renderer |
| `js/admin/parcelImports/ui/deepLink.js` | URL query param handling on Parcel Imports |
| `scripts/verify-inventory-phase5-parcel-visibility.mjs` | Automated verification |

---

## Files changed

| File | Change |
|------|--------|
| `pages/admin/inventory.html` | Parcel summary section; Receive Stock tooltip |
| `js/admin/inventory/dom.js` | `parcelSummaryMount` |
| `js/admin/inventory/index.js` | Render parcel summary; Phase 5 header |
| `js/admin/inventory/state.js` | Parcel summary state + fetch in `loadLiveData` |
| `js/admin/inventory/events.js` | Receive Stock navigation; ledger filter; parcel alert navigation |
| `js/admin/inventory/services/buildAlerts.js` | Parcel mapping alert → Parcel Imports URL |
| `js/admin/inventory/services/refreshInventoryData.js` | Refresh parcel summary + ledger filter |
| `js/admin/inventory/renderers/renderLedger.js` | Reason badges; parcel filter; View Parcel Receives link |
| `js/admin/inventory/renderers/renderIssues.js` | Open Parcel Imports action on mapping issue |
| `js/admin/inventory/api/inventoryApi.js` | `reasonKey` on ledger rows; fetch limit 40 |
| `js/admin/parcelImports/ui/historyTable.js` | `applyHistoryDeepLinkParams` |
| `js/admin/parcelImports/index.js` | Apply deep links on init |
| Docs (roadmaps, wiring plan) | Phase 5 complete |

---

## What the Receive Stock button does

Header **Receive Stock** navigates to:

`/pages/admin/parcelImports.html?tab=history&status=approved&received=not_received`

Parcel Imports opens the **History** tab with filters for approved imports not yet received. Tooltip: *“Receive stock through Parcel Imports. Approved parcel rows write to the stock ledger.”*

The summary card includes the same deep links: Receive Stock, Open Parcel Imports, View Parcel Receives.

---

## Parcel data visible on Inventory

- **Parcel Receive Summary card** — live counts from `v_inventory_parcel_receive_summary`
- **Recent Stock Ledger** — `parcel_receive` entries with teal reason badge; optional “Parcel Receive” filter (client-side on recent 40 rows)
- **Inventory Issues** — `parcel_mapping_missing` row includes “Open Parcel Imports →”
- **Alert pill** — “Parcel Rows Awaiting Mapping” navigates to Parcel Imports (not table filter)

---

## What remains unchanged

- `receive_parcel_import_inventory` RPC
- Parcel CPI approval / save draft / expense link flows
- Stripe webhook stock deduction
- Manual `adjust_inventory` (Phase 4)
- Channel sync, order reservation, Products admin stock edits
- Bundle rules card (still placeholder)

---

## Known limitations

- **Ready to receive** counts imports, not individual line items (mapping gaps counted separately in **Awaiting Mapping**).
- **Ledger parcel filter** applies to the most recent 40 ledger rows only (not full history).
- **Parcel mapping alert** navigates away from Inventory (other alerts still filter the table).
- **Deep links** require Parcel Imports page load; opening a specific import for receive still manual from history list.
- **Recently received** uses a 30-day window on `parcel_imports.inventory_received_at`, not ledger timestamps.

---

## Verification results

**Run:** `node scripts/verify-inventory-phase5-parcel-visibility.mjs`

| Check | Result |
|-------|--------|
| Page loads, zero console errors | PASS |
| Live KPI/table/ledger/issues/channel | PASS |
| Parcel summary live | PASS |
| Receive Stock → Parcel Imports deep link | PASS |
| History tab + filters from URL | PASS |
| Ledger parcel filter | PASS |
| No new writes in inventory JS (except Phase 4 RPC file) | PASS |
| All inventory JS &lt; 500 lines | PASS |

Phase 4 adjust flow unchanged (same `adjustInventoryApi.js` RPC path).

---

## Next recommended phase

**Phase 6 — Order deduction & reservation:** reserve on paid KK order, finalize on ship, reverse on cancel; `inventory_reservations` table + idempotent order-line effects.

See [roadmap.md](./roadmap.md).
