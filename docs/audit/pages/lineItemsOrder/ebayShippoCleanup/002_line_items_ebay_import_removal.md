# Line Items Page — eBay Import Removal

## Purpose

The manual eBay CSV import workflow was the original way to ingest eBay orders into the system. An admin would download an "Orders Report" CSV from eBay Seller Hub, then drop it onto the page to parse and upsert into `orders_raw` + `line_items_raw`.

That workflow is now fully replaced by the `ebay-sync-orders` Supabase Edge Function, which queries the eBay Fulfillment API directly and runs automatically every 2 hours via `pg_cron` (configured in `supabase/SETUP_EBAY_SYNC_CRON.sql`). The Edge Function also performs product matching on every sync run, making the "Re-match eBay" button redundant.

This document records the exact changes made to remove the manual eBay CSV import and re-match controls from the page.

---

## In-scope removals

| Item | Type | Location |
|------|------|----------|
| `#btnImportEbay` button | HTML | `pages/admin/lineItemsOrders.html` |
| `#btnRematchEbay` button | HTML | `pages/admin/lineItemsOrders.html` |
| `#ebayPreviewPanel` div + all children | HTML | `pages/admin/lineItemsOrders.html` |
| `#ebayResultPanel` div + all children | HTML | `pages/admin/lineItemsOrders.html` |
| `import { wireEbayImport, rematchEbayProducts }` | JS import | `js/admin/lineItemsOrders/index.js` |
| `wireEbayImport(...)` call block | JS | `js/admin/lineItemsOrders/index.js` |
| `btnRematchEbay` click handler block | JS | `js/admin/lineItemsOrders/index.js` |
| 15 eBay `els` properties | JS | `js/admin/lineItemsOrders/dom.js` |
| eBay result close wiring block | JS | `js/admin/lineItemsOrders/dom.js` |
| `js/admin/lineItemsOrders/ebayImport.js` | File | deleted |

---

## Files edited

- `pages/admin/lineItemsOrders.html`
- `js/admin/lineItemsOrders/index.js`
- `js/admin/lineItemsOrders/dom.js`

## File deleted

- `js/admin/lineItemsOrders/ebayImport.js`

---

## Planned code removals

### `pages/admin/lineItemsOrders.html`

**Remove** the two eBay buttons from the Export Buttons flex row:
- `<button id="btnImportEbay" ...>🏷️ Import eBay</button>`
- `<button id="btnRematchEbay" ...>🔄 Re-match eBay</button>`

**Remove** the eBay Import Preview Panel div:
```html
<!-- eBay Import Preview Panel -->
<div id="ebayPreviewPanel" class="hidden mt-4 ...">
  ...
</div>
```

**Remove** the eBay Import Result Panel div:
```html
<!-- eBay Import Result Panel -->
<div id="ebayResultPanel" class="hidden mt-4 ...">
  ...
</div>
```

---

### `js/admin/lineItemsOrders/index.js`

**Remove** the eBay import statement (top of file):
```js
import { wireEbayImport, rematchEbayProducts } from "./ebayImport.js";
```

**Remove** the full `wireEbayImport({...})` call block inside `wireEvents()`.

**Remove** the full `if (els.btnRematchEbay) { ... }` handler block inside `wireEvents()`.

---

### `js/admin/lineItemsOrders/dom.js`

**Remove** the `// eBay import elements` section from the `els` object (15 properties):
```js
// eBay import elements
btnImportEbay, btnRematchEbay,
ebayPreviewPanel, ebayFileName, ebayTotalRows, ebayValidCount,
ebayConfirmBtn, ebayCancelBtn,
ebayResultPanel, ebayOrdersCount, ebayLineItemsCount,
ebayRevenue, ebaySkippedCount, ebayBreakdownWrap, ebayResultClose
```

**Remove** the eBay result-close wiring block from `wireDomHelpers()`:
```js
// Wire close/cancel for eBay import panels
if (els.ebayResultClose) {
  els.ebayResultClose.addEventListener("click", () => {
    if (els.ebayResultPanel) els.ebayResultPanel.classList.add("hidden");
  });
}
```

---

## Risk controls

- **Do not touch** `#btnImportPirateShip`, `#importPreviewPanel`, `#importResultPanel` — Pirate Ship removal is deferred to Step 3.
- **Do not touch** `#btnExportShipReady` or `shipReadyCsv.js` — deferred to Step 4.
- **Do not touch** any Amazon import controls or `amazonImport.js`.
- **Do not touch** `wireDomHelpers()` import cancel block or `showImportPreview` / `hideImportPreview` / `showImportResult` — all still used by Pirate Ship.
- **Do not touch** any Shippo label buttons, `wireLabelButtons()`, `wireRefundButtons()`, or any API functions.
- **Do not touch** `ebay-sync-orders` edge function or cron config — this removal is UI-only.

---

## Verification checklist

After the changes:

- [ ] Page loads without any JavaScript errors in DevTools console
- [ ] No `Uncaught SyntaxError` or `Cannot resolve module` errors
- [ ] `Import eBay` button no longer visible
- [ ] `Re-match eBay` button no longer visible
- [ ] Amazon import button still visible and functional
- [ ] Pirate Ship import button still visible
- [ ] Ship-Ready CSV export button still visible
- [ ] View modal Shippo label buttons (Buy Label, Print, Void) still work
- [ ] Order table loads and filters correctly
- [ ] KPI cards populate
- [ ] No references to `wireEbayImport`, `rematchEbayProducts`, or `./ebayImport.js` remain in the codebase

---

## Rollback notes

If the page breaks after this change, restore from git:

```bash
git checkout HEAD -- pages/admin/lineItemsOrders.html
git checkout HEAD -- js/admin/lineItemsOrders/index.js
git checkout HEAD -- js/admin/lineItemsOrders/dom.js
git checkout HEAD -- js/admin/lineItemsOrders/ebayImport.js
```

The eBay API sync (`ebay-sync-orders`) is unaffected by this change and will continue running on its cron schedule regardless.
