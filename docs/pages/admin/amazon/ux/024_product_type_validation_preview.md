# Phase 2L — Product Type Definitions + Validation Preview

Amazon Product Type Definitions (PTD) support for draft validation preview. No SP-API listing writes.

**Prior:** [2K push draft](023_push_draft_workflow.md) · [SP-API research](012_official_sp_api_research.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/_shared/amazonPtdUtils.ts` | PTD fetch/cache, schema parsing |
| `supabase/functions/_shared/amazonPtdAuthUtils.ts` | LWA + SigV4 credential resolution |
| `supabase/functions/_shared/amazonDraftValidationUtils.ts` | Local + PTD draft validation |
| `supabase/functions/amazon-product-type-definition/index.ts` | Admin PTD fetch + cache |
| `supabase/functions/amazon-preview-draft/index.ts` | Admin draft validation against PTD |
| `supabase/migrations/20260726_amazon_drafts_issues_view_ptd.sql` | Adds `last_validation_result` to drafts view |

## Files Modified

| Path | Change |
|------|--------|
| `js/admin/amazon/api.js` | `getAmazonProductTypeDefinition`, `previewAmazonDraft` |
| `js/admin/amazon/pushDraft.js` | Load/refresh schema, preview Amazon requirements |
| `js/admin/amazon/pushDraftPtd.js` | PTD modal helpers (load/preview) |
| `pages/admin/amazon.html` | PTD UI controls + attribute panels |

---

## Backend: `amazon-product-type-definition`

**Route:** `POST /functions/v1/amazon-product-type-definition`

**Auth:** `requireAdminJson()` → LWA refresh + SigV4 SP-API read.

**SP-API:** `GET /definitions/2020-09-01/productTypes/{productType}` (+ schema document download).

**Cache:** `amazon_product_type_cache` — key: seller account + marketplace + product type + requirements + locale. TTL: 7 days.

**Does not call:** `putListingsItem`, `patchListingsItem`, Feeds submit.

### Input

| Field | Required |
|-------|----------|
| `productType` | Yes |
| `marketplaceId` | Yes |
| `forceRefresh` | Optional (bypass cache) |

### Response (safe summary)

```json
{
  "ok": true,
  "source": "cache",
  "productType": "ACCESSORY",
  "requiredAttributes": ["brand", "item_name"],
  "recommendedAttributes": [],
  "attributeCount": 42
}
```

Safe errors: `unauthorized`, `forbidden`, `amazon_not_connected`, `token_missing`, `token_refresh_failed`, `ptd_request_failed`, `database_error`, `server_misconfigured`

---

## Backend: `amazon-preview-draft`

**Route:** `POST /functions/v1/amazon-preview-draft`

**Auth:** Admin-only. Loads draft (preferred) or inline payload preview.

**Behavior:**

1. Load draft from `amazon_listing_drafts`
2. Load/fetch PTD via shared cache helper
3. Merge local validation + PTD required/recommended checks
4. Update `validation_errors`, `last_validation_result`, `last_previewed_at`, `draft_status`, `product_type_version`
5. Sync `amazon_listing_issues` (`source=validation`)

**No Amazon submit.**

### Validation rules

| Check | Severity |
|-------|----------|
| Local: title, seller SKU | error |
| Local: price, quantity, product type | warning |
| PTD required attribute missing | error |
| PTD recommended attribute missing | warning |

Draft status: `needs_attributes` if any error; `draft` if warnings only; `ready_to_submit` if clean.

---

## Shared Helper: `amazonPtdUtils.ts`

- Build PTD URL + SigV4 GET
- Download schema document from PTD link
- Extract `required` array from JSON Schema (conservative)
- Map draft payload fields → Amazon attribute names (`title` → `item_name`, etc.)
- Cache read/write to `amazon_product_type_cache`

---

## Push Modal UI

| Control | Action |
|---------|--------|
| Load Requirements | `amazon-product-type-definition` (cache-first) |
| Refresh Schema | Same with `forceRefresh: true` |
| Preview Issues | Local save-draft preview (2K) |
| Preview Amazon Requirements | Save draft if needed → `amazon-preview-draft` |
| Submit to Amazon | **Disabled** |

Panels:

- `#amazonPushRequiredAttributes` — required PTD attributes
- `#amazonPushMissingAttributes` — gaps after preview
- `#amazonPushValidationPanel` — merged validation messages

---

## Drafts / Issues Tab

After Amazon preview, tab refreshes via existing `onDraftSaved` hook. Cards show updated issue count and draft status from `v_amazon_drafts_issues`.

---

## Security Rules

| Rule | Status |
|------|--------|
| No listing write endpoints | ✅ |
| No browser Amazon calls | ✅ |
| No tokens/secrets in frontend | ✅ |
| PTD via edge functions only | ✅ |
| Cache writes service role only | ✅ |
| Submit disabled | ✅ |

---

## Deployment

```bash
supabase db push
supabase functions deploy amazon-product-type-definition
supabase functions deploy amazon-preview-draft
```

---

## Known Limitations

1. Attribute mapping is conservative — not full JSON Schema traversal.
2. ✅ Product type search UI — [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
3. Complex nested Amazon attributes (e.g. full `purchasable_offer` object) not fully modeled.
4. Recommended attribute warnings capped to reduce noise.
5. Requires live Amazon connection for PTD fetch (cache reduces repeat calls).

---

## Recommended Next Phase

**2M** — ✅ Amazon submit validation preview — [`025_submit_validation_preview.md`](025_submit_validation_preview.md)

**2N** — ✅ Live submit — [`026_live_submit.md`](026_live_submit.md)

**2O** — Post-submit sync + published promotion.

---

## Related Docs

- [`023_push_draft_workflow.md`](023_push_draft_workflow.md)
- [`025_submit_validation_preview.md`](025_submit_validation_preview.md)
- [`026_live_submit.md`](026_live_submit.md)
- [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
- [`012_official_sp_api_research.md`](012_official_sp_api_research.md)
