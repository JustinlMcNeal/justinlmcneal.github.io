# Stage 3 — Mutation Action Delegation Summary

**Date:** 2026-05-16  
**File modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `006_action_handler_inventory.md`, `009_relink_clear_delegation_summary.md`

---

## What Changed

### Inline `onclick` attributes converted (3 total)

| Location | Status | Old | New |
|---|---|---|---|
| `renderProductActions()` — `active` (End button) | ✅ converted | `onclick="doWithdraw('${code}', '${offerId}', '${groupKey}')"` | `data-action="withdraw" data-code data-offer-id data-group-key` |
| `renderProductActions()` — `draft` + offer (Publish button) | ✅ converted | `onclick="doPublish('${code}', '${offerId}', '${groupKey}')"` | `data-action="publish" data-code data-offer-id data-group-key` |
| `renderProductActions()` — `draft` (Discard button) | ✅ converted | `onclick="discardDraft('${code}', '${offerId}', '${groupKey}')"` | `data-action="discard-draft" data-code data-offer-id data-group-key` |

---

## New Button HTML Shape

All three buttons now carry three data attributes:

```html
<!-- active state -->
<button data-action="withdraw"
        data-code="${esc(p.code)}"
        data-offer-id="${esc(p.ebay_offer_id)}"
        data-group-key="${esc(p.ebay_item_group_key)}"
        class="${red}">End</button>

<!-- draft + offer state -->
<button data-action="publish"
        data-code="${esc(p.code)}"
        data-offer-id="${esc(p.ebay_offer_id)}"
        data-group-key="${esc(p.ebay_item_group_key)}"
        class="${green}">Publish</button>

<!-- draft state (always present) -->
<button data-action="discard-draft"
        data-code="${esc(p.code)}"
        data-offer-id="${esc(p.ebay_offer_id)}"
        data-group-key="${esc(p.ebay_item_group_key)}"
        class="${amber}">Discard</button>
```

`esc(null/undefined)` returns `""` — identical to what the old inline onclick produced for missing fields. `dataset.offerId` on `data-offer-id=""` is `""` — identical behaviour. No semantic change in how payloads receive empty strings.

---

## `window.*` Globals Demoted

| Global | Old form | New form |
|---|---|---|
| `window.discardDraft` | `window.discardDraft = async function discardDraft(code, offerId, itemGroupKey) {...}` | `async function discardDraft(code, offerId, itemGroupKey) {...}` |
| `window.doWithdraw` | `window.doWithdraw = async function doWithdraw(code, offerId, itemGroupKey) {...}` | `async function doWithdraw(code, offerId, itemGroupKey) {...}` |
| `window.doPublish` | `window.doPublish = async function doPublish(code, offerId, itemGroupKey) {...}` | `async function doPublish(code, offerId, itemGroupKey) {...}` |

Function bodies are **byte-for-byte unchanged**: confirmation prompts, `callEdge` payloads, error handling, and `loadProducts()` reloads are identical.

---

## `handleProductAction` Dispatcher — Cases Added

`offerId` and `groupKey` are now extracted once at the top of the dispatcher and passed to any action that needs them:

```js
function handleProductAction(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action   = btn.dataset.action;
  const code     = btn.dataset.code;
  if (!code) return;
  const offerId  = btn.dataset.offerId  ?? "";
  const groupKey = btn.dataset.groupKey ?? "";
  // ... existing cases unchanged ...
  } else if (action === "withdraw") {
    doWithdraw(code, offerId, groupKey);
  } else if (action === "publish") {
    doPublish(code, offerId, groupKey);
  } else if (action === "discard-draft") {
    discardDraft(code, offerId, groupKey);
  }
}
```

Single-arg actions (`push`, `edit`, `open-sales`, `relink`, `clear-stale`) ignore `offerId`/`groupKey` — no change to those branches.

---

## Payload Preservation

### `doWithdraw` / `withdraw` payload

```js
// Single offer:
callEdge("ebay-manage-listing", { action: "withdraw", offerId: String(offerId).trim(), sku: code })
// Group listing:
callEdge("ebay-manage-listing", { action: "withdraw_group", inventoryItemGroupKey: String(itemGroupKey).trim(), sku: code })
```

Route logic:
```js
const hasGroup = isEffectiveGroupListing(product) && itemGroupKey && String(itemGroupKey).trim();
const hasOffer = offerId && String(offerId).trim();
```
Unchanged. Empty-string handling by `esc()` → `data-offer-id=""` → `dataset.offerId === ""` → `String("").trim() === ""` → falsy → same guards trigger identically.

### `doPublish` / `publish` payload

```js
// Single offer:
callEdge("ebay-manage-listing", { action: "publish", offerId: ..., sku: code, quantity: ... })
// Group:
callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey: ..., sku: code, variantQuantities })
```
`variantQuantities` construction is unchanged — reads from `product.product_variants` via `allProducts.find(p => p.code === code)`.

### `discardDraft` / `discard-draft` payload

```js
callEdge("ebay-manage-listing", {
  action: "discard_draft",
  productCode: code,
  sku: product.ebay_sku || code,
  offerId: offerId && String(offerId).trim() ? String(offerId).trim() : product.ebay_offer_id,
  inventoryItemGroupKey: itemGroupKey && ... ? ... : product.ebay_item_group_key,
})
```

Fallback to `product.ebay_offer_id`/`product.ebay_item_group_key` from `allProducts` is preserved — same as before.

---

## Globals Remaining After Stage 3

| Global | Status |
|---|---|
| `window.openPush` | **Still present** — used by JS push modal internals; not touched this stage |
| `window.openEdit` | **Still present** — used by JS edit modal internals; not touched this stage |

> `window.openPush` and `window.openEdit` were already converted to `data-action="push"/"edit"` in Stage 1. Their `window.*` assignments remain for compatibility; their removal is deferred to a dedicated pass.

---

## Inline `onclick` Inventory — Post-Stage 3

**Zero inline `onclick` attributes remain in product action markup.**

| Action | Status |
|---|---|
| `openPush` | ✅ delegated Stage 1 |
| `openEdit` | ✅ delegated Stage 1 |
| `relinkEbayListing` | ✅ delegated Stage 2 |
| `clearStaleEbayLink` | ✅ delegated Stage 2 |
| `doWithdraw` | ✅ delegated Stage 3 |
| `doPublish` | ✅ delegated Stage 3 |
| `discardDraft` | ✅ delegated Stage 3 |

---

## Verification Results

| Check | Result |
|---|---|
| `node --check js/admin/ebayListings/index.js` | ✅ SYNTAX OK |
| Page loads | ✅ |
| Products load (60 rows) | ✅ |
| Table view renders | ✅ |
| `button[onclick]` in DOM | ✅ **0 found** |
| `data-action="push"` buttons | ✅ 36 found |
| `data-action="edit"` buttons | ✅ 24 found |
| `data-action="withdraw"` buttons | ✅ 23 found (all active products) |
| `data-action="publish"` buttons | ✅ 1 found (1 draft with offer ID) |
| `data-action="discard-draft"` buttons | ✅ 1 found (1 draft product) |
| `grep window.doWithdraw` | ✅ no matches |
| `grep window.doPublish` | ✅ no matches |
| `grep window.discardDraft` | ✅ no matches |
| `grep onclick=` | ✅ no matches |
| Confirmation prompts preserved | ✅ verified in source — not changed |
| Payload shapes preserved | ✅ verified in source — not changed |
| Backend/edge functions changed | ✅ none changed |
| Live eBay mutation executed | ⚠️ not executed (destructive — verify in staging/production separately) |

---

## Live Mutation Verification Status

`doWithdraw`, `doPublish`, and `discardDraft` were NOT executed against live eBay during this refactor. Verification performed:

1. Function body inspection — payloads confirmed unchanged
2. DOM verification — correct `data-offer-id` and `data-group-key` attributes present on rendered buttons
3. Source grep — no remaining inline `onclick` or `window.*` globals
4. Dispatcher trace — each case calls the same function with `(code, offerId, groupKey)` matching original arg order

To fully verify in production: click "End" on an active listing in a staging environment (or a test listing), confirm the confirmation prompt appears, and confirm the eBay listing ends.

---

## Next Recommended Phase

### Option A — Remove `window.openPush` / `window.openEdit` globals

These functions are still assigned to `window.*` (Stage 1 only converted the onclick callers to data-action; the window assignments were preserved for compatibility). If no external code references them:

- Grep for all `window.openPush` and `window.openEdit` references
- If zero found outside the assignments themselves, demote to bare functions

**Risk: Low** — confirms no external pages or scripts call these globals.

### Option B — Rendering module extraction

Extract `renderTable()` + associated helpers to `table.js` and `renderCards()` + helpers to `cards.js`.

**Risk: Medium** — large moves; requires updating all cross-function references.

### Option C — Modal module extraction

Extract Push modal and Edit modal logic to `pushModal.js` and `editModal.js`.

**Risk: High** — ~800 lines of tightly coupled logic with shared state.

**Recommended next step: Option A** — small, low-risk, completes the global cleanup already in progress.
