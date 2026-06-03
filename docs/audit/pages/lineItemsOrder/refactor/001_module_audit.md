# Line Items Orders — Module Audit

**Doc ID:** 001  
**Created:** 2026-05-17  
**Scope:** `js/admin/lineItemsOrders/` + `pages/admin/lineItemsOrders.html`  
**Type:** Read-only audit — no code changes in this pass  
**Phase:** Pre-refactor (Phase 0 of CTA label feature)

---

## 1. File Inventory

| File | Purpose | LOC (approx) |
|---|---|---|
| `index.js` | Page orchestrator — DOMContentLoaded, event wiring, reload/loadMore loop | ~340 |
| `state.js` | Shared mutable state bag (`rows`, `offset`, `limit`, `hasMore`, `searchTimer`, `modal`) | ~12 |
| `dom.js` | `els` reference object, DOM helpers (`setStatus`, `setCountLabel`, format utils) | ~180 |
| `api.js` | All Supabase queries + edge function calls | ~550 |
| `renderTable.js` | Desktop table + mobile card HTML generators | ~500 |
| `workspace.js` | Unified order workspace slide-over (tabs: Overview, Financials, Fulfillment, IDs) | ~750 |
| `modalEditor.js` | Legacy fulfillment edit modal (still present, partially superseded by workspace) | ~200 |
| `amazonImport.js` | Browser-side Amazon TSV importer (SKU map, USPS cost estimator, Supabase RPC call) | ~250 |
| `shipReadyCsv.js` | Client-side CSV export generator | ~80 |

---

## 2. Module Dependency Map

```
index.js
  ├── dom.js               (els, setStatus, setCountLabel, format utils)
  ├── state.js             (state)
  ├── api.js               (fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis)
  ├── renderTable.js       (renderOrdersRows)
  ├── shipReadyCsv.js      (downloadShipReadyCSV)
  ├── amazonImport.js      (wireAmazonImport)
  └── workspace.js         (initWorkspace, openWorkspace)

workspace.js
  ├── api.js               (fetchOrderDetails, upsertFulfillmentShipment, issueRefund,
  │                         updateRefundReason, buyShippingLabel, voidShippingLabel,
  │                         fetchPackagePresets, getSignedLabelUrl)
  └── dom.js               (isoToLocalDatetimeValue, localDatetimeValueToIso,
                             dollarsToCents, centsToDollars, setStatus)

modalEditor.js             (legacy — still imported by index.js but workspace supersedes it)
  ├── api.js               (upsertFulfillmentShipment)
  └── dom.js               (format helpers, setStatus)

renderTable.js
  └── dom.js               (esc, moneyFromCents, gramsToOz, formatOz, formatDateShort)

shipReadyCsv.js
  └── dom.js               (gramsToOz)

amazonImport.js
  └── /js/shared/supabaseClient.js
```

**External shared modules imported:**

| Module | Used by |
|---|---|
| `/js/shared/adminNav.js` | `index.js` |
| `/js/shared/footer.js` | `index.js` |
| `/js/shared/supabaseClient.js` | `amazonImport.js`, implied in `api.js` |
| `/js/admin/pStorage/profitCalc.js` | `api.js` (`getSupplierShippingDetails`) |

---

## 3. Data Flow

```
DOMContentLoaded (index.js)
  │
  ├── initAdminNav / initFooter
  ├── initWorkspace (workspace.js)
  └── wireEvents()
        │
        ├── filter / search inputs → reload({ hard: true })
        ├── btnRefresh             → reload({ hard: true })
        ├── btnLoadMore            → loadMore()
        ├── btnExportShipReady     → fetchOrderSummaryAllForExport → downloadShipReadyCSV
        ├── Amazon import          → wireAmazonImport (amazonImport.js)
        └── row click (delegate)   → openWorkspace(row)

reload({ hard })
  │
  ├── updateKpisServer()
  │     └── fetchOrderKpis(filters) → rpc_order_kpis + v_order_summary_plus
  │
  └── loadMore()
        └── fetchOrderSummaryPage(filters)
              ├── getSessionIdsByStatus (optional)
              ├── getReviewedSessionIds (optional)
              ├── supabase.from("v_order_summary_plus")
              ├── getShipmentsMap
              ├── getRefundsMap
              ├── getReviewCountsMap
              └── getEbayFinancesMap
        → renderOrdersRows(rows)   → ordersRows innerHTML

openWorkspace(row)
  └── fetchOrderDetails(session_id)
        ├── v_order_summary_plus
        ├── v_order_lines
        ├── products (with product_variants)
        ├── getSupplierShippingDetails (pStorage/profitCalc.js)
        ├── fulfillment_shipments
        ├── v_order_refunds
        └── v_ebay_order_profit (eBay orders only)
  → _renderTabBody (Overview / Financials / Fulfillment / IDs)
```

---

## 4. Order Source Detection

Orders are distinguished by the `stripe_checkout_session_id` prefix:

| Prefix | Source | Label in UI |
|---|---|---|
| `cs_live_*` / `cs_test_*` | Karry Kraze website (Stripe) | KK Store |
| `ebay_api_*` | eBay | eBay |
| `amz_*` (inferred) | Amazon (imported) | Amazon |

**Location of source detection:** `renderTable.js` and `workspace.js` each independently check `startsWith("ebay_api_")`. Amazon source is read from `r.source` field in the workspace header rendering. There is no shared helper for this logic.

---

## 5. Supabase Views and Tables Used

| View / Table | Used for |
|---|---|
| `v_order_summary_plus` | Paginated order list + KPI counts |
| `v_order_lines` | Line item detail in workspace |
| `v_order_refunds` | Refund status and amounts |
| `v_ebay_order_profit` | eBay Finance API earnings and profit |
| `fulfillment_shipments` | Fulfillment status, label, tracking |
| `orders_raw` | Refund reason direct update |
| `products` | Unit cost, weight, images |
| `product_variants` | Variant images for line item display |
| `package_presets` | Preset dimensions in fulfillment tab |
| `reviews` | Review count per order |
| `rpc_order_kpis` | Server-side KPI aggregation |
| `rpc_import_amazon_orders` | Amazon TSV import (RPC via `amazonImport.js`) |

---

## 6. Known Coupling Issues

### 6a. `modalEditor.js` is largely superseded

`workspace.js` replaced the separate view + edit modals. `modalEditor.js` still exists and is
still imported but appears only partially active. The workspace Fulfillment tab (`workspace.js`)
handles the same fields. The modal editor may be dead code or a vestigial fallback.

**Risk:** Double-maintenance surface. If CTA label UI needs to be added to fulfillment view,
the question of which file owns it is ambiguous.

### 6b. `esc()` defined in two places

`dom.js` exports `esc()`. `workspace.js` defines its own private `esc()` inline. Same for `money()`
vs `moneyFromCents()`.

**Risk:** If either implementation diverges (e.g. one gets XSS-relevant changes), the other may
not be updated. Adding label HTML rendering must use the same escaping consistently.

### 6c. Order source detection is duplicated

`renderTable.js` and `workspace.js` both check `startsWith("ebay_api_")` independently.
`workspace.js` reads a `source` field for the header channel badge, but the financial calculation
path only checks the session ID prefix.

**Risk:** Amazon orders need a third branch. Without a shared `getOrderSource(row)` helper,
adding Amazon label logic requires touching at least 2 files.

### 6d. `index.js` mixes concerns

`index.js` currently contains:
- DOMContentLoaded bootstrap
- Event wiring (all toolbar controls)
- Filter badge management
- Mobile filter sheet state
- Amazon modal open/close wiring
- `reload()` / `loadMore()` orchestration
- KPI update logic

This is a lot of responsibility for a single orchestrator. It is manageable now but will grow
significantly once label rendering is added per row.

### 6e. `renderTable.js` has no seam for injecting per-row additions

The mobile card and desktop row HTML is rendered via template string concatenation.
There is no slot or injection point for future per-row UI additions (such as a "Print Label"
button or CTA label status indicator).

---

## 7. Workspace Tab Structure

The order workspace (`workspace.js`) renders 4 tabs:

| Tab ID | Contents |
|---|---|
| `overview` | Customer info, items, order summary, product images |
| `financials` | Profit calculation, eBay finance breakdown, refund section |
| `fulfillment` | Shipment fields (carrier, tracking, label cost, package weight), Shippo label actions |
| `ids` | Raw session IDs, Stripe/eBay/Shippo reference IDs |

**A "Labels" tab would be the natural home for CTA label preview and print actions.**

---

## 8. HTML Structure Overview (`lineItemsOrders.html`)

| Section | ID / Description |
|---|---|
| Admin nav mount | `#kkAdminNavMount` |
| KPI strip | `#kpiOrders`, `#kpiRevenue`, `#kpiProfit`, `#kpiUnfulfilled`, `#kpiRefunded` |
| Toolbar | `#toolbar` — search, status, review, date, refresh, export dropdown |
| Export dropdown | `#exportDropdownPanel` — "Export CSV", "Import Amazon…" |
| Mobile filter sheet | `#filterSheet` — bottom sheet with duplicate filter inputs |
| Amazon import modal | `#amazonImportModal` — drop zone + preview panel + result panel |
| Orders table | `#ordersRows` — `<tbody>` rendered by `renderTable.js` |
| Load more | `#btnLoadMore`, `#loadMoreStatus` |
| Order workspace | `#orderWorkspace` — full-screen slide-over rendered by `workspace.js` |

---

## 9. CSS

| File | Notes |
|---|---|
| `css/pages/admin/lineItemsOrders.css` | Present but likely minimal — most styles are Tailwind utility classes inline |
| Inline `<style>` in HTML | Status badge classes, drop zone animation, sticky toolbar offset, mobile touch targets |

Status badge color classes (`status-pending`, `status-shipped`, etc.) are defined in the inline
`<style>` block. `renderTable.js` uses its own `statusPillClasses()` function with Tailwind classes
instead. There is a divergence: the CSS file defines status colors but `renderTable.js` does not
use them.

---

## 10. Amazon Integration Status

`amazonImport.js` is fully functional:
- TSV file drop zone
- SKU → product code map (3 entries, manually maintained in the source file)
- USPS label cost estimator
- `rpc_import_amazon_orders` Supabase RPC call
- Preview + result panels in the modal

**SKU_MAP is hardcoded in `amazonImport.js`.** When new Amazon products are listed, a developer
must manually add the SKU. This is a maintenance risk and a documentation gap.

Amazon API integration is not connected. The import is TSV-only. The task list notes "Amazon API
integration" as a future item.

---

## 11. What Is Not Present (Gaps Relevant to CTA Label Feature)

| Missing | Notes |
|---|---|
| Order source helper function | No `getOrderSource(row)` — both KK and eBay logic is inline |
| Label type determination | No logic to decide "website order → review CTA" vs "eBay → direct CTA" |
| Label HTML template | Does not exist yet |
| Label print/preview UI | No `<details>`, button, or modal for label preview per row |
| Label analytics hooks | No `label_print_at` column, no print event tracking |
| A "Labels" workspace tab | Workspace has Overview, Financials, Fulfillment, IDs — no Labels tab |
| QR code generation | Not present anywhere in the admin JS |
| Discount code per label | Would require Supabase coupon lookup or pre-generated code |

*These gaps are itemized in the implementation plan doc (002_refactor_plan.md).*
