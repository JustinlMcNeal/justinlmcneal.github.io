# 048 — openEdit Dead Code Cleanup Summary (E-2b)

**Phase:** E-2b — Dead `openEdit` body + dead imports removed from `index.js`
**Date:** 2025-07
**Files changed:** `js/admin/ebayListings/index.js`

---

## What was done

Following E-2 (which moved `openEdit()` to `editModal.js` but left a migration-remnant body in `index.js`), this pass removed all dead code from `index.js`:

### 1 — Dead `openEdit` function removed

The wrapper function `async function openEdit(code) { return editCtx.openEdit(code); /* ~280 dead lines */ };` and its preceding `// ── Edit Modal ──` section header were removed entirely (15 202 bytes).

The `createProductActionDispatcher` call at the `openEdit:` key was already pointing to `editCtx.openEdit` directly (set during E-2), so no dispatcher change was needed.

### 2 — Dead imports removed (13 symbols across 9 modules)

| Symbol | Module | Reason removed |
|---|---|---|
| `isComplexHtml` | `utils.js` | only in dead openEdit body |
| `buildImageUrls` | `utils.js` | only in dead openEdit body |
| `isEffectiveGroupListing` | `utils.js` | only in dead openEdit body (save handler uses `editProduct._isGroup` flag) |
| `quillToolbar` | `editor.js` | only in dead openEdit body |
| `resetQuillEditorMount` | `editor.js` | only in dead openEdit body |
| `renderImageStrip` | `images.js` | only in dead openEdit body (`showGalleryPicker` kept) |
| `setVolTiers` | `volPricing.js` | only in dead openEdit body (`addVolTier` + `getVolTiers` kept) |
| `buildEditAspectField` | `aspectHelpers.js` | entire import removed |
| `renderEditVariantImageControls` | `variantPanel.js` | entire import removed |
| `loadAndRenderPriceRef` | `modalPreviews.js` | only in dead openEdit body (`refreshEditPreview` + `refreshEditRef` kept) |
| `fetchAspectsForCategory` | `taxonomyApi.js` | entire import removed |
| `getItemForEdit` | `editFetch.js` | only in dead openEdit body (`getOffersForEdit` + `offerUpdateErrorMessage` kept) |
| `isOutOfStockLinkCheck` | `linkCheck.js` | only in dead openEdit body |
| `currentActiveListingId` | `linkCheck.js` | only in dead openEdit body |

### 3 — Symbols intentionally preserved (conservative)

The following were **not** removed in this pass despite being potentially unused — they pre-date the openEdit migration and will be audited in E-5:

- `shortDelay`, `ebayErrorIds`, `isTransientGetItemFailure` (editFetch.js) — pre-existing, unclear if used by live getOffersForEdit path
- `isLinkedOnEbay`, `isLinkWarningCheck`, `staleActionState`, `staleActionBadge`, `staleLinkLabel`, `ebayCodeLinkHtml` (linkCheck.js) — may be referenced by rendering modules

---

## Verification

```
node --check js/admin/ebayListings/index.js   → 0 errors
node --check js/admin/ebayListings/editModal.js → 0 errors
```

`grep openEdit index.js` → 1 hit: `openEdit: editCtx.openEdit,` (dispatcher only)

---

## State after E-2b

| File | Purpose | Status |
|---|---|---|
| `editModal.js` | Full `openEdit()` implementation in factory | ✅ live |
| `index.js` | All live handlers (close, save, preview, AI fill, etc.) + thin `syncBack` bridge | ✅ clean |

Dead code lines removed: **~290 lines** (15 KB).  
Dead imports removed: **14 symbols across 9 modules**.

---

## Next: E-3

Move the remaining Edit event handlers (close, save, preview, AI fill, bulk toggles) into `editModal.js`, gradually eliminating the `syncBack` bridge.
