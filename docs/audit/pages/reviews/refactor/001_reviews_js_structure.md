# Reviews Page JavaScript Structure

## Purpose

Refactor the `reviews.html` JavaScript into smaller page-specific modules while preserving the current public reviews browsing behavior.

## Audit Summary

- Current page: `pages/reviews.html`.
- Old page entry: `/js/reviews/browse.js`.
- New page entry: `/js/pages/reviews/index.js`.
- Compatibility wrapper: `/js/reviews/browse.js` imports the new entry.
- Shared initialization: `initNavbar()` is awaited, then `initFooter()` is called, matching the old page flow.
- Supabase read: `reviews` table, selecting `id, product_id, product_name, reviewer_name, rating, title, body, photo_url, created_at`, filtered to `status = approved`, newest first, limit `500`.
- DOM selectors: aggregate stats, photo gallery, filter buttons, sort select, search input, reviews feed, load-more button, and photo lightbox elements.
- Event handlers: filter button clicks, sort change, debounced search input, load-more click, photo lightbox open/close clicks, and Escape key close.
- Rendering states: initial loading markup remains in HTML; load errors show `Could not load reviews.`; empty filtered results show `No reviews found.`.
- Analytics: no page-specific analytics call existed in `/js/reviews/browse.js`. The page still includes `/js/shared/metaPixel.js`, preserving the global PageView behavior.
- Storage: no `localStorage` or `sessionStorage` usage exists on `reviews.html`.
- Order/session/CTA lookup, review submission, duplicate review prevention, and coupon reward behavior are not part of `reviews.html`; those flows live on `pages/leave-review.html` and were not changed by this refactor.
- Global functions: none exposed.

## Module Map

- `index.js` is the entry/orchestration file. It initializes shared chrome, wires events, loads reviews, and coordinates filtering/rendering.
- `reviewsState.js` stores init state, loaded reviews, filtered reviews, pagination count, active filter, active sort, and search query.
- `reviewsDom.js` centralizes DOM IDs, CSS selectors, and safe show/hide/text/html helpers.
- `reviewsValidation.js` normalizes filter, sort, and search values.
- `reviewsOrder.js` is intentionally minimal because `reviews.html` has no order/session lookup flow.
- `reviewsApi.js` owns the Supabase `reviews` table read.
- `reviewsCoupon.js` is intentionally a no-op because `reviews.html` does not generate or display coupons.
- `reviewsRender.js` renders aggregate stats, photo gallery, review cards, empty/error states, load-more state, active filter styling, and lightbox state.
- `reviewsAnalytics.js` provides a guarded analytics helper for future page-specific events; no event is currently fired to preserve behavior.
- `reviewsUtils.js` contains escaping, date formatting, star HTML, and debounce helpers.

## Preserved Behavior

- Same script style: plain browser JavaScript modules with no build step.
- Same Supabase table, selected fields, filters, ordering, and limit.
- Same filter/sort/search behavior, including 300ms search debounce.
- Same `PAGE_SIZE` of `20` and load-more behavior.
- Same review card, aggregate stats, photo gallery, lightbox, empty state, and load error copy.
- Same global Meta Pixel PageView script in `reviews.html`.

## Validation Commands Run

```powershell
node --check "js/pages/reviews/index.js"; node --check "js/pages/reviews/reviewsState.js"; node --check "js/pages/reviews/reviewsDom.js"; node --check "js/pages/reviews/reviewsValidation.js"; node --check "js/pages/reviews/reviewsOrder.js"; node --check "js/pages/reviews/reviewsApi.js"; node --check "js/pages/reviews/reviewsCoupon.js"; node --check "js/pages/reviews/reviewsRender.js"; node --check "js/pages/reviews/reviewsAnalytics.js"; node --check "js/pages/reviews/reviewsUtils.js"; node --check "js/reviews/browse.js"
```

## Known Risks / Follow-Ups

- Browser smoke testing is still recommended for approved review loading, filter/sort/search combinations, load-more behavior, and photo lightbox interactions.
- `pages/leave-review.html` still uses `/js/reviews/leave.js`; review submission and coupon reward logic were intentionally left untouched because they are outside the `reviews.html` page script.
