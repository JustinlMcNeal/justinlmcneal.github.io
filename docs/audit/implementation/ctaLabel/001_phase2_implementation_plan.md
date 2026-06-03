# Phase 2B CTA Label — Implementation Plan

**Doc ID:** 001  
**Created:** 2026-05-17  
**Status:** Planning only — no implementation  
**Phase:** 2B (first implementation)  
**Depends on:** `000_phase2_cta_label_audit.md`, Phase 1 refactor complete

---

## 1. Summary

Phase 2B adds a "Print CTA Label" button to each order row in the admin line items orders table. Clicking it opens a browser print window with a source-appropriate label:

- **KK orders**: Review CTA — QR points to `leave-review.html?oid=<kk_order_id>`
- **eBay orders**: Direct website CTA — QR points to `https://karrykraze.com`
- **Amazon orders**: Deferred — button renders but prints a placeholder "not supported" notice
- **Unknown source**: Button hidden

No workspace changes are needed for Phase 2B. No DB migrations are needed for Phase 2B (analytics columns are Phase 2C).

---

## 2. Build Order

```
Step 1: Generic discount code — verify or create in Supabase coupons table
Step 2: Implement labelPrint.js — all 4 stub functions + QR helper
Step 3: Wire getRowExtras in index.js — import printLabel, generate button HTML
Step 4: Test in browser print preview
Step 5: (Phase 2C) Add analytics columns to fulfillment_shipments
```

---

## 3. File-by-File Plan

### 3A. `js/admin/lineItemsOrders/labelPrint.js`

Full replacement of the stub. All logic in one file.

#### Exports to implement:

```js
// Determine which label template to use
export function determineLabelType(source)
// "kk" → "review_cta"
// "ebay" | "amazon" → "channel_cta"
// "unknown" → "none"

// Build the full print-window HTML string
export function buildLabelHtml(order, labelType)
// Calls buildReviewQrUrl / buildMarketingQrUrl internally
// Calls generateQrDataUrl (async) — caller must await
// Returns: complete <html> string ready for print window injection

// Open print window with appropriate label for the order
export async function printLabel(order)
// 1. Gets source via getOrderSource(order)
// 2. Calls determineLabelType(source)
// 3. Calls buildLabelHtml(order, labelType)
// 4. Opens a print window and injects the HTML
// 5. Calls window.print() after image (QR) loads

// Record label print in analytics (Phase 2C — no-op in 2B)
export async function trackLabelPrint(sessionId)
// Phase 2B: no-op stub (no DB write yet)
// Phase 2C: upsert label_printed_at + label_type into fulfillment_shipments
```

#### Internal helpers (not exported):

```js
// Construct the review deep-link URL for KK orders
function buildReviewQrUrl(order)
// Returns: "https://karrykraze.com/pages/leave-review.html?oid=" + encodeURIComponent(order.kk_order_id)

// Construct the marketing URL for eBay/Amazon orders
function buildMarketingQrUrl()
// Returns: "https://karrykraze.com"
// Phase 3: add UTM params + source-specific landing page

// Generate a QR code as a data URL (PNG or SVG) using esm.sh qrcode library
// Loaded lazily — imported only when printLabel is called
async function generateQrDataUrl(url)
// Returns: data:image/png;base64,... string
// On failure: returns null (label renders without QR as fallback)
```

#### Label HTML specs:

**KK Review CTA (`review_cta`)**
```
Page size: @page { size: 3.5in 2in; margin: 0; }
Layout:
  ┌───────────────────────────────┐
  │ ■■ KARRY KRAZE              ■■│  ← brand bar
  │                               │
  │  "Thanks for your order!"     │  ← headline (customer first name if available)
  │                               │
  │  [QR CODE ~ 0.85in]           │  ← QR to leave-review?oid=...
  │                               │
  │  Scan · Leave a Review        │
  │  Get 15% off your next order  │  ← CTA copy
  │  Code: THANKYOU15             │  ← discount code
  │                               │
  │  karrykraze.com               │  ← footer
  └───────────────────────────────┘
```

**eBay Channel CTA (`channel_cta`)**
```
Page size: @page { size: 3.5in 2in; margin: 0; }
Layout:
  ┌───────────────────────────────┐
  │ ■■ KARRY KRAZE              ■■│
  │                               │
  │  "Like your order?"           │
  │  Order direct for less!       │
  │                               │
  │  [QR CODE ~ 0.85in]           │  ← QR to karrykraze.com
  │                               │
  │  Scan for 15% off your        │
  │  first website order          │
  │  Code: DIRECT15               │
  │                               │
  │  karrykraze.com               │
  └───────────────────────────────┘
```

**Amazon placeholder (`channel_cta` for amazon, or skip for now)**

In Phase 2B: button present for Amazon source but prints a simple text note:
```
Amazon CTA labels are not yet supported.
KK Order: <kk_order_id>
```

#### Discount codes (must be verified in DB before Phase 2B ships):

| Code | Source | Amount | Must exist in `coupons` table |
|---|---|---|---|
| `THANKYOU15` | KK orders | 15% off | Create if absent |
| `DIRECT15` | eBay/Amazon | 15% off first website order | Create if absent |

_Note: These are generic reusable codes. Create them in the admin coupons system or directly insert — no new table migration needed._

---

### 3B. `js/admin/lineItemsOrders/index.js`

Add the `getRowExtras` callback when calling `renderOrdersRows`. 

**Import addition (top of file):**
```js
import { printLabel } from "./labelPrint.js";
import { getOrderSource } from "./dom.js";  // already imported via wireDomHelpers — confirm
```

Note: `getOrderSource` is already exported from `dom.js` and imported in `renderTable.js`. Check whether `index.js` already imports it. If not, add the import.

**Wire `getRowExtras`:**

At the call site(s) where `renderOrdersRows` is invoked, add:

```js
renderOrdersRows({
  tbodyEl: els.ordersRows,
  rows: currentRows,
  onEdit: (row) => openWorkspace(row),
  onView: (row) => openWorkspace(row, { tab: "overview" }),
  getRowExtras: (row) => {
    const source = getOrderSource(row);
    if (source === "unknown") return {};
    return {
      desktopActionContent: buildCtaButtonHtml(row, source),
      mobileActionBlock: buildCtaMobileHtml(row, source),
    };
  },
});
```

**Button HTML builders (private helpers in index.js):**

```js
function buildCtaButtonHtml(row, source) {
  const label = source === "kk" ? "🏷 CTA Label" : "🏷 Channel Label";
  return `<button
    type="button"
    data-print-cta="${row.stripe_checkout_session_id}"
    class="inline-flex items-center gap-2 border-[4px] border-kkpink text-kkpink bg-white px-3 py-2
           font-black uppercase tracking-[.14em] text-[11px]
           hover:bg-kkpink hover:text-black transition ml-2"
    title="Print CTA label"
  >${label}</button>`;
}

function buildCtaMobileHtml(row, source) {
  const label = source === "kk" ? "🏷 Print CTA Label" : "🏷 Print Channel Label";
  return `<div class="mt-3 flex justify-end">
    <button
      type="button"
      data-print-cta="${row.stripe_checkout_session_id}"
      class="inline-flex items-center gap-2 border-[4px] border-kkpink text-kkpink bg-white px-3 py-2
             font-black uppercase tracking-[.14em] text-[11px]
             hover:bg-kkpink hover:text-black transition"
      title="Print CTA label"
    >${label}</button>
  </div>`;
}
```

**Event delegation — add after renderOrdersRows call:**

```js
els.ordersRows.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-print-cta]");
  if (!btn) return;
  e.stopPropagation();
  const sessionId = btn.getAttribute("data-print-cta");
  const row = currentRows.find(r => r.stripe_checkout_session_id === sessionId);
  if (!row) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "⏳ Loading…";
  try {
    await printLabel(row);
  } catch (err) {
    alert("Failed to print label: " + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});
```

**Important:** `currentRows` must be the module-level array of current rows (whatever variable `renderOrdersRows` receives). Confirm the variable name in `index.js` before implementing.

---

### 3C. No workspace changes for Phase 2B

The workspace Fulfillment tab (`workspaceFulfillment.js`) does not need changes in Phase 2B. Phase 3 can add a Labels tab or a preview panel inside the workspace.

---

### 3D. No HTML/CSS changes for Phase 2B

The print window is opened programmatically. No changes to `pages/admin/lineItemsOrders.html` or any CSS files.

---

## 4. Import Chain (Circular Check)

```
index.js
  → labelPrint.js          (new import)
  → dom.js (getOrderSource) (already imported)

labelPrint.js
  → dom.js (getOrderSource, esc)  (clean — dom.js imports nothing from this module)
  → qrcode via esm.sh             (external CDN, lazy import)

No circular imports.
```

---

## 5. Print Window Implementation Detail

Pattern already established by `_wireLabelButtons` in `workspace.js`:

```js
async function printLabel(order) {
  const source = getOrderSource(order);
  const labelType = determineLabelType(source);
  if (labelType === "none") return;

  const pw = window.open("", "ctaLabel", "width=400,height=300");
  if (!pw) {
    alert("Popup blocked — please allow popups for this site.");
    return;
  }
  pw.document.write(
    "<!DOCTYPE html><html><head><title>Loading…</title></head><body><p>Preparing label…</p></body></html>"
  );
  pw.document.close();

  const html = await buildLabelHtml(order, labelType); // async for QR generation
  pw.document.open();
  pw.document.write(html);
  pw.document.close();
  // print() called from within the label HTML via onload handler
}
```

The label HTML should include:
```html
<body onload="setTimeout(function(){window.print();},300)">
```

This pattern matches the existing shipping label print flow.

---

## 6. Testing Checklist

### Pre-implementation:
- [ ] Verify `THANKYOU15` coupon exists in Supabase `coupons` table
- [ ] Verify `DIRECT15` coupon exists in Supabase `coupons` table
- [ ] Confirm `qrcode` package resolves at `https://esm.sh/qrcode@1`

### Implementation:
- [ ] `node --check js/admin/lineItemsOrders/*.js` passes after changes
- [ ] No circular imports (run `grep -r "from.*index" js/admin/lineItemsOrders/`)

### Functional:
- [ ] KK order row: "🏷 CTA Label" button appears
- [ ] eBay order row: "🏷 Channel Label" button appears
- [ ] Amazon order row: button appears with appropriate label
- [ ] Unknown source row: no CTA button rendered
- [ ] KK label: QR code renders and scans to `leave-review.html?oid=<correct_id>`
- [ ] eBay label: QR code renders and scans to `karrykraze.com`
- [ ] Print dialog opens in Chrome (test popup permission first)
- [ ] Label layout looks reasonable at 3.5"×2" in print preview
- [ ] QR code is scannable after printing (verify with phone)
- [ ] Discount code visible on label
- [ ] Error state: QR lib CDN fails → label still prints with text URL fallback
- [ ] Error state: popup blocked → alert shown, no crash
- [ ] Clicking Edit button still works normally (no interference from CTA button)
- [ ] Mobile card: CTA button appears below stats grid

### Regression:
- [ ] Workspace still opens correctly on Edit click
- [ ] Existing shipping label print (in workspace) still works
- [ ] Table sort/filter/search still works
- [ ] All 15 existing JS files still pass `node --check`

---

## 7. Rollback Plan

Phase 2B changes are confined to:
1. `labelPrint.js` (was a stub — rollback = restore stub content)
2. `index.js` (3 additions: import, `getRowExtras` callback, event listener)

Rollback steps:
1. Restore `labelPrint.js` to stub (4 empty functions with comments)
2. Remove `import { printLabel }` from `index.js`
3. Remove `getRowExtras` param from `renderOrdersRows` call in `index.js`
4. Remove `data-print-cta` event listener from `index.js`

No DB changes in Phase 2B → no DB rollback needed.

---

## 8. What Stays Out of Phase 2B

| Feature | Deferred to |
|---|---|
| `trackLabelPrint()` DB write | Phase 2C |
| `label_printed_at` / `label_type` columns in DB | Phase 2C |
| QR scan tracking (redirect counter) | Phase 3 |
| Workspace Labels tab | Phase 3 |
| Per-order generated coupon codes | Phase 3+ |
| Amazon-specific CTA content | Phase 3 (Amazon API not integrated) |
| UTM params on eBay QR URL | Phase 2C |
| Label preview in workspace | Phase 3 |
| Label size option (3.5"×2" vs 4"×6") | Phase 3 |
