# Karry Kraze — Site TODO

## Checkout & Orders

- [x] **Checkout review page** — on-site order review before Stripe payment

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### Current Flow
  Cart drawer → clicks "Checkout" → `create-checkout-session` edge function → redirect to Stripe Hosted Checkout → `stripe-webhook` saves order → `success.html`

  #### New Flow
  Cart drawer → clicks "Checkout" → **`checkout.html` (new review page)** → clicks "Proceed to Payment" → `create-checkout-session` → Stripe → webhook → `success.html`

  #### What the page shows

  **Header**
  - Breadcrumb: Home → Cart → Checkout
  - Step indicator: Cart ✓ → Review (current) → Payment

  **Order Review Section (left/main column)**
  - Each cart item as a card:
    - Product image (thumbnail)
    - Product name (links back to product page)
    - Variant (if any) — e.g. "Size: L / Color: Black"
    - Unit price (original + discounted if promo applies)
    - Quantity selector (± buttons, same as cart drawer)
    - Remove button (trash icon)
    - Line total
  - Empty state: "Your cart is empty" with "Continue Shopping" CTA → catalog page

  **Coupon / Promo Section**
  - Coupon code input + "Apply" button (reuses existing `couponManager` + `promoCoupons`)
  - Active promo badges: auto-applied promotions shown as green badges (e.g. "🏷️ 20% off Jewelry")
  - Applied coupon shown with remove button
  - BOGO indicator if active

  **Order Summary Sidebar (right column / bottom on mobile)**
  - Subtotal (before discounts)
  - Auto promo discount line (if any) — e.g. "−$4.00 (20% off Jewelry)"
  - Coupon discount line (if any) — e.g. "−$5.00 (THANKS-ABCDE)"
  - Shipping estimate: Free (if over threshold or free_shipping coupon), else Standard $5.99 / Express $12.99
  - Free shipping progress bar (reuse `freeShippingBar` logic)
  - **Order Total** (bold, large)
  - "Proceed to Payment" button (primary CTA, full-width)
  - "Continue Shopping" link below
  - Trust badges row: 🔒 Secure Checkout | 📦 Free Shipping $50+ | ↩️ Easy Returns
  - Accepted payment icons: Visa, MC, Amex, Apple Pay, Google Pay (Stripe handles these)

  **Cross-sell Section (below items)**
  - "Recently Bought Together" — products from same category or frequently paired items
  - Clickable from "$X away from free shipping" message → scrolls here
  - Reuses existing recommendation logic from `cartRecommendations.js`

  **Conversion Boosters (throughout page)**
  - **Friction reducers** under CTA: ✔ Free returns · ✔ Ships in 2–5 days · ✔ 4.8★ from 200+ customers
  - **Estimated delivery**: "Arrives by: Apr 22–25" (calculated from current date + 5–8 business days)
  - **Low stock indicator**: "Only 3 left!" badge on items where `stock < threshold` (fetched from `product_variants`)
  - **"$X away from free shipping"** dynamic message in summary — clickable, scrolls to recommendations
  - **"Secured by Stripe"** trust badge with Stripe logo — real trust, not generic lock icon
  - **Cart snapshot before payment**: save `{ items, totals, coupon_used, timestamp }` to localStorage before Stripe call — debugging, analytics, abandoned cart recovery
  - **Exit intent tracking**: on `beforeunload` if user hasn't checked out → save `last_checkout_viewed_at` to localStorage for abandoned cart signals

  #### Architecture

  | File | Purpose |
  |------|---------|
  | `pages/checkout.html` | **New** — checkout review page HTML (Tailwind, consistent with site theme) |
  | `js/checkout/index.js` | **New** — entry point: load cart, render items, wire controls, handle checkout CTA, exit intent |
  | `js/checkout/renderItems.js` | **New** — render cart items as review cards with qty controls + remove + low stock badge |
  | `js/checkout/summary.js` | **New** — order totals sidebar, promo/coupon lines, shipping estimate, delivery date, free shipping bar |
  | `js/checkout/recommendations.js` | **New** — "Recently Bought Together" product cards |
  | `css/pages/checkout.css` | **New** — checkout-specific styles (responsive 2-column layout) |

  #### What we reuse (no changes needed)

  | Module | What it gives us |
  |--------|-----------------|
  | `cartStore.js` | `getCart()`, `setQty()`, `removeItem()`, `clearCart()`, `cartSubtotal()` |
  | `cartTotals.js` | `calculateCartTotals()` — all discount math (auto promos, BOGO, coupons) |
  | `couponManager.js` | `applyCoupon()`, `removeCoupon()`, `getAppliedCoupon()` |
  | `promoCoupons.js` | `validateCouponCode()` — server-side validation |
  | `promoFetch.js` | `fetchActivePromotions()` — loads current auto promos |
  | `freeShippingBar.js` | Free shipping threshold logic (from `site_settings`) |
  | `navbar.js` | Existing `[data-kk-checkout]` handler — move to checkout page JS |

  #### Checkout button behavior

  1. Cart drawer "Checkout" button → navigates to `checkout.html` (instead of calling Stripe directly)
  2. On `checkout.html`, "Proceed to Payment" button:
     - Saves cart snapshot to localStorage (items, totals, coupon — for debugging + abandoned cart)
     - Runs `calculateCartTotals()` + `buildCheckoutPromoPayload()`
     - Calls `create-checkout-session` edge function (same as current navbar handler)
     - Redirects to Stripe Hosted Checkout URL
     - Shows loading spinner on button during API call
     - Disables button to prevent double-clicks
  3. Empty cart check: if cart is empty on page load → redirect to catalog or show empty state

  #### Mobile layout

  - Single column: items stack vertically → summary section below
  - Summary becomes sticky bottom bar on scroll (total + "Proceed to Payment" always visible)
  - Coupon input above summary on mobile
  - Trust badges collapse to icons-only on small screens
  - Friction reducers stack vertically under CTA

  #### Edge cases

  - **Cart changes during review**: qty/remove updates recalculate totals in real-time
  - **Promo expires during review**: `calculateCartTotals()` re-fetches on checkout click, totals reflect latest
  - **Out of stock**: `create-checkout-session` already validates stock server-side → returns error → show toast
  - **Empty cart**: redirect to catalog with "Your cart is empty" toast
  - **Low stock fetch fail**: silently skip badges — don't block checkout
  - **Exit without purchase**: `beforeunload` saves `last_checkout_viewed_at` for abandoned cart signal

  #### Execution Order

  1. Create `pages/checkout.html` (page shell + Tailwind layout)
  2. Create `js/checkout/renderItems.js` (item cards with controls + low stock)
  3. Create `js/checkout/summary.js` (order summary + delivery estimate + free shipping nudge)
  4. Create `js/checkout/index.js` (entry point, wire everything, exit intent, cart snapshot)
  5. Create `css/pages/checkout.css` (responsive 2-column layout)
  6. Update cart drawer "Checkout" button → navigate to `checkout.html`
  7. Move Stripe checkout logic from `navbar.js` → `checkout/index.js`
  8. Add "Recently Bought Together" recommendations
  9. Test full flow: add items → cart → checkout page → Stripe → success

  </details>

- [x] **Implement Shippo** into the order fulfillment system — Phases 0-2 complete (label buying, tracking webhooks, SMS notifications). See [`docs/shippo/shippo_001.md`](shippo/shippo_001.md). Phase 3 (batch labels) next.
- [x] **Fix eBay & Amazon order imports** — correct data mapping with SKU_MAP; variant extraction working

---

## Customer Experience

- [x] **Add to cart animation** — CSS keyframes (`kk-cart-bump`, `kk-cart-wiggle`) + `.kk-cart-animate` in `components.css`, JS toggle in `cartUI.js` + `mobileNav.js`

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

  <details>
  <summary><strong>Implementation Details (completed)</strong></summary>

  #### What was built

  - **Share button** on product pages using Web Share API (native share sheet on mobile) with clipboard fallback on desktop
  - **Share links** at `karrykraze.com/s/{slug}` — short, clean URLs for sharing
  - **Rich previews** (OG meta tags) — product image, title, price shown in iMessage, Discord, Twitter, Facebook previews
  - **Cloudflare Worker** (`share-proxy`) proxies `/s/{slug}` requests to Supabase `share-product` edge function, fixes `Content-Type: text/html` (Supabase gateway forces `text/plain`)
  - **Auto-redirect** — bots get OG tags, humans get `<meta http-equiv="refresh">` + `window.location.replace()` redirect to product page
  - **404.html fallback** — JS redirect for `/s/` paths in case Worker isn't hit

  #### Files

  | File | Purpose |
  |------|---------|
  | `supabase/functions/share-product/index.ts` | Edge function: looks up product by slug, returns HTML with OG tags |
  | `cloudflare-worker/share-proxy/index.js` | Cloudflare Worker: proxies to Supabase, sets correct Content-Type |
  | `cloudflare-worker/share-proxy/wrangler.toml` | Worker config: route `karrykraze.com/s/*` |
  | `js/product/render.js` | Share button UI + Web Share API / clipboard fallback |
  | `404.html` | JS fallback redirect for `/s/` paths |

  #### Key decisions

  - Supabase edge functions gateway forces `Content-Type: text/plain` regardless of function response → solved with Cloudflare Worker proxy
  - OG image dimensions set to 1200×630 to match Apple/iMessage requirements (same as working SMS signup page)
  - Direct Supabase storage image URLs (no proxy or transforms needed)

  </details>
- [ ] **Referral share link** — sharer gets a unique link; referee gets 5% off at checkout; sharer earns 10% off when the referee completes a purchase *(back burner — low priority for now)*
- [x] **Catalog search on mobile** — predictive dropdown removed, iOS auto-zoom fixed (`font-size: 16px` on `#catalogSearch` at mobile breakpoint in `components.css`)
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

- [x] **Access admin pages via mobile/app** — all admin pages have viewport meta tags, Tailwind responsive utilities (`sm:px-6`, `max-w-7xl`), iOS-safe 16px input focus, and `@media (max-width: 640px)` touch target rules
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
  | **Vendor filter** | ✅ done |
  | **Date range filter (from / to)** | ✅ done |
  | **Spending by category chart** | ✅ done (doughnut chart via Chart.js v4 CDN) |
  | **Spending over time chart** | ✅ done (monthly bar/line chart) |
  | **Platform breakdown** (Amazon vs eBay vs manual) | ✅ done |

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
- [x] **Smart carousel assembly** — `shouldUseCarousel()` now checks Image Pool first (3+ images → 50% chance), then AI images; `resolveStorageUrl()` converts relative paths to full public URLs; diversity guard ensures shot type variety
- [x] **Analytics polish** — learning insights dashboard built in `analytics.js` with engagement metrics, time charts, tone charts
- [ ] **v2 tagging** — add mood + platform preference tags if data validates v1 approach (current: shot_type + quality_score only)

### Phase 1: Wire the Learning Loop (pSocial_002)
> **Detailed plan**: [`docs/pSocial/pSocial_002.md`](pSocial/pSocial_002.md)

#### Phase 1A — Hashtags + Posting Times
- [x] **Smart hashtag injection** — `hashtag_performance` → auto-queue merge (learned winners first) — `82ed931`
- [x] **Posting time optimization** — threshold 20→10, learned timing priors fallback — `82ed931`

#### Phase 1B — AI Captions + Learning Trigger
- [x] **AI captions in auto-queue** — calls `ai-generate`, template fallback, `caption_source` tracking — `838cb72`
- [x] **Auto-refine after insights** — `instagram-insights` triggers `learning_only` aggregation every 6h — `838cb72`

#### Phase 1C — Tracking + Trust Fix
- [x] **UTM tracking** — all social post links include `utm_source/medium/campaign/content` — `bbea7f2`
- [x] **Remove "Comment KK" CTA** — removed from all caption templates — `bbea7f2`
- [x] **Meta Pixel** — installed on all 14 public pages (Pixel ID: 2162145877936737) with ViewContent/AddToCart/InitiateCheckout/Purchase events — `995db2c`

#### Infrastructure Fixes
- [x] **Cloudflare 503 caching** — cache rule (no-cache on 500-503), SW v4 pre-cache + retry — `3040847`, `8d96e5d`
- [x] **Autopilot pipeline fix** — verify_jwt=false for auto-queue/autopilot-fill, image_source constraint (added ai_carousel/resurface/image_pool), error diagnostics — `b55c93c`
- [x] **Image pool duplicate cleanup** — 30 duplicate `social_assets` entries soft-deleted, unique partial index `uq_social_assets_active_path` on `(original_image_path) WHERE is_active = true`, `createAsset()` handles constraint error 23505 — `09e4a4b`
- [x] **Relative storage URL fix** — `process-scheduled-posts` and `auto-queue` now resolve relative `originals/...` paths to full public Supabase URLs; fixed Instagram Graph API error "Only photo or video can be accepted as media type" — `a7dd43f`
- [x] **Calendar carousel indicator** — post pills show 🎠 badge + [CAROUSEL] tooltip for carousel posts — `a7dd43f`
- [x] **Autopilot over-posting fix** — auto-queue deficit calculation doesn't enforce per-day limits; manually rebalanced Sunday (4→2 posts) and moved extras to Monday — `a7dd43f`

#### Observation Window (April 18 – April 25+)
- [ ] **7-day observation** — no logic changes, let data accumulate
- [ ] **Phase 1 success check** — engagement ↑20%, reach ↑30%, or top hashtags repeating → greenlight Phase 2
- [x] **Fix category labels** — `hashtag_performance` now uses variation→asset→product→category chain; categories properly labeled (accessories, headwear, jewelry, plushies, bags) — `a11d224`

### Phase 2: Reach Multiplier (after observation)
- [ ] **Engagement dashboard** — comment reply UI + "Go Engage" guidance (Sprint 6.1)
- [ ] **Instagram Stories** — auto-generate stories from posts or AI-selected content; story scheduling via API (Sprint 6.3)
- [ ] **Growth tracking** — daily follower count + best-time heat map (Sprint 7)
- [ ] **Simple Reels** — on hold until affordable AI video generation is viable; Ken Burns on static images not compelling enough vs real product videos. Revisit when store revenue supports AI video costs (Sprint 5.1)
- [ ] **Reels API posting** — `instagram-reel` edge function + `content_type` column; depends on Reels content solution above (Sprint 5.3)

---

## SMS / Notifications

- [x] **Twilio integration** — fully integrated: `sms-subscribe`, `send-sms`, `twilio-webhook`, `sms-abandoned-cart`, `sms-coupon-reminder`, `sms-welcome-series` edge functions all live
- [x] **Abandoned cart CRON** — `sms-abandoned-cart-check` runs every 5 minutes, detects incomplete carts, sends SMS via Twilio
- [x] **Coupon reminder CRON** — `sms-coupon-reminder` runs hourly at :30, sends reminders during 9 AM–9 PM ET window
- [x] **Welcome series CRON** — `sms-welcome-series` runs hourly at :45, sends Day 2 + Day 5 onboarding SMS
- [ ] **Order shipped SMS + package insert QR code** — when an order ships, send SMS: "Hey {name}, your order is on the way! Track it here: {tracking_url} — We left a little something special in your package 💜". The "something special" is a **package insert card** with a QR code linking to `leave-review.html?token={signed_token}`. QR code is unique per order, tracks scans for conversion metrics.
  - SMS trigger: `shippo-webhook` on TRANSIT status → send via Twilio (reuse `send-sms` edge function)
  - QR code generation: edge function generates QR code image (PNG) with embedded review token URL
  - QR tracking: `package_insert_qr` table — `id`, `order_session_id`, `product_id`, `qr_url`, `token_hash`, `created_at`, `scanned_at`, `reviewed_at`, `scan_count` — tracks scan → review funnel
  - Package insert design: printable card template (PDF or HTML) with QR code, brand logo, review CTA text
  - Metrics dashboard: admin view showing QR scan rate, scan → review conversion, most-scanned products
  - Reuses existing `REVIEW_TOKEN_SECRET` JWT signing from review request system
- [ ] **Email notifications** — no email provider integrated yet (Resend.com or SendGrid). Currently SMS + push only *(on hold — revisit later)*

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### What we need
  Admin + customer email notifications for: review approval + coupon, order confirmations, shipping updates, abandoned cart (email supplement to SMS).

  #### Recommended approach
  1. **Provider**: [Resend.com](https://resend.com) — free tier (100 emails/day), simple REST API, built for transactional email
  2. **Edge function**: `send-email` — generic mailer edge function that accepts `{ to, subject, html, from? }`
  3. **Templates**: HTML email templates stored as string literals in edge function (no build step needed)
  4. **Integration points**:
     - `submit-review` → on approval, call `send-email` with coupon code
     - `stripe-webhook` → on `checkout.session.completed`, send order confirmation
     - `shippo-webhook` → on `TRANSIT`/`DELIVERED`, send shipping update
     - `sms-abandoned-cart` → add email fallback for non-SMS subscribers
  5. **DNS**: Add Resend DKIM/SPF records to `karrykraze.com` domain DNS
  6. **DB**: `email_sends` log table (to, subject, template, sent_at, status) for tracking delivery

  #### Files to create
  | File | Purpose |
  |------|---------|
  | `supabase/functions/send-email/index.ts` | Generic email sender via Resend API |
  | `supabase/migrations/xxx_email_sends.sql` | Email log table |

  #### Files to modify
  | File | Change |
  |------|--------|
  | `supabase/functions/submit-review/index.ts` | Call `send-email` on review approval |
  | `supabase/functions/stripe-webhook/index.ts` | Send order confirmation email |
  | `supabase/functions/shippo-webhook/index.ts` | Send shipping status email |

  </details>

---

## Inventory & Stock

> **On hold** — waiting for Amazon SP-API + eBay API to build a unified cross-platform inventory system (website + Amazon + eBay in one place). No point building website-only stock tracking when selling on 3 platforms.

- [ ] **Unified inventory tracking** — `product_variants.stock` column exists and admin populates it, but frontend/checkout validation not implemented. Full plan in [`docs/implementation/inventory-stock-tracking.md`](implementation/inventory-stock-tracking.md). Will expand to sync stock across all platforms once marketplace APIs are live.
  - [ ] Low stock badges on product page
  - [ ] Stock validation at checkout (prevent overselling)
  - [ ] Stock decrement on order completion
  - [ ] Admin inventory dashboard (unified: website + Amazon + eBay)
  - [ ] Stock ledger audit trail
  - [ ] Cross-platform stock sync (depends on Amazon SP-API + eBay API)

---

## PWA & Push Notifications

- [x] **PWA manifest** — `manifest.json` with 10 icon sizes + maskable variants, `display: standalone`, theme colors
- [x] **Service worker** — `sw.js` with network-first pages, cache-first images, stale-while-revalidate CSS/JS, offline fallback (`offline.html`), MAX_DYNAMIC=50, MAX_IMAGES=100
- [x] **"Add to Home Screen" banner** — auto-shows on eligible devices, dismissible install prompt
- [x] **Web push notifications** — VAPID keys, subscription flow via `js/shared/pwa.js`, soft permission prompt
- [x] **`send-push-notification` edge function** — sends to all/admin/customers, auto-cleans stale subscriptions
- [x] **Admin push on new order** — Stripe webhook fires push notification to admin devices (fire-and-forget)
- [x] **Admin push composer** — settings panel to send custom push notifications to all/admin/customers
- [x] **`push_subscriptions` table** — `is_admin`, `is_active`, `endpoint` columns, RLS policies for anon insert/delete
- [x] **PWA tags registered** — service worker + manifest link on all 34 HTML pages
- [ ] **Customer push for order shipped / review reminder** — extend existing push system to notify customers on shipment status changes + review reminders. `shippo-webhook` already catches DELIVERED status, `send-review-request` already sends SMS — need to wire: (1) push notification on TRANSIT/DELIVERED, (2) check if review request auto-triggers on delivery or only manual

---

## AI Content Pipeline

- [x] **AI image generation** — `generate-social-image` edge function: gpt-image-1 img2img (product photo reference) + DALL-E 3 text-to-image fallback
- [x] **Scene randomizer** — 18.9M combos (30 envs × 15 lighting × 12 comps × 14 moods × 25 props × 10 cameras), seasonal awareness (spring/summer/fall/winter pools, 60/40 weighted)
- [x] **Smart scheduling dedup** — SceneFingerprint (env/mood/camera), avoids last 5 scenes per product
- [x] **Quality scoring** — GPT-4o-mini Vision compares generated vs original: auto-approve 8+, review 5-7, reject <5
- [x] **Image blacklist** — `image_blacklist` table + admin UI, auto-queue checks blacklist before using supplier images
- [x] **Image review queue** — `social_generated_images` table with pending_review/approved/rejected workflow
- [x] **Carousel image sets** — generates 3-5 images with shared `carousel_set_id`, locked camera style, narrative composition flow (wide → hero → angled → close-up → held)
- [x] **Supplier image auto-import** — `import-product-images` edge function downloads external URLs to Supabase Storage, dedup, auto-updates product records, auto-fires on product save
- [x] **AI product fill** — `ai-product-fill` edge function uses GPT-4o Vision to analyze product images → descriptions, tags, titles
- [x] **Category-aware prompts** — all 6 product categories (accessories, headwear, bags, jewelry, plushies, lego) have tailored generation prompts
- [~] **Text/price overlay** — deferred (low priority promo post overlay generator)

---

## Marketplace Integrations

### Amazon SP-API
> **Status:** 🟡 Blocked — developer account created, identity verification failed, support ticket submitted (April 18, 2026). Currently CSV import only.

- [x] **CSV order import** — `import-amazon-orders.mjs` parses Seller Central TSV exports, `rpc_import_amazon_orders()` bulk-imports via JSON, admin drag-and-drop UI on expenses page
- [ ] **SP-API identity verification** — identity check failed, support ticket open. Waiting on Amazon resolution.
- [ ] **Auto-import orders** → unified order dashboard

  <details>
  <summary><strong>Implementation Plan (post-approval)</strong></summary>

  #### Prerequisites
  - Amazon Developer Account approved with SP-API access
  - LWA (Login With Amazon) OAuth credentials (Client ID + Secret)
  - IAM role ARN for cross-account access (if required by Amazon for self-authorized apps)

  #### OAuth Flow
  1. **Register self-authorized app** in Amazon Seller Central → Developer Console
  2. **Generate refresh token** via LWA OAuth (one-time; self-authorized apps get a permanent refresh token)
  3. **Store credentials** via `supabase secrets set`:
     - `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_SP_REFRESH_TOKEN`
     - `AMAZON_SELLER_ID` (for Reports API calls)

  #### Edge Functions to Build
  | Function | Purpose | SP-API Endpoint |
  |----------|---------|-----------------|
  | `amazon-refresh-token` | Exchange refresh token → access token (1h expiry) | `api.amazon.com/auth/o2/token` |
  | `amazon-sync-orders` | Pull orders from last 24h, upsert to `orders_raw` | `GET /orders/v0/orders` + `GET /orders/v0/orders/{id}/orderItems` |
  | `amazon-sync-catalog` | Pull product data + images | `GET /catalog/2022-04-01/items` |
  | `amazon-settlement-report` | Request + download settlement reports | `POST /reports/2021-06-30/reports` (type `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE`) |

  #### Data Flow
  ```
  CRON (daily 4 AM UTC)
    → amazon-sync-orders
      → LWA token refresh (if expired)
      → GET /orders/v0/orders?CreatedAfter=yesterday
      → For each order: GET /orders/v0/orders/{id}/orderItems
      → Map to orders_raw schema (order_session_id = Amazon Order ID)
      → Upsert to orders_raw + line_items
  ```

  #### Database Changes
  | Change | Details |
  |--------|---------|
  | `orders_raw.source` | Add `'amazon_api'` to distinguish from CSV imports (`'amazon'`) |
  | `marketplace_tokens` table (new) | `platform`, `access_token`, `refresh_token`, `expires_at` — reusable for eBay too |

  #### Key SP-API Constraints
  - Rate limits: Orders API = 1 req/sec burst, 1/30s sustained. Use exponential backoff.
  - Restricted data: PII (buyer name/address) requires Restricted Data Token (RDT) per request
  - Sandbox: SP-API has sandbox endpoints for testing (`sandbox.sellingpartnerapi-na.amazon.com`)
  - Region: NA endpoint = `sellingpartnerapi-na.amazon.com`

  #### CRON Setup
  ```sql
  SELECT cron.schedule('amazon-sync-orders-daily',
    '0 4 * * *',
    $$SELECT net.http_post(
      url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/amazon-sync-orders',
      headers := '{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb
    )$$
  );
  ```

  </details>

- [ ] **Catalog sync** — product data + images from Amazon → local DB
- [ ] **Competitor pricing intelligence** — track competing listings for same ASINs
- [ ] **Settlement report import** — automated download of bi-weekly settlement CSVs
- [ ] **Price alerts** — notify when competitor prices drop below threshold

### eBay API
> **Status:** 🟢 Approved — Developer Program account approved (April 19, 2026). Ready to implement OAuth + API integration.

- [x] **CSV order import** — `import-legacy-orders.mjs` parses eBay Transaction Report CSVs, admin drag-and-drop UI, fee/shipping/selling breakdown modal
- [x] **Register for eBay Developer Program** — registered April 18, 2026, approved April 19, 2026

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### Step 1: Developer Account Setup
  1. Go to [developer.ebay.com](https://developer.ebay.com) → Sign In with eBay seller account
  2. Create an Application → select Production environment
  3. Get **App ID (Client ID)** + **Cert ID (Client Secret)** + **Dev ID**
  4. Set OAuth redirect URI to `https://karrykraze.com/pages/admin/ebay-callback.html` (or edge function callback)

  #### Step 2: OAuth Implementation
  eBay uses OAuth 2.0 with Authorization Code Grant (for user-specific actions like order access).

  ```
  Auth URL: https://auth.ebay.com/oauth2/authorize
  Token URL: https://api.ebay.com/identity/v1/oauth2/token
  Scopes needed:
    - https://api.ebay.com/oauth/api_scope/sell.fulfillment (orders)
    - https://api.ebay.com/oauth/api_scope/sell.inventory (listings)
    - https://api.ebay.com/oauth/api_scope/sell.finances (payouts/settlements)
  ```

  #### Edge Functions to Build
  | Function | Purpose | eBay API Endpoint |
  |----------|---------|-------------------|
  | `ebay-oauth-callback` | Exchange auth code → access + refresh tokens | `POST /identity/v1/oauth2/token` |
  | `ebay-refresh-token` | Refresh access token (2h expiry, refresh token = 18 months) | `POST /identity/v1/oauth2/token` |
  | `ebay-sync-orders` | Pull orders from last 24h | `GET /sell/fulfillment/v1/order` |
  | `ebay-sync-inventory` | Sync inventory/listings | `GET /sell/inventory/v1/inventory_item` |
  | `ebay-sync-finances` | Pull payout/transaction data | `GET /sell/finances/v1/transaction` |

  #### Data Flow
  ```
  CRON (daily 5 AM UTC)
    → ebay-sync-orders
      → Refresh token if expired (access_token = 2h, refresh_token = 18 months)
      → GET /sell/fulfillment/v1/order?filter=creationdate:[yesterday..now]
      → Map to orders_raw schema (order_session_id = eBay Order ID)
      → Upsert to orders_raw + line_items
  ```

  #### Database Changes
  | Change | Details |
  |--------|---------|
  | `orders_raw.source` | Add `'ebay_api'` to distinguish from CSV imports (`'ebay'`) |
  | `marketplace_tokens` table | Reuse same table as Amazon (platform = `'ebay'`) |

  #### Key eBay API Constraints
  - Rate limits: 5,000 calls/day for most APIs (generous)
  - Token expiry: Access token = 2 hours, Refresh token = 18 months (auto-refresh via CRON)
  - Sandbox: `api.sandbox.ebay.com` for testing (separate sandbox seller account needed)
  - Fulfillment API: Returns last 90 days of orders by default
  - Finances API: Returns transaction-level fee breakdowns (replaces CSV fee parsing)

  #### CRON Setup
  ```sql
  SELECT cron.schedule('ebay-sync-orders-daily',
    '0 5 * * *',
    $$SELECT net.http_post(
      url := 'https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/ebay-sync-orders',
      headers := '{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb
    )$$
  );
  ```

  #### Admin UI
  - Add "eBay" tab to admin settings → OAuth connect button → redirect to eBay auth → callback saves tokens
  - Order dashboard: unified view showing source badge (Website / Amazon / eBay)

  </details>

- [x] **OAuth + listing management** — eBay seller account connected via OAuth on admin settings page. RuName: `Justin_Mcneal-JustinMc-KarryK-ipqfyelqa`. Marketplace deletion endpoint live. Tokens stored in `marketplace_tokens` table.
- [x] **Order sync to admin panel** — `ebay-sync-orders` edge function pulls via Fulfillment API, cron runs every 2 hours (`0 */2 * * *`), deduplicates against CSV imports. 4 orders synced on first run. Now includes product matching + fulfillment tracking capture.

  <details>
  <summary><strong>Product Matching Fix (implemented)</strong></summary>

  **Problem:** eBay API orders stored `product_name` from eBay's SEO-stuffed titles (e.g. "Cherry Bag Charm Keychain Red Glitter Pearl Heart Gold Tone Purse Charm") but left `product_id` null → CPI = $0, profit inflated, no product images on order detail page.

  **Solution:** Ported the `matchProduct()` fuzzy matching algorithm from `ebayImport.js` into the `ebay-sync-orders` edge function (Deno/TypeScript). Runs at insert time for every new order.

  #### Matching Strategy (in order):
  1. **Exact normalized match** — `norm(ebayTitle) === norm(productName)`
  2. **Strip bracket text** — `"Mini Tote[Pink]"` → `"mini tote"`, re-check exact
  3. **Substring** — product name contained in eBay title or vice-versa
  4. **Token-overlap with stemming** — stems words (`bunnies`→`bunny`), picks product with most shared root words (≥2 required)

  #### Additional Fixes:
  - Loads all products from `products` table at sync start
  - Sets `product_id` to matched KK code (e.g. `KK-0013`)
  - Uses canonical product name instead of eBay title when matched
  - Creates `fulfillment_shipments` row per order with status mapping:
    - `FULFILLED` → `shipped`, `IN_PROGRESS` → `label_purchased`, else → `pending`
  - Fetches actual tracking data from `GET /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment`
  - Backfilled all 4 existing API orders: Cherry Bag Charm, Heart Clasp Hook, Cherry Necklace, Plush Flower Bouquet
  </details>

- [x] **Financial transaction sync** — `ebay-sync-finances` edge function pulls fees, shipping labels, and charges from eBay Finances API. Cron runs daily at 6 AM UTC (job #14).

  <details>
  <summary><strong>Financial Sync Implementation</strong></summary>

  **Edge function:** `ebay-sync-finances` → `GET https://apiz.ebay.com/sell/finances/v1/transaction`

  #### What it syncs:
  | Transaction Type | Action | Where |
  |-----------------|--------|-------|
  | `SALE` | Aggregates marketplace fees (FVF, fixed per-order) per month | `expenses` table — category "Fees", monthly rows |
  | `NON_SALE_CHARGE` | Inserts individual charges (subscriptions, ad fees) | `expenses` table — category "Software" |
  | `SHIPPING_LABEL` | Updates label cost per order | `fulfillment_shipments.label_cost_cents` |
  | `REFUND`, `CREDIT` | Informational — refund tracking handled elsewhere | — |

  #### Deduplication:
  - Monthly fees: `notes ILIKE '%ebay_api_selling_fees_YYYY-MM%'`
  - Non-sale charges: `notes ILIKE '%ebay_api_fee_{transactionId}%'`
  - Label costs: Only updates if `label_cost_cents` is 0 or null

  #### Admin UI:
  - "💰 Sync Finances" button on admin settings page → pulls last 90 days
  - Shows: transactions processed, fee months inserted, charges inserted, label costs updated

  #### CRON:
  ```sql
  cron.schedule('ebay-sync-finances-daily', '0 6 * * *', ...)
  -- days_back: 30 (daily overlap for dedup safety)
  ```

  #### First run results (90 days):
  - 22 transactions processed
  - 3 monthly fee aggregates (Feb–Apr 2026)
  - 3 subscription charges ($4.95/month eBay store fees)
  - 5 shipping label costs updated on fulfillment_shipments
  </details>

- [ ] **Inventory sync across platforms** — unified stock levels (website ↔ eBay ↔ Amazon)
- [ ] **Listing management from admin** — create/edit eBay listings from admin panel (Inventory API)

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### Overview
  Use the **eBay Inventory API** (`sell.inventory` scope — already in our OAuth token) to create, edit, and manage eBay listings directly from the admin panel. The flow is: Inventory Item → Offer → Published Listing.

  #### eBay Inventory API Flow
  ```
  1. Create Inventory Item  →  PUT /sell/inventory/v1/inventory_item/{sku}
     (product details: title, description, images, condition, quantity)
  2. Create Offer            →  POST /sell/inventory/v1/offer
     (price, eBay category, fulfillment/return/payment policies, marketplace)
  3. Publish Offer           →  POST /sell/inventory/v1/offer/{offerId}/publish
     (makes it a live listing, returns eBay listing ID)
  ```

  **Editing:** Update inventory item (PUT, full replacement) → offer auto-updates live listing.
  **Price/quantity only:** `POST /sell/inventory/v1/bulk_update_price_quantity` for fast batch updates.

  #### Important Caveat
  > ⚠️ Listings created via Inventory API **cannot** be edited in Seller Hub or vice versa. Existing Seller Hub listings must be migrated first using `POST /sell/inventory/v1/bulk_migrate_listing` before they can be managed via API. **Decision needed:** migrate existing listings or only manage new ones via admin.

  #### Edge Functions to Build
  | Function | Method | eBay Endpoint | Purpose |
  |----------|--------|---------------|---------|
  | `ebay-manage-listing` | POST | Multiple | Unified handler for create/edit/publish/end |
  | — | — | `PUT /inventory_item/{sku}` | Create or update inventory item |
  | — | — | `POST /offer` | Create offer (price, category, policies) |
  | — | — | `PUT /offer/{offerId}` | Update offer (revise price, quantity) |
  | — | — | `POST /offer/{offerId}/publish` | Publish offer → live listing |
  | — | — | `POST /offer/{offerId}/withdraw` | End/withdraw listing |
  | — | — | `GET /inventory_item?limit=100` | List all inventory items |
  | — | — | `GET /offer?sku={sku}` | Get offers for an SKU |
  | `ebay-migrate-listings` | POST | `POST /bulk_migrate_listing` | Migrate existing Seller Hub listings to Inventory API |

  #### Database Changes
  | Change | Details |
  |--------|---------|
  | `products.ebay_sku` | SKU used on eBay (default: product `code` like `KK-0013`) |
  | `products.ebay_offer_id` | eBay offer ID (set after first publish) |
  | `products.ebay_listing_id` | eBay item ID (set after publish, for direct links) |
  | `products.ebay_status` | `draft` / `active` / `ended` / `not_listed` |
  | `products.ebay_category_id` | eBay category ID for the listing |
  | `products.ebay_price_cents` | eBay-specific price (may differ from website price) |

  #### Admin UI — New Page: `pages/admin/ebay-listings.html`
  | Section | Features |
  |---------|----------|
  | **Products Table** | All products with eBay status badge (Active / Draft / Not Listed), eBay price, quantity, last synced |
  | **Push to eBay** | Select product → auto-fills form with product data from DB (title, description, images, price, weight) → choose eBay category → publish |
  | **Edit Listing** | Click active listing → edit title, description, price, quantity → save (auto-updates live listing) |
  | **Bulk Actions** | Update price/quantity for multiple products at once |
  | **End Listing** | Withdraw offer (removes from eBay but keeps inventory item for re-listing) |
  | **Migrate** | One-time button to migrate existing Seller Hub listings to API-managed |

  #### Data Flow: Push Product to eBay
  ```
  Admin clicks "List on eBay" for KK-0013 (Cherry Bag Charm)
    → Edge function receives { action: "create", product_code: "KK-0013", price: 899, quantity: 10, category_id: "xxxxx" }
    → Fetches product from DB (title, description, images, weight)
    → PUT /inventory_item/KK-0013 {
        condition: "NEW",
        product: { title, description, imageUrls: [supabase storage URLs], brand: "Karry Kraze" },
        availability: { shipToLocationAvailability: { quantity: 10 } }
      }
    → POST /offer { sku: "KK-0013", marketplaceId: "EBAY_US", format: "FIXED_PRICE",
        pricingSummary: { price: { value: "8.99", currency: "USD" } },
        categoryId, listingPolicies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId } }
    → POST /offer/{offerId}/publish
    → Update products table: ebay_offer_id, ebay_listing_id, ebay_status = 'active'
  ```

  #### Prerequisites (one-time setup)
  1. **Opt into Business Policies** — `POST /sell/account/v1/program/opt_in` (may already be done)
  2. **Create/verify policies** — need fulfillment, return, and payment policy IDs from eBay Account API
  3. **Enable Out-of-Stock Control** — keeps listings alive at 0 qty (recommended by eBay)
  4. **Set up inventory location** — at least one location required via `POST /sell/inventory/v1/location/{merchantLocationKey}`

  #### Key API Constraints
  - SKU max length: 50 chars (KK codes fit easily)
  - Max 24 images per listing (we typically have 3-5)
  - Images must be HTTPS (Supabase Storage URLs qualify)
  - `Content-Language: en-US` header required on all Inventory API calls
  - Listings can be revised up to 250 times per calendar day
  - Batch operations: `bulkCreateOrReplaceInventoryItem` supports up to 25 items at once
  - Rate limit: 5,000 calls/day (generous for our volume)

  </details>

- [ ] **Promoted Listings (Marketing API)** — create/manage ad campaigns from admin to boost listing visibility in eBay search results

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  **Scope:** `sell.marketing` (needs to be added to OAuth consent)

  #### What it does
  eBay Promoted Listings is a cost-per-sale ad model — you set an ad rate % per listing, eBay boosts it in search results, and you only pay when someone clicks AND buys. Promoted listings get ~30% more visibility on average. Typical ad rates: 2-8%.

  #### API Endpoints
  | Method | Endpoint | Purpose |
  |--------|----------|---------|
  | POST | `/sell/marketing/v1/ad_campaign` | Create a new ad campaign |
  | POST | `/sell/marketing/v1/ad_campaign/{campaignId}/ad` | Add listing to campaign |
  | GET | `/sell/marketing/v1/ad_campaign/{campaignId}/ad` | List ads in campaign |
  | POST | `/sell/marketing/v1/ad_campaign/{campaignId}/ad/{adId}/update_bid` | Change ad rate % |
  | DELETE | `/sell/marketing/v1/ad_campaign/{campaignId}/ad/{adId}` | Remove listing from campaign |
  | GET | `/sell/marketing/v1/ad_report` | Performance data: impressions, clicks, sales, ROAS |

  #### Admin UI
  - Campaign dashboard: active campaigns, total spend, total attributed sales, ROAS
  - Per-listing toggle: "Promote this listing" with ad rate slider (2-15%)
  - Performance table: impressions, clicks, conversions, spend per listing
  - Suggested ad rates based on eBay's recommendations (available via API)

  #### Edge Function
  `ebay-manage-ads` — unified handler for create campaign, add/remove ads, update bids, pull reports

  </details>

- [ ] **Real-Time Order Notifications** — eBay push webhooks instead of 2-hour polling for instant order processing

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  #### What it does
  Instead of polling every 2 hours via cron, eBay pushes event notifications to your edge function the instant something happens (order placed, item shipped, feedback received, etc.).

  #### Setup
  1. Register notification endpoint via eBay Developer Portal or `POST /commerce/notification/v1/subscription`
  2. Point to edge function: `https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/ebay-webhook`
  3. eBay sends a validation challenge (similar to account deletion) — respond with challenge hash

  #### Events to Subscribe To
  | Event | Trigger | Action |
  |-------|---------|--------|
  | `MARKETPLACE_ACCOUNT_DELETION` | Already handled | ✅ Done |
  | `ItemSold` / `FixedPriceTransaction` | Buyer purchases item | Insert order + line items immediately |
  | `AskSellerQuestion` | Buyer messages seller | Push notification / email alert |
  | `FeedbackReceived` | Buyer leaves feedback | Log to reviews or alert admin |
  | `ItemUnsold` | Listing ends without sale | Update ebay_status to 'ended' |

  #### Benefits
  - Orders appear in admin within seconds (vs up to 2 hours)
  - Could trigger instant SMS order confirmation to buyer
  - Reduces unnecessary API calls from cron polling
  - Can keep cron as fallback for any missed notifications

  #### Edge Function
  `ebay-webhook` — receives events, validates signature, routes to appropriate handler (order insert, status update, etc.)

  </details>

- [ ] **Seller Analytics & Traffic Reports (Analytics API)** — per-listing traffic data and seller performance metrics

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  **Scope:** `sell.analytics` (needs to be added to OAuth consent)

  #### What it does
  Pull per-listing traffic and conversion data plus seller account health metrics from eBay's Analytics API.

  #### API Endpoints
  | Method | Endpoint | Purpose |
  |--------|----------|---------|
  | GET | `/sell/analytics/v1/traffic_report` | Per-listing: page views, impressions, click-through rate, conversion rate |
  | GET | `/sell/analytics/v1/seller_standards_profile` | Seller level, defect rate, late shipment rate |
  | GET | `/sell/analytics/v1/customer_service_metric` | Response time, resolution rate |

  #### Admin UI — eBay Analytics Dashboard
  - **Traffic table:** listing title, impressions, page views, sales, conversion rate (sortable, filterable)
  - **Seller health card:** current seller level (Top Rated / Above Standard / Below Standard), defect rate, late shipment %, cases closed without resolution
  - **Underperformers:** listings with high views but 0 sales (indicates pricing or listing quality issue)
  - **Trends chart:** weekly impressions + sales over time

  #### Edge Function
  `ebay-analytics` — pulls traffic report + seller standards, returns combined data

  #### CRON
  Daily at 7 AM UTC (after finances sync) — store historical snapshots in an `ebay_analytics_snapshots` table for trend tracking

  </details>

- [ ] **Listing Compliance Monitoring (Compliance API)** — proactive violation detection before eBay suppresses listings

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  **Scope:** `sell.inventory` (already have it)

  #### What it does
  Fetch active policy violations on your listings before eBay takes action (suppression, removal, account restriction). Get violation type, affected listings, and corrective action needed.

  #### API Endpoint
  | Method | Endpoint | Purpose |
  |--------|----------|---------|
  | GET | `/sell/compliance/v1/listing_violation_summary` | Count of violations by type |
  | GET | `/sell/compliance/v1/listing_violation?compliance_type={type}` | Detailed violations per listing |

  #### Compliance Types
  - `PRODUCT_ADOPTION` — listing needs eBay catalog product match
  - `OUTSIDE_EBAY_BUYING_AND_SELLING` — links/references outside eBay
  - `HTTPS` — non-HTTPS image URLs
  - `LISTING_POLICY` — prohibited items, misleading titles, etc.

  #### Admin UI
  - Compliance health badge on eBay listings page: ✅ Clean / ⚠️ 3 Violations
  - Violation detail panel: listing title, violation type, eBay's recommended fix
  - One-click fix for common issues (e.g., update image URLs to HTTPS)

  #### Edge Function
  `ebay-compliance-check` — pulls violation summary + details, returns actionable list

  #### CRON
  Weekly check (Sunday 4 AM UTC) — alert if new violations detected

  </details>

- [ ] **Category & Item Specifics Intelligence (Taxonomy API)** — auto-suggest eBay categories and required item specifics

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  **Scope:** Public API (no seller auth needed — uses application token)

  #### What it does
  When listing a product on eBay, you need to pick the right category and fill in required "item specifics" (like Brand, Type, Material, etc.). The Taxonomy API tells you exactly what's required and suggests the best category for your product.

  #### API Endpoints
  | Method | Endpoint | Purpose |
  |--------|----------|---------|
  | GET | `/commerce/taxonomy/v1/category_tree/{id}/get_category_suggestions` | Auto-suggest category from product title |
  | GET | `/commerce/taxonomy/v1/category_tree/{id}/get_item_aspects_for_category` | Required/recommended item specifics for a category |
  | GET | `/commerce/taxonomy/v1/category_tree/{id}` | Browse full category tree |

  #### Integration with Listing Management
  When pushing a product to eBay from admin:
  1. User clicks "List on eBay" → auto-call `get_category_suggestions` with product title
  2. Show top 3 suggested categories with confidence scores
  3. Once category selected → fetch required item specifics
  4. Auto-fill what we can from product data (Brand = "Karry Kraze", Condition = "New")
  5. Highlight missing required fields for user to fill in
  6. Cache category → item specifics mapping in DB to avoid repeated API calls

  #### Edge Function
  `ebay-taxonomy` — wraps category suggestion + item aspects calls. Uses application token (no user auth needed).

  </details>

- [ ] **Competitor Price Tracking (Browse API)** — monitor competing eBay listings and market pricing

  <details>
  <summary><strong>Implementation Plan</strong></summary>

  **Scope:** Public API (application token only — `api_scope`)

  #### What it does
  Search eBay for items similar to yours by keyword or category. Pull competing listing prices, shipping costs, seller ratings, and sold counts. Build a price intelligence dashboard.

  #### API Endpoints
  | Method | Endpoint | Purpose |
  |--------|----------|---------|
  | GET | `/buy/browse/v1/item_summary/search` | Search for competing listings by keyword |
  | GET | `/buy/browse/v1/item/{item_id}` | Full listing details for a competitor |

  #### Admin UI — Price Intelligence Dashboard
  - **Per-product comparison:** your price vs. average competitor price vs. lowest price
  - **Market position indicator:** "You're 15% above market average" / "Priced competitively"
  - **Price alert:** flag when a competitor drops below your price threshold
  - **Sold data:** how many units competitors are moving (available via `search` with `sold` filter)

  #### Data Flow
  ```
  CRON (weekly, Sunday 5 AM UTC)
    → For each active product with ebay_listing_id:
      → Search eBay with product keywords + category
      → Collect top 10-20 competing listings (price, shipping, seller rating, sold count)
      → Store in ebay_competitor_snapshots table
      → Calculate: avg_price, min_price, max_price, your_position
    → Admin dashboard reads from snapshots
  ```

  #### Edge Function
  `ebay-competitor-scan` — searches for competitors per product, returns pricing analysis

  #### Database
  | Table | Columns |
  |-------|---------|
  | `ebay_competitor_snapshots` | product_id, snapshot_date, avg_price_cents, min_price_cents, max_price_cents, competitor_count, your_price_cents, your_rank, raw_data (jsonb) |

  </details>

---

## Growth & Polish

- [ ] **Pinterest production API** — upgraded from sandbox to production. App ID: 1542566, secrets set (`PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`), `pinterest-post` switched from `api-sandbox.pinterest.com` → `api.pinterest.com`, auto-queue Pinterest checkbox enabled. OAuth flow requests `pins:read,pins:write,boards:read,boards:write` scopes. Token refresh already automated daily. **Next: Connect via OAuth button on social admin page, then test a pin.**
- [ ] **Admin public replies to reviews** — add reply field to admin review moderation UI, store in `review_replies` table, display on public reviews page. Reviews may need more prominent presence on site for replies to have impact.
- [ ] **Review helpfulness voting** — "Was this helpful?" button on review cards, `review_votes` table, sort by helpfulness
- [ ] **Instagram comment → auto-DM coupon** — needs Meta App Review for `instagram_manage_comments` + `instagram_manage_messages` permissions. Hold off until gaining traction — manual replies for now. *(Note: the system auto-POSTS content but does NOT auto-comment on posts. This feature would auto-DM people who comment on your posts.)*
- [ ] **SEO blog / content pages** — articles like "Top 10 Plushie Gift Ideas" that rank in Google → free organic traffic. Would need: blog post table in Supabase, admin editor page, public `/blog/{slug}` page with dynamic routing via query params, sitemap generation, structured data (Article schema). Long-term growth channel.
- [ ] **TikTok integration** — TikTok supports image carousels (Photo Mode) which we could do now. TikTok Shop is a separate opportunity (Seller Center registration + product catalog + fulfillment). Strategy: drive traffic to karrykraze.com rather than fragmenting across platform shops (same logic for Instagram Shopping). Video posting depends on AI video solution. *(on hold until video solution found or image-only posting decided)*
- [ ] **Email marketing campaigns** — abandoned cart email (supplement to SMS), new arrivals digest, re-engagement for lapsed customers. Depends on email provider integration. *(on hold)*

---

## Architecture Reference

### Social Media Posting Flow
```
Product in DB
  → autopilot-fill (daily CRON, 2 AM UTC) checks calendar gaps
    → auto-queue generates posts (AI captions + Image Pool / AI images)
      → process-scheduled-posts (every-minute CRON) fires when scheduled_for <= now
        → dispatches to instagram-post / instagram-carousel / facebook-post / pinterest-post
          → instagram-insights (6h CRON) pulls engagement metrics
            → post-learning engine aggregates patterns
              → feeds learnings back into next caption/hashtag/timing generation
```

### Key Supabase Edge Functions
| Function | Purpose |
|----------|---------|
| `ai-generate` | GPT-4o-mini captions, hashtags, scoring, insights |
| `ai-product-fill` | GPT-4o Vision → product descriptions from images |
| `auto-queue` | Generate scheduled posts from product catalog |
| `autopilot-fill` | Auto-fill content calendar gaps (CRON trigger) |
| `auto-repost` | Resurface high-engagement posts 30+ days old |
| `process-scheduled-posts` | Publish queued posts when time arrives |
| `instagram-post` | Single image post to Instagram |
| `instagram-carousel` | Multi-image carousel to Instagram |
| `instagram-insights` | Pull engagement metrics + trigger learning |
| `facebook-post` | Post to Facebook Page |
| `pinterest-post` | Create pin on Pinterest (sandbox) |
| `generate-social-image` | AI image generation (gpt-image-1 + DALL-E 3 + quality scoring) |
| `import-product-images` | Download external supplier images to Supabase Storage |
| `create-checkout-session` | Stripe checkout |
| `stripe-webhook` | Handle Stripe payment events |
| `submit-review` | Customer review submission + auto-coupon |
| `verify-order` | Verify order for review eligibility |
| `verify-review-token` | JWT verify for SMS review deep links |
| `send-review-request` | Generate review JWT + send SMS via Twilio |
| `refresh-tokens` | Auto-refresh Instagram/Facebook/Pinterest tokens |
| `send-push-notification` | Web push notifications to subscribed browsers |
| `share-product` | Generate OG meta tags for product share links |
| `lookup-orders` | Customer order lookup with shipment tracking |
| `shippo-create-label` | Buy shipping label via Shippo |
| `shippo-void-label` | Void/refund unused shipping label |
| `shippo-webhook` | Receive Shippo tracking updates (PRE_TRANSIT/TRANSIT/DELIVERED) |
| `send-sms` | Generic SMS sender via Twilio |
| `sms-subscribe` | SMS opt-in subscriber endpoint |
| `sms-abandoned-cart` | Detect + notify abandoned carts |
| `sms-coupon-reminder` | Send coupon reminder SMS |
| `sms-welcome-series` | Day 2 + Day 5 onboarding SMS |
| `sms-redirect` | SMS link click tracking + redirect |
| `twilio-webhook` | Inbound SMS handling (STOP/START) |

### Active CRON Jobs (pg_cron)
| Job | Schedule | Function |
|-----|----------|----------|
| `process-scheduled-social-posts` | Every minute | `process-scheduled-posts` |
| `autopilot-fill-daily` | 2:00 AM UTC daily | `autopilot-fill` |
| `refresh-social-tokens-daily` | 3:00 AM UTC daily | `refresh-tokens` |
| `sync-instagram-insights` | Every 6 hours | `instagram-insights` |
| `sms-abandoned-cart-check` | Every 5 minutes | `sms-abandoned-cart` |
| `sms-coupon-reminder` | Hourly at :30 | `sms-coupon-reminder` |
| `sms-welcome-series` | Hourly at :45 | `sms-welcome-series` |
