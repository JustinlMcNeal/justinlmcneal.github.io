# Parcel Imports — Admin UX Design Roadmap

**Status:** Static UX complete — ready for wiring plan  
**Target page:** `pages/admin/parcelImports.html`  
**Design reference:** `pages/admin/amazon.html` (Amazon Listings admin)  
**Design closed:** 2026-06-03

---

## 1. Project goal

Build a **non-functional** admin page shell for **Baestao parcel imports** that looks production-ready and matches the latest Amazon Listings admin visual language. The page will eventually support landed CPI review, item mapping, CPI previews, import history, and approval workflows — but **this roadmap covers visual design only**.

Deliver a complete static layout an operator can review section-by-section before any parser, database, or CPI logic is wired.

---

## 2. Scope

| In scope | Out of scope (see §10) |
|----------|-------------------------|
| Static HTML structure | Baestao XLS parsing |
| Tailwind utility styling | Supabase schema / APIs |
| Placeholder copy and sample rows | Product CPI updates |
| Amazon-admin visual parity | Weighted average / Shippo calculations |
| Optional minimal page CSS in `css/pages/admin/` | Expense report creation |
| Admin nav mount pattern (static include) | Inventory receiving |
| Section-by-section build + review | Product search / real mapping |

---

## 3. Non-goals

- No Baestao XLS parsing or file upload processing
- No Supabase schema changes or queries
- No product CPI updates or weighted-average math
- No Shippo outbound shipping average integration
- No expense report creation or inventory receiving
- No product search, mapping persistence, or approval side effects
- No API wiring, edge functions, or auth changes beyond existing admin page patterns
- No tab-switching JavaScript unless pure static markup/CSS (e.g. one tab marked active in HTML)
- No dedicated business logic module (`js/admin/parcelImport/…`) in this phase

---

## 4. Design constraints

### Visual reference — Amazon Listings admin

Mirror patterns from `pages/admin/amazon.html`:

| Pattern | Amazon reference | Parcel Imports usage |
|---------|------------------|----------------------|
| Page canvas | `body.kk-page.kk-admin.bg-gray-50` | Same body classes |
| Max width | `main.max-w-[88rem] mx-auto px-3 sm:px-6 py-4 sm:py-8` | Same container |
| Header card | `bg-white rounded-2xl shadow-sm border border-gray-200` | Page title + actions |
| Admin kicker | `inline-block bg-black text-white px-2 py-1 text-[10px] font-black uppercase tracking-[.25em]` | “Admin Panel” label |
| Title | `text-2xl sm:text-4xl font-black tracking-tight` | “Parcel Imports” |
| Subtitle | `text-xs sm:text-sm text-gray-500` | Baestao / CPI subtitle |
| Primary button | `border-4 border-black bg-black text-white … font-black uppercase tracking-[.12em] text-[10px] sm:text-xs min-h-[44px]` | Approve + Update CPI |
| Secondary button | `border-4` or `border-2 border-black bg-white … hover:bg-gray-50` | Save Draft, Export, New Import |
| KPI cards | `grid grid-cols-2 lg:grid-cols-*` + `rounded-xl border border-gray-200 shadow-sm` + icon tile | Five import KPIs |
| Work-area tabs | `rounded-xl border-4 border-black` active vs `border-2 bg-white` inactive | Upload → Previous Imports |
| Section cards | `bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6` | Upload, mapping, CPI, history |
| Tables | `w-full border-collapse text-sm` + sticky header + `overflow-x-auto` wrapper | Item mapping + history |
| Status pills | `rounded-full px-2 py-0.5 text-[10px] font-black uppercase` + tinted `bg-*-50 border` | Draft, Matched, Issues, etc. |
| Form fields | `border-2 border-gray-200 rounded-lg px-3 py-2 text-sm` | Overrides, mapping dropdowns (static) |

### CSS / Tailwind direction

- **Primary styling:** Tailwind CDN + `tailwind.config` extend (`kkpink`, `kkpeach`, `border-4`) — same as Amazon page head block.
- **Theme reuse:** `/css/theme/base.css`, `/css/theme/components.css`, optionally `/css/theme/admin-ui.css` for `.kk-btn-solid`, `.kk-btn-ghost`, `.kk-admin-pill` if useful.
- **Page CSS (optional):** `css/pages/admin/parcelImports.css` — only if repeated table density, truncated Chinese titles, or sticky action bar need shared rules. Prefer utilities first.
- **Do not** introduce a new design system; extend Amazon admin patterns.

### Content / UX notes

- Baestao item names may be Chinese — use truncation + `title` attribute or helper text (“hover for full name”).
- Clearly separate **XLS imported values** vs **actual override** fields (labels, columns, or subtle background tints).
- Desktop-first; mobile acceptable but not primary.
- All counts, CPI values, and mapping suggestions are **placeholder fiction** until wiring phase.

---

## 5. File targets

| File | Purpose |
|------|---------|
| `pages/admin/parcelImports.html` | Static page shell (created incrementally per phase) |
| `css/pages/admin/parcelImports.css` | Optional — only if Tailwind repetition is excessive |
| `docs/pages/admin/parcelImport/ux/roadmap.md` | This roadmap |
| `js/shared/adminNav.js` | Existing — add nav link to Parcel Imports when page exists (static link only; no new JS module for parcel logic) |

**Do not create in design phase:**

- `js/admin/parcelImport/*`
- Supabase migrations
- Edge functions

---

## 6. Recommended page structure

Top-to-bottom layout (single scroll page; tab panels can be static sections or one visible panel):

```
#kkAdminNavMount
<main id="parcelImportsPage" data-page="parcel-imports">
  ├─ Header (kicker, title, subtitle, action buttons)
  ├─ KPI row (5 cards)
  ├─ Work Area tabs (Upload | Review Parcel | Map Items | CPI Preview | Previous Imports)
  ├─ [Active workflow panel — static markup for phases 4–8 stacked or one panel visible]
  │   ├─ Upload + Parcel Summary card
  │   ├─ Actual Charges / Override card
  │   ├─ Item Mapping table (+ bulk actions / filters row)
  │   ├─ Saved Match Suggestions module (sidebar or below-table strip)
  │   └─ CPI Preview / Cost Summary card
  ├─ Previous Imports table (always visible below workflow OR tab panel 5)
  └─ Bottom Action Bar (sticky on desktop)
</main>
#kkFooterMount (optional, match other admin pages)
```

**HTML head pattern (match Amazon):**

- Tailwind CDN + config script
- `base.css`, `components.css`
- Optional `parcelImports.css`
- No parcel import JS modules in design phase (admin nav init only if other admin pages use it)

---

## 7. Section-by-section implementation phases

Build **one phase at a time**. Stop after each phase for visual review before continuing.

---

### Phase 0 — Discovery / Existing Admin Style Audit

**Tasks**

- [x] Read `pages/admin/amazon.html` header, KPI grid, work-area tabs, filter card, table section, status pills.
- [x] Note reusable Tailwind class strings (document in PR or phase notes).
- [x] Confirm `css/theme/admin-ui.css` helpers vs inline Tailwind on Amazon page.
- [x] Confirm admin shell: `#kkAdminNavMount`, `initAdminNav` script pattern from peer admin pages.
- [x] Confirm **no** functional wiring is required for this initiative.

**Design patterns to mirror (audit checklist)**

- Light gray page background (`bg-gray-50`)
- White rounded cards with thin gray border (`border-gray-200`, `rounded-2xl`, `shadow-sm`)
- Bold black typography for headings and KPI values
- Black/white outline buttons with uppercase micro-labels
- Active tab: `border-4 border-black bg-black text-white`
- Inactive tab: `border-2 border-black bg-white`
- Table: dense `text-sm`, monospace for IDs, right-align numbers
- Status: small rounded pills with semantic tint (green/amber/red/violet)

**Acceptance**

- Roadmap §4 and this phase list the concrete classes/patterns to copy before HTML work begins.
- Team agrees Amazon Listings is the single visual source of truth.

---

### Phase 1 — Page Shell + Header

**Build**

- Create `pages/admin/parcelImports.html` with document head (Tailwind + theme CSS).
- Body: `kk-page kk-admin bg-gray-50 min-h-screen`
- `#kkAdminNavMount` (empty mount; wire `initAdminNav` like other admin pages if nav link added).
- Header card:
  - Kicker: **Admin Panel**
  - Title: **Parcel Imports**
  - Subtitle: *Import Baestao parcels, map items, and update landed CPI.*
  - Top-right buttons (static `type="button"`, no handlers):
    - **New Import** (secondary)
    - **Save Draft** (secondary)
    - **Approve + Update CPI** (primary black fill)
    - **Export** (secondary, `border-2` tier like Amazon Export)

**Acceptance**

- Page exists at `pages/admin/parcelImports.html` and opens without JS errors.
- Header visually matches Amazon admin header card.
- All buttons are non-functional (no `data-action` handlers required).

---

### Phase 2 — KPI Cards

**Build**

- Row: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4`
- Five articles with icon tile + large number + label:

| KPI | Placeholder value |
|-----|-------------------|
| Total Imports | 24 |
| Draft Imports | 3 |
| Awaiting Approval | 2 |
| Approved | 18 |
| Unmapped Rows | 7 |

**Acceptance**

- KPI cards match Amazon stats card styling (`rounded-xl`, `border-gray-200`, `font-black` counts).
- Responsive grid works on desktop and collapses cleanly on smaller widths.
- No `data-value` binding or live updates.

---

### Phase 3 — Work Area Tabs / Step Navigation

**Build**

- Nav label: **Work Area** (`text-[9px] font-black uppercase tracking-[.18em] text-gray-500`)
- Tablist (static; **Upload** active):

| Tab | State |
|-----|--------|
| Upload | Active (`border-4 border-black bg-black text-white`) |
| Review Parcel | Inactive |
| Map Items | Inactive |
| CPI Preview | Inactive |
| Previous Imports | Inactive |

- Optional helper line under tabs (Amazon-style gray microcopy).
- Use `role="tablist"` / `role="tab"` / `aria-selected` for accessibility; **no** click handlers.

**Acceptance**

- Tabs render with correct active/inactive visual states.
- No JavaScript tab switching (single active tab in markup is fine).
- Matches Amazon work-area tab styling.

---

### Phase 4 — Upload + Parcel Summary Section

**Build**

- Card: **Upload parcel file**
  - Drag/drop visual zone (dashed border, icon, “Drop Baestao export here”)
  - **Select File** button (non-functional; `input type="file"` optional but `disabled` or omitted)
  - Helper: accepted formats, e.g. `.xls`, `.xlsx` — Baestao export
- Card: **Parcel summary** (definition list or 2-column grid) — placeholder:

| Field | Placeholder |
|-------|-------------|
| Parcel ID | BST-2026-0142 |
| Import file | baestao_parcel_0142.xlsx |
| Import date | 2026-05-28 |
| Source | Baestao |
| Total items | 18 |
| Parcel weight | 4.2 kg |
| Charged weight | 5.1 kg |
| Total item fee | ¥ 1,240.00 |
| Shipment fee | ¥ 380.00 |
| Insurance | ¥ 45.00 |
| Status | Needs Review |

- Status chips: **Draft**, **Imported**, **Needs Review** (pills; one highlighted)

**Acceptance**

- Upload UI is visual only; no file processing.
- Parcel summary uses realistic Baestao-like placeholder data.
- Section uses standard white rounded card pattern.

---

### Phase 5 — Actual Charges / Override Section

**Build**

- Card title: **Actual charges & overrides**
- Two-column layout: **From XLS** (read-only styled) vs **Actual / override** (editable-looking static inputs)
- Fields:

| Label | Notes |
|-------|--------|
| Parcel Weight (kg) | XLS vs actual |
| Charged Weight (kg) | highlight if higher |
| Shipment Fee (CNY) | |
| Service Fee (CNY) | |
| Insurance (CNY) | |
| Total Actual Parcel Charge (CNY) | emphasized |
| Effective Exchange Rate | e.g. 7.24 |
| USD Equivalent | e.g. $89.42 |

- Helper callout (amber or gray info box):
  - *Charged weight may exceed parcel weight when volume weight applies.*
  - Formula: **L × W × H / 5000** (cm → volumetric kg)

**Acceptance**

- Fields are static or `readonly` / disabled appearance.
- No calculations on change.
- Clear visual distinction between imported XLS values and override column.

---

### Phase 6 — Item Mapping Table

**Build**

- Toolbar row above table: static **Filters** + **Bulk actions** buttons (Map selected, Mark personal, Exclude).
- Table columns:

| Col | Notes |
|-----|--------|
| ☐ | checkbox, static |
| Row | 1, 2, 3… |
| Baestao Item | truncated Chinese + `title` full name |
| Seller | |
| Order ID | monospace |
| Unit Price CNY | right-align |
| Qty | |
| Weight g | |
| Seller Freight | |
| Mapped KK Product | static `<select>` appearance |
| Variant | static select |
| Type | Product / Personal / Excluded |
| Status | pill |

**Sample rows (minimum 4)**

| Row | Baestao item (short) | Status |
|-----|----------------------|--------|
| 1 | 卡通钥匙扣盲盒款… | **Matched** (green) |
| 2 | 树脂摆件小号… | **Variant Uncertain** (amber) |
| 3 | 包装耗材… | **Personal / Excluded** (gray) |
| 4 | 新款毛绒挂件… | **Needs Mapping** (red) |

- Inline helper row or note under row 2: *“Possible match from saved sourcing URL”*
- Horizontal scroll wrapper for dense columns.

**Acceptance**

- Table matches Amazon admin density and readability.
- Dropdowns are static HTML (no search).
- No mapping or persistence logic.

---

### Phase 7 — Saved Match Suggestions Module

**Build**

- Compact panel (card or right rail on `lg+`):
  - **Same seller matched before** — KK-1042 · High
  - **Similar source title found** — KK-0891 · Medium
  - **Possible match from saved sourcing URL** — KK-1042 variant B · High
- Confidence badges: **High** (green), **Medium** (amber)

**Acceptance**

- Module is clearly auxiliary / assistive.
- All content is static placeholder.
- No matching engine or click behavior.

---

### Phase 8 — CPI Preview / Cost Summary Module

**Build**

- Card: **CPI preview**
- Summary grid:

| Metric | Placeholder |
|--------|-------------|
| Landed CPI Preview | ¥ 12.40 / $1.71 |
| Latest CPI | $1.65 |
| Weighted Avg CPI | $1.58 |
| Fulfilled CPI Preview | $1.71 |

- Breakdown table:

| Line | CNY | USD (est.) |
|------|-----|------------|
| Product Cost | ¥ 8.20 | $1.13 |
| Seller Freight | ¥ 1.10 | $0.15 |
| Parcel Shipping Share | ¥ 2.40 | $0.33 |
| Insurance / Service Share | ¥ 0.35 | $0.05 |
| FX / Payment Share | ¥ 0.35 | $0.05 |
| **Total Landed CPI Preview** | **¥ 12.40** | **$1.71** |

- Footnote: *Product CPI updates use weighted average from approved imports.*

**Acceptance**

- CPI section is readable at a glance; numbers are fake.
- No math or product updates.

---

### Phase 9 — Previous Imports Section

**Build**

- Section title: **Previous parcel imports**
- Table columns: Parcel ID, Import Date, Status, Items, Charged Weight, CNY Total, USD Total est., Products Updated, Issues, Actions
- Sample rows:

| Parcel ID | Status | Issues |
|-----------|--------|--------|
| BST-2026-0138 | Approved | — |
| BST-2026-0135 | Draft | — |
| BST-2026-0129 | Issues | 2 unmapped |

- Actions: static **View** / **Reopen** ghost buttons

**Acceptance**

- Table below main workflow (or visible when Previous Imports tab is “active” in static HTML).
- Matches admin table styling.
- Actions non-functional.

---

### Phase 10 — Bottom Action Bar

**Build**

- Sticky footer bar (`sticky bottom-0` or fixed within main) on desktop:
  - ☐ **Create linked expense record** (static checkbox)
  - **Save Draft** (secondary)
  - **Approve Import** (secondary)
  - **Approve + Update CPI** (primary)

**Acceptance**

- Clear primary hierarchy: **Approve + Update CPI** uses black fill.
- All controls static.
- Bar does not overlap content on scroll (padding-bottom on main if needed).

---

### Phase 11 — Responsive / Polish Pass

**Tasks**

- [x] Verify `max-w-[88rem]` layout on wide desktop.
- [x] Check `md` / `lg` breakpoints for KPI grid, tabs, mapping table scroll, suggestions panel stack.
- [x] Ensure Chinese truncation does not break table layout.
- [x] Remove unused CSS; confirm Tailwind covers 95%+ of styling.
- [x] Add `parcelImports.css` only if needed (document why in Phase 12) — **not needed**.
- [x] Validate page opens with only admin nav script (if any) — no missing module 404s.
- [x] Add `parcelImports` link to admin nav (href only).

**Acceptance**

- Page looks complete and polished on desktop.
- No console errors from missing scripts.
- No broken asset references.
- No unnecessary JS.

---

### Phase 12 — Design Closeout

**Tasks**

- [x] Update this roadmap §12 completion block.
- [x] List all files created/changed.
- [x] List phases completed with dates.
- [x] Document known non-functional placeholders.
- [x] Point to next initiative: wiring plan (parser + data model).

**Acceptance**

- [x] Design phase explicitly marked complete and separated from wiring.

#### Completion record

| Item | Status |
|------|--------|
| Design phases 0–11 | **Complete** (2026-06-03) |
| `pages/admin/parcelImports.html` | **Created** |
| `css/pages/admin/parcelImports.css` | **N/A** — not needed |
| Admin nav link | **Added** — `page_inserts/admin-nav.html` (desktop: Parcels; mobile: Parcel Imports) |
| Known placeholders | All parcel data, CPI values, mapping suggestions, history rows, and actions are static placeholders |
| Next phase | Baestao parser + DB wiring plan |

#### Design closeout summary

Static admin page created at `pages/admin/parcelImports.html`, built one section at a time:

| Step | Section |
|------|---------|
| Phase 1 | Header (kicker, title, actions) |
| Phase 2 | KPI cards (5 metrics) |
| Phase 3 | Work Area tabs (5-step workflow) |
| Phase 4 | Upload + parcel summary |
| Phase 5 | Actual charges / overrides |
| Phase 6 | Item mapping table |
| Phase 7 | Saved match suggestions |
| Phase 8 | CPI preview / cost summary |
| Phase 9 | Previous imports table |
| Phase 10 | Bottom action bar (sticky) |
| Phase 11 | Responsive / polish pass |

**Styling**

- Tailwind utilities used heavily (CDN + `kkpink` / `kkpeach` / `border-4` config in page head).
- No dedicated `css/pages/admin/parcelImports.css` created.
- Shared theme CSS reused: `/css/theme/base.css`, `/css/theme/components.css`.

**Admin nav**

- Link added in `page_inserts/admin-nav.html` (plain `href` only; no route logic).

**Static only — not implemented**

- No Baestao parsing
- No Supabase / API wiring
- No CPI calculations
- No expense creation
- No inventory receiving
- No product mapping persistence
- No `js/admin/parcelImport/*` modules

**Scripts on page (existing shared only)**

- `initAdminNav("Parcel Imports")` via `/js/shared/adminNav.js`
- `/js/shared/pwa.js`

#### Recommended next document

Create when starting the wiring initiative (not part of this design phase):

`docs/pages/admin/parcelImport/implementation/001_wiring_plan.md`

#### Future wiring checklist

Use the wiring plan doc to sequence backend and admin JS work. High-level items:

- [ ] Parser / data import shape (Baestao XLS column mapping, validation)
- [ ] Parcel / import database schema
- [ ] Item-to-product mapping memory (seller, title, sourcing URL)
- [ ] CPI calculation engine (landed cost allocation, FX, parcel share)
- [ ] Weighted average product CPI updates on approve
- [ ] Expense report linkage (optional checkbox on approve)
- [ ] Shippo outbound average integration (fulfilled CPI component)
- [ ] Inventory receiving from approved parcel lines
- [ ] Approval workflow (draft → review → approved; void / reopen)
- [ ] Admin JS / API layer (`js/admin/parcelImport/*`, edge functions)

#### Files touched during design phase

| File | Role |
|------|------|
| `pages/admin/parcelImports.html` | Static UX shell (~1,390 lines) |
| `page_inserts/admin-nav.html` | Desktop + mobile nav links |
| `docs/pages/admin/parcelImport/ux/roadmap.md` | This roadmap |

**Not created:** `css/pages/admin/parcelImports.css`, `js/admin/parcelImport/*`, Supabase migrations, edge functions.

---

## 8. Acceptance criteria summary (per phase)

| Phase | Done when |
|-------|-----------|
| 0 | Style audit documented; patterns listed |
| 1 | Page + header exist; Amazon parity |
| 2 | Five KPI cards with placeholders |
| 3 | Five static tabs; one active |
| 4 | Upload zone + parcel summary |
| 5 | Override card + volume weight note |
| 6 | Mapping table + 4 sample states |
| 7 | Suggestions module + confidence badges |
| 8 | CPI preview + breakdown |
| 9 | Previous imports table |
| 10 | Bottom action bar |
| 11 | Responsive polish; no console noise |
| 12 | Closeout notes in §12 — **complete** |

---

## 9. Final QA checklist (design closeout)

- [x] Visual match to `pages/admin/amazon.html` (cards, buttons, tabs, tables, pills)
- [x] No Supabase, fetch, or import logic in HTML/JS
- [x] No `js/admin/parcelImport/` modules
- [x] Placeholder data is static fiction (footer/helper copy notes “not wired yet”)
- [x] All primary actions visible: New Import, Save Draft, Approve + Update CPI, Export
- [x] Work-area steps readable left-to-right
- [x] Mapping table scrolls horizontally without breaking page
- [x] CPI and override sections understandable without training doc
- [x] Page loads on Live Server / static host without 404s
- [x] Accessibility: table `scope`, tab `aria-selected`, form labels present
- [x] Chinese item name truncation + full text on hover (`title`)

---

## 10. Future wiring phases (explicitly out of scope)

Do **not** implement during this UX roadmap. Track as follow-on initiatives:

1. **Baestao XLS parser** — column mapping, validation, error rows  
2. **Parcel import database** — parcels, line items, import runs, audit log  
3. **Item-to-product mapping memory** — seller + source URL + title fuzzy match  
4. **CPI calculation engine** — landed cost allocation, FX, parcel share math  
5. **Weighted average CPI updates** — on approve, update `products` / variants  
6. **Expense report linkage** — optional “Create linked expense record” on approve  
7. **Shippo outbound shipping average** — optional CPI component (if productized)  
8. **Inventory receiving** — stock increments from approved parcel lines  
9. **Approval workflow** — draft → review → approved; void/reopen  
10. **API / edge functions** — upload, parse, preview CPI, commit  
11. **Admin JS module** — `js/admin/parcelImport/index.js` + API layer  

**Recommended next doc (create when wiring starts):**  
[`docs/pages/admin/parcelImport/implementation/001_wiring_plan.md`](../implementation/001_wiring_plan.md) — parser spec + schema sketch + API surface. **Not created yet** (design phase only).

---

## 11. Build order reminder for agents

When implementing HTML, run phases **sequentially**:

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12`

After each phase, pause for human review. Do not skip ahead to wire data or JS business logic.

---

*Last updated: 2026-06-03 — Static UX complete (Phases 0–12). Wiring plan not started.*
