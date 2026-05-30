# Phase 4C — Listing PATCH (Price / FBM Quantity)

**Prior:** [4F sync run history](036_sync_run_history_ui.md)

Admin-only `patchListingsItem` for updating **price** and/or **FBM quantity** on existing synced listings. All Amazon writes go through `amazon-patch-listing` edge function.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `patchListingsItem` price patch | Full attribute edit (title, bullets, images) |
| FBM `fulfillment_availability` quantity patch | FBA quantity changes |
| Validation preview + live apply | Browser Amazon calls |
| Row actions: Edit Listing, Update Inventory | Bulk PATCH |
| Post-patch single-SKU sync | Activity audit table (→ 6F) |

---

## Part A — Edge function

**Function:** `amazon-patch-listing`

| Method | Auth |
|--------|------|
| `POST` | Admin JWT |

### Env gate

| Variable | Purpose |
|----------|---------|
| `AMAZON_ENABLE_LIVE_PATCH=true` | Required for live apply (`preview: false`) |
| Same LWA/AWS env as sync/submit | SP-API signing |

Without live gate, **Preview** works; **Apply Update** returns `403 live_patch_disabled`.

### Input

```json
{
  "amazonListingId": "uuid",
  "price": 29.99,
  "quantity": 12,
  "preview": true
}
```

At least one of `price` or `quantity` required.

### Behavior

1. Load `amazon_listings` row (requires `product_type`, `seller_sku`, `marketplace_id`)
2. Reject FBA quantity patch (`fba_quantity_not_supported`)
3. Build JSON Patch ops:
   - `/attributes/purchasable_offer` for price
   - `/attributes/fulfillment_availability` for FBM qty
4. Call SP-API `PATCH` with optional `mode=VALIDATION_PREVIEW`
5. On live success: update local `amazon_listings` price/qty columns + run `single_sku` sync

### Errors

| Code | Meaning |
|------|---------|
| `live_patch_disabled` | Live gate off |
| `listing_not_found` | Bad id |
| `listing_not_patchable` | Missing product type |
| `fba_quantity_not_supported` | FBA-managed listing |
| `patch_rejected` | Amazon status not ACCEPTED/VALID |
| `invalid_price` / `invalid_quantity` | Validation |

---

## Part B — Shared utils

**File:** `supabase/functions/_shared/amazonListingPatchUtils.ts`

- `validateListingPatchInput`
- `buildListingPatchOperations`
- `patchListingsItemValidationPreview` / `patchListingsItemLiveUpdate`
- `applyLocalListingPatchUpdate`
- `isFbaManagedListing`

Uses SigV4 PATCH (same pattern as PUT submit).

---

## Part C — Frontend

| File | Role |
|------|------|
| `js/admin/amazon/listingPatch.js` | Modal hydrate, preview, apply |
| `js/admin/amazon/api.js` | `patchAmazonListing()` |
| `js/admin/amazon/modals.js` | `#amazonPatchModal` wiring |
| `js/admin/amazon/rowActions.js` | `edit-listing`, `update-inventory` |
| `pages/admin/amazon.html` | Patch modal markup |

**Edit Listing** — price + quantity fields  
**Update Inventory** — quantity only (out-of-stock menu)

Flow: Preview → optional issues list → Apply (confirm dialog) → refresh listings + sync log

---

## Security

- [x] No Amazon calls from browser
- [x] Admin JWT required
- [x] Live apply behind env gate (like live submit)
- [x] No secrets in frontend
- [x] `putListingsItem` not used for edits (PATCH only)

---

## Deployment

```bash
supabase functions deploy amazon-patch-listing
```

Set in Supabase secrets:

```bash
AMAZON_ENABLE_LIVE_PATCH=true
```

---

## Known limitations

- FBA quantity must be changed in Seller Central
- Requires `product_type` on listing row (from sync)
- No PATCH history table yet (6F)
- Price currency taken from listing row (default USD)
- Validation preview does not persist changes

---

## Recommended next phase

**4E — Bulk price/qty** (deferred) or **5A — Live profit column**.

---

## Manual test checklist

1. With live gate **off** — Preview works, Apply returns `live_patch_disabled`
2. With live gate **on** — Preview shows ACCEPTED/VALID
3. Apply updates Amazon + local row + appears after refresh
4. FBA listing — quantity patch blocked; price patch allowed
5. Row **Edit Listing** / **Update Inventory** opens modal with current values
