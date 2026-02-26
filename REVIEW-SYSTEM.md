# Review System — Karry Kraze

## Overview

Customers can leave verified reviews after placing an order. Reviews are tied to real orders via email + KK order ID verification, preventing fake reviews. Approved reviews earn the customer a **5% off coupon** for their next purchase.

---

## Architecture

### Database Tables

| Table | Purpose |
|---|---|
| `review_settings` | Key-value JSONB config (`coupon` + `moderation` rows) |
| `reviews` | Customer reviews (linked to `orders_raw` via `order_session_id`) |
| `review_coupons` | Generated coupon codes with expiry, usage tracking |

### Edge Functions

| Function | Auth | Purpose |
|---|---|---|
| `verify-order` | `--no-verify-jwt` | Validates email + KK order ID, returns line items + review status |
| `submit-review` | `--no-verify-jwt` | Saves review, generates `THANKS-XXXXXX` coupon |

### Frontend Pages

| Page | JS Module | Purpose |
|---|---|---|
| `/pages/reviews.html` | `/js/reviews/index.js` | Customer review flow (4 steps) |
| `/pages/admin/reviews.html` | `/js/admin/reviews/index.js` | Admin management panel |
| `/pages/success.html` | `/js/success/index.js` | Post-checkout with order details + review CTA |

---

## Customer Flow

1. **Order Lookup** — Customer enters email + KK order number (e.g. `KKO-A1B2C3`)
2. **Product Picker** — Shows all items from that order; already-reviewed items are grayed out
3. **Review Form** — Star rating (1-5), name, title, body text, optional photo upload
4. **Thank You** — Shows coupon code (if auto-approved) or "pending approval" message

## Admin Flow

- **Settings Panel** — Toggle coupon on/off, set discount %, prefix, expiry days, single-use, auto-approve
- **Reviews Table** — Filter by status, quick approve/reject buttons, click to edit full details
- **Edit Modal** — Change any field (product name, reviewer, rating, title, body, photo, status), delete
- **Add Review** — Admin can manually create reviews (e.g. for testimonials)
- **Coupons Log** — View all generated coupons, their status, and usage

## Coupon Details

- **Format:** `THANKS-XXXXXX` (configurable prefix)
- **Default:** 5% off, 30-day expiry, single use
- **Delivery:** Shown immediately if auto-approve is on; otherwise after admin approval
- **Validation:** Coupon code stored in `review_coupons` table — needs checkout integration

---

## File Map

```
supabase/
  migrations/20260226_create_reviews.sql   # DB schema
  functions/verify-order/index.ts          # Order verification endpoint
  functions/submit-review/index.ts         # Review + coupon creation endpoint

js/
  reviews/index.js                         # Customer reviews page logic
  admin/reviews/api.js                     # Admin Supabase queries
  admin/reviews/index.js                   # Admin page logic
  success/index.js                         # Updated success page (order details)

pages/
  reviews.html                             # Customer review page
  success.html                             # Updated success page
  admin/reviews.html                       # Admin review management

page_inserts/
  admin-nav.html                           # Updated with "Reviews" link
```

---

## TODO

### High Priority

- [ ] **Coupon code recovery** — When a customer looks up an order and a product is already reviewed, show the coupon code that was generated for that review (verify-order already flags `already_reviewed`; extend it to return `coupon_code` from the `reviews` table so the customer can retrieve a lost code)
- [ ] **Star ratings on catalog cards** — Query average rating + review count per product from `reviews` table and display stars on each product card in `/pages/catalog.html`
- [ ] **Star ratings on product page** — Show aggregate star rating + review count on `/pages/product.html` near the product title/price area
- [ ] **Sort by rating on catalog page** — Add a "Top Rated" sort option to the catalog sort dropdown; requires joining or pre-computing average ratings

### Medium Priority

- [ ] **Reviews carousel on home page** — Add a "What Customers Say" section to the home page with a horizontal swipeable carousel of approved reviews (pull latest 10-15 approved reviews, show name + stars + snippet + product name)
- [ ] **Product page review section** — Below the product details on `/pages/product.html`, show a full reviews feed filtered to that specific product (approved reviews only, with star breakdown bar chart)
- [ ] **Review coupon checkout integration** — Wire `review_coupons` table into the existing coupon validation at checkout (`couponManager.js` / `create-checkout-session`) so `THANKS-XXXXXX` codes actually apply the discount

### Lower Priority

- [ ] **Review photo gallery** — Show uploaded review photos in a lightbox/modal on the reviews page
- [ ] **Admin email notification** — When `moderation.notify_admin` is true, send admin an email/push when new review is submitted
- [ ] **Customer coupon email** — After admin approves a pending review, email the customer their coupon code (requires email provider — Resend.com recommended)
- [ ] **Review analytics** — Admin dashboard widget showing review volume, average rating, coupon redemption rate
- [ ] **Star rating caching** — Create a materialized view or summary table (`product_review_stats`) with avg_rating + review_count per product_id for fast catalog/product page queries instead of computing on-the-fly
- [ ] **Review helpfulness** — "Was this helpful?" voting on public reviews
- [ ] **Review response** — Allow admin to post a public reply to a review

---

## Technical Notes

- **RLS:** Anon users can only SELECT approved reviews. Service role (edge functions) has full access. Authenticated (admin) has full CRUD.
- **Unique constraint:** One review per product per order (`uq_review_order_product`)
- **Photo storage:** Uploaded to Supabase Storage `products` bucket under `reviews/` prefix
- **Migration history:** The `supabase db push` has version conflicts from older migrations sharing timestamps. New migrations were applied via direct DB connection (`SET ROLE postgres`). Future migrations should use unique timestamps.
