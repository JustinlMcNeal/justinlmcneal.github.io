# Phase 10M — Multi-Channel Refund / Cancellation Observability

**Status:** Complete  
**Depends on:** [043_phase_10l_stripe_refund_webhook_enrichment.md](./043_phase_10l_stripe_refund_webhook_enrichment.md)  
**Verification:** `scripts/verify-inventory-phase10m-multichannel-refund-observability.mjs`

---

## 1. Goal

Add read-only refund/cancellation observability for eBay and Amazon so Inventory return guidance can understand marketplace refund/cancel signals **without changing stock**, reservations, ledger, or return workflows.

**Observational only.** No auto-RMA, auto-restock, channel writes, or deprecation of Stripe legacy stock restore.

---

## 2. Marketplace refund data audit

### Stripe / KK (baseline — Phase 10K/L)

| Signal | Location | Line certainty | Amount | Qty returned |
|--------|----------|----------------|--------|--------------|
| Refund rows | `order_refund_details` | `line_confirmed` / `line_inferred` / `order_level` via metadata | Yes (cents) | No |
| Order summary | `orders_raw.refund_*` | Order-level | Yes | No |
| Webhook enrichment | `charge.refunded` → shared helper | Same as cache | Yes | No |

### eBay

| Signal | Location | Line certainty | Amount | Qty returned |
|--------|----------|----------------|--------|--------------|
| Order refund fields | `orders_raw` (`refund_status`, `refund_reason`, `refund_amount_cents`) | Order-level | Often yes | No |
| Fulfillment cancel/return | `fulfillment_shipments` (`label_status=cancelled`, `returned_at`) | Order-level | No | No |
| Finance REFUND/CREDIT | `ebay_finance_transactions` | Order-level | Yes when synced | No |

**Notes:** eBay finance sync may not upsert all REFUND rows today — view includes them when present. Cancel before ship often appears as `refund_reason=cancelled_before_ship`. Manual review required for line allocation.

### Amazon

| Signal | Location | Line certainty | Amount | Qty returned |
|--------|----------|----------------|--------|--------------|
| Order refund fields | `orders_raw` | Order-level | When set | No |
| AFN/FBA context | `fulfillment_shipments` (`carrier='Amazon'`, `service ILIKE '%Fulfilled by Amazon%'`) | Order-level | N/A | External |
| Finance refund/return/chargeback | `amazon_finance_transactions` | Order-level | Yes when synced | No |

**Notes:** Canceled Amazon orders may be skipped at sync — observations only cover synced data. AFN/FBA returns are external to local inventory; guidance routes to `afn_external_fulfillment_review`.

### What remains manual

- Confirm physical return before restock RPC
- Create RMA/return workflow when appropriate
- Line-level refund allocation for marketplace partial refunds
- AFN/FBA inventory handled by Amazon
- eBay finance row persistence if sync gap exists

---

## 3. View design

### `v_inventory_marketplace_refund_observations`

Read-only union view (no table in 10M — view-first per spec):

| Column | Purpose |
|--------|---------|
| `observation_key` | Stable dedup key per source row |
| `refund_source` | `stripe` / `ebay` / `amazon` |
| `source_order_id` | Order id |
| `source_order_item_id` | Nullable — rarely populated for marketplace |
| `refund_amount_cents` | When available |
| `refund_status` / `cancellation_status` / `return_status` | Normalized signals |
| `line_allocation_confidence` | `line_confirmed` / `line_inferred` / `order_level` |
| `observation_kind` | `refund` / `cancellation` / `return` / `fulfillment` |
| `sync_source` | `webhook` / `order_sync` / `admin_refresh` |
| `raw_payload` | Source jsonb for audit |

**Sources unioned:** `order_refund_details`, marketplace `orders_raw`, `fulfillment_shipments`, `amazon_finance_transactions`, `ebay_finance_transactions`.

---

## 4. Return guidance integration

Enhanced views:

- `v_inventory_bundle_component_return_guidance`
- `v_inventory_bundle_component_return_workflow_guidance`

**New columns:** `refund_source_channel`, `order_channel`, `is_amazon_afn`, `marketplace_observation_count`, `latest_marketplace_obs_at`.

### Guidance statuses (10M additions)

| Status | Meaning |
|--------|---------|
| `cancellation_detected` | Marketplace cancel signal |
| `return_detected` | Return signal (order reason or fulfillment) |
| `marketplace_refund_review` | eBay/Amazon refund — order-level certainty |
| `afn_external_fulfillment_review` | AFN/FBA — local restock manual |

Existing Stripe statuses unchanged: `no_refund`, `full_refund_detected`, `partial_refund_detected`, `refund_without_return_workflow`, `refund_with_return_workflow_open`, `refund_restock_review_needed`, etc.

**Priority:** AFN check first, then Stripe detail rows, then marketplace aggregation.

---

## 5. Issue groups

| Issue type | Trigger |
|------------|---------|
| `marketplace_refund_review` | `refund_guidance_status_resolved = marketplace_refund_review` + restockable qty |
| `marketplace_cancel_review` | `cancellation_detected` + restockable qty |
| `afn_return_external_review` | `afn_external_fulfillment_review` + restockable qty |

Routes: Bundle Return/Restock panel, Line Items Orders deep link.

---

## 6. UI behavior

**Bundle Return/Restock panel** (`bundleReturnRestockRefund.js`):

- Shows refund **source**: Stripe / eBay / Amazon
- Shows **confidence**: line confirmed / line inferred / order level / manual review
- Marketplace copy: *"Marketplace refund/cancel signal detected. Confirm physical return before restocking."*
- AFN copy when applicable
- **Refresh Stripe Refund Data** — Stripe/KK orders only
- Marketplace: *"Marketplace refund data is read-only from order sync."*

---

## 7. Verification results

```bash
node scripts/verify-inventory-phase10m-multichannel-refund-observability.mjs
```

Static checks:

- Migrations, JS modules, issue wiring, UI labels
- Line-count limits on key JS files
- No workflow/stock mutation in SQL views

Database (when credentials available):

- Observations view loads eBay/Amazon fixtures
- No auto return workflow or ledger rows
- Issue groups queryable

Browser:

- Inventory page loads; refund module present

---

## 8. Limitations

- View-first — no `marketplace_refund_observations` table or admin backfill RPC
- Marketplace signals are predominantly order-level
- eBay finance REFUND rows may be sparse until sync improved
- Amazon canceled orders not in sync are invisible
- No channel API writes or refresh button for marketplace
- Stripe legacy full-refund stock restore unchanged

---

## 9. Recommended next phase — 10N (complete)

See [045_phase_10n_marketplace_refund_persistence.md](./045_phase_10n_marketplace_refund_persistence.md).

**10O:** Marketplace cancel retention + line-level refund mapping.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20261002_inventory_phase10m_marketplace_refund_observations.sql` | **New** observations view |
| `supabase/migrations/20261002_inventory_phase10m_return_guidance_marketplace.sql` | **New** guidance views |
| `supabase/migrations/20261003_inventory_phase10m_marketplace_issues.sql` | **New** issue groups |
| `js/admin/inventory/ui/bundleReturnRestockRefund.js` | Multi-source refund UI |
| `js/admin/inventory/api/refundRefreshApi.js` | Marketplace labels |
| `js/admin/inventory/api/returnWorkflowApi.js` | Map marketplace fields |
| `js/admin/inventory/api/issuesApi.js` | Issue sample queries |
| `js/admin/inventory/api/inventoryApi.js` | Issue labels |
| `js/admin/inventory/services/issueActions.js` | Issue actions |
| `js/admin/inventory/ui/issueDetailModal.js` | Deep-link routing |
| `scripts/verify-inventory-phase10m-multichannel-refund-observability.mjs` | **New** verification |
