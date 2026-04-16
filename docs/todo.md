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
- [ ] **Catalog search on mobile** — fix broken/clipped search bar behavior
- [ ] **Product size/variant support** — enable size options per product
- [ ] **Revamp Reviews page** — split into two pages: one for browsing reviews, one for leaving a review
- [ ] **Homepage banner** — improve visuals, add more dynamic or promotional content

---

## Admin

- [ ] **Access admin pages via mobile/app** — ensure admin routes work on phone
- [ ] **Product search bar fix** — the ✕ clear button in the admin product search is broken
- [ ] **Expense report duplicate prevention** — detect and block duplicate entries on import
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
