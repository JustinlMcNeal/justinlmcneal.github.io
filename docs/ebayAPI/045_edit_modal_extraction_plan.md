# 045 — Edit Modal Extraction Plan (N-12)

**Date:** 2025-07  
**Status:** Planning only — no runtime JS changed in this phase.  
**Source file:** `js/admin/ebayListings/index.js` (~890 lines)  
**Target:** `js/admin/ebayListings/editModal.js` (new file, to be created in a later phase)  
**Reference pattern:** `pushModal.js` factory (completed N-6 → N-11)

---

## 1. Edit Modal State Variables

All eight `let` declarations are Edit-private. None is read or written by any page-level function or Push modal code.

| Variable | Type | Where set | Where read |
|---|---|---|---|
| `editProduct` | `object\|null` | `openEdit()`, close handler (→ null) | All Edit handlers, save handler |
| `editQuill` | `Quill\|null` | `openEdit()` (Quill constructor) | desc-mode buttons, AI fill, save handler |
| `editImageUrls` | `string[]` | `openEdit()` | save handler, AI fill handler, add-image listener |
| `editVariantImageOverrides` | `{[sku]: string[]}` | `openEdit()` (reset), `renderEditVariantImageControls` (mutated) | save handler (group path) |
| `editVariantQtyOverrides` | `{[sku]: number}` | `openEdit()` (reset), `renderEditVariantImageControls` (mutated) | save handler (group path) |
| `editAspects` | `object[]` | `openEdit()` (aspect fetch) | AI fill handler |
| `editSalesMetrics` | `object\|null` | `openEdit()` (loadAndRenderPriceRef callback) | `editPrice` input listener, `editAdRate` change listener |
| `editOfferLookupCache` | `Map` | `openEdit()` (reset to `new Map()`) | `getOffersForEdit()` calls in openEdit and save handler |

**Important: `editVariantImageOverrides` / `editVariantQtyOverrides` mutation pattern**  
`renderEditVariantImageControls` receives these objects by reference and writes keys into them via async callbacks wired inside its DOM listeners. After extraction these objects must live inside the factory's `state` block — they are passed by reference to `renderEditVariantImageControls` just as today, so mutation continues to work. The save handler reads them from `state.*` rather than from captured closures. This is the primary subtle risk of the extraction.

---

## 2. Edit-Only Handlers in `index.js`

All of the following are Edit-modal-specific. None touches Push state, page filters, or rendering.

### 2a. `openEdit(code)` — lines ~182–488 (~130 lines)
Full modal hydration async function:
- Finds product in `allProducts`
- Resets all 8 state vars
- Fetches eBay data (group or single path via `callEdge` + `getItemForEdit` + `getOffersForEdit`)
- Runs link reconciliation (`reconcileEbayLink`)
- Pre-fills every form field (title, condition, qty, lot, description, images, price, weight, dimensions, policies, best offer, store category, volume pricing, aspects, adRate)
- Initialises Quill editor (`resetQuillEditorMount`, `new Quill(...)`)
- Starts price reference (`loadAndRenderPriceRef`)
- Error handled via outer try/catch displaying in `editLoading`

### 2b. Event listeners (all registered inline, lines ~510–850)

| Listener | Element | Body size | Dependencies |
|---|---|---|---|
| Close | `btnCloseEdit` | 4 lines | none |
| Relink | `btnEditRelink` | 3 lines | `relinkEbayListing` (injected) |
| Live preview × 2 | `editPrice` input | 1 line each | `refreshEditPreview`, `refreshEditRef` |
| Live preview | `editWeightOz` input | 1 line | `refreshEditPreview` |
| Live preview | `editAdRate` change | 1 line | `refreshEditPreview`, `refreshEditRef` |
| Add image | `btnAddImgEdit` | 4 lines | `showGalleryPicker` |
| Desc visual | `btnEditVisual` | 2 lines | `descState`, `toggleDescMode` |
| Desc html | `btnEditHtml` | 2 lines | `descState`, `toggleDescMode` |
| Desc preview | `btnEditPreview` | 1 line | `toggleDescMode` |
| **AI Auto-Fill** | `btnEditAiFill` | ~70 lines | `callEdge`, `addAiBadge`, `esc`, `descState`, `toggleDescMode` |
| **Save Changes** | `btnSaveEdit` | ~120 lines | Many — see §3 |
| Best Offer toggle | `editBestOffer` | 1 line | — |
| Lot toggle | `editLotEnabled` | 1 line | — |
| Volume toggle | `editVolEnabled` | 3 lines | `addVolTier` |
| Add vol tier | `editAddTier` | 1 line | `addVolTier` |

**Approximate total Edit-modal code in index.js: ~365 lines** (130 openEdit + ~235 listeners).  
After full extraction index.js would shrink from ~890 to ~525 lines.

---

## 3. Shared Helpers / Imports Edit Depends On

### 3a. Direct module imports (currently in `index.js`) — move to `editModal.js` imports

These are imported in index.js but used **only** by Edit modal code. After full extraction these imports would be removed from `index.js` entirely.

| Module | Symbols used by Edit | Used elsewhere in index.js? |
|---|---|---|
| `./utils.js` | `esc`, `sanitizeForEbay`, `wrapDescription`, `isComplexHtml`, `buildImageUrls`, `buildPackageWeightAndSize`, `getSelectedPolicies`, `getBestOfferTerms`, `isEffectiveGroupListing`, `addAiBadge` | No — page-level rendering imports these from their own modules |
| `./editor.js` | `quillToolbar`, `descState`, `resetQuillEditorMount`, `toggleDescMode`, `getDescriptionHtml` | No — `pushModal.js` already imports these directly from editor.js |
| `./images.js` | `renderImageStrip`, `showGalleryPicker` | No |
| `./volPricing.js` | `addVolTier`, `getVolTiers`, `setVolTiers` | No — Push imports from volPricing.js directly in pushModal.js |
| `./aspectHelpers.js` | `buildEditAspectField` | No — Push uses `buildAspectField`/`collectAspects` from same module, in pushModal.js |
| `./variantPanel.js` | `renderEditVariantImageControls` | No — Push uses `renderVariantPanel`/`getCheckedVariants` in pushModal.js |
| `./modalPreviews.js` | `refreshEditPreview`, `refreshEditRef`, `loadAndRenderPriceRef` | No — Push imports `refreshPushPreview`, `refreshPushRef`, `loadAndRenderPriceRef` in pushModal.js |
| `./taxonomyApi.js` | `fetchAspectsForCategory` | No — Push uses `fetchCategorySuggestions` in pushModal.js |
| `./editFetch.js` | `getItemForEdit`, `getOffersForEdit`, `offerUpdateErrorMessage` | No |
| `./editFetch.js` | `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure` | No — verify these are actually called in index.js handlers; may just pass through to inner fns |
| `./policyCache.js` | `loadPoliciesCache` | Yes — `init()` calls `loadPoliciesCache()` to pre-warm cache at startup |
| `./linkCheck.js` | `isStaleLinkCheck`, `isOutOfStockLinkCheck`, `currentActiveListingId`, `staleLinkMessage` | No — other linkCheck exports in index.js (`isLinkedOnEbay`, `staleActionState`, etc.) are used by rendering/reconcile |
| `./api.js` | `callEdge` | Yes — Push also uses callEdge; it's a shared import — both editModal.js and pushModal.js (and index.js for tableActions) import it directly |

### 3b. Shared/page-level dependencies — injected as factory parameters

These cannot be imported directly into `editModal.js` because they depend on page-level state or cross-cutting construction:

| Dependency | Source | Used in Edit for |
|---|---|---|
| `getProducts()` | `() => allProducts` | `openEdit()` — find product by code |
| `loadProducts()` | page-level function | save handler success callback |
| `showStatus()` | page-level function | (not used currently, but consistent with Push pattern — add for parity) |
| `getAdRatePct()` | `() => pageAdRatePct` | `openEdit()` — pre-fills editAdRate field |
| `supabase` | `getSupabaseClient()` | save handler — `supabase.from("products").update(...)` store category persist |
| `reconcileEbayLink` | `createReconcileActions(...)` | `openEdit()` link check, save handler pre-check |
| `renderEditLinkWarning` | `createReconcileActions(...)` | `openEdit()` and save handler |
| `relinkEbayListing` | `createReconcileActions(...)` | `btnEditRelink` listener |

**Note on `supabase`:** This is the one new injection vs the Push modal. Pass the existing `supabase` client instance (not the factory). The DB write is a single call and cannot be moved to an edge function without a new endpoint.

**Note on `loadPoliciesCache`:** Called directly in `index.js init()` as a startup warm. After extraction `editModal.js` imports `loadPoliciesCache` directly and calls it inside `openEdit()`. The `init()` call in index.js can be removed, or kept as an explicit pre-warm — keeping it is fine (idempotent, cached after first call).

---

## 4. Recommended Factory Shape

Following the established `createPushModalContext` pattern:

```js
/**
 * editModal.js — Edit modal context factory.
 *
 * Owns all Edit-modal state and handlers: openEdit, Save Changes,
 * AI Auto-Fill, description mode, image picker, aspects, volume
 * pricing, best offer, lot, variant image/qty overrides, and
 * all toggle controls.
 *
 * Shared dependencies injected via factory:
 *   getProducts()         — page-level product list
 *   loadProducts()        — page-level reload
 *   showStatus()          — page-level status bar
 *   getAdRatePct()        — shared ad rate
 *   supabase              — Supabase client (for store category DB write)
 *   reconcileEbayLink     — from createReconcileActions
 *   renderEditLinkWarning — from createReconcileActions
 *   relinkEbayListing     — from createReconcileActions
 */
export function createEditModalContext({
  getProducts            = () => [],
  loadProducts           = async () => {},
  showStatus             = () => {},
  getAdRatePct           = () => 0,
  supabase               = null,
  reconcileEbayLink      = async () => ({}),
  renderEditLinkWarning  = () => {},
  relinkEbayListing      = async () => {},
} = {}) {

  const state = {
    currentProduct:              null,
    editQuill:                   null,
    editImageUrls:               [],
    editVariantImageOverrides:   {},
    editVariantQtyOverrides:     {},
    editAspects:                 [],
    editSalesMetrics:            null,
    editOfferLookupCache:        new Map(),
  };

  const deps = { getProducts, loadProducts, showStatus, getAdRatePct,
                 supabase, reconcileEbayLink, renderEditLinkWarning, relinkEbayListing };

  // Accessors — one pair per state field
  function getCurrentProduct()            { return state.currentProduct; }
  function setCurrentProduct(p)           { state.currentProduct = p; }
  // ... (8 pairs)

  function resetEditState() {
    state.currentProduct            = null;
    state.editQuill                 = null;
    state.editImageUrls             = [];
    state.editVariantImageOverrides = {};
    state.editVariantQtyOverrides   = {};
    state.editAspects               = [];
    state.editSalesMetrics          = null;
    state.editOfferLookupCache      = new Map();
  }

  async function openEdit(code) { /* ... ~130 lines ... */ }

  async function handleEditAiFill() { /* ... ~70 lines ... */ }

  async function handleEditSave() { /* ... ~120 lines ... */ }

  function bindEditListeners() {
    document.getElementById("btnCloseEdit").addEventListener("click", () => {
      document.getElementById("editModal").classList.add("hidden");
      document.getElementById("editImagePicker").classList.add("hidden");
      resetEditState();
    });
    // ... all 14 remaining Edit listeners ...
  }

  return {
    openEdit,
    resetEditState,
    bindEditListeners,
    // Accessors — available for any future caller; internal use is primary
    getCurrentProduct, setCurrentProduct,
    getEditQuill,      setEditQuill,
    getEditImageUrls,  setEditImageUrls,
    getEditVariantImageOverrides, setEditVariantImageOverrides,
    getEditVariantQtyOverrides,   setEditVariantQtyOverrides,
    getEditAspects,    setEditAspects,
    getEditSalesMetrics, setEditSalesMetrics,
    getEditOfferLookupCache, setEditOfferLookupCache,
  };
}
```

**Index.js wire-up after full extraction:**
```js
import { createEditModalContext } from "./editModal.js";

const editCtx = createEditModalContext({
  getProducts:           () => allProducts,
  loadProducts,
  showStatus,
  getAdRatePct:          () => pageAdRatePct,
  supabase,
  reconcileEbayLink,
  renderEditLinkWarning,
  relinkEbayListing,
});

// In dispatcher setup:
const handleProductAction = createProductActionDispatcher({
  openPush: pushCtx.openPush,
  openEdit: editCtx.openEdit,   // ← changed
  ...
});

// In listener setup:
editCtx.bindEditListeners();
```

---

## 5. Proposed Migration Phases

Modelled on the Push modal extraction (N-6 → N-11), with phases sized to be individually reviewable and independently verifiable. No phase makes eBay payload changes.

---

### Phase E-1 — State boundary (state + accessors only)
**Goal:** Move 8 `let` vars out of index.js module scope into factory state. Accessors are internal; index.js keeps all handlers but calls state via `editCtx.get*()`/`editCtx.set*()`.

**Changes:**
1. Create `editModal.js` with factory shell, `state` object (8 fields), 8 accessor pairs, `resetEditState()`.
2. In `index.js`: remove the 8 `let` declarations; add `const editCtx = createEditModalContext(...)` with full 8-param deps.
3. In `openEdit()`, replace all `editProduct =`, `editQuill =`, etc. with `editCtx.setCurrentProduct()` etc. Replace all reads likewise.
4. In all Edit listeners in index.js, replace direct var access with accessor calls.

**Verification:** `node --check` both files. Open/close Edit modal; save a listing; AI fill; variant listing edit.

**Risk:** Highest mechanical change count (every direct var access in ~365 lines changes). But entirely mechanical — find `editProduct` → `editCtx.getCurrentProduct()`, etc. No logic changes.

---

### Phase E-2 — Move `openEdit` into factory
**Goal:** `openEdit(code)` body moves verbatim into editModal.js.

**Changes:**
1. Move `async function openEdit(code) { ... }` into factory body in editModal.js.
2. Add `openEdit` to return object.
3. In `index.js`: remove the function; update `createProductActionDispatcher` call to `openEdit: editCtx.openEdit`.
4. All imports only needed by openEdit move to editModal.js; remove from index.js.

**Verification:** Same as E-1.

---

### Phase E-3 — Extract named handlers
**Goal:** Extract the two large inline listeners as named functions inside the factory.

**Changes:**
1. Extract `handleEditAiFill()` as a named `async function` inside the factory. Wire in `bindEditListeners()`.
2. Extract `handleEditSave()` as a named `async function` inside the factory. Wire in `bindEditListeners()`.
3. The inline listeners in index.js for these two buttons are replaced with one-liner delegations into the factory's `bindEditListeners()`.
4. Move their remaining exclusive imports (if any) to editModal.js.

**Verification:** AI fill populates fields. Save updates eBay item + offer + store category + volume pricing. Group listing multi-variant save path verified.

---

### Phase E-4 — `bindEditListeners()` and final listener migration
**Goal:** All 14 remaining Edit listeners move into `bindEditListeners()` inside the factory. Index.js calls `editCtx.bindEditListeners()` in one line.

**Changes:**
1. Move close, relink, live preview (×4), add image, desc mode (×3), checkbox toggles (×3), add-tier into `bindEditListeners()`.
2. In index.js remove all Edit listener blocks; add `editCtx.bindEditListeners();`.
3. Remove all remaining Edit-only imports from index.js.

**Verification:** Test all listener-driven interactions: close, relink, image add, description visual/html/preview mode toggle, best offer checkbox, lot checkbox, volume pricing toggle, tier add.

---

### Phase E-5 — Boundary audit (mirrors N-11)
**Goal:** Verify index.js is fully clean; remove any stale code from editModal.js.

**Checklist:**
- [ ] index.js has no Edit-only `let` vars
- [ ] index.js has no Edit handler bodies
- [ ] All Edit-only imports removed from index.js
- [ ] `editCtx` return object exports only what is actually used externally
- [ ] Potential dead imports in index.js audited (see §6 risks)
- [ ] `node --check` both files
- [ ] Write doc 046

---

## 6. Risks and Behaviour-Preservation Notes

### R-1 — `editVariantImageOverrides` / `editVariantQtyOverrides` mutation ownership
`renderEditVariantImageControls` in `variantPanel.js` receives these objects by reference and writes into them asynchronously via DOM event callbacks it wires internally. After E-1, these live in `state`. When passed to `renderEditVariantImageControls` as `state.editVariantImageOverrides`, they continue to be mutated into the correct object. The save handler must read `state.editVariantImageOverrides` (not a stale captured copy). **Do not snapshot or copy these in openEdit before passing to renderEditVariantImageControls.**

### R-2 — `descState` singleton
`editor.js` exports a single module-level `descState = { editMode: "visual" }` object. Both `pushModal.js` and `index.js` (and future `editModal.js`) import this same reference. `descState.editMode` is set by description-mode buttons and the AI fill handler. The two modals cannot be open simultaneously in the current UI, so concurrent mutation is not a concern. However, both modals write to the same key (`editMode`) — after E-1, confirm that Push and Edit each read `descState.editMode` only in the context of their own Quill editor, which is the current behaviour.

### R-3 — `supabase` client injection (new vs Push modal)
The save handler does one Supabase write: `supabase.from("products").update({ ebay_store_category: ... }).eq("id", ...)`. This is the only direct Supabase call in Edit. Inject the existing client instance (not a new one). If the client is not provided, the store category persist silently fails — add a guard: `if (deps.supabase) await deps.supabase.from(...).update(...)`.

### R-4 — `loadPoliciesCache` at init
Currently called twice: in `init()` (pre-warm) and in `openEdit()`. After extraction, `editModal.js` imports and calls `loadPoliciesCache()` inside `openEdit()`. The `init()` call in index.js can be retained as a pre-warm (it's idempotent) or delegated via `editCtx.warmCache()`. Simplest is to keep the importin both files — the module-level cache in policyCache.js handles deduplication.

### R-5 — Dead imports potentially already in `index.js`
The following imports in index.js may not be used directly by index.js code and may already be dead (rendering modules import their own deps):
- `computeHealth` from `./listingHealth.js`
- `formatRelativeDate`, `wsChips`, `epCls`, `rowEstProfitHtml` from `./renderHelpers.js`
- `renderProductActions` from `./productActions.js`
- `updateBulkBar` from `./bulkActions.js`
- `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure` from `./editFetch.js` (used internally by `getItemForEdit`/`getOffersForEdit` — verify before moving)

Do not remove these in Edit extraction phases. Audit and clean in E-5.

### R-6 — `linkCheck` imports split after extraction
After E-4, index.js no longer uses `isStaleLinkCheck`, `isOutOfStockLinkCheck`, `currentActiveListingId`, or `staleLinkMessage` directly. These become dead imports in index.js and should be removed in E-5. The remaining linkCheck imports (`isLinkedOnEbay`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `ebayCodeLinkHtml`) remain if used by reconcileActions or rendering.

### R-7 — Close handler now calls `resetEditState()`
The current close handler only nulls `editProduct`. After extraction the close handler should call `resetEditState()` to clear all 8 state fields, matching the pattern in `resetPushState()`. This is a clean-up, not a behaviour change — the other 7 fields are re-initialised by `openEdit()` on next open anyway.

### R-8 — `Quill` global
Quill is accessed as `window.Quill` / `new Quill(...)` as a browser global loaded via CDN script tag. No import needed, same as in pushModal.js. No change required.

### R-9 — Group listing save path complexity
The save handler has a ~80-line group path and a ~40-line single path. Both paths call multiple `callEdge` invocations sequentially. No refactoring of this logic is needed — move verbatim. Verify both paths in production after E-3.

---

## 7. Index.js After Full Extraction — Expected Remaining Content

| Section | Lines (approx) |
|---|---|
| Imports (25 import statements → ~15 after cleanup) | ~45 |
| Supabase init | 2 |
| Page-level state (allProducts, filteredProducts, currentView, pageAdRatePct, searchTimeout) | 7 |
| `createReconcileActions` + `createTableActions` | 10 |
| `createPushModalContext` instantiation | 5 |
| `createEditModalContext` instantiation (new) | 10 |
| `showStatus()` | 6 |
| `loadProducts()` | 10 |
| `applyFilters()`, `renderAll()`, `setView()` | 25 |
| `updateStats()` | 7 |
| Event listeners — search, filter, view toggle, adRate | 20 |
| Push delegation comments + 2 bind calls | 5 |
| Edit bind call | 1 |
| `createProductActionDispatcher` + table/card/sales listeners | 15 |
| Bulk actions, refresh | 5 |
| `init()` + call | 10 |
| **Estimated total** | **~183 lines** |

Current: ~890 lines. Projected: ~183 lines — **79% reduction** from a 730-line Edit + cleanup delta.

---

## 8. No Runtime Changes in This Phase

Verified: only the planning document (`045_edit_modal_extraction_plan.md`) was written. No JS files were modified.
