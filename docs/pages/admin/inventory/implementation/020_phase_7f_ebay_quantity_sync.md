# Phase 7F — eBay Active-Listing Quantity Sync Push (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 7D (eBay cache) + Phase 7E (relist assist)  
**Next:** Phase 8 — Issue workflows

---

## Summary

Implemented **admin-only eBay quantity sync** for active, cached, confidently mapped listings. Mirrors Amazon 7C safety: preview first, live push gated by env flag, per-row audit logs, cache update on success. **No stock/reservation changes, no relist, no ended-listing updates, no variation-group sync.**

---

## eBay API path audit

| Area | Finding |
|------|---------|
| Existing path | `ebay-manage-listing` → `bulk_update` → `POST /sell/inventory/v1/bulk_update_price_quantity` |
| Safest qty-only update | Same bulk endpoint with `shipToLocationAvailability.quantity` + `offers[].availableQuantity` when `offerId` known |
| Identifiers required | **SKU** (inventory item), **offerId**, marketplace `EBAY_US` (implicit in token) |
| Inventory vs offer | Both updated: inventory item ship-to qty + offer available qty (matches existing `bulk_update` pattern) |
| Publish after qty change | **Not required** for active published offers |
| Active vs ended | Preview validates via `GET /offer/{offerId}` + `isActiveOffer()`; ended offers fail with `ended_listing` |
| Rate limiting | 220ms delay between rows (`EBAY_CACHE_DELAY_MS`), max 25 default / 50 hard cap per run |

---

## Eligibility rules

From `v_inventory_channel_sync_candidates` where `ebay_sync_action = 'update_qty'`, plus strict filters in `loadEbaySyncCandidates()`:

| Rule | Requirement |
|------|-------------|
| Action | `update_qty` only |
| Cache | `ebay_current_qty IS NOT NULL` |
| Mapping | `ebay_offer_id` + `ebay_listing_id` + resolvable `ebay_sku` |
| Status | Not `ended`, `out_of_stock`, `withdrawn`, `inactive` |
| Variations | Excludes multi-variant products with `ebay_item_group_key` |
| Target qty | `max(available, 0)` — never negative |

**Excluded:** `ended_needs_relist`, `unsupported_variation`, `qty_cache_missing`, `no_active_listing`, unmapped offers.

---

## Sync logging

Reuses Phase 7C tables:

| Table | Usage |
|-------|-------|
| `inventory_channel_sync_runs` | `channel=ebay`, `mode=dry_run` (preview) or `push` |
| `inventory_channel_sync_results` | `action=set_quantity`, per-row status + eBay IDs |

**Migration:** `20260908_inventory_phase7f_ebay_quantity_sync.sql` adds `ebay_offer_id`, `ebay_listing_id` columns to results.

On live success: updates `ebay_listing_inventory_cache.current_qty` + `last_synced_at` only (not stock).

---

## Edge function

**`sync-ebay-inventory-quantity`** — deployed

| Mode | Behavior |
|------|----------|
| `preview: true` | Validates eBay token + GET offer active check; **no** `bulk_update_price_quantity` |
| Live push | Requires `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` |

Payload: `{ preview?, variantIds?, productIds?, limit? }` (default limit 25, max 50).

---

## UI behavior

Inventory → **Sync Channels** modal:

1. **eBay Sync Readiness** — cache refresh (7D)
2. **eBay Active Quantity Sync** — Validate eBay Qty / Sync eBay Qty (7F)
3. **eBay Ended-Listing Relist Assist** — unchanged (7E)

Live push confirmation: *"This updates active eBay listing quantities only. It will not relist ended listings."*

After successful push: refreshes preview + push candidate lists.

---

## Candidate counts (linked DB, pre-cache refresh)

| Metric | Count |
|--------|-------|
| Raw `update_qty` in sync view | **0** |
| Eligible push (strict filter) | **0** |
| `qty_cache_missing` | 12 |
| `ended_needs_relist` | 22 |
| `unsupported_variation` | 40 |

**Expected:** Zero push candidates until **Refresh eBay Cache** populates qty for active listings with drift. Empty-state UI and preview are verified; eligibility rules were not loosened.

---

## Files

| Path | Role |
|------|------|
| `supabase/migrations/20260908_inventory_phase7f_ebay_quantity_sync.sql` | eBay columns on sync results |
| `supabase/functions/_shared/inventoryEbaySyncUtils.ts` | Candidates + patch logic |
| `supabase/functions/sync-ebay-inventory-quantity/index.ts` | Admin edge function |
| `js/admin/inventory/api/ebaySyncPushApi.js` | Client API |
| `js/admin/inventory/api/channelSyncPreviewApi.js` | `fetchEbayPushCandidates()` |
| `js/admin/inventory/ui/syncEbayQuantityPush.js` | Push section UI |
| `js/admin/inventory/ui/syncDryRunModal.js` | Modal wiring |
| `js/admin/inventory/ui/syncEbayReadiness.js` | Removed disabled push button |
| `scripts/verify-inventory-phase7f-ebay-quantity-sync.mjs` | Verification |

---

## Verification

```bash
node scripts/verify-inventory-phase7f-ebay-quantity-sync.mjs
```

**Result:** PASS

**Live push executed:** No — verify uses source/DB checks only; live requires `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` + admin session + eBay OAuth.

---

## Limitations

- Product-level eBay mapping; variation groups excluded
- Requires cache refresh before `update_qty` candidates appear
- No scheduled sync; admin-triggered only
- No Sync All Channels
- Cache update on success only; failures leave cache unchanged

---

## Recommended next phase

**Phase 8 — Issue workflows** — actionable resolution paths for unmapped lines, negative available, channel drift alerts. Optional follow-up: auto-open KK Listings from relist deep link, scheduled cache refresh.
