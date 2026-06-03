# Line Items Orders — Refactor Plan (Pre-CTA Label)

**Doc ID:** 002  
**Created:** 2026-05-17  
**Depends on:** `001_module_audit.md`  
**Scope:** `js/admin/lineItemsOrders/` + `pages/admin/lineItemsOrders.html`  
**Type:** Implementation planning — no code changes in this pass  
**Phase:** Phase 1 of CTA label feature  
**Goal:** Refactor the existing module so the CTA label feature can be added safely in Phase 2.

---

## 1. Refactor Goals

The current module works. The refactor is not about fixing bugs — it is about creating the right
seams so the CTA label feature (Phase 2) can be added without turning `index.js` and
`renderTable.js` into 1000-line files that mix concerns.

### What the refactor must achieve

1. Deduplicate `esc()` — one source of truth, no XSS drift risk.
2. Create a `getOrderSource(row)` shared helper — single place to expand for Amazon.
3. Remove or formally retire `modalEditor.js` — clarify who owns fulfillment editing.
4. Create a thin seam in `renderTable.js` for per-row injections without rewriting the whole template.
5. Create a placeholder `labelPrint.js` module with stub exports — Phase 2 can fill these in.
6. Extract `wireEvents()` into smaller, named helpers — `index.js` should not grow further.

### What the refactor must NOT do

- Must not change any visible behavior.
- Must not change any API contract (Supabase views, edge functions, RPC calls).
- Must not add any CTA label HTML, logic, or data fetching in Phase 1.
- Must not touch `workspace.js` tabs structure (workspace tab additions are Phase 2).
- Must not touch `api.js` queries.

---

## 2. Refactor Items

### R-01 — Deduplicate `esc()`

**Problem:** `dom.js` exports `esc()`. `workspace.js` defines a private inline copy.

**Action:**
- `workspace.js`: remove local `esc()` definition; import from `./dom.js`.
- `workspace.js`: remove local `money()` definition; import `moneyFromCents` from `./dom.js`.

**Files:** `workspace.js`, `dom.js`  
**Risk:** Low — direct substitution, same logic.

---

### R-02 — Create `getOrderSource(row)` helper

**Problem:** `renderTable.js` and `workspace.js` both check `r.stripe_checkout_session_id?.startsWith("ebay_api_")` independently. Amazon source is detected via `r.source === "amazon"` in workspace header only.

**Action:**
- Add to `dom.js` (or a new `orderSource.js`):

```js
/**
 * Returns the canonical channel for an order row.
 * @returns {"kk" | "ebay" | "amazon" | "unknown"}
 */
export function getOrderSource(row) {
  if (row?.source === "amazon") return "amazon";
  const sid = row?.stripe_checkout_session_id || "";
  if (sid.startsWith("ebay_api_")) return "ebay";
  if (sid.startsWith("cs_live_") || sid.startsWith("cs_test_")) return "kk";
  return "unknown";
}
```

- Replace all `startsWith("ebay_api_")` and `r.source === "amazon"` checks in
  `renderTable.js` and `workspace.js` with `getOrderSource(row)`.

**Files:** `dom.js` (add), `renderTable.js` (consume), `workspace.js` (consume)  
**Risk:** Low — pure refactor, same branching logic.

---

### R-03 — Retire or document `modalEditor.js`

**Problem:** `workspace.js` superseded the old edit modal but `modalEditor.js` still exists
and is still imported by `index.js`. There is a risk that future developers add CTA label UI
to the wrong file.

**Action (Option A — preferred):** Confirm `modalEditor.js` / `bindEditModal` is no longer
called anywhere. Remove the import from `index.js` and mark `modalEditor.js` as deprecated with
a header comment.

**Action (Option B — if still used):** If `bindEditModal` is still called somewhere, add an
explicit JSDoc comment to both `modalEditor.js` and `workspace.js` explaining which owns
fulfillment editing.

**Pre-action check needed:** Search for `bindEditModal` usage before removing.

**Files:** `index.js`, `modalEditor.js`  
**Risk:** Low (if Option A confirmed).

---

### R-04 — Add per-row seam in `renderTable.js`

**Problem:** Both the desktop row and mobile card HTML are built by direct template string
concatenation. Phase 2 needs to inject a "Print CTA Label" indicator/button into each row.

**Action:** Extract desktop row and mobile card into named builder functions that accept
an optional `rowExtras` injection object:

```js
// Current (simplified):
function renderDesktopRow(r, idx) { return `...<td>...</td>...`; }

// After:
function renderDesktopRow(r, idx, extras = {}) {
  return `...<td>...</td>${extras.labelCell ?? ""}...`;
}
```

The `extras` object has no content in Phase 1 (all `undefined`/empty). Phase 2 fills it.

This is a 4-line change to function signatures — not a rewrite.

**Files:** `renderTable.js`  
**Risk:** Low — additive only.

---

### R-05 — Create `labelPrint.js` stub module

**Problem:** There is nowhere to put CTA label logic yet. Without a stub module, Phase 2
has no clear home and risks being added directly to `renderTable.js` or `workspace.js`.

**Action:** Create `js/admin/lineItemsOrders/labelPrint.js` with:

```js
// labelPrint.js — Phase 2: CTA label printing and preview.
//
// Phase 1 status: STUB ONLY — no implementation.
//
// Phase 2 will add:
//   - determineLabelType(source)       → "review_cta" | "channel_cta" | "none"
//   - buildLabelHtml(order, labelType) → HTML string for print preview
//   - printLabel(order)                → opens print window
//   - trackLabelPrint(sessionId)       → analytics event

export function determineLabelType(_source) {
  // Phase 2: implement
  return "none";
}

export function buildLabelHtml(_order, _labelType) {
  // Phase 2: implement
  return "";
}
```

**Files:** `labelPrint.js` (new)  
**Risk:** None — new file, no behavior.

---

### R-06 — Split `index.js` event wiring

**Problem:** `wireEvents()` in `index.js` is ~200 lines handling toolbar, filters, mobile sheet,
Amazon modal, export dropdown, and all button bindings.

**Action:** Extract the following into named private functions within `index.js`:

| Function name | Lines |
|---|---|
| `wireFilterControls()` | Search, status, date, review inputs |
| `wireMobileFilterSheet()` | Bottom sheet open/close/apply/clear |
| `wireExportControls()` | Export dropdown, CSV download |
| `wireAmazonModal()` | Amazon modal open/close, result display |

`wireEvents()` becomes a short sequence of calls. No logic moves to new files.

**Files:** `index.js`  
**Risk:** Low — same code, just named groupings.

---

## 3. Refactor Order (Recommended Sequence)

| Step | Item | Reason for order |
|---|---|---|
| 1 | R-03 — retire `modalEditor.js` | Removes dead surface before adding new code |
| 2 | R-02 — `getOrderSource()` | Must exist before R-04 and `labelPrint.js` stubs |
| 3 | R-01 — deduplicate `esc()` | Clean up before adding any new HTML generation |
| 4 | R-05 — `labelPrint.js` stub | Create the module boundary first |
| 5 | R-04 — row seam | Add slot into which Phase 2 will inject |
| 6 | R-06 — split `wireEvents()` | Last: code organization, no behavior change |

---

## 4. What Phase 2 Will Add (Not in This Pass)

This section is informational only — do not implement anything below in Phase 1.

### Label type logic

```
getOrderSource(row) === "kk"    → label type: "review_cta"
                                   → QR code to /leave-review?order=<id>
                                   → 15% first-website-order discount code
getOrderSource(row) === "ebay"  → label type: "channel_cta"
                                   → QR code to karrykraze.com
                                   → "Order direct for a lower price" copy
getOrderSource(row) === "amazon" → label type: "channel_cta" (same as eBay)
                                   → placeholder until Amazon API is connected
```

### Workspace tab

A "Labels" tab will be added to the workspace (`workspace.js`) between Fulfillment and IDs.

### Discount code generation

Website orders will need a per-order discount code or a generic 15% first-order coupon.
The coupon system (`js/coupon/`) may need a read path from the orders module.

### Analytics

Label print events will be tracked. A `label_print_at` or a separate event table will be needed.
This requires a DB migration — confirm before Phase 2.

### HTML label design

The label HTML will be a print-optimized template (likely a separate injection into a print
window). Consider whether to render it in `labelPrint.js` or a dedicated `.html` partial.

---

## 5. Files Not Touched in This Refactor

| File | Reason |
|---|---|
| `api.js` | No changes to queries or Supabase calls |
| `shipReadyCsv.js` | Standalone; no role in label feature |
| `amazonImport.js` | Amazon TSV import separate from CTA label |
| `state.js` | No new state needed for Phase 1 |
| `pages/admin/lineItemsOrders.html` | No DOM changes for Phase 1 |
| `css/pages/admin/lineItemsOrders.css` | No style changes for Phase 1 |

---

## 6. QA Checklist After Phase 1 Refactor

Run these checks after each refactor item is applied:

- [ ] `node --check js/admin/lineItemsOrders/*.js` — no syntax errors
- [ ] Page loads in browser — orders table renders
- [ ] Search, status filter, date filter all trigger reloads correctly
- [ ] KPI cards show correct values after filter change
- [ ] Mobile filter sheet opens, Apply updates the table, Clear resets filters
- [ ] Export CSV downloads — file is non-empty and correct format
- [ ] Amazon import modal opens from Export dropdown
- [ ] Row click opens workspace slide-over for a KK order
- [ ] Row click opens workspace for an eBay order
- [ ] Fulfillment tab save still works (status change + tracking number)
- [ ] `modalEditor.js` removal (R-03): no console errors about missing elements or `bindEditModal`
- [ ] `getOrderSource()` (R-02): eBay rows show "eBay" badge, KK rows show "KK" badge
- [ ] `labelPrint.js` stub (R-05): import it in `index.js` and confirm no console errors

---

## 7. Out of Scope

| Topic | Why out of scope |
|---|---|
| eBay fee tracking in profit (from `todoPersonal.md`) | Separate feature; touches `api.js` and DB views only |
| Visual label preview in orders modal | Phase 2 |
| Remove out-of-stock slash on storefront | Different page entirely |
| Amazon API integration | Not connected; TSV import is separate |
