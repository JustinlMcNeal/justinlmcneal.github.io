# 006 — Action Handler Inventory: eBay Listings Admin

Date: 2026-05-15

State at time of audit: `index.js` is 2,446 lines (post Phase 1 + Phase 3 extractions).

---

## 1. Current `window.*` globals

Seven functions are exposed on `window`. All are assigned at module top level. None are imported from other modules.

---

### `window.relinkEbayListing(code)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 263 |
| Called from (onclick) | `ebayCodeLinkHtml()` line 230 (stale link badge in table/card code cell) |
| Called from (onclick) | `renderProductActions()` line 321 (Relink button, stale+safeRelink state) |
| Called from (JS) | `btnEditRelink` listener line 2191 via `window.relinkEbayListing(editProduct.code)` |
| Triggers | `reconcileEbayLink(product, true)` → Supabase write → `loadProducts()` |
| eBay mutation | No (updates local DB link only; does not create/modify eBay listing) |
| Supabase write | Yes — writes `ebay_listing_id` to products table |
| Args | `code` (product code string) |
| Risk to convert | **Medium** — used from 3 call sites including a direct JS call (not just onclick). Must keep backward-compatible or update `btnEditRelink` handler at same time. |

---

### `window.clearStaleEbayLink(code)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 282 |
| Called from (onclick) | `renderProductActions()` line 315 (Mark Ended — out_of_stock state) |
| Called from (onclick) | `renderProductActions()` line 319 (Mark Ended — stale state) |
| Triggers | `callEdge("ebay-manage-listing", { action: "clear_stale_listing_link" })` → `loadProducts()` |
| eBay mutation | No (clears local DB link fields only; does not touch eBay) |
| Supabase write | Yes — clears `ebay_listing_id`, `ebay_offer_id`, `ebay_item_group_key` |
| Args | `code` |
| Risk to convert | **Medium** — 2 call sites both in `renderProductActions()`. Could move to `data-action="clear-stale"` safely. `code` only (no offerId). |

---

### `window.openPush(code)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 964 |
| Called from (onclick) | `renderProductActions()` line 327 (Push — not_listed state) |
| Called from (onclick) | `renderProductActions()` line 337 (Resume Push — draft, no offer) |
| Called from (onclick) | `renderProductActions()` line 341 (Re-list — ended state) |
| Called from (dead code) | `renderCards()` lines 639, 647, 649 — **dead code** — see §5 below |
| Triggers | Populates and opens Push modal (complex: loads taxonomy, policies, image strip, Quill, profit preview, price reference, variant helpers) |
| eBay mutation | No (modal open only) |
| Supabase write | No |
| Args | `code` |
| Risk to convert | **Low** — no mutation, opens modal. Only `code` arg needed. Strong candidate for conversion after `open-sales` pattern is proven. |

---

### `window.openEdit(code)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 1106 |
| Called from (onclick) | `renderProductActions()` line 314 (Restock — out_of_stock state) |
| Called from (onclick) | `renderProductActions()` line 330 (Edit — active state) |
| Called from (onclick) | `renderProductActions()` line 334 (Edit — draft state) |
| Called from (dead code) | `renderCards()` lines 641, 644 — **dead code** — see §5 below |
| Triggers | Populates and opens Edit modal (complex: fetches taxonomy/aspects, loads policies, image strip, price reference) |
| eBay mutation | No (modal open only) |
| Supabase write | No |
| Args | `code` |
| Risk to convert | **Low** — no mutation, opens modal. Only `code` arg needed. Good candidate after `openPush`. |

---

### `window.discardDraft(code, offerId, itemGroupKey)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 1482 |
| Called from (onclick) | `renderProductActions()` line 338 (Discard — draft state only) |
| Triggers | `callEdge("ebay-manage-listing", { action: "discard_draft" })` → `loadProducts()` |
| eBay mutation | **Yes** — deletes unpublished eBay draft offer and inventory item group |
| Supabase write | Yes — resets product status to not_listed via loadProducts |
| Args | `code`, `offerId`, `itemGroupKey` (3 args via string interpolation) |
| Risk to convert | **High** — eBay mutation, 3 args (need `data-offer-id` and `data-group-key` attributes or lookup by code), irreversible eBay draft deletion. Convert last. |

---

### `window.doWithdraw(code, offerId, itemGroupKey)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 1509 |
| Called from (onclick) | `renderProductActions()` line 331 (End — active state) |
| Called from (dead code) | `renderCards()` line 642 — **dead code** |
| Triggers | `callEdge("ebay-manage-listing", { action: "withdraw" or "withdraw_group" })` → `loadProducts()` |
| eBay mutation | **Yes** — ends active eBay listing |
| Supabase write | Yes — via loadProducts |
| Args | `code`, `offerId`, `itemGroupKey` (3 args) |
| Risk to convert | **High** — eBay mutation, 3 args, requires confirmation dialog, ends live listing. Convert last. |

---

### `window.doPublish(code, offerId, itemGroupKey)`

| Property | Value |
|---|---|
| Assigned at | `index.js` line 1528 |
| Called from (onclick) | `renderProductActions()` line 336 (Publish — draft+offer state) |
| Called from (dead code) | `renderCards()` line 646 — **dead code** |
| Triggers | `callEdge("ebay-manage-listing", { action: "publish" or "publish_group" })` → `loadProducts()` |
| eBay mutation | **Yes** — creates live eBay listing from draft |
| Supabase write | Yes — via loadProducts |
| Args | `code`, `offerId`, `itemGroupKey` (3 args) |
| Risk to convert | **High** — eBay mutation, 3 args, publishes to live eBay marketplace. Convert last. |

---

## 2. Current inline `onclick` usage

All onclicks live in two functions: `ebayCodeLinkHtml()` and `renderProductActions()`. `renderCards()` also has a dead code block with inline onclicks (see §5).

### From `ebayCodeLinkHtml()` — stale link badge in product name cell

| Line | Called function | Context | Suggested `data-action` | Risk |
|---|---|---|---|---|
| 230 | `relinkEbayListing(code)` | Inline relink button in code badge (stale+safeRelink) | `data-action="relink"` | Medium |

### From `renderProductActions(p, compact)` — all status/stale permutations

| Line | Called function | Args | Status context | Suggested `data-action` | Risk |
|---|---|---|---|---|---|
| 314 | `openEdit(code)` | code | out_of_stock → Restock button | `data-action="edit"` | Low |
| 315 | `clearStaleEbayLink(code)` | code | out_of_stock → Mark Ended button | `data-action="clear-stale"` | Medium |
| 319 | `clearStaleEbayLink(code)` | code | stale (no safeRelink) → Mark Ended button | `data-action="clear-stale"` | Medium |
| 321 | `relinkEbayListing(code)` | code | stale+safeRelink → Relink button | `data-action="relink"` | Medium |
| 327 | `openPush(code)` | code | not_listed → Push button | `data-action="push"` | Low |
| 330 | `openEdit(code)` | code | active → Edit button | `data-action="edit"` | Low |
| 331 | `doWithdraw(code, offerId, groupKey)` | code + offerId + groupKey | active → End button | `data-action="withdraw"` + `data-offer-id` + `data-group-key` | High |
| 334 | `openEdit(code)` | code | draft → Edit button | `data-action="edit"` | Low |
| 336 | `doPublish(code, offerId, groupKey)` | code + offerId + groupKey | draft+offer → Publish button | `data-action="publish"` + `data-offer-id` + `data-group-key` | High |
| 337 | `openPush(code)` | code | draft, no offer → Resume Push button | `data-action="push"` | Low |
| 338 | `discardDraft(code, offerId, groupKey)` | code + offerId + groupKey | draft → Discard button | `data-action="discard"` + `data-offer-id` + `data-group-key` | High |
| 341 | `openPush(code)` | code | ended → Re-list button | `data-action="push"` | Low |

**Total unique inline onclick call sites: 13** (12 in `renderProductActions()`, 1 in `ebayCodeLinkHtml()`).

---

## 3. Existing delegated action patterns

### `data-action="open-sales"` — fully delegated, working

- **Assigned in:** `renderTable()` (line 608) and `renderCards()` (line 678)
- **Attributes:** `data-action="open-sales"`, `data-code="{code}"`
- **Delegated listeners:** Two listeners on stable parent containers — `#tableSection` and `#cardSection`
- **Pattern:**
  ```js
  document.getElementById("tableSection").addEventListener("click", e => {
    const btn = e.target.closest("[data-action='open-sales']");
    if (!btn) return;
    const product = allProducts.find(p => p.code === btn.dataset.code);
    if (product) openSalesHistory(product);
  });
  ```
- **Status:** ✅ Complete, proven, working

This is the **reference pattern** for all future action conversions.

### `data-view` buttons — delegated view toggle

- **Buttons:** `[data-view="table"]`, `[data-view="cards"]`
- **Listener:** Event delegation via `.view-toggle-btn` selector or direct binding
- **Status:** Working, not onclick-based

### `btnEditRelink` — direct listener calling window.*

- `document.getElementById("btnEditRelink").addEventListener("click", async () => { await window.relinkEbayListing(editProduct.code); })`
- This listener uses the window global as a convenience reference. When converting `relinkEbayListing` away from window, this listener must be updated at the same time.
- **Status:** Direct listener, not delegated, references window.relinkEbayListing

### Bulk action buttons — direct listeners on static DOM elements

- `#btnBulkPrice`, `#selectAll` — direct event listeners on static elements (not re-rendered)
- These are safe and not part of the inline onclick problem.

---

## 4. Recommended delegated action map

Based on the current code, the target central dispatch map is:

```js
const PRODUCT_ACTIONS = {
  "push":        (code)                           => openPush(code),
  "edit":        (code)                           => openEdit(code),
  "withdraw":    (code, offerId, itemGroupKey)     => doWithdraw(code, offerId, itemGroupKey),
  "publish":     (code, offerId, itemGroupKey)     => doPublish(code, offerId, itemGroupKey),
  "discard":     (code, offerId, itemGroupKey)     => discardDraft(code, offerId, itemGroupKey),
  "relink":      (code)                           => relinkEbayListing(code),
  "clear-stale": (code)                           => clearStaleEbayLink(code),
  "open-sales":  (code)                           => { const p = allProducts.find(x => x.code === code); if (p) openSalesHistory(p); },
};
```

Delegated listener shape (replaces the 2 existing `open-sales` listeners + adds all product action dispatch):

```js
function handleProductAction(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action       = btn.dataset.action;
  const code         = btn.dataset.code;
  const offerId      = btn.dataset.offerId || "";
  const itemGroupKey = btn.dataset.groupKey || "";
  const handler = PRODUCT_ACTIONS[action];
  if (handler) handler(code, offerId, itemGroupKey);
}

document.getElementById("tableSection").addEventListener("click", handleProductAction);
document.getElementById("cardSection").addEventListener("click", handleProductAction);
```

And `renderProductActions()` buttons would use attributes:
```html
<button data-action="push"     data-code="SKU001" ...>Push</button>
<button data-action="edit"     data-code="SKU001" ...>Edit</button>
<button data-action="withdraw" data-code="SKU001" data-offer-id="..." data-group-key="...">End</button>
```

Note: camelCase attribute `data-offerId` vs `dataset.offerId` — use `data-offer-id` → `btn.dataset.offerId` (browser auto-camelCases kebab-case attributes).

---

## 5. Dead code finding

**`renderCards()` has a dead code block (lines 638–649).**

The function computes `let actions = ""` and builds an if/else chain for all status branches, then the template literal at line 678 uses `${renderProductActions(p, true)}` instead of `${actions}`. The `actions` variable is never referenced in the template.

This is zero-behavior dead code that was likely left over from an earlier refactor where `renderCards()` was decoupled from `renderProductActions()` but the dead inline block was not removed.

**Dead inline onclicks in `renderCards()` (never fired):**
- Line 639: `openPush(code)` — not_listed
- Line 641: `openEdit(code)` — active
- Line 642: `doWithdraw(code, offerId, groupKey)` — active  
- Line 644: `openEdit(code)` — draft
- Line 646: `doPublish(code, offerId, groupKey)` — draft+offer
- Line 647: `openPush(code)` — draft, no offer
- Line 649: `openPush(code)` — ended

These are never inserted into the DOM. Removing the dead block is pure cleanup with zero behavior risk.

---

## 6. Safe conversion order (staged plan)

### Stage 0 — Dead code removal (trivially safe)

**Before touching any real action conversion, remove the dead `actions` block in `renderCards()`.**

- Remove `let actions = ""` and the 9-line if/else chain (lines 638–649)
- Verify `renderCards()` template still uses `renderProductActions(p, true)` (unchanged)
- Files: `index.js` only
- Risk: None (dead code, never in DOM)
- Verification: page loads, card view renders, all actions still work (unchanged path)

---

### Stage 1 — Non-mutating modal openers (low risk)

Convert `openPush` and `openEdit` from inline onclick to `data-action`.

Actions:
- `onclick="openPush('code')"` → `data-action="push" data-code="code"`
- `onclick="openEdit('code')"` → `data-action="edit" data-code="code"`

Where to change:
- `renderProductActions()` — all Push/Edit/Re-list/Resume Push/Restock buttons
- `ebayCodeLinkHtml()` is NOT affected (no openPush/openEdit there)
- `renderCards()` — the dead block would already be removed (Stage 0)

Add centralized dispatch in place of 2 existing `open-sales` listeners. Keep `window.openPush` and `window.openEdit` intact (backward compat, edit modal relink flow).

Verification checklist:
- Push modal opens from table and card views
- Edit modal opens from table and card views
- Existing `window.openPush`/`window.openEdit` still accessible (not removed)
- Sales history still works (now handled by same dispatcher)

Rollback: restore onclick strings, split listeners back to open-sales only.

---

### Stage 2 — Relink and clear-stale (medium risk, Supabase writes only)

Convert `relinkEbayListing` and `clearStaleEbayLink` from onclick to `data-action`.

Actions:
- `onclick="relinkEbayListing('code')"` → `data-action="relink" data-code="code"`
- `onclick="clearStaleEbayLink('code')"` → `data-action="clear-stale" data-code="code"`

Where to change:
- `renderProductActions()` — stale and out_of_stock state buttons
- `ebayCodeLinkHtml()` — inline relink button (line 230)
- `btnEditRelink` listener — change from `window.relinkEbayListing(...)` to direct function call

Also: `window.relinkEbayListing` and `window.clearStaleEbayLink` can be removed as globals once `btnEditRelink` is updated.

Verification checklist:
- Stale badge still shows
- Relink button in code badge still works (triggers confirm dialog, loads products)
- Mark Ended button still works
- Edit modal relink button still works (`btnEditRelink`)
- No broken confirm dialogs

Rollback: restore onclick strings, restore window globals, restore btnEditRelink call.

---

### Stage 3 — eBay mutation actions (high risk, convert last)

Convert `discardDraft`, `doWithdraw`, `doPublish` from onclick to `data-action`.

These require 3-arg data attributes: `data-code`, `data-offer-id`, `data-group-key`.

Where to change:
- `renderProductActions()` — End, Publish, Discard buttons

Prerequisite: Stage 1 and Stage 2 proven stable in production.

Verification checklist (each action must be manually tested against real data):
- End listing: confirm dialog appears, listing is ended on eBay, product reloads to ended status
- Publish: confirm dialog appears, listing publishes on eBay, product reloads to active status
- Discard draft: confirm dialog appears, draft is deleted on eBay, product resets to not_listed
- Variant listings: test with a group listing (has itemGroupKey)
- `offerId` and `groupKey` read correctly from `data-offer-id`/`data-group-key` attributes

Rollback: restore onclick strings with string-interpolated args.

---

## Summary table

| Action | Global | Args | eBay Mutation | Stage |
|---|---|---|---|---|
| `open-sales` | no (already delegated) | code | none | ✅ done |
| `openPush` | `window.openPush` | code | none | Stage 1 |
| `openEdit` | `window.openEdit` | code | none | Stage 1 |
| `relinkEbayListing` | `window.relinkEbayListing` | code | no (local write) | Stage 2 |
| `clearStaleEbayLink` | `window.clearStaleEbayLink` | code | no (local write) | Stage 2 |
| `discardDraft` | `window.discardDraft` | code, offerId, groupKey | **yes** | Stage 3 |
| `doWithdraw` | `window.doWithdraw` | code, offerId, groupKey | **yes** | Stage 3 |
| `doPublish` | `window.doPublish` | code, offerId, groupKey | **yes** | Stage 3 |

After Stage 3, `window.*` globals can be removed entirely. `window.relinkEbayListing` must be removed in Stage 2 at the same time as `btnEditRelink` is updated (they are coupled).
