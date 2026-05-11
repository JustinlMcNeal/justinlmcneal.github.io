# Line Items Page — Pirate Ship / Ship-Ready Verification

## Purpose

Step 1 of the cleanup is complete: the manual eBay CSV import workflow has been removed. `ebayImport.js` is deleted and all eBay buttons, panels, handlers, and `els` entries are gone.

This document addresses the remaining two candidates that were classified as **Needs Verification** in the audit:

1. The **Pirate Ship import** workflow (`#btnImportPirateShip`, `#importPreviewPanel`, `#importResultPanel`, `pirateShipImport.js`)
2. The **Ship-Ready CSV export** (`#btnExportShipReady`, `shipReadyCsv.js`)

Two related supporting items are also examined:
- `showImportPreview`, `hideImportPreview`, `showImportResult` (in `dom.js`) — used only by the Pirate Ship import path
- `#fPirateShipShipmentId` (edit modal field, wired in `modalEditor.js`)

---

## Exact items reviewed

| # | Item | File | Type |
|---|------|------|------|
| 1 | `#btnImportPirateShip` + drag-drop | `pages/admin/lineItemsOrders.html` | HTML button |
| 2 | `#importPreviewPanel` + children | `pages/admin/lineItemsOrders.html` | HTML panel |
| 3 | `#importResultPanel` + children | `pages/admin/lineItemsOrders.html` | HTML panel |
| 4 | `js/admin/lineItemsOrders/pirateShipImport.js` | entire file | JS module |
| 5 | `wirePirateShipImport(...)` call | `js/admin/lineItemsOrders/index.js` | JS handler block |
| 6 | `import { wirePirateShipImport }` | `js/admin/lineItemsOrders/index.js` | JS import |
| 7 | Pirate Ship `els` entries (13 properties) | `js/admin/lineItemsOrders/dom.js` | JS DOM refs |
| 8 | `showImportPreview()` | `js/admin/lineItemsOrders/dom.js` | exported function |
| 9 | `hideImportPreview()` | `js/admin/lineItemsOrders/dom.js` | exported function |
| 10 | `showImportResult()` | `js/admin/lineItemsOrders/dom.js` | exported function |
| 11 | `importCancelBtn` close wiring | `js/admin/lineItemsOrders/dom.js` | wiring in `wireDomHelpers()` |
| 12 | `import { ... showImportResult, showImportPreview, hideImportPreview }` | `js/admin/lineItemsOrders/index.js` | JS import |
| 13 | `#btnExportShipReady` | `pages/admin/lineItemsOrders.html` | HTML button |
| 14 | `js/admin/lineItemsOrders/shipReadyCsv.js` | entire file | JS module |
| 15 | `btnExportShipReady` click handler | `js/admin/lineItemsOrders/index.js` | JS handler |
| 16 | `import { downloadShipReadyCSV }` | `js/admin/lineItemsOrders/index.js` | JS import |
| 17 | `btnExportShipReady` in `els` | `js/admin/lineItemsOrders/dom.js` | JS DOM ref |
| 18 | `#fPirateShipShipmentId` field | `pages/admin/lineItemsOrders.html` | HTML field in edit modal |
| 19 | `fPirateShipShipmentId` usage | `js/admin/lineItemsOrders/modalEditor.js` | read on open, write on save |
| 20 | `importPirateShipExport` | `js/admin/lineItemsOrders/api.js` | API fn (calls `rpc_import_pirateship_export`) |
| 21 | `fetchOrderSummaryAllForExport` | `js/admin/lineItemsOrders/api.js` | API fn (used by Ship-Ready export) |

---

## Current usage analysis

### 1–11: Pirate Ship import group

**Where it appears:**
The `#btnImportPirateShip` button sits in the export/import toolbar alongside `#btnImportAmazon` and `#btnExportShipReady`. It triggers a file picker plus supports drag-and-drop. A preview panel (`#importPreviewPanel`) shows the file name, row count, and batch ID before confirming. After a successful import, `#importResultPanel` shows updated/skipped counts.

**What calls it:**
- `wirePirateShipImport()` from `pirateShipImport.js` wires the click and drag-drop logic.
- The wiring is invoked in `wireEvents()` in `index.js` with `importFn` set to `importPirateShipExport()` from `api.js`.
- `importPirateShipExport` calls `supabase.rpc("rpc_import_pirateship_export", ...)` — a database-level stored procedure.
- The `showImportPreview`, `hideImportPreview`, and `showImportResult` functions from `dom.js` are the UI helpers that power the preview and result panels.

**Business purpose today:**
Pirate Ship was the old label-buying tool. The workflow was:
1. Export Ship-Ready CSV → upload to Pirate Ship → buy labels in bulk → export Pirate Ship's shipment report → import that report here to sync tracking numbers and label costs into `fulfillment_shipments`.

Shippo now replaces the entire label-buying half of that pipeline: labels are bought per-order from the view modal, and Shippo auto-populates `tracking_number`, `carrier`, `service`, `label_cost_cents`, and `shippo_transaction_id` via the `shippo-create-label` edge function.

**Is it still needed for future orders?** No. New orders go through Shippo. The Pirate Ship import button would only be relevant for re-importing historical Pirate Ship shipment data.

**Historical value (key judgment):**
The `fulfillment_shipments` table has a `pirate_ship_shipment_id` column (confirmed in `api.js` `.select()` on line 196 and in `docs/shippo/shippo_001.md`). This column is still fetched by the front-end. Any shipments bought through Pirate Ship before the Shippo cutover have their data already imported — the Pirate Ship button was used to do that work at the time. There is no new Pirate Ship data that would need importing going forward.

**Risk of removal:**
Low. The only data risk would be if there are Pirate Ship orders that were never imported. Given that Shippo is now live and being used, that window has effectively closed.

---

### 12–17: Ship-Ready CSV export group

**Where it appears:**
`#btnExportShipReady` is in the same toolbar. It calls `fetchOrderSummaryAllForExport(filters)` — which pages through all orders matching the current filters — and pipes the result to `downloadShipReadyCSV()`, which produces a CSV download.

**What calls it:**
Only `btnExportShipReady`'s click handler in `index.js`. `fetchOrderSummaryAllForExport` is an `api.js` function; it has a second caller that should be checked — but a search confirms it is only referenced twice in `index.js`: the import line and this one handler.

**What the CSV contains:**
```
date, kk_order_id, first_name, last_name,
street_address, city, state, zip, country, email,
total_items, total_weight_oz, total_paid,
label_status, batch_id, printed_at, tracking_number, notes
```

This is a general-purpose snapshot of every order row plus its shipment status, weight in oz, tracking, and notes. It was designed for upload to Pirate Ship, but the format is broadly useful.

**Is it still needed for Pirate Ship upload?** No. Pirate Ship batch upload is no longer part of the workflow.

**Does it have other operational value?** Yes:
- **Operational backup/audit**: A date-filtered CSV of all orders with tracking numbers and fulfillment status is useful for records or manual reconciliation.
- **Weight-based debugging**: The `total_weight_oz` column converts from `total_weight_g` in the DB — useful for checking estimated weights across a batch of orders when troubleshooting package size presets.
- **Customer service reference**: Filter to pending orders, export CSV — a human-readable list without needing to open the DB.

However, this functionality is niche. It has not been used since Shippo was integrated (labels are bought one at a time now). The export is filter-aware but the button does nothing that couldn't be replicated by querying the DB directly.

---

### 18–19: `#fPirateShipShipmentId` field

**Where it appears:**
In the edit modal (`#modal`), section "Shipment Details". It maps to `ship.pirate_ship_shipment_id` on open and writes `pirate_ship_shipment_id` to `fulfillment_shipments` on save (via `upsertFulfillmentShipment`).

**What calls it:**
`modalEditor.js` — `open()` reads it and `save()` writes it with `cleanStr()`. The value is also fetched from the DB in `api.js`'s select on `fulfillment_shipments`.

**Business purpose today:**
For any order that was fulfilled via Pirate Ship, this field shows the Pirate Ship internal shipment ID. It links the `fulfillment_shipments` row to the Pirate Ship platform. Since Pirate Ship is no longer used, no new `pirate_ship_shipment_id` values will ever appear.

**Historical value:**
The existing Pirate Ship shipment IDs in the database still have a referential purpose: if you ever needed to pull a Pirate Ship invoice for an old order, or match up a Pirate Ship shipment with a legacy `batch_id`. These IDs cannot be regenerated. They are inert data, but they are auditable history.

**Is the form field needed?** For new orders, no. For historical orders, displaying the value is useful; editing it is rarely needed but not harmful. The footprint is very small — one `<input>` in the modal and two lines in `modalEditor.js`.

---

### 20–21: `api.js` functions

- **`importPirateShipExport`** (line 504): Calls `rpc_import_pirateship_export`. Has no other caller besides the `wirePirateShipImport` block in `index.js`, which is itself only wired to `#btnImportPirateShip`. This function becomes dead code if the button is removed.
- **`fetchOrderSummaryAllForExport`** (line 387): Has one caller — the `btnExportShipReady` click handler. Used nowhere else. Becomes dead code if `btnExportShipReady` is removed. Note: it is already imported in `index.js` line 6; removing the button does not remove this dead import unless you also update line 6.

---

## Decision per item

| Item | Decision | Rationale |
|------|----------|-----------|
| `#btnImportPirateShip` | **Remove** | No new Pirate Ship data to import; all historical data already imported |
| `#importPreviewPanel` + children | **Remove** | Used only by Pirate Ship import |
| `#importResultPanel` + children | **Remove** | Used only by Pirate Ship import |
| `pirateShipImport.js` | **Remove** | No remaining callers once button removed |
| `wirePirateShipImport(...)` call block | **Remove** | Caller of the above |
| `import { wirePirateShipImport }` | **Remove** | With the block |
| Pirate Ship `els` entries (13 props) | **Remove** | Reference removed HTML elements |
| `importCancelBtn` wiring in `wireDomHelpers()` | **Remove** | Only serves import cancel panel |
| `showImportPreview()` | **Remove** | No remaining callers after Pirate Ship removed |
| `hideImportPreview()` | **Remove** | Same — no callers |
| `showImportResult()` | **Remove** | Same — no callers |
| `import { showImportResult, showImportPreview, hideImportPreview }` | **Remove** | Import becomes dead code |
| `importPirateShipExport` in `api.js` | **Remove** | Dead code after button removed |
| `#btnExportShipReady` | **Keep but rename/repurpose** | Has genuine ongoing operational value as a general orders export |
| `shipReadyCsv.js` | **Keep but rename/repurpose** | Powers the export above; small, low-risk |
| `btnExportShipReady` click handler | **Keep** | Needed for the export |
| `import { downloadShipReadyCSV }` | **Keep** | Needed |
| `fetchOrderSummaryAllForExport` in `api.js` | **Keep** | Used by the export |
| `#fPirateShipShipmentId` field in modal | **Keep** | Provides read access to historical shipment IDs; edit capability is harmless |
| `fPirateShipShipmentId` wiring in `modalEditor.js` | **Keep** | Needed for display and editing of historical field |

---

## Answers to specific decision questions

### 1. Is Pirate Ship CSV import still useful for historical backfill or exception handling?

**No.** All historical Pirate Ship orders were imported when the button was actively in use. Shippo is now the label platform. There are no new Pirate Ship shipment CSVs being generated — the Pirate Ship account is not being used for new labels. The window for historical import has closed. The button can be safely removed.

### 2. Is Ship-Ready CSV still useful as a generic operational export — even if Pirate Ship upload is no longer the destination?

**Yes.** The CSV contains: order ID, customer name and address, item count, weight in oz, paid amount, current fulfillment status, tracking number, and notes. This is genuinely useful for:
- Spot-checking a batch of pending or unfulfilled orders
- Generating a human-readable offline record
- Debugging weight calculations across multiple orders

The button should be **kept and renamed** from `📦 Export Ship-Ready CSV` to something generic like `📋 Export Orders CSV` to remove the Pirate Ship connotation. The file `shipReadyCsv.js` can remain as-is (the code is format-neutral) or have its comment headers updated.

### 3. Are `showImportPreview`, `hideImportPreview`, and `showImportResult` still needed after Pirate Ship is removed?

**No.** A search across all `js/admin/lineItemsOrders/*.js` files confirms:
- `showImportPreview` is called in two places: `pirateShipImport.js` (line 199) and passed as a prop in `index.js` (line 694). Both go away with the Pirate Ship removal.
- `hideImportPreview` is called internally in `dom.js` (lines 114, 139) — only inside `showImportPreview`'s confirm wiring and in the `importCancelBtn` handler.
- `showImportResult` is called in `index.js` (line 700) inside the Pirate Ship `onImported` callback only.

Amazon import does **not** call any of these functions — it uses its own panels wired directly in `index.js`. All three functions are exclusively Pirate Ship infrastructure and can be removed together with the Pirate Ship button.

### 4. Is `#fPirateShipShipmentId` only legacy baggage, or does it still provide value for historical shipment records?

**It has passive historical value.** The `fulfillment_shipments` table column `pirate_ship_shipment_id` was populated for every order shipped via Pirate Ship. The edit modal currently displays this value so an admin can see which Pirate Ship job corresponds to a given order. This is audit trail data. Because the footprint is minimal (one form field, two lines in `modalEditor.js`) and because removing it provides no meaningful UX improvement, **keep it**. An admin may need to cross-reference a Pirate Ship invoice for an old order.

### 5. If Ship-Ready CSV is kept, should it be renamed?

**Yes.** The current label `📦 Export Ship-Ready CSV` implies the output is meant for Pirate Ship upload. The actual column set (`kk_order_id`, name, address, weight, status, tracking) is general-purpose. Recommended new label: **`📋 Export Orders CSV`**. The button ID (`btnExportShipReady`) can remain unchanged to avoid breaking any bookmarks or muscle memory — it is not a public-facing ID.

---

## Recommended next step

**Remove Pirate Ship import only. Keep Ship-Ready CSV export (with a button label rename).**

Rationale:
- Pirate Ship import is unambiguously dead — no new data flows through it, all historical data is already in the DB.
- Ship-Ready export has ongoing operational value regardless of whether Pirate Ship is the destination.
- Renaming the button label is a safe one-line HTML change that can be bundled into the Pirate Ship removal PR.
- `#fPirateShipShipmentId` should stay as passive historical display.

---

## Risk notes

- `showImportPreview`, `hideImportPreview`, and `showImportResult` must be removed from **both** `dom.js` (definitions) and `index.js` (import statement) in the same edit. Removing only one side causes a module-level error at load time.
- `importPirateShipExport` in `api.js` should be removed alongside the button. It is a dead export and has no other callers.
- `fetchOrderSummaryAllForExport` in `api.js` must **not** be removed — it is still called by the Ship-Ready export handler.
- The `importPirateShipExport` named import on `index.js` line 6 is part of a long destructured `import {...}` statement. When removing `importPirateShipExport` from `api.js`, the corresponding name must be removed from that import statement at the same time.
- The `"Click or drag & drop file"` hint label in the HTML toolbar still applies to `#btnImportAmazon`, so it must be kept.

---

## Recommended next implementation doc

```
004_line_items_pirateship_removal.md
```

This doc should cover the exact Step 3 removal from the audit plan:
- Delete `#btnImportPirateShip` button from HTML
- Delete `#importPreviewPanel` div block from HTML
- Delete `#importResultPanel` div block from HTML
- Remove `wirePirateShipImport` wiring block from `wireEvents()` in `index.js`
- Remove `import { wirePirateShipImport }` from `index.js`
- Remove `showImportPreview`, `hideImportPreview`, `showImportResult` from the `index.js` import line
- Remove `showImportPreview()`, `hideImportPreview()`, `showImportResult()` function definitions from `dom.js`
- Remove the `importCancelBtn` close wiring from `wireDomHelpers()` in `dom.js`
- Remove all 13 Pirate Ship `els` entries from `dom.js`
- Remove `importPirateShipExport` from `api.js` and from the named import in `index.js`
- Delete `js/admin/lineItemsOrders/pirateShipImport.js`
- Rename `#btnExportShipReady` button label from `📦 Export Ship-Ready CSV` to `📋 Export Orders CSV` (HTML label only — do not change the button `id`)
- Verify 0 remaining references to `wirePirateShipImport`, `importPirateShipExport`, `showImportPreview`, `hideImportPreview`, `showImportResult`
