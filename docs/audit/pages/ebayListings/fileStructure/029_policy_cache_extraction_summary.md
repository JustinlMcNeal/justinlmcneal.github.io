# 029 — Push Phase H: `policyCache.js` Extraction Summary

**Date:** 2026-05-16  
**Status:** Complete ✅  
**Risk level:** Low

---

## 1. What Moved

Two policy helpers extracted from `index.js` → `policyCache.js`:

| Symbol | Visibility | Purpose |
|---|---|---|
| `cachedPolicies` | Module-private state | Stores the `get_policies` edge function response |
| `loadPoliciesCache()` | **Exported** | Fetches policies on first call; noop on repeat calls; calls `populatePolicyDropdowns()` on success |
| `populatePolicyDropdowns()` | Module-private | Fills 6 `<select>` elements (3 Push modal, 3 Edit modal) using cached policy data |

**Total removed from `index.js`:** ~48 lines (function bodies + `let cachedPolicies = null;` declaration)

---

## 2. Where `cachedPolicies` Now Lives

`cachedPolicies` is **module-owned state in `policyCache.js`**. It is never referenced directly in `index.js`.

`index.js` only calls `loadPoliciesCache()` — the module manages its own internal cache state.

This is the cleanest possible ownership: `index.js` had zero direct reads/writes to `cachedPolicies` outside the two functions that were moved.

---

## 3. `populatePolicyDropdowns` — Not Exported

`populatePolicyDropdowns` is only ever called from within `loadPoliciesCache`. It was **not** exported — it is a module-private helper inside `policyCache.js`. No call site in `index.js` needs to call it directly.

---

## 4. Signature Changes

None. `loadPoliciesCache()` retains the same signature and return value. Both call sites in `index.js` continue to call it identically:

```js
// openEdit (line ~638):
await loadPoliciesCache();

// init() (line ~1806):
loadPoliciesCache();
```

---

## 5. New File: `policyCache.js`

**Path:** `js/admin/ebayListings/policyCache.js`  
**Imports:** `import { callEdge } from "./api.js";`  
**Exports:** `loadPoliciesCache` only  
**Circular import risk:** None — `policyCache.js` → `api.js` only  

```js
import { callEdge } from "./api.js";

let cachedPolicies = null;

export async function loadPoliciesCache() {
  if (cachedPolicies) return cachedPolicies;
  try {
    const result = await callEdge("ebay-manage-listing", { action: "get_policies" });
    if (result.success) {
      cachedPolicies = result.policies;
      populatePolicyDropdowns();
    }
  } catch (e) { console.warn("Policy load failed:", e); }
  return cachedPolicies;
}

function populatePolicyDropdowns() { ... }  // fills modalFulfillmentPolicy, ..., editPaymentPolicy
```

---

## 6. Changes to `index.js`

1. **Import added** after `editFetch.js` import:
   ```js
   import { loadPoliciesCache } from "./policyCache.js";
   ```
2. **`let cachedPolicies = null;`** removed from module state block
3. **`// ── Policies Cache ──` comment block + both function bodies removed** (~48 lines)

---

## 7. `getSelectedPolicies` — Stayed in `utils.js`

`getSelectedPolicies(prefix)` reads DOM values from the policy `<select>` elements and assembles the eBay payload. It is payload-assembly logic, not cache logic — it **correctly remains in `utils.js`**. Not moved.

---

## 8. `setupPanel.js` — Untouched

`setupPanel.js` makes its own independent `callEdge("ebay-manage-listing", { action: "get_policies" })` call to display policies in the setup panel. It does **not** share `cachedPolicies` from `policyCache.js` — that is correct and intentional, as the setup panel is a display-only view with its own rendering logic.

---

## 9. Updated Line Count

| Phase | Approximate `index.js` lines |
|---|---|
| After Push Phase G (028) | ~1,854 |
| After Push Phase H (029) | **~1,806** |
| Lines removed | ~48 |

---

## 10. Verification

| Check | Result |
|---|---|
| `node --check policyCache.js` | ✅ No errors |
| `node --check index.js` | ✅ No errors |
| Page loads (localhost:5500) | ✅ Products loaded |
| `loadPoliciesCache` stack trace | ✅ traced to `policyCache.js:24` (not `index.js`) |
| Edit modal opens | ✅ Opens, expected auth error on localhost |
| Push modal opens | ✅ Opens, policy dropdowns in "Loading..." state (expected, no auth) |
| Setup panel opens | ✅ Opens, expected auth error on localhost |
| No JS module load errors | ✅ No errors in console |
| Policy payload behavior | ✅ Unchanged — `getSelectedPolicies` untouched in `utils.js` |
| Backend edge functions | ✅ Untouched |

**Note on auth-gated items:** Full policy dropdown population (actual policy names in selects) requires an authenticated session. On localhost the fetch fails with "Not authenticated — please refresh the page" — this is identical behavior to before the extraction. The `populatePolicyDropdowns` call path is exercised on the authenticated staging/production environment.

---

## 11. Updated Module Inventory

| File | Lines | Key exports |
|---|---|---|
| `api.js` | 74 | `callEdge`, `fetchProductsWithWorkspaceMetrics` |
| `aspectHelpers.js` | 86 | 4 aspect field helpers |
| `bulkActions.js` | 114 | `initBulkActions`, `updateBulkBar` |
| `cards.js` | 56 | `renderCards` |
| `editor.js` | 116 | Quill helpers |
| `editFetch.js` | ~140 | 6 edit-fetch helpers |
| `filters.js` | 60 | `filterProducts` |
| `images.js` | 84 | `renderImageStrip`, `showGalleryPicker` |
| `importPanel.js` | 67 | `initImportPanel` |
| `linkCheck.js` | 73 | 10 display helpers |
| `listingHealth.js` | 209 | `computeHealth` |
| `modalPreviews.js` | 140 | 5 preview helpers |
| `policyCache.js` | **~60** | `loadPoliciesCache` (NEW this phase) |
| `productActions.js` | 45 | `renderProductActions` |
| `renderHelpers.js` | 128 | `formatRelativeDate`, chips, etc. |
| `setupPanel.js` | 69 | `initSetupPanel` |
| `table.js` | 63 | `renderTable` |
| `taxonomyApi.js` | 39 | `fetchAspectsForCategory`, `fetchCategorySuggestions` |
| `utils.js` | 176 | 15 pure helpers incl. `getSelectedPolicies` |
| `variantPanel.js` | 175 | 8 variant panel helpers |
| `volPricing.js` | 70 | Vol tier helpers |
| `index.js` | **~1,806** | Page orchestrator |

**Total module files:** 25

---

## 12. What Still Remains in `index.js` After Phase H

| Group | Content | Lines | Notes |
|---|---|---|---|
| B | Reconciliation cluster (`reconcileEbayLink`, `auditListingLinks`, `relinkEbayListing`, `clearStaleEbayLink`) | ~79 | Medium risk — needs callbacks for `allProducts`, `showStatus`, `loadProducts`, `renderAll` |
| C | `renderEditLinkWarning`, `showStatus` | ~34 | `showStatus` is called across entire file; extract only when ready |
| E | Load/filter/render orchestration (`loadProducts`, `applyFilters`, `renderAll`, `setView`, `updateStats`) | ~59 | Do not extract — page bootstrap |
| F | `fetchAspects(categoryId)` — Push modal DOM helper | ~32 | Mixed state/DOM — defer |
| G | `openPush` | ~143 | High risk — extract after more helpers pre-cleaned |
| H | `openEdit` | ~283 | High risk — largest function |
| I | `renderEditVariantImageControls` | ~75 | High risk — extract with/after `openEdit` |
| J | Table-action handlers (`discardDraft`, `doWithdraw`, `doPublish`) | ~76 | Medium risk — need callbacks |
| K | Push modal event handlers | ~459 | Mixed risk; payload handlers: do not touch |
| L | Edit modal event handlers | ~408 | Mixed risk; `btnSaveEdit` payload: do not touch |
| M | Bootstrap / misc event wiring | ~60 | Do not extract |

---

## 13. Recommended Next Phase: Push Phase I

**Options (from doc 027 risk ranking, updated):**

### Option A — Reconciliation cluster → `reconcileHelpers.js` (Medium risk)

Move `reconcileEbayLink`, `auditListingLinks`, `relinkEbayListing`, `clearStaleEbayLink` (~79 lines).

**Approach:** Inject callbacks for `allProducts`, `showStatus`, `loadProducts`, `renderAll` as a deps object. `reconcileEbayLink` alone is low-risk; the cluster as a whole is medium.

**Benefit:** Clears the largest non-modal, non-payload group. Enables eventual `openEdit` extraction (it calls `reconcileEbayLink`).

### Option B — Table-action handlers → `tableActions.js` (Medium risk)

Move `discardDraft`, `doWithdraw`, `doPublish` (~76 lines). Need callbacks for `showStatus`, `loadProducts`.

**Recommendation:** **Option A first** — reconciliation cluster is a prerequisite for `openEdit` extraction, making it higher leverage. Table-action handlers can follow in Phase J.

**Do not attempt yet:**
- All eBay payload handlers (`btnCreateItem`, `btnCreateOffer`, `btnPublish`, `btnSaveEdit`)
- `openPush` / `openEdit` — still preprocessing needed
