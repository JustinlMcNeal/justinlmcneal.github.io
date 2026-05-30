# Phase 2P — Live Ready to Push + Post-Submit UX Polish

Replace mock Ready to Push cards with a live Supabase read view, and polish the submitted → verify → published admin flow.

**Prior:** [2O post-submit verification](027_post_submit_verification.md) · [2K push draft workflow](023_push_draft_workflow.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/migrations/20260728_amazon_ready_to_push_view.sql` | `v_amazon_ready_to_push_products` view |
| `js/admin/amazon/readyToPush.js` | Lazy-load controller for Ready to Push tab |
| `js/admin/amazon/renderReadyToPush.js` | Live product card render |
| `docs/pages/admin/amazon/ux/028_ready_to_push_live.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `js/admin/amazon/api.js` | `fetchAmazonReadyToPushProducts()` |
| `js/admin/amazon/index.js` | Wire Ready to Push refresh on draft/mapping/verify |
| `js/admin/amazon/renderDraftsIssues.js` | Submitted UX polish + reminder panel data |
| `js/admin/amazon/draftsIssues.js` | Scroll-to-submitted handler |
| `js/admin/amazon/pushDraftLive.js` | Improved post-submit toast copy |
| `pages/admin/amazon.html` | Remove mock cards; add reminder panel; tab count `0` |

---

## Ready to Push View Logic

**View:** `v_amazon_ready_to_push_products`

### Inclusion

- Active KK products (`products.is_active = true`)
- Variant stock aggregated from active `product_variants`
- Category name from `categories` join (nullable)
- Image from `primary_image_url` or `catalog_image_url` (nullable)

### Exclusion

- Products with `amazon_listing_mappings.mapping_status = 'mapped'`
- Products with any `amazon_listing_drafts.draft_status = 'submitted'` (awaiting verification in Drafts / Issues)

### Draft awareness

Latest non-archived, non-published draft per product is attached:

| Field | Purpose |
|-------|---------|
| `draft_id` | Continue Draft action |
| `draft_status` | Card badge |
| `has_active_draft` | UI branching |
| `last_draft_updated_at` | Helper text |

Published and archived drafts are ignored for the latest-draft pick.

### Grant

```sql
GRANT SELECT ON public.v_amazon_ready_to_push_products TO authenticated, service_role;
```

---

## Frontend Ready to Push Behavior

### API

`fetchAmazonReadyToPushProducts({ limit: 50 })` reads `v_amazon_ready_to_push_products`, ordered by `updated_at DESC NULLS LAST`.

### Lazy load

`readyToPush.js` listens for `amazon:view-change` with `view === "ready-to-push"`.

### Card actions

| State | Primary | Secondary |
|-------|---------|-----------|
| No draft | Push to Amazon | Create Draft |
| Has draft | Continue Draft | Push to Amazon |

Uses existing modal wiring (`push-product-to-amazon`, `create-amazon-draft`, `continue-amazon-draft`).

### Refresh triggers

Ready to Push refreshes after:

- Draft saved
- Draft verified / published
- Mapping saved

Tab count (`#amazonTabReadyToPush [data-count]`) updates from live row count.

---

## Draft-Aware Card Behavior

- **Ready** badge when no in-progress draft
- Draft status badges: Draft saved, Needs attributes, Ready to submit, Rejected
- **Continue Draft** passes `data-draft-id` for modal hydration
- Product thumbnail when `image_url` present; peach placeholder otherwise

---

## Post-Submit UX Polish

### Drafts / Issues — submitted cards

- Amber border/background highlight
- Badge: **Submitted**
- Helper: *Waiting for Amazon verification*
- **Verify Listing** button (unchanged action from 2O)

### Drafts / Issues — reminder panel

When submitted drafts exist:

> You have N submitted draft(s) waiting for Amazon verification.

**View submitted drafts** scrolls to the first submitted card.

### Push modal — after live submit

Toast copy:

> Submitted to Amazon. Amazon may take a few minutes to return the listing through SP-API. Run verification now or try again later.

Manual verification only — no polling in 2P.

### Published drafts

Hidden from `v_amazon_drafts_issues` (existing). If shown elsewhere, helper *Verified from Amazon sync* is supported in render.

---

## Phase 2Q — Scheduled Verification Retry

Implemented in [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md). Cron runs read-only single-SKU verification with backoff and max attempts.

---

## What Remains Unimplemented

1. Readiness gates (needs category, needs images) — mock-only badges removed
2. Product type search UI
3. Auto-prompt verify immediately after submit
4. Pagination beyond 50 rows
5. Multi-marketplace Ready to Push filtering

---

## Security Rules

| Rule | Status |
|------|--------|
| No new Amazon write endpoints | ✅ |
| No browser → Amazon calls | ✅ |
| No service role key in frontend | ✅ |
| No LWA/AWS tokens in frontend | ✅ |
| Read-only Supabase view via anon + admin JWT | ✅ |

---

## Deploy

Apply migration:

```bash
supabase db push
# or run 20260728_amazon_ready_to_push_view.sql in SQL editor
```

No new edge functions for 2P.

---

## Known Limitations / TODOs

1. View eligibility flags live — see [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
2. Submitted-draft exclusion removes product from Ready to Push until verified
3. Tab count reflects loaded page (max 50), not total eligible count
4. Category/image columns depend on existing `products` / `categories` schema

---

## Recommended Next Phase

**2Q** — ✅ Scheduled verification retry — [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)

**2R** — ✅ Product type search + eligibility — [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)

**2S** — Admin alert when auto-verify exhausts attempts; reset/requeue action in UI.

---

## Related Docs

- [`027_post_submit_verification.md`](027_post_submit_verification.md)
- [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)
- [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
- [`023_push_draft_workflow.md`](023_push_draft_workflow.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)
