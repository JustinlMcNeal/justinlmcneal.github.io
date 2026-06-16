# Phase 10P — Post-Sync Observation Cron + eBay Cancel/Refund Webhook Topics

**Status:** Complete  
**Depends on:** [046_phase_10o_marketplace_cancel_line_mapping.md](./046_phase_10o_marketplace_cancel_line_mapping.md)  
**Verification:** `node scripts/verify-inventory-phase10p-observation-cron-webhooks.mjs`

---

## Goal

Automate marketplace observation refresh after existing sync jobs, add scheduled backfill, handle eBay cancel/refund webhook topics, and retain Amazon TSV canceled rows observationally — **without** inventory, reservation, ledger, RMA, or restock mutations.

---

## 1. Post-sync observation refresh

Shared helper: `supabase/functions/_shared/marketplaceObservationRefresh.ts`

- Wraps `backfill_marketplace_refund_observations` RPC
- Non-throwing on failure (logs warning, sync still succeeds)
- Logs: `inserted`, `updated`, confidence counts (`line_confirmed`, `sku_inferred`, `order_level`, `manual_review`), `amazon_canceled_retained`, `ebay_canceled_updated`

**Wired after:**

| Job | Channel | Window |
|-----|---------|--------|
| `ebay-sync-orders` | `ebay` | sync `days_back` |
| `ebay-sync-finances` | `ebay` | sync `days_back` |
| `amazon-sync-orders` | `amazon` | sync `days_back` |
| `amazon-sync-finances` | `amazon` | sync `days_back` |
| `amazon-sync-orders-cron` | `amazon` | cron `days_back` (3) |

Response payloads include `observation_refresh` object for monitoring.

---

## 2. Scheduled cron

Edge function: `marketplace-refresh-observations-cron`

- Service role + `CRON_SECRET` (same pattern as Amazon order cron)
- Default window: 14 days, channel `all`
- No marketplace API calls — DB backfill only

Install SQL: `supabase/SETUP_MARKETPLACE_OBSERVATIONS_CRON.sql` (every 6 hours). Replace `<SUPABASE_SERVICE_ROLE_KEY>` and `<CRON_SECRET>` before running in Supabase SQL editor.

---

## 3. eBay webhook cancel/refund topics

Updated: `supabase/functions/ebay-webhook/index.ts`

**Previously subscribed (unchanged):**

- `ORDER_CONFIRMATION`
- `MARKETPLACE_ORDER_CREATED`
- `MARKETPLACE_ORDER_PAID`

**Added handling:**

- `MARKETPLACE_ORDER_CANCELLED` / `MARKETPLACE_ORDER_CANCELED`
- `ORDER_CANCELLED` / `ORDER_CANCELED`
- `MARKETPLACE_ORDER_UPDATED`
- `MARKETPLACE_ORDER_REFUNDED`, `MARKETPLACE_REFUND_CREATED`
- `PAYMENT_DISPUTE`, `PAYMENT_DISPUTE_CLOSED`
- Any topic containing `CANCEL`, `REFUND`, `RETURN`, or `DISPUTE`

**Behavior:**

- Existing orders → `updateExistingEbayOrderFromApi` (fulfillment status + cancel observations, sync_source `webhook`)
- Unknown canceled order → observation-only (`cancel_observation_only`); **no** `orders_raw` insert
- Refund/dispute without order id → scoped `ebay` backfill (7-day window)
- Post-event observation refresh per order or window
- No inventory/reservation/ledger/workflow/restock mutations

Shared cancel logic: `supabase/functions/_shared/ebayOrderCancelAware.ts`

---

## 4. Amazon TSV canceled-row audit

**Skip behavior (unchanged for fulfillable import):**

`parseAmazonTSV` in `js/admin/lineItemsOrders/amazonImport.js` splits rows where `order-status === "Cancelled"` into `cancelled[]`. Valid rows only go through `rpc_import_amazon_orders` (creates reservations-eligible order rows).

**Why skipped from import:** TSV import creates `orders_raw`, `line_items_raw`, and `fulfillment_shipments` via RPC — canceled rows must not appear as active fulfillable orders or trigger reservation paths.

**Phase 10P retention:**

- RPC `retain_amazon_tsv_canceled_observations(p_amazon_order_ids text[])`
- Called after TSV import (or alone when file is all-canceled)
- Upserts `marketplace_refund_observations` with `sync_source = admin_backfill`, `observation_kind = cancellation`
- Does **not** create `orders_raw`, reservations, stock, or return workflow

---

## 5. Line Items unified status (optional, added)

View: `v_order_marketplace_status`

| Field | Source |
|-------|--------|
| `order_status` | fulfillment + refund + observations |
| `cancel_status` | fulfillment cancelled or cancel observation |
| `refund_status_derived` | Stripe refund or marketplace refund observation |
| `return_observation_status` | persisted return observations |
| `fulfillment_status` | `fulfillment_shipments.label_status` |
| `is_afn_observed` | AFN from observations |

UI: `renderTable.js` badges — Canceled, Refund observed, Return review, AFN external (when no Stripe refund badge). Guidance-only; does not drive inventory mutation.

---

## 6. Verification

```bash
node scripts/verify-inventory-phase10p-observation-cron-webhooks.mjs
```

Checks:

- Post-sync refresh wired in all sync targets
- Backfill idempotent
- eBay webhook topic routing + observation-only cancel path
- Amazon TSV canceled RPC + no orders_raw
- No restock/reservation/ledger/workflow mutations in 10P paths
- Inventory + Line Items pages load
- File line counts under limits

---

## 7. Limitations

- Cron SQL is manual install (placeholders); edge function must be deployed separately
- eBay webhook subscription topics must be enabled in eBay Developer portal (handler ready)
- Refund webhook payloads without `orderId` only trigger window backfill (no line-level until finance sync)
- Amazon TSV canceled rows have order-level observations only (no line SKUs from skipped rows)
- Unified status badges are derived views — not used for inventory automation yet
- Stripe legacy full-refund stock restore unchanged
- **Follow-up (10Q):** [048_phase_10q_marketplace_restock_assist.md](./048_phase_10q_marketplace_restock_assist.md) adds admin-confirmed restock assist for `line_confirmed` observations

---

## 8. Recommended next phase — 10R

**Batch restock assist queue + audit trail** — see [048_phase_10q_marketplace_restock_assist.md](./048_phase_10q_marketplace_restock_assist.md).

---

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/_shared/marketplaceObservationRefresh.ts` | **New** post-sync RPC wrapper |
| `supabase/functions/_shared/ebayOrderCancelAware.ts` | **New** shared cancel-aware update |
| `supabase/functions/_shared/marketplaceObservationSync.ts` | `syncSource` param on eBay cancel upsert |
| `supabase/functions/ebay-sync-orders/index.ts` | Shared cancel update + post-sync refresh |
| `supabase/functions/ebay-sync-finances/index.ts` | Post-sync refresh |
| `supabase/functions/ebay-webhook/index.ts` | Cancel/refund topics + observation refresh |
| `supabase/functions/amazon-sync-orders/index.ts` | Post-sync refresh |
| `supabase/functions/amazon-sync-finances/index.ts` | Post-sync refresh |
| `supabase/functions/amazon-sync-orders-cron/index.ts` | Post-sync refresh |
| `supabase/functions/marketplace-refresh-observations-cron/index.ts` | **New** scheduled backfill |
| `supabase/migrations/20261010_inventory_phase10p_observation_cron_webhooks.sql` | TSV RPC + status view |
| `supabase/SETUP_MARKETPLACE_OBSERVATIONS_CRON.sql` | **New** cron install template |
| `js/admin/lineItemsOrders/amazonImport.js` | TSV canceled observation retention |
| `js/admin/lineItemsOrders/api.js` | Marketplace status map |
| `js/admin/lineItemsOrders/renderTable.js` | Observation badges |
| `scripts/verify-inventory-phase10p-observation-cron-webhooks.mjs` | **New** verification |
