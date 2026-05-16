# Final Global Cleanup — window.openPush / window.openEdit Removal

**Date:** 2026-05-16  
**File modified:** `js/admin/ebayListings/index.js`  
**Reference docs:** `008_open_action_delegation_summary.md`, `010_mutation_action_delegation_summary.md`

---

## What Changed

### `window.openPush` — Removed ✅

| Property | Before | After |
|---|---|---|
| Assignment | `window.openPush = async function openPush(code) {` | `async function openPush(code) {` |
| Function body | unchanged | unchanged |
| Called from dispatcher | `openPush(code)` — already used bare name | unchanged |
| External references | none found | — |

### `window.openEdit` — Removed ✅

| Property | Before | After |
|---|---|---|
| Assignment | `window.openEdit = async function openEdit(code) {` | `async function openEdit(code) {` |
| Function body | unchanged | unchanged |
| Called from dispatcher | `openEdit(code)` — already used bare name | unchanged |
| External references | none found | — |

---

## Safety Check

Before patching, all of the following were searched across the entire workspace (`.js`, `.html`):

- `window.openPush` → found only in `index.js` line 949 (the assignment itself) + docs
- `window.openEdit` → found only in `index.js` line 1091 (the assignment itself) + docs
- `onclick=.*openPush` → no matches
- `onclick=.*openEdit` → no matches
- HTML file (`pages/admin/ebay-listings.html`) → no references

The dispatcher already called `openPush(code)` and `openEdit(code)` by bare name (not `window.openPush`). The `window.*` assignments were purely vestigial.

---

## Remaining `window.*` Globals

**Zero `window.*` globals remain in `js/admin/ebayListings/index.js`.**

The only `window.` reference remaining is:
```js
let currentView = window.innerWidth < 640 ? "cards" : "table";
```
This is a standard DOM read (`window.innerWidth`), not a global function assignment.

---

## Remaining Inline `onclick` Attributes

**Zero inline `onclick` attributes remain in product action markup.**

All product action buttons now use `data-action` + `data-code` (+ `data-offer-id` / `data-group-key` where needed).

---

## Complete Action Delegation Status

| Action | Delegated | Window global removed | Stage |
|---|---|---|---|
| `openPush` | ✅ Stage 1 | ✅ Final cleanup | 1 → Final |
| `openEdit` | ✅ Stage 1 | ✅ Final cleanup | 1 → Final |
| `relinkEbayListing` | ✅ Stage 2 | ✅ Stage 2 | 2 |
| `clearStaleEbayLink` | ✅ Stage 2 | ✅ Stage 2 | 2 |
| `doWithdraw` | ✅ Stage 3 | ✅ Stage 3 | 3 |
| `doPublish` | ✅ Stage 3 | ✅ Stage 3 | 3 |
| `discardDraft` | ✅ Stage 3 | ✅ Stage 3 | 3 |

---

## Verification Results

| Check | Result |
|---|---|
| `node --check js/admin/ebayListings/index.js` | ✅ SYNTAX OK |
| `grep window\.openPush` in index.js | ✅ no matches |
| `grep window\.openEdit` in index.js | ✅ no matches |
| `grep window\.` in index.js | ✅ only `window.innerWidth` (DOM read, not global assignment) |
| `grep onclick=` in index.js | ✅ no matches |
| Page loads | ✅ |
| 60 products load | ✅ |
| `button[onclick]` in DOM | ✅ 0 found |
| `button[data-action="push"]` in DOM | ✅ 37 found |
| `button[data-action="edit"]` in DOM | ✅ 23 found |
| `button[data-action="withdraw"]` in DOM | ✅ 23 found |
| Push modal opens from delegated button click | ✅ confirmed |
| Edit modal opens from delegated button click | ✅ confirmed (auth failure expected on localhost) |
| Function bodies unchanged | ✅ confirmed |
| Payloads unchanged | ✅ confirmed |

---

## Next Recommended File-Structure Refactor Phase

The action-handler delegation work is now complete. All `window.*` globals removed. All inline `onclick` product action attributes removed. `handleProductAction` is the single dispatcher for all product card/table actions.

### Phase 4 — Rendering Module Extraction

Extract rendering functions to dedicated modules:

**`renderTable.js`** — extract `renderTable()` + table row helpers  
**`renderCards.js`** — extract `renderCards()` + card helpers  
**`renderProductActions.js`** — this is already very clean; could be merged into one of the above

**Risk:** Medium. Large function moves with many shared references (`allProducts`, `esc`, computed styles, `renderProductActions`). Requires careful import wiring.  
**Approach:** Extract one function at a time, verify after each move.

### Phase 5 — Modal Module Extraction

Extract Push and Edit modal logic to `pushModal.js` and `editModal.js`.

**Risk:** High. ~800 lines of tightly coupled state (Quill, taxonomy, policies, image strip, variant helpers). Shared state (`editProduct`, `pushProduct`) must be carefully managed.  
**Approach:** Only after Phase 4 is stable.

**Recommended immediate next step:** Phase 4, starting with `renderProductActions` (already isolated, ~50 lines, no modal state).
