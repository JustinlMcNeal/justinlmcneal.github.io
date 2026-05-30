# Phase 2K — Push Draft Workflow (Local Only)

Local Push to Amazon draft workflow — saves to Supabase only. No SP-API writes.

**Prior:** [2J mapping save](022_mapping_save_workflow.md) · [2G frontend wiring](020_frontend_live_wiring.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-save-draft/index.ts` | Admin-only draft insert/update + validation issues |
| `supabase/migrations/20260725_amazon_drafts_issues_view.sql` | `v_amazon_drafts_issues` read view |
| `js/admin/amazon/pushDraft.js` | Push modal hydrate, save, preview |
| `js/admin/amazon/draftsIssues.js` | Drafts / Issues tab lazy load |
| `js/admin/amazon/renderDraftsIssues.js` | Draft card render |

## Files Modified

| Path | Change |
|------|--------|
| `js/admin/amazon/api.js` | `saveAmazonDraft`, `fetchAmazonDraftsIssues`, `fetchAmazonDraftById` |
| `js/admin/amazon/modals.js` | Async push hydrate; Continue/View Details actions |
| `js/admin/amazon/index.js` | Wire push + drafts modules |
| `pages/admin/amazon.html` | Editable push modal; live drafts container |

---

## Backend: `amazon-save-draft`

**Route:** `POST /functions/v1/amazon-save-draft`

**Auth:** `requireAdminJson()` → service role writes.

**Writes:** `amazon_listing_drafts`, `amazon_listing_issues` (source=`validation` only).

**Does not call:** Amazon SP-API, Feeds API, or any listing write endpoint.

### Input (summary)

| Field | Required |
|-------|----------|
| `kkProductId` | Yes |
| `marketplaceId` | Yes |
| `sellerSku` | Yes (non-empty) |
| `draftPayload.title` | Yes |
| `draftId` | Optional (update) |
| `action` | `save_draft` (default), `preview`, `save_ready` |

`pushWorkflow` fixed to `create_local_draft_only`.

### Local validation

| Check | Severity |
|-------|----------|
| Missing title | error |
| Missing seller SKU | error |
| Missing/invalid price | warning |
| Missing/invalid quantity | warning |
| Missing product type | warning |

### Draft status resolution

| Condition | Status |
|-----------|--------|
| Any error-level validation | `needs_attributes` |
| `preview` or `save_ready` with no errors | `ready_to_submit` |
| Warnings only | `draft` |

### Validation issues sync

- Deletes open `amazon_listing_issues` where `draft_id` + `source=validation`
- Inserts current validation rows (`issue_type=draft_validation`)
- Preserves sync/push/manual issues

### Response

```json
{
  "ok": true,
  "draftId": "uuid",
  "draftStatus": "draft",
  "validationErrors": []
}
```

Safe errors: `unauthorized`, `forbidden`, `method_not_allowed`, `invalid_request`, `product_not_found`, `marketplace_not_found`, `draft_not_found`, `database_error`, `server_misconfigured`

---

## Read View: `v_amazon_drafts_issues`

Joins `amazon_listing_drafts` + `products` + open issue counts.

Excludes `published` and `archived` drafts.

**Granted:** `SELECT` to `authenticated`, `service_role`

---

## Push Modal Behavior

**Open from:**

- Header **Push KK Product**
- Ready to Push **Push to Amazon** / **Create Draft** (mock cards — resolves KK product by SKU search)
- Drafts / Issues **Continue Draft** / **View Details**

**Editable fields:**

- Marketplace ID, seller SKU, product type, title, brand, price, quantity, condition, fulfillment, bullets, description

**Actions:**

| Button | `action` sent | Behavior |
|--------|---------------|----------|
| Save Draft | `save_draft` | Insert/update draft; close modal on success |
| Preview Issues | `preview` | Save + show validation panel; sets `ready_to_submit` if valid |
| Submit to Amazon | — | **Disabled** (future phase) |

**Hydrate:**

- From mock Ready to Push card → SKU lookup via `searchKkProducts`
- From existing draft → load from `v_amazon_drafts_issues`

---

## Drafts / Issues Tab

- Lazy load on `amazon:view-change` → `drafts-issues`
- Renders cards from `v_amazon_drafts_issues`
- Updates `#amazonTabDraftsIssues [data-count]`
- **Continue Draft** opens push modal with draft hydrated

---

## What Remains Disabled

- Submit to Amazon (`submit-amazon-listing`)
- SP-API product type schema load
- Image validation / upload
- Live Ready to Push product list (mock cards remain)
- Amazon catalog match radio workflow (removed from modal for 2K scope)

---

## Security Rules

| Rule | Status |
|------|--------|
| No SP-API writes | ✅ |
| No service role in browser | ✅ |
| No token table reads in browser | ✅ |
| Admin-only draft writes | ✅ |
| Submit disabled in UI | ✅ |

---

## Deployment

```bash
supabase db push
supabase functions deploy amazon-save-draft
```

---

## Known Limitations

1. Header Push without SKU requires product to be resolved via Ready to Push card or future product picker.
2. Mock Ready to Push uses fake numeric `data-kk-product-id`; real UUID resolved via SKU search.
3. No `save_ready` button in UI yet (preview sets `ready_to_submit`).
4. Synced listing issues not merged into Drafts tab (draft-linked issues only).
5. No Amazon submission or live listing creation.

---

## Recommended Next Phase

**2L** — ✅ PTD validation preview — [`024_product_type_validation_preview.md`](024_product_type_validation_preview.md)

**2M** — ✅ Amazon submit validation preview — [`025_submit_validation_preview.md`](025_submit_validation_preview.md)

**2N** — Live SP-API submit behind separate env gate.

**2O** — Live Ready to Push query + product type search UI.

---

## Related Docs

- [`008_actions_and_push_flow.md`](008_actions_and_push_flow.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)
- [`024_product_type_validation_preview.md`](024_product_type_validation_preview.md)
- [`025_submit_validation_preview.md`](025_submit_validation_preview.md)
- [`028_ready_to_push_live.md`](028_ready_to_push_live.md)
- [`031_verify_requeue_and_product_picker.md`](031_verify_requeue_and_product_picker.md)
