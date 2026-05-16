# 037 — `pushModal.js` Skeleton Summary (Phase N-2)

**Date:** 2026-05-16
**Phase:** N-2 (from Phase N roadmap in doc 035)
**Type:** Behavior-preserving structural boundary — skeleton only
**`index.js` lines after:** unchanged behavior; +2 lines (import + context instantiation)

---

## 1. What Was Created

### New file: `js/admin/ebayListings/pushModal.js`

Single export: `createPushModalContext(deps)` — a factory function.

**No side effects at import time.** The factory is pure: instantiating it creates an in-memory state object and returns accessors. Zero DOM interaction, zero API calls, zero event listeners.

---

## 2. Push State and Accessors Defined

### Push-private state object (inside factory closure):

| Field | Type | Initial value | Owner |
|---|---|---|---|
| `currentProduct` | `object\|null` | `null` | Push-exclusive — product row for the open Push modal |
| `currentAspects` | `object[]` | `[]` | Push-exclusive — raw aspects from last category fetch |
| `pushImageUrls` | `string[]` | `[]` | Push-exclusive — ordered image URL array |
| `pushVariants` | `object[]` | `[]` | Push-exclusive — active variant rows |
| `isVariantListing` | `boolean` | `false` | Push-exclusive — derived from variant count |
| `pushSalesMetrics` | `object\|null` | `null` | Push-exclusive — cached per Push modal session |

> **`pushQuill` intentionally omitted:** It is a live Quill DOM instance constructed by `openPush()` in browser context. It cannot be safely initialized at factory call time. It will be added to this state when `openPush()` migrates here in Phase N-3.

### Accessor function set (returned from factory):

| Accessor | Signature |
|---|---|
| `getCurrentProduct()` | `() => object\|null` |
| `setCurrentProduct(p)` | `(object\|null) => void` |
| `getCurrentAspects()` | `() => object[]` |
| `setCurrentAspects(a)` | `(object[]) => void` |
| `getPushImageUrls()` | `() => string[]` |
| `setPushImageUrls(urls)` | `(string[]) => void` |
| `getPushVariants()` | `() => object[]` |
| `setPushVariants(variants)` | `(object[]) => void` |
| `getIsVariantListing()` | `() => boolean` |
| `setIsVariantListing(v)` | `(boolean) => void` |
| `getPushSalesMetrics()` | `() => object\|null` |
| `setPushSalesMetrics(m)` | `(object\|null) => void` |
| `resetPushState()` | `() => void` — resets all fields to initial values |

### Injected dependencies stored in `pushCtx.deps`:

| Dep | Type | Why injected |
|---|---|---|
| `getProducts` | `() => Product[]` | Reads `allProducts` — page-level |
| `loadProducts` | `() => Promise<void>` | Called post-publish to refresh page |
| `showStatus` | `(msg, isErr?) => void` | Page-level status bar |
| `getAdRatePct` | `() => number` | Reads `pageAdRatePct` — shared with Edit |

---

## 3. What Changed in `index.js`

### Import added (line 102)

```js
import { createPushModalContext } from "./pushModal.js";
```

### Context instantiated (line 146)

```js
// ── Push Modal Context (Phase N-2) ─────────────────────────────
// Establishes the module boundary and accessor-ref bridge for Push state.
// index.js still owns the active let-variables this phase; handlers migrate
// to use pushCtx in later phases (N-3 through N-7).
// eslint-disable-next-line no-unused-vars
const pushCtx = createPushModalContext({
  getProducts:  () => allProducts,
  loadProducts,
  showStatus,
  getAdRatePct: () => pageAdRatePct,
});
```

Placed immediately after `createTableActions(...)` and before `// ── Status Bar`.

---

## 4. Whether `index.js` Uses the Context

**No — `pushCtx` is instantiated but not actively used.** All Push behavior still runs through the original `let` variables in `index.js`.

This is intentional and documented by the `// eslint-disable-next-line no-unused-vars` comment.

The context is the boundary point. When a handler migrates to a later phase, it switches from reading `currentProduct` (the old let-var) to `pushCtx.getCurrentProduct()`. That migration happens one handler at a time in Phases N-3 through N-7.

---

## 5. What Stayed in `index.js`

Everything.

| Item | Reason stayed |
|---|---|
| `let currentProduct = null` | Active — still read/written by `openPush` and all Push handlers |
| `let currentAspects = []` | Active — written by `fetchAndRenderAspects` callback |
| `let pushQuill = null` | Active — constructed by `openPush` |
| `let pushImageUrls = []` | Active — written by `openPush`, read by image strip and handlers |
| `let pushVariants = []` | Active — written by `openPush`, read by all 3 step handlers |
| `let isVariantListing = false` | Active — set in `openPush`, read by all 3 step handlers |
| `let pushSalesMetrics = null` | Active — set in `loadAndRenderPriceRef` callback |
| `openPush(code)` | Not in scope — Phase N-3+ |
| Create Item handler | Not in scope — Phase N-5 |
| Create Offer handler | Not in scope — Phase N-6 |
| Publish handler | Not in scope — Phase N-7 |
| AI autofill handler | Deferred |
| Category search handler body | Deferred |
| Modal close handler | Deferred |
| Live price/weight listeners | Deferred |
| `pageAdRatePct` | Stays — shared with Edit |

---

## 6. Why Full Push Extraction Is Still Deferred

The 3-step Push handlers (Create Item, Create Offer, Publish) directly close over all Push state variables declared in `index.js`. Moving any of them without moving all of them would leave the remaining handlers with stale references, while the moved handler would need to read state a different way. That asymmetry creates subtle bugs.

The accessor-ref bridge pattern resolves this: once `openPush()` migrates (Phase N-3) and starts writing state via `pushCtx.setCurrentProduct(...)` etc., existing handlers can be updated one at a time to read via `pushCtx.getCurrentProduct()` rather than the old let-var — with identical behavior at each step.

The `pushCtx` instantiation in this pass means that wiring is ready the moment the first handler starts migrating.

---

## 7. Verification Results

| Check | Result |
|---|---|
| `node --check pushModal.js` | ✅ Pass |
| `node --check index.js` | ✅ Pass |
| `createPushModalContext` import in index.js | ✅ Confirmed (line 102) |
| `pushCtx` instantiated in index.js | ✅ Confirmed (line 146) |
| All Push `let` variables still present and unchanged | ✅ Confirmed |
| No existing handler code modified | ✅ Zero behavior change |
| `openPush` still a standalone function in index.js | ✅ Unchanged |
| Create Item/Offer/Publish handlers unchanged | ✅ Unchanged |
| eBay payload code unchanged | ✅ Not touched |
| Live browser test (Push modal open/close, variants, preview) | ⚠️ **Manual verification recommended.** No code paths were changed so behavior is guaranteed identical by inspection. No runtime test was executed. |

---

## 8. Next Recommended Phase

**Phase N-3: Migrate `openPush()` into `pushModal.js`.**

### Pre-conditions (all met):
- `pushCtx` is instantiated with correct deps ✅
- `fetchAndRenderAspects` call site already uses callback `onAspects: (a) => { currentAspects = a; }` — just needs to become `onAspects: pushCtx.setCurrentAspects` ✅
- `pushModal.js` has no DOM imports yet; `openPush` migration will need to add several ✅

### What Phase N-3 would do:
1. Move `openPush(code)` into `pushModal.js` as a closure inside `createPushModalContext` (or as an exported function that receives the context)
2. Replace the 7 direct let-variable writes inside `openPush` with `pushCtx.set*()` calls
3. Export `openPush` from the factory's return object
4. In `index.js`: remove the function definition; call `pushCtx.openPush(code)` at the dispatch site

### What Phase N-3 does NOT move:
- Create Item / Create Offer / Publish handlers — still closed over old let-vars until N-5/N-6/N-7
- Those handlers will need to switch to `pushCtx.get*()` accessors as they migrate in those phases

### Risk of Phase N-3:
**Medium** — `openPush` is ~158 lines and writes all Push state. A single mistake leaves the modal unavailable. However, it has one call site and clear boundaries. The callback pattern for aspects is already in place.
