# Amazon Orders on Line Items Page — Implementation Plan

> **Status:** Phase A–C shipped (2026-05-31) — sync, RDT addresses, confirmShipment, finances view  
> **Target page:** `/pages/lineItemsOrders.html` (admin orders / fulfillment workspace)  
> **Last updated:** 2026-05-31  
> **Related:** [`012_official_sp_api_research.md`](012_official_sp_api_research.md), [`015_auth_status_implementation.md`](015_auth_status_implementation.md), eBay parity [`docs/audit/pages/lineItemsOrder/EbayAPIAccuracy/001_ebay_order_profit_accuracy_audit.md`](../../../audit/pages/lineItemsOrder/EbayAPIAccuracy/001_ebay_order_profit_accuracy_audit.md), legacy CSV import [`import-amazon-orders.mjs`](../../../../import-amazon-orders.mjs)

---

## 1. Goal

Show **Amazon orders** on the line items orders page with **feature parity** to KK website orders and eBay orders:

- Unified order list (`v_order_summary_plus` / workspace table)
- Order detail drawer with line items, images, costs
- Fulfillment / label workflow where applicable
- Profit display (COGS, fees, net)
- Source badge: **Amazon** (already partially wired in `workspace.js`, `labelPrint.js`)

Today Amazon orders primarily enter via **Seller Central TSV export** → `rpc_import_amazon_orders`. SP-API OAuth for listings is live; **Orders API sync is not built yet**.

---

## 2. Current state

### What exists

| Piece | Location | Notes |
|-------|----------|-------|
| CSV/TSV import | `import-amazon-orders.mjs`, `rpc_import_amazon_orders` | Session id pattern `amazon_{orderId}` |
| Line items UI source detection | `getOrderSource()` → `"amazon"` | Badge + column labels |
| Label print | `labelPrint.js` | Amazon → `labelType = "none"` (CTA deferred, see CTA Phase 2G) |
| Amazon listings SP-API auth | `amazon-auth-*`, LWA refresh in edge functions | Reuse same credential stack |
| Planning in `docs/todo.md` | § Amazon SP-API auto-import | Orders API endpoints listed |

### What’s missing

| Gap | Impact |
|-----|--------|
| `amazon-sync-orders` edge function | No automatic pull from Amazon |
| Finances / fee data per order | No Amazon net profit like eBay `ebay_finance` |
| Product matching on API import | CSV import uses fuzzy code match; API needs SKU → `products` / variants |
| Notifications / webhooks | No near-real-time order ingest |
| Admin sync button on line items page | eBay has sync; Amazon relies on manual TSV |

---

## 3. Target UX (parity with KK + eBay)

| Feature | KK | eBay | Amazon target |
|---------|----|------|---------------|
| Orders in workspace table | ✓ | ✓ | ✓ |
| Source filter / badge | ✓ | ✓ | ✓ (partial) |
| Line items + product images | ✓ | ✓ | ✓ |
| Variant display | ✓ (Phase 2 sizes) | ~ | Map seller SKU → variant when possible |
| Profit column | ✓ | ✓ (Finances API) | Settlement or estimated fees |
| Mark shipped / tracking | Shippo | eBay API + Shippo | Amazon confirmShipment (Orders API) |
| Sync button | N/A | `ebay-sync-orders` | `amazon-sync-orders` |
| Packing label QR | review CTA | channel CTA | TBD (currently disabled) |

---

## 4. SP-API — Orders API

### Endpoints (NA region)

| Step | Method | Purpose |
|------|--------|---------|
| List orders | `GET /orders/v0/orders` | `CreatedAfter`, `MarketplaceIds`, pagination |
| Order items | `GET /orders/v0/orders/{orderId}/orderItems` | Line-level SKU, qty, price |
| Order address | `GET /orders/v0/orders/{orderId}/address` | **Requires RDT** (restricted PII) |
| Confirm shipment | `POST /orders/v0/orders/{orderId}/shipmentConfirmation` | Tracking upload |

### Auth & roles

- Reuse existing LWA refresh + SigV4 from listings functions (`amazonPtdAuthUtils`, `amazonSigV4Utils`)
- Confirm SP-API app roles include **Orders** (and **Finance** if doing net profit)
- **Restricted Data Token (RDT)** required for ship-to address / buyer info — plan token exchange per request or cache short-lived RDT

### Rate limits

- Orders API: low burst (~1 req/s) — batch sync with backoff
- Store `LastUpdatedAfter` / sync cursor in `amazon_sync_runs` or dedicated `amazon_order_sync_state`

---

## 5. Data model & mapping

### Existing tables (reuse)

| Table | Amazon mapping |
|-------|----------------|
| `orders_raw` | One row per Amazon order |
| `line_items_raw` | One row per order item |
| `fulfillment_shipments` | Shippo label + tracking (same as KK/eBay) |

### Recommended identifiers

| Field | Value |
|-------|--------|
| `stripe_checkout_session_id` | `amazon_{AmazonOrderId}` (matches CSV import) |
| `kk_order_id` | `AMZ-{AmazonOrderId}` or keep existing CSV convention |
| `order_source` / channel column | `amazon` or `amazon_api` vs `amazon_csv` |
| Line item external id | `amazon_{orderId}_li_{index}` |

### Product matching

1. **Primary:** `SellerSKU` on order item → `amazon_listing_mappings.kk_sku` or `product_variants.sku`
2. **Fallback:** `amazon_listings.seller_sku` → mapping → product
3. **Last resort:** ASIN match (weaker for multi-variant)

After [variant plan](048_amazon_variants_implementation_plan.md): prefer `kk_variant_id` on mapping for accurate COGS/stock.

### Optional new tables

| Table | Purpose |
|-------|---------|
| `amazon_order_financials` | Per-order revenue, fees, net (like eBay finance snapshot) |
| `amazon_sync_order_runs` | Or extend `amazon_sync_runs` with `sync_type = 'orders'` |

---

## 6. Edge functions to build

| Function | Purpose |
|----------|---------|
| `amazon-sync-orders` | Pull orders since watermark; upsert `orders_raw` + `line_items_raw` |
| `amazon-get-order` (optional) | Single-order refresh from row action |
| `amazon-confirm-shipment` (optional) | POST tracking to Amazon after Shippo label |
| `amazon-sync-finances` (later) | Settlement / Finances API for true net profit |

**Shared modules:** extract from listings stack — token refresh, seller account resolution, SigV4, error logging to `amazon_sync_errors`.

---

## 7. Frontend — line items page

### Files to touch

| Area | Files |
|------|-------|
| API | `js/admin/lineItemsOrders/api.js` |
| Workspace / table | `workspace.js`, `renderTable.js` |
| Amazon import UI | `amazonImport.js` (keep TSV as fallback) |
| Sync actions | New `amazonOrderSync.js` or extend existing sync toolbar |
| Profit | Mirror `ebayFinance` pattern when finance data exists |

### UI additions

1. **Sync Amazon Orders** button (admin header on line items page — mirror eBay)
2. **Last synced** timestamp + error toast
3. **Amazon profit badge** when finance status known (optional Phase 2)
4. Re-enable packing label CTA when order flow stable ([CTA Phase 2G](../../../audit/implementation/ctaLabel/004_phase2_completion_checkpoint.md))

---

## 8. Implementation phases

### Phase A — API order sync (MVP)

1. `amazon-sync-orders` edge function
2. Map to existing `orders_raw` / `line_items_raw` schema (same as CSV)
3. SKU → product matching via listing mappings
4. Manual “Sync Amazon Orders” on line items page
5. Cron: daily incremental sync (optional)

**Success:** New Amazon orders appear in workspace without TSV upload.

### Phase B — Fulfillment parity

1. RDT flow for shipping address in order detail
2. `amazon-confirm-shipment` after Shippo label purchased
3. Status columns aligned with eBay (shipped, tracking)

### Phase C — Financial parity

1. Finances / settlement data per order
2. `amazon_net_profit_cents` in summary view (mirror eBay)
3. Fee breakdown modal

### Phase D — Polish

1. Near-real-time (SQS notifications — SP-API notifications API)
2. Deprecate TSV import for day-to-day ops (keep as backfill)
3. Amazon packing label QR campaign

---

## 9. Security & compliance

- Never expose refresh tokens or RDT in browser
- PII (address, buyer name): server-side only; RDT per SP-API policy
- Admin JWT on all sync endpoints
- Log order ids, not full addresses, in function logs

---

## 10. Dependencies

| Dependency | Status |
|------------|--------|
| Amazon SP-API OAuth (listings) | ✓ Live |
| `amazon_seller_accounts` + token refresh | ✓ Live |
| Listing → product mappings | ✓ Live (variant-aware mapping improves matching — see 048) |
| Orders API role on SP-API app | Verify in Seller Central |
| RDT approval for addresses | May require additional compliance |

---

## 11. Success criteria

- [ ] Amazon orders from last 7 days appear on line items page without CSV
- [ ] Line items show product images and COGS like KK/eBay orders
- [ ] Admin can sync on demand + scheduled daily sync
- [ ] Tracking can be confirmed back to Amazon (Phase B)
- [ ] Net profit visible when finance data available (Phase C)

---

## 12. Related tracking

- Global todo: `docs/todo.md` § Amazon SP-API → Auto-import orders
- Variants (better SKU matching): [`048_amazon_variants_implementation_plan.md`](048_amazon_variants_implementation_plan.md)
- Milestone checklist: add **Phase 7 — Amazon orders** when work starts
