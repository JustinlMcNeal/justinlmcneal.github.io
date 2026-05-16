# Push Phase F — Taxonomy API Extraction (Doc 026)

## Summary

Extracted 2 pure taxonomy Edge Function wrappers from `index.js` into `taxonomyApi.js`.  
Behavior-preserving: no state moves, no DOM moves, same request/response shapes, same error semantics.

---

## New File

`js/admin/ebayListings/taxonomyApi.js`

### Imports
```js
import { callEdge } from "./api.js";
```

### Exports (2)

| Export | Purpose |
|---|---|
| `fetchAspectsForCategory(categoryId)` | Wraps `callEdge("ebay-taxonomy", { action: "get_aspects", categoryId })` |
| `fetchCategorySuggestions(query)` | Wraps `callEdge("ebay-taxonomy", { action: "suggest_category", query })` |

Both functions are pure API wrappers: they call the Edge Function and return the raw result.  
No state mutation, no DOM, no error UI.

### Dependency direction
`taxonomyApi.js` → `api.js` (leaf-to-leaf — clean direction, consistent with other extracted modules)

---

## What stayed in `index.js`

| Item | Why it stayed |
|---|---|
| `fetchAspects(categoryId)` | Mutates `currentAspects`, manipulates DOM (section show/hide, loading text, clears + populates req/optional containers) — cannot be cleanly extracted |
| `editAspects` assignment in `openEdit` | Tightly coupled to edit modal state and inline aspect rendering |
| `btnSearchCat` event listener (full) | DOM wiring, `sel.onchange` setup, `fetchAspects()` call — orchestration not a pure helper |
| `currentAspects` / `editAspects` state | Module-level state — stays in index.js |
| `buildAspectField` / `buildEditAspectField` calls | DOM rendering — stays in index.js (via aspectHelpers.js) |
| Error display (`modalStatus`, `loading.textContent`) | UI state — stays in index.js |

---

## Changes to `index.js`

### Import added
```js
import { fetchAspectsForCategory, fetchCategorySuggestions } from "./taxonomyApi.js";
```
(Added after `./modalPreviews.js` import block)

### 3 call sites replaced

**1. `fetchAspects()` function body (Push modal aspect load):**
```js
// Before:
const result = await callEdge("ebay-taxonomy", { action: "get_aspects", categoryId });
// After:
const result = await fetchAspectsForCategory(categoryId);
```

**2. `openEdit` inline aspect fetch:**
```js
// Before:
const aspectResult = await callEdge("ebay-taxonomy", { action: "get_aspects", categoryId });
// After:
const aspectResult = await fetchAspectsForCategory(categoryId);
```

**3. `btnSearchCat` event listener (category search):**
```js
// Before:
const result = await callEdge("ebay-taxonomy", { action: "suggest_category", query });
// After:
const result = await fetchCategorySuggestions(query);
```

### No imports removed
`callEdge` is still used by other code in `index.js` — import not removed.

---

## Behavior Preservation

- **Request shapes**: unchanged — same `action`, same payload keys, same Edge Function name
- **Response handling**: unchanged — same `result.success`, `result.aspects`, `result.suggestions` checks
- **State mutation**: `currentAspects` and `editAspects` still assigned in `index.js`
- **Error semantics**: `callEdge` auth guard and error paths unchanged
- **DOM output**: aspect field rendering via `buildAspectField`/`buildEditAspectField` unchanged
- **Category selection flow**: `sel.onchange` → `fetchAspects()` flow unchanged

---

## Verification

| Check | Result |
|---|---|
| `node --check taxonomyApi.js` | Clean |
| `node --check index.js` | Clean |
| No `"ebay-taxonomy"` string in index.js | Confirmed — all 3 call sites replaced |
| Page loads at localhost:5500 | ✅ 60 products loaded |
| Push modal opens | ✅ |
| Category search triggers `fetchCategorySuggestions` → `callEdge` | ✅ — auth error caught and displayed in `#modalStatus` (expected on unauthenticated live-server tab: "Category search failed: Not authenticated — please refresh the page") |
| Aspect fetch + `get_aspects` path reachable | Confirmed by code inspection — same `fetchAspectsForCategory` wrapper used in both `fetchAspects()` and `openEdit` |
| eBay listing payloads unchanged | ✅ — no payload code touched |
| Backend / Edge Functions unchanged | ✅ — only call site wrappers moved |

**Note on auth verification:** The `localhost:5500` live-server tab does not have a logged-in Supabase session. Category search and aspect fetch require auth — both correctly return the `callEdge` auth error and display it to the user. This is the same behavior as before the refactor. Full live taxonomy behavior can be verified on the authenticated admin session.

---

## Next Recommended Phase

**Push Phase G:** Extract the `btnAiFill` / AI Auto-Fill flow (if dependency-clean).  
Alternatively: **Push Phase G** — audit `openPush` for safe pre-population helpers (description init, Quill init setup) that don't require moving the full `openPush` function.

Higher-risk future phases (full modal workflow extraction) should remain deferred until all helper wiring is cleaned up.
