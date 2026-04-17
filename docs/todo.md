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
- [x] **Revamp Reviews page** — split into two pages: one for browsing reviews, one for leaving a review + SMS review requests post-delivery

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### Problem

  The current `pages/reviews.html` has two jobs crammed into one page:
  1. **Leave a review** — 4-step flow (enter email + order# → pick product → write review → get coupon)
  2. **Browse reviews** — approved reviews feed with star filter buttons

  These serve different audiences. A customer who just bought something wants to leave a review quickly. A potential customer browsing the site wants social proof — a beautiful, dedicated page showcasing what people think. Combining them dilutes both experiences.

  Additionally, the current flow requires users to manually enter their email and order number to find their order. SMS review requests can eliminate this friction entirely by sending a direct link with the order session ID pre-embedded.

  > **Audit Score: 10 / 10** — This is the second loop system:
  > `Buy → SMS → Review → Coupon → Buy Again`
  > When both the content loop and the review loop are running, you have: UGC, social proof, repeat purchases, and automated growth loops.
  > Later: Reviews (photos) → Image Pool → Autopilot → Better Posts → More Sales → More Reviews — a full growth flywheel.

  #### Architecture: 2 Pages + 1 SMS Flow

  **Page 1: `pages/reviews.html` (Browse Reviews — public showcase)**
  - Hero section: Overall store rating (avg stars, total count), trust badges
  - Photo mosaic/gallery strip at top — **only reviews with photos** (`WHERE photo_url IS NOT NULL`), keeps the top section clean and high-quality
  - Filter bar: star rating buttons (All, 5★, 4★, etc.) + sort (newest, highest, lowest) + search by product name
  - Review cards: larger format, product thumbnail + name, stars, date, reviewer first name, title, body, photo with lightbox
  - "✓ Verified Purchase" badge on every order-verified review
  - Infinite scroll or "Load More" pagination
  - CTA banner at bottom: "Love your purchase? Leave a review!" → links to leave-review page
  - No review form on this page — purely a social proof showcase
  - SEO: aggregate rating structured data (schema.org)

  **Page 2: `pages/leave-review.html` (Submit a Review)**
  - **Two entry modes:**
    - **Manual entry** (existing flow): email + order number → verify → pick product → review form → coupon
    - **SMS deep link** (new): URL like `leave-review.html?token=xxx` → auto-loads order + product, skips Steps 1-2 entirely
  - Same 4-step UI but Step 1 shows "Welcome back, {name}!" when token is present
  - Same submit-review edge function, same coupon system — no backend changes needed for the form itself
  - **Review quality control:** min 20 characters for review body, title encouraged but optional
  - **Photo prompt:** after text fields, show "Add a photo? (optional)" with clear upload CTA — feeds the browse page gallery + future content engine

  **SMS Review Request Flow (new):**
  - After a customer's order is delivered (or X days after purchase), send an SMS:
    > "Hey {first_name}! How's your {product_name}? Leave a review & get {discount}% off your next order → {link}"
  - The link is `https://karrykraze.com/pages/leave-review.html?token={signed_token}`
  - The token is a JWT (signed with a **dedicated secret**, NOT the Supabase anon/service key) containing: `{ order_session_id, product_id, email, exp }`
  - Token expires after 30 days — enough time to try the product
  - Edge function `send-review-request` generates the JWT, builds SMS body, sends via Twilio
  - Cron job or manual trigger: runs X days after order, checks `orders_raw` for delivered orders that haven't been review-requested yet
  - **Dynamic delay from DB:** normal items → 7 days, MTO items (`shipping_status = 'mto'`) → 14 days, configurable via `review_settings`

  #### Token Design (skip-the-lookup magic)

  ```
  JWT payload:
  {
    "oid": "cs_live_abc123",     // order_session_id
    "pid": "uuid-of-product",    // product_id
    "email": "buyer@email.com",  // for verification
    "exp": 1720000000            // 30-day expiry
  }
  ```

  **Security:**
  - Signed with a dedicated `REVIEW_TOKEN_SECRET` (set via `supabase secrets set`), never the Supabase keys
  - Only the hash of the token is stored in `review_requests.token_hash` — raw token is never persisted
  - Edge function verifies signature + expiry before returning any data

  **Frontend flow:**
  - Token present → sends to `verify-review-token` edge function
  - Edge function verifies JWT → returns order + product data (same shape as `verify-order`)
  - Edge function updates `review_requests.clicked_at` on successful verification — tracks SMS→click conversion explicitly
  - Frontend skips Steps 1-2, pre-fills product selection, lands on Step 3 (review form)
  - **Graceful expiry UX:** if token is expired or invalid → show "This link has expired, but you can still leave a review below!" and fall back to manual entry (keeps conversion alive)
  - **Already reviewed protection (strict):** if `(order_session_id, product_id)` already has a review → show the existing review + coupon code, disable the form entirely — prevents duplicate reviews and coupon abuse

  #### New Edge Functions

  | Function | Purpose |
  |----------|---------|
  | `verify-review-token` | Verify JWT (dedicated secret), return order + product data, check if already reviewed, return existing coupon if so, update `clicked_at` on `review_requests` for funnel tracking |
  | `send-review-request` | Generate JWT, build SMS body, send via Twilio, log to `sms_sends` with flow=`review_request`, insert `review_requests` row |

  #### Database Changes

  | Change | Details |
  |--------|---------|
  | `review_requests` table (new) | `id`, `order_session_id`, `product_id`, `phone`, `token_hash`, `sent_at`, `clicked_at`, `reviewed_at`, `status` (sent/clicked/completed/expired) — tracks the full SMS→click→review funnel |
  | `review_requests` constraint | `UNIQUE(order_session_id, product_id)` — enforced at DB level, prevents duplicate SMS sends even if cron bugs out or manual trigger is hit twice |
  | `review_settings` update | Add `sms_request_delay_days` (default: 7), `sms_mto_delay_days` (default: 14), `sms_request_enabled` (boolean) |

  #### Cron Trigger Options

  - **Option A: Supabase Cron** — `pg_cron` job runs daily, queries orders from X days ago that have SMS-subscribed customers + no existing review request → calls `send-review-request` edge function
  - **Option B: Manual from admin** — Button on admin reviews page: "Send review requests for recent orders" — more control, less automation overhead
  - **Recommended: Start with Option B**, graduate to Option A once confident in the flow

  #### Files Touched

  | File | Change |
  |------|--------|
  | `pages/reviews.html` | Strip review form, rebuild as showcase page (hero, photo gallery, filter bar, review cards, infinite scroll, verified purchase badges) |
  | `pages/leave-review.html` | **New page** — move review form here, add token-based auto-load logic, graceful expiry fallback, already-reviewed guard, min 20-char validation, photo prompt |
  | `js/reviews/index.js` | Refactor: split into `js/reviews/browse.js` (showcase) + `js/reviews/leave.js` (form) |
  | `js/reviews/browse.js` | **New** — load approved reviews, star filter, search, sort, infinite scroll, photo gallery |
  | `js/reviews/leave.js` | **New** — existing form logic + token detection (`URLSearchParams`), auto-load via `verify-review-token`, graceful fallback on expiry, already-reviewed display |
  | `supabase/functions/verify-review-token/index.ts` | **New** — JWT verify (dedicated secret), return order+product data, check if already reviewed + return existing coupon |
  | `supabase/functions/send-review-request/index.ts` | **New** — generate JWT (dedicated secret), build SMS, send via Twilio, log to `sms_sends` + insert `review_requests` |
  | `supabase/migrations/xxx_review_requests.sql` | **New** — `review_requests` table + UNIQUE constraint + indexes |
  | `js/admin/reviews/index.js` | Add "Send Review Requests" button for manual trigger |
  | `js/product/reviewSection.js` | Update "Leave a review" CTA link → `leave-review.html` |
  | `js/home/reviewsCarousel.js` | Update "See all reviews" link → `reviews.html` (no change if already correct) |
  | `page_inserts/footer.html` | Ensure reviews link points to browse page |
  | `supabase/config.toml` | Add new edge functions with `verify_jwt = false` for `verify-review-token` |

  #### Safeguards (from audit)

  1. **Already-reviewed protection** — Strict: if review exists for `(order_session_id, product_id)`, show existing review + coupon, disable form. Prevents duplicate reviews and coupon abuse.
  2. **SMS rate limiting** — `UNIQUE(order_session_id, product_id)` on `review_requests` table enforced at DB level. Prevents double sends from cron bugs or accidental re-triggers.
  3. **Token security** — Signed with a dedicated `REVIEW_TOKEN_SECRET`, not Supabase keys. Only `token_hash` stored in DB, never the raw token.
  4. **Graceful expiry UX** — Expired token shows "This link has expired, but you can still leave a review below!" and falls back to manual entry. Keeps conversion alive instead of dead-ending.
  5. **Review quality control** — Min 20 characters for review body. Title encouraged but optional. Prevents low-quality spam that weakens social proof.
  6. **SMS timing safety** — Dynamic delay from DB: 7 days normal, 14 days MTO. Max 1 SMS per product per order. Max 3 products per order. Prevents annoying customers.
  7. **Coupon cooldown** — Max 1 review coupon per order, even if multiple products are reviewed. `submit-review` checks if any coupon already issued for that `order_session_id` before generating a new one. Prevents coupon farming.
  8. **Click tracking** — `verify-review-token` updates `review_requests.clicked_at` on first verification. Full funnel is measurable: SMS sent → clicked → reviewed → completed.
  9. **Review visibility control** — Reviews use existing `status` field (pending/approved/rejected). Even with auto-approve enabled, the moderation layer is always present for future control.
  10. **Photo-only gallery** — Browse page photo mosaic only includes reviews where `photo_url IS NOT NULL`. Keeps the hero section clean and high-quality.

  #### Recommendations

  1. **Photo-first showcase** — Review photos sell more than text. The browse page should lead with a photo mosaic/strip. Customers trust photos from real buyers.
  2. **Product-specific filtering** — Add a product name search/filter on the browse page so potential buyers can find reviews for the exact item they're considering.
  3. **Verified Purchase badge** — Show a "✓ Verified Purchase" badge on reviews that came through the order-verified flow (which is all of them right now, but good to display).
  4. **One product per SMS** — Send one SMS per product in the order (up to 3 max). Each gets its own review link. Don't overwhelm with a single "review your order" link — it's easier to review one item at a time.
  5. **SMS ↔ Review coupon stacking** — The SMS brings them in, the review coupon rewards them. It's a double incentive loop: subscribe → buy → review → coupon → buy again → review again.
  6. **Review → Content Engine bridge (future)** — Best review photos can feed into social autopilot Image Pool. Connects UGC pipeline to content system.

  #### Execution Order

  1. Create `pages/leave-review.html` + `js/reviews/leave.js` (move existing form, add quality controls + photo prompt)
  2. Rebuild `pages/reviews.html` + `js/reviews/browse.js` (showcase page with photo gallery + verified badges)
  3. Update all CTAs/links across the site
  4. Build + deploy `verify-review-token` edge function (dedicated signing secret)
  5. Build + deploy `send-review-request` edge function
  6. Create `review_requests` migration + push (UNIQUE constraint)
  7. Set `REVIEW_TOKEN_SECRET` via `supabase secrets set`
  8. Add admin trigger button
  9. Test full flow: manual → SMS → token → review → coupon
  10. Set up cron (Phase 2, after manual trigger is proven)

  </details>
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
