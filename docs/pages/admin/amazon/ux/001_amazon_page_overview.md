# Amazon Listings Page — Overview

## Page Purpose

The Amazon Listings admin page is the central hub for viewing and managing Karry Kraze products listed on Amazon marketplaces. It gives admins a single dashboard to monitor listing health, inventory, pricing, fees, and sync status without leaving the Karry Kraze admin shell.

**Route:** `/pages/admin/amazon.html`  
**Admin nav:** Linked in `page_inserts/admin-nav.html` (desktop: “Amazon”; mobile: “Amazon Listings”), next to eBay.

## User Goals

- Quickly see how many listings are active, low on stock, or have issues
- Find a specific product by title, ASIN, or SKU
- Review price, estimated Amazon fees, and profit at a glance
- Identify listings that need attention (out of stock, draft, suppressed, etc.)
- Trigger sync, export, or listing actions from one place (future)

## Admin Goals

- Maintain parity between Karry Kraze catalog and Amazon listings
- Catch inventory and pricing problems before they affect sales
- Reduce time spent switching between Seller Central and internal tools
- Prepare for bulk operations and automated sync workflows

## Current Phase: Static UX/UI Only

This is **Phase 1 — UX/UI build only**.

| In scope | Out of scope |
|----------|--------------|
| Admin layout integration (`kkAdminNavMount`) | Amazon SP-API calls |
| Mock/placeholder listing data (8 sample rows) | Supabase reads/writes |
| Disabled header actions with `data-action` hooks | Real search/filter logic |
| Stats cards with fixed placeholder values | Backend edge functions |
| Desktop table + mobile card layouts | Auth beyond shared admin nav |
| Hidden state placeholders in HTML | Profit calculation from live COGS |

All buttons, filters, search, and pagination controls are visually complete but disabled or non-functional.

## Future Phase: Amazon API Integration

Phase 2 will wire the page to Amazon Selling Partner API (SP-API) and internal Karry Kraze data:

1. **Connection** — OAuth / refresh token storage for Seller Central
2. **Sync** — Pull listings, inventory, pricing, and status from Amazon
3. **Mapping** — Link Amazon SKUs/ASINs to Karry Kraze product records
4. **Actions** — Create/update listings, adjust price/qty, export CSV
5. **Health** — Surface suppression reasons, image issues, Buy Box status where available
6. **Logging** — Sync history and error reporting

The HTML structure uses stable IDs and `data-*` attributes to support this wiring without layout changes.

**Main content wrapper:** `#amazonListingsContent` — hide this block when showing loading/empty/error states in Phase 2.
