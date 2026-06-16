# Phase 10C — Virtual Bundle Cutover Simulation + Shadow Mode (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 10B (bundle rule management + product picker)  
**Next:** Phase 10D — live Model B cutover (checkout / reserve / finalize)

---

## Summary

Added a **read-only simulation layer** and **shadow event logging** for Model B virtual bundles. Operators can answer: *“If this virtual bundle sold, what components would reserve/finalize, what would availability be, and what ledger rows would be created?”*

**No live behavior changed.** Checkout, reservations, fulfillment finalization, stock, ledger, and channel sync still ignore bundle rules. Global mode defaults to `preview_only` and cannot be switched to live from this phase.

**Model A default unchanged:** separate stocked bundle SKUs remain the default until explicit virtual enablement + future live cutover.

---

## Flag / mode design

### Global settings — `inventory_bundle_settings`

| Field | Default | Notes |
|-------|---------|-------|
| `setting_key` | `global` | Singleton row |
| `virtual_bundle_mode` | `preview_only` | `preview_only` \| `shadow` \| `live` |
| `allow_per_bundle_live` | `false` | Required for per-bundle live in future |

### Per-bundle settings — `inventory_bundle_variant_settings`

| Field | Default | Notes |
|-------|---------|-------|
| `is_virtual_enabled` | `false` | Must be true for live (future) |
| `mode` | `preview_only` | Per-bundle override |
| `independent_stock_acknowledged` | `false` | Required when bundle has on-hand + virtual rules (live readiness) |

Phase 10C does **not** expose UI to switch global or per-bundle modes to `live`. Settings are readable in preview modal; admin can update via DB when ready.

---

## Simulation behavior

### RPC — `simulate_virtual_bundle_order(bundle_variant_id, quantity)`

- **STABLE**, read-only — no stock / reservation / ledger writes
- Uses **active** `inventory_bundle_rules` only
- Does **not** count bundle’s own stock as component stock
- Returns jsonb:

| Section | Contents |
|---------|----------|
| Bundle | label, SKU, on-hand, reserved, available |
| Virtual | `virtual_availability` (min floor across components) |
| Components | per-component avail, qty per bundle, required, shortage, would_reserve, would_finalize |
| Result | `can_fulfill_virtual`, `result` code |
| Flags | `missing_rules`, `self_reference_error`, `independent_stock_warning` |
| Previews | `preview_reservations`, `preview_ledger` (json arrays, `preview_only: true`) |

### Result codes

| Code | Meaning |
|------|---------|
| `can_fulfill_virtual` | Components sufficient for requested qty |
| `component_shortage` | One or more components insufficient |
| `missing_component` | Rule references missing/inactive variant |
| `missing_rules` | No active rules on bundle |
| `self_reference_error` | Bundle listed as its own component |
| `independent_stock_warning` | Bundle has on-hand stock while virtual rules exist (advisory; may still pass) |

---

## Shadow event behavior

### Table — `inventory_bundle_shadow_events`

| Field | Notes |
|-------|-------|
| `event_type` | `checkout_simulation` \| `reservation_shadow` \| `finalize_shadow` |
| `simulation_result` | Full jsonb from simulate RPC |
| `source_order_id` / `source_order_item_id` | Nullable — unused in 10C (no checkout wiring) |

### RPC — `record_inventory_bundle_shadow_event`

- Admin auth required
- **Rejects** when global mode is `live` (Phase 10C guard)
- Writes **only** to shadow events table — no inventory side effects

Phase 10C: shadow events created **only** from admin **Save Simulation** in Bundle Preview modal. Checkout is **not** wired.

---

## Cutover readiness view

### `v_inventory_bundle_cutover_readiness` (advisory)

| Field | Purpose |
|-------|---------|
| `is_ready_for_shadow` | Active rules, no self-ref/missing component, global mode preview/shadow |
| `is_ready_for_live` | Strict: ready preview, independent stock ack, global live + allow_per_bundle_live, bundle virtual enabled + mode live |
| `blocker_reasons` | Text array explaining gaps |

Shown in Bundle Preview modal under **Cutover readiness (advisory)**.

---

## UI behavior

### Bundle Preview modal

- Header: **Preview / Config / Simulation**
- Global mode chip: `Global mode: preview_only — simulation only, no live deduction`
- Cutover readiness list (when bundles configured)
- **Simulate Sale** button on Model B virtual bundle cards (active rules)
- Prompt for quantity → inline simulation panel:
  - Component requirements, shortages, would reserve/finalize
  - Virtual vs bundle availability
  - Independent stock warning
  - Pass/fail status
  - Expandable preview reservations / ledger JSON
- **Save Simulation** → shadow event only
- Label: **Simulation only — no stock or reservations changed**

---

## Verification

```bash
node scripts/verify-inventory-phase10c-virtual-bundle-shadow.mjs
```

**Result:** PASS

- Default global mode `preview_only`; `allow_per_bundle_live` false
- `simulate_virtual_bundle_order` STABLE, no DML
- Simulation returns component rows, shortage detection, `simulation_only` flag
- Self-reference blocked by DB constraint; RPC handles `self_reference_error`
- Shadow events table accepts records; no stock/ledger/reservation mutations
- Inventory page + bundle modal + simulation module load

**Linked DB at verify:** readiness **0**, shadow events **0**, global mode **preview_only**

**Simulation example (ephemeral test rule, qty=1):** `can_fulfill_virtual`, virtual_availability **50**, 1 component row

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260922_inventory_phase10c_virtual_bundle_shadow.sql` | Settings, shadow events, simulate RPC, readiness view |
| `js/admin/inventory/api/bundleShadowApi.js` | Simulation + shadow + readiness API |
| `js/admin/inventory/ui/bundleSimulationPanel.js` | Simulate Sale UI + readiness section |
| `scripts/verify-inventory-phase10c-virtual-bundle-shadow.mjs` | Verification |
| `docs/pages/admin/inventory/implementation/034_phase_10c_virtual_bundle_shadow.md` | This doc |

| Changed | |
|---------|--|
| `js/admin/inventory/ui/bundlePreviewSummary.js` | Simulate button, global mode chip, readiness mount |
| `js/admin/inventory/ui/bundlePreviewModal.js` | Wire simulation, readiness, settings fetch |
| `docs/pages/admin/inventory/implementation/roadmap.md` | Phase 10C complete |
| `docs/pages/admin/inventory/implementation/001_wiring_plan.md` | Phase 10C scope |
| `docs/pages/admin/inventory/implementation/033_phase_10b_bundle_rule_management.md` | Next → 10C/10D |
| `docs/pages/admin/inventory/ux/roadmap.md` | Simulation tasks |

---

## What remains not live

- Live component reservation on checkout
- Live component finalization on ship
- Customer-facing virtual bundle availability
- Channel sync from virtual BOM
- Automatic stock deduction from bundle sales
- Parcel/CPI/manual adjustment changes for bundles
- Returns/restock component logic
- Checkout shadow wiring (deferred — admin-only simulation in 10C)

---

## Limitations

- Mode settings not editable in UI (DB/admin RPC future)
- Simulation uses current stock/reserved snapshots — not transactional with concurrent orders
- `independent_stock_warning` does not block simulation pass (only live readiness)
- Sparse catalog may yield zero readiness rows until rules configured
- Shadow save requires authenticated admin session

---

**Next:** Phase 10D — virtual bundle checkout shadow hook (complete). See [035](./035_phase_10d_virtual_bundle_checkout_shadow.md).

## Recommended Phase 10E

1. Admin UI for global `shadow` mode toggle (still no deduction)
2. Optional checkout **shadow-only** hook: log `checkout_simulation` on order create without mutating inventory
3. Global + per-bundle **live** cutover flags with guards
4. Wire Model B into reservation RPC + fulfillment finalize (component deduct + ledger)
5. Virtual availability in `v_kk_variant_available_stock` when bundle mode live
6. Channel sync policy for virtual vs Model A stocked bundles
7. Prevent double-count when `has_independent_stock_warning` unless acknowledged

Stop after Phase 10C.
