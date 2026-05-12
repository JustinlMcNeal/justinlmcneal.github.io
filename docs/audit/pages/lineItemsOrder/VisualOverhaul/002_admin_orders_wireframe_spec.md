# Wireframe & Implementation Spec: Admin Orders Page — Visual Overhaul
**Document:** 002 · Built from `001_admin_orders_ux_audit.md`  
**Date:** 2026-05  
**Status:** Pre-implementation spec — all decisions locked, ambiguity removed  
**Theme constraint:** Neo-brutalist (border-4 border-black, font-black, uppercase tracking, kkpink accent). No soft-UI drift.

---

## Table of Contents
1. [Desktop Page Layout](#1-desktop-page-layout)
2. [Mobile Page Layout](#2-mobile-page-layout)
3. [Unified Order Workspace](#3-unified-order-workspace)
4. [Tab Content Map](#4-tab-content-map)
5. [Action Model](#5-action-model)
6. [Visual Hierarchy Rules](#6-visual-hierarchy-rules)
7. [State Handling](#7-state-handling)
8. [Implementation Phases + Affected Files](#8-implementation-phases--affected-files)

---

## 1. Desktop Page Layout

### 1.1 — Zone structure (desktop ≥ 640px)

```
┌─────────────────────────────── max-w-7xl mx-auto px-6 py-8 ────────────────────────────────┐
│                                                                                              │
│  ┌──────────────────────────────── ZONE A: PAGE HEADER (not sticky) ─────────────────────┐ │
│  │  [Admin Panel]                                                                         │ │
│  │   Orders                                               (h1 font-black 4xl)             │ │
│  │   Grouped orders view for totals, status, shipping, profit, and exports                │ │
│  │                                                                                        │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────────────┐│ │
│  │  │ Orders   │ │ Revenue  │ │ Profit   │ │Unfulfilld│ │ Refunded                     ││ │
│  │  │   142    │ │ $4,218   │ │ $1,892   │ │    7     │ │    3                         ││ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                              │
│  ┌──────────────────────────────── ZONE B: TOOLBAR (sticky top-0 z-30 below nav) ────────┐ │
│  │ [🔍 Search…………………………………………] [Status ▾] [Review ▾] [From] [To] [↻ Refresh] [⬇ Export▾]│ │
│  │  142 orders                                                                            │ │
│  └────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                              │
│  ┌──────────────────────────────── ZONE C: TABLE ────────────────────────────────────────┐ │
│  │ Date     │ Order        │ Customer   │ Items │ Paid    │ Profit       │ Status  │ Rev │  │
│  │──────────┼──────────────┼────────────┼───────┼─────────┼──────────────┼─────────┼─────│ │
│  │ May 10   │ KK-2025-ABCD │ Jane Smith │   2   │ $58.00  │ $21.40 ≈EST │ SHIPPED │ ⭐1 │  │
│  │ ...                                                                                   │  │
│  │                                                        [Showing 25 of 142]  [Load More]│ │
│  └────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 — Zone A: Page Header

- Container: `bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6` (unchanged from current)
- `h1` "Orders" — unchanged
- KPI grid: `grid grid-cols-5 gap-3 mt-2` (desktop only; see mobile in §2.2)
- KPI card: `bg-gray-50 rounded-xl p-3 sm:p-4 border border-gray-100` (unchanged container)
- KPI value IDs unchanged: `kpiOrders`, `kpiRevenue`, `kpiProfit`, `kpiUnfulfilled`, `kpiRefunded`
- **Change**: Replace `—` init value with skeleton pulse `<div id="kpiOrders" class="h-6 w-16 bg-gray-200 animate-pulse rounded mt-1"></div>`. After load, swap inner HTML to value text (same as now).
- **Change**: KPI value colors (add after load; currently some are hard-coded, some need JS logic):
  - `kpiRevenue`: always `text-green-600` (unchanged)
  - `kpiProfit`: always `text-emerald-600` (unchanged)
  - `kpiUnfulfilled`: `text-amber-600` if value > 0, else `text-gray-400`
  - `kpiRefunded`: `text-red-500` if value > 0, else `text-gray-400`
- **Change (mobile KPI grid)**: on the 5-card grid, add `col-span-2 sm:col-span-1` to the last KPI card (Refunded) so the 5-in-a-2-col grid wraps cleanly on mobile with the 5th card spanning full width.

### 1.3 — Zone B: Toolbar

**Decision**: Flatten the current two-part filter card into a single compact toolbar row. Move export/import out of the filter section entirely.

Structure:
```
bg-white rounded-2xl border border-gray-200 px-3 py-3 mb-4 sm:mb-6
  sticky top-[var(--admin-nav-h)] z-30   (sticky below admin nav)
```

Toolbar layout — single `flex flex-wrap items-end gap-3`:
- **Search input** — `flex-1 min-w-[200px]` with existing border-4 border-black style + new `[×]` clear button
- **Status select** — `w-40` existing style
- **Review select** — `w-36` existing style  
- **Date From** — `w-36` existing style, label "From"
- **Date To** — `w-36` existing style, label "To"
- **Refresh button** — existing black button style `px-4 py-2`
- **Results count** — `text-xs text-gray-500` inline with refresh group: `142 orders`
- **Export dropdown** — new button `border-4 border-black bg-white px-4 py-2 font-black uppercase text-[10px]` with `⬇ Export` label + small chevron, opens a 2-item dropdown (Export CSV / Import Amazon)

**Search clear button** (`[×]`): appears inside the search input right-side (`absolute right-8 top-1/2 -translate-y-1/2`), only when `searchInput.value.length > 0`. Clicking it clears the input and triggers a re-fetch. Class: `text-gray-400 hover:text-black font-black text-sm cursor-pointer`.

**Export dropdown** replaces both current export buttons and the Amazon import drag-drop zone. The dropdown is a small `absolute` panel, `z-40`, with two buttons:
```
[⬇ Export CSV]
[📦 Import Amazon…]
```
Clicking "Import Amazon…" opens a separate small modal (`#amazonImportModal`, `max-w-sm`) that contains the drag-drop zone and preview/result panels currently embedded in the filter card.

Labels for the filter inputs remain as-is (uppercase 9-10px, tracking). No label changes needed.

### 1.4 — Table layout

Table columns — 8 columns (drop the current 9th "Reviews" to merge it with Actions, or display it inline):

| Col | Header | Width | Notes |
|---|---|---|---|
| Date | `DATE` | `w-28 min-w-[7rem]` | `formatDateShort(r.order_date)` |
| Order | `ORDER` | `min-w-[10rem]` | kkpink button → opens workspace |
| Customer | `CUSTOMER` | auto | font-black uppercase |
| Items | `ITEMS` | `w-14 text-center` | numeric |
| Paid | `PAID` | `w-24 text-right` | font-black |
| Profit | `PROFIT` | `w-40 text-right` | value + eBay badge inline |
| Status | `STATUS` | `w-52` | status pill + refund badge |
| Actions | `ACTIONS` | `w-28 text-right` | Edit button (always visible, no opacity:0) |

**Row hover**: keep `hover:bg-black/5`. Remove `opacity-0.5` default on `.row-actions` — replace with always-visible edit button at 50% opacity, full opacity on hover. This way the column isn't blank on non-hover.

**Edit button in Actions column** — reduced to icon-only on desktop to fit density:
```html
<button type="button" data-edit="${idx}"
  class="border-[4px] border-black bg-white px-3 py-2 font-black text-[11px] uppercase tracking-[.14em]
         opacity-50 hover:opacity-100 hover:bg-black hover:text-white transition"
  title="Edit order">
  ✎ Edit
</button>
```

**No separate "View" button in the table row** — clicking the order ID (pink link) opens the workspace on Overview tab. The ✎ Edit button opens workspace on Fulfillment tab. Both entry points are covered.

### 1.5 — Result count and Load More

Below the table `</tbody>`, outside the table scroll wrapper:
```
┌── bg-white border-t-4 border-black px-4 py-3 flex items-center justify-between ──┐
│  Showing 25 of 142 orders                     [Load More]                         │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- Count string: `Showing ${currentCount} of ${totalCount} orders` — hide if `currentCount >= totalCount`
- Load More: existing style, adds `loading` state (spinner SVG replaces text) while fetching
- "Load More" is hidden when `currentCount >= totalCount`; replaced with `All orders loaded` text

---

## 2. Mobile Page Layout

### 2.1 — Zone structure (mobile < 640px)

```
┌───── px-2 py-4 ─────┐
│  [Admin Panel]       │
│  Orders              │ ← sticky (not this, this is the page header)
│  KPI strip ←→        │ (horizontal scroll)
│                      │
│  ┌──── TOOLBAR ───┐  │
│  │ [🔍 Search ]   │  │ (full width)
│  │ [Filter ▾][⬇▾] │  │ (filter toggle + export, same row)
│  └────────────────┘  │
│                      │
│  ── CARD LIST ──────  │
│  ┌─────────────────┐ │
│  │ May 10 · KK-... │ │
│  │ JANE SMITH      │ │
│  │ [SHIPPED][pink] │ │ ← channel
│  │ Items│Paid│Prof │ │
│  └─────────────────┘ │
│  ...                 │
│  [Showing 10/142]    │
│  [Load More]         │
└──────────────────────┘
```

### 2.2 — KPI strip (mobile)

Replace the 2-col grid with a horizontal scroll strip:
```html
<div class="flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-5 -mx-4 px-4 sm:mx-0 sm:px-0">
  <!-- each card -->
  <div class="flex-shrink-0 w-[130px] sm:w-auto bg-gray-50 rounded-xl p-3 border border-gray-100">
    ...
  </div>
</div>
```
All 5 cards visible by horizontal swipe. No wrapping, no 5th-item orphan. The `-mx-4 px-4` trick lets the strip bleed to viewport edge on mobile while staying within padding on desktop.

### 2.3 — Filter access pattern (mobile)

The toolbar collapses to two elements on mobile:
```
[🔍 Search…………………………] full-width row
[Filters ▾ (N active)]   [⬇ Export ▾]   ← icon buttons, same row
```

`[Filters ▾]` opens a **bottom sheet** (`fixed inset-x-0 bottom-0 z-40 bg-white border-t-4 border-black rounded-none`) containing:
- Status select (full width)
- Review select (full width)
- Date From / Date To (side by side 50/50)
- [Apply Filters] button → closes sheet and triggers reload
- [Clear All] link

Active filter count badge: `[Filters ▾ (3)]` — increment per non-default value applied.

The filter bottom sheet has a **drag handle** (`w-10 h-1 bg-gray-300 rounded mx-auto my-3`) at top.

On desktop, the bottom sheet never renders — filters are always visible in the toolbar row.

### 2.4 — Card layout (mobile)

Current mobile card layout is kept but improved. Changes only:

**Add channel badge**: top-right of the order ID line:
```
May 10 · KK-2025-ABCD   [eBay] or [KK]
```
Channel badge: `inline-flex items-center border-[3px] border-black px-2 py-0.5 text-[9px] font-black uppercase` — black bg + white text for eBay, kkpink bg + black text for KK storefront.

**Status left border**: add `border-l-[4px]` color accent on the card container div matching fulfilled status:
- `pending` → `border-l-amber-400`
- `label_purchased` → `border-l-blue-400`
- `shipped` → `border-l-blue-600`
- `delivered` → `border-l-emerald-500`
- `returned` / `voided` → `border-l-gray-400`
- `refunded` (any) → `border-l-red-500`
Default: `border-l-transparent` (no accent)

**Entire card is tappable** (opens workspace on Overview tab): wrap card in `<button>` or add `data-view="${idx}"` on the outer card `<div>` and handle `click` on it. The inner ✎ Edit button calls `stopPropagation()` and opens workspace on Fulfillment tab.

**Edit button on mobile cards**: Keep existing Edit button. It remains in top-right alongside status pill. No ellipsis menu needed — the two-button pattern (tap card = View, tap Edit = Edit) is sufficient.

### 2.5 — Mobile spacing and tap targets

All `<button>` and `<select>` elements already have `min-h-[44px]` via the existing `@media (max-width: 640px)` rule in `<style>`. Keep this rule. No changes needed.

Card touch target: the outer card div is `min-h-[100px]` implicitly through its content. No explicit min-h needed.

---

## 3. Unified Order Workspace

### 3.1 — Shell (HTML skeleton)

ID: `#orderWorkspace`  
Replaces both `#viewModal` and `#modal`.

```html
<div id="orderWorkspace" class="hidden fixed inset-0 z-[200]" aria-hidden="true"
     role="dialog" aria-labelledby="wsTitle" aria-modal="true">

  <!-- Backdrop -->
  <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" data-ws-backdrop></div>

  <!-- Stage: mobile = full-screen slide-up, desktop = centered card -->
  <div class="relative h-full w-full overflow-y-auto sm:overflow-hidden">
    <div class="min-h-full flex items-end sm:items-center justify-center p-0 sm:p-6">

      <!-- Card -->
      <div id="wsCard"
           class="w-full sm:max-w-4xl bg-white border-0 sm:border-4 border-black
                  shadow-none sm:shadow-[8px_8px_0_0_rgba(0,0,0,0.1)]
                  min-h-screen sm:min-h-0 sm:max-h-[92vh]
                  flex flex-col overflow-hidden">

        <!-- HEADER (sticky) -->
        <div id="wsHeader"
             class="sticky top-0 z-20 flex items-center justify-between gap-3
                    p-3 sm:p-5 border-b-4 border-black bg-white flex-shrink-0">
          <div class="min-w-0 flex-1">
            <div id="wsKicker"
                 class="inline-block px-2 py-0.5 text-[8px] sm:text-[9px] font-black
                        uppercase tracking-[.2em] mb-1 text-white">
              <!-- e.g. "Order Details" -->
            </div>
            <div class="flex items-center gap-3 flex-wrap">
              <h2 id="wsTitle" class="text-lg sm:text-2xl font-black tracking-tight truncate">
                <!-- e.g. KK-2025-ABCD -->
              </h2>
              <span id="wsStatusBadge" class="flex-shrink-0">
                <!-- status pill (status-pending, etc.) -->
              </span>
            </div>
            <div id="wsSubtitle" class="text-xs text-gray-500 mt-0.5 truncate">
              <!-- e.g. "Jane Smith · May 10, 2025" -->
            </div>
          </div>

          <button id="btnWsClose" type="button"
                  class="border-4 border-black bg-white w-10 h-10 flex items-center justify-center
                         font-black text-lg hover:bg-black hover:text-white transition-colors flex-shrink-0"
                  aria-label="Close">✕</button>
        </div>

        <!-- TAB BAR (sticky below header) -->
        <div id="wsTabBar"
             class="sticky top-[header-height] z-10 flex border-b-4 border-black
                    bg-white flex-shrink-0 overflow-x-auto">
          <!-- Tabs injected by JS; see §3.4 -->
        </div>

        <!-- BODY (scrollable) -->
        <div id="wsBody"
             class="flex-1 overflow-y-auto p-3 sm:p-6 space-y-6 pb-24 sm:pb-6">
          <!-- Tab panel content injected here -->
        </div>

        <!-- FOOTER (sticky, only shown on Fulfillment tab) -->
        <div id="wsFooter"
             class="hidden sticky bottom-0 flex-shrink-0 flex items-center justify-end gap-3
                    p-3 sm:p-5 border-t-4 border-black bg-gray-50">
          <button id="btnWsCancel" type="button"
                  class="border-4 border-black bg-white text-black px-4 py-2 font-black
                         uppercase tracking-[.12em] text-xs hover:bg-gray-100 transition-all">
            Cancel
          </button>
          <button id="btnWsSave" type="button"
                  class="border-4 border-black bg-black text-white px-6 py-2 font-black
                         uppercase tracking-[.12em] text-xs
                         hover:bg-kkpink hover:border-kkpink hover:text-black transition-all">
            Save Changes
          </button>
        </div>

      </div><!-- /wsCard -->
    </div>
  </div>
</div>
```

### 3.2 — Desktop behavior

- `sm:max-w-4xl` — 56rem wide centered card
- `sm:max-h-[92vh]` — does not overflow viewport
- Card body scrolls independently (flex-1 overflow-y-auto)
- Backdrop click closes workspace
- Tab bar is sticky within the card (position: sticky inside overflow-y-auto — use `overflow-y-auto` on `wsCard` body only, not on the outer stage; the card uses `flex flex-col overflow-hidden` to constrain)
- Scroll position within each tab panel is NOT preserved between tab switches (reset to top on tab change)

### 3.3 — Mobile fullscreen behavior

- `min-h-screen` on the card → fills entire viewport
- `items-end` on stage → card slides up from bottom (visual convention)
- Tab bar: visible, horizontally scrollable if needed (`overflow-x-auto`)
- Footer (`wsFooter`): `sticky bottom-0` — anchored at bottom of screen; always visible on Fulfillment tab without scrolling
- Header: `sticky top-0` — always visible

### 3.4 — Tab order and labels

Rendered by JS into `#wsTabBar`:
```
[ Overview ] [ Financials ] [ Fulfillment ] [ IDs ]
```

Tab HTML template per tab:
```html
<button
  role="tab"
  data-ws-tab="overview"             ← values: overview | financials | fulfillment | ids
  aria-selected="false"
  class="ws-tab flex-shrink-0 px-4 sm:px-5 py-3 text-xs font-black uppercase tracking-[.18em]
         border-r-4 border-black whitespace-nowrap
         hover:bg-kkpink/10 transition-colors
         aria-selected:bg-black aria-selected:text-white">
  Overview
</button>
```

Active tab indicator: `aria-selected="true"` → CSS `[aria-selected=true] { background: black; color: white; }` (or Tailwind `aria-selected:bg-black aria-selected:text-white`).

Unsaved change dot on Fulfillment tab (when edit fields are dirty):
```html
<span id="wsDirtyDot"
      class="hidden ml-1 w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
```
Shown inside the Fulfillment tab button when `state.wsDirty === true`.

### 3.5 — Open states

| Triggered by | Tab | Footer visible |
|---|---|---|
| Click order ID (pink link) in table | `overview` | No |
| Click [View] in mobile card (if kept) | `overview` | No |
| Click [Edit ✎] button | `fulfillment` | Yes |
| Internal "Edit" button within Overview tab | `fulfillment` | Yes |

Tab switch to `fulfillment`: show `#wsFooter`. Tab switch away from `fulfillment`: hide `#wsFooter` if `state.wsDirty === false`. If dirty, show a one-line bar: `⚠ Unsaved changes — save on the Fulfillment tab.` instead of hiding the footer.

### 3.6 — Sticky header height variable

The admin nav has a known height. Define the sticky offset via a CSS variable set on `<body>` by JS on load:
```javascript
document.body.style.setProperty('--admin-nav-h', `${adminNav.offsetHeight}px`);
```
The tab bar in the workspace uses `top-[var(--ws-header-h)]` where `--ws-header-h` is set to `wsHeader.offsetHeight` after the workspace opens.

---

## 4. Tab Content Map

### 4.1 — Overview tab

**Purpose**: Answer "who ordered what and where does it go?"

Content (in order):

**A. Customer block**
```
┌ Customer Information ─ (border-l-[3px] border-kkpink heading style) ──────┐
│ Name              │ Email                                                   │
│ font-black lg     │ font-mono text-sm break-all                            │
│ Phone             │ Order Date                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```
Grid: `grid sm:grid-cols-2 gap-4`. Each cell: `border-4 border-black p-4` (unchanged).

**B. Shipping Address block**
Single `border-4 border-black p-4` with full address text.

**C. Line items list**
For each line item: `border-4 border-black p-3 sm:p-4 flex gap-3 sm:gap-4`
- Product image (64×64, fallback 📦)
- Product name (pink link if slug exists)
- Variant tag (if present)
- Qty / Price / Revenue inline flex row
- CPI cost line in red (if `li.cpi_cents` present)

**D. Channel tag** (new addition to Overview tab header, below section heading)
`[eBay]` or `[Karry Kraze]` badge — matches the channel badge on the table row.

What is **NOT** in Overview: financials, profit, fulfillment status, tracking, edit fields.

---

### 4.2 — Financials tab

**Purpose**: Answer "what did we earn, what did it cost, did we profit?"

**Standard orders (non-eBay)**:

Section heading: `Financial Summary`
```
┌ Subtotal │ Shipping │ Total (black inv card) ─────────────────┐
│          │          │                                          │
└──────────┴──────────┴──────────────────────────────────────────┘
┌ Product CPI │ USPS Label │ Shipping Margin │ Profit (emerald) ─┐
│ text-red-600 │ text-red-600 │ ±color         │                  │
└──────────────────────────────────────────────────────────────────┘
```

**eBay orders**:

Finance status badge shown inline in the tab heading:
```
Financials  [≈ EST · Ad fee pending]     ← amber badge, next to tab label in wsBody
```
Not in the tab button itself — placed as a badge in the section title inside the tab panel.

Content blocks (existing logic from `renderOrderDetailsHtml()` sections 4-5 — transplanted as-is):
- eBay buyer summary: Buyer Subtotal / eBay Tax / Buyer Total
- eBay fee breakdown: eBay Fees Total / FVF / Promoted Listing / Other Fees
- eBay earnings bar (estimated vs complete)
- Cost grid: Product CPI / USPS Label / eBay Earnings / Net Profit

Formula footnote: same existing text line at the bottom.

What is **NOT** in Financials: shipping address, line items, fulfillment actions.

**Refund impact**: when `order.refund_status` is set, show a `Refund Adjustment` row between the profit grid and the formula footnote. Not a separate section — just a green/red delta row.

---

### 4.3 — Fulfillment tab

**Purpose**: Answer "what is the shipping status and what do I need to do?"

This tab merges current details modal section 6 (read-only fulfillment) + all of current edit modal section 2 (editable fields). The tab is simultaneously read-only status AND editable — no mode toggle.

**Layout**:

```
┌ Fulfillment Status ────────────────────────────────────────────┐
│  Status pill  │  Carrier  │  Tracking (link if URL exists)     │
└───────────────────────────────────────────────────────────────-┘

[⚠ Not yet scanned warning — if label_purchased > 24h, no scan]

┌ Timeline ─────────────────────────────────────────────────────┐
│  Shipped  │  ETA  │  Delivered   (only shown if values exist)  │
└────────────────────────────────────────────────────────────────┘

┌ Label Actions ────────────────────────────────────────────────┐
│  [Preset ▾] [🏷️ Buy Label]   OR   [🖨 Print] [🔄 Reprint]     │
│  [✕ Void Label] (if shippo_transaction_id + label_purchased)   │
└────────────────────────────────────────────────────────────────┘

────  edit fields  ────────────────────────────────────────────

┌ Edit Shipment ─────────────────────────────────────────────────┐
│ Label Status ▾  │ Tracking Number                              │
│ Carrier         │ Service                                       │
│ Batch ID        │ Printed At                                    │
│ Label Cost ($)  │ Package Weight (g)                           │
│ Pirate Ship ID  [col-span-2]                                    │
│ Notes           [col-span-2]                                    │
└────────────────────────────────────────────────────────────────┘

┌ Refund ───────────────────────────────────────────────────────┐
│  (existing buildRefundSectionHtml() output — transplanted        │
│   as-is, section heading updated to new heading style)          │
└────────────────────────────────────────────────────────────────┘
```

**Edit fields**: same IDs as current edit modal (`fLabelStatus`, `fTrackingNumber`, `fCarrier`, `fService`, `fBatchId`, `fPrintedAt`, `fLabelCost`, `fPackageWeightGFinal`, `fPirateShipShipmentId`, `fNotes`). No ID renames needed.

**Section divider** between status/actions block and edit fields:
```html
<div class="border-t-4 border-black my-6 flex items-center gap-3">
  <span class="text-[10px] font-black uppercase tracking-[.25em] text-black/50 bg-white pr-2">
    Edit Shipment
  </span>
</div>
```

**Message area**: `<div id="wsMsg" class="hidden p-3 border-4 border-red-300 bg-red-50 text-red-700 text-sm">` — appears above the edit fields on error.

---

### 4.4 — IDs / Notes tab

**Purpose**: Developer/debug reference + admin-only notes.

```
┌ Technical IDs ─────────────────────────────────────────────────┐
│  KK Order ID:         font-mono text-sm [Copy]                 │
│  Stripe Session:      font-mono text-sm [Copy]                 │
│  Payment Intent:      font-mono text-sm [Copy]                 │
│  Stripe Customer:     font-mono text-sm [Copy]                 │
│  Channel:             KK Storefront / eBay                     │
└────────────────────────────────────────────────────────────────┘
```

Each ID row: `flex items-center justify-between gap-4 border-b border-gray-100 py-2`.  
Copy button: `text-[10px] font-black uppercase border-[3px] border-black px-2 py-1 hover:bg-black hover:text-white transition`. On click: `navigator.clipboard.writeText(value)`, button text briefly → `✓ Copied`.

No `<details>` collapse — this tab is already a conscious navigation step, no need to hide content further.

Notes field: reserved for Phase 3+. In Phase 3 initial implementation, the Notes section from the edit modal (fNotes) stays in the Fulfillment tab. If a dedicated admin notes field is added later, it goes here.

---

## 5. Action Model

### 5.1 — Actions by location

| Action | Location | Tab |
|---|---|---|
| Close workspace | Header (`btnWsClose`) | All tabs |
| Copy ID to clipboard | Inline (each ID row) | IDs tab |
| Channel link (product page) | Inline (line item product name) | Overview tab |
| Buy Label | Inline (`data-buy-label`) | Fulfillment tab |
| Print Label | Inline (`data-print-label`) | Fulfillment tab |
| Reprint Label | Inline (`data-reprint-label`) | Fulfillment tab |
| Void Label | Inline (`data-void-label`) | Fulfillment tab |
| Save Changes (shipment edit) | Footer (`btnWsSave`) | Fulfillment tab |
| Cancel (shipment edit) | Footer (`btnWsCancel`) | Fulfillment tab |
| Issue Full Refund | Inline (`data-refund-full`) | Fulfillment tab |
| Issue Partial Refund | Inline (`data-refund-partial`) | Fulfillment tab |
| Update Refund Reason | Inline (`data-set-reason`) | Fulfillment tab |
| Switch to Fulfillment (edit) | Inline "Edit" link | Overview tab (shortcut) |

### 5.2 — Footer: Save / Cancel behavior

- Footer is `hidden` by default
- Shown when workspace opens with `{ tab: 'fulfillment' }` OR when user navigates to Fulfillment tab
- Hidden when user navigates away from Fulfillment tab AND `wsDirty === false`
- If dirty when leaving Fulfillment tab: footer stays visible with a warning bar above it: `<div class="text-xs text-amber-700 font-black text-right pr-1">⚠ Unsaved changes</div>`

**Save**: calls existing shipment-save logic (from `modalEditor.js` → `bindEditModal()` → `onSaved` callback). After success: reloads table data, sets `wsDirty = false`, hides dirty dot, shows brief success state on Save button (`✓ Saved` for 1.5s).

**Cancel**: resets all edit field values to the originally-loaded values. Sets `wsDirty = false`. No modal close.

### 5.3 — Unsaved change detection

Track dirty state by listening to `input` and `change` events on all `#wsBody [id^="f"]` elements (all edit fields use `id` starting with `f`). On any event, set `state.wsDirty = true` and show dirty dot.

On workspace close (`btnWsClose`): if `state.wsDirty`, `confirm("You have unsaved changes. Close anyway?")`. If confirmed, close and reset. If not confirmed, stay open.

---

## 6. Visual Hierarchy Rules

### 6.1 — Typography scale (within workspace)

| Element | Classes |
|---|---|
| Section heading | `text-[11px] font-black uppercase tracking-[.25em]` with `pl-3 border-l-[3px] border-kkpink` |
| Primary value (name, price) | `font-black text-lg` or `font-black text-2xl` — context-dependent |
| Secondary metadata | `text-xs text-gray-500` |
| Form label | `text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70` |
| Form input | `border-[4px] border-black px-3 py-2 text-sm` + `focus:border-kkpink transition-colors` |
| Technical ID value | `font-mono text-sm text-gray-600` |
| Error message | `text-sm text-red-700` on `border-4 border-red-300 bg-red-50` |

### 6.2 — Badge usage rules

Badges (inline spans) use this pattern: `border-[3px] px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] whitespace-nowrap`

| Badge | Border | Background | Text |
|---|---|---|---|
| Status: Pending | `border-black` | `bg-white` | `text-black` |
| Status: Label Purchased | `border-black` | `bg-white` | `text-black` |
| Status: Shipped | `border-black` | `bg-black` | `text-white` |
| Status: Delivered | `border-black` | `bg-black` | `text-white` |
| Refund: Full | `border-red-700` | `bg-red-600` | `text-white` |
| Refund: Partial | `border-amber-600` | `bg-amber-500` | `text-white` |
| Refund: Cancelled | `border-gray-700` | `bg-gray-600` | `text-white` |
| eBay: EST | `border-amber-400` | `bg-amber-50` | `text-amber-700` |
| eBay: PARTIAL | `border-amber-400` | `bg-amber-50` | `text-amber-700` |
| eBay: PENDING | `border-blue-300` | `bg-blue-50` | `text-blue-700` |
| eBay: NO DATA | `border-gray-300` | `bg-gray-50` | `text-gray-500` |
| Channel: eBay | `border-black` | `bg-black` | `text-white` |
| Channel: KK | `border-kkpink` | `bg-kkpink` | `text-black` |
| Review: has reviews | `border-emerald-600` | `bg-emerald-50` | `text-emerald-700` |
| Review: none | `border-gray-200` | `bg-gray-50` | `text-gray-400` |

### 6.3 — Profit styling rules

Applied in both `renderDesktopRows()`, `renderMobileCards()`, and the Financials tab:

| Condition | Value display | Color |
|---|---|---|
| Profit > 0 (settled) | `$21.40` | `text-emerald-600` |
| Profit < 0 (settled) | `-$3.20` | `text-red-600` |
| Profit = 0 (settled) | `$0.00` | `text-gray-500` |
| Profit unknown (`null`) — eBay estimated | `—` | `text-amber-600` |
| Profit from eBay, estimate (no ad fee) | `$21.40` | `text-amber-600` (not emerald) |

No prefix arrows (`↑` / `↓`) in the table — too noisy. Use them optionally in the Financials tab profit card.

### 6.4 — Status color mapping (kicker and left-border accent)

Used for: workspace kicker `wsKicker` background, mobile card left-border:

| Status | Kicker bg | Left border |
|---|---|---|
| `pending` | `bg-amber-500` | `border-l-amber-400` |
| `label_purchased` | `bg-blue-500` | `border-l-blue-400` |
| `shipped` | `bg-blue-600` | `border-l-blue-600` |
| `delivered` | `bg-emerald-500` | `border-l-emerald-500` |
| `voided` | `bg-gray-500` | `border-l-gray-400` |
| `returned` | `bg-gray-500` | `border-l-gray-400` |
| `refunded` (any) | `bg-red-500` | `border-l-red-500` |
| Default | `bg-green-500` | `border-l-transparent` |

### 6.5 — Card / table density rules

- Table row padding: `px-4 py-3` (unchanged — compact)
- Tab panel section spacing: `space-y-6` (`wsBody` outer), `gap-4` within grids
- Between sections inside a tab panel: `<div class="border-t-4 border-gray-100 my-2"></div>`
- No additional shadow on inner cards within the workspace — the workspace card already has the shadow; inner elements use flat `border-4 border-black` only
- Minimum content padding: `p-4` on info boxes, `p-3` on tighter items

### 6.6 — Section heading style (workspace)

Replace the current numbered circle pattern (`<span class="w-5 h-5 bg-black text-white text-[10px]">1</span>`) with a kkpink left-border heading inside all tab panels:

```html
<div class="flex items-center gap-3 mb-4 pl-3 border-l-[3px] border-kkpink">
  <span class="text-[11px] font-black uppercase tracking-[.25em]">Customer Information</span>
</div>
```

Numbered circles remain only in the *current* details modal until it is removed in Phase 3.

---

## 7. State Handling

### 7.1 — Loading states

| Component | Loading treatment |
|---|---|
| KPI cards | Skeleton pulse `<div class="h-6 w-16 bg-gray-200 animate-pulse rounded">` per value |
| Table rows | Existing (no rows, empty state visible) |
| Workspace opening | `wsBody.innerHTML = '<div class="text-center py-12 text-gray-400">Loading…</div>'` (preserve header, show kicker + order ID immediately from `row` data) |
| Load More button | Replace button text with `<svg class="animate-spin …" />` during fetch |
| Save button | Replace "Save Changes" with "Saving…", `disabled` attribute |
| Buy Label button | Replace with "Buying…", `disabled` |

### 7.2 — Empty states

| Component | Empty treatment |
|---|---|
| Table (no rows after filter) | Current `#emptyState` div — unchanged |
| Line items list (0 items) | `<div class="text-sm text-gray-400 py-4">No line items found.</div>` |
| Refund section (no refund) | `<div class="text-sm text-gray-400">No refund issued.</div>` (current behavior, keep) |
| KPI zero values | Show `0` (not `—`); apply `text-gray-400` color for zero Unfulfilled/Refunded |

### 7.3 — Error states

| Location | Error treatment |
|---|---|
| Workspace open failure | Replace `wsBody` with `<div class="text-red-600 p-4">Failed to load order: ${msg}</div>`, header shows order ID only |
| Save failure | Show `#wsMsg` (currently `#modalMsg`) with error text, unset `disabled` on Save button |
| Label buy failure | Alert (existing behavior — keep for now) |
| Refund failure | Alert (existing behavior — keep for now) |
| Table load failure | Existing `setStatus()` mechanism in `dom.js` — unchanged |

### 7.4 — Pending finance states (eBay)

Applies to Financials tab and the profit column in the table/cards.

| `finance_status` | Table profit cell | Financials tab |
|---|---|---|
| `complete` | `$21.40` emerald | Full breakdown, no warning |
| `estimated` | `—` amber + `≈ AD FEE PENDING` badge | Warning bar at top of tab: `⚠ Ad fee not yet billed` amber box |
| `estimated_no_ad_fee` | `$21.40` amber | Note: no ad fee detected |
| `partial` | `$21.40` amber + `≈ PARTIAL` badge | Note: label cost not yet deducted |
| `pending_finances` | `—` + `🕐 PENDING` badge | Info box: finance data not yet synced |
| `missing` | `—` + `? EBAY` badge | Info box: no data available |

### 7.5 — Missing tracking state

In Fulfillment tab, when `labelStatus === 'label_purchased'` AND `label_purchased_at` is > 24h ago AND `in_transit_at` is null:
```html
<div class="border-4 border-amber-400 bg-amber-50 p-4 flex items-center gap-3">
  <span class="text-2xl">⚠️</span>
  <div>
    <div class="font-black text-sm text-amber-800 uppercase tracking-wider">Not Yet Scanned</div>
    <div class="text-xs text-amber-700 mt-1">Label purchased ${hours}h ago — no carrier scan. Check drop-off.</div>
  </div>
</div>
```
This already exists in the current details modal (section 6). Keep identical in Phase 3.

### 7.6 — Mobile vs desktop differences

| Behavior | Desktop | Mobile |
|---|---|---|
| KPI layout | `grid-cols-5` | Horizontal scroll strip |
| Filter access | Always-visible toolbar | Bottom sheet (behind Filters button) |
| Workspace size | `max-w-4xl max-h-[92vh]` centered card | Full screen (`min-h-screen`) |
| Tab bar | Sticky within card | Sticky at top of full-screen, `overflow-x-auto` |
| Footer | Sticky within card | Sticky at bottom of full-screen |
| Edit button in table | `opacity-50 hover:opacity-100` | Always full opacity |
| Card tap target | N/A (table row) | Entire card is tappable |

---

## 8. Implementation Phases + Affected Files

### Phase 1 — Quick wins (isolated, no modal refactor)

All changes are safe, additive, reversible. No existing logic touched except where noted.

**Target: all changes shippable together in one commit.**

| Item | File(s) | Change |
|---|---|---|
| Fix KPI 5th-card grid | `pages/admin/lineItemsOrders.html` | Add `col-span-2 sm:col-span-1` to last KPI card div |
| KPI skeleton loaders | `pages/admin/lineItemsOrders.html` | Replace `—` text nodes with skeleton `<div>`s; JS in `dom.js` updates innerHTML on load |
| KPI semantic colors | `js/admin/lineItemsOrders/dom.js` | After KPI load, conditionally set `text-amber-600` / `text-gray-400` based on zero check |
| Search clear button | `pages/admin/lineItemsOrders.html`, `js/admin/lineItemsOrders/index.js` | Add `[×]` button inside search input div; wire click to clear + reload in `wireEvents()` |
| Channel badge on mobile cards | `js/admin/lineItemsOrders/renderTable.js` | Add `isEbay` channel badge inside `renderMobileCards()` |
| Left-border status accent on mobile cards | `js/admin/lineItemsOrders/renderTable.js` | Add `border-l-[4px] ${statusAccentClass}` to outer card div |
| Full card tap target (mobile) | `js/admin/lineItemsOrders/renderTable.js` | Move `data-view="${idx}"` to outer card container div; add `cursor-pointer` |
| `Showing N of M orders` count | `pages/admin/lineItemsOrders.html`, `js/admin/lineItemsOrders/index.js` | Add count paragraph below table; update in `reload()` with total from `fetchOrderSummaryPage` response |
| Load More spinner | `pages/admin/lineItemsOrders.html` (or `index.js`) | Swap button text to SVG spinner during fetch; restore on complete |
| Always-visible Edit button in table | `js/admin/lineItemsOrders/renderTable.js` | Change `.row-actions` opacity from `0.5` to full; remove hover-only reveal on desktop |

**Phase 1 does NOT touch**: `#modal`, `#viewModal`, `modalEditor.js`, `bindEditModal()`, `bindViewModal()`, any API files.

---

### Phase 2 — Toolbar / layout restructure (HTML + minor JS)

**Target: cleaner page structure without modal changes.**

| Item | File(s) | Change |
|---|---|---|
| Flatten filter card to toolbar | `pages/admin/lineItemsOrders.html` | Restructure filter section into single flex toolbar row with sticky; keep all same input IDs |
| Mobile KPI horizontal scroll | `pages/admin/lineItemsOrders.html` | Replace `grid grid-cols-2` with `flex … overflow-x-auto` + `sm:grid sm:grid-cols-5` pattern |
| Mobile filter bottom sheet | `pages/admin/lineItemsOrders.html`, `js/admin/lineItemsOrders/index.js` | Add `#filterSheet` fixed panel; wire Filters toggle button in `wireEvents()` |
| Export dropdown button | `pages/admin/lineItemsOrders.html`, `js/admin/lineItemsOrders/index.js` | Replace two export buttons + drop zone with `[⬇ Export ▾]` button + inline dropdown panel |
| Amazon import modal | `pages/admin/lineItemsOrders.html`, `js/admin/lineItemsOrders/amazonImport.js` | Move drag-drop zone + preview/result panels into `#amazonImportModal`; open from dropdown |

**Phase 2 does NOT touch**: modal JS, tab logic, workspace logic, API files.

---

### Phase 3 — Unified Order Workspace

**Target: replace both `#modal` + `#viewModal` with `#orderWorkspace`.**

Affected files:

| File | Change |
|---|---|
| `pages/admin/lineItemsOrders.html` | Remove `#modal`, remove `#viewModal`. Add `#orderWorkspace` shell (§3.1 HTML). |
| `js/admin/lineItemsOrders/workspace.js` | **New file.** Contains: `openWorkspace(row, opts)`, `closeWorkspace()`, tab switch logic, dirty state tracking, `renderOverviewTab()`, `renderFinancialsTab()`, `renderFulfillmentTab()`, `renderIdsTab()`. |
| `js/admin/lineItemsOrders/index.js` | Remove `bindViewModal()`. Remove `bindEditModal()` call. Import `openWorkspace` from `workspace.js`. Route all `data-view` and `data-edit` clicks to `openWorkspace(row, { tab })`. |
| `js/admin/lineItemsOrders/modalEditor.js` | Still used for save logic — `bindEditModal()` replaced by `bindWsSave()` in `workspace.js`. The actual save API call in `modalEditor.js` is reused via direct import. |
| `js/admin/lineItemsOrders/renderTable.js` | No changes to desktop rows. Mobile cards: remove standalone "View" button if present (card itself is the tap target after Phase 1). |
| `js/admin/lineItemsOrders/dom.js` | Add `wsCard`, `wsHeader`, `wsKicker`, `wsTitle`, `wsSubtitle`, `wsStatusBadge`, `wsTabBar`, `wsBody`, `wsFooter`, `btnWsClose`, `btnWsSave`, `btnWsCancel`, `wsMsg` to `els` object. |

`workspace.js` shape (rough interface — detail TBD during implementation):
```javascript
export function initWorkspace({ onSaved }) { ... }       // called from DOMContentLoaded
export function openWorkspace(row, { tab = 'overview' }) { ... }  // called from table events
export function closeWorkspace() { ... }
```

`renderOverviewTab(order, lineItems)` → string HTML  
`renderFinancialsTab(order, shipment)` → string HTML  
`renderFulfillmentTab(order, shipment)` → string HTML (includes edit fields, label actions, refund)  
`renderIdsTab(order)` → string HTML  

Wire functions (`wireRefundButtons`, `wireLabelButtons`) are called from `workspace.js` after tab panel is injected into `wsBody`.

---

## Recommended Implementation Prompt (Phase 1 only)

> Implement Phase 1 quick wins for `pages/admin/lineItemsOrders.html` and `js/admin/lineItemsOrders/`. Make these changes:
>
> 1. **KPI grid fix** (`lineItemsOrders.html`): In the KPI grid div (`grid grid-cols-2 sm:grid-cols-5`), add `col-span-2 sm:col-span-1` to the last KPI card (Refunded, id=kpiRefunded).
>
> 2. **KPI skeleton loaders** (`lineItemsOrders.html` + `dom.js`): Replace the `—` text in each KPI value div with a skeleton element: `<div class="kpi-skeleton h-6 w-16 bg-gray-200 animate-pulse rounded mt-1"></div>`. In `dom.js`, after `fetchOrderKpis()` resolves, replace skeleton divs with the actual value text.
>
> 3. **KPI semantic colors** (`dom.js`): When rendering kpiUnfulfilled, use `text-amber-600` if value > 0 else `text-gray-400`. When rendering kpiRefunded, use `text-red-500` if value > 0 else `text-gray-400`.
>
> 4. **Search clear [×] button** (`lineItemsOrders.html` + `index.js`): Inside the search input wrapper div, add an `×` button (`id="btnSearchClear"`) positioned `absolute right-10 top-1/2 -translate-y-1/2`, hidden by default (`class="hidden ..."`). Show it when `searchInput.value.length > 0` (on `input` event). On click, clear `searchInput.value` and trigger reload.
>
> 5. **Channel badge on mobile cards** (`renderTable.js`): In `renderMobileCards()`, after the date/order ID line, add a channel badge: if `r.stripe_checkout_session_id?.startsWith('ebay_api_')`, render `<span class="border-[3px] border-black bg-black text-white px-2 py-0.5 text-[9px] font-black uppercase">eBay</span>`; else render `<span class="border-[3px] border-kkpink bg-kkpink text-black px-2 py-0.5 text-[9px] font-black uppercase">KK</span>`.
>
> 6. **Left-border status accent on mobile cards** (`renderTable.js`): In `renderMobileCards()`, add `border-l-[4px]` to the outer card div with a color based on `labelStatus`: pending=`border-l-amber-400`, label_purchased=`border-l-blue-400`, shipped=`border-l-blue-600`, delivered=`border-l-emerald-500`, voided/returned=`border-l-gray-400`, default=`border-l-transparent`. Apply alongside existing `border-b border-black/15`.
>
> 7. **Full card tap target (mobile)** (`renderTable.js`): In `renderMobileCards()`, add `data-view="${idx}" cursor-pointer` to the outer card container div. In `index.js` inside `wireEvents()` (where `data-view` is handled), update the selector to also match `[data-view]` on divs, not just buttons. The inner ✎ Edit button must call `e.stopPropagation()`.
>
> 8. **Showing N of M count** (`lineItemsOrders.html` + `index.js`): Below the table Load More button, add `<p id="showingCount" class="text-xs text-gray-500 text-center mt-2"></p>`. In `index.js`, after each load, set this to `Showing ${rows.length} of ${totalCount} orders` (if totalCount is available from the page response; if not use rows.length only). Hide "Load More" when all loaded.
>
> 9. **Load More spinner** (`index.js`): Before triggering load more fetch, set `btnLoadMore.innerHTML = '<svg class="animate-spin w-4 h-4 inline" .../>  Loading…'`. Restore text on complete.
>
> Do not change any modal code (`#modal`, `#viewModal`, `modalEditor.js`, `bindEditModal`, `bindViewModal`). Do not change any API files. Do not change desktop table rendering.

---

_Spec authored for: karrykraze.com admin panel_  
_Builds on: `001_admin_orders_ux_audit.md`_  
_Source files reviewed: `pages/admin/lineItemsOrders.html`, `js/admin/lineItemsOrders/index.js`, `js/admin/lineItemsOrders/renderTable.js`, `js/admin/lineItemsOrders/dom.js`_
