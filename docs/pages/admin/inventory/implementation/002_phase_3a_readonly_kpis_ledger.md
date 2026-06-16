# Phase 3A — Read-Only KPI + Ledger Wiring Complete

**Project:** KK Universal Storage  
**Phase:** 3A — First read-only PR slice (KPI + Recent Stock Ledger)  
**Completed:** 2026-06-09  
**Page:** `pages/admin/inventory.html`

---

## Summary

Wired the Inventory admin **KPI cards** and **Recent Stock Ledger** footer panel to live read-only Supabase views. Added admin auth gate (`requireAdmin`). Main inventory table, channel strip, issues panel, and bundle panel remain on mock/static data. No writes, reservations, or stock mutation behavior changes.

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260823_inventory_phase3a_read_views.sql` | **New** — idempotent `stock_ledger` baseline + `v_inventory_kpis` + `v_inventory_ledger_recent` |
| `js/admin/inventory/api/inventoryApi.js` | **New** — read-only `fetchInventoryKpis()`, `fetchRecentLedgerEntries()` |
| `js/admin/inventory/state.js` | **New** — loading/error/live state + mock fallback |
| `js/admin/inventory/index.js` | Admin gate, load live panels after auth |
| `js/admin/inventory/renderers/renderKpis.js` | Accept passed KPI data + loading/error states |
| `js/admin/inventory/renderers/renderLedger.js` | Accept passed ledger data + loading/error states |
| `js/admin/inventory/utils/formatters.js` | Added `formatLedgerTime()` |
| `js/admin/inventory/dom.js` | Indentation fix (no functional change) |
| `scripts/verify-inventory-phase3a-readonly.mjs` | **New** — Playwright smoke + write-pattern grep |
| `docs/pages/admin/inventory/implementation/roadmap.md` | Phase 3A marked complete |
| `docs/pages/admin/inventory/implementation/001_wiring_plan.md` | Phase 3A slice note |
| `docs/pages/admin/inventory/ux/roadmap.md` | Phase 3A tasks checked |

**Unchanged (still mock/static):** `mockData.js`, `events.js`, `renderInventoryTable.js`, `renderChannelStatus.js`, `renderIssues.js`, `renderBundle.js`

---

## Views / migrations

### `v_inventory_kpis` (single row)

| Column | Source |
|--------|--------|
| `total_skus` | Count active `product_variants` (`coalesce(is_active, true)`) |
| `on_hand_units` | Sum `product_variants.stock` (active variants) |
| `reserved_units` | `0` (placeholder until reservations table) |
| `available_units` | Same as on-hand until reservations exist |
| `low_stock` | Active variants with `stock > 0 AND stock <= 3` (matches Products admin threshold) |
| `unmapped_lines` | Approved parcel imports not yet received with unmapped `business_inventory` rows |
| `inventory_issues` | Negative-stock variant count + parcel unmapped count |
| `last_channel_sync_at` | `NULL` (UI shows “Not wired”) |

### `v_inventory_ledger_recent`

Joins `stock_ledger` → `product_variants` → `products` for labels. Maps `reason` → `source` (`order`/`refund` → KK Store, `parcel_receive` → Parcel Import). Ordered in API by `entry_time DESC`.

### `stock_ledger` baseline

`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS created_at` — safe for production where table already exists.

---

## Live vs mock

| UI section | Data source |
|------------|-------------|
| KPI cards (8) | **Live** `v_inventory_kpis` (mock fallback on error / pre-migration) |
| Recent Stock Ledger | **Live** `v_inventory_ledger_recent` (mock fallback on error) |
| Channel connection strip | Mock |
| Tabs / alerts / filters | Mock |
| Main inventory table | Mock |
| Issues panel | Mock |
| Bundle rules panel | Mock |
| Header actions (Sync/Receive/Export) | Placeholder (no writes) |

---

## Schema assumptions

1. `product_variants.stock` is on-hand SOT; `is_active` defaults true when null.
2. `stock_ledger` has `id`, `created_at`, `variant_id`, `product_id`, `change`, `reason`, `reference_id`, `stock_before`, `stock_after`.
3. Ledger reasons in prod today: `order`, `refund`, `parcel_receive`.
4. No reservation table — reserved/available KPI shows 0 / equals on-hand.
5. Order-line unmapped counts (eBay/Amazon fuzzy matching) **not** included in KPI yet.
6. Products admin direct stock edits still bypass ledger (known gap — not fixed in 3A).

---

## Verification

**Script:** `node scripts/verify-inventory-phase3a-readonly.mjs`

| Check | Result (2026-06-09) |
|-------|---------------------|
| No insert/update/upsert/delete/rpc in `js/admin/inventory/` | Pass |
| Unauthenticated access | Redirect to login |
| KPI cards | 8 rendered |
| Ledger panel | 5 rows visible |
| Inventory table | Mock (20 row nodes) |
| Console errors | None (excluding Tailwind CDN / static 404 noise) |
| Live KPI after migration | Pass — 203 total SKUs from `v_inventory_kpis` |
| Live ledger after migration | Pass — entries from `stock_ledger` |
| Pre-migration fallback | Pass — mock data + amber warning when views missing |

**Apply migration:**

```bash
npx supabase db query --linked -f supabase/migrations/20260823_inventory_phase3a_read_views.sql
```

---

## Intentionally not implemented (3A)

- `v_inventory_workspace` / live inventory table
- `v_inventory_issues` view
- Manual adjustment RPC
- Order reserve / finalize
- Channel sync push
- Stripe webhook / Products admin / parcel receive / CPI changes

---

## Next recommended PR slice (Phase 3B)

1. Migration: `v_inventory_workspace` (+ optional `v_inventory_issues` read-only)
2. `fetchInventoryWorkspace()` in `inventoryApi.js`
3. Wire main table + tab counts from live view; keep filters client-side initially
4. Channel strip read-only from existing Amazon/eBay workspace views (no push)

See [001_wiring_plan.md §16](./001_wiring_plan.md#16-recommended-next-implementation-phase).
