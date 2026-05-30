# View Sections (Phase 1C)

## Overview

The Amazon Listings page is organized into four **work area views**, controlled by tabs in `#amazonViewTabs`. Phase 1C adds static HTML panels for each view. Only **Synced Listings** is visible by default; the other three use Tailwind `hidden`.

Tab buttons are enabled in Phase 2A — `tabs.js` toggles panel visibility. See `010_light_js_wiring.md`.

---

## View Panels

| View | Panel ID | `data-amazon-view-panel` | Tab `data-view` | Default |
|------|----------|--------------------------|-----------------|---------|
| Synced Listings | `#amazonViewSynced` | `synced` | `synced` | Visible |
| Ready to Push | `#amazonViewReadyToPush` | `ready-to-push` | `ready-to-push` | Hidden |
| Needs Mapping | `#amazonViewNeedsMapping` | `needs-mapping` | `needs-mapping` | Hidden |
| Drafts / Issues | `#amazonViewDraftsIssues` | `drafts-issues` | `drafts-issues` | Hidden |

Each panel uses `role="tabpanel"` and `aria-labelledby` pointing to its tab button ID (`#amazonTabSynced`, etc.).

---

## 1. Synced Listings (`#amazonViewSynced`)

**Purpose:** Amazon listings already mapped to Karry Kraze products.

**Helper text:** *Amazon listings already connected to Karry Kraze products.*

**Contains:**

- Search/filters toolbar (`#amazonFilters`)
- Desktop table (`#amazonTableSection`, `#amazonListingsTable`)
- Mobile cards (`#amazonMobileCards`)
- Pagination (`#amazonPagination`)
- Action menu preview (`#amazonActionMenuPreview`)

**Future data source:** `amazon_listings` (or equivalent) where `kk_product_id IS NOT NULL` and status is synced.

**Primary actions:** Row menu (`row-menu`), header Sync / Export.

---

## 2. Ready to Push (`#amazonViewReadyToPush`)

**Purpose:** KK catalog products not yet on Amazon but eligible for push/draft prep.

**Helper text:** *Karry Kraze products that can be prepared for Amazon listing.*

**Mock products (4 of 37):**

| Product | SKU | KK Price | Stock | Readiness |
|---------|-----|----------|-------|-----------|
| Pearl Heart Shoulder Bag | KK-BAG-PEARL-HEART | $32.99 | 41 | Ready |
| Pink Rhinestone Sunglasses | KK-SUN-RHINE-PINK | $18.99 | 25 | Needs category |
| Mini Bow Charm Keychain | KK-KEY-BOW-MINI | $9.99 | 83 | Ready |
| Fuzzy Cat Ear Beanie | KK-BEANIE-FUZZY-CAT | $16.99 | 19 | Needs images |

**List container:** `#amazonReadyToPushList`

**Data attributes:** `data-kk-product-id`, `data-sku`, `data-readiness`

**Actions:**

| Button | `data-action` | Future behavior |
|--------|---------------|-----------------|
| Push to Amazon | `push-product-to-amazon` | Open `#amazonPushModal` with product |
| Create Draft | `create-amazon-draft` | Save local/remote Amazon draft |

**Future data source:** KK `products` where no Amazon listing mapping exists and product is eligible for marketplace.

---

## 3. Needs Mapping (`#amazonViewNeedsMapping`)

**Purpose:** Seller Central listings not linked to KK products.

**Helper text:** *Existing Seller Central listings that need to be connected to Karry Kraze products.*

**Mock listings (4 of 18):**

| Title | ASIN | Amazon SKU | Status | Suggested match | Confidence |
|-------|------|------------|--------|-----------------|------------|
| Blush Everyday Tote | B0KK4LEGACY1 | AMZ-BLUSH-TOTE-OLD | Active | KK-TOTE-BLSH | High |
| Gold Chain Mini Bag | B0KK4LEGACY2 | AMZ-GOLD-MINI-OLD | Active | KK-BAG-GOLD-CHAIN | Medium |
| Rhinestone Hair Clip Set | B0KK4LEGACY3 | AMZ-CLIP-RHINE-SET | Low Stock | None found | Low |
| Pink Travel Cosmetic Pouch | B0KK4LEGACY4 | AMZ-POUCH-PINK | Active | KK-POUCH-PINK-TRAVEL | High |

**List container:** `#amazonNeedsMappingList`

**Data attributes:** `data-asin`, `data-amazon-sku`, `data-confidence`

**Actions:**

| Button | `data-action` | Future behavior |
|--------|---------------|-----------------|
| Map Listing | `map-existing-listing` | Open `#amazonMappingModal` |
| Ignore | `ignore-amazon-listing` | Exclude from mapping queue |

**Future data source:** Amazon import rows with `kk_product_id IS NULL`, plus fuzzy match suggestions.

---

## 4. Drafts / Issues (`#amazonViewDraftsIssues`)

**Purpose:** Drafts, failed submissions, sync warnings, and listings needing review.

**Helper text:** *Amazon listings that need review before they can be synced or submitted.*

**Mock items (4 of 23):**

| Product | SKU | Type | Issue |
|---------|-----|------|-------|
| Cat Ear Beanie | KK-BN-CAT | Draft | Missing required Amazon category attributes |
| Y2K Cup Charm Keychain | KK-KY-CUP | Issue | Amazon rejected one image requirement |
| Oversized Cat Eye Sunglasses | KK-SUN-CAT | Low Stock Warning | Inventory below threshold |
| Vegan Leather Clutch | KK-CLT-SAND | Sync Warning | Price mismatch KK vs Amazon |

**List container:** `#amazonDraftsIssuesList`

**Actions:** `continue-amazon-draft`, `resolve-amazon-issue`, `update-amazon-inventory`, `review-amazon-sync`, `view-amazon-details`

**Future data source:** Listings with draft/issue/sync_warning flags from Amazon health API or internal rules.

---

## Future Tab Switching (Phase 2)

Implemented in Phase 2A via `js/admin/amazon/tabs.js`:

```js
// Pseudocode
function showAmazonView(viewKey) {
  document.querySelectorAll('[data-amazon-view-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.amazonViewPanel !== viewKey);
  });
  // Update tab aria-selected, optional filter toolbar visibility
}
```

Map tab `data-view` values to panel `data-amazon-view-panel` (same strings).

Optional: hide `#amazonFilters` when not on `synced` view.

---

## Shared Elements (Outside Panels)

These stay in `#amazonListingsContent` but outside view panels:

- Stats cards (`#amazonStats`)
- View tabs (`#amazonViewTabs`)

Modals remain outside `#amazonListingsContent`:

- `#amazonPushModal`
- `#amazonMappingModal`
- `#amazonRowActionMenuTemplate`
- State placeholders (`#amazonStateLoading`, etc.)
