# 008 — Stage 1: openPush / openEdit Delegated Action Migration

Date: 2026-05-15

## What changed

**File:** `js/admin/ebayListings/index.js`

### 1. `renderProductActions()` — 6 inline onclicks converted

All `onclick="openPush(...)"` and `onclick="openEdit(...)"` strings inside `renderProductActions()` were replaced with `data-action` / `data-code` attributes.

| Button label | Status context | Before | After |
|---|---|---|---|
| Restock | out_of_stock | `onclick="openEdit('code')"` | `data-action="edit" data-code="code"` |
| Push | not_listed | `onclick="openPush('code')"` | `data-action="push" data-code="code"` |
| Edit | active | `onclick="openEdit('code')"` | `data-action="edit" data-code="code"` |
| Edit | draft | `onclick="openEdit('code')"` | `data-action="edit" data-code="code"` |
| Resume Push | draft, no offer | `onclick="openPush('code')"` | `data-action="push" data-code="code"` |
| Re-list | ended | `onclick="openPush('code')"` | `data-action="push" data-code="code"` |

No button labels, button classes, or visibility logic changed.

### 2. Delegated listener replaced and extended

The two narrow `open-sales`-only delegated listeners were replaced with a single `handleProductAction` dispatcher function:

```js
function handleProductAction(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const code   = btn.dataset.code;
  if (!code) return;
  if (action === "push") {
    openPush(code);
  } else if (action === "edit") {
    openEdit(code);
  } else if (action === "open-sales") {
    const product = allProducts.find(p => p.code === code);
    if (product) openSalesHistory(product);
  }
}
document.getElementById("tableSection").addEventListener("click", handleProductAction);
document.getElementById("cardSection").addEventListener("click", handleProductAction);
```

The dispatcher handles 3 actions: `push`, `edit`, `open-sales`. Mutation actions (`withdraw`, `publish`, `discard`, `relink`, `clear-stale`) remain inline `onclick` and are not dispatched here.

Line count: 2,432 → 2,438 (net +6 — dispatcher function is slightly longer than the two narrow listeners it replaced).

---

## Which inline onclicks were converted

- `openPush` — 3 call sites converted (Push, Resume Push, Re-list)
- `openEdit` — 3 call sites converted (Restock, Edit×active, Edit×draft)

**Total converted: 6**

---

## Which inline onclicks remain

| Button | Function | Status context | Reason to keep for now |
|---|---|---|---|
| Mark Ended | `clearStaleEbayLink` | out_of_stock | Supabase write — Stage 2 |
| Mark Ended | `clearStaleEbayLink` | stale | Supabase write — Stage 2 |
| Relink | `relinkEbayListing` | stale+safeRelink | Supabase write, also coupled to `btnEditRelink` — Stage 2 |
| End | `doWithdraw` | active | eBay mutation — Stage 3 |
| Publish | `doPublish` | draft+offer | eBay mutation — Stage 3 |
| Discard | `discardDraft` | draft | eBay mutation — Stage 3 |

Also: `ebayCodeLinkHtml()` still generates one inline `onclick="relinkEbayListing(...)"` in the stale code badge — Stage 2.

**Total remaining: 7** (down from 13 in `renderProductActions()` + 1 in `ebayCodeLinkHtml()`)

---

## Why openPush and openEdit were safe first

- **No eBay mutation**: both functions only open and populate the push/edit modals. No API calls are made during the click itself (API calls happen when the user presses the submit buttons inside the modals).
- **Single arg only**: only `code` is needed — no `offerId` or `itemGroupKey` to thread through attributes.
- **No coupled external reference**: unlike `relinkEbayListing` (which is also called by `btnEditRelink`), `openPush` and `openEdit` are only called through onclick strings.
- **`window.openPush` and `window.openEdit` kept**: globals remain intact. The dispatcher calls the same underlying function directly (they are the same function — `window.openPush = async function openPush(code)` — the name is in scope).

---

## `window.openPush` / `window.openEdit` globals

**Not removed.** Both remain assigned to `window`. They are no longer called via onclick strings in the DOM, but:
- Keeping them costs nothing
- They remain accessible if any external script or console debugging relies on them
- They will be safe to remove in a future cleanup pass once Stage 2 and 3 are proven

---

## Verification performed

| Check | Result |
|---|---|
| `node --check index.js` | ✅ Pass |
| Page loads (60 items) | ✅ Confirmed |
| Push buttons in DOM: `data-action="push"`, no onclick | ✅ KK-0004, KK-0005, KK-0007 confirmed |
| Edit buttons in DOM: `data-action="edit"`, no onclick | ✅ KK_0064, KK_0065, KK_0066 confirmed |
| End buttons in DOM: still `onclick="doWithdraw(...)"` | ✅ Confirmed (mutation unchanged) |
| `open-sales` buttons: still `data-action="open-sales"` | ✅ Confirmed |
| `pushEditOnclicks === 0` (no surviving onclick on push/edit labels) | ✅ Confirmed |
| Push modal opens from table (clicked KK-0004 Push button) | ✅ "Mini Tote - B!TCH#S IS WEIRD" populated correctly |
| Edit modal opens from table (clicked KK_0064 Edit button) | ✅ "Blue Bell Flower Charm Keychain" populated correctly |
| Sales History modal still opens via dispatcher | ✅ Heading "Blue Bell Flower Charm Keychain" confirmed |
| End buttons still render with onclick (no regression) | ✅ `doWithdraw('KK_0064', '', 'KK_0064-GROUP')` confirmed |
| Card view: 60 cards render | ✅ Confirmed |

Note: Edit modal shows "Not authenticated" on opening — this is expected in the local dev environment (no active Supabase session). It confirms the modal opened and tried to fetch taxonomy/listing data.

Live browser test against http://localhost:8080/pages/admin/ebay-listings.html.

---

## Inline onclick count summary

| Location | Stage 0 | Stage 1 | Remaining |
|---|---|---|---|
| `renderProductActions()` — open actions | 6 | Converted | 0 |
| `renderProductActions()` — mutation actions | 7 | Untouched | 7 |
| `ebayCodeLinkHtml()` | 1 | Untouched | 1 |
| `renderCards()` dead block (removed Stage 0) | 0 | — | 0 |
| **Total live onclicks in DOM** | 14 | 6 converted | **8** |

---

## Next recommended stage

**Stage 2 — Convert relink and clear-stale**

Actions:
- `onclick="relinkEbayListing('code')"` → `data-action="relink" data-code="code"` (2 call sites in `renderProductActions()`, 1 in `ebayCodeLinkHtml()`)
- `onclick="clearStaleEbayLink('code')"` → `data-action="clear-stale" data-code="code"` (2 call sites in `renderProductActions()`)

Additional step: update `btnEditRelink` listener to call the function directly instead of via `window.relinkEbayListing`. After that, `window.relinkEbayListing` and `window.clearStaleEbayLink` can be safely removed.

Add `"relink"` and `"clear-stale"` cases to `handleProductAction`.

Risk: Medium — these trigger Supabase writes and show `confirm()` dialogs. The `relinkEbayListing` function is also called by `btnEditRelink` (non-onclick path that must be updated atomically).

Verification: stale badge + Relink button appear and fire confirm dialog; Mark Ended button fires confirm dialog; Edit modal Relink button still works; `allProducts` reloads after action.
