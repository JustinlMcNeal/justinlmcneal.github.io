# 044 — Push Modal Boundary Audit (N-11)

**Date:** 2025-07  
**Files:** `js/admin/ebayListings/pushModal.js`, `js/admin/ebayListings/index.js`  
**Scope:** Final boundary audit after N-6 → N-10 migration; no behaviour changes.

---

## Audit Findings

### index.js — CLEAN

| Check | Result |
|-------|--------|
| Push-only `let` vars | None — all state vars are Edit-prefixed or page-level |
| Push handler bodies | None — only `pushCtx.openPush`, `bindCreateItemListener()`, `bindRemainingPushListeners()` |
| Push imports | None — all imports are for Edit modal or page-level utilities |
| pushCtx instantiation | Clean 4-param factory call: `getProducts`, `loadProducts`, `showStatus`, `getAdRatePct` |

**pushCtx surface used by index.js (complete list):**
```js
pushCtx.openPush     // passed to createProductActionDispatcher
pushCtx.bindCreateItemListener()   // called once in listener setup
pushCtx.bindRemainingPushListeners()  // called once in listener setup
```
No accessor, no `pushCtx.state`, no `pushCtx.deps` referenced externally.

---

### pushModal.js — Cleanup Applied

**Three stale migration-era comments removed:**

1. `resetPushState()` JSDoc:  
   `"Safe to call at Push modal close once the close handler migrates here."`  
   → Replaced with: `"Called by the Push modal close handler."`  
   _(Close handler has been in pushModal.js since N-6.)_

2. `openPush()` JSDoc:  
   `"Behavior is identical to the former inline openPush() in index.js."`  
   → Removed entirely.

3. `handleCreateItem()` JSDoc:  
   `"Behavior is identical to the former inline handler in index.js."`  
   → Removed entirely.

**Return object trimmed — `deps` and `state` removed:**  
These raw internal objects were exported but never consumed by index.js or any other caller. Removing them enforces the intended opaque-factory boundary.

**Return object (final):**
```js
return {
  openPush,
  getCurrentProduct, setCurrentProduct,
  getCurrentAspects, setCurrentAspects,
  getPushImageUrls,  setPushImageUrls,
  getPushVariants,   setPushVariants,
  getIsVariantListing, setIsVariantListing,
  getPushSalesMetrics, setPushSalesMetrics,
  getPushQuill,      setPushQuill,
  resetPushState,
  bindCreateItemListener,
  bindRemainingPushListeners,
};
```
Note: the accessor pairs (`get*`/`set*`) remain exported — they may be needed by any future caller and cost nothing to keep. The callers currently used are only the three listed in the index.js summary above.

---

## Verification

- `node --check js/admin/ebayListings/pushModal.js` — no errors
- `node --check js/admin/ebayListings/index.js` — no errors

---

## Final State

| File | Lines | Status |
|------|-------|--------|
| `pushModal.js` | 829 | All Push state/logic/handlers; clean factory; no migration artefacts |
| `index.js` | ~890 | Edit modal + page-level only; Push interaction via 3 pushCtx calls |

The refactor series (N-6 through N-11) is complete.
