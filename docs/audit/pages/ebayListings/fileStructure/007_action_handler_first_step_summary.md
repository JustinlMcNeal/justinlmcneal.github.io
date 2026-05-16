# 007 — Stage 0: Dead Code Removal in `renderCards()`

Date: 2026-05-15

## What changed

**File:** `js/admin/ebayListings/index.js`

Removed the dead `let actions = ""` block from `renderCards()`.

The block (14 lines) computed an `actions` string variable across four status branches (not_listed, active, draft, ended), but the template literal in `renderCards()` never used `${actions}` — it used `${renderProductActions(p, true)}` instead.

The dead block included 7 inline `onclick` strings that were computed but never inserted into the DOM:
- `openPush(code)` × 3 (not_listed, draft/no-offer, ended)
- `openEdit(code)` × 2 (active, draft)
- `doWithdraw(code, offerId, groupKey)` × 1 (active)
- `doPublish(code, offerId, groupKey)` × 1 (draft+offer)

These onclicks were being evaluated by JS string interpolation on every card render but were discarded immediately (never in the DOM, never triggering).

**Lines removed:** 14 (index.js: 2,446 → 2,432)

---

## Why it was safe

- The `actions` variable was local to the `.map()` callback and never referenced in the template.
- `renderProductActions(p, true)` — the real action renderer — was unchanged.
- No onclick wiring, no event handler, no window global, no behavior was affected.

---

## Verification performed

| Check | Result |
|---|---|
| `node --check index.js` | ✅ Pass |
| Page loads (60 items) | ✅ Confirmed |
| Card view renders (60 cards) | ✅ Confirmed via `#cardsGrid > div` count |
| Card action buttons present (Edit + End on active card) | ✅ Confirmed via DOM snapshot |
| `data-action="open-sales"` buttons still in cards | ✅ Confirmed |
| Table view renders (no regression from card DOM changes) | ✅ Page loaded with countLabel "60 items" |

Live browser test against http://localhost:8080/pages/admin/ebay-listings.html.

---

## Inline onclick count before and after

| Location | Before | After |
|---|---|---|
| `renderProductActions()` | 13 | 13 (unchanged) |
| `ebayCodeLinkHtml()` | 1 | 1 (unchanged) |
| `renderCards()` dead block | 7 (never in DOM) | 0 (removed) |
| **Total in DOM** | **14** | **14** (unchanged) |
| **Total in source** | **21** | **14** |

The 7 dead onclicks in `renderCards()` were never firing. Removing them does not change the behavior surface.

---

## What should be converted next

**Stage 1 — Convert `openPush` and `openEdit` to `data-action`**

These are non-mutating modal openers. They are the lowest-risk inline onclick targets remaining.

Plan:
1. In `renderProductActions()`, replace all `onclick="openPush('code')"` with `data-action="push" data-code="code"` (3 instances: Push, Resume Push, Re-list)
2. In `renderProductActions()`, replace all `onclick="openEdit('code')"` with `data-action="edit" data-code="code"` (3 instances: Restock, Edit×2)
3. Add `push` and `edit` handlers to the centralized `handleProductAction` dispatcher on `#tableSection` and `#cardSection`
4. Keep `window.openPush` and `window.openEdit` globals intact (not removed) — backward compat
5. Consolidate the 2 existing `open-sales` delegated listeners into the single new `handleProductAction` dispatcher

Verification: Push modal opens from table + card views; Edit modal opens from table + card views; Sales history still works; existing window.* globals still accessible.

See `006_action_handler_inventory.md` §6 for full staged plan.
