# 023 — Aspect Helpers Extraction Summary (Push Phase C)

**Date:** 2026-05-15
**Phase:** Push Phase C
**Scope:** Extract aspect field builders + DOM collectors from `index.js` → `aspectHelpers.js`

---

## What Moved

### New file: `js/admin/ebayListings/aspectHelpers.js`

Four functions extracted from `index.js`:

| Function | Signature | Former location in index.js |
|---|---|---|
| `buildAspectField` | `(aspect, defaults, isRequired) → HTMLElement` | ~line 560 (Category/Aspects section) |
| `buildEditAspectField` | `(aspect, defaults, isRequired) → HTMLElement` | ~line 1018 (after Edit modal setup) |
| `collectAspects` | `() → Object` | ~line 577 |
| `validateRequiredAspects` | `() → string[]` | ~line 586 |

### Exports added to `aspectHelpers.js`
```js
export function buildAspectField(aspect, defaults, isRequired) { ... }
export function buildEditAspectField(aspect, defaults, isRequired) { ... }
export function collectAspects() { ... }
export function validateRequiredAspects() { ... }
```

### Import added to `index.js`
```js
import {
  buildAspectField,
  buildEditAspectField,
  collectAspects,
  validateRequiredAspects,
} from "./aspectHelpers.js";
```

---

## Why Each Was Safe to Move

### `buildAspectField(aspect, defaults, isRequired)`
- Pure DOM builder — creates a `<div>` with a label + `<input>` + optional `<datalist>`
- Only dependency: `esc` from `utils.js`
- No access to page state (`currentAspects`, `allProducts`, etc.)
- Used only inside `fetchAspects()` (which stays in `index.js`)
- HTML structure unchanged: `data-aspect`, `dl_` datalist prefix

### `buildEditAspectField(aspect, defaults, isRequired)`
- Identical pattern to `buildAspectField` but for Edit modal
- Only dependency: `esc` from `utils.js`
- No access to page state
- Used only inside the `openEdit` / aspect-loading block (stays in `index.js`)
- HTML structure unchanged: `data-edit-aspect`, `edl_` datalist prefix

### `collectAspects()`
- Pure DOM reader — reads `[data-aspect]` inputs, returns `{ aspectName: [value] }` object
- No page state reference
- Used in: `btnCreateItem` handler (~line 1483), `btnCreateOffer` group handler (~line 1647)

### `validateRequiredAspects()`
- Pure DOM reader — reads `[data-aspect][data-required='true']`, returns array of missing names
- No page state reference
- Used in: `btnCreateItem` handler (~line 1476)

---

## What Stayed in `index.js`

| Stayed | Reason |
|---|---|
| `fetchAspects(categoryId)` | Calls `callEdge` (eBay taxonomy API), reads/writes `currentAspects` state, mutates DOM directly — not a safe boundary |
| Edit aspect validation (inline) | Not a named function — inlined directly in edit save handler (~lines 1969-1983); no named extraction opportunity without churn |
| Edit aspect collection (inline) | Same as above (~lines 1980-1984) |
| `currentAspects` variable | Module-level state — stays in index.js |
| `editAspects` variable | Module-level state — stays in index.js |
| All modal event handlers | All remain in index.js per hard rules |
| `openPush` / `openEdit` | Remain in index.js per hard rules |

---

## Dependencies

`aspectHelpers.js`:
- Imports: `{ esc }` from `./utils.js`
- No circular imports
- No calls to `api.js`, `index.js`, or any modal module

---

## Files Changed

| File | Change |
|---|---|
| `js/admin/ebayListings/aspectHelpers.js` | **Created** — 4 exported functions |
| `js/admin/ebayListings/index.js` | Import added; 4 function definitions removed |

---

## Verification Results

| Check | Result |
|---|---|
| `node --check aspectHelpers.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| Page loads | ✅ 60 products rendered |
| Push modal opens | ✅ Opens, all fields hydrate correctly |
| Push step button states | ✅ Create Item enabled, Create Offer + Publish disabled |
| Edit modal opens | ✅ Opens with product name populated |
| No JS module import errors | ✅ Confirmed (no 404s on aspectHelpers.js) |
| eBay taxonomy aspect fields render | ⚠️ Not verifiable — requires live eBay auth for `fetchAspects()` API call; function itself is unchanged |
| Edit aspect field rendering | ⚠️ Same — requires live eBay auth for aspect load; `buildEditAspectField` body is byte-for-byte unchanged |
| Aspect values in payload | ✅ Confirmed by code inspection — `collectAspects()` and `validateRequiredAspects()` bodies are byte-for-byte identical to originals; call sites in `btnCreateItem` and `btnCreateOffer` handlers unchanged |
| No eBay payload changes | ✅ Confirmed — no payload code touched |
| No backend/edge function changes | ✅ Not touched |

---

## Next Recommended Phase

### Push Phase D — Variant Panel Helpers → `variantPanel.js`

**Target functions** (all in `index.js`):
- `renderVariantPanel(variants, productCode)`
- `renderVariantAssignedImages(variantSku, productCode)`
- `getAssignedVariantImages(variantSku)`
- `setAssignedVariantImages(variantSku, urls)`
- `renderVariantCandidatePicker(variantSku, productCode)`
- `refreshVariantCandidateButtons(variantSku)`
- `wireVariantImageSetControls()`
- `getCheckedVariants()`

**Risk level:** Medium — these functions interact with DOM containers and with `pushVariants`, `pushImageUrls` page state. Most can accept state as parameters, but `wireVariantImageSetControls` installs event listeners and may read/write multiple state variables.

**Approach:** Inspect each function fully for state dependencies before extracting. Any function that reads/writes `pushVariants` or `pushImageUrls` must receive those as parameters. Wire functions that install global event handlers may be better left in `index.js`.

**After Phase D:** Push Phase E — `openPush` hydration function and push button event handlers → `pushModal.js` (highest risk, do last together).
