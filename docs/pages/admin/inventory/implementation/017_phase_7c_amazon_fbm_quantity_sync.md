# Phase 7C — Amazon FBM Quantity Sync Push (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 7B (KK available-stock alignment)  
**Next:** Phase 7D — eBay quantity sync (when qty cache exists)

---

## Summary

Inventory admin can push **Amazon FBM quantity = KK available** (`on_hand − reserved`) for mapped listings with `amazon_sync_action = update_qty`. Uses existing SP-API `patchListingsItem` stack; logs runs/results; no KK stock or reservation mutations.

**Live push gate:** `AMAZON_ENABLE_LIVE_PATCH=true` on edge functions. **Preview** mode validates via SP-API without writing to Amazon or updating local cache.

---

## Files audited (Amazon quantity path)

| Area | File | Finding |
|------|------|---------|
| Bulk patch | `supabase/functions/amazon-bulk-patch-listings/index.ts` | Sequential `patchListingsItem`; max 50; admin-only |
| Single patch | `supabase/functions/amazon-patch-listing/index.ts` | Same patch utils; inactive offer-restore path |
| Patch orchestration | `supabase/functions/_shared/amazonBulkPatchUtils.ts` | `set_quantity`, `match_kk_stock` (on-hand — **not** used for 7C) |
| SP-API patch | `supabase/functions/_shared/amazonListingPatchUtils.ts` | `fulfillment_availability` replace; FBA blocked |
| Local cache update | `applyLocalListingPatchUpdate()` | Updates `amazon_listings.fbm_quantity` after live success |
| Admin UI | `js/admin/amazon/bulkPatch.js`, `listingPatch.js` | Manual bulk/single push (unchanged) |
| Sync candidates | `v_inventory_channel_sync_candidates` | Phase 7A dry-run view |
| Catalog sync log | `amazon_sync_runs` | Import-only — separate from channel qty sync |

---

## Amazon push path used (Phase 7C)

**New edge function:** `sync-amazon-inventory-quantity`

Flow:

1. `requireAdminJson()` — admin JWT required
2. Load candidates from `v_inventory_channel_sync_candidates` where `amazon_sync_action = 'update_qty'`
3. `target_qty = available_qty_nonneg` (clamp negative available → 0)
4. `processPerListingQuantityPatches()` → `set_quantity` per listing via SP-API
5. On live success → `applyLocalListingPatchUpdate()` (Amazon cache only)
6. Write `inventory_channel_sync_runs` + `inventory_channel_sync_results`

**Identifiers required:** `amazon_listing_id`, `seller_sku`, `marketplace_id`, `product_type`, `seller_account_id` (from `v_amazon_listing_workspace`).

**Rate limit:** 220ms delay between listings (same as bulk patch); max 25 default / 50 hard cap per run.

---

## Sync eligibility rules

| Rule | Behavior |
|------|----------|
| `amazon_sync_action = 'update_qty'` | Included |
| `afn_skip`, `missing_mapping`, `no_change`, `inactive_can_update` | Excluded (7C — inactive needs separate workflow) |
| AFN/FBA | Excluded via view (`amazon_is_afn`) |
| Missing seller SKU | Excluded |
| Negative available | Push **0** via `available_qty_nonneg` |
| eBay | Not called |

---

## Logging schema

**Migration:** `20260905_inventory_phase7c_channel_sync_logs.sql`

| Table | Purpose |
|-------|---------|
| `inventory_channel_sync_runs` | Run header: channel, mode (`dry_run`/`push`), status, counts |
| `inventory_channel_sync_results` | Per-variant/listing: previous/target qty, status, errors |

Logs do not affect stock truth. Failed pushes do not change `product_variants.stock` or reservations.

---

## UI behavior

**Sync Channels modal** (`js/admin/inventory/ui/syncDryRunModal.js`):

- Dry-run summary (unchanged from 7A)
- Amazon FBM section: candidate count, sample table (Amazon now → target available)
- **Validate (preview)** — SP-API validation, logs as `dry_run`
- **Sync Amazon FBM** — confirmation dialog, live push (when env gate open)
- Post-push: results table, toast, refresh inventory + preview

No “Sync All Channels” button.

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260905_inventory_phase7c_channel_sync_logs.sql` | Sync run/result tables |
| `supabase/functions/sync-amazon-inventory-quantity/index.ts` | Admin edge function |
| `supabase/functions/_shared/inventoryAmazonSyncUtils.ts` | Candidates + logging helpers |
| `js/admin/inventory/api/amazonSyncPushApi.js` | Client invoke wrapper |
| `scripts/verify-inventory-phase7c-amazon-fbm-sync.mjs` | Verification |

---

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/amazonBulkPatchUtils.ts` | `processPerListingQuantityPatches()` |
| `js/admin/inventory/api/channelSyncPreviewApi.js` | `fetchAmazonPushCandidates()` |
| `js/admin/inventory/ui/syncDryRunModal.js` | Amazon push UI + results |
| `js/admin/inventory/events.js` | Updated Sync Channels tooltip |

---

## Verification

```bash
node scripts/verify-inventory-phase7c-amazon-fbm-sync.mjs
```

**Result:** PASS  
**Eligible FBM `update_qty` candidates:** 4 (as of 2026-06-09)  
**Amazon AFN skip:** present in view  
**Missing mapping:** 193 variants (skipped)

---

## Live push status

**Not executed in automated verification** — requires admin session + `AMAZON_ENABLE_LIVE_PATCH=true` + connected Amazon OAuth.

**Preview mode** is available from Inventory → Sync Channels → **Validate (preview)** without live patch env.

---

## Known limitations

- `inactive_can_update` listings not pushed in 7C (use Amazon admin inactive fix flow first)
- No scheduled/automatic sync
- No eBay push or relist
- No channel buffers
- Max 25 listings per UI run (50 hard cap in API)
- SP-API async acceptance — local cache updated on accepted submission (same as existing bulk patch)

---

## Recommended next phase

**Phase 7D — eBay quantity sync** once eBay qty cache is populated, or **Phase 7E — eBay ended-listing relist assist** per 7A plan.
