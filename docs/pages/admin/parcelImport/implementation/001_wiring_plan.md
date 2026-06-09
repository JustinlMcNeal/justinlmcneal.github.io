# Parcel Imports — Implementation Wiring Plan

**Status:** Planning only — no code implemented yet  
**Prerequisite:** Static UX complete ([ux/roadmap.md](../ux/roadmap.md))  
**UI contract:** `pages/admin/parcelImports.html`  
**JS root:** `js/admin/parcelImports/`  
**Strategy:** Parser-first — trust parsed Baestao output before persistence, CPI updates, or side effects

*Last updated: 2026-06-03*

---

## 1. Project overview

Parcel Imports is an admin workflow for **Baestao parcel exports**. Operators import a parcel file, review totals, correct charged values, map line items to Karry Kraze products, preview landed cost impact, and eventually approve updates that affect product CPI and optional bookkeeping.

### End-state capabilities (not all in Phase 1)

| Capability | Description |
|------------|-------------|
| **Parse Baestao exports** | `.xls` files that are often HTML tables; preserve Chinese source text |
| **Review parcel totals** | Parcel ID, weights, fees, item counts from file + summary UI |
| **Override charged values** | Actual charged weight, shipment/service/insurance, FX, USD equivalent |
| **Map rows to KK products** | Business inventory vs personal/excluded; variant selection |
| **Calculate landed CPI** | Per-unit landed cost from product cost + seller freight + parcel share + fee share |
| **Weighted average CPI** | On approval, update product latest CPI and rolling weighted average |
| **Linked expense** | Optional expense record tied to approved import (card charge vs Baestao top-up nuance) |
| **Inventory receiving** | Later: increment stock from approved business rows |
| **Import history** | Drafts, approvals, issues, reopen |

### Why parser-first

Baestao exports are messy (HTML-in-XLS, Chinese headers, inconsistent totals). Saving to Supabase or updating product CPI before the parser is trusted will create bad inventory and cost data. **Phase 1** is entirely browser-local: upload → parse → normalize → render into the existing static sections. No API calls.

---

## 2. Implementation principles

| Principle | Rule |
|-----------|------|
| **Parser-first** | Phases 1–4 run locally; database work starts in Phase 5+ |
| **File size cap** | Prefer **&lt; 500 lines** per JS file; split at **400–450** lines before adding more |
| **Thin entry** | `index.js` orchestrates init only — imports modules, wires events, no business logic blob |
| **Feature modules** | One concern per file; subfolders (`parser/`, `ui/`, `cpi/`, `mapping/`, `api/`) |
| **Progressive enhancement** | Keep static HTML as shell; JS replaces placeholder rows/text when data exists |
| **No logic in HTML** | No inline handlers; no `data-action` soup — use `events.js` + module boundaries |
| **Readable before DB** | Full upload → review flow must work with in-memory state only |
| **Static fallback** | Empty state / “not wired” copy remains until a module renders real data |
| **UI contract** | Section IDs from design phase are stable selectors for `dom.js` |

### Module dependency direction

```
index.js
  → events.js, state.js, dom.js, constants.js
  → ui/* (render only; read state, call dom helpers)
  → parser/* (pure parse/normalize/validate; no DOM)
  → cpi/* (pure math; Phase 4+)
  → mapping/* (local state + suggestions; Phase 3+)
  → api/* (Supabase; Phase 6+)
```

---

## 3. JavaScript architecture

All Parcel Imports admin code lives under **`js/admin/parcelImports/`** (plural folder name).

### Target layout

```
js/admin/parcelImports/
  index.js                 # Entry: init, register listeners, delegate to modules
  state.js                 # Single in-memory store + getters/setters
  dom.js                   # Cached element refs, query helpers
  constants.js             # Enums, column keys, status labels, file limits
  events.js                # Central event wiring (upload, buttons, table)

  parser/
    baestaoParser.js       # Detect format, orchestrate parse pipeline
    htmlTableParser.js     # DOMParser HTML table extraction
    normalizers.js         # CNY, qty, weight, IDs, names → internal keys
    validators.js          # Errors/warnings collection

  ui/
    upload.js              # Drop zone, file input, parse status UI
    parcelSummary.js       # #parcelImportUploadSummary dl/grid
    overrides.js           # #parcelImportChargeOverrides
    itemMappingTable.js    # #parcelImportItemMapping tbody
    matchSuggestions.js    # #parcelImportMatchSuggestions
    cpiPreviewPanel.js     # #parcelImportCpiPreview
    historyTable.js        # #parcelImportHistory (static until Phase 6)
    actionBar.js           # #parcelImportActionBar
    stats.js               # #parcelImportStats KPI row (optional Phase 1)
    tabs.js                # #parcelImportViewTabs (optional; visual switch later)

  cpi/                     # Phase 4+
    costAllocation.js
    cpiPreview.js

  mapping/                 # Phase 3+
    mappingState.js
    mappingSuggestions.js

  api/                     # Phase 6+
    parcelImportsApi.js
    productsApi.js
    expensesApi.js
```

### `index.js` responsibilities (keep small)

1. `import { initDom } from "./dom.js"` and cache roots.
2. `import { createInitialState } from "./state.js"`.
3. Register `events.js` handlers.
4. Call `upload.init()` (or equivalent).
5. Export nothing unless tests need it.

**Anti-pattern:** 800-line `index.js` with parse + render + CPI in one file.

### Page script tag (when Phase 1 starts)

Replace placeholder-only scripts on `parcelImports.html` with:

```html
<script type="module">
  import { initAdminNav } from "/js/shared/adminNav.js";
  initAdminNav("Parcel Imports");
</script>
<script type="module" src="/js/admin/parcelImports/index.js"></script>
<script type="module" src="/js/shared/pwa.js"></script>
```

---

## 4. Phase breakdown

### Phase 1 — Parser foundation only (START HERE)

**Goal:** Select/upload Baestao `.xls`, parse locally, normalize, render into existing UI. No database.

| Area | Work |
|------|------|
| **Scaffold** | `index.js`, `state.js`, `dom.js`, `constants.js`, `events.js` |
| **Parser** | `parser/baestaoParser.js`, `htmlTableParser.js`, `normalizers.js`, `validators.js` |
| **UI** | `ui/upload.js`, `ui/parcelSummary.js`, `ui/itemMappingTable.js` |
| **Upload** | Wire drag-drop + hidden `<input type="file">`; accept `.xls`, `.xlsx` |
| **Detect** | Read file as text; detect HTML/table vs binary Excel (warn on binary) |
| **Parse** | Parcel-level metadata + item rows from tables |
| **Normalize** | CNY, qty, grams, seller freight, order IDs, seller names, item names |
| **Validate** | Required columns, types, totals (see §6) |
| **Feedback** | Success / error / warning banner in upload card |
| **Render** | Push parsed parcel + items into summary + mapping table (replace static rows) |

**Acceptance**

- [ ] User can select a real Baestao sample `.xls` (HTML-table style).
- [ ] Parsed rows appear in **Item Mapping** table (`#parcelImportItemMapping`).
- [ ] **Parcel summary** (`#parcelImportUploadSummary`) reflects parsed parcel fields.
- [ ] Parser errors/warnings visible; page does not silently fail.
- [ ] **No** Supabase / fetch / edge calls.
- [ ] **No** CPI allocation engine (display simple sums from file only if needed).
- [ ] **No** save draft, approve, expense, or inventory logic.
- [ ] Each new JS file stays under 500 lines.

---

### Phase 2 — Manual override state

**Goal:** Edit actual parcel values in the browser after parse; keep in memory only.

| Task | Notes |
|------|-------|
| Enable override inputs | `#parcelImportChargeOverrides` fields editable |
| State | `state.overrides` mirrors XLS + user edits |
| Validation | Charged weight, fees, FX, USD — types and sane ranges |
| Diff UI | Highlight XLS vs override when different |
| Volume weight hint | Keep existing amber callout; optional live check vs dimensions later |

**Acceptance**

- [ ] Overrides update local state and re-render diff styling.
- [ ] Dirty fields identifiable.
- [ ] No persistence.

---

### Phase 3 — Local mapping workflow

**Goal:** Interactive row classification and product/variant placeholders in memory.

| Row type | Values |
|----------|--------|
| Business Inventory | Counts toward CPI update preview |
| Personal / Excluded | Visible; excluded from product CPI update |
| Supplies | TBD — may absorb share without SKU CPI |
| Unknown | Needs mapping |

| Mapping status | Values |
|----------------|--------|
| matched | |
| needs mapping | |
| variant uncertain | |
| personal / excluded | |

**Modules:** `mapping/mappingState.js`, extend `ui/itemMappingTable.js`, stub `ui/matchSuggestions.js` with static rules.

**Acceptance**

- [ ] User can change type/status per row locally.
- [ ] Personal/excluded excluded from CPI update preview counts (Phase 4).
- [ ] No product search API yet.

---

### Phase 4 — Local CPI preview engine

**Goal:** Landed CPI preview from parsed rows + overrides + mapping exclusions.

| Task | Module |
|------|--------|
| Weight-based parcel shipping allocation | `cpi/costAllocation.js` |
| Seller freight per row | same |
| Insurance / service fee allocation | configurable method (document in code comments) |
| FX → USD per row | `cpi/cpiPreview.js` |
| Per-unit landed CPI CNY + USD | `ui/cpiPreviewPanel.js` |
| Warnings | missing weight, qty, unmapped business rows |

**Personal/excluded rule:** Absorb parcel shipping share in allocation if configured; **do not** include in “products affected” / CPI update preview.

**Acceptance**

- [ ] CPI preview panel updates from local state.
- [ ] No DB writes; no product CPI updates.

---

### Phase 5 — Supabase schema planning

**Goal:** Design tables after parser + local preview are trusted. **Sketch only in this plan — migrations in a later doc/PR.**

#### Proposed tables (sketch)

| Table | Purpose |
|-------|---------|
| `parcel_imports` | Header: parcel_id, status, source_file_name, imported_at, weights, fee totals, FX, USD, approval metadata |
| `parcel_import_items` | Line rows: source names, seller, order_id, qty, weights, prices, raw JSON |
| `parcel_import_item_mappings` | Per import item: product_id, variant_id, row_type, mapping_status, notes |
| `parcel_import_adjustments` | Override snapshot vs XLS (charged weight, fees, FX) |
| `parcel_import_cost_allocations` | Optional persisted CPI preview lines per item at save/approve time |
| `parcel_mapping_memory` | Seller + normalized title + optional URL hash → product_id (not URL-only) |
| Expense linkage | `expense_id` on `parcel_imports` or join table to existing expenses |

**Decisions to make before migrations**

- Store raw file blob vs metadata-only?
- Immutable approved snapshot vs editable draft?
- RLS policies aligned with other admin tables.

---

### Phase 6 — Save draft / load history

**Goal:** Persist drafts; populate `#parcelImportHistory`.

| Task | Module |
|------|--------|
| Save draft API | `api/parcelImportsApi.js` |
| Load list + reopen | `ui/historyTable.js` |
| Store raw + normalized values | DB columns + `raw` JSON on items |
| File metadata | name, size, checksum; optional blob storage |

---

### Phase 7 — Product mapping memory

**Goal:** Suggest matches from history + product catalog.

**Signals (weighted, not URL-only)**

| Signal | Notes |
|--------|-------|
| Seller name | Primary |
| Source item name (Chinese) | Fuzzy / normalized |
| Baestao order ID | Weak signal |
| Saved sourcing URL | From `products` seller URL field — **may change**; use as hint only |
| Previous manual mapping | Strong when same seller + similar title |
| Product title | English catalog match |
| Variant hints | From prior imports |
| Price / weight similarity | Tie-breaker |

**Module:** `mapping/mappingSuggestions.js`, `api/productsApi.js`

---

### Phase 8 — Approval + weighted CPI update

**Goal:** Approve import → update product CPI with audit trail.

| Task | Notes |
|------|-------|
| Pre-approve validation | All business rows mapped or excluded |
| Final landed CPI | Persist allocation snapshot |
| Update `latest_cpi` | Per product/variant |
| Weighted average CPI | Formula over approved imports |
| Idempotency | Prevent double approval |
| Audit | who/when/what changed |

---

### Phase 9 — Expense linkage

**Goal:** Optional expense on approve.

**Business context:** User often enters **card-charged USD** in expenses manually. Baestao wallet top-ups may cover **multiple parcels** — support manual effective rate / USD equivalent first; **top-up ledger** is a later initiative.

| Task | Module |
|------|--------|
| Checkbox on action bar | `#parcelExpenseCheckbox` |
| Create/link expense | `api/expensesApi.js` |
| Store reference on import | `parcel_imports.expense_id` |

---

### Phase 10 — Inventory receiving

**Goal:** Increment inventory from approved business rows — **after** approval workflow is reliable.

| Task | Notes |
|------|-------|
| SKU + qty from mapped rows | Exclude personal/excluded |
| Receiving audit | Link to `parcel_import_id` |
| Idempotent receive | Avoid double stock on reopen |

---

## 5. Baestao parser design

### File reality

Baestao “`.xls`” exports are often **HTML documents** saved with an Excel extension, not binary BIFF. The parser must:

1. Read the file as **text** (`FileReader.readAsText` with UTF-8; try fallback if garbled).
2. Detect `<table`, `<html`, or spreadsheet XML patterns.
3. Parse tables with **`DOMParser`** (`htmlTableParser.js`).
4. Map **Chinese column headers** → internal English keys via a header alias map in `constants.js`.
5. Preserve **`raw`** cell text on each item for debugging and future column additions.
6. If binary Excel detected: **warn** — true XLSX parsing (e.g. SheetJS) is a later fallback, not Phase 1.

### Parse pipeline

```
File → readAsText
  → baestaoParser.detectFormat(text)
  → htmlTableParser.extractTables(text)
  → baestaoParser.locateParcelSection(tables)
  → baestaoParser.locateItemSection(tables)
  → normalizers.parcel(rowMap)
  → normalizers.items(rowMaps[])
  → validators.run(parcel, items) → { errors[], warnings[] }
  → state.setParseResult(...)
  → ui/* render
```

### Normalized parcel shape

```js
{
  parcelId: string | null,           // e.g. "BST-2026-0142" if present in file
  sourceFileName: string,
  sourceFormat: "baestao_html_xls" | "unknown",
  importedAt: string,                // ISO date — now() at parse time unless file has date
  totalItems: number | null,         // sum of qty or row count — document which
  parcelWeightGrams: number | null,
  chargedWeightGrams: number | null,
  totalItemFeeCny: number | null,
  shipmentFeeCny: number | null,
  insuranceCny: number | null,       // or boolean + amount
  serviceFeeCny: number | null,
  totalParcelChargeCny: number | null,
  effectiveFxRate: number | null,
  usdEquivalent: number | null,
  warnings: [],                      // parser-level warnings
  raw: {}                            // key header cells preserved
}
```

### Normalized item shape

```js
{
  rowNumber: number,
  sourceItemName: string,            // Chinese title preserved
  sellerName: string | null,
  baestaoOrderId: string | null,
  unitPriceCny: number | null,
  quantity: number | null,
  itemWeightGrams: number | null,
  sellerFreightCny: number | null,
  lineItemSubtotalCny: number | null,
  lineTotalCny: number | null,       // if distinct from subtotal in export
  raw: {}                            // original column → value
}
```

### Header alias strategy (examples — finalize against sample file)

| Internal key | Example Chinese / export headers |
|--------------|----------------------------------|
| `sourceItemName` | 商品名称, 货品名称, … |
| `sellerName` | 卖家, 店铺, … |
| `baestaoOrderId` | 订单号, 订单编号, … |
| `unitPriceCny` | 单价, 价格, … |
| `quantity` | 数量, 件数, … |
| `itemWeightGrams` | 重量, 克, … |
| `sellerFreightCny` | 运费, 卖家运费, … |

Phase 1 deliverable: document actual headers from the **canonical sample Baestao file** in `constants.js` once confirmed.

---

## 6. Validation rules

Validators return structured issues: `{ code, level: "error"|"warning", message, field?, rowNumber? }`.

### Errors (block “parse success” UI or show fatal banner)

| Code | Condition |
|------|-----------|
| `UNSUPPORTED_FORMAT` | Not HTML/table text |
| `NO_TABLES` | DOMParser finds no data tables |
| `MISSING_REQUIRED_COLUMN` | Required item column unmapped |
| `INVALID_QUANTITY` | Qty not a positive integer |
| `INVALID_WEIGHT` | Weight negative or non-numeric |
| `INVALID_PRICE` | Unit price missing on business row |
| `EMPTY_FILE` | No readable content |

### Warnings (show but allow review)

| Code | Condition |
|------|-----------|
| `PARCEL_TOTAL_MISMATCH` | Sum of line totals ≠ parcel total (tolerance) |
| `DUPLICATE_ROW` | Same order ID + item name + qty duplicate |
| `EMPTY_SELLER` | Seller blank |
| `CHARGED_WEIGHT_LOW` | Charged weight &lt; parcel weight |
| `ITEM_COUNT_MISMATCH` | Row count vs declared total items |
| `SELLER_FREIGHT_UNKNOWN` | Freight cell empty or “—” |
| `MISSING_PARCEL_ID` | Could not extract parcel ID |
| `PARTIAL_NUMERIC` | Some rows failed normalization |

Phase 1: display errors/warnings in upload card and optionally per-row in table.

---

## 7. CPI calculation rules (later phases)

Document formulas now; implement in **Phase 4+** only.

### Landed CPI (per unit, business rows)

```
landedCpiCny =
  productCostCny
  + sellerFreightPerUnit
  + parcelShippingSharePerUnit
  + insuranceServiceSharePerUnit
  + fxPaymentSharePerUnit

landedCpiUsd = landedCpiCny / effectiveFxRate   // when rate present
```

### Parcel shipping share

Default: allocate by **item weight × qty** relative to total allocatable weight (exclude or include personal rows per config — default: personal rows **receive share** but do not update product CPI).

### Fulfilled CPI (preview only until Shippo integration)

```
fulfilledCpi = landedCpi + outboundCustomerShippingAverage
```

Outbound average from Shippo label history is **Phase 10+ / separate initiative** — UI already shows placeholder.

### Product CPI on approval (Phase 8)

```
newWeightedAvgCpi = weightedAverage(previousApprovedImports, thisImportLandeds)
latestCpi = thisImportLandedCpi   // or business rule TBD
```

### Personal / excluded rows

- **Include** in parcel fee allocation denominator if using weight-based split (so business rows are not overcharged).
- **Exclude** from product CPI update set and “products affected” counts.

---

## 8. UI wiring — section ownership

Existing HTML sections are the contract. Modules **query via `dom.js`** and **render via `ui/*`**.

| Section ID | UI module | Phase |
|------------|-----------|-------|
| `#parcelImportStats` | `ui/stats.js` (optional) | 1 partial / 6 live KPIs |
| `#parcelImportViewTabs` | `ui/tabs.js` | Later (visual switch) |
| `#parcelImportUploadSummary` | `ui/upload.js` + `ui/parcelSummary.js` | 1 |
| `#parcelImportChargeOverrides` | `ui/overrides.js` | 2 |
| `#parcelImportItemMapping` | `ui/itemMappingTable.js` | 1 render, 3 interact |
| `#parcelImportMatchSuggestions` | `ui/matchSuggestions.js` | 3 stub, 7 API |
| `#parcelImportCpiPreview` | `ui/cpiPreviewPanel.js` | 4 |
| `#parcelImportHistory` | `ui/historyTable.js` | 6 |
| `#parcelImportActionBar` | `ui/actionBar.js` | 6+ enable actions |

### Render strategy (Phase 1)

- Keep static placeholder rows in HTML for no-JS fallback.
- On successful parse: **clear** `tbody` and build rows from template literals or `document.createElement` in `itemMappingTable.js`.
- Parcel summary: update `<dd>` / text nodes by `data-field` attributes (add minimal hooks in HTML when implementing Phase 1).

### KPI row

Phase 1 may only update “Unmapped Rows” / “Total items” style counts from parsed state; full KPIs from DB in Phase 6.

---

## 9. Testing / QA plan

### Phase 1 — Parser

| Test | Expected |
|------|----------|
| Sample Baestao `.xls` (HTML) | Parcel + ≥1 item row parsed; Chinese preserved in `sourceItemName` + `title` attr |
| Malformed / empty file | Fatal error message; no partial silent state |
| Missing column export | `MISSING_REQUIRED_COLUMN` error |
| Wrong extension / binary xlsx | `UNSUPPORTED_FORMAT` or clear warning |
| Large file (row count) | UI remains responsive; consider row virtualisation later if &gt;200 rows |
| **No Supabase** | Network tab shows no parcel import API calls |
| **Line count audit** | No file in `js/admin/parcelImports/` exceeds 500 lines |

### Phase 2–4 — Local state

| Test | Expected |
|------|----------|
| Override charged weight &gt; parcel weight | Amber highlight / warning |
| Personal row marked | Excluded from CPI product count in preview |
| Weight-based allocation | Sum of shares ≈ total parcel shipping (± rounding) |

### Phase 6+ — Integration

| Test | Expected |
|------|----------|
| Save draft → reload | Same parcel + items |
| Approve twice | Blocked |
| Expense checkbox | Creates/links one expense |

### Manual checklist before Phase 2

- [ ] Compare parser output to manual spreadsheet review for one real parcel.
- [ ] Confirm column mapping against Baestao export version user actually receives.

---

## 10. Non-goals for Phase 1 (parser foundation)

Do **not** implement in the first coding pass:

- Supabase schema / migrations / RLS
- Save draft / load history
- Approve import / product CPI update
- Expense creation or top-up ledger
- Inventory receiving
- Shippo outbound shipping average
- Product search API / mapping memory persistence
- Tab switching JS (optional later)
- Binary Excel / SheetJS fallback (warn only)
- Auth changes beyond existing admin session
- Edge functions for server-side parse (browser-first)

---

## 11. Recommended next action

**Start Phase 1** by creating only these files (in order), each staying under 500 lines:

1. `js/admin/parcelImports/constants.js`
2. `js/admin/parcelImports/state.js`
3. `js/admin/parcelImports/dom.js`
4. `js/admin/parcelImports/parser/htmlTableParser.js`
5. `js/admin/parcelImports/parser/normalizers.js`
6. `js/admin/parcelImports/parser/validators.js`
7. `js/admin/parcelImports/parser/baestaoParser.js`
8. `js/admin/parcelImports/ui/upload.js`
9. `js/admin/parcelImports/ui/parcelSummary.js`
10. `js/admin/parcelImports/ui/itemMappingTable.js`
11. `js/admin/parcelImports/events.js`
12. `js/admin/parcelImports/index.js`

Then:

- Add module script to `pages/admin/parcelImports.html`.
- Add minimal `data-field` hooks on parcel summary `<dd>` elements if needed.
- Test with the canonical Baestao sample file.
- Record actual Chinese column headers in `constants.js`.

**Do not** create `api/*`, `cpi/*`, or migrations until Phase 1 acceptance is signed off.

---

## Related documents

| Doc | Purpose |
|-----|---------|
| [ux/roadmap.md](../ux/roadmap.md) | Completed static design phases 0–12 |
| `001_wiring_plan.md` (this file) | Implementation sequencing |
| *Future:* `002_schema_sketch.md` | Detailed ERD + migration notes (Phase 5) |
| *Future:* `003_parser_column_map.md` | Header map from real Baestao samples |

---

*End of wiring plan — implementation not started.*
