# Phase 4E — Bulk Price / Quantity Updates

**Prior:** [4D delete local draft](038_delete_local_draft.md)

Bulk update selected Synced listings via sequential `patchListingsItem` calls. Uses the Listings Items API (not Feeds) for batches under ~50 SKUs per request.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Row checkboxes + bulk bar on Synced tab | JSON_LISTINGS_FEED (large catalog loads) |
| 7 bulk operations (price/qty) | Listing status / suppression changes |
| Preview + live apply | Browser Amazon calls |
| Max **50** listings per edge request | Server-side selection persistence |
| Client batches >50 into multiple requests | Per-row post-patch single-SKU sync |

---

## Part A — Edge function

**Function:** `amazon-bulk-patch-listings`

| Method | Auth |
|--------|------|
| `POST` | Admin JWT |

### Env gate

Same as 4C: `AMAZON_ENABLE_LIVE_PATCH=true` required for live apply.

### Input

```json
{
  "amazonListingIds": ["uuid", "uuid"],
  "operation": "match_kk_price",
  "value": 29.99,
  "preview": true
}
```

### Operations

| Operation | Behavior |
|-----------|----------|
| `set_price` | Absolute price (`value` required) |
| `adjust_price_percent` | Current price × (1 + value/100) |
| `adjust_price_amount` | Current price + value |
| `match_kk_price` | `kk_price` from workspace view |
| `set_quantity` | Absolute FBM qty (`value` required) |
| `match_kk_stock` | `kk_stock` (FBM only) |
| `match_kk_price_and_stock` | Both KK fields (qty skipped for FBA) |

### Processing

1. Load rows from `v_amazon_listing_workspace`
2. Compute per-listing patch (skip `no_change`, fail FBA qty)
3. Sequential PATCH with **220ms** delay (~4.5 req/s)
4. Live: `applyLocalListingPatchUpdate` per success
5. Return per-row `success` / `failed` / `skipped` + summary

### Errors (request-level)

| Code | Meaning |
|------|---------|
| `batch_limit_exceeded` | >50 IDs |
| `live_patch_disabled` | Live gate off |
| `invalid_request` | Bad IDs/operation/value |

---

## Part B — Shared utils

**File:** `supabase/functions/_shared/amazonBulkPatchUtils.ts`

- `computeBulkPatchInput`
- `processBulkListingPatches`
- Reuses `amazonListingPatchUtils` for SP-API PATCH

---

## Part C — Frontend

| File | Role |
|------|------|
| `js/admin/amazon/listingsSelection.js` | Checkbox state, select filtered, bulk bar |
| `js/admin/amazon/bulkPatch.js` | Modal, preview/apply, result panel |
| `js/admin/amazon/renderListings.js` | Checkbox column (desktop + mobile) |
| `js/admin/amazon/liveListings.js` | Re-render preserves selection |
| `js/admin/amazon/api.js` | `bulkPatchAmazonListings()` |
| `pages/admin/amazon.html` | Bulk bar, modal, table header select-all |

### UX flow

1. Select rows (page, or **Select Filtered** for all filtered rows up to 500 loaded)
2. **Bulk Update** → choose operation
3. **Preview** → per-row validation results
4. **Apply Bulk Update** → confirm → refresh listings

---

## When to use Feeds instead

Per SP-API research (`012`): use **JSON_LISTINGS_FEED** when updating **>1,500 items / 5 min**. This phase targets day-to-day ops batches (tens of SKUs), not full-catalog repricing.

---

## Security

- [x] No Amazon calls from browser
- [x] Admin JWT + live patch env gate
- [x] Batch cap prevents edge timeout abuse

---

## Deployment

```bash
supabase functions deploy amazon-bulk-patch-listings
```

Requires `AMAZON_ENABLE_LIVE_PATCH=true` for live apply (same as 4C).

---

## Known limitations

- Status changes not implemented
- FBA quantity skipped per listing
- No bulk activity audit (→ 6F)
- Selection is in-memory only (clears on full refresh)
- Large selections >50 split client-side into sequential API calls

---

## Recommended next phase

**5B — Amazon fee breakdown** (Product Fees API tooltip).

---

## Manual test checklist

1. Select 2–3 listings → Match KK price → Preview shows ACCEPTED/VALID
2. Live apply updates Amazon + local rows after refresh
3. FBA listing in batch → qty op skipped, price still updates
4. Select >50 → client sends multiple batches without error
5. Live gate off → Preview OK, Apply returns `live_patch_disabled`
