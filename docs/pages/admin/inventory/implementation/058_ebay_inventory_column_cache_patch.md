# Phase 058 — eBay Inventory Column Cache Patch (Post-10Y)

**Status:** Complete  
**Date:** 2026-06-09  
**Type:** Post-freeze patch (no new dashboard features)  
**Prerequisite:** Phase 7D/7F (eBay cache + sync), Phase 10Y (pool safety)

---

## Summary

Wired the Inventory main table **eBay Stock** column to existing **`ebay_listing_inventory_cache`** data. Read-only — no live eBay API calls on page load, no quantity push, no stock/reservation changes.

Previously the column always showed **—** because `v_inventory_workspace` hardcoded `NULL::integer AS ebay_stock` since Phase 3B.

---

## Why it was `—` before

| Phase | Behavior |
|-------|----------|
| 3B | Workspace shipped with `ebay_stock` NULL placeholder |
| 7D | Cache table + Sync Channels preview populated |
| 7F | eBay qty push from Sync Channels only |
| **058** | Main table reads cache (this patch) |

Amazon was wired to the table early via `amazon_listings.fbm_quantity`. eBay cache existed but the workspace view was never joined.

---

## Data source

**Table:** `ebay_listing_inventory_cache` (Phase 7D)

**Join pattern:** Same confidence rules as `v_inventory_channel_sync_candidates`:

| `ebay_stock_source` | When | `ebay_stock` |
|---------------------|------|--------------|
| `variant_cache` | Variant-level cache row with `current_qty` | Cached qty (including **0**) |
| `single_sku_cache` | Product-level cache, single-SKU / non-group listing | Cached qty |
| `missing_cache` | Active listing, cache not populated | NULL → **—** |
| `unsupported_variation` | Multi-variant `ebay_item_group_key`, no variant cache | NULL → **—** |
| `ended_listing` | Ended / out_of_stock / withdrawn / inactive | NULL → **—** |
| `no_mapping` | Not listed on eBay | NULL → **—** |

**Stale:** `ebay_stock_is_stale = true` when cache age &gt; 24 hours (matches Amazon stale window).

**Metadata columns:** `ebay_stock_source`, `ebay_stock_cached_at`, `ebay_stock_is_stale`, `ebay_stock_tooltip`

---

## UI behavior

- Shows numeric qty when cache is confident (including **0**)
- **—** when unknown / unsupported / ended / unmapped
- **Stale** badge + “Refresh cache →” opens **Sync Channels** (no auto-refresh)
- Tooltips per state (missing, stale, unsupported, ended, no mapping)
- KK vs eBay diff indicator unchanged (amber delta when mismatch)

---

## How to refresh cache

1. **Inventory → Sync Channels**
2. **Refresh eBay Cache** (eBay Sync Readiness section)
3. Hard refresh Inventory table if needed

Does **not** push qty to eBay — cache read only.

---

## Known limitations

- **Variation group listings** without per-variant cache rows still show **—** (by design — avoids misleading shared product-level qty)
- **Group offer lookup 400** during cache refresh (operational) — those products stay `missing_cache` / `unsupported_variation`
- **Ended listings** never show cached qty in this column (even if stale cache exists)
- Cache is observational — not inventory truth; KK on-hand remains authoritative
- No scheduled cache refresh; admin-triggered only

---

## Files

| File | Change |
|------|--------|
| `supabase/migrations/20261022_inventory_phase058_ebay_workspace_column_cache.sql` | Workspace view cache join |
| `js/admin/inventory/api/inventoryApi.js` | Select new columns |
| `js/admin/inventory/services/mapWorkspaceRow.js` | Map ebay metadata |
| `js/admin/inventory/renderers/renderInventoryTable.js` | eBay cell + tooltips |
| `js/admin/inventory/events.js` | `open-sync-channels` action |
| `scripts/verify-inventory-ebay-column-cache.mjs` | Verification |

---

## Verification

```bash
node scripts/verify-inventory-ebay-column-cache.mjs
node scripts/verify-inventory-issue-view-safety.mjs
node scripts/verify-inventory-phase10y-final-stabilization.mjs
```

Apply migration:

```bash
npx supabase db query --linked -f supabase/migrations/20261022_inventory_phase058_ebay_workspace_column_cache.sql
```

---

## Pool safety

- Workspace joins only: `ebay_listing_inventory_cache`, existing product/variant/reservation CTEs
- Does **not** join `v_inventory_channel_sync_candidates`, issue snapshots, returns/dashboard views
- Does **not** reintroduce browser snapshot refresh RPCs
