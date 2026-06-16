# Phase 7B — KK Storefront + Checkout Available-Stock Alignment (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 7A (channel sync dry-run)  
**Next:** Phase 7C — Amazon FBM quantity sync push

---

## Summary

KK customer-facing paths now use **available stock** (`on_hand − reserved`) instead of raw `product_variants.stock`. Cart and `create-checkout-session` block checkout when requested quantity exceeds available. MTO products (`shipping_status = mto`) remain sellable regardless of stock.

**Sellable formula:** `available = on_hand − SUM(reserved WHERE status='reserved' AND is_shadow=false)`

---

## Files audited (stock read paths)

| Area | File | Previous read | Phase 7B |
|------|------|---------------|----------|
| Product detail API | `js/product/api.js` | `product_variants.stock` | Enriched via `v_kk_variant_available_stock` |
| Catalog/home cards | `js/home/api.js` | `product_variants.stock` | Same enrichment on variant map |
| Product UI badges | `js/product/render.js` | `variant.stock` | Uses enriched `stock` (= available_display) |
| Product page controls | `js/product/index.js` | No cap | OOS disable + qty cap vs available |
| Qty stepper | `js/product/cart.js` | Unlimited + | `maxQty` cap |
| Catalog cards | `js/catalog/renderCard.js` | `v.stock` | Inherited from home API enrichment |
| Home cards | `js/shared/components/productCardHome.js` | `v.stock` | Inherited |
| Swipe-to-add | `js/shared/swipeToAdd.js` | `v.stock` | Inherited |
| Checkout display | `js/checkout/renderItems.js` | `product_variants.stock` | View + validation UI |
| Checkout pay flow | `js/checkout/index.js` | No server-side pre-check | Client validation + pay disable |
| Stripe session | `supabase/functions/create-checkout-session/index.ts` | Raw stock, back-order flag only | Hard block on insufficient available |
| Admin inventory | `js/admin/inventory/*` | `v_inventory_workspace` | **Unchanged** |
| Phase 7A dry-run | `v_inventory_channel_sync_candidates` | available | **Unchanged** |

**Not changed (out of scope):** Amazon/eBay admin qty, parcel receive, CPI, manual adjust, fulfillment finalize, channel sync writes.

---

## Files created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260904_inventory_phase7b_kk_available_stock.sql` | `v_kk_variant_available_stock` view + grants |
| `js/shared/kkAvailableStock.js` | Enrichment + cart validation helpers |
| `scripts/verify-inventory-phase7b-kk-available-stock.mjs` | Read-only verification |

---

## Files changed

| File | Change |
|------|--------|
| `js/product/api.js` | Enrich variants after fetch |
| `js/home/api.js` | Enrich catalog variant map |
| `js/product/render.js` | OOS badge (not backorder) when available ≤ 0 |
| `js/product/index.js` | Disable add-to-cart, cap qty, validate on add |
| `js/product/cart.js` | Optional `maxQty` on qty stepper |
| `js/checkout/renderItems.js` | Available stock fetch, OOS/qty errors, cap + |
| `js/checkout/index.js` | Pre-Stripe validation; disable pay when invalid |
| `supabase/functions/create-checkout-session/index.ts` | Server-side available validation (400 on fail) |

---

## View: `v_kk_variant_available_stock`

| Column | Source |
|--------|--------|
| `on_hand` | `product_variants.stock` |
| `reserved` | Active non-shadow `inventory_reservations` (`status=reserved`) |
| `available` | `on_hand − reserved` (may be negative) |
| `available_display` | `GREATEST(available, 0)` for customer UI |
| `is_available` | `available_display > 0` |
| `low_stock` | `available_display` in 1–3 |
| `updated_at` | Latest reservation `updated_at` for variant |

Grants: `anon`, `authenticated`, `service_role` (read-only).

---

## Customer-facing behavior

- Product pages show **Out of Stock** when available ≤ 0 (non-MTO); add-to-cart disabled.
- Low-stock badge when available 1–3 (unchanged threshold, now reservation-aware).
- Catalog/home cards filter/disable using enriched variant `stock`.
- Checkout shows per-line OOS or “only N available” messages; pay buttons disabled.
- MTO products: made-to-order messaging unchanged; no stock gate.

---

## Checkout validation behavior

1. **Browser:** `validateCartAvailability()` before Stripe invoke; pay buttons disabled on render when invalid.
2. **Edge function:** Queries `v_kk_variant_available_stock` per line; returns **400** if `qty > available` or `available ≤ 0` (non-MTO).
3. **Reservation timing unchanged:** reservation still created on Stripe webhook success — not at session creation.

---

## Race condition (documented limitation)

| Step | When |
|------|------|
| Stock validated | `create-checkout-session` (before Stripe redirect) |
| Reservation created | Stripe webhook after payment |

Between validation and payment, another customer may purchase the same unit. Acceptable at current volume. **Future:** short-lived checkout holds (not implemented in 7B).

---

## Admin / regression checks

| Check | Result |
|-------|--------|
| Inventory dashboard KPIs/workspace | Unchanged views |
| Phase 7A dry-run modal | Still loads |
| Manual adjustment | No code changes |
| Fulfillment finalize (6E) | No code changes |
| Channel sync writes | None |
| CPI / parcel | None |

---

## Verification

```bash
node scripts/verify-inventory-phase7b-kk-available-stock.mjs
```

**Result:** PASS — view exists, reserved samples show `available < on_hand`, source wiring confirmed, no DB mutations, inventory page + Sync Channels control present.

**Deployed:** `create-checkout-session` edge function (2026-06-09).

---

## Recommended next phase

**Phase 7C — Amazon FBM quantity sync push** using `v_inventory_channel_sync_candidates` (`amazon_sync_action = update_qty`), respecting AFN skip rules from 7A.
