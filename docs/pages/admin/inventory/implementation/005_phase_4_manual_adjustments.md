# Phase 4 — Manual Ledger Adjustments (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 3C (read-only dashboard fully wired)  
**Page:** `pages/admin/inventory.html`

---

## Summary

Phase 4 adds the first safe write path on the Inventory admin page: **manual stock adjustments** that always create an audited `stock_ledger` row while updating `product_variants.stock` in a single RPC transaction.

No channel sync, order reservation, parcel receive, or Products admin changes were made in this phase.

---

## Migration / RPC

**File:** `supabase/migrations/20260826_inventory_phase4_adjust_inventory.sql`

### Schema extensions (idempotent)

Added optional columns to `stock_ledger` if missing:

| Column | Purpose |
|--------|---------|
| `note` | Free-text admin note |
| `source` | Origin label (`admin_inventory` for manual adjust) |
| `reference_type` | Sub-type (`manual_adjust`) |
| `idempotency_key` | Optional replay-safe key (unique partial index) |
| `created_by` | `auth.uid()` of adjusting admin |

Existing columns reused: `variant_id`, `product_id`, `change`, `reason`, `reference_id`, `stock_before`, `stock_after`, `created_at`.

### RPC: `adjust_inventory`

| Input | Required | Notes |
|-------|----------|-------|
| `p_variant_id` | Yes | UUID of `product_variants` row |
| `p_delta_qty` | Yes | Non-zero integer; abs ≤ 100,000 |
| `p_reason` | Yes | One of: `count_correction`, `damaged`, `lost`, `found`, `returned_to_stock`, `other` |
| `p_note` | Yes | Trimmed non-empty text |
| `p_reference_type` | No | Default `manual_adjust` |
| `p_reference_id` | No | Stored in `reference_id`; defaults to reason code |
| `p_idempotency_key` | No | Returns prior result on replay |

**Validation:**

- `auth.uid()` required
- `is_admin()` must return true
- Variant must exist (row locked `FOR UPDATE`)
- Delta cannot be 0

**Transaction:**

1. Read current `product_variants.stock`
2. `UPDATE product_variants SET stock = stock + delta`
3. `INSERT stock_ledger` with `reason = 'manual_adjustment'`, `source = 'admin_inventory'`

**Returns (jsonb):** `variant_id`, `product_id`, `delta`, `stock_before`, `stock_after`, `ledger_id`, `created_at`, `adjustment_reason`, `idempotent_replay`

### View update

`v_inventory_ledger_recent` recreated to map `manual_adjustment` → source label **Admin Inventory** and expose `note`, `reference_type`.

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260826_inventory_phase4_adjust_inventory.sql` | Ledger columns + RPC + view |
| `js/admin/inventory/api/adjustInventoryApi.js` | Client RPC wrapper |
| `js/admin/inventory/services/adjustmentMath.js` | Add/remove/set delta preview math |
| `js/admin/inventory/services/refreshInventoryData.js` | Post-write panel refresh |
| `js/admin/inventory/renderers/renderAdjustModal.js` | Modal markup (render-only) |
| `js/admin/inventory/ui/adjustModal.js` | Modal open/submit controller |
| `scripts/verify-inventory-phase4-manual-adjust.mjs` | Automated verification |

---

## Files changed

| File | Change |
|------|--------|
| `pages/admin/inventory.html` | `#inventoryAdjustModalMount` |
| `js/admin/inventory/dom.js` | Modal mount ref |
| `js/admin/inventory/index.js` | Init adjust modal; Phase 4 header |
| `js/admin/inventory/events.js` | `adjust-stock` action; toast variants |
| `js/admin/inventory/renderers/renderInventoryTable.js` | Adjust button (desktop + mobile) |
| `js/admin/inventory/api/inventoryApi.js` | `manual_adjustment` reason label |
| `js/admin/inventory/state.js` | Comment update |
| `docs/pages/admin/inventory/implementation/roadmap.md` | Phase 4 complete |
| `docs/pages/admin/inventory/ux/roadmap.md` | Phase 4 status |
| `docs/pages/admin/inventory/implementation/001_wiring_plan.md` | Phase 4 note |

---

## Adjustment flow

1. Admin clicks **Adjust** on an inventory table row (desktop or mobile).
2. Modal shows product/variant summary and current on-hand (read-only).
3. Admin selects type: **Add**, **Remove**, or **Set exact qty**.
4. Enters quantity, reason (dropdown), and note (required).
5. Preview shows current / delta / new stock; warning if new stock &lt; 0.
6. Confirm calls `adjust_inventory` RPC with client-generated idempotency key.
7. On success: modal closes, all live panels refresh (KPI, table, ledger, issues, alerts, channel strip), success toast.
8. On failure: error toast; modal stays open.

Search/filter/tab state is preserved (only data refetched).

---

## Validation rules (client + server)

| Rule | Client | Server |
|------|--------|--------|
| Admin session | `requireAdmin` gate on page | `is_admin()` in RPC |
| Reason required | Yes | Yes |
| Note required | Yes (all adjustments) | Yes |
| Non-zero delta | Preview disables submit | RPC rejects 0 |
| Negative stock warning | Shown in modal | Allowed (no block) |
| Live workspace required | Blocks adjust on mock fallback | N/A |

---

## stock_ledger fields used (manual adjust)

| Field | Value |
|-------|-------|
| `variant_id` | Target variant |
| `product_id` | From variant row |
| `change` | Signed delta |
| `reason` | `manual_adjustment` |
| `reference_id` | Adjustment reason code (e.g. `count_correction`) |
| `stock_before` / `stock_after` | Snapshot |
| `note` | Admin note |
| `source` | `admin_inventory` |
| `reference_type` | `manual_adjust` |
| `idempotency_key` | Client UUID per submit |
| `created_by` | `auth.uid()` |

---

## Known limitations

- **Note always required** on server (stricter than “required for remove only” — simplifies audit).
- **`is_admin()`** must exist in Supabase (used elsewhere; not defined in this repo migration).
- **Products admin** still edits stock without ledger (out of scope).
- **No channel sync** after adjustment.
- **No reservations** — reserved KPI remains 0 until Phase 6.
- **Set exact qty** implemented as computed delta (same RPC path).
- **Ledger sub-reason** stored in `reference_id`, not a separate enum column.

---

## Verification results

**Run:** `node scripts/verify-inventory-phase4-manual-adjust.mjs`  
**Result:** PASS (2026-06-09)

| Check | Result |
|-------|--------|
| Page loads, zero console errors | PASS |
| Admin auth + live workspace (203 rows) | PASS |
| Adjust Stock opens modal with variant info | PASS |
| Add +1 adjustment | PASS |
| `product_variants.stock` updated | PASS |
| `stock_ledger` row inserted (`reason=manual_adjustment`, `source=admin_inventory`) | PASS |
| Success toast + modal close + panel refresh | PASS |
| Only `adjustInventoryApi.js` uses RPC in inventory JS | PASS |
| All inventory JS files &lt; 500 lines | PASS |
| Test stock reverted after assert | PASS |

---

## Next recommended phase

**Phase 5 — Parcel receive + ledger UI integration:** surface parcel receive events in the universal dashboard and link Receive Stock header action to existing parcel receive flow (read + navigate; no receive RPC changes unless audited separately).

See [roadmap.md](./roadmap.md).
