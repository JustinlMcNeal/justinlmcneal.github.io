# Phase 8A — Inventory Issue Workflows Design + Action Routing (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 7F (eBay quantity sync)  
**Next:** Phase 8C complete — [023_phase_8c_mapping_assist_wizards.md](./023_phase_8c_mapping_assist_wizards.md). Phase 8D — reservation retry / eBay hints.

---

## Summary

Added an **issue action routing layer** so Inventory Issues are actionable: primary routes, read-only detail modal with samples, extended issue view for channel/sync gaps, and recent sync failure visibility in the Sync Channels modal. **No automatic fixes, no stock/reservation mutations, no channel API writes from issue actions.**

---

## Issue type audit

| Issue type | Severity | Source | Object | Auto-resolvable? | Primary route |
|------------|----------|--------|--------|------------------|---------------|
| `unmapped_order_line` | high | `v_inventory_unmapped_order_lines` | order line | No | Line Items Orders |
| `negative_stock` | critical | `product_variants.stock` | variant | No | Filter + Adjust Stock |
| `negative_available` | critical | `v_inventory_channel_sync_candidates` | variant | No | Filter inventory |
| `low_stock` | medium | `product_variants` | variant | No | Low stock tab |
| `missing_sku` | high | `product_variants` | variant | No | Products admin |
| `parcel_mapping_missing` | high | `parcel_import_item_mappings` | parcel row | No | Parcel Imports |
| `amazon_mapping_missing` | high | `amazon_listing_mappings` | variant | No | Amazon admin |
| `ebay_mapping_missing` | high | `products` | product | No | eBay Listings admin |
| `ebay_listing_ended` | medium | `products.ebay_status` | product | No | Sync modal → Relist Assist |
| `ebay_qty_cache_missing` | medium | sync candidates | variant | No | Sync modal (cache refresh) |
| `ebay_unsupported_variation` | medium | sync candidates | product | No | eBay Listings (manual) |
| `amazon_listing_inactive` | medium | `amazon_listings` | listing | No | Amazon admin |
| `channel_sync_failed` | high | `inventory_channel_sync_results` | sync run | No | Sync modal + detail samples |

**Note:** `amazon_listing_inactive` maps to user-facing “Amazon inactive”; view issue_type unchanged for compatibility.

---

## Action routing model

**File:** `js/admin/inventory/services/issueActions.js`

Each type defines: label, description, root cause, severity, source, primary/secondary actions, table filter hints, `implemented` + `safe` flags.

**Handlers:** `js/admin/inventory/services/issueActionHandlers.js` — navigation and existing flows only.

| Action type | Behavior |
|-------------|----------|
| `open_order_lines` | `/pages/admin/lineItemsOrders.html` |
| `open_parcel_imports` | Parcel Imports (approved, not received) |
| `open_amazon_admin` | `/pages/admin/amazon.html` |
| `open_ebay_admin` | `/pages/admin/ebay-listings.html` |
| `open_products_admin` | `/pages/admin/products.html` |
| `open_sync_modal` / `refresh_ebay_cache` / `open_relist_assist` | Opens Sync Channels modal |
| `open_manual_adjustment` | Filter negative rows + open Adjust on first match |
| `open_inventory_row` | Apply table/tab filters |
| `open_detail` | Issue detail modal |
| `no_action` | Manual review toast |

---

## UI changes

### Inventory Issues panel
- Primary action link per row (`data-inventory-issue-primary`)
- **Details** button opens drill-down modal
- Severity from action matrix when available

### Issue detail modal
- Read-only: severity, count, description, root cause, source
- Sample rows from `fetchIssueSamples(issueType)`
- Primary + secondary action buttons

### Alert pills (8A)
- Added: negative available, eBay cache missing, channel sync failed
- Sync-related alerts open Sync Channels modal

### Sync Channels modal
- **Recent Sync Failures** section (last failed `inventory_channel_sync_results` rows)

---

## Views / APIs

| Asset | Purpose |
|-------|---------|
| `v_inventory_issues` (extended) | +`negative_available`, `ebay_qty_cache_missing`, `ebay_unsupported_variation`, `channel_sync_failed` |
| `js/admin/inventory/api/issuesApi.js` | `fetchIssueSamples`, `fetchRecentSyncFailures`, `fetchRecentSyncFailureRows` |

**Migration:** `20260909_inventory_phase8a_issue_workflows.sql`

---

## Implemented vs future

| Status | Items |
|--------|-------|
| **Implemented** | All 13 issue types have primary routes; detail modal; samples API; sync failure excerpt |
| **Future** | Auto mapping, snooze/resolve table, deep-link to specific inventory row by variant id, scheduled sync |

`FUTURE_ISSUE_ROUTES` is empty — no “coming soon” placeholders without copy.

---

## Verification

```bash
node scripts/verify-inventory-phase8a-issue-workflows.mjs
```

**Result:** PASS (after migration applied)

- Issues panel action buttons in source
- Detail modal mount in HTML
- No channel API calls from issue handlers
- Stock/reservations unchanged
- Relist assist + sync modals intact

---

## Recommended next phase

**Phase 8B — Issue resolution tracking:** optional `inventory_issues` table with snooze/resolved state, or mapping-assist wizards for unmapped order lines and Amazon variant mapping (still manual confirm).
