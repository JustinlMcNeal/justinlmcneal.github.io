# Phase 6A — Order Reserve / Finalize / Reverse Design Audit

**Status:** Complete (design / audit only — no implementation)  
**Date:** 2026-06-09  
**Prerequisite:** Phase 5 (parcel receive visibility)  
**Next:** Phase 7 — channel quantity sync ([014](./014_phase_6e_fulfillment_finalize.md) complete)

---

## Executive summary

KK Universal Storage targets an **audit-first reservation model**:

| Concept | Target meaning |
|---------|----------------|
| **On hand** | Physical units in `product_variants.stock` |
| **Reserved** | Paid (or otherwise committed) but not yet shipped |
| **Available** | On hand − reserved |

**Today, KK/Stripe already deducts `product_variants.stock` at payment** (`checkout.session.completed`), not at ship. eBay and Amazon order sync **import orders only** — no stock or ledger writes. Parcel receive and manual adjust paths are separate and must not be altered in Phase 6.

**Primary risk:** Moving KK to reserve/finalize without a cutover plan will **double-deduct** or **double-restore** stock. The Stripe webhook currently has **no idempotency guard** on stock mutations (retries can repeat decrements/restores).

**Recommended approach:** Phased migration — schema + read views first (6B), shadow reservation recording (6C), KK webhook cutover with one-time stock backfill (6D), fulfillment hooks (6E), then eBay/Amazon (6F+). Details below.

---

## 1. Current KK / Stripe stock deduction path

### Entry point

| Item | Value |
|------|-------|
| **File** | `supabase/functions/stripe-webhook/index.ts` |
| **Events handled** | `checkout.session.completed` (order + stock), `charge.refunded` (refund + stock restore) |
| **Other events** | Ignored (200 OK) |

### When stock is deducted

On **`checkout.session.completed`**, after:

1. Upsert `orders_raw` (conflict: `stripe_checkout_session_id`)
2. Ensure `fulfillment_shipments` row (`label_status: pending`, `ignoreDuplicates: true`)
3. Upsert `line_items_raw` (conflict: `stripe_checkout_session_id, stripe_line_item_id`)

Then **§2.5 STOCK DECREMENT** runs (lines ~746–827):

- For each line in the checkout session (not only DB upsert result):
  - Resolve variant: prefer `row.variant_id` from Stripe metadata → `product_variants`; fallback `products.code` + `option_value` text match
  - Skip line if no variant resolved (logs warning, **no issue row**)
  - `stock_after = max(0, stock_before - qty)` — **floors at zero**
  - `UPDATE product_variants SET stock = stock_after`
  - `INSERT stock_ledger` with `reason: 'order'`, `change: -qty`, `reference_id: kk_order_id || sessionId`

**Timing:** Deduct at **payment**, not at label purchase or ship.

### When stock is restored

On **`charge.refunded`**, when `amount_refunded >= amount` (**full refund only**):

- Load `line_items_raw` for `stripe_checkout_session_id`
- Same variant resolution: `variant_id` first, then SKU + `option_value`
- `stock_after = stock_before + qty` (no floor on restore)
- Ledger: `reason: 'refund'`, `change: +qty`, `reference_id: orderSessionId`

**Partial refunds:** Update `orders_raw.refund_*` fields only — **no stock change**.

Admin refunds via `supabase/functions/stripe-refund/index.ts` → Stripe API → **`charge.refunded` webhook** handles stock restore (not inline in stripe-refund).

### `stock_ledger` fields used (KK)

| Field | KK paid | KK full refund |
|-------|---------|----------------|
| `variant_id` | ✓ | ✓ |
| `product_id` | ✓ | ✓ |
| `change` | negative qty | positive qty |
| `reason` | `order` | `refund` |
| `reference_id` | `kk_order_id` or session id | session id |
| `stock_before` / `stock_after` | ✓ | ✓ |
| `source` | not set | not set |
| `idempotency_key` | not set | not set |
| `note` | not set | not set |

Ledger view maps `order` / `refund` → source label **KK Store** (`v_inventory_ledger_recent`).

### Idempotency behavior (critical gap)

| Step | Idempotent? | Notes |
|------|-------------|-------|
| `orders_raw` upsert | **Yes** | `onConflict: stripe_checkout_session_id` |
| `line_items_raw` upsert | **Yes** | composite unique key |
| `fulfillment_shipments` ensure | **Mostly** | `ignoreDuplicates: true` |
| **Stock decrement** | **No** | Runs on **every** `checkout.session.completed` delivery |
| **Stock restore (full refund)** | **No** | Runs on **every** full `charge.refunded` delivery |
| Promotion usage increment | Partial | Skips if order existed with coupon |

**Double-deduction risk:** Stripe webhook retries or duplicate events can decrement stock multiple times for the same order. There is no check for existing ledger row, `stock_decremented_at` flag, or idempotency key.

**Double-restore risk:** Same for full refunds.

### Identifiers used

| Purpose | Identifier |
|---------|------------|
| Order key | `stripe_checkout_session_id` (Stripe session id) |
| Display id | `kk_order_id` (`client_reference_id` or metadata) |
| Line key | `stripe_line_item_id` |
| Variant (preferred) | `line_items_raw.variant_id` from Stripe `kk_variant_id` metadata |
| Variant (legacy) | `products.code` + `line_items_raw.variant` (`option_value` match) |
| Ledger reference | `kk_order_id` or session id |

### Checkout metadata (Phase 2)

`supabase/functions/create-checkout-session/index.ts` writes to Stripe product metadata:

- `kk_variant_id`, `kk_variant_sku`, `kk_variant_title`, `kk_selected_options`
- Pre-checkout **stock check** uses variant_id when present (non-blocking on failure)

---

## 2. Current KK fulfillment / shipment path

### Order status lifecycle

There is **no single `order_status` column** on `orders_raw`. Lifecycle is inferred from:

| Signal | Table / field | Values |
|--------|---------------|--------|
| Paid | Stripe session completed → row exists | implicit |
| Refund | `orders_raw.refund_status` | `full`, `partial`, null |
| Fulfillment | `fulfillment_shipments.label_status` | see below |
| Shipped timestamp | `fulfillment_shipments.shipped_at` | nullable |

**`label_status` values (observed in code):**

- `pending` — default on KK checkout webhook
- `label_purchased` — Shippo label bought (admin UI / Shippo flow)
- `shipped` — tracking / manual status
- `cancelled` — Amazon canceled import
- Refund states filtered in Line Items admin (`refunded`, `partial_refund` via refund_status)

### Where tracking / shipping is stored

| Data | Location |
|------|----------|
| Shipping address | `orders_raw` (street, city, state, zip, country) |
| Label / carrier / tracking | `fulfillment_shipments` |
| Shippo label purchase | `supabase/functions/shippo-create-label/index.ts` |
| Shippo tracking updates | `supabase/functions/shippo-webhook/index.ts` (SMS; **no stock**) |
| eBay tracking push | From Shippo after label purchase |
| Amazon confirm shipment | `amazon-confirm-shipment` / Shippo hook |

### Admin fulfillment UI

| File | Role |
|------|------|
| `js/admin/lineItemsOrders/workspaceFulfillment.js` | Label status, refund UI |
| `js/admin/lineItemsOrders/api.js` | `upsertShipment()` → `fulfillment_shipments` |
| `js/admin/lineItemsOrders/workspace.js` | Order workspace orchestration |

**Stock impact today:** **None** at fulfillment/ship — stock already changed at payment.

### `variant_id` on order lines

| Channel | `line_items_raw.variant_id` |
|---------|----------------------------|
| KK (new checkout) | Populated when `kk_variant_id` in Stripe metadata |
| KK (legacy) | Often null — text `variant` only |
| eBay sync/webhook | **Not populated** |
| Amazon sync | **Not populated** |
| CSV / RPC imports | Usually null |

Column added in `20260718_product_variants_phase1_schema.sql` with index `idx_line_items_raw_variant_id`.

---

## 3. Current eBay order sync path

### Files / functions

| Component | Path |
|-----------|------|
| Pull sync (admin) | `supabase/functions/ebay-sync-orders/index.ts` |
| Real-time webhook | `supabase/functions/ebay-webhook/index.ts` → `insertEbayOrder()` |
| Admin trigger | `js/admin/lineItemsOrders/ebayOrderSync.js` |
| Product matching | `supabase/functions/_shared/ebayUtils.ts` → `matchProduct()` |
| Finances (fees/labels) | `supabase/functions/ebay-sync-finances/index.ts` — **no stock** |

### Tables

| Table | eBay usage |
|-------|------------|
| `orders_raw` | `stripe_checkout_session_id = 'ebay_api_{orderId}'`, `kk_order_id = 'EBAY-{orderId}'` |
| `line_items_raw` | `stripe_line_item_id = 'ebay_li_{lineItemId}'`, `product_id` = matched KK **product code** or null |
| `fulfillment_shipments` | Status from `orderFulfillmentStatus`; tracking from fulfillments API |

Legacy prefix `ebay_{orderId}` also checked for dedup.

### Line fields

| Field | Source |
|-------|--------|
| SKU / product | Fuzzy title → `products.code` via `matchProduct()` |
| `variant` | `item.legacyVariationId` (eBay id string, **not** KK variant UUID) |
| `variant_id` | **Not set** |
| Quantity | `item.quantity` |
| Paid/shipped | Order-level `orderFulfillmentStatus`: `FULFILLED`, `IN_PROGRESS`, etc. |
| Canceled/refunded | **Not explicitly imported** in sync path |

### Mapping accuracy

- **Product-level only** — token overlap / substring on title
- **No variant-level mapping** — multi-variant products ambiguous
- Unmatched lines: `product_id = null`, counted in sync stats (`unmatched`)

### Idempotency

- **Order insert:** skip if existing row for session id (**dedup before insert**)
- **Stock:** none
- **Re-sync:** skipped orders not updated (no upsert path for existing eBay orders in sync-orders)

### Unmapped lines — surfacing today

- Sync logs + return JSON `matched` / `unmatched`
- **Not** in `v_inventory_issues` (no `unmapped_order_line` issue type yet)
- Wiring plan proposes `unmapped_order_line` for Phase 6+

---

## 4. Current Amazon order sync path

### Files / functions

| Component | Path |
|-----------|------|
| Sync edge | `supabase/functions/amazon-sync-orders/index.ts` |
| Cron | `supabase/functions/amazon-sync-orders-cron/index.ts` |
| Shared logic | `supabase/functions/_shared/amazonOrderSyncUtils.ts` |
| Admin | `js/admin/lineItemsOrders/amazonOrderSync.js`, `amazonImport.js` |
| Finances | `amazon-sync-finances` — fees/CPI, **no stock** |

### Tables

Same universal order model:

| Table | Amazon usage |
|-------|--------------|
| `orders_raw` | `stripe_checkout_session_id = 'amazon_{AmazonOrderId}'`, `kk_order_id = 'AMZ-{shortId}'` |
| `line_items_raw` | `stripe_line_item_id = 'amazon_{orderId}_li_{OrderItemId}'` |
| `fulfillment_shipments` | AFN → `shipped` immediately; MFN → pending/shipped from `OrderStatus` |

### Line fields

| Field | Source |
|-------|--------|
| Seller SKU | `SellerSKU` on order item |
| KK product code | `loadSkuToKkCodeMap()` — `amazon_listing_mappings.kk_sku` + `amazon_listings.seller_sku`, plus `LEGACY_SKU_MAP` |
| ASIN | Available on item payload (not stored on `line_items_raw` in sync util) |
| `product_id` | KK code if mapped, else seller SKU or `unknown_{i}` |
| `variant` | Regex on title: trailing `(Size)` pattern |
| `variant_id` | **Not set** |
| Quantity | `QuantityOrdered` |
| Status | Order-level: `Canceled` skipped; `Shipped` / AFN → shipped label_status |

### Mapping accuracy

- **SKU → product code** via listing mappings (variant mapping exists in `amazon_listing_mappings.kk_variant_id` but **not applied to order lines**)
- Unmapped seller SKUs collected in `stats.unmappedSkus`

### Idempotency

- **Upsert** on `orders_raw` and `line_items_raw` (safe re-sync)
- **Stock:** none
- Canceled orders skipped at build time

### FBA vs FBM

- **AFN (FBA):** `label_status = shipped` on import; Amazon holds inventory — **local stock must not deduct FBA sales**
- **MFN:** merchant fulfilled — candidate for reserve/finalize when mapping exists

---

## 5. Semantic gap: stock today vs target model

| | **Today (KK)** | **Target (Phase 6+)** |
|--|----------------|------------------------|
| At payment | `stock -= qty` (finalize-like) | Create reservation; **optional** no stock change |
| At ship | No stock change | Finalize: `stock -= qty` if not already deducted |
| At cancel/refund before ship | Full refund: `stock += qty` | Release reservation; restore only if finalized |
| eBay/Amazon sale | No local stock change | Reserve when mapped (MFN/self-ship) |
| **Available for sale** | ≈ current `product_variants.stock` | `on_hand - reserved` |

**Interpretation:** Today’s `product_variants.stock` for KK behaves like **available after payment**, not **physical on hand**. Adopting the target model requires a **one-time reconciliation** (backfill physical stock + open reservations) before switching the webhook to reserve-only.

---

## 6. Double-deduction risk analysis

| Scenario | Risk | Severity |
|----------|------|----------|
| Stripe webhook retry on `checkout.session.completed` | Repeat decrement | **High** (no guard today) |
| Enable eBay/Amazon reserve **without** disabling double-count elsewhere | Channel + KK both reduce | Medium (eBay/Amazon don’t deduct today) |
| Switch webhook to reserve-only **without** backfill | Available counts wrong | **High** |
| Switch webhook to reserve-only **while still deducting** | Double deduct | **Critical** |
| Full refund webhook retry | Double restore | Medium |
| Partial refund | Under-restore vs expectation | Low (document policy) |
| Parcel receive + order deduct | Independent paths | Low if variant-scoped |
| Manual adjust during cutover | Operator error | Medium (audit trail helps) |

**Mitigations (required before 6D):**

1. Idempotency keys on all order stock effects: `{channel}:{session_id}:{line_item_id}:{event}`
2. Unique index on `stock_ledger.idempotency_key` (Phase 4 column exists)
3. Unique constraint on `inventory_reservations.idempotency_key`
4. RPC-only writes — no direct stock updates from edges after cutover
5. Cutover script with dry-run + reconciliation report

---

## 7. Proposed `inventory_reservations` schema

### Table: `inventory_reservations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `channel` | text NOT NULL | `kk` \| `ebay` \| `amazon` |
| `order_id` | text NOT NULL | Canonical session key (`stripe_checkout_session_id`) |
| `order_item_id` | text NOT NULL | `stripe_line_item_id` or marketplace line id |
| `variant_id` | uuid NOT NULL FK → `product_variants` | Required for reserve |
| `product_id` | uuid NOT NULL FK → `products` | Denormalized |
| `quantity` | integer NOT NULL CHECK (> 0) | Reserved units |
| `status` | text NOT NULL | `reserved` \| `finalized` \| `released` \| `canceled` \| `issue` |
| `reserve_ledger_id` | uuid NULL FK → `stock_ledger` | Set if reserve writes ledger |
| `finalize_ledger_id` | uuid NULL FK → `stock_ledger` | Set on finalize |
| `release_ledger_id` | uuid NULL FK → `stock_ledger` | Set on release/refund |
| `idempotency_key` | text NOT NULL UNIQUE | `{channel}:{order_id}:{order_item_id}:reserve` |
| `source_reference` | text NULL | e.g. `kk_order_id`, eBay order id |
| `metadata` | jsonb DEFAULT `{}` | mapping confidence, AFN flag, etc. |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**Indexes:**

- `(variant_id, status)` WHERE status IN (`reserved`, `finalized`)
- `(order_id, order_item_id)` UNIQUE
- `(channel, order_id)`

**Status semantics:**

| Status | Meaning |
|--------|---------|
| `reserved` | Committed qty; counts toward **reserved** KPI |
| `finalized` | Shipped / consumed; no longer reserved; stock deducted if using reserve-then-finalize |
| `released` | Canceled/refunded before finalize; reservation cleared |
| `canceled` | Voided without stock effect (edge cases) |
| `issue` | Could not map variant — no stock effect |

### Should reservation change `product_variants.stock`?

**Target (recommended):**

| Event | `product_variants.stock` | Reservation |
|-------|--------------------------|-------------|
| Reserve (paid) | **No change** | Insert `reserved` |
| Finalize (ship) | **Decrement** | → `finalized` |
| Release (cancel/refund pre-ship) | **No change** | → `released` |
| Release after finalize | **Increment** (restore) | → `released` + ledger |

**KK cutover exception:** Until 6D, webhook may continue legacy deduct while 6C writes **shadow** reservations — see transition plan.

### View updates (Phase 6B+)

| View | Change |
|------|--------|
| `v_inventory_workspace` | `reserved = SUM(qty) WHERE status = 'reserved'` per variant; `available = on_hand - reserved` |
| `v_inventory_kpis` | `reserved_units`, `available_units = on_hand - reserved` |
| **New** `v_inventory_order_line_reservations` | Join reservations ↔ orders for admin drilldown (read-only) |
| **New** `v_inventory_unmapped_order_lines` | Paid/imported lines without `variant_id` and without mapping — feeds issues |

---

## 8. Proposed stock ledger reason model

| Reason | When | Changes `product_variants.stock`? | Reservation link |
|--------|------|-----------------------------------|------------------|
| `order_reserved` | Payment / order import (optional ledger) | **No** (target) | `reserve_ledger_id` optional audit (change 0 or omit row) |
| `order_finalized` | Ship / fulfill | **Yes (−qty)** | `finalize_ledger_id` |
| `order_released` | Cancel/refund pre-ship | **No** | `release_ledger_id` |
| `order_refunded` | Refund after finalize | **Yes (+qty)** | May supersede `refund` for KK |
| `order` | **Legacy KK paid deduct** | Yes (−qty) | Keep until migration complete |
| `refund` | **Legacy KK full refund** | Yes (+qty) | Keep until migration complete |
| `manual_adjustment` | Admin adjust (Phase 4) | Yes | — |
| `parcel_receive` | Parcel receive RPC | Yes (+qty) | — |

**Recommendation:** Introduce new reasons alongside legacy; map in `v_inventory_ledger_recent` to **KK Store** / **eBay** / **Amazon** via `source` column. Do not rename existing `order`/`refund` rows.

**Ledger row on reserve (optional):** Either no ledger row on reserve (reservation table only) **or** insert with `change = 0` and `reason = order_reserved` for audit visibility — prefer **reservation table as primary audit for reserve**, ledger on finalize/release only, to reduce noise.

---

## 9. Safe transition plan for KK / Stripe

### Phase 6B — Schema + read views only (**recommended next slice**)

- Create `inventory_reservations` table (empty)
- Add read views: update `v_inventory_workspace`, `v_inventory_kpis`, add `v_inventory_unmapped_order_lines`
- **No** webhook, edge, or RPC stock changes
- Inventory UI shows `reserved = 0` until rows exist

### Phase 6C — Shadow reservations (parallel, no stock change)

- New RPC: `reserve_order_line(...)` — idempotent insert reservation only
- KK webhook: **after existing deduct**, also call reserve RPC with status=`finalized` **or** record parallel `reserved` without changing deduct logic
- **Safer 6C variant:** Record reservations as `finalized` immediately for KK (mirrors “deduct at pay”) — enables KPI/reporting without semantic change
- Fix webhook idempotency: skip stock block if ledger idempotency key exists
- Still **no change** to eBay/Amazon

### Phase 6D — KK cutover to reserve-then-finalize

**Preconditions:** Idempotency guards merged; cutover script tested on staging.

1. **Backfill physical stock:** For each open KK line (paid, not shipped, not fully refunded) with resolved `variant_id`:  
   `physical_stock += qty` on variant (undo prior payment deduct for open orders only).
2. **Backfill reservations:** Insert `status = reserved` for those lines.
3. **Change `stripe-webhook`:** Replace stock decrement with `reserve_order_line` only (no stock change).
4. **Map legacy ledger:** Do not delete historical `order`/`refund` rows.
5. **Verify:** `on_hand - reserved = available` matches pre-cutover sellable qty.

### Phase 6E — Finalize / release hooks

| Trigger | Action |
|---------|--------|
| `fulfillment_shipments.label_status` → `shipped` (KK/MFN) | RPC `finalize_order_line` — decrement stock, ledger `order_finalized` |
| Full refund before ship | RPC `release_order_line` — no stock if not finalized |
| Full refund after ship | `order_refunded` + increment stock (today’s behavior) |
| Partial refund | Policy TBD — recommend **no automatic stock**; manual adjust |

Hook points:

- `js/admin/lineItemsOrders/api.js` → `upsertShipment()` when status becomes `shipped`
- `stripe-webhook` `charge.refunded` → release/finalized-aware logic
- Optional: `shippo-webhook` on `TRANSIT` (defer to manual ship confirm initially)

### Phase 6F — eBay / Amazon (after KK stable)

- Only **MFN / self-ship** lines with confident `variant_id`
- On order import (insert path): call `reserve_order_line` if mapped
- On shipped signal: finalize
- On cancel: release
- **Skip AFN** — no local reservation
- **Never guess** variant — create `issue` reservation or `v_inventory_issues` row

---

## 10. eBay / Amazon handling rules (Phase 6F+)

| Rule | Behavior |
|------|----------|
| Mapping required | `variant_id` must be resolved (direct FK or high-confidence mapping table) |
| Fuzzy title-only match | **Insufficient** for auto-reserve — flag for review |
| AFN Amazon | No local reserve/deduct |
| Duplicate sync / webhook | Idempotency on `(channel, order_id, order_item_id)` |
| Unmapped | Insert issue; **no stock effect** |
| eBay relist / channel qty | Out of scope |

**Mapping improvements (pre-6F):**

- eBay: map `legacyVariationId` / SKU → `product_variants` via listing offer data
- Amazon: use `amazon_listing_mappings.kk_variant_id` when seller SKU matches

---

## 11. Inventory page impact (Phase 6+)

| UI area | Change |
|---------|--------|
| **KPI Reserved Units** | Live from `v_inventory_kpis.reserved_units` (currently hardcoded 0) |
| **KPI Available** | `on_hand - reserved` (currently equals on_hand) |
| **Table Reserved / Available columns** | Live from `v_inventory_workspace` |
| **Issues panel** | Add `unmapped_order_line` issue type |
| **Alert pills** | New pill: unmapped order lines → link to Line Items Orders filtered view |
| **Stock ledger** | Badges for `order_finalized`, `order_released`; filter by channel |
| **Drilldown (future)** | Row click → order lines with reservation status |
| **Channel sync** | Phase 7 pushes **available**, not on_hand |

**No UI write paths in Phase 6B** — read-only reservation visibility first.

---

## 12. Idempotency plan

### Keys

```
{channel}:{order_id}:{order_item_id}:reserve
{channel}:{order_id}:{order_item_id}:finalize
{channel}:{order_id}:{order_item_id}:release
```

### Enforcement

| Layer | Mechanism |
|-------|-----------|
| `inventory_reservations` | UNIQUE on `idempotency_key` and `(order_id, order_item_id)` |
| `stock_ledger` | UNIQUE partial index on `idempotency_key` (Phase 4) |
| Stripe webhook | Check key before stock mutation; return early on replay |
| eBay order insert | Keep insert-if-not-exists; add reservation RPC on insert success only |
| Amazon upsert | Reservation RPC after upsert; idempotency prevents duplicate reserve |

### RPC surface (Phase 6C+)

| RPC | Purpose |
|-----|---------|
| `reserve_order_line(...)` | Idempotent reserve |
| `finalize_order_line(...)` | Idempotent finalize + stock − |
| `release_order_line(...)` | Idempotent release + optional stock + |

All `SECURITY INVOKER` or service-role-only from edges — match `adjust_inventory` / parcel receive patterns.

---

## 13. Unmapped-line issue plan

### New issue type: `unmapped_order_line`

**Detection (view):**

```sql
-- Conceptual: paid/imported order lines where variant_id IS NULL
-- and no successful reservation exists, within rolling window
```

**Surfaces:**

- `v_inventory_issues` UNION branch
- Alert pill on Inventory dashboard
- Link to `pages/admin/lineItemsOrders.html` with filter (future query param)

**Actions (Phase 8):** manual map variant → backfill `line_items_raw.variant_id` → retry reserve RPC.

**Do not** auto-match eBay fuzzy product code to a default variant.

---

## 14. Verification plan

### Phase 6B (read-only)

| Test | Method |
|------|--------|
| Migration applies idempotently | `supabase db query` |
| Views compile; reserved=0 with empty table | SQL + Inventory page load |
| No webhook/edge diff | Git + grep stock writes |
| Inventory page zero console errors | Playwright smoke |

### Phase 6C (shadow)

| Test | Method |
|------|--------|
| KK test checkout creates reservation row | SQL assert |
| Stock still decrements once (after idempotency fix) | Before/after variant stock |
| Webhook retry does not double-decrement | Replay idempotency key |
| Ledger + reservation counts align | Script |

### Phase 6D (cutover)

| Test | Method |
|------|--------|
| Backfill script dry-run | Staging report |
| `available` unchanged across cutover | KPI snapshot diff |
| Paid-unshipped → reserved, not double-counted | Scenario test |
| Refund restores once | Full refund flow |

### Phase 6E/F

| Test | Method |
|------|--------|
| Ship → finalize deducts once | Fulfillment UI + SQL |
| eBay MFN mapped line reserves | Import fixture |
| Amazon AFN skips reserve | Import fixture |
| Unmapped → issue, no stock | Import fixture |

---

## 15. Recommended Phase 6B implementation slice

**Scope:** Database + read views + docs only. **Zero behavior change.**

| Task | Deliverable |
|------|-------------|
| Migration `20260828_inventory_phase6b_reservations_read.sql` | `inventory_reservations` table (empty), indexes, RLS/grants |
| Update `v_inventory_workspace` | `reserved` / `available` from reservations |
| Update `v_inventory_kpis` | `reserved_units`, `available_units` |
| Add `v_inventory_unmapped_order_lines` | Read-only issue feed |
| Add `v_inventory_order_line_reservations` (optional) | Admin analytics |
| Verification script | `scripts/verify-inventory-phase6b-reservations-read.mjs` |
| **Explicitly exclude** | Stripe webhook, eBay/Amazon sync, RPC writes, Inventory UI writes |

**Exit criteria:** Inventory dashboard shows live reserved/available (zeros until 6C); no production stock path touched.

---

## 16. What remains unchanged in Phase 6A / 6B

- `receive_parcel_import_inventory`
- `adjust_inventory`
- Stripe webhook behavior (until 6D)
- eBay/Amazon order sync behavior (until 6F)
- CPI / parcel approve
- Channel quantity push
- Products admin direct stock edit

---

## 17. Open questions

1. **Partial refund policy** — proportional release vs manual only?
2. **Back-order checkout** — `kk_back_order` metadata allows purchase at zero stock; how should reservations treat negative available?
3. **Historical order backfill** — how far back to create shadow reservations in 6C?
4. **Line Items admin guard** — add `requireAdmin` before fulfillment finalize hooks?
5. **Single-variant fallback** — webhook uses first variant when no option match; should reservations forbid this?

---

## Related documents

| Doc | Purpose |
|-----|---------|
| [001_wiring_plan.md](./001_wiring_plan.md) | Master wiring + risks |
| [006_phase_5_parcel_receive_visibility.md](./006_phase_5_parcel_receive_visibility.md) | Prior phase |
| [../ux/roadmap.md](../ux/roadmap.md) | UX phase index |

---

## Next recommended phase

**Phase 6B complete** — see [008_phase_6b_reservation_schema_views.md](./008_phase_6b_reservation_schema_views.md).

**Phase 6C complete** — see [009_phase_6c_stripe_idempotency_shadow_reservations.md](./009_phase_6c_stripe_idempotency_shadow_reservations.md).

**Phase 6D Execute complete** — [013_phase_6d_kk_reserve_only_cutover.md](./013_phase_6d_kk_reserve_only_cutover.md). Mode is `reserve_only`; webhook creates active reservations on checkout.

**Phase 6E — fulfillment finalize** complete: [014_phase_6e_fulfillment_finalize.md](./014_phase_6e_fulfillment_finalize.md).

**Phase 7 — channel quantity sync** or returns/restock flow.
