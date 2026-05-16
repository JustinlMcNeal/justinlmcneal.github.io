# 042 — Phase N-9: pushModal.js Internal Organization Audit

## Objective

With `pushModal.js` now fully owning the Push flow (after N-6 through N-8), phase N-9 audited the file for dead scaffolding left over from the incremental migration phases and removed it. No runtime behavior was changed.

---

## Changes Applied

### 1. File-level JSDoc Updated

Replaced the migration-era header (which described phases N-3 through N-7, listed "Does NOT own (deferred)" handlers, and described sync-back architecture) with a concise, accurate description of the current state.

| | Before | After |
|---|---|---|
| Described state | Scaffolding notes for incremental migration | Actual owned handlers |
| Listed "Does NOT own" | Create Item, Offer, Publish, AI fill, category search, close, live-update | *(section removed — all now owned)* |
| Shared-state commentary | Described sync-back callbacks to index.js | Describes 4 injected dependencies only |

### 2. Stale `@param` Docs Removed from Factory JSDoc

7 `@param {Function} [deps.on*Change]` entries (describing the sync-back callback API, which no longer exists) were removed from the `createPushModalContext` JSDoc. The 4 real dependency params remain.

### 3. Factory Signature Simplified

Removed 7 dead optional destructured parameters from the function signature:

```js
// Before (11 params)
export function createPushModalContext({
  getProducts               = () => [],
  loadProducts              = async () => {},
  showStatus                = () => {},
  getAdRatePct              = () => 0,
  onCurrentProductChange    = null,   // ← dead
  onPushQuillChange         = null,   // ← dead
  onPushImageUrlsChange     = null,   // ← dead
  onPushVariantsChange      = null,   // ← dead
  onIsVariantListingChange  = null,   // ← dead
  onCurrentAspectsChange    = null,   // ← dead
  onPushSalesMetricsChange  = null,   // ← dead
} = {}) {

// After (4 params)
export function createPushModalContext({
  getProducts  = () => [],
  loadProducts = async () => {},
  showStatus   = () => {},
  getAdRatePct = () => 0,
} = {}) {
```

### 4. `deps` Object Simplified

The internal `deps` object that stored all injected deps (including the now-removed callbacks) was reduced from 11 fields to 4:

```js
// Before
const deps = {
  getProducts, loadProducts, showStatus, getAdRatePct,
  onCurrentProductChange, onPushQuillChange, onPushImageUrlsChange,
  onPushVariantsChange, onIsVariantListingChange, onCurrentAspectsChange,
  onPushSalesMetricsChange,
};

// After
const deps = { getProducts, loadProducts, showStatus, getAdRatePct };
```

### 5. All 7 Setter Sync-Back Calls Removed

Each of the 7 accessor setters previously fired an `on*Change?.()` no-op after writing state. The dead call was removed and each setter was collapsed to a single line:

```js
// Before (multi-line with dead call)
function setCurrentProduct(p) {
  state.currentProduct = p;
  deps.onCurrentProductChange?.(p);   // always null — permanent no-op
}

// After (single line)
function setCurrentProduct(p) { state.currentProduct = p; }
```

Same pattern applied to: `setCurrentAspects`, `setPushImageUrls`, `setPushVariants`, `setIsVariantListing`, `setPushSalesMetrics`, `setPushQuill`.

### 6. Accessor Section Comment Updated

Removed "each setter fires its sync-back callback" from the section banner, which was no longer accurate.

---

## Behavior Guarantees

- All Push modal operations (open, create item, create offer, publish, AI fill, category search, descriptions, close, live previews, toggles) are **unchanged**.
- The public API exported from the factory return object is **unchanged**: `openPush`, all getters/setters, `resetPushState`, `bindCreateItemListener`, `bindRemainingPushListeners`.
- `index.js` is **unaffected** — it only calls `pushCtx.bindCreateItemListener()` and `pushCtx.bindRemainingPushListeners()`, neither of which was touched.
- The removed `on*Change` params had default value `null`; passing nothing (as `index.js` does) was already equivalent. No caller passed them since N-8.

---

## Verification

```
node --check js/admin/ebayListings/pushModal.js  → OK
node --check js/admin/ebayListings/index.js      → OK
```

Dead-ref scan (all clean):
- `onCurrentProductChange` — absent
- `onPushQuillChange` — absent
- `deps.on` — absent
- `sync-back callback` — absent
- `Phase N-3` — absent
- `Does NOT own` — absent

---

## File State After N-9

| File | Lines | Status |
|---|---|---|
| `pushModal.js` | 819 | Clean. 57 lines removed (dead params, deps fields, setter bodies, stale JSDoc). |
| `index.js` | ~890 | Unchanged by N-9. |

---

## Recommended Next Phase — N-10

**Split `bindRemainingPushListeners` into named internal sub-handlers.**

`bindRemainingPushListeners()` is ~230 lines of sequential `addEventListener` calls. The major async handlers (AI fill, Create Offer, Publish) are large enough that extracting them as named inner functions would improve debuggability and make stack traces readable without changing any behavior.

Suggested decomposition (all `function` declarations inside the factory, not exported):

| Handler | Extracted function name | Approx lines |
|---|---|---|
| AI Auto-Fill click | `handleAiFill()` | ~60 lines |
| Create Offer click | `handleCreateOffer()` | ~90 lines |
| Publish click | `handlePublish()` | ~50 lines |
| Create Item click | already extracted as `handleCreateItem()` | done |

`bindRemainingPushListeners` would then register the listeners and delegate:
```js
document.getElementById("btnAiFill").addEventListener("click", handleAiFill);
document.getElementById("btnCreateOffer").addEventListener("click", handleCreateOffer);
document.getElementById("btnPublish").addEventListener("click", handlePublish);
```

**Constraint:** no logic changes, no payload changes, no new external dependencies.
