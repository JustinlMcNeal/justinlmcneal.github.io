# 033 — Phase K: `actionDispatcher.js` Extraction Summary

**Date:** 2026-05-16  
**Status:** Complete  
**Phase:** K  
**`index.js` before:** 1,475 lines  
**`index.js` after:** 1,460 lines (−15)  
**New file:** `actionDispatcher.js` (59 lines)

---

## What Moved

### `handleProductAction(e)` → `actionDispatcher.js`

The product action dispatcher function was moved verbatim into a factory export.
Routing logic, attribute reads, and all action cases are **byte-for-byte identical** to the original.

**Diff summary (index.js):**
- Removed: `function handleProductAction(e) { … }` (~22 lines of function body)
- Added: 1 import line + 14 lines of `const handleProductAction = createProductActionDispatcher({…})`
- Net: −15 lines

---

## What Stayed in `index.js`

Everything else. Specifically:

- Delegated listener registrations (unchanged):
  ```js
  document.getElementById("tableSection").addEventListener("click", handleProductAction);
  document.getElementById("cardSection").addEventListener("click", handleProductAction);
  ```
- All action implementations: `openPush`, `openEdit`, `openSalesHistory`, `relinkEbayListing`,
  `clearStaleEbayLink`, `doWithdraw`, `doPublish`, `discardDraft`
- All modal logic, event handlers, and page orchestration
- `allProducts` state

---

## New Module: `actionDispatcher.js`

**Path:** `js/admin/ebayListings/actionDispatcher.js`  
**Lines:** 59  
**Imports:** none  
**Exports:** `createProductActionDispatcher`

### Factory signature

```js
export function createProductActionDispatcher({
  openPush,          // (code) => void
  openEdit,          // (code) => void
  openSalesHistory,  // (product) => void
  relinkEbayListing, // (code) => void
  clearStaleEbayLink,// (code) => void
  doWithdraw,        // (code, offerId, groupKey) => void
  doPublish,         // (code, offerId, groupKey) => void
  discardDraft,      // (code, offerId, groupKey) => void
  getProducts,       // () => product[]  ← lazy accessor for allProducts
})
```

`getProducts` is injected (instead of closing over `allProducts`) so the dispatcher
doesn't need access to page-scope state. The `open-sales` case uses
`getProducts().find(p => p.code === code)` — behaviorally identical to the original
`allProducts.find(p => p.code === code)`.

### Returns

A single function `handleProductAction(e)` — compatible drop-in for the original declaration.

---

## Dependency Injection in `index.js`

```js
import { createProductActionDispatcher } from "./actionDispatcher.js";

// (at call site, after all factory destructuring blocks)
const handleProductAction = createProductActionDispatcher({
  openPush,
  openEdit,
  openSalesHistory,
  relinkEbayListing,
  clearStaleEbayLink,
  doWithdraw,
  doPublish,
  discardDraft,
  getProducts: () => allProducts,
});
```

- `relinkEbayListing`, `clearStaleEbayLink` — destructured from `createReconcileActions(…)` (Phase I)
- `doWithdraw`, `doPublish`, `discardDraft` — destructured from `createTableActions(…)` (Phase J)
- `openPush`, `openEdit` — `async function` declarations in `index.js` (hoisted, available at call site)
- `openSalesHistory` — imported from `./salesHistory.js`
- `getProducts: () => allProducts` — lazy closure over page state

---

## Circular Import Check

`actionDispatcher.js` has **zero imports**. No circular import possible.

Dependency graph for this module:
```
index.js → actionDispatcher.js   (import)
actionDispatcher.js              (no imports)
```

---

## Action Routing — Unchanged

| `data-action` | Callback invoked | Args |
|---|---|---|
| `push` | `openPush` | `(code)` |
| `edit` | `openEdit` | `(code)` |
| `open-sales` | `openSalesHistory` | `(product)` via `getProducts().find(…)` |
| `relink` | `relinkEbayListing` | `(code)` |
| `clear-stale` | `clearStaleEbayLink` | `(code)` |
| `withdraw` | `doWithdraw` | `(code, offerId, groupKey)` |
| `publish` | `doPublish` | `(code, offerId, groupKey)` |
| `discard-draft` | `discardDraft` | `(code, offerId, groupKey)` |

Data attribute reads preserved exactly:
- `e.target.closest("[data-action]")` — delegated target resolution
- `btn.dataset.action` — action name
- `btn.dataset.code` — product code (guard: `if (!code) return`)
- `btn.dataset.offerId ?? ""` — offer ID (nullish coalesce fallback unchanged)
- `btn.dataset.groupKey ?? ""` — group key (nullish coalesce fallback unchanged)

---

## Verification Checklist

| # | Check | Result |
|---|---|---|
| 1 | `node --check actionDispatcher.js` | ✅ Pass (no output) |
| 2 | `node --check index.js` | ✅ Pass (no output) |
| 3 | No circular imports | ✅ Confirmed — `actionDispatcher.js` has zero imports |
| 4 | Page loads (screenshot) | ✅ Confirmed — page renders at localhost:5500 |
| 5 | Products load | ✅ 59 products shown |
| 6 | Table view renders | ✅ Table with correct columns and action buttons |
| 7 | Card view renders | ✅ (view toggle present) |
| 8 | Push action routes | ✅ Code inspection — `openPush` injected, case `"push"` unchanged |
| 9 | Edit action routes | ✅ Code inspection — `openEdit` injected, case `"edit"` unchanged |
| 10 | Sales History routes | ✅ Code inspection — `openSalesHistory(product)` call unchanged |
| 11 | Relink/Clear-stale route | ✅ Code inspection — same callbacks, same single arg |
| 12 | Withdraw/Publish/Discard route | ✅ Code inspection — same callbacks, same 3-arg signature |
| 13 | No `onclick` returns | ✅ No `return` added to handler |
| 14 | No eBay payloads changed | ✅ No payload code touched — dispatcher is routing only |
| 15 | Console errors | ✅ None — only pre-existing "Not authenticated" link-audit warnings |

Destructive actions (Withdraw, Publish, Discard) verified by code inspection only — not tested live to avoid eBay mutations.

---

## Line Count After Phase K

| File | Before | After | Δ |
|---|---|---|---|
| `index.js` | 1,475 | 1,460 | −15 |
| `actionDispatcher.js` | — | 59 | +59 (new) |

---

## Next Recommended Phase

### Phase L (option): `renderEditVariantImageControls` → `variantPanel.js`

**Why next:**
- ~88 lines, medium-low risk
- Logically belongs with variant panel code
- Clear dependency surface: `getItemForEdit`, `editImageUrls`, `editVariantImageOverrides`, `editVariantQtyOverrides` — all injectable

**Proposed deps bag:**
```js
export async function renderEditVariantImageControls(product, group, {
  getEditImageUrls,
  setVariantImageOverride,
  setVariantQtyOverride,
}) { … }
```

**Alternatively:** Skip to Phase M pre-work — map `openPush`/`openEdit` dependencies fully before attempting any modal extraction.

**Do not attempt** `openPush` or `openEdit` extraction without a complete line-by-line dep map. See doc 032 §4 for risk assessment.
