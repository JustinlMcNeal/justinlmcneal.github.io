# 022 — Push Phase B: Small Shared UI Helper Extraction

## Summary
Moved three small shared DOM/UI helper functions from `index.js` into `utils.js` as the second safe Push-adjacent extraction (Push Phase B).

## What moved

| Function | Moved from → to | Type | Risk |
|---|---|---|---|
| `enableBtn(id, enabled)` | `index.js` → `utils.js` | Generic DOM state toggle | 🟢 Very low |
| `imageOptionLabel(url, idx)` | `index.js` → `utils.js` | Pure string formatter | 🟢 Very low |
| `addAiBadge(inputId, source)` | `index.js` → `utils.js` | Generic DOM badge injector | 🟢 Very low |

## Why each helper was safe

### `enableBtn`
- Takes `(id, enabled)` only — no module state
- Uses only `document.getElementById` and `classList` — no page-specific assumptions
- Called from `openPush`, create-item handler, create-offer handler, publish handler
- Zero eBay, zero Supabase

### `imageOptionLabel`
- Purely transforms a URL string to a display label
- No DOM, no state — `(url, idx) → string`
- Only call site: inside `renderVariantCandidatePicker` template literal

### `addAiBadge`
- Takes `(inputId, source)` — no module state
- Only reads DOM to find label near a given input; appends/replaces a `<span>`
- Called from both push AI fill (`modalTitle`, `modalDescriptionHtml`) and edit AI fill (`editTitle`, `editDescriptionHtml`)
- Zero eBay, zero Supabase

## What stayed in `index.js`

Everything else. No function that touches `currentProduct`, `isVariantListing`, `pushQuill`, `currentAspects`, or any eBay payload was moved.

## Files changed

### `utils.js`
Added a new `// ── Shared UI helpers ──` section at end of file with 3 exported functions.

### `index.js`
- Added 3 imports to the `./utils.js` import block: `enableBtn`, `imageOptionLabel`, `addAiBadge`
- Removed `enableBtn` function definition (12 lines + section comment)
- Removed `imageOptionLabel` function definition (4 lines)
- Removed `addAiBadge` function definition (13 lines + section comment)

## Dependencies of the moved functions

All three depend only on the browser DOM API — no imports from any project module.
No circular import risk.

## Verification

| Check | Result |
|---|---|
| `node --check utils.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| Page loads with 60 products | ✅ |
| Push modal opens and hydrates | ✅ |
| `btnCreateItem` enabled on open | ✅ `disabled: false` |
| `btnCreateOffer` disabled on open | ✅ `disabled: true` |
| `btnCreateOffer` carries gray classes | ✅ `bg-gray-100` confirmed |
| `btnPublish` disabled on open | ✅ `disabled: true` |
| Edit modal opens | ✅ |

AI badge behavior verified by code inspection: `addAiBadge` is called identically from both the push and edit AI fill handlers — no changes to call sites, arguments, or class names.

Live AI autofill was not executed (requires live eBay API call). Code path is unchanged.

No eBay payloads were changed.

## Next recommended phase

**Push Phase C** — Extract aspect helpers into `js/admin/ebayListings/aspectHelpers.js`:
- `buildAspectField(aspect, defaults, isRequired)` — DOM builder
- `collectAspects()` — DOM reader (`[data-aspect]`)
- `validateRequiredAspects()` — DOM validator (`[data-aspect][data-required='true']`)

Note: `buildEditAspectField` in the edit modal uses a different attribute (`data-edit-aspect`) and datalist prefix (`edl_`). These could be unified into one parameterized function in `aspectHelpers.js`, but only if the existing HTML attribute names in the page are not changed. Alternatively, export both separately.

After Phase C, proceed to **Push Phase D** (variant panel helpers → `variantPanel.js`).
