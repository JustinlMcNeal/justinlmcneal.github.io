# Phase 4b — Setup Panel Extraction Summary

**Date:** 2026-05-16  
**New file:** `js/admin/ebayListings/setupPanel.js`  
**Files modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `003_refactor_phase_plan.md`, `012_render_helper_extraction_summary.md`

---

## What Moved

Two event listeners extracted from `index.js` into `setupPanel.js`:

| Element | Action |
|---|---|
| `#btnSetup` | Toggle `#policiesPanel`; call `get_policies`; render policy list to `#policiesContent` |
| `#btnSetupLocation` | Call `setup_location` with `{ locationKey: "default" }`; update `#locationStatus` |

These ~39 lines were replaced with a single call:

```js
// index.js — before (39 lines of inline logic)
document.getElementById("btnSetup").addEventListener("click", async () => { … });
document.getElementById("btnSetupLocation").addEventListener("click", async () => { … });

// index.js — after (1 line)
initSetupPanel({ callEdge });
```

---

## What Stayed in `index.js`

| Symbol | Reason |
|---|---|
| `cachedPolicies` | Shared with Push modal and Edit modal |
| `loadPoliciesCache()` | Called by Push modal, Edit modal, and `init()` |
| `populatePolicyDropdowns()` | Fills 6 `<select>` elements in Push + Edit modals |

The Setup Panel's `btnSetup` handler makes its own **independent** `get_policies` API call and writes to `#policiesContent`. It never reads `cachedPolicies`. Therefore these three symbols did not need to be passed in or moved.

---

## Dependencies

| Dependency | Source |
|---|---|
| `callEdge` | Injected from `index.js` via `initSetupPanel({ callEdge })` |
| `esc` | Imported directly from `./utils.js` inside `setupPanel.js` |

---

## Module graph (updated)

```
index.js
  └─ api.js          (callEdge, fetchProductsWithWorkspaceMetrics)
  └─ filters.js      (filterProducts)
  └─ renderHelpers.js (formatRelativeDate, wsChips, epCls, rowEstProfitHtml)
  └─ setupPanel.js   (initSetupPanel)          ← NEW
  └─ utils.js        (esc, …)
  └─ profitPreview.js
  └─ listingHealth.js
```

No circular imports. `setupPanel.js` imports only from `utils.js`.

---

## Verification

| Check | Result |
|---|---|
| `node --check setupPanel.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| Products load (60 rows) | ✅ |
| `button[onclick]` count | ✅ 0 |
| `#btnSetup` toggles `#policiesPanel` | ✅ panel opens |
| `#policiesContent` populated | ✅ (auth error on localhost — expected) |
| Push modal opens | ✅ |
| Edit modal opens | ✅ |

---

## Next Phase

**Phase 4c — Link-Check Helper Cluster** (`linkCheck.js`)

Extract the stale/active link helper cluster from `index.js`:

| Function / variable | Type |
|---|---|
| `isLinkedOnEbay(p)` | pure |
| `isStaleLinkCheck(p)` | pure |
| `isOutOfStockLinkCheck(p)` | pure |
| `isLinkWarningCheck(p)` | pure |
| `staleActionState(p)` | pure |
| `staleActionBadge(p)` | pure |
| `staleLinkLabel(p)` | pure |
| `staleLinkMessage(p)` | pure |
| `ebayCodeLinkHtml(p)` | pure (renders HTML string) |
| `currentActiveListingId` | module-level `let` — needs injection if extracted |

All pure / stateless. Low risk. Paves the way for Phase 4d (`renderTable` / `renderCards` extraction).
