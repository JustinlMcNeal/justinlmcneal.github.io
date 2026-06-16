# Phase 7D — eBay Quantity Cache + Sync Readiness (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 7C (Amazon FBM quantity sync)  
**Next:** Phase 7E — eBay ended-listing relist assist, then Phase 7F — eBay quantity push

---

## Summary

Added an **observational eBay listing inventory cache** and admin **read-only cache refresh** from eBay Inventory API. Updated `v_inventory_channel_sync_candidates` to use cached qty/status and distinguish `qty_cache_missing`, `unsupported_variation`, and `ended_needs_relist`. **No eBay quantity push, relist, or stock mutations** in this phase.

---

## Current eBay data audit

| Area | Finding |
|------|---------|
| Admin UI | `pages/admin/ebay-listings.html` + `js/admin/ebayListings/*` (no `js/admin/ebay/*`) |
| Listing identity | **Product-level** on `products`: `ebay_listing_id`, `ebay_sku`, `ebay_offer_id`, `ebay_status`, `ebay_item_group_key` |
| No `ebay_listings` table | Unlike Amazon; no per-channel listing table today |
| Qty push (existing) | `ebay-manage-listing` → `bulk_update` / `update_item` (admin manual only — **not** used in 7D) |
| Qty read | `GET /inventory_item/{sku}` + `GET /offer?sku=` (same as reconcile) |
| Ended tracking | Local `ebay_status = ended`; reconcile detects inactive offers |
| Variations | Group listings via `ebay_item_group_key`; per-variant SKUs `{code}-{suffix}` |
| Phase 7A gap | `ebay_current_qty` was always NULL → all active listings showed `qty_unknown` |

---

## Cache schema

**Table:** `ebay_listing_inventory_cache`  
**Migration:** `20260906_inventory_phase7d_ebay_cache.sql`

| Column | Purpose |
|--------|---------|
| `product_id` | KK product UUID |
| `variant_id` | Nullable; set when variant SKU matched |
| `ebay_item_id` | Listing id from offer |
| `ebay_sku` | eBay inventory SKU |
| `listing_status` | Normalized: `active`, `ended`, etc. |
| `current_qty` | Sellable qty (offer qty preferred, else inventory item qty) |
| `available_qty` | Same as current for now |
| `listing_url` | `https://www.ebay.com/itm/{id}` when known |
| `last_synced_at` | Cache refresh timestamp |
| `raw_status` / `raw_payload_json` | Offer/inventory snapshot |

**Unique:** `(product_id, ebay_sku)` — observational only; not inventory truth.

---

## Cache refresh behavior

**Edge function:** `sync-ebay-listing-inventory-cache`

- Admin-only (`requireAdminJson`)
- Reads products with `ebay_listing_id` or `ebay_offer_id` (excludes `not_listed`)
- Per product: `GET offer` + `GET inventory_item` (group listings fetch all group offers)
- Upserts `ebay_listing_inventory_cache`
- Logs to `inventory_channel_sync_runs` (`channel=ebay`, `mode=cache_refresh`) + `inventory_channel_sync_results`
- **No** `bulk_update`, publish, withdraw, relist
- **No** `product_variants.stock` or reservation changes
- Default limit 25 products/run; 220ms delay between products

**UI:** Inventory → Sync Channels → **Refresh eBay Cache** (with confirmation)

---

## Sync candidate view changes

**View:** `v_inventory_channel_sync_candidates` (recreated in 7D migration)

| Field | Source |
|-------|--------|
| `ebay_current_qty` | `ebay_listing_inventory_cache.current_qty` (lateral join; variant-specific preferred) |
| `ebay_listing_status` | `COALESCE(cache.listing_status, products.ebay_status)` |

**`ebay_sync_action` values:**

| Action | Meaning |
|--------|---------|
| `qty_cache_missing` | Active listing, no cached qty yet (replaces `qty_unknown`) |
| `update_qty` | Cached qty known and ≠ KK available |
| `ended_needs_relist` | Ended / out_of_stock / withdrawn / inactive |
| `unsupported_variation` | Multi-variant product with group key but no variant-level cache row |
| `missing_mapping` | Offer id without listing id |
| `no_active_listing` | Not listed on eBay |
| `no_change` | Cached qty matches available |
| `unavailable` | Fallback |

---

## Dry-run results (post-migration, pre-cache refresh)

| eBay action | Variants |
|-------------|----------|
| `qty_cache_missing` | **12** (was 52 as `qty_unknown` in 7A — 40 reclassified) |
| `unsupported_variation` | **40** (multi-variant group listings) |
| `ended_needs_relist` | **22** |
| `no_active_listing` | 132 |
| Cache table rows | **0** (until admin runs Refresh eBay Cache) |

After **Refresh eBay Cache**, expect `qty_cache_missing` to drop and `update_qty` / `no_change` to appear where mappings are confident.

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260906_inventory_phase7d_ebay_cache.sql` | Cache table + view update |
| `supabase/functions/sync-ebay-listing-inventory-cache/index.ts` | Admin cache refresh |
| `supabase/functions/_shared/inventoryEbayCacheUtils.ts` | eBay read + upsert helpers |
| `js/admin/inventory/api/ebayCacheRefreshApi.js` | Client invoke |
| `js/admin/inventory/ui/syncEbayReadiness.js` | Modal eBay section |
| `scripts/verify-inventory-phase7d-ebay-cache-readiness.mjs` | Verification |

---

## Files changed

| File | Change |
|------|--------|
| `js/admin/inventory/api/channelSyncPreviewApi.js` | eBay readiness counts + cache row count |
| `js/admin/inventory/ui/syncDryRunModal.js` | eBay readiness section wired |
| `supabase/functions/_shared/inventoryAmazonSyncUtils.ts` | `cache_refresh` run mode |
| `scripts/preview-inventory-channel-sync.mjs` | `qty_cache_missing` bucket |

---

## eBay ended-listing plan (Phase 7E — complete)

See [019_phase_7e_ebay_relist_assist.md](./019_phase_7e_ebay_relist_assist.md).

- `ended_needs_relist` (22 variants) → relist assist in Sync Channels modal
- `ready_to_relist`: 2 (available > 0, single-SKU, category + price present)
- No auto-relist from Inventory; draft/publish via KK eBay Listings admin only

---

## Limitations

- Product-level eBay mapping; variant group listings need per-SKU cache rows
- `unsupported_variation` requires manual review or improved variant SKU matching
- Cache refresh requires connected eBay OAuth (`marketplace_tokens`)
- No scheduled refresh; admin-triggered only
- eBay quantity push delivered in Phase 7F — see [020_phase_7f_ebay_quantity_sync.md](./020_phase_7f_ebay_quantity_sync.md)

---

## Verification

```bash
node scripts/verify-inventory-phase7d-ebay-cache-readiness.mjs
```

**Result:** PASS — cache table exists, view uses `qty_cache_missing`, edge function read-only, Amazon 7C intact, no stock/reservation mutations.

**Live cache refresh:** Not run in automated verify (requires admin session + eBay OAuth). Use **Refresh eBay Cache** in Inventory Sync modal.

---

## Recommended next phase

**Phase 7F — eBay quantity sync push** delivered in [020_phase_7f_ebay_quantity_sync.md](./020_phase_7f_ebay_quantity_sync.md). Relist assist in [019](./019_phase_7e_ebay_relist_assist.md).
