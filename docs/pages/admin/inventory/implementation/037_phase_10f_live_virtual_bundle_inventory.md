# Phase 10F — Live Virtual Bundle Reservation + Finalization

**Status:** Complete  
**Depends on:** [036_phase_10e_virtual_bundle_live_readiness.md](./036_phase_10e_virtual_bundle_live_readiness.md)  
**Verification:** `node scripts/verify-inventory-phase10f-live-virtual-bundle-inventory.mjs`

---

## Summary

Phase 10F implements **Model B live virtual bundle inventory** for bundles that are explicitly live-enabled. Preview, shadow, and `live_requested` bundles remain non-mutating. Normal variants and Model A stocked bundles are unchanged.

---

## 1. Live guard — `is_bundle_live_deduction_enabled(bundle_variant_id)`

Returns `true` only when **all** are true:

| Condition | Check |
|-----------|--------|
| Global mode | `virtual_bundle_mode = 'live'` |
| Staging flag | `allow_per_bundle_live = true` |
| Active rules | ≥1 active `inventory_bundle_rules` |
| Virtual flag | `is_virtual_enabled = true` |
| Bundle mode | `mode = 'live'` (not `live_requested`) |
| Readiness | `evaluate_bundle_live_readiness(..., false)` → `is_ready_for_live` |
| Independent stock | Acknowledged when warning applies |
| Self-reference | None |
| Missing components | None |

**Default:** returns `false` when global mode is not live or bundle is not explicitly live.

---

## 2. Admin live enablement UI

- **Global:** `allow_per_bundle_live` checkbox + **Enable global live mode** button (RPC `enable_inventory_bundle_global_live_mode`)
- **Per bundle:** `live_requested` → **Enable live** (requires global live + full readiness)
- **Confirmation:** “This will make bundle sales reserve and finalize component inventory.”
- **Revert:** live → shadow or preview (stops future live behavior; does not undo existing reservations/finalizations)
- **Audit:** `inventory_bundle_live_readiness_actions` with `live_enabled` / `live_reverted`

---

## 3. Virtual availability — `v_kk_variant_available_stock`

| Variant type | `available_display` |
|--------------|---------------------|
| Normal / Model A | `on_hand − reserved` (unchanged) |
| Live Model B bundle | `virtual_bundle_available` from component floor |
| Preview / shadow / live_requested | Normal on-hand math (no virtual sellable) |

Raw `on_hand` and `reserved` remain exposed for admin/debug.

---

## 4. Checkout validation — `create-checkout-session`

Uses `v_kk_variant_available_stock.available_display` — live-enabled bundles automatically validate against virtual component availability. MTO exemption unchanged. No component reservation at checkout (reservation on Stripe webhook in `reserve_only` mode).

**Race condition:** No holds at checkout; concurrent orders can still race until webhook reserve (documented limitation).

---

## 5. Component reservation — Stripe webhook

When `is_bundle_live_deduction_enabled` for a line:

- **Skip** normal bundle-variant reservation
- **Create** `reservation_kind = 'bundle_component'` rows per active rule
- **Idempotency:** `bundle_component_reserve:{session_id}:{line_item_id}:{component_variant_id}`
- **Fields:** `parent_bundle_variant_id`, `parent_order_item_id`
- Shadow hook (10D) still runs for shadow-mode bundles only

---

## 6. Component finalization — `finalize_kk_order_reservations`

On shipment for `bundle_component` reservations:

- Decrement **component** `product_variants.stock`
- Insert `stock_ledger`:
  - `reason = order_finalized`
  - `source = bundle_component_finalize`
  - `reference_type = bundle_component_order_line`
  - **Idempotency:** `bundle_component_finalize:{order_id}:{line_item_id}:{component_variant_id}:{reference}`
- **Does not** decrement parent bundle stock

---

## 7. Refund behavior

| Scenario | Behavior |
|----------|----------|
| Full refund before finalize | `releaseKkActiveReservations` releases `bundle_component` rows; no stock restore |
| Full refund after finalize | No auto-restock (returns phase) |
| Partial refund | Manual review / future phase |

---

## 8. Issue detection — `v_inventory_issues`

| Issue type | Source |
|------------|--------|
| `bundle_live_readiness_blocked` | `live_requested` + readiness blockers |
| `bundle_component_shortage_live` | Live-enabled + zero virtual availability |
| `bundle_component_reservation_failed` | `inventory_bundle_live_issues` log |
| `bundle_component_finalize_failed` | `inventory_bundle_live_issues` log |

---

## 9. Migrations / RPCs

| Object | File |
|--------|------|
| Reservation columns + live guard + reserve/release + enable RPCs | `20260925_inventory_phase10f_live_bundle_core.sql` |
| `v_kk_variant_available_stock` + finalize idempotency | `20260925_inventory_phase10f_live_bundle_views.sql` |
| Live issues table + `v_inventory_issues` extension | `20260925_inventory_phase10f_live_bundle_issues.sql` |

**New RPCs:** `reserve_live_bundle_components`, `release_live_bundle_component_reservations`, `enable_inventory_bundle_global_live_mode`, `enable_bundle_live_mode`, `revert_bundle_live_mode`

**Shared TS:** `supabase/functions/_shared/bundleLiveInventory.ts`

---

## 10. Verification results

Run: `node scripts/verify-inventory-phase10f-live-virtual-bundle-inventory.mjs`

Ephemeral fixture creates live bundle config, tests reserve/finalize/refund, then restores global settings.

---

## 11. Limitations

- No automatic live enablement
- No parcel/CPI changes
- No Amazon/eBay bundle channel sync changes
- Checkout race window until webhook reserve
- Partial refunds not automated (manual restock added in Phase 10G)
- `bundle_component_finalize_failed` issues require manual logging until fulfillment gap detection is expanded

---

## 12. Phase 10G follow-up (complete)

Admin-confirmed component restock for finalized live bundle lines. See [038_phase_10g_bundle_component_returns_restock.md](./038_phase_10g_bundle_component_returns_restock.md).

---

## 13. Recommended next phase — 10H

1. Partial refund → proportional restock guidance  
2. Order/Line Items deep link to return candidates  
3. Channel sync policy after component restock  
4. Fulfillment gap detection → auto finalize-failed issues
