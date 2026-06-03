# Phase 2 CTA Label — Codebase Audit

**Doc ID:** 000  
**Created:** 2026-05-17  
**Status:** Planning only — no implementation  
**Phase:** 2A (audit)  
**Depends on:** Phase 1 refactor (complete and verified)

---

## 1. Phase 1 Readiness Summary

Phase 1 refactor is complete. All files pass `node --check`. The following seams are ready for Phase 2 to plug into:

| Seam | File | Status |
|---|---|---|
| `getRowExtras` injection | `renderTable.js` | ✅ Ready |
| `getOrderSource(row)` | `dom.js` | ✅ Ready |
| `labelPrint.js` stub | `labelPrint.js` | ✅ Ready (all 4 stubs) |
| `renderTable.js` exports | `renderOrdersRows` | ✅ Accepts `getRowExtras` |
| workspace sub-modules | `workspaceFulfillment.js` | ✅ Ready for future tab |

---

## 2. Row-Level Data Available in renderTable.js

Each row `r` in the table render already has these fields (from `v_order_summary_plus` view):

| Field | Notes |
|---|---|
| `r.kk_order_id` | E.g. `KK-2025-001`. **Present for all sources including eBay.** |
| `r.stripe_checkout_session_id` | Session ID (eBay rows use `ebay_api_<id>` format) |
| `r.first_name`, `r.last_name` | Customer name |
| `r.email` | Customer email |
| `r.source` | `"amazon"` string — only set for Amazon rows |
| `r.total_paid_cents` | Order total |
| `r.total_items` / `r.li_total_items` | Item count |
| `r.order_date` | ISO date |
| `r.review_count` | Count of submitted reviews for this order |
| `r.profit_cents` | Calculated profit (may be null for eBay pending) |
| `r.shipment.label_status` | Current fulfillment status |
| `r.shipment.tracking_number` | Tracking number if purchased |
| `r.refund` | `{ refund_status, refund_reason, refund_amount_cents }` |
| `r.ebay_finance` | `{ finance_status, ebay_net_profit_cents, … }` (eBay only) |

**Source detection** at row level:
```js
import { getOrderSource } from "./dom.js";
const source = getOrderSource(r);
// returns: "kk" | "ebay" | "amazon" | "unknown"
```

`getOrderSource` checks `r.source === "amazon"` first, then `stripe_checkout_session_id` prefix (`ebay_api_` → ebay, `cs_live_/cs_test_` → kk).

---

## 3. Data Available After Opening Workspace (fetchOrderDetails)

`fetchOrderDetails(sessionId)` returns `{ order, lineItems, shipment }`:

| Field bucket | Contents |
|---|---|
| `order.*` | Everything from `v_order_summary_plus` + `ebay_financials` |
| `lineItems[]` | `product_id`, `product_name`, `product_slug`, `product_image_url`, `quantity`, `unit_price_cents`, `post_discount_unit_price_cents`, `variant`, `cpi_cents`, `line_cost_cents` |
| `shipment.*` | `label_status`, `tracking_number`, `carrier`, `service`, `label_url`, `label_cost_cents`, `in_transit_at`, `delivered_at`, `estimated_delivery`, `printed_at`, `pirate_ship_shipment_id` |

**Product names and slugs are only available after workspace open, not in the table row.**  
For row-level CTA print, the label must use order-level data only (customer name, order ID, source).

---

## 4. Review URL — FOUND

**Answer: Yes, a review URL exists and is in use.**

### Pattern

```
https://karrykraze.com/pages/leave-review.html?oid=<kk_order_id>
```

### Evidence

- `js/my-orders/index.js` line 272:
  ```js
  reviewLink.href = `/pages/leave-review.html?oid=${encodeURIComponent(order.kk_order_id)}`;
  ```
- `js/reviews/index.js` lines 455–458:
  ```js
  const params = new URLSearchParams(window.location.search);
  const oid = params.get("oid");
  if (oid && $("lookupOrderId")) {
    $("lookupOrderId").value = oid;
  }
  ```

### Behavior

The `?oid=<kk_order_id>` param **prefills the order ID field** on the leave-review page. The customer still needs to enter their email to complete the lookup. This is the correct security model — the order ID alone doesn't bypass authentication.

### For KK Labels

The CTA label QR code should point to:
```
https://karrykraze.com/pages/leave-review.html?oid=<kk_order_id>
```

This is a safe, working, order-specific URL that requires no new infrastructure.

### For eBay / Amazon Labels

eBay orders also have `kk_order_id` set (format: `eBay-<order_id>`). However, the review flow is designed for KK website customers who paid via Stripe — eBay customers do not have Stripe sessions and the `verify-order` edge function likely requires a Stripe session match.

**Conclusion:** The review URL should only be used for KK source orders. eBay/Amazon CTA labels should use the homepage or a marketing landing page, not the review URL.

---

## 5. getRowExtras Seam — How It Works

`renderOrdersRows` in `renderTable.js` accepts a `getRowExtras` function:

```js
renderOrdersRows({
  tbodyEl,
  rows,
  onEdit,
  onView,
  getRowExtras: (row, idx) => ({
    desktopActionContent: `<button ...>Print Label</button>`,
    mobileActionBlock: `<div ...><button ...>Print Label</button></div>`,
  }),
});
```

The seam places:
- **`desktopActionContent`** — appended inside the last `<td>` (the actions cell), after the Edit button
- **`mobileActionBlock`** — appended at the bottom of the mobile card, below the stats grid

Both default to `""` when not provided. The existing Edit button is unaffected.

The `getRowExtras` callback receives the full row object `r` — so source detection and kk_order_id are available.

---

## 6. Where to Place the Print CTA Label Button

### Option A — Row-level button via `getRowExtras` (table)
- **Lowest friction**: click from the table without opening the workspace
- No workspace interaction required
- Source can be detected from row data alone
- `kk_order_id` is available for QR URL construction
- Implementation: wire in `index.js`, import `printLabel` from `labelPrint.js`

### Option B — Workspace Fulfillment tab button
- Requires the user to open the workspace
- Has access to full line items, product names, shipment detail
- Could show a label preview before printing
- More appropriate for a "Labels" tab in Phase 3

### Recommendation

**Phase 2B: Start with Option A (row-level button).**

Rationale:
- The `getRowExtras` seam from R-04 was built exactly for this.
- Fastest path to a working, testable feature.
- Does not require workspace changes.
- Option B (workspace Labels tab) can be added in Phase 3 as a preview/analytics layer.

---

## 7. QR Code Generation

### Option A — Client-side CDN library (esm.sh)
```js
import QRCode from "https://esm.sh/qrcode@1";
// generates SVG or data-URL, no server needed
```

### Option B — Google Charts QR API (deprecated)

### Option C — Edge function image generator

**Recommendation: Option A** — `qrcode` via `esm.sh`. Keeps everything client-side with no edge function overhead. The library is ~40kb and generates SVG inline. Print-safe. Load it lazily inside `labelPrint.js` only when printing.

---

## 8. Discount Code Strategy

The Phase 2 spec (003_cta_label_phase2_spec.md) already analyzed this. Summary:

| Strategy | Effort | Risk |
|---|---|---|
| Generic reusable code (e.g. `THANKYOU15`) | Low — no DB needed | Code can be shared; low abuse risk for small store |
| Per-order generated code | High — requires coupon table migration + edge fn | Over-engineered for Phase 2 |
| Order-URL embedded code | Medium — generate on review page | Requires review page changes |

**Phase 2B recommendation: Use a generic reusable code.** The discount system (`coupons` table) already exists. Create a standing `THANKYOU15` or `REVIEWKK15` code in the existing coupons table. No migration needed.

---

## 9. labelPrint.js — Scope

### What `labelPrint.js` should own:
- `determineLabelType(source)` — maps source → label type
- `buildLabelHtml(order, labelType)` — renders print-safe HTML string
- `buildReviewQrUrl(order)` — constructs the review deep-link URL
- `buildMarketingQrUrl()` — constructs the eBay/Amazon landing page URL
- `printLabel(order)` — opens print window with label HTML
- `trackLabelPrint(sessionId)` — records `label_printed_at` (Phase 2C+)

### What should stay outside `labelPrint.js`:
- Supabase queries (those live in `api.js`)
- Workspace tab wiring (in `workspace.js`)
- Table row rendering (in `renderTable.js`)
- Review URL server logic (in `verify-order` edge function)
- Coupon creation (in existing coupon system)
- `getRowExtras` wiring (in `index.js`)

---

## 10. Open Questions

| # | Question | Status |
|---|---|---|
| Q1 | Does the `verify-order` edge function reject eBay `kk_order_id` values? | **Likely yes** — eBay orders have no Stripe session. Review URL should be KK-only. |
| Q2 | Is there an existing marketing landing page for eBay conversion? | **Not found.** homepage (`karrykraze.com`) is the safest fallback for Phase 2B. |
| Q3 | Should the label show customer's first name? | Available in row data. Personal touch — **yes, include for KK labels**. |
| Q4 | What label size? | 3.5"×2" (business card) is simplest for print. 4"×6" insert is an alternative. |
| Q5 | Does the generic discount code exist yet? | **Unknown — must check coupons table** before Phase 2B. Create if absent. |
| Q6 | QR library load performance | `qrcode` via esm.sh loads only on print button click — acceptable. |

---

## 11. Relevant Files

| File | Role |
|---|---|
| `js/admin/lineItemsOrders/labelPrint.js` | Phase 2 implementation target |
| `js/admin/lineItemsOrders/renderTable.js` | `getRowExtras` seam (rows receive Print button) |
| `js/admin/lineItemsOrders/index.js` | Wires `getRowExtras` callback; imports `printLabel` |
| `js/admin/lineItemsOrders/dom.js` | `getOrderSource(row)` |
| `js/admin/lineItemsOrders/api.js` | `fetchOrderDetails` — workspace data (not needed for row print) |
| `js/reviews/index.js` | Review page — accepts `?oid=<kk_order_id>` param |
| `pages/leave-review.html` | Review landing page |
| `docs/audit/pages/lineItemsOrder/refactor/003_cta_label_phase2_spec.md` | Original Phase 2 spec |

---

## 12. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Wrong review URL for eBay orders | High | Only use review URL for `source === "kk"` orders |
| Customer data leakage via QR | Low | `kk_order_id` is not sensitive; email not in URL |
| Popup blocker kills print window | Medium | Same pattern as existing label print — already handled |
| QR CDN unavailability | Low | Use `try/catch`; fall back to text URL if QR fails |
| Discount code abuse | Low | Generic code acceptable for small store; monitor |
| eBay policy: marketing inserts | Medium | eBay TOS restricts directing buyers off-platform. **Amazon TOS is stricter.** eBay allows basic brand inserts. Consult TOS before printing eBay labels. Amazon labels should be deferred. |
| Broken print layout | Low | Test in Chrome print preview before shipping |
