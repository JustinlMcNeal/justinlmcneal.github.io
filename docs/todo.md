# Karry Kraze — Site TODO

## Checkout & Orders

- [ ] **Native site checkout form (full control)**
  - Validate shipping address
  - Store order in Supabase
  - Pass to Stripe Checkout
  - Create order record on success
- [ ] **Checkout order summary page** — order validation and confirmation info display
- [ ] **Implement Shippo** into the order fulfillment system
- [x] **Fix eBay & Amazon order imports** — correct data mapping with SKU_MAP; variant extraction working

---

## Customer Experience

- [x] **Add to cart animation** — smooth feedback on mobile and desktop

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### Current System (how it works today)

  | Layer | What happens | Key selectors |
  |-------|-------------|---------------|
  | **Product page** | User clicks `#btnAddToCart` → `buildCartPayload()` → dispatches `kk:addToCart` event | `js/product/cart.js`, `js/product/index.js` |
  | **Navbar listener** | `navbar.js` catches `kk:addToCart` → calls `cartStore.addToCart()` | `js/shared/navbar.js` |
  | **Cart store** | Adds/merges item in array → `saveCart()` writes to localStorage → dispatches `kk-cart-updated` event | `js/shared/cartStore.js` |
  | **Desktop badge** | `cartUI.js` listens for `kk-cart-updated` → updates all `[data-kk-cart-count]` elements with new total | `page_inserts/navbar.html` |
  | **Mobile badge** | `mobileNav.js` listens for `kk-cart-updated` → updates `#kkMobileCartCount` | `js/shared/mobileNav.js` |

  **Right now the badge count just changes text — no visual feedback that something happened.**

  #### What we'll add

  1. **CSS keyframe animations** (in `css/theme/components.css`)
     - `@keyframes kk-cart-bump` — a quick scale-up + bounce on the badge (e.g., scale 1 → 1.4 → 1)
     - `@keyframes kk-cart-wiggle` — subtle rotation wiggle on the cart icon/button itself
     - A utility class `.kk-cart-animate` that applies both animations (~400ms)

  2. **Desktop badge animation** (in `js/shared/cart/cartUI.js`)
     - After updating `[data-kk-cart-count]` text, add `.kk-cart-animate` to the badge **and** the parent `[data-kk-open="cart"]` button
     - Remove the class on `animationend` so it can re-trigger on the next add

  3. **Mobile badge animation** (in `js/shared/mobileNav.js`)
     - After updating `#kkMobileCartCount` text, add `.kk-cart-animate` to the count badge **and** the `#kkMobileCartBtn` button
     - Same `animationend` cleanup

  4. **Catalog "Add to Cart" entry point** (if any quick-add exists on catalog cards)
     - Same event flow already dispatches `kk-cart-updated`, so it gets the animation for free

  #### Files touched

  | File | Change |
  |------|--------|
  | `css/theme/components.css` | Add `@keyframes kk-cart-bump`, `@keyframes kk-cart-wiggle`, `.kk-cart-animate` class |
  | `js/shared/cart/cartUI.js` | After badge text update → add animation class + `animationend` listener |
  | `js/shared/mobileNav.js` | After badge text update → add animation class + `animationend` listener |

  #### Why this approach

  - **Zero new dependencies** — pure CSS keyframes + one JS class toggle
  - **Works on both navs** — desktop `[data-kk-cart-count]` and mobile `#kkMobileCartCount` both get animated
  - **Self-cleaning** — `animationend` removes the class so repeated adds always re-trigger
  - **Hooks into existing events** — rides on the `kk-cart-updated` event that already fires, no new wiring needed

  </details>

- [x] **Share button on product pages** — native share for iMessage, Discord, etc. with OG image embed
- [ ] **Referral share link** — sharer gets a unique link; referee gets 5% off at checkout; sharer earns 10% off when the referee completes a purchase
- [x] **Catalog search on mobile** — iOS auto-zoom fixed (16px base font), predictive dropdown removed

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### Problem

  1. **Auto-zoom on focus** — iOS Safari auto-zooms the page when the user taps the search input because its `font-size` is below 16px. This shifts the entire viewport and is jarring.
  2. **Redundant predictive dropdown** — A `#predictiveResults` dropdown appears with up to 5 matching product links, but the catalog grid already live-filters as the user types. The dropdown just covers the results the user is already seeing.

  #### Current System

  | Piece | What it does | Location |
  |-------|-------------|----------|
  | `#catalogSearch` input | `type="search"`, font-size ~12px via Tailwind `text-xs` | `pages/catalog.html` |
  | `#predictiveResults` div | Absolutely-positioned dropdown, shows top 5 matches with thumbnails | `pages/catalog.html` |
  | Predictive JS | On `input` event: filters `allProducts`, renders matches into `#predictiveResults`, AND calls `resetAndRenderGrid()` | `js/catalog/index.js` (~line 488–540) |
  | Grid filtering | `filterProducts()` already uses `els.search.value` to filter the entire catalog grid in real-time | `js/catalog/index.js` (~line 183) |

  #### Fix

  1. **Prevent iOS auto-zoom** — Add a CSS rule in `css/theme/components.css` that sets `font-size: 16px` on `#catalogSearch` at mobile breakpoints. 16px is the threshold below which iOS Safari triggers auto-zoom. Adjust the Tailwind classes on the input so desktop stays at the current smaller size.

  2. **Remove predictive dropdown** — In `js/catalog/index.js`, strip out the entire predictive search block (~lines 488–540): the `els.search input` listener that renders into `els.predictive`, the click-outside listener, and the focus listener. Replace with a simple input listener that just calls `resetAndRenderGrid()`. Optionally hide or remove the `#predictiveResults` div in the HTML.

  #### Files touched

  | File | Change |
  |------|--------|
  | `css/theme/components.css` | Add `@media (max-width: 767px) { #catalogSearch { font-size: 16px; } }` |
  | `js/catalog/index.js` | Remove predictive dropdown rendering; keep only `resetAndRenderGrid()` on input |
  | `pages/catalog.html` | Remove or hide `#predictiveResults` div |

  </details>
- [x] **Product size/variant support** — size/color variants fully supported via `renderVariantSwatches()`
- [ ] **Revamp Reviews page** — split into two pages: one for browsing reviews, one for leaving a review
- [x] **Homepage banner** — dynamic carousel with multiple promotions, countdowns, infinite scroll

---

## Admin

- [ ] **Access admin pages via mobile/app** — ensure admin routes work on phone
- [x] **Product search bar fix** — the ✕ clear button in the admin product search is broken
- [x] **Expense report duplicate prevention** — detect and block duplicate entries on import

  <details>
  <summary><strong>Root Cause & Fix</strong></summary>

  #### Root Cause

  Both `findExistingAmazonExpenses` and `findExistingEbayExpenses` queried the `description` column looking for ref IDs like `amz_sub_2026-02-16`. But those ref IDs are stored in the `notes` column (e.g., `Ref: amz_sub_2026-02-16`), not in `description`. The check always returned empty → every re-import inserted fresh rows without skipping existing ones.

  #### Fixes

  | File | Change |
  |------|--------|
  | `js/admin/expenses/importAmazonTxn.js` | `findExistingAmazonExpenses` — search `notes` column instead of `description` |
  | `js/admin/expenses/importEbayTransactions.js` | `findExistingEbayExpenses` — same fix |
  | `pages/admin/expenses.html` | Fix overlapping magnifier/clear icons (same issue as products search bar) |
  | `js/admin/expenses/dom.js` | Wire up custom clear button for `#searchExpense` |
  | `supabase/migrations/20260416_dedupe_auto_imported_expenses.sql` | Delete existing duplicate auto-imported rows, keeping earliest insert per unique `notes` ref |

  #### DB Cleanup (ran 2026-04-16)

  - Audited 13 auto-imported rows — no exact duplicates existed in eBay data
  - Found 1 phantom Amazon row: `amz_selling_fees_2026-03` at $14.78 (stale re-import). Correct value is $8.80 matching actual March 2026 orders — deleted via CLI

  </details>
- [x] **Expenses page sorting & filtering** — add vendor filter, date range filter, and spending breakdown charts

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### What already exists

  | Feature | Status |
  |---------|--------|
  | Search (description, vendor, category, notes) | ✅ done |
  | Category filter dropdown | ✅ done |
  | Sort (date, amount, category) | ✅ done |
  | KPI cards (total, this month, count, top category) | ✅ done |
  | Pagination / load more | ✅ done |
  | **Vendor filter** | ❌ missing |
  | **Date range filter (from / to)** | ❌ missing |
  | **Spending by category chart** | ❌ missing |
  | **Spending over time chart** | ❌ missing |
  | **Platform breakdown** (Amazon vs eBay vs manual) | ❌ missing |

  #### What we'll add

  **1. Vendor filter dropdown** (`pages/admin/expenses.html` + `api.js`)
  - Add a `<select id="filterVendor">` in the filter bar, dynamically populated from the `vendor` values in the DB (query distinct vendors on load)
  - Pass `vendor` to `getExpensesList()` → add `.eq("vendor", vendor)` to the Supabase query

  **2. Date range filter** (`pages/admin/expenses.html` + `api.js`)
  - Add two `<input type="date">` fields: `#filterDateFrom` and `#filterDateTo`
  - Pass to `getExpensesList()` → add `.gte("expense_date", from)` / `.lte("expense_date", to)` filters

  **3. Spending charts** (new file `js/admin/expenses/charts.js`)
  - Use **Chart.js via CDN** (no build step needed) — `<script src="https://cdn.jsdelivr.net/npm/chart.js">` in the HTML
  - Add a collapsible charts panel above the table with two charts:

    | Chart | Type | Data source |
    |-------|------|-------------|
    | **Spending by Category** | Doughnut | Aggregate `amount_cents` grouped by `category` from current filtered set |
    | **Spending Over Time** | Bar (monthly) | Aggregate `amount_cents` grouped by `YYYY-MM` from current filtered set |

  - Charts respond to the current filter state — when you change category/vendor/date range, the charts update the same as the table
  - A separate RPC or client-side aggregation of the already-fetched rows can power the charts (no extra DB round trip for the visible set)

  **4. Platform breakdown KPI** (`pages/admin/expenses.html`)
  - Add a "By Platform" row under the existing KPI cards: Amazon total | eBay total | Manual total
  - Queried by matching `vendor` = "Amazon" / "eBay" / everything else

  #### Files touched

  | File | Change |
  |------|--------|
  | `pages/admin/expenses.html` | Add vendor filter, date range inputs, Chart.js CDN, charts panel HTML |
  | `js/admin/expenses/api.js` | Add `vendor` and `dateFrom`/`dateTo` params to `getExpensesList()` + new `getExpenseChartData()` function |
  | `js/admin/expenses/charts.js` | New file — `initCharts()`, `updateCharts(rows)` using Chart.js |
  | `js/admin/expenses/dom.js` | Wire new filter inputs to `onFilterVendor`, `onFilterDateFrom`, `onFilterDateTo` handlers |
  | `js/admin/expenses/index.js` | Populate vendor dropdown on load, pass new filter state, call `updateCharts()` after each load |

  </details>

- [x] **Expense vendor deduplication** — audited all vendor names, merged typos/variants directly in DB (Baestao/Baestoa → Basetao, Twillio → Twilio, Godaddy.com → GoDaddy, Georgia Corporations Division → GA Secretary of State, Office Depot / Walmart → Office Depot)

---

## Social Media — Full Revamp

> **Detailed plan**: [`docs/pSocial/pSocial_001.md`](pSocial/pSocial_001.md)  
> **Core rule**: Fix analytics BEFORE building data-driven autopilot — bad data = bad automation

### Sprint 1: Fix + Clean
- [x] **Fix post analytics / insights sync** — insights sync working, `instagram_media_id` saved, edge function write-back fixed
- [x] **Fix autopilot cron not running** — pg_cron job recreated, `variation_id` constraint fixed, autopilot running daily
- [x] **Remove AI Images tab** — removed from UI, `imagePipeline.js` deleted
- [x] **Hide Templates tab** — hidden from UI, DB/JS retained as fallback

### Sprint 2: Image Pool
- [x] **Remove Queue tab** — merged into Calendar as list-view toggle
- [x] **Revamp Assets → Image Pool** — drag & drop upload, unused-first sorting, used/unused filter, tagging modal
- [x] **Add image tagging v1** — `shot_type` + `product_id` tagging implemented

### Sprint 3: Autopilot Upgrade
- [x] **Add product priority scoring** — recency (40%) + category performance (30%) + fresh images (20%) + reserved (10%)
- [x] **Make autopilot data-driven** — Image Pool integration, `posting_time_performance` scheduling, hybrid AI captions with template fallback
- [x] **Automate resurface old hits** — auto-reposts top content 30+ days old at ~1:4 ratio with fresh AI captions
- [x] **Close learning loop (Sprint 3.5)** — persist deep analysis, automate learning aggregation in autopilot, track `autopilot_last_run`

### Sprint 4: Smart Features
- [ ] **Smart carousel assembly** — AI auto-picks 3-5 images with diverse `shot_type` tags from Image Pool
- [ ] **Analytics polish** — fix hardcoded scores in learning engine, real engagement velocity, "What's Working" summary card
- [ ] **v2 tagging** — add mood + platform preference tags if data validates v1 approach

---

## SMS / Notifications

- [ ] **Twilio setup** — integrate Twilio for SMS notifications (order updates, marketing)
