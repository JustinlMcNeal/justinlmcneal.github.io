# Line Items Page — eBay/Shippo Cleanup Audit

## Purpose

When the line items orders page (`pages/admin/lineItemsOrders.html`) was first built, two manual import workflows were used as the primary way to get eBay orders and shipping data into the system:

1. **eBay CSV import** — download an order report from eBay Seller Hub, drop it on the page to parse and insert orders.
2. **Pirate Ship CSV import** — after batch-purchasing labels in Pirate Ship, export the shipment CSV and drop it here to update tracking numbers and label costs.

Both workflows have since been replaced:
- `ebay-sync-orders` edge function runs every 2 hours via cron, automatically pulling eBay orders from the eBay Fulfillment API.
- `shippo-create-label` / `shippo-void-label` edge functions allow buying and voiding labels directly from the order view modal without leaving the page.

The manual buttons and their supporting code are now dead weight. This audit identifies what can be safely removed and what needs verification before removal.

---

## Current page findings

### Obsolete buttons/controls

#### 1. `🏷️ Import eBay` button — `#btnImportEbay`
- **Location**: `pages/admin/lineItemsOrders.html` — Export Buttons section, line ~246
- **What it does**: Opens a file picker (or accepts drag-and-drop) for eBay's "Orders Report" CSV. Parses orders, deduplicates, and upserts them into `orders_raw` + `line_items_raw`.
- **Why obsolete**: `ebay-sync-orders` edge function (scheduled every 2h via `SETUP_EBAY_SYNC_CRON.sql`) now polls the eBay Fulfillment API directly. Manual CSV imports are no longer the primary ingest path.

#### 2. `🔄 Re-match eBay` button — `#btnRematchEbay`
- **Location**: `pages/admin/lineItemsOrders.html` — Export Buttons section, line ~253
- **What it does**: Calls `rematchEbayProducts()` which re-runs the fuzzy product-title-to-KK-code matching logic against all existing eBay `line_items_raw` rows.
- **Why obsolete**: The eBay API sync (`ebay-sync-orders`) performs product matching on every sync run. This ad-hoc re-match button was a manual escape hatch for when the matching logic improved — that need is now served by triggering the sync.

#### 3. `🏴‍☠️ Import Pirate Ship` button — `#btnImportPirateShip`
- **Location**: `pages/admin/lineItemsOrders.html` — Export Buttons section, line ~230
- **What it does**: Opens a file picker for Pirate Ship's shipment export CSV. Parses tracking numbers, carrier info, label costs, and ship dates, then upserts into `fulfillment_shipments` via `rpc_import_pirateship_export`.
- **Why obsolete**: Shippo is now integrated. Labels are purchased directly from the order view modal (`data-buy-label` button → `shippo-create-label` edge function). Tracking is auto-populated to `fulfillment_shipments` without any CSV import step.

#### 4. `📦 Export Ship-Ready CSV` button — `#btnExportShipReady`
- **Location**: `pages/admin/lineItemsOrders.html` — Export Buttons section, line ~220
- **What it does**: Fetches all unfulfilled orders matching the current filters and downloads a CSV formatted for upload to Pirate Ship (columns: kk_order_id, name, address, weight, status, tracking, etc.) via `downloadShipReadyCSV()`.
- **Why obsolete**: This CSV was produced specifically for bulk upload to Pirate Ship. With Shippo, labels are bought per-order inside the app. The Pirate Ship upload workflow no longer exists.
- **Note**: The CSV might still have incidental use as a general-purpose export. Flag as **Needs Verification**.

---

### Related JS logic

#### Handlers removed with eBay buttons (in `js/admin/lineItemsOrders/index.js`)

- **eBay import wiring block** (~lines 750–835 in `wireEvents()`):
  ```js
  wireEbayImport({ buttonEl: els.btnImportEbay, ... })
  ```
  Wires the button, file picker, drag-drop, preview panel, confirm/cancel, and result panel display.

- **Re-match eBay handler** (~lines 836–863 in `wireEvents()`):
  ```js
  if (els.btnRematchEbay) {
    els.btnRematchEbay.addEventListener("click", async () => { ... })
  }
  ```

- **Pirate Ship import wiring block** (~lines 695–730 in `wireEvents()`):
  ```js
  wirePirateShipImport({ buttonEl: els.btnImportPirateShip, ... })
  ```

- **Export Ship-Ready handler** (~lines 880–894 in `wireEvents()`):
  ```js
  els.btnExportShipReady.addEventListener("click", async () => { ... })
  ```

#### Imports removed from `index.js` (top of file)

```js
import { downloadShipReadyCSV } from "./shipReadyCsv.js";          // remove if btnExportShipReady removed
import { wirePirateShipImport } from "./pirateShipImport.js";       // remove with Pirate Ship button
import { wireEbayImport, rematchEbayProducts } from "./ebayImport.js"; // remove with eBay buttons
```

#### Modules affected

| File | Status | Notes |
|------|--------|-------|
| `js/admin/lineItemsOrders/ebayImport.js` | **Remove** | No remaining callers once eBay buttons removed |
| `js/admin/lineItemsOrders/pirateShipImport.js` | **Needs verification** | Only caller is `wirePirateShipImport` in `index.js` |
| `js/admin/lineItemsOrders/shipReadyCsv.js` | **Needs verification** | Only caller is `btnExportShipReady` handler |

#### `dom.js` — `els` entries to remove

The following properties of the `els` object in `js/admin/lineItemsOrders/dom.js` reference removed HTML elements:

**eBay import els (remove):**
```
btnImportEbay, btnRematchEbay,
ebayPreviewPanel, ebayFileName, ebayTotalRows, ebayValidCount,
ebayConfirmBtn, ebayCancelBtn,
ebayResultPanel, ebayOrdersCount, ebayLineItemsCount,
ebayRevenue, ebaySkippedCount, ebayBreakdownWrap, ebayResultClose
```

**Pirate Ship import els (needs verification — remove with Pirate Ship button):**
```
btnImportPirateShip,
importPreviewPanel, importFileName, importRowCount, importPreviewBatchId,
importConfirmBtn, importCancelBtn,
importResultPanel, importUpdatedCount, importSkippedCount,
importBatchId, importResultClose
```

**Ship-ready export els (needs verification — remove with export button):**
```
btnExportShipReady
```

#### `dom.js` — helper functions to remove (if Pirate Ship import removed)

```
showImportPreview()   — only used by wirePirateShipImport callback
hideImportPreview()   — only used internally + importCancelBtn
showImportResult()    — only used by wirePirateShipImport onImported callback
```

These three functions are wired in `wireDomHelpers()` (the `importCancelBtn` listener) and exported for use in `index.js`. They have no other callers.

#### Edit modal field — `#fPirateShipShipmentId` (in `modalEditor.js`)

The edit modal (`#modal`) contains a field for "Pirate Ship Shipment ID" (`fPirateShipShipmentId`). It is read/written by `modalEditor.js`. If the Pirate Ship workflow is fully removed, this field loses its primary use case. However, `fulfillment_shipments` may still have historical rows with a `pirate_ship_shipment_id` column value — the field may remain useful for viewing/editing those records.

**Classification: Needs verification.**

---

### Related HTML/UI sections

#### eBay import button — remove
```html
<button id="btnImportEbay" ...>🏷️ Import eBay</button>
```

#### Re-match eBay button — remove
```html
<button id="btnRematchEbay" ...>🔄 Re-match eBay</button>
```

#### Pirate Ship import button — needs verification
```html
<button id="btnImportPirateShip" ... class="... drop-zone">🏴‍☠️ Import Pirate Ship</button>
```

#### Ship-ready export button — needs verification
```html
<button id="btnExportShipReady" ...>📦 Export Ship-Ready CSV</button>
```

#### Import Preview Panel (`#importPreviewPanel`) — needs verification (Pirate Ship)
Appears below the export buttons row. Shown when a Pirate Ship CSV is parsed. Contains:
- `#importFileName`, `#importRowCount`, `#importPreviewBatchId`
- `#importConfirmBtn`, `#importCancelBtn`

#### Import Result Panel (`#importResultPanel`) — needs verification (Pirate Ship)
Shown after a successful Pirate Ship import. Contains:
- `#importUpdatedCount`, `#importSkippedCount`, `#importBatchId`, `#importResultClose`

#### eBay Import Preview Panel (`#ebayPreviewPanel`) — remove
Contains:
- `#ebayFileName`, `#ebayTotalRows`, `#ebayValidCount`
- `#ebayConfirmBtn`, `#ebayCancelBtn`

#### eBay Import Result Panel (`#ebayResultPanel`) — remove
Contains:
- `#ebayOrdersCount`, `#ebayLineItemsCount`, `#ebayRevenue`, `#ebaySkippedCount`
- `#ebayBreakdownWrap`, `#ebayResultClose`

#### "Click or drag & drop file" hint label — review
```html
<span class="text-xs text-gray-400 ml-2">Click or drag & drop file</span>
```
This label appears in the export/import buttons container. If Pirate Ship and eBay buttons are removed and only Amazon drop remains, the label is still accurate. If Amazon is also removed eventually, remove this too.

---

### Related CSS

#### In `pages/admin/lineItemsOrders.html` `<style>` block (inline):

```css
/* Drop zone styling — keep if Amazon import is kept */
.drop-zone.is-drop-active { ... }
@keyframes pulse-border { ... }
```
Both `btnImportPirateShip` and `btnImportEbay` use `class="... drop-zone"`. `btnImportAmazon` also uses it. **Keep these styles** as long as Amazon import stays.

#### In `css/pages/admin/lineItemsOrders.css`:

No classes appear to be exclusively tied to the eBay or Pirate Ship import controls. The CSS uses generic shared classes (`.kk-admin-orders-exportRow`, `.kk-admin-btn-ghost`, etc.) that are reused across the export/import row. No targeted CSS removals are required here.

---

## Removal classification

### Safe to remove

| Item | Location |
|------|----------|
| `#btnImportEbay` button | `pages/admin/lineItemsOrders.html` |
| `#btnRematchEbay` button | `pages/admin/lineItemsOrders.html` |
| `#ebayPreviewPanel` div + all children | `pages/admin/lineItemsOrders.html` |
| `#ebayResultPanel` div + all children | `pages/admin/lineItemsOrders.html` |
| `wireEbayImport` wiring block in `wireEvents()` | `js/admin/lineItemsOrders/index.js` |
| `btnRematchEbay` click handler in `wireEvents()` | `js/admin/lineItemsOrders/index.js` |
| `import { wireEbayImport, rematchEbayProducts }` | `js/admin/lineItemsOrders/index.js` |
| `js/admin/lineItemsOrders/ebayImport.js` | entire file |
| eBay `els` entries (15 properties) | `js/admin/lineItemsOrders/dom.js` |

### Needs verification

| Item | Location | Verify |
|------|----------|--------|
| `#btnImportPirateShip` button | HTML | Is there any remaining need to re-import old Pirate Ship CSVs? |
| `#importPreviewPanel` + `#importResultPanel` divs | HTML | Tied to Pirate Ship import button |
| `#btnExportShipReady` button | HTML | Is the Ship-Ready CSV still useful outside Pirate Ship? Could it be kept as a general export? |
| `js/admin/lineItemsOrders/pirateShipImport.js` | entire file | Remove only after `btnImportPirateShip` is confirmed obsolete |
| `js/admin/lineItemsOrders/shipReadyCsv.js` | entire file | Remove only after `btnExportShipReady` is confirmed obsolete |
| `import { wirePirateShipImport }` | `index.js` | Remove with Pirate Ship button |
| `import { downloadShipReadyCSV }` | `index.js` | Remove with export button |
| Pirate Ship `els` entries + panel close wiring | `dom.js` | Remove with Pirate Ship panels |
| `showImportPreview`, `hideImportPreview`, `showImportResult` | `dom.js` | Only used by Pirate Ship import path |
| `#fPirateShipShipmentId` field in edit modal | HTML + `modalEditor.js` | Historical rows may still have this ID; decide if editable or display-only |

### Must keep

| Item | Reason |
|------|--------|
| `#btnImportAmazon` + `amazonPreviewPanel` + `amazonResultPanel` | Amazon has no API auto-sync; still the primary ingest method for Amazon orders |
| `js/admin/lineItemsOrders/amazonImport.js` | Used by Amazon import |
| All filters, search, date range, review filter, refresh, load more | Core page functionality |
| KPI cards (`#kpiOrders`, `#kpiRevenue`, `#kpiProfit`, `#kpiUnfulfilled`, `#kpiRefunded`) | Dashboard data |
| Edit modal (`#modal`) + `modalEditor.js` | Manual shipment correction |
| View modal (`#viewModal`) + all Shippo label buttons | Primary Shippo workflow |
| Refund buttons + `wireRefundButtons()` | Active feature |
| `api.js` — all functions | Used by modal, Shippo, refunds, filters |
| `renderTable.js` | Table rendering |
| `state.js` | Page state |
| `dom.js` — after removing obsolete `els` entries | Core DOM references |

---

## Risk notes

- **`ebayImport.js` exports `matchProduct` function** — this is a local copy of the matching logic also present in `supabase/functions/_shared/ebayUtils.ts`. Removing `ebayImport.js` does NOT affect the server-side version. Safe to remove the client file.
- **`dom.js` `wireDomHelpers()`** wires close buttons for `importResultPanel` and `ebayResultPanel`. When those panels are removed, the corresponding `els.*` references and wiring blocks must also be removed or the function will silently skip them (no crash, but dead code).
- **`showImportPreview` / `hideImportPreview` / `showImportResult`** are currently exported from `dom.js` and imported in `index.js`. Removing them from `dom.js` will cause a module-level import error in `index.js` if the import statement is not updated at the same time. **Remove both sides together.**
- **`pirateShipImport.js`** contains a self-contained CSV parser. If there is any chance historical Pirate Ship data needs to be re-imported (e.g., gap-filling old orders), keep the file and button until that window closes.
- **`shipReadyCsv.js`** is small and low-risk. If the export CSV is generally useful (e.g., for printing packing slips, manual records), keep `btnExportShipReady` under a renamed label ("Export Orders CSV") rather than removing it.
- **`fPirateShipShipmentId` field** — the `fulfillment_shipments` table likely has a `pirate_ship_shipment_id` column. Removing the form field does not remove the data; it only removes the ability to edit it from the UI.
- **Amazon imports** reference the same `showImportPreview` / `hideImportPreview` pattern indirectly? No — Amazon uses its own panels (`amazonPreviewPanel` / `amazonResultPanel`) wired entirely in `index.js` without calling `showImportPreview`. Amazon imports are safe.

---

## Proposed cleanup plan

Perform in this order to minimize risk and keep the page functional at every step.

### Step 1 — Remove eBay CSV import (no dependencies on other removals)
1. Delete `#btnImportEbay` button from HTML
2. Delete `#btnRematchEbay` button from HTML
3. Delete `#ebayPreviewPanel` div block from HTML
4. Delete `#ebayResultPanel` div block from HTML
5. Remove `wireEbayImport` wiring block from `wireEvents()` in `index.js`
6. Remove `btnRematchEbay` handler block from `wireEvents()` in `index.js`
7. Remove `import { wireEbayImport, rematchEbayProducts }` from `index.js`
8. Remove eBay `els` entries (15 properties) from `dom.js`
9. Remove eBay close-button wiring from `wireDomHelpers()` in `dom.js`
10. Delete `js/admin/lineItemsOrders/ebayImport.js`
11. Verify page loads without console errors

### Step 2 — Confirm Pirate Ship workflow retirement (decision gate)
- Confirm: are there any Pirate Ship CSV files that still need importing? If yes, defer Step 3 until complete.
- Confirm: is the Ship-Ready CSV useful to keep as a general export (possibly renamed)?

### Step 3 — Remove Pirate Ship import (after Step 2 decision)
1. Delete `#btnImportPirateShip` button from HTML
2. Delete `#importPreviewPanel` div block from HTML
3. Delete `#importResultPanel` div block from HTML
4. Remove `wirePirateShipImport` wiring block from `wireEvents()` in `index.js`
5. Remove `import { wirePirateShipImport }` from `index.js`
6. Remove Pirate Ship `els` entries from `dom.js`
7. Remove `importCancelBtn` close wiring from `wireDomHelpers()` in `dom.js`
8. Remove or keep `showImportPreview`, `hideImportPreview`, `showImportResult` from `dom.js` (remove if no other callers)
9. Delete `js/admin/lineItemsOrders/pirateShipImport.js`
10. Optionally remove `#fPirateShipShipmentId` field from edit modal HTML and `modalEditor.js`
11. Verify page loads without console errors

### Step 4 — Remove Ship-Ready export (after Step 2 decision)
1. Delete `#btnExportShipReady` button from HTML
2. Remove `btnExportShipReady` click handler from `wireEvents()` in `index.js`
3. Remove `import { downloadShipReadyCSV }` from `index.js`
4. Remove `btnExportShipReady` from `dom.js` `els`
5. Delete `js/admin/lineItemsOrders/shipReadyCsv.js`
6. Verify page loads without console errors

### Step 5 — Final CSS review
1. If Amazon import (`btnImportAmazon`) is still kept, the `.drop-zone` / `pulse-border` inline styles remain necessary.
2. Review `css/pages/admin/lineItemsOrders.css` — no targeted removals needed; confirm no orphan classes remain.

---

## Recommended next implementation doc

```
002_line_items_ebay_import_removal.md
```

Cover the exact code diff for Step 1 (eBay CSV import removal). That is the highest-confidence removal — no dependencies, no decision gates. Should include: exact HTML blocks to delete, exact `index.js` function blocks to delete, exact `dom.js` property list to delete, and the file deletion of `ebayImport.js`.
