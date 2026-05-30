# Future Improvements

Roadmap ideas beyond Phase 2 basic API wiring. Prioritize based on business impact and SP-API availability.

## Integration & Sync

- **Data model & sync strategy** — See `011_data_model_and_sync_strategy.md` (Phase 2B planning: tables, mapping, sync, push, edge functions)
- **Official SP-API research** — See `012_official_sp_api_research.md` (Phase 2D: verified APIs, schema adjustments, open questions)
- **Real Amazon SP-API sync** — Listings, inventory, pricing, catalog items
- **Scheduled sync** — Cron or edge function with configurable interval
- **Sync logs** — Timestamp, duration, rows updated, errors
- **Single-SKU refresh** — Row action without full catalog sync
- **API disconnected detection** — Token expiry alerts

## Listing Management

- **Bulk actions** — Price, quantity, status updates via feeds or batch API
- **Draft listings** — Create on KK first, publish via `#amazonPushModal` when ready
- **Legacy mapping** — Map Seller Central listings via `#amazonMappingModal` before considering recreation
- **Listing health / issues** — Suppression reasons, policy violations, missing attributes
- **Fulfillment status** — FBA vs FBM, inbound shipment qty
- **Buy Box status** — If available from competitive pricing APIs

## Financial & Pricing

- **Profit calculation** — COGS from KK product record + Amazon fees + optional FBA
- **Amazon vs Karry Kraze price comparison** — Highlight mismatches
- **Fee breakdown tooltip** — Referral, FBA, storage, optional PPC
- **Promotions / coupons** — If tracked on Amazon side

## Inventory

- **Inventory mismatch detection** — KK warehouse vs Amazon fulfillable qty
- **Low stock alerts** — Threshold rules per category or SKU
- **Reserved vs available** — FBA reserved inventory column

## Media & Quality

- **Listing image quality checks** — Resolution, white background, main image rules
- **Gallery sync** — Pull/push images between KK and Amazon

## UX Enhancements

- **View tabs** — Synced / Ready to Push / Needs Mapping / Drafts-Issues (`#amazonViewTabs`, Phase 1B)
- **Push & mapping modals** — `#amazonPushModal`, `#amazonMappingModal` (Phase 1B shells)
- **Activity history** — Who changed price/qty and when
- **Column customization** — Saved views per admin user
- **Keyboard shortcuts** — Search focus, navigate rows
- **Deep link to Seller Central** — Open ASIN in Amazon backend
- **Admin nav link** — Added in Phase 1 cleanup (`page_inserts/admin-nav.html`, next to eBay)

## Data & Analytics

- **Sales velocity on Amazon** — Units sold 7d/30d (if orders integrated)
- **Issue dashboard** — Dedicated panel for 23+ open issues
- **Export templates** — Custom CSV columns for accounting or repricing tools

## Technical

- **Shared listing module pattern** — Mirror `js/admin/ebayListings/` structure
- **Supabase tables** — Planned in `011_data_model_and_sync_strategy.md`: `amazon_listings`, `amazon_listing_mappings`, `amazon_sync_runs`, etc.
- **Edge functions** — Secure SP-API proxy (no secrets in browser); see edge function plan in `011_data_model_and_sync_strategy.md`
