# Phase 2J — Mapping Save + KK Product Link Workflow

First real Amazon listing → KK product mapping workflow. No SP-API writes.

**Prior:** [2G frontend wiring](020_frontend_live_wiring.md) · [2I incremental/full sync](021_incremental_full_sync.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-map-listing/index.ts` | Admin-only mapping save edge function |
| `supabase/migrations/20260724_amazon_unmapped_listings_view.sql` | `v_amazon_unmapped_listings` read view |
| `js/admin/amazon/mapping.js` | Needs Mapping tab, modal actions, refresh hooks |
| `js/admin/amazon/renderMapping.js` | Unmapped cards + product search result render |
| `docs/pages/admin/amazon/ux/022_mapping_save_workflow.md` | This document |

## Files Modified

| Path | Change |
|------|--------|
| `js/admin/amazon/api.js` | `fetchAmazonUnmappedListings`, `searchKkProducts`, `saveAmazonMapping`; synced filter `mapping_status=mapped` |
| `js/admin/amazon/tabs.js` | Dispatches `amazon:view-change` custom event |
| `js/admin/amazon/index.js` | Wires mapping module + post-sync/mapping refresh |
| `pages/admin/amazon.html` | Live Needs Mapping container, mapping modal product search + enabled footer actions |

---

## Backend: `amazon-map-listing`

**Route:** `POST /functions/v1/amazon-map-listing`

**Auth:** Admin JWT + `requireAdminJson()` → service role client for writes.

### Input

```json
{
  "amazonListingId": "uuid",
  "kkProductId": "uuid",
  "kkSku": "optional",
  "mappingStatus": "mapped",
  "mappingConfidence": "manual",
  "notes": "optional"
}
```

### Supported `mappingStatus`

| Status | KK product required | Behavior |
|--------|---------------------|----------|
| `mapped` | Yes | Validates listing + product; demotes prior `mapped` row to `legacy`; inserts new mapped row |
| `ignored` | No | Upserts ignored row; demotes prior mapped to legacy |
| `legacy` | No | Upserts legacy row; demotes prior mapped to legacy |
| `needs_review` | No | Upserts needs_review row |

### Response

```json
{
  "ok": true,
  "mappingId": "uuid",
  "amazonListingId": "uuid",
  "mappingStatus": "mapped"
}
```

### Safe errors

`unauthorized`, `forbidden`, `method_not_allowed`, `invalid_request`, `listing_not_found`, `product_not_found`, `database_error`, `server_misconfigured`

No raw DB errors. No SP-API calls.

---

## Read Model: Unmapped Listings

**View:** `v_amazon_unmapped_listings`

Listings with **no** active `mapped` row and **no** `ignored` / `legacy` row.

```sql
-- Simplified logic
WHERE NOT EXISTS (mapped)
  AND NOT EXISTS (ignored OR legacy)
```

**Granted:** `SELECT` to `authenticated`, `service_role`

**Frontend read:** `fetchAmazonUnmappedListings()` → Needs Mapping tab

---

## Synced Listings Filter

`fetchAmazonListings()` now filters:

```javascript
.eq("mapping_status", "mapped")
```

Only mapped listings appear in Synced Listings after refresh.

---

## Product Search

**Pattern:** Direct Supabase read (same as other admin pages).

`searchKkProducts(query)` queries `products` + `product_variants`:

- Active products only
- `name` or `code` ILIKE match (min 2 chars)
- Returns `id`, `name`, `code`, `price`, aggregated variant stock

No separate edge function required (authenticated product reads already used in admin).

---

## Frontend: Needs Mapping Tab

**Module:** `mapping.js`

- Lazy fetch when **Needs Mapping** tab selected (`amazon:view-change` event)
- Renders live cards from `v_amazon_unmapped_listings`
- Updates `#amazonTabNeedsMapping [data-count]` and `#amazonNeedsMappingCountLabel`
- **Map Listing** → opens `#amazonMappingModal` with listing hydrated
- **Ignore** on card → `saveAmazonMapping({ mappingStatus: "ignored" })` without modal

---

## Mapping Modal

**Hydrated fields:**

- Title, ASIN, seller SKU, marketplace, price, inventory, status

**Product search:**

- `#amazonMappingProductSearch` — debounced search
- `#amazonMappingProductResults` — clickable result cards
- `#amazonMappingSelectedProduct` — selected KK product summary

**Footer actions:**

| Action | `data-action` | Requires product |
|--------|---------------|------------------|
| Save Mapping | `save-amazon-mapping` | Yes |
| Mark Legacy | `mark-amazon-legacy` | No |
| Ignore Listing | `ignore-amazon-listing` | No |
| Cancel | `close-mapping-modal` | — |

After save: toast → close modal → refresh Needs Mapping + Synced Listings.

---

## Refresh Flow

| Event | Refreshes |
|-------|-----------|
| Mapping saved / ignored / legacy | Unmapped list + Synced listings |
| Amazon sync complete | Synced listings + unmapped list |

---

## Security Rules

| Rule | Implementation |
|------|----------------|
| No SP-API writes | Mapping is DB-only |
| No service role in browser | Edge function uses service role server-side |
| No token table reads in browser | Unchanged |
| Admin-only mapping writes | `requireAdminJson()` on edge function |
| Safe errors only | No raw Postgres messages to client |

---

## What Remains Unimplemented

- Auto-suggested KK matches (confidence scoring)
- Create new KK product from Amazon listing
- Push to Amazon
- Mapping undo / history UI
- Row action “Map” from Synced table
- Bulk map / bulk ignore

---

## Deployment Notes

```bash
supabase db push   # or apply migration 20260724
supabase functions deploy amazon-map-listing
```

---

## Validation Checklist

- [x] `amazon-map-listing` edge function created
- [x] Admin guard required
- [x] Listing + product validation for `mapped`
- [x] Statuses: mapped, ignored, legacy, needs_review
- [x] No Amazon write endpoints
- [x] Needs Mapping live read from view
- [x] Modal product search + save/ignore/legacy
- [x] Synced tab shows mapped only after refresh
- [x] Tab count updates
- [x] No secrets in frontend
- [x] JS modules under 500 lines

---

## Recommended Next Phase

**2K** — ✅ Local push draft — [`023_push_draft_workflow.md`](023_push_draft_workflow.md)

**2L** — SP-API submit (`putListingsItem` / `patchListingsItem`) behind edge functions.

**2L** — Scheduled sync + stale listing detection.

---

## Related Docs

- [`013_supabase_schema.md`](013_supabase_schema.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`021_incremental_full_sync.md`](021_incremental_full_sync.md)
- [`023_push_draft_workflow.md`](023_push_draft_workflow.md)
