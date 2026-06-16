# Phase 3B — Workspace Table + Issues Wiring Complete

**Project:** KK Universal Storage  
**Phase:** 3B — Read-only inventory table + issues panel  
**Completed:** 2026-06-09  
**Page:** `pages/admin/inventory.html`

---

## Summary

Wired the **main inventory table**, **tab counts**, **search/filters**, and **Inventory Issues** footer panel to live read-only Supabase views. KPI cards and Recent Stock Ledger remain live from Phase 3A. Channel strip, alert pills, and bundle rules remain mock/static. No writes added.

---

## Migrations / views added

**File:** `supabase/migrations/20260824_inventory_phase3b_workspace_issues.sql`

### `v_inventory_workspace`

One row per active `product_variants` row.

| Field | Source / rule |
|-------|----------------|
| `on_hand`, `kk_stock` | `product_variants.stock` |
| `reserved`, `available` | `0` / equals on-hand until reservations exist |
| `ebay_stock` | **Always NULL** — no eBay channel qty cache in DB |
| `amazon_stock` | `amazon_listings.fbm_quantity` via mapped `kk_variant_id` |
| `low_stock_threshold` | Default `3` (matches Products admin) |
| `status` | `issue` / `low` / `healthy` from stock + issue flags |
| `sync_state` | `never` / `mismatch` / `stale` / `synced` from Amazon mapping + qty delta |
| `issue_types` | `text[]` for client filters |
| `is_unmapped` | Missing SKU, parcel unmapped, broken eBay link, orphan Amazon variant |
| `updated_at` | Latest `stock_ledger.created_at` for variant (fallback `now()`) |

### `v_inventory_issues`

Grouped issue summaries (one row per issue type with `affected_count > 0`):

- `negative_stock`, `low_stock`, `missing_sku`
- `ebay_mapping_missing`, `amazon_mapping_missing`, `parcel_mapping_missing`
- `ebay_listing_ended`, `amazon_listing_inactive`

**Not included:** `unmapped_order_line` (order sync gaps not reliably detectable in read-only view).

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260824_inventory_phase3b_workspace_issues.sql` | **New** |
| `js/admin/inventory/api/inventoryApi.js` | `fetchInventoryWorkspace()`, `fetchInventoryIssues()` |
| `js/admin/inventory/state.js` | Workspace + issues state; `loadLiveData()` |
| `js/admin/inventory/services/mapWorkspaceRow.js` | **New** — DB → table row mapper |
| `js/admin/inventory/services/filterInventory.js` | **New** — tab/filter/sort logic |
| `js/admin/inventory/events.js` | Live rows, dynamic tab counts, exported refresh helpers |
| `js/admin/inventory/index.js` | Load workspace/issues after auth |
| `js/admin/inventory/renderers/renderInventoryTable.js` | Loading/error + live data |
| `js/admin/inventory/renderers/renderIssues.js` | Loading/error + live data |
| `js/admin/inventory/utils/formatters.js` | `formatRelativeTime()` |
| `scripts/verify-inventory-phase3b-workspace-issues.mjs` | **New** |
| `docs/pages/admin/inventory/implementation/roadmap.md` | Phase 3B complete |
| `docs/pages/admin/inventory/implementation/001_wiring_plan.md` | Next phase note |
| `docs/pages/admin/inventory/ux/roadmap.md` | Phase 3B checked |

---

## Live vs mock

| Section | Source |
|---------|--------|
| KPI cards | Live `v_inventory_kpis` |
| Recent Stock Ledger | Live `v_inventory_ledger_recent` |
| **Main inventory table** | **Live `v_inventory_workspace`** |
| **Tab counts / search / filters** | **Live rows (client-side)** |
| **Inventory Issues panel** | **Live `v_inventory_issues`** |
| Channel connection strip | Mock |
| Alert pills strip | Mock |
| Bundle Rules card | Mock |
| Header actions (Sync/Receive/Export) | Placeholder |

---

## Known limitations

1. **eBay stock column** — always `—`; no persisted eBay channel quantity in schema.
2. **eBay sync_state** — presence-only (listed or not); no qty mismatch detection for eBay.
3. **Amazon orphan variants** — variants on products with any Amazon mapping but no variant-level mapping flag as `amazon_mapping_missing` / `has_issue` (can be broad on multi-variant products).
4. **Category filter** — uses slug derived from `categories.name`; may not match mock category ids until categories are normalized.
5. **Unmapped order lines** — not in issue view; alert pills remain mock.
6. **Reserved units** — always 0 until reservation phase.
7. **Threshold** — global default 3; no per-variant `reorder_threshold` column yet.

---

## Verification

**Script:** `node scripts/verify-inventory-phase3b-workspace-issues.mjs`

| Check | Result (2026-06-09) |
|-------|---------------------|
| No writes/RPC in `js/admin/inventory/` | Pass |
| KPI + ledger still live | Pass |
| Workspace live | Pass — 203 variant rows |
| Issues panel live | Pass — 4 issue types |
| Table renders (desktop + mobile) | Pass — 406 row nodes |
| Low Stock tab | Pass — filters rows |
| Issues tab | Pass |
| Search ("beanie") | Pass — 80 row nodes |
| Console errors | None |

**Apply migration:**

```bash
npx supabase db query --linked -f supabase/migrations/20260824_inventory_phase3b_workspace_issues.sql
```

---

## Next recommended phase

**Phase 4 — Manual ledger adjustments** (`adjust_inventory` RPC + admin UI), or **Phase 3C** (optional polish):

- Channel strip read-only from existing eBay/Amazon workspace views
- Wire alert pills from live issue counts
- Per-variant reorder threshold column + migration

See [implementation/roadmap.md](./roadmap.md).
