# Phase 2S — Verification Exhausted Alerts + Header Product Picker

Admin tooling for max-attempt verification recovery and header Push KK Product product selection.

**Prior:** [2Q scheduled verification retry](029_scheduled_verification_retry.md) · [2R product type search + eligibility](030_product_type_search_and_eligibility.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-requeue-draft-verification/index.ts` | Admin requeue of verify retry metadata |
| `js/admin/amazon/productPicker.js` | Header Push product picker modal |
| `docs/pages/admin/amazon/ux/031_verify_requeue_and_product_picker.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonDraftVerifyQueueUtils.ts` | `requeueDraftVerification()` helper |
| `js/admin/amazon/api.js` | `requeueAmazonDraftVerification()` |
| `js/admin/amazon/draftsIssues.js` | Requeue click handler |
| `js/admin/amazon/renderDraftsIssues.js` | Max-attempt alert + requeue button + retry helper |
| `js/admin/amazon/modals.js` | Header Push → product picker; export `openPush` |
| `js/admin/amazon/index.js` | Wire product picker + modals |
| `js/admin/amazon/pushDraft.js` | Eligibility meta from picker trigger |
| `pages/admin/amazon.html` | `#amazonProductPickerModal` |

---

## Requeue Function

**Path:** `supabase/functions/amazon-requeue-draft-verification`

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS preflight |
| `POST` | Requeue one submitted draft |
| Other | `405 method_not_allowed` |

### Auth

Admin JWT via `requireAdminJson()`. **No Amazon API calls.**

### Input

```json
{ "draftId": "uuid" }
```

### Behavior

Requires `draft_status = submitted`. Resets:

| Field | Value |
|-------|--------|
| `verify_status` | `queued` |
| `verify_attempts` | `0` |
| `verify_last_error` | `null` |
| `last_verify_attempt_at` | `null` |
| `next_verify_after` | `now()` (immediate cron eligibility) |

### Response

```json
{ "ok": true, "draftId": "uuid", "verifyStatus": "queued" }
```

Manual **Verify Listing** and cron retry both continue to work after requeue.

---

## Draft Card Alert / Requeue Behavior

### `verify_status = max_attempts`

- Red alert: *Auto verification stopped after max attempts.*
- Buttons: **Verify Listing** + **Requeue Auto-Verify**
- Requeue calls `requeueAmazonDraftVerification()` → toast → refresh Drafts / Issues

### `verify_status = failed` or `not_found`

Helper text when scheduled:

> Auto-check will retry at &lt;next_verify_after&gt;

Existing retry metadata grid unchanged.

---

## Product Picker Modal

**Modal:** `#amazonProductPickerModal`

| Element | Purpose |
|---------|---------|
| `#amazonHeaderProductSearch` | Search input (min 2 chars) |
| `#amazonHeaderProductResults` | Selectable product cards |
| Cancel / × | Close picker |

Search uses existing `searchKkProducts()`.

On open, loads `v_amazon_ready_to_push_products` (limit 50) to attach eligibility warnings when product is in that view.

### Result card shows

- Product name, SKU, price, stock
- Warning text when missing stock/price (picker) or full eligibility warnings (from Ready to Push row)

Selecting a product closes the picker and opens `#amazonPushModal` hydrated with that product.

---

## Header Push Behavior

**Before 2S:** `data-action="push-kk-product"` opened Push modal directly (no product).

**After 2S:**

1. Header **Push KK Product** → product picker modal
2. Admin searches and selects product
3. Push modal opens with product fields + eligibility warning panel (when warnings exist)

Ready to Push / Continue Draft flows unchanged.

---

## Security Rules

| Rule | Status |
|------|--------|
| No Amazon listing write endpoints | ✅ |
| Requeue admin-only | ✅ |
| Requeue only for submitted drafts | ✅ |
| No browser → Amazon calls | ✅ |
| No service role / tokens in frontend | ✅ |

---

## Deploy

```bash
supabase functions deploy amazon-requeue-draft-verification
```

No new migration for 2S.

---

## Known Limitations

1. Picker loads up to 50 Ready to Push rows for eligibility context (not full catalog)
2. Requeue does not run verification immediately — cron picks up on next run
3. Products not in Ready to Push view only show basic stock/price warnings in picker
4. ~~No bulk requeue for multiple max-attempt drafts~~ — ✅ [2U bulk requeue](033_bulk_requeue_and_max_attempt_alerts.md)
5. Picker does not block selection for missing stock/price (Ready to Push cards still block new drafts)

---

## Recommended Next Phase

**2T** — ✅ [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)

**2U** — ✅ [`033_bulk_requeue_and_max_attempt_alerts.md`](033_bulk_requeue_and_max_attempt_alerts.md)

---

## Related Docs

- [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)
- [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
- [`023_push_draft_workflow.md`](023_push_draft_workflow.md)
