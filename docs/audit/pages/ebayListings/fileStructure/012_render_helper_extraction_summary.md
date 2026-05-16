# Phase 4a — Render Helper Extraction Summary

**Date:** 2026-05-16  
**New file:** `js/admin/ebayListings/renderHelpers.js`  
**Files modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `003_refactor_phase_plan.md`, `011_final_global_cleanup_summary.md`

---

## What Moved

Four helpers extracted from `index.js` into `renderHelpers.js`:

| Function | Signature change | Dependencies |
|---|---|---|
| `formatRelativeDate(dtStr)` | None | None (pure) |
| `wsChips(p, health)` | None | `formatRelativeDate`, `esc` |
| `epCls(marginPct)` | None | None (pure) |
| `rowEstProfitHtml(p, adRatePct)` | Added `adRatePct` parameter | `buildEstimate`, `epCls`, `esc` |

### Signature change on `rowEstProfitHtml`

Previously, `rowEstProfitHtml(p)` read `pageAdRatePct` directly from the `index.js` module scope (a closure over a module-level `let`). To make the function self-contained and importable, `adRatePct` is now an explicit parameter.

Call sites updated:

```js
// Before (in index.js renderTable + renderCards):
rowEstProfitHtml(p)

// After:
rowEstProfitHtml(p, pageAdRatePct)
```

The rendered output is **identical** — `pageAdRatePct` was always passed in at render time; it is now explicit rather than implicit.

---

## What Stayed in `index.js`

| Function | Reason |
|---|---|
| `ebayCodeLinkHtml(p, compact)` | Depends on 5 stale-link helpers also used by `renderEditLinkWarning`, `staleActionBadge`, `reconcileEbayLink`, `auditListingLinks`. Moving it would require moving the whole stale-link cluster. Deferred to Phase 4b. |
| `staleActionBadge(p)` | Same stale-link cluster dependency. |
| `staleActionState(p)` | Used by `renderProductActions` (in index.js). Same cluster. |
| `isStaleLinkCheck`, `isOutOfStockLinkCheck`, `isLinkWarningCheck`, `staleLinkLabel`, `staleLinkMessage`, `currentActiveListingId`, `isLinkedOnEbay` | The cohesive stale-link helper cluster. Moving as a group is Phase 4b. |
| `renderTable()`, `renderCards()` | Phase 4 (full rendering extraction). Not this pass. |
| `renderProductActions()` | Stays with index.js for now. |
| `handleProductAction()` | Event delegation — belongs in index.js. |

---

## `renderHelpers.js` Dependencies

```
renderHelpers.js
  ├── ./utils.js          (esc)
  └── ./profitPreview.js  (buildEstimate)
```

No imports from `index.js`. No circular imports possible.

`index.js` dependency graph after this change:
```
index.js imports renderHelpers.js ✅
renderHelpers.js does NOT import index.js ✅
```

---

## `index.js` Change

Added import:
```js
import { formatRelativeDate, wsChips, epCls, rowEstProfitHtml } from "./renderHelpers.js";
```

Removed ~65 lines of function definitions (the four extracted functions).  
Updated 2 call sites: `rowEstProfitHtml(p)` → `rowEstProfitHtml(p, pageAdRatePct)`.

---

## Verification Results

| Check | Result |
|---|---|
| `node --check js/admin/ebayListings/renderHelpers.js` | ✅ SYNTAX OK |
| `node --check js/admin/ebayListings/index.js` | ✅ SYNTAX OK |
| No circular imports | ✅ confirmed (renderHelpers → utils + profitPreview only) |
| No stray function definitions in index.js | ✅ grep confirms zero matches |
| Page loads (no JS errors) | ✅ |
| 60 products load | ✅ |
| Table view renders | ✅ |
| Card view renders | ✅ |
| `.ws-chips` blocks rendered | ✅ 28 found |
| `.ws-chip-sales` chips rendered | ✅ 6 found |
| `.ep-badge` badges rendered | ✅ 60 found (1 per row) |
| Card view chips + badges | ✅ 88 elements found |
| `button[onclick]` in DOM | ✅ 0 found |
| `data-action="push"` buttons | ✅ 37 found |
| `data-action="edit"` buttons | ✅ 23 found |
| `data-action="withdraw"` buttons | ✅ 23 found |
| No payloads changed | ✅ confirmed |

---

## Next Recommended Phase

### Phase 4b — Stale-link helper cluster extraction

Move the cohesive stale-link helper group to a new module (e.g. `linkCheck.js` or extend `renderHelpers.js`):

```
isLinkedOnEbay
isStaleLinkCheck
isOutOfStockLinkCheck
isLinkWarningCheck
staleActionState
staleActionBadge
staleLinkLabel
staleLinkMessage
currentActiveListingId
ebayCodeLinkHtml      ← can move once the above cluster moves
```

**index.js** would then import back: `isLinkedOnEbay`, `isStaleLinkCheck`, `isLinkWarningCheck`, `staleLinkMessage`, `currentActiveListingId` for use in `reconcileEbayLink`, `auditListingLinks`, `renderEditLinkWarning`.

**Risk:** Low-to-medium. All functions are pure/stateless. Cross-references are read-only. No eBay mutations involved.

### Phase 4c — Full `renderTable` / `renderCards` extraction

After Phase 4b establishes `linkCheck.js`:
- Extract `renderTable()` → `table.js`
- Extract `renderCards()` → `cards.js`

**Risk:** Medium. Large template moves; shared references to all the helper modules established in 4a/4b.
