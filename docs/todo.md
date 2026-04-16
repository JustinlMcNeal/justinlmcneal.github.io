# Karry Kraze — Site TODO

## Checkout & Orders

- [ ] **Native site checkout form (full control)**
  - Validate shipping address
  - Store order in Supabase
  - Pass to Stripe Checkout
  - Create order record on success
- [ ] **Checkout order summary page** — order validation and confirmation info display
- [ ] **Implement Shippo** into the order fulfillment system
- [ ] **Fix eBay & Amazon order imports** — correct data mapping; add hotkeys/links to jump directly to the report download pages

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

- [ ] **Share button on product pages** — native share for iMessage, Discord, etc. with OG image embed
- [ ] **Referral share link** — sharer gets a unique link; referee gets 5% off at checkout; sharer earns 10% off when the referee completes a purchase
- [x] **Catalog search on mobile** — fix auto-zoom and remove redundant predictive dropdown

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
- [ ] **Product size/variant support** — enable size options per product
- [ ] **Revamp Reviews page** — split into two pages: one for browsing reviews, one for leaving a review
- [ ] **Homepage banner** — improve visuals, add more dynamic or promotional content

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

  </details>
- [ ] **Expenses page sorting & filtering** — add sort controls and a spending graph

---

## Social Media

### Cleanup (do first)
- [ ] Remove unused **Assets** section from the social media page
- [ ] Remove **Caption Assets** section — unused
- [ ] Remove **AI image generation** from the social media page

### Manual Posting
- [ ] **Image selection per product** — when creating a new post, allow selecting which product images to include
- [ ] **Manual upload** — allow uploading custom images to attach to a post (not just product images)

### AI Automation (future)
- [ ] **Auto-queue system** — AI picks which product to post next based on posting history; selects the best image; auto-generates caption and pinned comment
- [ ] **Data-driven scheduling** — posting times and hashtags chosen based on historical performance analytics
- [ ] **Per-post analytics tracking** — track engagement per post to surface what times, tags, and formats perform best
- [ ] **Carousel auto-posting** — carousels included in the queue with a lower weight than single-image posts (single images post more frequently)

---

## SMS / Notifications

- [ ] **Twilio setup** — integrate Twilio for SMS notifications (order updates, marketing)
