# Phase 2T — PTD itemName Recommendation + Pre-Submit Gate

**Prior:** [2R product type search + eligibility](030_product_type_search_and_eligibility.md) · [2S requeue + product picker](031_verify_requeue_and_product_picker.md)

Improve product type selection and live submit safety: title-based recommendations in the Push modal, optional recommendation metadata on drafts, and a stricter backend + frontend gate before live submit.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `itemName` / keyword product type recommendation | New Amazon listing write endpoints |
| Push modal **Recommend Product Type** + accept flow | Blocking picker selection for missing stock/price |
| Draft payload recommendation metadata | Bulk requeue / alerts (2U) |
| Stricter `amazon-submit-draft` readiness checks | Auto-run PTD on modal open |
| Live submit readiness checklist UI | |

---

## Part A — Product Type Recommendation (Backend)

**Function:** `amazon-search-product-types`

Optional request field:

```json
{
  "marketplaceId": "ATVPDKIKX0DER",
  "query": "Fuzzy Cat Ear Beanie",
  "source": "itemName"
}
```

Behavior:

1. When `source === "itemName"`, call SP-API `searchDefinitionsProductTypes` with `itemName` query param.
2. If `itemName` returns zero results, fall back to `keywords` with the same query (best-effort).
3. Manual keyword search unchanged when `source` is omitted.

Response adds:

```json
{
  "ok": true,
  "source": "itemName",
  "productTypes": [],
  "recommendedProductType": {
    "name": "HAT",
    "displayName": "Hat"
  }
}
```

Shared helpers: `pickRecommendedProductType()`, updated `searchDefinitionsProductTypes()` and `buildProductTypesSearchUrl()` in `amazonPtdUtils.ts`.

No caching added for recommendations.

---

## Part B — Push Modal Auto-Recommend (Frontend)

**Button:** `data-action="recommend-amazon-product-type"` — **Recommend Product Type**

Flow:

1. Read Amazon title from `#amazonPushAmazonTitle` (fallback: `#amazonPushProductTitle`).
2. Call `searchAmazonProductTypes({ source: "itemName", query: title })`.
3. Render result in `#amazonProductTypeRecommendation`.
4. **Accept Recommendation** → fills `#amazonPushProductType`; admin still clicks **Load Requirements**.

Manual **Search Product Types** flow unchanged.

---

## Part C — Draft Metadata

When saving a draft, optional `draft_payload.amazonProductTypeRecommendation`:

```json
{
  "source": "itemName",
  "recommendedProductType": "HAT",
  "accepted": true,
  "recommendedAt": "2026-05-29T12:00:00.000Z"
}
```

Stored via existing `amazon-save-draft` payload merge. Not required for submit.

---

## Part D — Stricter Live Submit Gate (Backend)

**Function:** `amazon-submit-draft`

Before live PUT, `evaluateDraftLiveSubmitReadiness()` requires:

| Check | Reason code |
|-------|-------------|
| `draft_status = ready_to_submit` | `draft_status_not_ready` |
| `product_type` present | `missing_product_type` |
| `last_validation_result` non-empty | `missing_last_validation_result` |
| PTD preview current for product type | `ptd_preview_required` |
| Amazon validation preview VALID/ACCEPTED | `amazon_validation_preview_required` |
| No open `source=validation` errors | `open_validation_errors` |
| No open `source=push` errors | `open_push_errors` |

Blocked response:

```json
{
  "ok": false,
  "error": "draft_not_ready",
  "reasons": ["missing_product_type", "ptd_preview_required"]
}
```

PTD freshness: `last_validation_result.previewedAt` must match current `product_type`, and `updated_at` must not be newer than the latest of PTD preview or Amazon submit preview timestamps (so submit preview alone does not invalidate PTD).

Existing env gate (`AMAZON_ENABLE_LIVE_SUBMIT`) and confirmation phrase unchanged.

---

## Part E — Frontend Submit Readiness

**Panel:** `#amazonPushSubmitReadiness`

Checklist items:

1. Product type selected
2. Amazon requirements loaded (required attributes list populated)
3. Local / PTD preview complete
4. Amazon submit preview valid
5. Ready for live submit (`ready_to_submit`)

`Submit to Amazon` enabled only when all pass. Backend remains final authority.

Hidden state fields: `#amazonPushPtdPreviewAt`, `#amazonPushPtdPreviewProductType`, `#amazonPushDraftUpdatedAt`, `#amazonPushAmazonPreviewAt`.

---

## Files

| File | Change |
|------|--------|
| `supabase/functions/amazon-search-product-types/index.ts` | itemName mode + recommendation |
| `supabase/functions/_shared/amazonPtdUtils.ts` | itemName URL + pick helper |
| `supabase/functions/_shared/amazonListingPayloadUtils.ts` | `evaluateDraftLiveSubmitReadiness()` |
| `supabase/functions/amazon-submit-draft/index.ts` | Stricter gate + reasons |
| `js/admin/amazon/api.js` | `source` param + `reasons` on errors |
| `js/admin/amazon/pushDraftPtd.js` | Recommend + accept flow |
| `js/admin/amazon/pushDraftLive.js` | Readiness checklist |
| `js/admin/amazon/pushDraft.js` | Wiring + draft metadata |
| `pages/admin/amazon.html` | Recommend UI + checklist |

---

## Security Rules

| Rule | Status |
|------|--------|
| No new Amazon write endpoints | ✅ |
| Recommendation via admin edge function only | ✅ |
| No browser → Amazon calls | ✅ |
| No secrets in frontend | ✅ |
| Live submit env gate + typed confirmation preserved | ✅ |

---

## Known Limitations

1. `itemName` recommendation is best-effort; Amazon may only match via keyword fallback.
2. Recommendation metadata is optional and not used to bypass submit gate.
3. **Load Requirements** is still a separate step after accepting a recommendation.
4. Client checklist can drift until refresh; backend gate is authoritative.
5. Saving draft after previews invalidates readiness until previews are re-run.

---

## Recommended Next Phase

**2U** — ✅ [`033_bulk_requeue_and_max_attempt_alerts.md`](033_bulk_requeue_and_max_attempt_alerts.md)

**2V** — Synced tab search/filter/export + row actions.

---

## Related Docs

- [`030_product_type_search_and_eligibility.md`](030_product_type_search_and_eligibility.md)
- [`025_submit_validation_preview.md`](025_submit_validation_preview.md)
- [`026_live_submit.md`](026_live_submit.md)
- [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)
