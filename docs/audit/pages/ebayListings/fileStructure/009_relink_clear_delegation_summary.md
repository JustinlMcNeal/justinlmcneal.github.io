# Stage 2 — relink / clear-stale Delegation Summary

**Date:** 2025-06-XX  
**File modified:** `js/admin/ebayListings/index.js`  
**Reference doc:** `006_action_handler_inventory.md`

---

## What Changed

### Inline `onclick` attributes converted (4 total)

| Location | Old | New |
|---|---|---|
| `ebayCodeLinkHtml()` | `onclick="relinkEbayListing('${...}')"` | `data-action="relink" data-code="${...}"` |
| `renderProductActions()` — stale (no safeRelink) | `onclick="clearStaleEbayLink('${...}')"` | `data-action="clear-stale" data-code="${...}"` |
| `renderProductActions()` — stale + safeRelink (relink btn) | `onclick="relinkEbayListing('${...}')"` | `data-action="relink" data-code="${...}"` |
| `renderProductActions()` — stale + safeRelink (clear btn) | `onclick="clearStaleEbayLink('${...}')"` | `data-action="clear-stale" data-code="${...}"` |
| `renderProductActions()` — stale out_of_stock (clear btn) | `onclick="clearStaleEbayLink('${...}')"` | `data-action="clear-stale" data-code="${...}"` |

> Note: the stale/out_of_stock block had 2 onclicks in close proximity; both converted.

---

## `window.*` Globals Removed

| Global | Old form | New form |
|---|---|---|
| `window.relinkEbayListing` | `window.relinkEbayListing = async function relinkEbayListing(code) {...}` | `async function relinkEbayListing(code) {...}` |
| `window.clearStaleEbayLink` | `window.clearStaleEbayLink = async function clearStaleEbayLink(code) {...}` | `async function clearStaleEbayLink(code) {...}` |

Both functions retain their confirm() dialogs, Supabase/Edge calls, and `loadProducts()` reload.

---

## Coupled Change — `btnEditRelink` Listener

The edit modal "Relink" button called `window.relinkEbayListing(editProduct.code)` directly (not via data-action).  
Updated in the same atomic commit:

```js
// Before
await window.relinkEbayListing(editProduct.code);

// After
await relinkEbayListing(editProduct.code);
```

This was the only non-delegated call site and had to be patched simultaneously.

---

## `handleProductAction` Dispatcher — Cases Added

```js
} else if (action === "relink") {
  relinkEbayListing(code);
} else if (action === "clear-stale") {
  clearStaleEbayLink(code);
}
```

Both cases read `data-code` only — no extra attributes needed (functions only take `code`).

---

## Inline `onclick` Inventory — Post-Stage 2

| Action | Status | Remaining inline |
|---|---|---|
| `openPush` | ✅ delegated (Stage 1) | — |
| `openEdit` | ✅ delegated (Stage 1) | — |
| `relinkEbayListing` | ✅ delegated (Stage 2) | — |
| `clearStaleEbayLink` | ✅ delegated (Stage 2) | — |
| `doWithdraw` | ⚪ Stage 3 | 1× (`active` → End button) |
| `doPublish` | ⚪ Stage 3 | 1× (`draft` → Publish button) |
| `discardDraft` | ⚪ Stage 3 | 1× (`draft` → Discard button) |

**3 inline onclicks remain** — all Stage 3 mutation actions.

---

## Verification

- `node --check js/admin/ebayListings/index.js` → **SYNTAX OK**
- `grep` for `window.relinkEbayListing` → **no matches**
- `grep` for `window.clearStaleEbayLink` → **no matches**
- `grep` for `onclick.*relinkEbayListing` → **no matches**
- `grep` for `onclick.*clearStaleEbayLink` → **no matches**
- DOM audit: 4 new `data-action` attributes present in generated HTML
- Regression: `push`, `edit`, `open-sales` actions unaffected
- Stage 3 `onclick=` attributes (`doWithdraw`, `doPublish`, `discardDraft`) intentionally preserved

---

## Next: Stage 3

Convert `doWithdraw`, `doPublish`, `discardDraft` to delegated `data-action` handlers.

**Risk: HIGH** — live eBay mutations, 3-argument signatures (`code`, `offerId`, `groupKey`).  
Requires `data-offer-id` and `data-group-key` attributes in rendered HTML and dispatcher reads.  
Only attempt after Stage 2 is proven stable in production.
