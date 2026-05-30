# Phase 2R — Product Type Search + Ready to Push Eligibility Flags

Read-only Product Type Definitions search in the push modal, plus eligibility flags on the Ready to Push read model for pre-draft warnings.

**Prior:** [2P Ready to Push live](028_ready_to_push_live.md) · [2L PTD validation](024_product_type_validation_preview.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-search-product-types/index.ts` | Admin PTD search edge function |
| `supabase/migrations/20260730_amazon_ready_to_push_eligibility.sql` | Eligibility fields on ready-to-push view |
| `docs/pages/admin/amazon/ux/030_product_type_search_and_eligibility.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonPtdUtils.ts` | `searchDefinitionsProductTypes()` helper |
| `js/admin/amazon/api.js` | `searchAmazonProductTypes()` + eligibility columns |
| `js/admin/amazon/pushDraftPtd.js` | Product type search UI + selection |
| `js/admin/amazon/pushDraft.js` | Search/select handlers + eligibility warning panel |
| `js/admin/amazon/renderReadyToPush.js` | Eligibility badges, chips, blocked actions |
| `pages/admin/amazon.html` | Search controls + eligibility panel |

---

## Product Type Search Function

**Path:** `supabase/functions/amazon-search-product-types`

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS preflight |
| `POST` | Search product types |
| Other | `405 method_not_allowed` |

### Auth

Admin JWT via `requireAdminJson()`.

### Input

```json
{
  "sellerAccountId": "optional uuid",
  "marketplaceId": "ATVPDKIKX0DER",
  "query": "beanie",
  "locale": "en_US"
}
```

### SP-API (read-only)

`GET /definitions/2020-09-01/productTypes?marketplaceIds=...&keywords=...&locale=...`

Uses existing credential resolution + SigV4 signing from PTD helpers.

### Response

```json
{
  "ok": true,
  "productTypes": [
    {
      "name": "HAT",
      "displayName": "Hat",
      "marketplaceIds": ["ATVPDKIKX0DER"]
    }
  ]
}
```

No caching in v1 (optional future enhancement).

---

## Ready to Push Eligibility Fields

**View:** `v_amazon_ready_to_push_products` (migration `20260730`)

| Field | Logic |
|-------|--------|
| `has_stock` | `kk_stock > 0` |
| `has_image` | `primary_image_url` or `catalog_image_url` present |
| `has_category` | category name present |
| `has_price` | `kk_price > 0` |
| `eligibility_status` | `ready`, `needs_review`, or `blocked` |
| `eligibility_warnings` | text array of human-readable warnings |

### Eligibility rules

| Status | Condition |
|--------|-----------|
| `blocked` | Missing stock **or** missing price |
| `needs_review` | Missing image **or** missing category (and not blocked) |
| `ready` | All flags good |

### Warnings array

May include: `Missing stock`, `Missing price`, `Missing image`, `Missing category`.

---

## Frontend Search UI

Push modal fields:

- `#amazonProductTypeSearch` — keyword input
- `#amazonProductTypeResults` — selectable result buttons
- `data-action="search-amazon-product-types"` — runs search
- `data-action="select-amazon-product-type"` — fills `#amazonPushProductType`

After selecting a type, admin clicks **Load Requirements** (existing 2L flow). No automatic submit.

---

## Ready Card Behavior

| Status | Badge | Push / Create Draft | Continue Draft |
|--------|-------|---------------------|----------------|
| `ready` | Ready (green) | Enabled | Enabled if draft exists |
| `needs_review` | Needs Review (amber) | Enabled with warning styling | Enabled |
| `blocked` | Blocked (red) | **Disabled** | Enabled if draft exists |

Warning chips shown on card for each eligibility warning.

---

## Push Modal Eligibility Panel

When opening from a Ready to Push card with warnings:

> This product may need review before Amazon submission:
> - Missing image
> - Missing category

Informational only — local draft save is **not** blocked unless required fields are missing from the form.

---

## Blocked vs Allowed

| Action | Blocked product | Needs review | Ready |
|--------|-----------------|--------------|-------|
| Create Draft | ❌ | ✅ | ✅ |
| Push to Amazon (new) | ❌ | ✅ | ✅ |
| Continue existing draft | ✅ | ✅ | ✅ |
| Save draft in modal | ✅ (if opened via Continue) | ✅ | ✅ |
| Product type search | ✅ | ✅ | ✅ |

---

## Security Rules

| Rule | Status |
|------|--------|
| No Amazon listing write endpoints | ✅ |
| PTD search read-only only | ✅ |
| Admin JWT required for search | ✅ |
| No browser → Amazon calls | ✅ |
| No tokens/secrets in frontend | ✅ |

---

## Deploy

```bash
supabase db push
supabase functions deploy amazon-search-product-types
```

---

## Known Limitations

1. Product type search not cached — repeated searches hit Amazon
2. Eligibility does not check product type assigned on draft
3. `displayName` derived from Amazon `name` when API omits display label
4. Header Push uses product picker — see [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)
5. Blocked products remain visible in Ready to Push (for visibility)

---

## Recommended Next Phase

**2S** — ✅ [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)

**2T** — ✅ [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)

---

## Related Docs

- [`024_product_type_validation_preview.md`](024_product_type_validation_preview.md)
- [`028_ready_to_push_live.md`](028_ready_to_push_live.md)
- [`029_scheduled_verification_retry.md`](029_scheduled_verification_retry.md)
- [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)
- [`032_product_type_recommendation_submit_gate.md`](032_product_type_recommendation_submit_gate.md)
