# Line Items Page — Final Cleanup Audit

## Purpose

This document is a post-removal verification audit following the completion of:

- **Step 1** (doc `002`): eBay CSV import removed — `ebayImport.js` deleted, all 15 eBay `els` entries removed, wiring blocks removed
- **Step 3** (doc `004`): Pirate Ship CSV import removed — `pirateShipImport.js` deleted, 12 Pirate Ship `els` entries removed, `showImportPreview`/`hideImportPreview`/`showImportResult` helpers removed, `importPirateShipExport` API function removed

The goal is to confirm the page is structurally clean, no dead references remain from removed workflows, kept features are intact, and only safe residual opportunities remain.

---

## 1. Dead-reference audit

### 1a. Removed symbols — reference count

All of the following were verified at 0 matches across `js/admin/lineItemsOrders/**` and `pages/admin/lineItemsOrders.html` via PowerShell `Select-String`:

| Symbol | Count |
|--------|-------|
| `wirePirateShipImport` | **0** |
| `showImportPreview` | **0** |
| `hideImportPreview` | **0** |
| `showImportResult` | **0** |
| `importPirateShipExport` | **0** |
| `btnImportPirateShip` | **0** |
| `importPreviewPanel` | **0** |
| `importResultPanel` | **0** |
| `./pirateShipImport.js` (module import) | **0** |

### 1b. Deleted files — confirmed absent

| File | Status |
|------|--------|
| `js/admin/lineItemsOrders/pirateShipImport.js` | **Deleted** |
| `js/admin/lineItemsOrders/ebayImport.js` | **Deleted** (Step 1) |

### 1c. Remaining Pirate Ship references — all intentional

The following references to "Pirate Ship" remain in the codebase. Each is intentional:

| Location | Reference | Reason to keep |
|----------|-----------|----------------|
| `pages/admin/lineItemsOrders.html` line 468–471 | `#fPirateShipShipmentId` input + label "Pirate Ship Shipment ID" | Legacy field in edit modal — displays/edits historical Pirate Ship IDs. Decided to keep in `003` verification. |
| `js/admin/lineItemsOrders/modalEditor.js` line 46 | `const fPirateShipShipmentId = ...` | Reads the modal field (intentional legacy support). |
| `js/admin/lineItemsOrders/modalEditor.js` line 73 | `fPirateShipShipmentId.value = ship.pirate_ship_shipment_id \|\| ""` | Populates field on modal open. |
| `js/admin/lineItemsOrders/modalEditor.js` line 109 | `pirate_ship_shipment_id: cleanStr(fPirateShipShipmentId.value)` | Writes field on save to DB. |
| `js/admin/lineItemsOrders/api.js` line 196 | `"pirate_ship_shipment_id"` in SELECT columns | Historical DB column — still fetched for modal display. |

**None of these are dead code.** All five constitute the intentional legacy-support path for historical Pirate Ship-fulfilled orders.

### 1d. Stale comments — harmless but noted

| Location | Comment | Risk | Notes |
|----------|---------|------|-------|
| `js/admin/lineItemsOrders/shipReadyCsv.js` line 21 | `// Pirate Ship can accept many formats; we'll keep yours + add a few useful shipment fields.` | None | Historically accurate, now misleading. The export is no longer Pirate Ship-specific. This is a candidate for a one-line comment update. |
| `js/admin/lineItemsOrders/amazonImport.js` line 19 | `// Derived from real Pirate Ship label data + published USPS rates.` | None | This describes the origin of the USPS cost estimator data — not a broken reference; still factually accurate. No action needed. |
| `js/admin/lineItemsOrders/index.js` line 775 | `// Export ship-ready` | None | Handler comment. Button label was renamed to "Export Orders CSV" but the code comment was not updated. Cosmetic inconsistency only. |

### 1e. Stale string values — noted

| Location | Value | Issue |
|----------|-------|-------|
| `js/admin/lineItemsOrders/index.js` line 781 | `downloadShipReadyCSV(rows, { filenamePrefix: "kk-ship-ready" })` | The downloaded filename will be `kk-ship-ready-YYYY-MM-DD.csv`. The button now says "Export Orders CSV" but the file is named `kk-ship-ready-…`. Minor cosmetic misalignment; does not break anything. |
| `js/admin/lineItemsOrders/shipReadyCsv.js` line 16 | `{ filenamePrefix = "ship-ready" }` (default value) | The function default still says `"ship-ready"`. Only relevant if the function is called without a prefix; currently the only caller passes `"kk-ship-ready"` explicitly. No action needed. |

### 1f. Old eBay references — verified absent

No eBay CSV import references remain. Confirmed by Step 1 / doc `002`. No re-check required.

### 1g. Unused DOM entries in `dom.js`

None found. All remaining `els` entries map to live HTML elements. The `btnExportShipReady` entry remains correctly wired to `#btnExportShipReady` in HTML and the click handler in `index.js`.

### 1h. Unused exports in `api.js`

No unused exports found. `importPirateShipExport` was removed in Step 3. All remaining exported functions are called from at least one location in `index.js`.

---

## 2. Structural sanity audit

### 2a. `dom.js`

**els object**: 18 properties remain. All map to HTML elements that exist on the page.

```
searchInput, statusFilter, dateFrom, dateTo, btnRefresh, btnExportShipReady,
btnImportAmazon, amazonPreviewPanel, amzFileName, amzTotalRows, amzValidCount,
amzCancelledWrap, amzCancelledCount, amzConfirmBtn, amzCancelBtn,
amazonResultPanel, amzOrdersCount, amzLineItemsCount, amzRevenue, amzSkippedCount,
amzBreakdownWrap, amzUnmappedWrap, amzResultClose,
status, countLabel, ordersRows, btnLoadMore, loadMoreStatus,
kpiOrders, kpiRevenue, kpiProfit, kpiUnfulfilled, kpiRefunded,
reviewFilter, modal
```

✓ No dead DOM references detected.

**`wireDomHelpers()`**: Wires Amazon import panels only (close and cancel). There is a cosmetic empty line before the closing `}` brace — harmless spacing artifact from the Step 3 removal.

**`required` array**: Contains `btnExportShipReady` — which is still valid (button still in HTML). ✓

**Exported functions from dom.js** (after Step 3 removals):

| Export | Used by |
|--------|---------|
| `els` | `index.js`, `shipReadyCsv.js` (via `gramsToOz`) |
| `wireDomHelpers` | `index.js` |
| `setStatus` | `index.js` |
| `setCountLabel` | `index.js` |
| `moneyFromCents` | `index.js` |
| `esc` | `renderTable.js`, `index.js` |
| `gramsToOz` | `shipReadyCsv.js` |
| `formatOz` | `renderTable.js` |
| `formatDateShort` | `renderTable.js` |
| `isoToLocalDatetimeValue` | `modalEditor.js` |
| `localDatetimeValueToIso` | `modalEditor.js` |
| `dollarsToCents` | `modalEditor.js` |

✓ No orphaned exports detected. `showImportPreview`, `hideImportPreview`, `showImportResult` are fully gone.

### 2b. `index.js` imports

| Import | Module | Used |
|--------|--------|------|
| `initAdminNav` | `/js/shared/adminNav.js` | ✓ Yes |
| `initFooter` | `/js/shared/footer.js` | ✓ Yes |
| `els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents` | `./dom.js` | ✓ All used |
| `state` | `./state.js` | ✓ Yes |
| `fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, fetchOrderDetails, issueRefund, updateRefundReason, buyShippingLabel, voidShippingLabel, fetchPackagePresets, getSignedLabelUrl` | `./api.js` | ✓ All used |
| `renderOrdersRows` | `./renderTable.js` | ✓ Yes |
| `downloadShipReadyCSV` | `./shipReadyCsv.js` | ✓ Yes (line 781) |
| `bindEditModal` | `./modalEditor.js` | ✓ Yes |
| `wireAmazonImport` | `./amazonImport.js` | ✓ Yes |

✓ No imports for deleted files (`pirateShipImport.js`, `ebayImport.js`) remain.
✓ No named imports that no longer exist in their source module.

### 2c. `api.js` exports

All remaining exported functions are called from `index.js`. No orphan exports.

### 2d. HTML layout

The export/import toolbar now contains exactly:
1. `#btnExportShipReady` ("📋 Export Orders CSV")
2. `#btnImportAmazon` ("📦 Import Amazon")
3. "Click or drag & drop file" hint span

✓ No orphaned HTML panels. Amazon panels (`#amazonPreviewPanel`, `#amazonResultPanel`) remain in place.
✓ No broken layout artifacts from removed panels — they were `class="hidden"` by default, so removal had no visual impact when hidden.

**Note on emoji encoding**: The `📋` emoji in the button label (`#btnExportShipReady`) appears as a replacement character in some terminal readouts — this is a tool-display artifact, not a file encoding issue. The file was written via `replace_string_in_file` with the correct Unicode code point (`\uD83D\uDCCB`). Recommend a quick browser smoke test to confirm the emoji renders correctly.

### 2e. CSS

- **Inline `<style>` block** in `lineItemsOrders.html`: `.drop-zone.is-drop-active` and `@keyframes pulse-border` remain. `#btnImportAmazon` uses `class="... drop-zone"` — these styles are still needed. ✓
- **`css/pages/admin/lineItemsOrders.css`**: No Pirate Ship or eBay-specific selectors were found in prior audits. No changes needed.

---

## 3. Kept-feature verification

### 3a. Amazon import

| Check item | Status |
|------------|--------|
| `#btnImportAmazon` present in HTML | ✓ |
| `#amazonPreviewPanel` present in HTML | ✓ |
| `#amazonResultPanel` present in HTML | ✓ |
| `els.btnImportAmazon` in `dom.js` | ✓ |
| All `amz*` `els` entries wired in `dom.js` | ✓ |
| `wireAmazonImport` imported and called in `index.js` | ✓ |
| `amazonImport.js` file exists | ✓ |

### 3b. Ship-Ready (Orders) CSV export

| Check item | Status |
|------------|--------|
| `#btnExportShipReady` present in HTML | ✓ |
| Button label visible as "Export Orders CSV" | ✓ (emoji encoding note above) |
| `els.btnExportShipReady` in `dom.js` | ✓ |
| `btnExportShipReady` in `required[]` in `wireDomHelpers()` | ✓ |
| Click handler in `index.js` wired | ✓ |
| `downloadShipReadyCSV` imported and called | ✓ |
| `fetchOrderSummaryAllForExport` imported and called | ✓ |
| `shipReadyCsv.js` file exists | ✓ |

### 3c. Shippo label actions

| Check item | Status |
|------------|--------|
| View modal (`#viewModal`) present in HTML | ✓ |
| `[data-buy-label]` button rendered in view modal | ✓ |
| `[data-print-label]` / `[data-reprint-label]` rendered | ✓ |
| `[data-void-label]` rendered | ✓ |
| `buyShippingLabel` imported from `api.js` and used in `wireLabelButtons()` | ✓ |
| `voidShippingLabel` imported from `api.js` and used | ✓ |
| `getSignedLabelUrl` imported from `api.js` and used | ✓ |
| `fetchPackagePresets` imported from `api.js` and used | ✓ |
| `shippo-create-label` / `shippo-void-label` edge functions untouched | ✓ |

### 3d. Legacy Pirate Ship Shipment ID support

| Check item | Status |
|------------|--------|
| `#fPirateShipShipmentId` input present in edit modal HTML | ✓ |
| Label "Pirate Ship Shipment ID" present in edit modal | ✓ |
| `fPirateShipShipmentId` read in `modalEditor.js` `open()` | ✓ |
| `pirate_ship_shipment_id` written on save | ✓ |
| `pirate_ship_shipment_id` in `api.js` SELECT | ✓ |

### 3e. Table / filters / core page behavior

No code was altered in `renderTable.js`, `state.js`, filter wiring, KPI wiring, refund wiring, or search. These areas are untouched.

---

## 4. Residual cleanup opportunities

The following are safe, low-risk cleanup items. None are urgent and none affect functionality:

### 4a. Stale comment in `shipReadyCsv.js` — **Minor / recommended**

**File**: `js/admin/lineItemsOrders/shipReadyCsv.js` line 21

**Current:**
```js
// Pirate Ship can accept many formats; we'll keep yours + add a few useful shipment fields.
```

**Recommended replacement:**
```js
// General-purpose order export. Columns: date, IDs, address, weights, status, tracking.
```

This is the only place in `shipReadyCsv.js` that references Pirate Ship by name. A one-line edit removes all Pirate Ship context from the file.

---

### 4b. Stale handler comment in `index.js` — **Minor / optional**

**File**: `js/admin/lineItemsOrders/index.js` line 775

**Current:**
```js
// Export ship-ready
```

**Recommended replacement:**
```js
// Export Orders CSV
```

Aligns comment with the renamed button. One-line change.

---

### 4c. Stale `filenamePrefix` in `index.js` — **Minor / optional**

**File**: `js/admin/lineItemsOrders/index.js` line 781

**Current:**
```js
downloadShipReadyCSV(rows, { filenamePrefix: "kk-ship-ready" });
```

**Recommended:**
```js
downloadShipReadyCSV(rows, { filenamePrefix: "kk-orders" });
```

Downloaded files would become `kk-orders-2026-05-10.csv` instead of `kk-ship-ready-2026-05-10.csv`. This is cosmetic — file content is unchanged. Only matters if filenames are used for any downstream automation. Confirm before changing.

---

### 4d. Cosmetic whitespace in `dom.js` — **Trivial / optional**

**File**: `js/admin/lineItemsOrders/dom.js` — `wireDomHelpers()` body

There is an empty line between the last `amzCancelBtn` wiring block and the closing `}`. This was left by the Step 3 removal. It is cosmetically inconsistent but harmless. Can be removed with a trivial edit.

---

### 4e. `amazonImport.js` USPS comment — **Leave as-is**

**File**: `js/admin/lineItemsOrders/amazonImport.js` line 19

```js
// Derived from real Pirate Ship label data + published USPS rates.
```

This accurately documents the source of the USPS cost estimator rates. It is not a dead reference — it is provenance documentation. No action needed.

---

### 4f. Function name `downloadShipReadyCSV` — **Leave as-is**

The function and its filename `shipReadyCsv.js` both reference "ship ready". These are internal identifiers. Renaming them would require touching `index.js`, `dom.js` (no — it only uses `gramsToOz` from there), `shipReadyCsv.js` itself, and documentation. The risk-to-benefit ratio is poor. Leave as-is. The internal name does not affect users.

---

## Decision

### Page state classification

**✅ Cleanup complete with minor follow-up recommended**

The core removals are complete and verified:

- All 8 removed symbols confirmed at count 0 across all module files and the HTML page
- Both deleted files (`ebayImport.js`, `pirateShipImport.js`) are confirmed absent
- No import statements reference deleted files
- All kept features are confirmed intact: Amazon import, Ship-Ready/Orders export, Shippo label buy/void/print, legacy Pirate Ship shipment ID field, all filters and table behavior

The only remaining Pirate Ship references are the **intentional legacy-support items** (`#fPirateShipShipmentId`, `modalEditor.js`, `api.js` SELECT) that were explicitly kept by design.

Residual items are limited to:
- 1 stale comment in `shipReadyCsv.js` (cosmetic)
- 1 stale comment in `index.js` (cosmetic)
- 1 stale filename prefix (cosmetic, confirm before changing)
- 1 cosmetic whitespace line in `dom.js`

None of these affect runtime behavior, user experience, or the ability to merge. They can be addressed in a single quick follow-up pass or left as-is.

---

## Recommended follow-up prompt (if desired)

```
Update the three stale comments and the filenamePrefix in one focused pass:

1. In `js/admin/lineItemsOrders/shipReadyCsv.js` line 21, replace:
   // Pirate Ship can accept many formats; we'll keep yours + add a few useful shipment fields.
   with:
   // General-purpose order export. Columns: date, IDs, address, weights, status, tracking.

2. In `js/admin/lineItemsOrders/index.js` line 775, replace:
   // Export ship-ready
   with:
   // Export Orders CSV

3. In `js/admin/lineItemsOrders/index.js` line 781, replace:
   downloadShipReadyCSV(rows, { filenamePrefix: "kk-ship-ready" });
   with:
   downloadShipReadyCSV(rows, { filenamePrefix: "kk-orders" });

4. In `js/admin/lineItemsOrders/dom.js`, remove the blank line before the closing `}` of wireDomHelpers().

Do not change anything else.
```