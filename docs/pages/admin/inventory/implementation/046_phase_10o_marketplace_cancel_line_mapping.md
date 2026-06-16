# Phase 10O — Marketplace Cancel Retention + Line-Level Refund Mapping

**Status:** Complete  
**Depends on:** [045_phase_10n_marketplace_refund_persistence.md](./045_phase_10n_marketplace_refund_persistence.md)  
**Verification:** `scripts/verify-inventory-phase10o-marketplace-cancel-line-mapping.mjs`

---

## 1. Goal

Improve marketplace cancel/refund observability by retaining canceled Amazon orders, making eBay sync cancel-aware, and extracting line-level identifiers from finance payloads when available. **Observational only** — no inventory, RMA, or reservation mutations.

---

## 2. Amazon cancel audit

| Finding | Detail |
|---------|--------|
| Skip location | `amazonOrderSyncUtils.ts` — `buildOrderRows` returned `null` for `OrderStatus` canceled |
| Impact | Canceled orders invisible to Line Items, backfill, and guidance |
| Line payloads | Available when order-items API succeeds (`OrderItemId`, `SellerSKU`) |
| Reservation risk | Order sync never creates reservations; canceled rows skip PII enrich |
| UI impact | Canceled orders appear with `fulfillment_shipments.label_status = cancelled` |

### 10O behavior

- Canceled Amazon orders are **retained** in `orders_raw`, `line_items_raw`, `fulfillment_shipments`
- `stats.canceledRetained` tracked separately from `synced`
- `marketplace_refund_observations` upserted per order + line (`line_confirmed` on lines)
- AFN orders flagged `is_afn` on observations
- No reservation/stock/ledger mutations

---

## 3. eBay cancel / upsert audit

| Finding | Detail |
|---------|--------|
| Prior behavior | Insert-only; existing orders skipped entirely |
| Cancel signal | `cancelStatus.cancelState === CANCELED` |
| 10O behavior | Existing orders: upsert fulfillment + cancel observations |
| New orders | Insert path unchanged; cancel sets `label_status = cancelled` |

---

## 4. Line-level extraction rules

### SQL: `infer_marketplace_line_from_payload(channel, order_id, raw_payload, fee_breakdown)`

| Channel | Source fields | Output line ID | Confidence |
|---------|---------------|----------------|------------|
| eBay | `lineItemId`, `orderLineItemId`, `legacyItemId` in fee_breakdown/orderLineItems | `ebay_li_{id}` | `line_confirmed` |
| eBay | Single line + `sku`/`legacyVariationId` only | — | `sku_inferred` |
| Amazon | `OrderItemId`, `orderItemId`, `shipmentItemId` | `amazon_{order}_li_{id}` | `line_confirmed` |
| Amazon | `relatedIdentifiers ORDER_ITEM_ID` | same | `line_confirmed` |
| Amazon | `SellerSKU` only | — | `sku_inferred` |
| Default | — | NULL | `order_level` |

### TS helpers

- `supabase/functions/_shared/marketplaceLineExtraction.ts`
- Used for future sync enrichment; backfill uses SQL function

---

## 5. Backfill / RPC changes

`backfill_marketplace_refund_observations` now:

- Applies line extraction on Amazon/eBay finance rows
- Returns extended JSON:

```json
{
  "inserted": 0,
  "updated": 0,
  "confidence_counts": { "line_confirmed": 1, "order_level": 5 },
  "total_observations": 42,
  "amazon_canceled_retained": 3,
  "ebay_canceled_updated": 2
}
```

CLI `--dry-run` unchanged (counts only, no writes).

---

## 6. Return guidance changes

- `line_obs_agg` joins line-level persisted observations to component lines
- `marketplace_line_confidence` exposed on guidance view
- `line_confirmed` → refund confidence `line_confirmed`
- `sku_inferred` → `manual_review`
- Cancellation on non-finalized lines → no suggested restock qty; dedicated guidance copy

---

## 7. UI

Bundle Return/Restock panel:

- Confidence: line confirmed / SKU inferred / order level / manual review
- Evidence line: Amazon canceled retained / eBay cancellation update / finance line reference
- Refresh Marketplace Observations shows confidence counts from RPC

---

## 8. Verification

```bash
node scripts/verify-inventory-phase10o-marketplace-cancel-line-mapping.mjs
```

PASSED (static + browser; DB when credentials available)

---

## 9. Limitations

- `sku_inferred` does not auto-map to line without admin review
- Quantity returned/refunded still rarely in finance payloads
- Stripe legacy full-refund stock restore unchanged
- eBay webhook topics must be subscribed in eBay Developer portal (handler implemented in 10P)

---

## 10. Follow-up — Phase 10P (complete)

See [047_phase_10p_observation_cron_webhooks.md](./047_phase_10p_observation_cron_webhooks.md):

- Post-sync observation refresh on all marketplace sync jobs
- Scheduled `marketplace-refresh-observations-cron` + SETUP SQL
- eBay webhook cancel/refund/dispute topic handling
- Amazon TSV canceled rows → observation-only RPC
- `v_order_marketplace_status` + Line Items badges

---

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/_shared/amazonOrderSyncUtils.ts` | Retain canceled orders + observations |
| `supabase/functions/_shared/marketplaceLineExtraction.ts` | **New** TS line extractors |
| `supabase/functions/_shared/marketplaceObservationSync.ts` | **New** observation upsert helpers |
| `supabase/functions/ebay-sync-orders/index.ts` | Cancel-aware upsert on existing orders |
| `supabase/migrations/20261008_inventory_phase10o_line_extraction_backfill.sql` | SQL inference + backfill |
| `supabase/migrations/20261009_inventory_phase10o_return_guidance_line_level.sql` | Line-level guidance |
| `scripts/backfill-marketplace-refund-observations.mjs` | Confidence reporting |
| `scripts/verify-inventory-phase10o-marketplace-cancel-line-mapping.mjs` | **New** verification |
| `js/admin/inventory/ui/bundleReturnRestockRefund.js` | Evidence + confidence UI |
| `js/admin/inventory/api/refundRefreshApi.js` | Labels |
| `js/admin/inventory/api/returnWorkflowApi.js` | Line confidence fields |
