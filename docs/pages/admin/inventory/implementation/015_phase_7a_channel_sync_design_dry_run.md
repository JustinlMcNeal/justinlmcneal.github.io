# Phase 7A — Channel Quantity Sync Design + Dry-Run Planner (Complete)

**Status:** Complete (read-only design — no channel pushes)  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6E (fulfillment finalize)  
**Phase 7D complete** — eBay qty cache + sync readiness. See [018_phase_7d_ebay_quantity_cache_readiness.md](./018_phase_7d_ebay_quantity_cache_readiness.md).

**Next:** Phase 7E — eBay relist assist, then Phase 7F — eBay quantity push.

---

## Summary

Phase 7A audits KK / Amazon / eBay quantity flows, adds a **read-only sync candidate view**, **CLI dry-run script**, and **Inventory admin dry-run modal**. No channel API writes, no stock/reservation changes.

**Target sellable quantity (all channels):** `available = on_hand − reserved`

---

## Current quantity flows (audit)

### KK Store

| Area | Current behavior | Phase 7B need |
|------|------------------|---------------|
| Product page | `js/product/api.js` → `product_variants.stock` (on-hand) | Display/check **available** |
| Checkout UI | `js/checkout/renderItems.js` → raw `stock` | Show back-order from available |
| Checkout validation | `create-checkout-session` → `stock <= 0` back-order flag | Validate against **available** |
| Admin inventory | `v_inventory_workspace` → reserved from active reservations | Already correct |
| Order lifecycle | reserve_only → finalize on ship | Unchanged |

**Risk:** Storefront and checkout treat **on-hand** as sellable while **10 units** are reserved post-6D cutover → customers may order stock already committed.

### Amazon

| Area | Details |
|------|---------|
| Table | `amazon_listings` — `fbm_quantity`, `fulfillment_channel`, `fba_fulfillable_quantity`, `listing_status` |
| Mapping | `amazon_listing_mappings.kk_variant_id` → variant |
| Cache | `fbm_quantity` synced via SP-API import (`last_synced_at`) |
| Push | `amazon-bulk-patch-listings` → `patchListingsItem` (admin UI only today) |
| Auth | `amazon-auth-status` edge function |
| FBA/AFN | Detect via `fulfillment_channel` / FBA qty — **exclude from local sync** |

### eBay

| Area | Details |
|------|---------|
| Storage | `products.ebay_listing_id`, `ebay_offer_id`, `ebay_status`, `ebay_sku` (product-level) |
| Qty cache | **Not stored** — `v_inventory_workspace.ebay_stock` is always NULL |
| Push | `ebay-manage-listing` from admin push modal |
| Ended listings | `ebay_status` in `ended`, `out_of_stock` — **relist required** (not auto) |
| Mapping | Variant rows inherit product eBay fields |

---

## Sync candidate view

**`v_inventory_channel_sync_candidates`** (migration `20260903_inventory_phase7a_channel_sync_candidates.sql`)

Per active variant:

| Field | Source |
|-------|--------|
| `available_qty` | `on_hand − reserved` (non-shadow) |
| `kk_current_qty` | `product_variants.stock` |
| `kk_target_qty` | `available_qty` |
| `amazon_current_qty` | `amazon_listings.fbm_quantity` |
| `ebay_current_qty` | NULL (unknown — not invented) |

### Sync action enums

**KK:** `align_to_available` | `no_change` | `negative_available`

**Amazon:** `update_qty` | `inactive_can_update` | `afn_skip` | `missing_mapping` | `no_change`

**eBay:** `update_qty` | `no_active_listing` | `ended_needs_relist` | `missing_mapping` | `qty_unknown` | `no_change` | `unavailable`

---

## Dry-run results (linked prod, 2026-06-09)

```bash
node scripts/preview-inventory-channel-sync.mjs
```

| Metric | Count |
|--------|------:|
| Variants considered | 203 |
| KK `align_to_available` | 8 |
| KK `no_change` | 194 |
| KK negative available | 1 |
| Amazon FBM `update_qty` | 4 |
| Amazon AFN skip | 0 |
| Amazon missing mapping | 193 |
| eBay `ended_needs_relist` | 22 |
| eBay `qty_unknown` | 52 |
| Zero-qty push candidates | 4 |

**Read-only confirmed** — no stock/reservation mutations.

---

## Files created / changed

| File | Change |
|------|--------|
| `supabase/migrations/20260903_inventory_phase7a_channel_sync_candidates.sql` | **Created** — view |
| `scripts/preview-inventory-channel-sync.mjs` | **Created** — CLI dry-run |
| `scripts/verify-inventory-phase7a-channel-sync-design.mjs` | **Created** |
| `js/admin/inventory/api/channelSyncPreviewApi.js` | **Created** |
| `js/admin/inventory/ui/syncDryRunModal.js` | **Created** |
| `js/admin/inventory/dom.js` | Modal mount |
| `js/admin/inventory/events.js` | Sync Channels → dry-run modal |
| `pages/admin/inventory.html` | Modal mount div |

**Not changed:** Stripe webhook, Shippo, parcel, CPI, Amazon/eBay push functions, reservation/finalize logic.

---

## Inventory UI

**Sync Channels** button opens **Dry Run / Preview Only** modal with:

- Ready / KK / Amazon / eBay / AFN skip / ended / qty unknown counts
- Sample candidate rows
- Explicit “no quantities will be pushed” banner

---

## Channel-specific risks

| Channel | Risk |
|---------|------|
| **KK** | Storefront oversells reserved units until 7B |
| **Amazon** | Pushing to AFN listings would corrupt FBA inventory — view flags `afn_skip` |
| **Amazon** | Inactive/suppressed listings may need activate before qty patch |
| **eBay** | No qty cache → cannot safely push until read/cache in 7D |
| **eBay** | 22 ended listings need **relist workflow** (7E), not qty update |
| **All** | Product-level eBay mapping applies to all variants of a product |
| **All** | No channel buffers — same `available` everywhere |

---

## Recommended Phase 7B–7F split

| Phase | Scope |
|-------|--------|
| **7B** | KK storefront + checkout read **available** (view/RPC or client calc) |
| **7C** | Amazon FBM `patchListingsItem` qty from sync candidates (idempotent) |
| **7D** | eBay active listing qty sync (requires qty cache from Inventory API) |
| **7E** | eBay ended listing relist assist (separate from qty sync) |
| **7F** | Sync audit log, retry, rollback |

**Start with 7B** — fixes oversell risk on KK before external channel pushes.

---

## Verification

```bash
node scripts/verify-inventory-phase7a-channel-sync-design.mjs
node scripts/preview-inventory-channel-sync.mjs
```

**Result:** PASS — view exists, no mutations, page loads, no push APIs in webhooks.

---

## eBay ended-listing plan (7E preview)

1. Detect `ebay_sync_action = ended_needs_relist` in sync candidates
2. Do **not** auto-relist in 7D qty sync
3. Future: admin workflow to relist with current `available` qty

---

## Amazon AFN/FBA exclusion plan (7C preview)

Sync candidate view sets `amazon_sync_action = afn_skip` when:

- `fulfillment_channel` contains AMAZON / AFN, or
- FBA fulfillable > 0 and FBM qty ≤ 0

Only **FBM** rows with `update_qty` proceed to patch in 7C.
