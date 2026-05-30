# Actions & Push Flow (Phase 1B)

## Why This UX Pass Exists

Phase 1 built the dashboard shell (stats, filters, synced listing table). Phase 1B adds the **action layer** admins will need once Amazon SP-API is wired:

- Distinguish listings already mapped to KK vs products ready to push vs legacy Seller Central listings needing mapping
- Surface row-level actions without assuming eBay-style delete/recreate
- Preview guided flows for **Push to Amazon** and **Map Existing Listing**

All controls remain disabled placeholders. No API or Supabase wiring.

---

## Work Areas (View Tabs)

**Container:** `#amazonViewTabs`

| Tab | `data-view` | Count | Meaning |
|-----|-------------|-------|---------|
| Synced Listings | `synced` | 842 | Amazon listings linked to a KK product/SKU |
| Ready to Push | `ready-to-push` | 37 | KK catalog products not yet on Amazon |
| Needs Mapping | `needs-mapping` | 18 | Amazon listings exist but no KK link |
| Drafts / Issues | `drafts-issues` | 23 | Incomplete or problematic listings |

**Current state:** Tab switching, modals, and row action popovers are wired in Phase 2A (see `010_light_js_wiring.md`). Sync, export, save, and submit actions remain disabled.

---

## Synced vs Ready to Push vs Needs Mapping

### Synced Listings

Amazon offer is connected to a Karry Kraze product record. Future sync can update price, qty, and health from both sides.

**Example row actions:** View Details, Edit Listing, Sync SKU, View on Amazon

### Ready to Push

KK website product exists; no Amazon listing yet (or only a local draft). Admin prepares listing via push workflow.

**Future list actions:** Push to Amazon, Create Amazon Draft, Ignore / Do Not List

### Needs Mapping

Listing was created in Seller Central (or imported) before KK tracking existed. Must be linked—not blindly deleted.

**Future list actions:** Map to KK Product, Create KK Product from Amazon Listing, Ignore, Mark as Legacy

### Drafts / Issues

Subset of listings with incomplete submission or Amazon policy/attribute problems.

---

## Header Actions

| Button | `data-action` | Priority | Future behavior |
|--------|---------------|----------|-----------------|
| Sync Amazon | `sync-amazon` | Primary | Full/incremental SP-API sync |
| Push KK Product | `push-kk-product` | Secondary | Open `#amazonPushModal` for selected KK product |
| Import / Map Existing | `import-map-existing` | Secondary | Open `#amazonMappingModal` or import picker |
| Export | `export-listings` | Tertiary | CSV export of current view |

**Helper copy (below buttons):**  
*Existing Seller Central listings can be mapped later; new KK products can be prepared for Amazon from here.*

Replaces Phase 1 “Create Listing” with clearer Amazon-specific labels.

---

## Row Actions

**Trigger:** `data-action="row-menu"` + `data-listing-id` + `data-status`  
**Button:** Disabled **Actions ▾** only — menus are **not** shown open in the table or mobile cards.

**Template:** `#amazonRowActionMenuTemplate` — select variant by `data-menu-status`:

| `data-menu-status` | Menu items |
|--------------------|------------|
| `active` | View Details, Edit Listing, Sync SKU, View on Amazon |
| `low_stock` | View Details, Edit Listing, Sync SKU, View on Amazon |
| `out_of_stock` | Update Inventory, Sync SKU, View Details, View on Amazon |
| `draft` | Continue Draft, Preview Issues, Submit Later, Delete Draft |
| `issue` | Resolve Issue, View Issue Details, Sync SKU, View on Amazon |

**Preview card:** `#amazonActionMenuPreview` — subtle static reference below pagination; not a functional menu.

### Phase 2 JS pattern

1. Listen for click on `[data-action="row-menu"]`
2. Read `data-status` from button
3. Clone `[data-menu-status="…"]` from `#amazonRowActionMenuTemplate`
4. Position menu; set `aria-expanded="true"` on trigger
5. Wire item `data-action` handlers

### Row action `data-action` values

| Action | Used for |
|--------|----------|
| `view-details` | Listing detail panel |
| `edit-listing` | Edit Amazon fields |
| `sync-sku` | Single-SKU refresh |
| `view-on-amazon` | External Amazon URL |
| `resolve-issue` | Issue remediation |
| `view-issue-details` | Issue detail panel |
| `update-inventory` | Qty update |
| `continue-draft` | Resume push draft |
| `submit-later` | Snooze draft |
| `delete-draft` | Remove local draft (placeholder) |

---

## Push to Amazon Modal

**ID:** `#amazonPushModal`  
**Hidden by default:** `class="hidden"` + `aria-hidden="true"`  
**Opens from:** `push-kk-product` header action (future)

### Purpose

Guide admin through preparing a KK product for Amazon submission—without assuming every product needs a brand-new catalog page.

### Steps (static UX)

1. **Product Source** — Mock: Cat Ear Beanie, SKU `KK-BEANIE-CAT`, KK price, website stock; “Choose Different Product”
2. **Match or Create** — Radio cards: map to ASIN, new catalog listing, offer on existing catalog item
3. **Amazon Category / Product Type** — Marketplace, product type, browse node, required attributes placeholders
4. **Listing Details** — Title, brand, bullets, description, variation theme
5. **Pricing & Inventory** — Price, qty, FBM/FBA, handling time, est. fees/profit
6. **Images** — Main + gallery placeholders, image rule warning
7. **Review** — Summary panel

### Footer actions

| Button | `data-action` |
|--------|---------------|
| Save Draft | `save-amazon-draft` |
| Preview Issues | `preview-amazon-issues` |
| Submit to Amazon | `submit-amazon-listing` |
| Cancel | `close-push-modal` |

All disabled in Phase 1B.

---

## Map Existing Listing Modal

**ID:** `#amazonMappingModal`  
**Hidden by default:** `class="hidden"` + `aria-hidden="true"`  
**Opens from:** `import-map-existing` header action (future)

### Purpose

Connect Seller Central listings created outside KK admin to internal products. **Mapping is preferred over delete/recreate** until API research confirms otherwise.

### Sections

1. **Amazon Listing** — Mock ASIN `B0KK4LEGACY1`, Amazon SKU, title, status
2. **Suggested KK Matches** — Match cards with confidence (High / Medium)
3. **Mapping Method** — Map to KK product, create KK product from Amazon, mark legacy

### Footer actions

| Button | `data-action` |
|--------|---------------|
| Save Mapping | `save-amazon-mapping` |
| Review Details | `review-amazon-mapping` |
| Cancel | `close-mapping-modal` |

---

## Amazon-Specific Assumptions

- Karry Kraze **already sells on Amazon**; many listings predate this admin tool
- Some listings are **offers on existing ASINs**, not new catalog creations
- Amazon requires **category/product-type attributes** from SP-API schemas (loaded later)
- **Legacy listings** may need mapping, updating, or recreation depending on API support and ownership—not automatic deletion like early eBay migration

### Language to use

- “Map existing Seller Central listings before deciding whether to recreate them.”
- “Push KK products to Amazon when they are ready for marketplace listing.”
- “Amazon may require category-specific attributes before a listing can be submitted.”

### Language to avoid

- “We must delete and recreate Amazon listings.”

---

## Future API Wiring Notes

1. **View tabs** — Fetch counts from Supabase; render per-view tables
2. **Header actions** — Enable after auth; open modals with focus trap
3. **Push modal** — Load KK product, SP-API product type schema, submit via edge function
4. **Mapping modal** — Import unmapped Amazon SKUs; fuzzy-match KK catalog; persist mapping row
5. **Row menus** — Clone `#amazonRowActionMenuTemplate` by `data-menu-status`; position on `[data-action="row-menu"]` click
6. **Ready to Push view** — Query KK products without `amazon_listing_id`
7. **Needs Mapping view** — Query Amazon rows with `kk_product_id IS NULL`

**Phase 2K:** Local push draft save — [`023_push_draft_workflow.md`](023_push_draft_workflow.md)

Reference modals: `#amazonPushModal`, `#amazonMappingModal`  
Reference content wrapper: `#amazonListingsContent`
