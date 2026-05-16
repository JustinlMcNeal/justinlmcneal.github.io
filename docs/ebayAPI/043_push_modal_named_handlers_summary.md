# 043 — Phase N-10: pushModal.js Named Inner Handlers

## Objective

Phase N-10 extracted the three large inline arrow function bodies from `bindRemainingPushListeners()` into named private `async function` declarations at factory scope. No logic, DOM behavior, API payloads, validation, or state management was changed.

---

## Handlers Extracted

| Named function | Former location | Lines (approx) | Declared at line |
|---|---|---|---|
| `handleAiFill()` | Inline in `bindRemainingPushListeners` | ~60 | 407 |
| `handleCreateOffer()` | Inline in `bindRemainingPushListeners` | ~105 | 487 |
| `handlePublish()` | Inline in `bindRemainingPushListeners` | ~55 | 632 |

All three are `async function` declarations inside `createPushModalContext`, declared immediately before `bindRemainingPushListeners`. They close over `state`, `deps`, and all module-level imports — no new parameters or return values.

---

## Structure After N-10

```
createPushModalContext({...}) {
  // Push-private state
  // Stored injected dependencies
  // Accessors (get/set for 7 fields)
  // resetPushState()
  // openPush()
  // handleCreateItem()         ← extracted in N-5
  // bindCreateItemListener()
  //
  // ── Named Push handlers ───
  // handleAiFill()             ← NEW (N-10)
  // handleCreateOffer()        ← NEW (N-10)
  // handlePublish()            ← NEW (N-10)
  //
  // ── Remaining Push listeners ──
  // bindRemainingPushListeners()
  //   close, live previews, add image, desc mode,
  //   category search, AI fill stub,
  //   create offer stub, publish stub,
  //   toggle controls
  //
  // return { ... }
}
```

### `bindRemainingPushListeners` after extraction

The three large async blocks became single-line registrations:

```js
// Before
document.getElementById("btnAiFill").addEventListener("click", async () => {
  // ~60 lines
});

// After
document.getElementById("btnAiFill").addEventListener("click", handleAiFill);
```

Same pattern for `btnCreateOffer` → `handleCreateOffer` and `btnPublish` → `handlePublish`.

---

## Behavior Guarantees

All behavior is **byte-for-byte identical at runtime**:
- `handleAiFill`: same AI edge call, same badge injection, same status/error messages, same button reset in `finally`
- `handleCreateOffer`: same single-SKU vs group flow, same variant SKU filtering, same `create_item_group` + `create_group_offer` payloads, same enable/disable of `btnPublish`
- `handlePublish`: same `publish` vs `publish_group` branch, same volume-discount post-publish path, same `deps.loadProducts()` call, same auto-close timeout

Validation, `enableBtn()` calls, `deps.showStatus()` usage, and `state.*` reads/writes are unchanged.

---

## Verification

```
node --check js/admin/ebayListings/pushModal.js  → OK
node --check js/admin/ebayListings/index.js      → OK
```

Post-transform checks (all pass):
- `async function handleAiFill()` present
- `async function handleCreateOffer()` present
- `async function handlePublish()` present
- `addEventListener("click", handleAiFill)` present (line 786)
- `addEventListener("click", handleCreateOffer)` present (line 789)
- `addEventListener("click", handlePublish)` present (line 792)
- No stale inline `btnAiFill").addEventListener("click", async` remaining
- No stale inline `btnCreateOffer").addEventListener("click", async` remaining
- No stale inline `btnPublish").addEventListener("click", async` remaining

---

## File State After N-10

| File | Lines | Status |
|---|---|---|
| `pushModal.js` | 831 | Clean. Three named handler functions declared at factory scope; `bindRemainingPushListeners` reduced to thin listener-wiring stubs. |
| `index.js` | ~890 | Unchanged by N-10. |

---

## Recommended Next Phase — N-11

**Audit and tidy `handleCreateOffer`.**

`handleCreateOffer` (105 lines) has three internal branches with repeated eBay API call patterns:
1. Single-SKU variant fallback (single `create_offer` call)
2. Variant group path (`create_item_group` then `create_group_offer`)
3. Non-variant single listing path (single `create_offer` call)

Branches 1 and 3 both call `create_offer` with slightly different parameters. A small internal helper like `callCreateOffer(sku, qty, storeCat)` could eliminate duplication — **only if the two calls are provably identical except for sku/qty inputs**, which should be verified line-by-line before extraction.

Alternatively, N-11 could proceed to **split `pushModal.js` into two files**: `pushModal.js` (openPush + openPush helpers) and `pushHandlers.js` (handleCreateItem, handleAiFill, handleCreateOffer, handlePublish) — if a clear seam exists and no circular dependency would result.

**Constraint:** any further extraction must preserve every API payload field, every `enableBtn` call sequence, and every `deps.loadProducts()` / auto-close timing.
