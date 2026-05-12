# 001 — eBay API Order Profit Accuracy Audit

**Date:** May 10, 2026  
**Area:** Admin line items orders page  
**Page:** `pages/admin/lineItemsOrders.html`  
**Scope:** eBay orders only (`stripe_checkout_session_id` prefixes `ebay_api_` and legacy `ebay_`)

---

## 1. Summary

The current line items orders page does **not** calculate eBay order profit from true eBay seller earnings. Profit is currently derived from Karry Kraze order tables and Shippo label cost, while eBay financial deductions are either omitted or stored only as monthly/general expenses.

For eBay orders, the current page effectively uses one of these simplified formulas:

- Table/KPI path: `orders_raw.total_paid_cents - product unit cost - fulfillment_shipments.label_cost_cents - refunds`
- Detail modal path: `orders_raw.total_paid_cents - JS-calculated product CPI - fulfillment_shipments.label_cost_cents - refunds`

Neither path subtracts per-order eBay fees such as:

- final value / transaction fee
- fixed order fee
- regulatory fee
- promoted listing / ad fee
- other eBay-side marketplace deductions
- eBay-collected/remitted sales tax, when included in stored buyer totals

**Verdict:** This is a combination of:

| Type | Verdict |
|---|---|
| Mapping issue | Yes — eBay order import maps only basic order amounts into website-style columns. |
| Missing API data issue | Partially — the Finances API is called, but not persisted at order granularity. |
| Missing persistence/storage issue | Yes — no per-order eBay fee/tax/earnings table or columns exist. |
| UI calculation issue | Yes — UI uses website-style profit values and has no eBay fee breakdown. |
| Analytics/reporting issue | Yes — any page/view that consumes `v_order_financials`, `v_order_summary_plus`, `order_cost_total_cents`, or raw `orders_raw.total_paid_cents` can be wrong for eBay profitability. |

Recommended direction: persist eBay Finances API transaction rows by `transactionId` and `orderId`, derive per-order `ebay_order_earnings_cents`, then calculate eBay true net profit as:

```text
eBay true net profit
= eBay order earnings / payout-equivalent seller proceeds
- internal product CPI
- Shippo label cost
- applicable refunds / reversals
```

Where `eBay order earnings` should be validated against eBay Finances API `SALE` transaction `amount` / fee fields for the order, not inferred only from buyer totals.

---

## 2. Scope

### In scope

- Admin grouped orders page.
- eBay API orders already appearing on the page.
- eBay order import/sync flow.
- eBay financial transaction sync flow.
- Supabase views and DB columns currently feeding order profit.
- Shippo label cost handling for eBay orders.
- Other admin analytics/reporting surfaces that may reuse flawed profit logic.

### Out of scope

- Amazon profit logic changes.
- Website/Stripe profit formula changes, except where shared views need eBay-specific branching.
- Implementing the fix in this audit.
- Changing eBay listing management.

---

## 3. Known example failure

Known eBay order:

```text
EBAY-25-14595-84685
```

Provided current site understanding:

| Field | Value |
|---|---:|
| Site subtotal / paid amount used | $8.99 |
| Product cost | $1.65 |
| USPS/Shippo label | $5.48 |
| Site shown profit | $1.86 |

Provided eBay financial reality:

| Field | Value |
|---|---:|
| Item subtotal | $8.99 |
| Sales tax paid by buyer | $0.73 |
| Total paid by buyer | $9.72 |
| eBay collected/remitted tax | $0.73 |
| Transaction/final value fee | $1.62 |
| Ad fee general / promoted listing fee | $1.56 |
| eBay order earnings | $5.81 |

Correct profit implication using the preferred model:

```text
$5.81 eBay order earnings
- $1.65 internal product cost
- $5.48 Shippo label
= -$1.32 true net profit
```

### Confirmed from linked DB during audit

A linked Supabase check for `EBAY-25-14595-84685` currently shows:

| DB field | Value |
|---|---:|
| `stripe_checkout_session_id` | `ebay_api_25-14595-84685` |
| `subtotal_paid_cents` | 899 |
| `tax_cents` | 0 |
| `shipping_paid_cents` | 0 |
| `total_paid_cents` | 899 |
| `v_order_financials.product_cost_total_cents` | 62 |
| `fulfillment_shipments.label_cost_cents` | 548 |
| `v_order_financials.profit_cents` | 289 |
| `shippo_transaction_id` | present |
| `tracking_pushed_to_ebay` | true |
| `ebay_fulfillment_id` | present |

This confirms the system does not store the sample's eBay-side tax or per-order fee breakdown in the order financial path. It also confirms the table/view path and modal path can disagree because the DB view uses product `unit_cost` only, while the modal recalculates product CPI in JavaScript.

---

## 4. Current system flow

### 4.1 Orders page UI flow

1. `pages/admin/lineItemsOrders.html` loads `/js/admin/lineItemsOrders/index.js`.
2. `index.js` calls `fetchOrderSummaryPage()` from `js/admin/lineItemsOrders/api.js`.
3. `api.js` queries `v_order_summary_plus` as `SUMMARY`.
4. `api.js` separately fetches shipment rows from `fulfillment_shipments` and refunds from `v_order_refunds`.
5. `renderTable.js` renders table/card profit from `row.profit_cents` returned by `v_order_summary_plus`.
6. When opening the detail modal, `index.js` calls `fetchOrderDetails()`.
7. `fetchOrderDetails()` fetches `v_order_summary_plus`, `v_order_lines`, `products`, `fulfillment_shipments`, and `v_order_refunds`.
8. The detail modal then recalculates `profit_cents` in JavaScript and replaces the DB view value for the modal display.

### 4.2 eBay order ingestion flow

There are two confirmed eBay order ingestion paths.

#### Polling sync

File: `supabase/functions/ebay-sync-orders/index.ts`

- Endpoint used: `GET https://api.ebay.com/sell/fulfillment/v1/order`
- Filter: `creationdate:[{since}..]`
- Pagination: `limit=50`, `offset`
- Session ID format: `ebay_api_{orderId}`
- KK order ID format: `EBAY-{orderId}`
- Line item ID format: `ebay_li_{lineItemId}`
- Additional endpoint used for eBay tracking: `GET /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`

Mapped fields:

| eBay source | Local target |
|---|---|
| `order.orderId` | `orders_raw.stripe_checkout_session_id = ebay_api_{orderId}` and `orders_raw.kk_order_id = EBAY-{orderId}` |
| `order.creationDate` | `orders_raw.order_date` |
| `order.pricingSummary.total.value` | `orders_raw.total_paid_cents` |
| `order.pricingSummary.priceSubtotal.value` | `orders_raw.subtotal_paid_cents` |
| `order.pricingSummary.tax.value` | `orders_raw.tax_cents` |
| `order.pricingSummary.deliveryCost.value` | `orders_raw.shipping_paid_cents` |
| `order.lineItems[].lineItemCost.value` | `line_items_raw.unit_price_cents` |
| `order.lineItems[].discountedLineItemCost.value` | `line_items_raw.post_discount_unit_price_cents` |
| fuzzy matched product code | `line_items_raw.product_id` |
| matched product name or eBay title | `line_items_raw.product_name` |
| eBay fulfillment status | `fulfillment_shipments.label_status` |
| eBay tracking fulfillment | `fulfillment_shipments.tracking_number`, `carrier`, `shipped_at` |

Confirmed gap: this path does **not** store raw eBay order JSON and does **not** store per-order eBay fees, tax remittance details, or seller earnings.

#### Webhook ingestion

File: `supabase/functions/ebay-webhook/index.ts`

- Endpoint used after notification: `GET https://api.ebay.com/sell/fulfillment/v1/order/{orderId}`
- Inserts the same local tables as `ebay-sync-orders`:
  - `orders_raw`
  - `line_items_raw`
  - `fulfillment_shipments`
- Uses the same `pricingSummary` mapping.
- Creates `fulfillment_shipments.label_cost_cents = 0` initially.

Confirmed gap: this path also does **not** persist raw eBay order JSON or eBay finance details.

### 4.3 eBay financial transaction sync flow

File: `supabase/functions/ebay-sync-finances/index.ts`

- Endpoint used: `GET https://apiz.ebay.com/sell/finances/v1/transaction`
- Scope used: `https://api.ebay.com/oauth/api_scope/sell.finances`
- Filter: `transactionDate:[{since}..{now}]`
- Header: `X-EBAY-C-MARKETPLACE-ID: EBAY_US`
- Pagination: `limit=200`, `offset`
- Fetches all transaction types when `transactionType` is omitted.

Current transaction handling:

| Finances `transactionType` | Current handling |
|---|---|
| `SALE` | Aggregates `totalFeeAmount` into monthly `expenses` rows. Fee type breakdown is placed only in `expenses.notes`. No order-level persistence. |
| `SHIPPING_LABEL` | If `orderId` exists and `bookingEntry === 'DEBIT'`, sums label cost by order and updates `fulfillment_shipments.label_cost_cents` only if empty. |
| `NON_SALE_CHARGE` | Inserts individual `expenses` rows with `vendor = 'eBay'`, `category = 'Software'`. Not attributed to order profit. |
| `REFUND`, `CREDIT` | Explicitly ignored as informational. |

Fields recognized in code:

- `transactionId`
- `orderId`
- `transactionType`
- `transactionStatus`
- `transactionDate`
- `transactionMemo`
- `bookingEntry`
- `amount`
- `totalFeeAmount`
- `orderLineItems[].lineItemId`
- `orderLineItems[].feeBasisAmount`
- `orderLineItems[].marketplaceFees[].feeType`
- `orderLineItems[].marketplaceFees[].amount`

Confirmed gap: eBay fees are available during sync, but the implementation discards the per-order attribution by aggregating sale fees monthly into `expenses`.

### 4.4 Shippo label flow for eBay orders

File: `supabase/functions/shippo-create-label/index.ts`

- Purchases label through Shippo.
- Writes `fulfillment_shipments.shippo_transaction_id`, `shippo_rate_id`, `tracking_number`, `tracking_url`, `carrier`, `service`, `label_cost_cents`, and `label_url`.
- If session starts with `ebay_api_`, pushes tracking to eBay using:
  - `POST https://api.ebay.com/sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`
- Stores eBay tracking push result in:
  - `fulfillment_shipments.tracking_pushed_to_ebay`
  - `fulfillment_shipments.ebay_fulfillment_id`

Confirmed: for current API-imported eBay orders using Shippo labels purchased on the site, Shippo label cost is stored in `fulfillment_shipments.label_cost_cents` and is already subtracted by current profit formulas.

Risk: `ebay-sync-finances` can also update `fulfillment_shipments.label_cost_cents` from eBay `SHIPPING_LABEL` transactions, but only when the value is empty. Since this store buys eBay order labels via Shippo outside eBay's label system, eBay `SHIPPING_LABEL` rows should generally not exist for those Shippo labels. If a future workflow buys eBay labels inside eBay/Seller Hub, the same column may represent eBay label cost instead of Shippo cost. That is acceptable if only one label is used, but ambiguous without a `label_source` field.

---

## 5. Findings

### Finding 1 — Table profit comes from `v_order_summary_plus` / `v_order_financials`

Confirmed.

`js/admin/lineItemsOrders/api.js` sets:

```js
const SUMMARY = "v_order_summary_plus";
```

`fetchOrderSummaryPage()` selects `*` from `v_order_summary_plus`, and `renderTable.js` displays `r.profit_cents` directly.

Current linked DB definition of `v_order_financials` calculates:

```text
profit_cents = total_paid_cents
             - refund_amount_cents
             - product_cost_total_cents
             - label_cost_cents
```

with refund-reason branches.

The DB `product_cost_total_cents` is currently:

```text
round(sum(products.unit_cost * line_items_raw.quantity) * 100)
```

It does not subtract supplier shipping CPI in the SQL view and does not subtract eBay fees or eBay tax.

### Finding 2 — Detail modal recalculates profit independently in JavaScript

Confirmed.

`fetchOrderDetails()` in `js/admin/lineItemsOrders/api.js` loads product rows, calls `getSupplierShippingDetails(weightG, 30)`, calculates per-item CPI as:

```text
unit_cost + supplier_ship_per_unit
```

Then recalculates modal `profit_cents` as:

```text
total_paid_cents - productCpiCents - labelCostCents - refundCents
```

This explains why a table row and detail modal can show different profit for the same order.

### Finding 3 — eBay order sync stores mapped fields, not raw payloads

Confirmed.

Current DB columns for `orders_raw`, `line_items_raw`, and `fulfillment_shipments` have no JSONB raw payload field for eBay order data or eBay finances.

No `ebay_transactions`, `ebay_order_financials`, or similar table exists in the workspace.

Therefore, the current system stores mapped order fields only, not raw eBay payloads.

### Finding 4 — eBay fees are available during `ebay-sync-finances`, but are ignored for order profit

Confirmed.

`ebay-sync-finances` reads `SALE.totalFeeAmount` and `orderLineItems[].marketplaceFees[]`, including fee types. It then aggregates these by month into `expenses` with `description = eBay Selling Fees — YYYY-MM`.

The original order relationship is lost for line-items page profit because:

- `expenses` has no `orderId`/`stripe_checkout_session_id` column.
- Monthly fee rows cannot be joined back accurately to individual orders.
- `v_order_financials` does not join `expenses` at all.

### Finding 5 — Promoted listing/ad fees are not reliably attributed to orders

Confirmed as a gap.

The known example has `ad fee general = $1.56`. Current code only stores:

- `SALE` fees monthly, if included in `totalFeeAmount` / `marketplaceFees`.
- `NON_SALE_CHARGE` rows as generic expenses.

No logic attributes `AD_FEE`, promoted listing fees, or non-sale ad charges to a specific eBay order on the line items page.

Unknown: whether this exact account's promoted listing fee appears in the Finances API response as a `SALE.orderLineItems[].marketplaceFees[].feeType` or as a separate transaction with `orderId`. The implementation must persist raw transaction JSON first and validate against `EBAY-25-14595-84685`.

### Finding 6 — Sales tax is not explicitly subtracted in the profit view

Confirmed.

`v_order_financials` uses `orders_raw.total_paid_cents` without subtracting `orders_raw.tax_cents`.

For the known linked DB row, `tax_cents = 0` and `total_paid_cents = 899`, so the current row is not treating the known $0.73 tax as revenue; it is failing to store/show the tax at all.

However, the architecture is unsafe: if any eBay order row stores `pricingSummary.total` including buyer tax and `tax_cents > 0`, the current profit formula will treat that tax as revenue unless the eBay-specific formula subtracts it or uses eBay seller earnings.

### Finding 7 — Shippo label cost is mostly handled correctly for current eBay workflow

Confirmed.

For eBay API orders where labels are purchased from the admin page through Shippo, `shippo-create-label` writes actual label cost into `fulfillment_shipments.label_cost_cents`, and both DB and modal profit paths subtract it.

Double-counting risk is currently low because `ebay-sync-finances` only updates `label_cost_cents` if the existing value is empty.

Remaining risks:

- The column does not identify whether the label came from Shippo, eBay, or legacy import.
- Voided/refunded label handling may leave historical label cost unless void flow clears it correctly.
- Combined shipments may place one label cost on one order session while multiple eBay orders share the package.

### Finding 8 — Analytics/reporting pages may also rely on flawed profit logic

Confirmed.

Affected areas found:

- Orders page KPIs: `js/admin/lineItemsOrders/api.js` sums `v_order_summary_plus.profit_cents`.
- `rpc_order_kpis()` in `supabase/migrations/20260222_fix_summary_plus_and_kpis.sql` joins `v_order_financials` and sums `profit_cents`.
- SMS analytics views use `orders_raw.order_cost_total_cents` and simple revenue/cost formulas, not eBay fee-aware profit.
- Tax pages aggregate `orders_raw`, `expenses`, and `fulfillment_shipments` separately; they may include monthly eBay fees as expenses, but not per-order profit.
- Phase 7 analytics aggregates revenue/units by channel but does not store eBay net profit.

---

## 6. Root cause

The core root cause is that eBay orders are being normalized into a generic website order model too early.

The current local order schema can represent:

- buyer/order totals
- item subtotal
- tax cents
- shipping paid
- product/unit cost
- fulfillment label cost

But eBay profit requires a marketplace financial model with:

- buyer item subtotal
- buyer-paid tax
- eBay-collected/remitted tax
- final value fee / transaction fee
- fixed fee
- regulatory fee
- promoted listing / ad fee
- refunds / disputes / credits
- payout-equivalent seller earnings

The Finances API already provides much of this, but current code aggregates or discards it before the orders page can use it.

---

## 7. Recommended calculation model

### Preferred eBay order formula

Use eBay Finances API as the source of truth for seller-side proceeds.

```text
eBay true net profit
= ebay_order_earnings_cents
- internal_product_cpi_cents
- shippo_label_cost_cents
- order_level_refund_or_reversal_impact_cents
```

Where:

```text
ebay_order_earnings_cents
= payout-equivalent seller proceeds for the eBay order
= seller gross basis after eBay-collected tax and eBay platform deductions
```

For the known example:

```text
ebay_order_earnings_cents = 581
internal_product_cpi_cents = 165
shippo_label_cost_cents = 548
true_net_profit_cents = 581 - 165 - 548 = -132
```

### Fallback formula when eBay earnings are not available yet

Use this only as a provisional display with a warning badge:

```text
provisional_ebay_profit
= seller_gross_revenue_cents
- ebay_collected_tax_cents
- known_ebay_fee_cents
- internal_product_cpi_cents
- shippo_label_cost_cents
- refunds_cents
```

Where:

```text
seller_gross_revenue_cents = item_subtotal_cents + seller_shipping_paid_cents
```

Do not count buyer-paid tax as revenue.

### Required persisted breakdown

Recommended new table or materialized view:

`ebay_order_financials`

Minimum columns:

| Column | Purpose |
|---|---|
| `id` | PK |
| `stripe_checkout_session_id` | Join to local order, e.g. `ebay_api_{orderId}` |
| `ebay_order_id` | eBay order ID |
| `buyer_item_subtotal_cents` | Item subtotal before tax |
| `buyer_shipping_paid_cents` | Buyer-paid shipping, if any |
| `buyer_tax_cents` | Tax charged to buyer |
| `buyer_total_paid_cents` | Buyer total including tax |
| `ebay_collected_tax_cents` | Tax collected/remitted by eBay |
| `ebay_transaction_fee_cents` | Final value / transaction fees |
| `ebay_fixed_fee_cents` | Fixed per-order fees if separately available |
| `ebay_regulatory_fee_cents` | Regulatory fee |
| `ebay_ad_fee_cents` | Promoted listing/ad fees |
| `ebay_other_fee_cents` | Other attributable eBay deductions |
| `ebay_total_fee_cents` | Sum of all eBay fees for the order |
| `ebay_order_earnings_cents` | Payout-equivalent seller earnings for the order |
| `internal_product_cpi_cents` | Product CPI from current internal model |
| `shippo_label_cost_cents` | Actual label cost from `fulfillment_shipments` |
| `true_profit_cents` | Final eBay order profit |
| `financial_status` | `complete`, `pending_finances`, `partial`, `estimated`, `missing` |
| `last_finance_sync_at` | Last successful Finances API sync for this order |
| `raw_sale_transaction_id` | Main eBay SALE transaction ID |
| `raw_fee_transaction_ids` | JSONB array of related transaction IDs |
| `fee_breakdown` | JSONB detailed fee map by eBay fee type |
| `raw_snapshot` | JSONB diagnostic snapshot or reference to raw transaction rows |

Recommended raw table:

`ebay_finance_transactions`

Minimum columns:

| Column | Purpose |
|---|---|
| `transaction_id` | eBay transaction ID, unique |
| `ebay_order_id` | eBay order ID if present |
| `transaction_type` | e.g. `SALE`, `NON_SALE_CHARGE`, `REFUND`, `CREDIT`, `SHIPPING_LABEL` |
| `booking_entry` | `CREDIT` / `DEBIT` |
| `transaction_status` | eBay status |
| `transaction_date` | eBay transaction timestamp |
| `amount_cents` | Signed or normalized amount |
| `total_fee_amount_cents` | Fee total when provided |
| `currency` | Currency |
| `raw_payload` | Full JSONB transaction payload |
| `created_at`, `updated_at` | Sync metadata |

This preserves all eBay financial data and allows future corrections without another API pull.

---

## 8. Recommended UI breakdown for eBay orders

For eBay orders, the detail modal should replace the generic Cost & Profit block with an eBay-specific financial breakdown.

Recommended display:

| UI label | Source |
|---|---|
| Item subtotal | `orders_raw.subtotal_paid_cents` or eBay financial row |
| Buyer-paid tax | eBay order/financial tax field |
| Total buyer paid | eBay order total including tax |
| eBay-collected tax | eBay financial/order tax field |
| Seller gross before fees | item subtotal + seller shipping paid, excluding tax |
| Transaction / final value fee | Finances API fee breakdown |
| Promoted listing / ad fee | Finances API fee breakdown |
| Other eBay fees | Finances API fee breakdown |
| eBay order earnings | Finances API seller proceeds / payout-equivalent amount |
| Product CPI | existing product CPI calculation |
| Shippo label cost | `fulfillment_shipments.label_cost_cents` where `shippo_transaction_id` exists |
| Final net profit | calculated true eBay profit |
| Finance sync status | complete/pending/missing |

Table row recommendations:

- Keep `Paid` as buyer amount or seller revenue, but label it clearly.
- Add a channel badge: `eBay`.
- Add a profit status badge for eBay rows:
  - `Final` when finances complete.
  - `Pending eBay fees` when order exists but finance records are missing/delayed.
  - `Estimated` when fallback formula is used.

---

## 9. Affected files / functions / DB objects

### Frontend orders page

| File | Involvement |
|---|---|
| `pages/admin/lineItemsOrders.html` | Page shell for grouped orders, KPIs, table, modal. |
| `js/admin/lineItemsOrders/index.js` | Loads table, updates KPIs, builds detail modal HTML, renders Cost & Profit block. |
| `js/admin/lineItemsOrders/api.js` | Main data fetcher. Uses `v_order_summary_plus`, `v_order_lines`, `products`, `fulfillment_shipments`, and recalculates modal profit. |
| `js/admin/lineItemsOrders/renderTable.js` | Displays table/card `profit_cents` from summary rows. |
| `js/admin/lineItemsOrders/shipReadyCsv.js` | Export may include order-level values that should be checked if profit is added later. |
| `js/admin/lineItemsOrders/modalEditor.js` | Not directly calculating profit, but edits order/shipment fields used by profit. |

### eBay API / edge functions

| File | Involvement |
|---|---|
| `supabase/functions/ebay-sync-orders/index.ts` | Imports eBay orders via Fulfillment API and maps pricingSummary fields. |
| `supabase/functions/ebay-webhook/index.ts` | Imports eBay orders from notifications using Fulfillment API order lookup. |
| `supabase/functions/ebay-sync-finances/index.ts` | Fetches Finances API transactions but aggregates fees monthly instead of per order. |
| `supabase/functions/_shared/ebayUtils.ts` | Token refresh, API base, shared product matching. |
| `supabase/functions/shippo-create-label/index.ts` | Purchases Shippo labels, stores label cost, pushes tracking to eBay. |
| `supabase/functions/shippo-void-label/index.ts` | Voids/refunds Shippo labels; should be reviewed when final profit accounts for voided labels. |
| `supabase/functions/shippo-webhook/index.ts` | Updates tracking statuses; not a fee source. |

### DB objects

| DB object | Involvement |
|---|---|
| `orders_raw` | Stores mapped eBay order totals; no raw eBay JSON; no eBay fee columns. |
| `line_items_raw` | Stores mapped eBay line items and matched product codes; no raw eBay line item JSON. |
| `fulfillment_shipments` | Stores label cost and Shippo/eBay tracking push metadata. |
| `expenses` | Stores monthly eBay fees and non-sale charges, but cannot support exact per-order profit. |
| `v_order_summary` | Order summary based on `orders_raw` and `line_items_raw`. |
| `v_order_financials` | Current generic profit calculation; flawed for eBay. |
| `v_order_summary_plus` | Orders page summary source combining summary and financials. |
| `v_order_lines` | Detail modal line item source. |
| `v_order_refunds` | Refund data source. |
| `rpc_order_kpis()` | Sums generic `profit_cents`; eBay profit is flawed here too. |

### Analytics/reporting risk surfaces

| Area | Risk |
|---|---|
| `js/admin/lineItemsOrders/api.js` KPIs | Uses flawed `v_order_summary_plus.profit_cents`. |
| Phase 7 analytics (`analytics_daily`) | Channel revenue/units only; no eBay true net profit. |
| SMS analytics views | Use `orders_raw.order_cost_total_cents` and simple formulas; eBay fees ignored. |
| Tax pages | May include monthly eBay fees as expenses, but cannot show order-level eBay profit. |
| Item stats | Product-level profit based on product CPI/revenue, not eBay platform fees. |

---

## 10. Risks / edge cases

### Promoted listing fees

Promoted listing fees may appear as marketplace fee types on a `SALE` transaction or as separate transactions depending on eBay reporting. The implementation must persist raw Finances API transactions and classify any fee type that represents ads/promotions into `ebay_ad_fee_cents`.

### Refunds / partial refunds

Current `ebay-sync-finances` treats `REFUND` and `CREDIT` as informational and ignores them. That is not sufficient for true eBay profit. Refunds can reverse revenue, reverse some eBay fees, leave ad fees intact, or create separate credits. The finance model must recompute net profit from actual finance transactions, not just local refund fields.

### Combined shipments/orders

One Shippo label may cover multiple eBay orders. Current schema stores one `label_cost_cents` per `stripe_checkout_session_id`. If combined shipping is used, the implementation needs an allocation rule or a shipment group table. Options:

- allocate label cost by item weight
- allocate evenly by order
- allocate manually in admin
- add a `shipment_group_id` and show group-level profitability

### Missing fee records

eBay Finances API records may lag behind order creation. The UI should show `Pending eBay fees` rather than a misleading positive profit.

### Delayed availability of financial records

Orders may arrive via webhook/polling immediately, while Finances API details arrive later. Recommended behavior:

- Insert order immediately.
- Mark `financial_status = pending_finances`.
- Re-run finance reconciliation for recent orders for at least 30 days.
- Promote status to `complete` when required sale/fee records are found.

### Missing raw payloads

Because raw eBay order/transaction payloads are not stored today, any mapping bug requires another API call and can be impossible to debug after eBay retention windows or if OAuth breaks.

### Legacy CSV eBay orders

Legacy `ebay_{orderNumber}` rows may not have API `orderId` parity or may have less reliable transaction matching. Treat legacy rows separately and avoid breaking current display.

### Sales tax handling differences

Some eBay API order payloads may include tax in total, while current known DB row stores tax as zero. The implementation must not rely on current accidental behavior. For eBay, tax must be displayed separately and excluded from revenue/profit unless using a verified seller-earnings field.

### Label source ambiguity

Current `fulfillment_shipments.label_cost_cents` does not record whether the label came from Shippo, eBay, legacy import, or manual edit. Add `label_source` or infer from `shippo_transaction_id` / eBay transaction source.

### Monthly expenses double counting

If per-order eBay fees are added to order profit but monthly eBay fee expenses remain in P&L/tax views, business-level reports may double-count fees. Keep per-order profit analytics separate from deductible accounting expenses, or mark monthly fee expense rows as already allocated.

---

## 11. Implementation strategy

### Phase 1 — Add persistence without changing UI behavior

1. Create `ebay_finance_transactions` table to store raw Finances API transactions by `transactionId`.
2. Create `ebay_order_financials` table or view to aggregate transactions by eBay order.
3. Update `ebay-sync-finances` to upsert raw transactions first.
4. Preserve existing `expenses` behavior temporarily to avoid breaking tax/expense workflows.
5. Backfill recent finance transactions with a larger `days_back` window.

### Phase 2 — Derive eBay order financials

1. For each `SALE` transaction with `orderId`, derive:
   - buyer/seller basis amount
   - `totalFeeAmount`
   - marketplace fee breakdown by `feeType`
   - payout-equivalent `amount`
2. Attribute ad/promoted listing fees if present in `SALE.marketplaceFees` or related transactions.
3. Join to local order using:
   - `stripe_checkout_session_id = ebay_api_{orderId}` first
   - fallback `ebay_{orderId}` for legacy rows
4. Compute `ebay_order_earnings_cents` and `true_profit_cents`.
5. Mark rows as `complete`, `partial`, `estimated`, or `missing`.

### Phase 3 — Update DB financial view safely

Recommended approach: do **not** replace the generic formula for all platforms.

Instead:

1. Create an eBay-specific view, e.g. `v_ebay_order_profit`.
2. Update `v_order_financials` to branch:
   - If `stripe_checkout_session_id LIKE 'ebay_api_%' OR LIKE 'ebay_%'` and `v_ebay_order_profit` has complete data, use true eBay profit.
   - Otherwise preserve current website/Amazon logic.
3. Expose eBay-specific columns through `v_order_summary_plus` only where needed, or have the frontend fetch a separate breakdown for eBay modal rows.

### Phase 4 — Update orders UI

1. `renderTable.js`: show eBay profit status badge.
2. `api.js`: fetch eBay financial breakdown for eBay rows.
3. `index.js`: render eBay-specific Cost & Profit section.
4. Keep non-eBay orders on existing UI path.
5. Add warning if eBay finance data is missing or stale.

### Phase 5 — Reconcile analytics and expenses

1. Audit all reporting pages that display profit.
2. Decide whether order-level eBay fees should remain in `expenses` as monthly accounting rows, or be linked as allocated rows.
3. Prevent double counting in business-level reports.
4. Add validation dashboard/query for eBay finance completeness.

---

## 12. Validation checklist

### Known example

- [ ] `EBAY-25-14595-84685` shows item subtotal `$8.99`.
- [ ] It shows buyer tax `$0.73`.
- [ ] It shows buyer total `$9.72`.
- [ ] It shows eBay-collected/remitted tax `$0.73`.
- [ ] It shows transaction/final value fee `$1.62`.
- [ ] It shows promoted listing/ad fee `$1.56`.
- [ ] It shows eBay order earnings `$5.81`.
- [ ] It shows product CPI `$1.65`.
- [ ] It shows Shippo label `$5.48`.
- [ ] It shows final net profit `-$1.32`.

### Data integrity

- [ ] `ebay-sync-finances` stores raw transaction JSON by `transactionId`.
- [ ] Re-running finance sync is idempotent.
- [ ] `SALE.totalFeeAmount` and `orderLineItems[].marketplaceFees[]` are preserved.
- [ ] Promoted listing fees are classified and visible.
- [ ] Missing finance records show pending status, not final profit.
- [ ] Refund and credit transactions affect eBay true profit.
- [ ] Shippo label cost is not double-counted.
- [ ] Legacy `ebay_` orders still render without breaking.
- [ ] Amazon and website orders remain unchanged.

### UI

- [ ] eBay detail modal shows dedicated eBay fee/tax breakdown.
- [ ] Table profit matches modal final profit when finances are complete.
- [ ] Table clearly marks estimated/pending eBay profit.
- [ ] KPIs use the same finalized eBay profit path as table rows.

### Reporting

- [ ] Orders KPI profit no longer inflates eBay orders.
- [ ] Any analytics page that displays profit is either corrected or marked as not eBay-net-profit-aware.
- [ ] Expense reports do not double-count per-order eBay fees and monthly eBay fee expenses.

---

## 13. Recommended next prompt

Use this exact prompt to implement the fix:

```text
Implement the eBay order profit accuracy fix from docs/audit/pages/lineItemsOrder/EbayAPIAccuracy/001_ebay_order_profit_accuracy_audit.md.

Constraints:
- eBay orders only. Do not change Amazon or website/Stripe profit behavior except where shared views need safe eBay-specific branching.
- Preserve existing expenses import/reporting behavior unless a change is required to prevent double counting, and call that out before changing it.
- Keep the project vanilla JS + Supabase Edge Functions; no build step.
- Edge functions must keep CORS preflight handling.
- Use catch (err: unknown) in Edge Functions.

Implementation goals:
1. Add migrations for raw eBay finance persistence and per-order eBay financial aggregation.
2. Update ebay-sync-finances to upsert raw Finances API transactions by transactionId and derive/order-level eBay fee breakdowns.
3. Add an eBay-specific order profit view/table that calculates true eBay net profit as eBay order earnings minus internal product CPI minus Shippo label cost, with pending/missing finance statuses.
4. Update v_order_financials or v_order_summary_plus safely so eBay rows can use true eBay profit when complete while non-eBay rows keep current logic.
5. Update the line items orders page so eBay order details show item subtotal, buyer tax, total buyer paid, eBay-collected tax, final value/transaction fee, promoted listing/ad fee, other eBay fees, eBay order earnings, product CPI, Shippo label cost, final net profit, and finance sync status.
6. Update table/KPI profit for eBay orders to use the corrected eBay profit path and show a pending/estimated badge when finance data is incomplete.
7. Validate against EBAY-25-14595-84685: item subtotal 8.99, tax 0.73, buyer total 9.72, transaction fee 1.62, ad fee 1.56, eBay earnings 5.81, product cost 1.65, Shippo label 5.48, final profit -1.32.
8. Run relevant checks and document any remaining unknowns.

Start by reading the audit doc, then inspect the current code and DB definitions before editing. Make the smallest safe changes and list all files changed at the end.
```
