# 062 — Marketplace reservation finalize on ship

**Status:** Live (RPC applied; backfill run Jul 29, 2026; `shippo-webhook` redeployed Jul 29, 2026)  
**Migration:** `supabase/migrations/20261111_inventory_marketplace_ship_finalize.sql`  
**Verify:** `node scripts/verify-inventory-marketplace-ship-finalize.mjs`  
**Backfill:** `node scripts/backfill-marketplace-ship-finalize.mjs --dry-run|--apply`

## Behavior

1. Marketplace sale → sale hold (`status=reserved`) → **available** drops.
2. Shippo `TRANSIT` / `DELIVERED` (same as KK) → `finalize_kk_order_reservations` → **on_hand** decrements, reservation `finalized`.
3. Admin Save on Fulfillment when status moves into `shipped`/`delivered` also calls the same RPC (no marketplace skip).

`available` usually stays the same across finalize (`on_hand` and `reserved` both drop by qty).

## Code paths

| Layer | Change |
|-------|--------|
| RPC | Channel resolved from session prefix (`ebay%` / `amazon%` / else `kk`); selects matching `inventory_reservations.channel`; clamps stock at 0 |
| Edge | `finalizeKkReservations.ts` no longer short-circuits marketplace |
| Admin | `js/admin/lineItemsOrders/api.js` finalize no longer skips marketplace |
| Webhook | `shippo-webhook` already called finalize; needs redeploy to ship helper log/behavior if edge bundle is stale |

## Deploy note

RPC applied via DB pooler. `shippo-webhook` redeployed to `yxdzvzscufkvewecvagq` (includes marketplace-aware `finalizeKkReservations.ts`). New Shippo `TRANSIT` / `DELIVERED` events auto-finalize eBay/Amazon holds.

## Backfill (Jul 29, 2026)

- Finalized 10 shipped/delivered marketplace holds (8 first pass + 2 zero-stock clamp clears).
- Left reserved: label-not-yet-shipped holds (e.g. Bronze `ebay_api_17-14946-82010` still `label_purchased`).
