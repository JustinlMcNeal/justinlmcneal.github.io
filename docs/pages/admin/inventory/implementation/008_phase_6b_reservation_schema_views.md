# Phase 6B — Reservation Schema + Read Views (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6A (order reservation design audit)  
**Page:** `pages/admin/inventory.html`

---

## Summary

Phase 6B adds the `inventory_reservations` table (empty) and updates read-only views so reserved/available math is future-compatible. **No stock behavior changed** — Stripe webhook, eBay/Amazon sync, parcel receive, manual adjust, and CPI paths are untouched. No reservation rows are inserted.

---

## Migration

**File:** `supabase/migrations/20260828_inventory_phase6b_reservations_read.sql`

### Table: `inventory_reservations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `channel` | text | `kk`, `ebay`, `amazon`, `manual`, `system` |
| `order_id` | text | External order key (e.g. session id) |
| `order_item_id` | text | Line item key |
| `variant_id` | uuid FK | → `product_variants` |
| `product_id` | uuid FK | → `products` |
| `quantity` | integer | Must be > 0 |
| `status` | text | `reserved`, `finalized`, `released`, `canceled`, `issue` |
| `reserve_ledger_id` | uuid | Nullable — future ledger link |
| `finalize_ledger_id` | uuid | Nullable |
| `release_ledger_id` | uuid | Nullable |
| `idempotency_key` | text | Unique when set |
| `source_reference` | text | Nullable |
| `notes` | text | Nullable |
| `created_at` / `updated_at` | timestamptz | `set_updated_at` trigger |

**Indexes:** `variant_id`, `product_id`, `channel`, `status`, `order_id`, unique partial on `idempotency_key`, composite `(variant_id, status)`.

**RLS:** Authenticated + service_role policies (same pattern as parcel imports). **No triggers that mutate stock.**

---

## Views updated / created

| View | Change |
|------|--------|
| `v_inventory_kpis` | `reserved_units` = SUM(`inventory_reservations.quantity` WHERE `status='reserved'`); `available_units` = `on_hand_units − reserved_units`; `inventory_issues` includes unmapped order lines |
| `v_inventory_workspace` | Per-variant `reserved` from active reservations; `available` = `on_hand − reserved` |
| `v_inventory_unmapped_order_lines` | **New** — order lines lacking `variant_id` for future reserve |
| `v_inventory_issues` | **New issue type** `unmapped_order_line` (high severity, source `orders`) |

---

## Reserved / available calculation

| Metric | Formula (Phase 6B+) |
|--------|---------------------|
| **On hand** | `product_variants.stock` (unchanged SOT) |
| **Reserved** | `SUM(inventory_reservations.quantity)` WHERE `status = 'reserved'` |
| **Available** | `on_hand − reserved` |

While `inventory_reservations` is empty:

- `reserved_units` = 0  
- `available_units` = `on_hand_units`  
- Workspace `reserved` = 0, `available` = `on_hand`  

**Displayed stock numbers do not change** after this migration.

Finalized, released, canceled, and issue statuses do **not** count as active reserved.

---

## Why no behavior changed

1. **No rows inserted** into `inventory_reservations`.
2. **`product_variants.stock` untouched** — no backfill of historical paid orders.
3. **No webhook / sync / RPC changes** — Stripe still deducts at payment; eBay/Amazon import only.
4. **No write UI** — no reserve/finalize/release buttons.
5. Views are **read-only** — they derive counts from existing data plus the empty reservation table.

---

## Unmapped order line view

**View:** `v_inventory_unmapped_order_lines`

Includes `line_items_raw` rows where:

- `variant_id IS NULL`
- Order not fully refunded (`refund_status <> 'full'`)
- Shipment not cancelled (`label_status <> 'cancelled'`)

| Field | Source |
|-------|--------|
| `source_channel` | Session prefix: `ebay_*` → ebay, `amazon_*` → amazon, else kk |
| `source_order_id` | `stripe_checkout_session_id` |
| `source_order_item_id` | `stripe_line_item_id` |
| `sku` | `line_items_raw.product_id` (product code or seller SKU) |
| `listing_id` | Amazon ASIN via `amazon_listings.seller_sku` join |
| `ebay_item_id` | **Always NULL** — not stored on `line_items_raw` |
| `title` | `product_name` |
| `fulfillment_status` | `fulfillment_shipments.label_status` |
| `paid_status` | `orders_raw.refund_status` |
| `reason` | See below |
| `recommended_action` | Human-readable next step |

### Reason codes

| Reason | Detection |
|--------|-----------|
| `afn_skip` | Amazon + `carrier='Amazon'` + service ILIKE `%Fulfilled by Amazon%` |
| `missing_sku` | Empty `product_id` |
| `unknown_mapping` | Amazon line, `product_id` not in `products.code` |
| `fuzzy_match_only` | eBay line with product code match but no `variant_id` |
| `missing_variant_id` | All other KK/Amazon mapped lines without `variant_id` |

**Issues count excludes `afn_skip`** — FBA lines are informational only.

---

## Known limitations

1. **No historical reservation backfill** — current paid KK orders already deducted stock at payment; not reinterpreted.
2. **eBay `ebay_item_id` unavailable** — schema does not store it on order lines.
3. **Amazon AFN detection** relies on fulfillment shipment carrier/service set at sync time — not re-read from Amazon API in the view.
4. **eBay variant** — `legacyVariationId` stored in `variant` text column but not used for `variant_id` assignment.
5. **Partial refunds** still appear as unmapped if `variant_id` is null (by design — mapping gap, not refund policy).
6. **KPI `unmapped_lines`** still means **parcel** unmapped rows (unchanged from Phase 3A); order-line unmapped count is in **issues** only.

---

## JS / UI changes (minimal)

| File | Change |
|------|--------|
| `constants/orderLinks.js` | Deep link to Line Items Orders |
| `api/inventoryApi.js` | `unmapped_order_line` issue label |
| `services/buildAlerts.js` | Alert pill + filter for unmapped order lines |
| `renderers/renderIssues.js` | “Open Line Items Orders →” action |
| `renderers/renderKpis.js` | Updated reserved/issues hint copy |

KPI reserved and table reserved/available read live from updated views. No new write paths.

---

## Verification

**Script:** `scripts/verify-inventory-phase6b-reservations-read.mjs`

Checks:

- Migration file present
- `inventory_reservations` exists and is empty
- `v_inventory_kpis`: reserved=0, available=on_hand
- `v_inventory_workspace`: all rows reserved=0, available=on_hand
- `v_inventory_unmapped_order_lines` loads
- `v_inventory_issues` loads (includes `unmapped_order_line` when count > 0)
- Inventory page loads with zero console errors
- Only `adjustInventoryApi.js` uses RPC writes; all JS files < 500 lines

---

## Recommended Phase 6C slice

Per [007_phase_6_order_reservation_design.md](./007_phase_6_order_reservation_design.md):

1. **Shadow reservation recording** — insert `inventory_reservations` rows on KK checkout without changing stock decrement yet.
2. **Stripe webhook idempotency** — guard stock decrement/restore with idempotency keys to prevent double-deduct on retries.
3. **Compare shadow reserved vs current stock** — dashboard/report before cutover.

**Completed in Phase 6C** — see [009_phase_6c_stripe_idempotency_shadow_reservations.md](./009_phase_6c_stripe_idempotency_shadow_reservations.md). Official KPIs exclude `is_shadow=true` until Phase 6D.

**Cutover planning:** [010_phase_6d_prep_kk_cutover_readiness.md](./010_phase_6d_prep_kk_cutover_readiness.md).

---

## Files touched

| Path | Action |
|------|--------|
| `supabase/migrations/20260828_inventory_phase6b_reservations_read.sql` | Created |
| `js/admin/inventory/constants/orderLinks.js` | Created |
| `js/admin/inventory/api/inventoryApi.js` | Updated |
| `js/admin/inventory/services/buildAlerts.js` | Updated |
| `js/admin/inventory/renderers/renderIssues.js` | Updated |
| `js/admin/inventory/renderers/renderKpis.js` | Updated |
| `scripts/verify-inventory-phase6b-reservations-read.mjs` | Created |
| Docs (roadmaps, wiring plan, 007, ux) | Updated |
