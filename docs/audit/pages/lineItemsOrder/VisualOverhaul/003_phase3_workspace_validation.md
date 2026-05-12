# Phase 3 Validation — Unified Order Workspace

**File:** `003_phase3_workspace_validation.md`  
**Commit:** `91dd7bd`  
**Date:** 2025-07  
**Scope:** `js/admin/lineItemsOrders/` + `pages/admin/lineItemsOrders.html`

---

## Summary

Phase 3 replaced two separate modal flows — `#modal` (edit/fulfillment form) and `#viewModal` (read-only order details) — with a single unified `#orderWorkspace` panel backed by the new `workspace.js` module (~1,300 lines). The workspace slides up as a full-screen overlay on mobile and a centered card on desktop, with four tabs (Overview, Financials, Fulfillment, IDs) and a sticky footer for save/cancel actions.

---

## Files Changed in Phase 3

| File | Change Type | Description |
|---|---|---|
| `js/admin/lineItemsOrders/workspace.js` | **Created** | New ~1,300-line module implementing all workspace logic |
| `pages/admin/lineItemsOrders.html` | **Modified** | Removed `#modal` (~180 ln) + `#viewModal` (~45 ln); added `#orderWorkspace` shell |
| `js/admin/lineItemsOrders/index.js` | **Modified** | Removed ~800 lines of old modal functions; wires workspace instead |
| `js/admin/lineItemsOrders/dom.js` | **Modified** | Removed `modal` ref; added `orderWorkspace`, `wsBody`, `wsFooter`, `btnWsClose/Save/Cancel` |

---

## Functionality: Reused vs Rewritten

| Capability | Old location | New location | Status |
|---|---|---|---|
| Fetch order details | `fetchOrderDetails()` in `index.js` | Unchanged in `api.js`; called inside `openWorkspace` | ✅ Reused |
| Issue refund (full) | `wireRefundButtons()` in `index.js` | `_wireRefundButtons()` in `workspace.js` | Rewritten (same API call) |
| Issue refund (partial) | `wireRefundButtons()` in `index.js` | `_wireRefundButtons()` in `workspace.js` | Rewritten (same API call) |
| Refund reason update | `wireRefundButtons()` in `index.js` | `_wireRefundButtons()` in `workspace.js` | Rewritten (same API call) |
| Buy shipping label | `wireLabelButtons()` in `index.js` | `_wireLabelButtons()` in `workspace.js` | Rewritten (same API call) |
| Print / Reprint label | `wireLabelButtons()` in `index.js` | `_wireLabelButtons()` in `workspace.js` | Rewritten (same logic) |
| Void shipping label | `wireLabelButtons()` in `index.js` | `_wireLabelButtons()` in `workspace.js` | Rewritten (same API call) |
| Upsert fulfillment shipment | `bindEditModal()` in `index.js` | `_save()` in `workspace.js` | Rewritten (same API call) |
| eBay financials display | `renderOrderDetailsHtml()` in `index.js` | `_renderFinancials()` in `workspace.js` | Rewritten + enhanced |
| Customer / address display | `renderOrderDetailsHtml()` in `index.js` | `_renderOverview()` in `workspace.js` | Rewritten + enhanced |
| Line items with images | `renderOrderDetailsHtml()` in `index.js` | `_renderOverview()` in `workspace.js` | Rewritten (identical logic) |
| Copy ID buttons | None | `_renderIds()` + `_wireCopyButtons()` | **New feature** |
| Dirty-state tracking | None (form always shown) | `_trackDirty()` + `_wsDirty` flag | **New feature** |
| Save-in-place UX | None | `_save()` with inline `#fMsg` status | **New feature** |

---

## Validation: 12 Behavior Areas

### 1. Open / Close Behavior

**Open path:**
- Table row "Edit" button → `index.js` calls `openWorkspace(row, { tab: 'fulfillment' })`
- Table row "View" button → `index.js` calls `openWorkspace(row, { tab: 'overview' })`
- `openWorkspace` stores row in `_currentRow`, stores active tab in `_currentTab`
- Sets `document.body.classList.add('overflow-hidden')` to lock scroll
- Removes `hidden` class + `aria-hidden` attribute from `#orderWorkspace`
- Shows loading spinner in `#wsBody`, then calls `fetchOrderDetails` (async)
- On success stores result in `_detail` and renders tab body

**Close path:**
- `✕` button → `initWorkspace` attaches click → `_safeClose()`
- Backdrop click (`[data-ws-backdrop]`) → `_safeClose()`
- ESC key (global `keydown` listener) → `_safeClose()`
- Cancel button → resets `_wsDirty = false`, calls `closeWorkspace()` directly (no confirm)
- `closeWorkspace()` adds `hidden`, restores `aria-hidden`, removes `overflow-hidden`, nulls `_currentRow`/`_detail`

**Verdict:** ✅ Correct. All three close vectors call `_safeClose()` (except Cancel, which bypasses the dirty check intentionally).

---

### 2. View vs Edit Entry Behavior

- "View" click → `openWorkspace(row, { tab: 'overview' })` — lands on read-only customer/items tab; footer hidden
- "Edit" click → `openWorkspace(row, { tab: 'fulfillment' })` — lands on edit form tab; footer visible

Both entry points use the same `openWorkspace` function; the `tab` param controls initial state.

**Verdict:** ✅ Correct. No regression vs old dual-modal approach.

---

### 3. Tab Switching Behavior

`_switchTab(tab)`:
1. Updates `_currentTab`
2. Re-renders `#wsTabBar` with new active state (replaces inner HTML)
3. Toggles footer visibility: shown only when `tab === 'fulfillment'`
4. Scrolls `#wsBody` to top (`scrollTo(0,0)`)
5. Re-renders tab body via `_renderTabBody(tab)`
6. On `fulfillment` tab: runs post-render wires (`_populateFulfillmentFields`, `_wireRefundButtons`, `_wireLabelButtons`, `_trackDirty`)
7. On `ids` tab: runs `_wireCopyButtons`
8. On `tab === 'fulfillment'` re-render, dirty dot state is re-applied if `_wsDirty === true`

**Note:** `_wsDirtyDot` is a DOM element rendered inside `_renderTabBar()` as part of the Fulfillment tab button HTML. Since `_renderTabBar` is always called before `_setDirtyDot`, the element is always in the DOM when needed.

**Verdict:** ✅ Correct. Tab switching is clean and stateful.

---

### 4. Dirty-State Tracking

`_trackDirty(container)`:
- Attaches `input` and `change` listeners to all non-`readonly` inputs/selects/textareas within `#wsBody`
- Sets `_wsDirty = true` and calls `_setDirtyDot(true)` on any change
- `#wsDirtyDot` (amber circle) appears inside the Fulfillment tab button label

On successful `_save()`:
- `_wsDirty = false`
- `_setDirtyDot(false)`

On `_safeClose()` when dirty:
- `confirm("You have unsaved changes. Discard?")` gate
- If confirmed: `_wsDirty = false` → `closeWorkspace()`

On Cancel button:
- Skips the confirm; resets `_wsDirty = false` and calls `closeWorkspace()` directly
- This is intentional — Cancel is an explicit discard action

**Verdict:** ✅ Correct. Dirty state properly guards all close vectors (except explicit Cancel).

---

### 5. Save / Cancel Behavior

**Save:**
- `btnWsSave` → `_save()` (wired once in `initWorkspace`)
- Reads all `f*` fields, builds a `patch` object
- `cleanStr` / `cleanInt` helpers null-coerce empty strings
- `dollarsToCents` / `localDatetimeValueToIso` helpers normalize currency and datetime
- Calls `upsertFulfillmentShipment({ stripe_checkout_session_id, kk_order_id, patch, previousShipment })`
- On success: updates `_detail.shipment` and `_currentRow.shipment` in-place (avoids full re-fetch)
- Shows `"✓ Saved"` on button for 1.5s; shows success `#fMsg` for 3s; calls `_onSaved()` (triggers table row refresh in `index.js`)
- On error: shows error `#fMsg`; re-enables button

**Cancel:**
- `btnWsCancel` → `_wsDirty = false` → `closeWorkspace()` (wired once in `initWorkspace`)

**Verdict:** ✅ Correct. Save is robust with proper error display and in-place state update.

---

### 6. Refund Action Behavior

Wired by `_wireRefundButtons(container, order)` after every Fulfillment tab render.

**Full refund:**
- Requires reason selection if no `refund_status` yet
- Confirm dialog shows order ID, amount, and reason before executing
- Calls `issueRefund(sessionId, null, reason)` — `null` amount triggers full refund in API
- On success: shows alert with refund ID and amount; calls `openWorkspace(_currentRow, { tab: _currentTab })` to refresh
- On error: re-enables button; shows alert

**Partial refund:**
- Same reason requirement
- Validates amount > 0 and ≤ remaining balance
- Calls `issueRefund(sessionId, amountCents, reason)`
- Same success/error flow

**Reason toggle (already-refunded orders):**
- `[data-set-reason]` buttons update `refund_reason` via `updateRefundReason(sessionId, reason)`
- Calls `openWorkspace` to re-render regardless of success/failure (to show current state)

**Amazon guard:**
- If `order.source === 'amazon'`, refund section renders a non-interactive note; `[data-refund-full]` and `[data-refund-partial]` buttons are not rendered

**Caveat:** After a successful refund action, `openWorkspace` is called to re-render. Any in-progress edits in the Edit Shipment form fields will be lost without a dirty-state warning — because `_wsDirty` is not checked before this re-render. This is an acceptable trade-off (refund and edit are rarely concurrent) but worth documenting.

**Verdict:** ✅ Functionally correct. Minor edge-case: concurrent dirty edit + refund action loses edit data without warning.

---

### 7. Label Action Behavior

Wired by `_wireLabelButtons(container, order, shipment)` after every Fulfillment tab render.

**Buy label:**
- Async-populates `[data-preset-select]` from `fetchPackagePresets()` on every fulfillment render
- Calls `buyShippingLabel(sessionId, presetId)`
- On success: alert with tracking, cost, service; calls `openWorkspace` to refresh; calls `_onSaved()`

**Print / Reprint:**
- Opens `window.open('', 'printLabel', ...)` popup
- Calls `getSignedLabelUrl(shipment.label_url)` for a signed storage URL
- For `.png` labels: renders an `<img>` + auto-print via `setTimeout(window.print, 400)`
- For other label types: redirects popup to signed URL directly
- Popup-blocked case: alerts user

**Void label:**
- Confirm dialog with order ID + tracking number
- Calls `voidShippingLabel(sessionId)`
- On success: alert with refund status; calls `openWorkspace` + `_onSaved()`

**Button visibility rules:**
- Buy label: shown only when `labelStatus === 'pending' || labelStatus === 'voided'`
- Print + Reprint: shown only when `shipment.label_url` exists
- Void: shown only when `shipment.shippo_transaction_id` exists AND `labelStatus === 'label_purchased'`

**Verdict:** ✅ Correct. All label actions correctly guarded by status conditions.

---

### 8. eBay Financial Display

`_renderFinancials(order, shipment)` detects eBay orders via `stripe_checkout_session_id.startsWith('ebay_api_')`.

**eBay path renders:**
- Finance status badge (`complete` / `estimated` / `estimated_no_ad_fee` / `partial` / `pending_finances` / `missing`) — each with distinct border/color treatment
- eBay Order Summary: Buyer Subtotal, eBay Tax (labeled as "eBay collects & remits — not our revenue"), Buyer Total
- Fees grid (when `ebay_financials` earnings available): eBay Fees Total, Final Value Fee, Promoted Listing (estimated = "—" with pending note), Other Fees
- eBay Seller Earnings row — amber warning when `finance_status === 'estimated'` (promoted fee not yet billed)
- Cost & eBay Net Profit grid: Product CPI, USPS Label, eBay Earnings, Net Profit
- Best-case profit formula row when profit is unknown (pre-promo-fee)

**Handling missing data:**
- If `ebay_financials` has no earnings yet: renders blue "eBay Finance Data Not Yet Available" info box instead of the fees/earnings grid

**Verdict:** ✅ Complete and accurate. All eBay finance states handled.

---

### 9. Non-eBay Financial Display

`_renderFinancials` non-eBay (KK Store, Amazon) path renders:
- Order Summary: Subtotal, Shipping, Total Paid (black card)
- Cost & Profit grid: Product CPI, USPS Label, Shipping Margin (color-coded emerald/red vs label cost), Profit

Shipping Margin shows `—` gracefully when no label cost exists yet.

**Verdict:** ✅ Correct. Graceful degradation when shipment/label data is missing.

---

### 10. IDs Tab / Copy Behavior

`_renderIds(order)` renders 1–4 ID rows (filtered by truthy value):
- KK Order ID
- Stripe Session (`stripe_checkout_session_id`)
- Payment Intent (`stripe_payment_intent_id`)
- Stripe Customer (`stripe_customer_id`)

Each row has a `[data-copy]` button wired by `_wireCopyButtons()`.

Copy mechanism:
1. `navigator.clipboard.writeText(text)` — primary
2. Fallback: creates a temporary `<textarea>`, selects text, calls `document.execCommand('copy')`, removes element
3. Button shows `"✓"` for 1.2s then reverts to `"Copy"`

**Verdict:** ✅ Correct. Fallback handles Safari/iframe environments.

---

### 11. Mobile Full-Screen Behavior

`#orderWorkspace` HTML structure:
```
position: fixed inset-0 z-[200]
  └── backdrop (absolute inset-0)
  └── flex items-end sm:items-center justify-center p-0 sm:p-6
       └── #wsCard: w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-4xl
            border-0 sm:border-4
```

- On mobile (`< sm`): full-screen panel that covers the entire viewport; no rounded corners or border; card take 100% height
- Tab bar is `overflow-x-auto` with `flex-shrink-0` on buttons → horizontal scroll if tabs overflow
- Footer uses a fixed-height bar pinned with `flex-shrink-0`; content scrolls in `#wsBody` only (`flex-1 overflow-y-auto min-h-0`)
- `document.body.classList.add('overflow-hidden')` prevents background scroll

**Verdict:** ✅ Correct layout. `min-h-0` on `#wsBody` is critical for inner scroll to work inside a flex column — correctly applied.

---

### 12. Desktop Modal Behavior

On `sm` and up:
- Centered card with `max-w-4xl` and `max-h-[90vh]`
- 4px neo-brutalist border + `backdrop-blur-sm` on overlay
- Clicking backdrop calls `_safeClose()`
- ESC calls `_safeClose()`
- Card does not close on internal click due to `event.stopPropagation()` on the card — **wait**: the card itself has no `stopPropagation`. The backdrop listener is `[data-ws-backdrop]` which is the overlay `div`, not the card. Clicks inside the card do not reach the backdrop element so they do not close it. This is correct behavior via DOM structure, not via stopPropagation.

**Verdict:** ✅ Correct. Backdrop-click-to-close works cleanly without needing stopPropagation hacks.

---

## Regressions / Risk Areas

| Risk | Severity | Detail |
|---|---|---|
| Concurrent edit + refund clears form | Low | Clicking a refund button triggers `openWorkspace()` which re-renders the entire fulfillment tab, discarding any unsaved shipment edits without a dirty-check. In practice these two operations are rarely concurrent. |
| Preset select re-fetches on every fulfillment render | Low | `_wireLabelButtons` calls `fetchPackagePresets()` every time the fulfillment tab is rendered or re-entered. No caching. Negligible for admin use. |
| Focus management on open | Low | `openWorkspace` does not set focus to the first interactive element inside the workspace. Keyboard users landing in the workspace may need to Tab from their last position. |
| ESC closes without scroll restoration | Trivial | `closeWorkspace` removes `overflow-hidden` correctly, but does not restore `scrollY`. Background scroll position is preserved by the browser in most cases but not guaranteed on all mobile browsers. |
| `_wsDirtyDot` undefined if called before first `_renderTabBar` | Mitigated | `initWorkspace` wires buttons but never calls `_setDirtyDot` until after `openWorkspace` → `_renderTabBar`. Safe in practice. |

---

## Minor Polish Still Remaining

1. **Focus trap:** The workspace does not implement a focus trap. Keyboard users can Tab out of the panel while it is open.
2. **ARIA role:** `#orderWorkspace` has no `role="dialog"` or `aria-labelledby`. Screen readers won't announce it as a dialog.
3. **Preset cache:** Package presets are re-fetched on every fulfillment render. A simple module-level cache (`_presetsCache`) would eliminate redundant network calls.
4. **Print popup origin:** `window.open('', 'printLabel')` reuses the same named window if it's already open, which can cause stale state on rapid reprints. Low impact.
5. **Saved-data sync in table row:** After `_save()`, `_currentRow.shipment` is updated in-place. The table row DOM (rendered in `renderTable.js`) does **not** update until the next full `reload()` via `_onSaved()`. The current flow calls `_onSaved()` which triggers reload — so the table row _does_ update correctly after save.

---

## Recommended Next Prompt (if needed)

> "Add `role="dialog"` and `aria-labelledby="wsTitle"` to `#orderWorkspace` in `lineItemsOrders.html`. Add a focus trap to `workspace.js` so Tab/Shift-Tab stay within the panel when it's open. Also add a module-level preset cache in `_wireLabelButtons` to avoid re-fetching package presets on every fulfillment render."

This is cosmetic/accessibility polish only — no functional regressions were found in Phase 3.
