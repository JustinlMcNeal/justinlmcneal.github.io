# 036 — `aspectFlow.js` Extraction Summary

**Date:** 2026-05-16  
**Phase:** N-1 (from Phase N roadmap in doc 035)  
**Type:** Behavior-preserving structural extraction  
**`index.js` before:** 1,543 lines  
**`index.js` after:** 1,543 - 32 (function removed) + ~9 (call site expanded) ≈ net ~-23 lines  

---

## 1. What Moved

### Function removed from `index.js`

`async function fetchAspects(categoryId)` — the entire ~32-line block (function body + section comment header) was removed.

**Original location:** `index.js`, immediately above `// ── Push Modal ──` section.

**Full original body:**
```js
// ── Category / Aspects (Push Modal) ──────────────────────────
async function fetchAspects(categoryId) {
  const section      = document.getElementById("aspectsSection");
  const reqContainer = document.getElementById("aspectsRequired");
  const optContainer = document.getElementById("aspectsOptional");
  const loading      = document.getElementById("aspectsLoading");

  section.classList.remove("hidden");
  loading.classList.remove("hidden");
  reqContainer.innerHTML = "";
  optContainer.innerHTML = "";
  currentAspects = [];

  try {
    const result = await fetchAspectsForCategory(categoryId);
    if (!result.success || !result.aspects?.length) {
      loading.textContent = "No item specifics found for this category";
      return;
    }

    currentAspects = result.aspects;
    const defaults  = { Brand: "Unbranded", Condition: "New", Type: "Accessory", Department: "Unisex Adults" };
    const required  = result.aspects.filter(a => a.required);
    const optional  = result.aspects.filter(a => !a.required).slice(0, 15);

    required.forEach(a => reqContainer.appendChild(buildAspectField(a, defaults, true)));
    optional.forEach(a => optContainer.appendChild(buildAspectField(a, defaults, false)));
    loading.classList.add("hidden");
  } catch (e) {
    loading.textContent = "Failed to load item specifics: " + e.message;
  }
}
```

---

## 2. What Was Created

### New file: `js/admin/ebayListings/aspectFlow.js`

**Exports one function:**

```js
export async function fetchAndRenderAspects({
  categoryId,    // string  — eBay category ID
  sectionEl,     // HTMLElement — section wrapper (shown on start)
  loadingEl,     // HTMLElement — loading/error text
  reqContainer,  // HTMLElement — required fields mount
  optContainer,  // HTMLElement — optional fields mount
  buildField,    // (aspect, defaults, isRequired) => HTMLElement
  defaults,      // object with default aspect values (default: {})
  onAspects,     // (aspects[]) => void — state update callback
})
```

**Dependencies of `aspectFlow.js`:**
- `import { fetchAspectsForCategory } from "./taxonomyApi.js"` — only direct dependency

**Does NOT import or own:**
- `currentAspects` / `editAspects` — stays in `index.js`
- `buildAspectField` / `buildEditAspectField` — caller passes via `buildField` param
- DOM IDs — caller resolves and passes as elements
- `showStatus` — not involved; errors written to `loadingEl.textContent` by contract

---

## 3. What Changed in `index.js`

### Import added

```js
import { fetchAndRenderAspects } from "./aspectFlow.js";
```

Added immediately after the existing `taxonomyApi.js` import line.

### Import kept (unchanged)

```js
import { fetchAspectsForCategory, fetchCategorySuggestions } from "./taxonomyApi.js";
```

`fetchAspectsForCategory` is **still used directly** inside `openEdit` (line ~593). That inline edit-aspects flow was NOT touched.

### Call site updated

**Before (line ~746):**
```js
fetchAspects(opt.value);
```

**After:**
```js
fetchAndRenderAspects({
  categoryId:   opt.value,
  sectionEl:    document.getElementById("aspectsSection"),
  loadingEl:    document.getElementById("aspectsLoading"),
  reqContainer: document.getElementById("aspectsRequired"),
  optContainer: document.getElementById("aspectsOptional"),
  buildField:   buildAspectField,
  defaults:     { Brand: "Unbranded", Condition: "New", Type: "Accessory", Department: "Unisex Adults" },
  onAspects:    (aspects) => { currentAspects = aspects; },
});
```

`currentAspects` is **still owned and written by `index.js`** — the callback `(aspects) => { currentAspects = aspects; }` is the only way `aspectFlow.js` communicates back. No page state was moved.

---

## 4. What Stayed in `index.js`

| Item | Reason |
|---|---|
| `currentAspects` declaration | Push state — still in `index.js` |
| `editAspects` declaration | Edit state — untouched |
| `fetchAspectsForCategory` import | Still used directly inside `openEdit` for the Edit modal aspect path |
| `openEdit` aspect-loading block (lines ~593–645) | Tightly inlined; different defaults strategy, different field builder, no separate loading element, extra group-listing Color logic — too complex to generalize without risk |
| `openPush` and all Push handlers | Not in scope for this phase |
| Category search button handler (`btnSearchCat`) | Not in scope; only updated the one-line call inside it |

---

## 5. Why This Extraction Was Safe

1. **Single call site** — `fetchAspects(categoryId)` was called in exactly one place (inside the `sel.onchange` handler in `btnSearchCat`).

2. **No closure capture** — `fetchAspects` closed over `currentAspects`, `buildAspectField`, and the taxonomy API call, but they are all passed explicitly to the new function — no implicit global state move.

3. **`currentAspects` still owned by `index.js`** — the callback pattern means the state write stays in `index.js`.

4. **Zero eBay payload changes** — `fetchAspectsForCategory` is called with the exact same `categoryId` argument, returns the same raw result, and the aspect array slicing (`slice(0, 15)`) and filtering (`.filter(a => a.required)`) are identical.

5. **Zero UI/markup changes** — `buildAspectField` is passed in and called identically; no `buildAspectField` logic was changed.

6. **Same error messages** — both the no-results message and the catch message are identical.

7. **Edit flow untouched** — `openEdit`'s inline aspect rendering was not modified.

---

## 6. Signature / State Changes

| Item | Before | After |
|---|---|---|
| Aspect fetch called via | `fetchAspects(categoryId)` | `fetchAndRenderAspects({ categoryId, ... })` |
| `currentAspects` updated | Inside `fetchAspects` directly | Via `onAspects` callback in `index.js` |
| `fetchAspects` defined in | `index.js` | Removed |
| `fetchAndRenderAspects` defined in | — | `aspectFlow.js` |
| DOM IDs known by | `fetchAspects` (hardcoded) | `index.js` call site (passed as elements) |
| Defaults object defined in | `fetchAspects` (hardcoded) | `index.js` call site (passed as parameter) |
| `buildAspectField` known by | `fetchAspects` (module-scope import closure) | `index.js` call site (passed as parameter) |

---

## 7. Verification Results

| Check | Result |
|---|---|
| `node --check aspectFlow.js` | ✅ Pass |
| `node --check index.js` | ✅ Pass |
| `fetchAspects` function removed from `index.js` | ✅ Confirmed (grep returns zero matches) |
| `fetchAndRenderAspects` imported and used at call site | ✅ Confirmed (2 matches: import + call) |
| `fetchAspectsForCategory` still imported in `index.js` | ✅ Confirmed (used in `openEdit`) |
| `currentAspects` still declared in `index.js` | ✅ Not moved |
| `editAspects` still declared in `index.js` | ✅ Not touched |
| Edit modal aspect path unchanged | ✅ Not touched |
| eBay aspect API payload unchanged | ✅ Same call: `fetchAspectsForCategory(categoryId)` |
| Aspect field markup unchanged | ✅ `buildAspectField` called with same `(aspect, defaults, isRequired)` |
| Category search behavior unchanged | ✅ Only internal call target changed |
| Live browser verification (category search → aspect render) | ⚠️ **Requires manual test** — live eBay taxonomy auth not verified programmatically. Verify by: open Push modal, search a category, confirm aspects render in `#aspectsRequired` / `#aspectsOptional`. |

---

## 8. Next Recommended Phase

**Phase N-2 (from doc 035 roadmap): Create `pushModal.js` skeleton with accessor-ref pattern.**

- Move Push-private state (`currentProduct`, `currentAspects`, `pushQuill`, `pushImageUrls`, `pushVariants`, `isVariantListing`, `pushSalesMetrics`) into `initPushModal` factory as closed-over locals
- Expose state accessors so existing `index.js` Push handlers can migrate one by one without broken closure references
- Move `openPush` into the factory (it has no closed-over listener dependencies)
- **Prerequisite met:** `fetchAspects` call site already uses the new `fetchAndRenderAspects` signature, which is compatible with injection from inside the factory

**Constraints for N-2:**
- The 3-step Push handlers (Create Item, Create Offer, Publish) close over Push state directly — they cannot be moved until the accessor-ref bridge is in place
- `pageAdRatePct` must remain in `index.js`; expose via `getAdRatePct()` injection
- `loadProducts` and `showStatus` must be injected (page-level deps)
