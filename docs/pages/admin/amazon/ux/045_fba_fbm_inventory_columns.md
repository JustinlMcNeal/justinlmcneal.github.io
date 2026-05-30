# Phase 5F — FBA vs FBM / Reserved Inventory Columns

**Prior:** [5E listing health dashboard](044_listing_health_dashboard.md)

Surface **fulfillment channel** (FBA vs FBM) and **FBA inventory breakdown** (fulfillable, reserved, inbound) on the Synced listings table. Read-only — data comes from synced `amazon_listings` columns and workspace view labels.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `fulfillment_mode`, `fulfillment_channel_label`, `has_fba_reserved`, `has_fba_inbound` on workspace view | Live FBA Inventory API refresh from admin |
| Fulfillment column (FBA/FBM badge + channel) | FBA quantity PATCH (Seller Central only) |
| FBA Reserved / FBA Inbound columns (2xl+) | Mixed FBA+FBM offer split logic |
| Enhanced FBA inventory cell with reserved/inbound sublines | Buy Box / competitive pricing |
| `#amazonFulfillmentFilter` toolbar filter | New edge function |
| CSV + View Details modal fulfillment fields | |

---

## Part A — Read model

**Migration:** `20260806_amazon_fba_fulfillment_view.sql`

Extends `v_amazon_listing_workspace` (replaces 5E view definition):

| Column | Meaning |
|--------|---------|
| `fulfillment_mode` | `fba` \| `fbm` \| `unknown` |
| `fulfillment_channel_label` | `FBA`, `FBM`, raw channel code, or `Unknown` |
| `has_fba_reserved` | `fba_reserved_quantity > 0` |
| `has_fba_inbound` | `fba_inbound_quantity > 0` |

### Mode rules

| Condition | `fulfillment_mode` |
|-----------|-------------------|
| `is_fba_managed = true` | `fba` |
| `fulfillment_channel` or `fbm_quantity` present | `fbm` |
| Otherwise | `unknown` |

`is_fba_managed` matches patch/bulk logic (AMAZON/AFN channel or FBA qty with no FBM qty).

Existing raw columns (unchanged): `fulfillment_channel`, `fbm_quantity`, `fba_fulfillable_quantity`, `fba_reserved_quantity`, `fba_inbound_quantity`.

---

## Part B — Frontend

| File | Change |
|------|--------|
| `js/admin/amazon/listingFulfillment.js` | Badges, column markup, filter, CSV helpers |
| `js/admin/amazon/listingInventoryMismatch.js` | FBA rows use `fbaInventoryColumnMarkup` |
| `js/admin/amazon/renderListings.js` | Fulfillment + FBA Reserved/Inbound columns |
| `js/admin/amazon/listingsQuery.js` | `fulfillment` filter |
| `js/admin/amazon/listingsToolbar.js` | `#amazonFulfillmentFilter` |
| `js/admin/amazon/listingsExport.js` | Fulfillment + FBA qty columns |
| `js/admin/amazon/listingDetails.js` | Modal fulfillment breakdown |
| `js/admin/amazon/api.js` | Extended `LISTINGS_COLUMNS` |
| `pages/admin/amazon.html` | Table headers + filter |

### Table columns

| Column | Visibility | Content |
|--------|------------|---------|
| **Fulfillment** | xl+ | FBA/FBM badge + channel label |
| **Inventory** | all | FBM compare (5D) or FBA fulfillable + reserved/inbound subline |
| **FBA Reserved** | 2xl+ | Reserved qty (FBA rows only) |
| **FBA Inbound** | 2xl+ | Inbound qty (FBA rows only) |

### Fulfillment filter

| Value | Shows |
|-------|-------|
| *(empty)* | All |
| `fba` | FBA listings |
| `fbm` | FBM listings |
| `unknown` | Unknown mode |
| `has_reserved` | `has_fba_reserved` |
| `has_inbound` | `has_fba_inbound` |

---

## Deploy

```bash
supabase db push   # 20260806_amazon_fba_fulfillment_view.sql
```

Requires prior **5E** migration chain. FBA qty columns populate when sync writes `fba_*` fields from SP-API.

---

## Known limitations

- FBA reserved/inbound only as fresh as last listing sync (no dedicated FBA Inventory API cron in this phase)
- `fulfillment_mode` is derived; mixed FBA+FBM on one SKU is classified as FBA when `is_fba_managed`
- Reserved/Inbound columns hidden below `2xl` breakpoint (still in Inventory subline + CSV)

---

## Verification

1. FBA row shows indigo **FBA** badge and fulfillable + reserved/inbound sublines
2. FBM row shows **FBM** badge; Reserved/Inbound columns show n/a
3. Filter **FBA** / **Has FBA Reserved** works with other filters
4. CSV includes fulfillment mode + FBA qty columns
5. View Details modal shows fulfillment + FBA breakdown
6. Price/inventory mismatch and health columns still work

---

## Phase 5 complete

With 5F shipped, **Phase 5 — Financial, Inventory & Listing Health** is **100%**. Next: **Phase 6** polish — table settings shipped in [`046_table_settings.md`](046_table_settings.md).
