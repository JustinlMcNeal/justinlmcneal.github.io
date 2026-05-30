# Listings Table & Mobile Cards

## Desktop Table

**Panel:** `#amazonViewSynced` (default visible view)

**Section:** `#amazonTableSection` (visible `lg+` only)

**Table ID:** `#amazonListingsTable`  
**Body ID:** `#amazonListingsBody`

### Columns

| Column | Notes |
|--------|-------|
| **Product** | Thumbnail placeholder, title, variant line |
| **ASIN** | Monospace; `—` for drafts |
| **SKU** | Karry Kraze / seller SKU |
| **Price** | Current Amazon offer price |
| **Amazon Fee** | Estimated referral + FBA (hidden below `xl`) |
| **Profit** | Estimated after fees and COGS (future) |
| **Inventory** | Unit count + low/out label |
| **Status** | Color-coded badge |
| **Last Synced** | Last successful sync timestamp (hidden below `xl`) |
| **Actions** | Row menu placeholder (`data-action="row-menu"`, `data-listing-id`, `data-status`) |

Sticky black header row; horizontal scroll on narrow desktop via `.amazon-table-scroll`.

### Row Actions (Phase 1B — cleaned)

Each row exposes a single disabled **Actions ▾** button only. No menus are rendered open in the table.

| Attribute | Purpose |
|-----------|---------|
| `data-action="row-menu"` | Opens menu in Phase 2 |
| `data-listing-id` | Target listing |
| `data-status` | Selects menu variant |
| `aria-haspopup="menu"` | Indicates future dropdown |
| `aria-expanded="false"` | Closed until wired |

**Button style:** white background, black border, uppercase label, disabled but readable (not heavily faded).

**Hidden template:** `#amazonRowActionMenuTemplate` — variants use `data-menu-status`: `active`, `low_stock`, `out_of_stock`, `draft`, `issue`. Phase 2 JS clones the matching variant and positions it on click.

**Preview card:** `#amazonActionMenuPreview` below pagination lists sample menu items per status (documentation only, not interactive).

See `008_actions_and_push_flow.md` for full action list and future wiring.

Other views (Ready to Push, Needs Mapping, Drafts / Issues) use card lists — see `009_view_sections.md`.

### Status Badges

| Status | Visual |
|--------|--------|
| Active | Green pill |
| Low Stock | Amber pill |
| Out of Stock | Gray pill |
| Draft | Blue pill |
| Issue | Red pill |

Each row uses `data-listing-id`, `data-status`, `data-asin`, and `data-sku` for future JS. Draft rows use an empty `data-asin`.

## Mock Products (Phase 1)

Eight placeholder rows represent typical Karry Kraze catalog items:

1. Blush Everyday Tote — Active  
2. Gold Layered Pendant Necklace — Active  
3. Oversized Cat Eye Sunglasses — Low Stock  
4. Woven Vegan Leather Clutch — Active  
5. Cherry Charm Keychain — Active  
6. Embroidered Baseball Cap — Out of Stock  
7. Cat Ear Beanie — Draft (no ASIN yet)  
8. Y2K Cup Charm Keychain — Issue  

Fake ASINs follow pattern `B0KK4…` for easy identification as mock data.

## Mobile Cards

**Section:** `#amazonMobileCards` (visible below `lg`)

Each card shows:

- Thumbnail, title, status badge
- Variant / issue hint line
- Grid: ASIN, SKU, Price, Profit, Inventory, Synced
- Full-width **Actions ▾** button (disabled, no open menu)

Cards mirror table data; in Phase 2 both views should render from the same data model. Mobile cards use the same `data-listing-id`, `data-status`, `data-asin`, and `data-sku` attributes as table rows.

## eBay Page Inspiration (Feature Only)

The eBay Listings admin page informed possible future columns/features **without copying its visual design**:

| eBay concept | Amazon equivalent (future) |
|--------------|----------------------------|
| Listing score / health | Listing issue flags, suppression reason |
| Est. profit with ad rate | Profit after referral + FBA fees |
| Quick filters (needs work, low score) | Issue / low stock / draft stalled |
| Bulk price/qty | Bulk update via feeds or API |
| Promoted listing ad rate | Optional PPC cost overlay (if tracked) |

Amazon-specific columns to consider later: FBA vs FBM, Buy Box status, fulfillment channel.

## Row Actions (Future)

Row menu may include:

- View on Amazon
- Edit listing
- Sync single SKU
- View issue details
- Link to KK product record
