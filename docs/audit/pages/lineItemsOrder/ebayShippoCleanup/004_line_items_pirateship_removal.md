# Line Items Page — Pirate Ship Import Removal

## Purpose

The Pirate Ship CSV import workflow is being removed because it has been superseded by the Shippo integration. The old workflow required:

1. Exporting a Ship-Ready CSV → uploading it to Pirate Ship → bulk-buying labels → exporting Pirate Ship's shipment report → importing that report back into this page to sync tracking numbers and label costs into `fulfillment_shipments`.

With Shippo, labels are purchased per-order directly from the view modal (`shippo-create-label` edge function). Tracking and cost data are written to `fulfillment_shipments` automatically by the edge function — no CSV import step exists or is needed. The Pirate Ship button has had no functional purpose since Shippo was activated.

The Ship-Ready CSV export (`#btnExportShipReady`) is **retained** — it is a general-purpose order export useful for auditing, customer service reference, and weight-based reconciliation. Its label is being renamed from "📦 Export Ship-Ready CSV" to "📋 Export Orders CSV" to reflect that it is no longer Pirate Ship-specific.

---

## In-scope removals

| # | Item | File | Type |
|---|------|------|------|
| 1 | `#btnImportPirateShip` button | `pages/admin/lineItemsOrders.html` | HTML element |
| 2 | `#importPreviewPanel` + all children | `pages/admin/lineItemsOrders.html` | HTML panel |
| 3 | `#importResultPanel` + all children | `pages/admin/lineItemsOrders.html` | HTML panel |
| 4 | `import { wirePirateShipImport } from "./pirateShipImport.js"` | `js/admin/lineItemsOrders/index.js` | JS import |
| 5 | `wirePirateShipImport({...})` wiring block | `js/admin/lineItemsOrders/index.js` | JS handler block |
| 6 | `showImportResult, showImportPreview, hideImportPreview` | `js/admin/lineItemsOrders/index.js` | named imports from dom.js |
| 7 | `importPirateShipExport` | `js/admin/lineItemsOrders/index.js` | named import from api.js |
| 8 | `btnImportPirateShip` els entry | `js/admin/lineItemsOrders/dom.js` | DOM ref |
| 9 | `importPreviewPanel`, `importFileName`, `importRowCount`, `importPreviewBatchId`, `importConfirmBtn`, `importCancelBtn` els entries | `js/admin/lineItemsOrders/dom.js` | DOM refs (6 entries) |
| 10 | `importResultPanel`, `importUpdatedCount`, `importSkippedCount`, `importBatchId`, `importResultClose` els entries | `js/admin/lineItemsOrders/dom.js` | DOM refs (5 entries) |
| 11 | `"btnImportPirateShip"` from `required` array | `js/admin/lineItemsOrders/dom.js` | validation check |
| 12 | `importResultClose` click wiring block | `js/admin/lineItemsOrders/dom.js` | event wiring in `wireDomHelpers()` |
| 13 | `importCancelBtn` click wiring block | `js/admin/lineItemsOrders/dom.js` | event wiring in `wireDomHelpers()` |
| 14 | `showImportPreview()` function definition | `js/admin/lineItemsOrders/dom.js` | exported function |
| 15 | `hideImportPreview()` function definition | `js/admin/lineItemsOrders/dom.js` | exported function |
| 16 | `showImportResult()` function definition | `js/admin/lineItemsOrders/dom.js` | exported function |
| 17 | `importPirateShipExport` function | `js/admin/lineItemsOrders/api.js` | exported async function (calls `rpc_import_pirateship_export`) |
| 18 | `js/admin/lineItemsOrders/pirateShipImport.js` | entire file | JS module |

---

## Files to edit

| File | Change type |
|------|-------------|
| `pages/admin/lineItemsOrders.html` | Remove button + 2 panels; rename Export Ship-Ready label |
| `js/admin/lineItemsOrders/index.js` | Remove 3 imports, remove wiring block |
| `js/admin/lineItemsOrders/dom.js` | Remove 12 els entries, required[] entry, 2 wiring blocks, 3 function definitions |
| `js/admin/lineItemsOrders/api.js` | Remove `importPirateShipExport` function |
| `js/admin/lineItemsOrders/pirateShipImport.js` | Delete entire file |

---

## Planned code removals

### `pages/admin/lineItemsOrders.html`

1. **Delete the `#btnImportPirateShip` button block** (~8 lines):
   ```html
   <button
     id="btnImportPirateShip"
     type="button"
     class="border-4 border-black bg-white text-black px-4 py-2 font-black uppercase tracking-[.12em] text-[10px]
            hover:bg-black hover:text-white transition-all
            drop-zone"
   >
     🏴‍☠️ Import Pirate Ship
   </button>
   ```

2. **Delete `<!-- Import Preview Panel -->` comment + `#importPreviewPanel` div** with all children (~20 lines).

3. **Delete `<!-- Import Result Panel -->` comment + `#importResultPanel` div** with all children (~20 lines).

4. **Rename button label** in `#btnExportShipReady`:
   - Before: `📦 Export Ship-Ready CSV`
   - After: `📋 Export Orders CSV`

---

### `js/admin/lineItemsOrders/index.js`

1. **Remove line 10** entirely:
   ```js
   import { wirePirateShipImport } from "./pirateShipImport.js";
   ```

2. **Remove `showImportResult`, `showImportPreview`, `hideImportPreview`** from the dom.js import on line 4. Before:
   ```js
   import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents, showImportResult, showImportPreview, hideImportPreview } from "./dom.js";
   ```
   After:
   ```js
   import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents } from "./dom.js";
   ```

3. **Remove `importPirateShipExport`** from the api.js import on line 6. Before:
   ```js
   import { fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, importPirateShipExport, fetchOrderDetails, ... } from "./api.js";
   ```
   After:
   ```js
   import { fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, fetchOrderDetails, ... } from "./api.js";
   ```

4. **Remove `wirePirateShipImport({...})` block** from `wireEvents()` (~14 lines including comment).

---

### `js/admin/lineItemsOrders/dom.js`

1. Remove `btnImportPirateShip` line from `els`.
2. Remove the `// import preview panel` comment + 6 entries (`importPreviewPanel`, `importFileName`, `importRowCount`, `importPreviewBatchId`, `importConfirmBtn`, `importCancelBtn`).
3. Remove the `// import result panel` comment + 5 entries (`importResultPanel`, `importUpdatedCount`, `importSkippedCount`, `importBatchId`, `importResultClose`).
4. Remove `"btnImportPirateShip"` from the `required` array in `wireDomHelpers()`.
5. Remove `importResultClose` click wiring block (the "Wire close button for import result panel" block).
6. Remove `importCancelBtn` click wiring block (the "Wire cancel button for import preview panel" block).
7. Remove `export function showImportPreview(...)` definition.
8. Remove `export function hideImportPreview()` definition.
9. Remove `export function showImportResult(...)` definition.

---

### `js/admin/lineItemsOrders/api.js`

Remove the entire `importPirateShipExport` function:
```js
export async function importPirateShipExport({ batchId, rows } = {}) {
  ...
}
```
(~18 lines)

---

## Risk controls

The following items must remain **completely untouched**:

| Item | Reason |
|------|--------|
| `#btnExportShipReady` (ID attribute) | Still wired in `index.js`; only label text changes |
| `js/admin/lineItemsOrders/shipReadyCsv.js` | Still imported + used by Export Orders CSV handler |
| `downloadShipReadyCSV` import + handler in `index.js` | Active export feature |
| `fetchOrderSummaryAllForExport` in `api.js` | Called by Ship-Ready export handler |
| `#fPirateShipShipmentId` field in edit modal HTML | Historical data display |
| `fPirateShipShipmentId` read/write in `modalEditor.js` | Preserves ability to view/edit legacy Pirate Ship IDs |
| `pirate_ship_shipment_id` in `api.js` SELECT on `fulfillment_shipments` | Historical column; fetched for view in modal |
| `btnExportShipReady` in `els` (dom.js) | Still referenced by export handler |
| All Amazon import controls + `amazonImport.js` | Amazon has no API auto-sync |
| All Shippo buy/void label functionality | Primary label workflow |
| All refund buttons and wiring | Active feature |
| All KPI cards, filters, table, modal | Core page functionality |

---

## Verification checklist

After all edits, run these checks:

### Reference count checks (expect 0)
```powershell
$files = Get-ChildItem "js/admin/lineItemsOrders" -Recurse -File
$htmlFile = "pages/admin/lineItemsOrders.html"

# Should all return 0
Select-String -Path $files.FullName,$htmlFile -Pattern "wirePirateShipImport" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "pirateShipImport\.js" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "showImportPreview" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "hideImportPreview" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "showImportResult" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "importPirateShipExport" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "btnImportPirateShip" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "importPreviewPanel" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $files.FullName,$htmlFile -Pattern "importResultPanel" | Measure-Object | Select-Object -ExpandProperty Count
```

### File confirm (pirateShipImport.js should not exist)
```powershell
Test-Path "js/admin/lineItemsOrders/pirateShipImport.js"  # expect False
```

### Kept items still present (expect > 0)
```powershell
Select-String -Path $htmlFile -Pattern "btnExportShipReady" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $htmlFile -Pattern "Export Orders CSV" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $htmlFile -Pattern "btnImportAmazon" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path $htmlFile -Pattern "fPirateShipShipmentId" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path (Get-ChildItem "js/admin/lineItemsOrders" -Recurse -File).FullName -Pattern "downloadShipReadyCSV" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path (Get-ChildItem "js/admin/lineItemsOrders" -Recurse -File).FullName -Pattern "fetchOrderSummaryAllForExport" | Measure-Object | Select-Object -ExpandProperty Count
```

---

## Rollback notes

If the page breaks after these edits, restore from git:

```bash
git checkout HEAD -- pages/admin/lineItemsOrders.html
git checkout HEAD -- js/admin/lineItemsOrders/index.js
git checkout HEAD -- js/admin/lineItemsOrders/dom.js
git checkout HEAD -- js/admin/lineItemsOrders/api.js
git checkout HEAD -- js/admin/lineItemsOrders/pirateShipImport.js
```

The page has no build step — restoring files is sufficient to revert.

Most likely failure mode: a reference to one of the removed symbols was missed (e.g., the `showImportPreview` import removal) causing a module load error. Check the browser console for `SyntaxError` or `does not provide an export named`.
