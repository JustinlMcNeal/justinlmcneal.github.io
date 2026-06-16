# Phase 10N — Marketplace Refund Persistence + Sync Hardening

**Status:** Complete  
**Depends on:** [044_phase_10m_multichannel_refund_observability.md](./044_phase_10m_multichannel_refund_observability.md)  
**Verification:** `scripts/verify-inventory-phase10n-marketplace-refund-persistence.mjs`  
**Backfill CLI:** `scripts/backfill-marketplace-refund-observations.mjs`

---

## 1. Goal

Harden marketplace refund/cancellation observability by **persisting** eBay/Amazon observations and improving sync/backfill reliability. **Data quality only** — no inventory, RMA, or channel quantity mutations.

---

## 2. Marketplace audit findings

### eBay

| Source | Coverage | Line ID | Amount | Qty |
|--------|----------|---------|--------|-----|
| Order sync | Sale fields only; insert-only; no cancel/refund | `ebay_li_{id}` | Order total | No |
| Webhook | Sale events only | Same | No | No |
| Finance sync | **Was:** SALE/NON_SALE_CHARGE only | `lineItemId` in `fee_breakdown` | Yes | No |
| Finance sync | **10N:** REFUND/CREDIT/REVERSAL persisted | Order-level | Yes | No |
| `orders_raw.refund_*` | Manual admin only | Order-level | When set | No |

### Amazon

| Source | Coverage | Line ID | Amount | Qty |
|--------|----------|---------|--------|-----|
| Order sync | **Skips canceled orders** | `amazon_{order}_li_{item}` | Order total | No |
| Finance sync | Refund/return/chargeback when ORDER_ID linked | Order-level | Yes | No |
| AFN | `fulfillment_shipments` carrier/service | Order-level | N/A | External |

### Gaps remaining

- Amazon canceled orders still invisible until order sync change
- eBay order sync still insert-only (no live cancel refresh)
- Marketplace line-level refund allocation rare
- Quantity returned/refunded not in finance payloads

---

## 3. Persistence schema

### `marketplace_refund_observations`

Key columns: `source_channel`, `source_order_id`, `source_order_item_id`, amounts/status fields, `line_allocation_confidence`, `is_afn`, `observation_kind`, `observation_dedup_key`, `sync_source`, `raw_payload`.

### Idempotency

- Unique `(source_channel, observation_dedup_key)` — primary dedup
- Partial unique on `external_transaction_id` / `external_refund_id` when present
- Dedup keys: `finance:{txn_id}`, `order:{session}:{refund_status}`, `fulfillment:{session}:{status}:{returned_at}`

---

## 4. Backfill behavior

**RPC:** `backfill_marketplace_refund_observations(p_channel, p_since, p_limit, p_source_order_id)`

Sources (local DB only):

1. `amazon_finance_transactions` — refund/return/chargeback
2. `ebay_finance_transactions` — REFUND/CREDIT/REVERSAL
3. `orders_raw` — marketplace refund fields
4. `fulfillment_shipments` — cancel/return + AFN context

**CLI:**

```bash
node scripts/backfill-marketplace-refund-observations.mjs --channel all
node scripts/backfill-marketplace-refund-observations.mjs --dry-run --since 2025-01-01
node scripts/backfill-marketplace-refund-observations.mjs --order ebay_api_12345
```

**UI:** Bundle Return/Restock panel **Refresh Marketplace Observations** calls the same RPC for the order (read-only local backfill).

---

## 5. Sync hardening

**`ebay-sync-finances`:** Now upserts REFUND, CREDIT, and REVERSAL rows to `ebay_finance_transactions` (same `transaction_id` upsert as SALE). Future cron runs populate finance table; backfill/RPC materializes observations.

---

## 6. View + guidance changes

**`v_inventory_marketplace_refund_observations`:**

1. Persisted `marketplace_refund_observations` (preferred)
2. Stripe `order_refund_details`
3. Raw fallbacks only when dedup key not yet persisted

New columns: `is_afn`, `observation_source` (`persisted` / `stripe` / `raw_fallback`).

**Return guidance:**

- `persisted_observation_count`, `latest_persisted_obs_at`, `marketplace_sync_source`
- Persisted AFN flag preferred
- Marketplace with persisted data → `manual_review` confidence
- No auto-RMA/restock

---

## 7. UI changes

- Sync source label (order sync / finance sync / admin backfill)
- Observation freshness timestamp
- Persisted observation count
- Copy: *"Marketplace refund data is observational and may be order-level."*
- **Refresh Marketplace Observations** button (RPC, local data only)
- **Refresh Stripe Refund Data** unchanged for Stripe/KK

---

## 8. Verification

```bash
node scripts/verify-inventory-phase10n-marketplace-refund-persistence.mjs
```

Static: table, RPC, view, backfill dry-run, eBay sync, UI  
DB (when creds): idempotent upsert, persisted view row, no workflow/ledger mutations

---

## 9. Limitations

- Backfill reads local tables only (no live marketplace API in default path)
- Amazon canceled orders still skipped at order sync
- eBay order-level certainty unless line metadata added later
- AFN/FBA remains external manual review
- Stripe legacy full-refund stock restore unchanged

---

## 10. Recommended next phase — 10O (complete)

See [046_phase_10o_marketplace_cancel_line_mapping.md](./046_phase_10o_marketplace_cancel_line_mapping.md).

**10P:** Post-sync observation cron + eBay webhook cancel topics.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20261004_inventory_phase10n_marketplace_refund_observations_table.sql` | **New** table |
| `supabase/migrations/20261005_inventory_phase10n_backfill_rpc.sql` | **New** backfill RPC |
| `supabase/migrations/20261006_inventory_phase10n_observations_view.sql` | **New** view union |
| `supabase/migrations/20261007_inventory_phase10n_return_guidance_persisted.sql` | Guidance prefers persisted |
| `supabase/functions/ebay-sync-finances/index.ts` | Persist REFUND/CREDIT/REVERSAL |
| `scripts/backfill-marketplace-refund-observations.mjs` | **New** CLI backfill |
| `scripts/verify-inventory-phase10n-marketplace-refund-persistence.mjs` | **New** verification |
| `js/admin/inventory/ui/bundleReturnRestockRefund.js` | Sync source, freshness, refresh btn |
| `js/admin/inventory/api/refundRefreshApi.js` | `refreshMarketplaceObservations` RPC |
| `js/admin/inventory/api/returnWorkflowApi.js` | Persisted fields |
| `js/admin/inventory/api/issuesApi.js` | Issue sample columns |
