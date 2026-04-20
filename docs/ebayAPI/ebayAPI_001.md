# eBay API Integration — Master Roadmap

> **Document:** `ebayAPI_001.md`
> **Last Updated:** April 20, 2026
> **Project:** Karry Kraze (karrykraze.com)
> **Status:** Phase 1 complete — 7 edge functions live, 8 planned

---

## Priority Tiers

| Tier | What | Why |
|------|------|-----|
| **Now** | Phase 1b (Enhanced Listing Features), thin Phase 2 (Webhooks) | Full listing parity with eBay Seller Hub + real-time orders |
| **Next** | Phase 3 (Inventory Sync), lightweight eBay performance reporting | Only after listings are stable and order flow is proven |
| **Later** | Phase 4 (Promoted Listings), Compliance, Competitor Pricing | Revenue growth & intelligence — gated on eBay volume justifying the investment |

---

## Table of Contents

1. [Current System Audit](#1-current-system-audit)
2. [Phase 1 — Listing Management + Taxonomy](#2-phase-1--listing-management--taxonomy)
2b. [Phase 1b — Enhanced Listing Features](#2b-phase-1b--enhanced-listing-features)
3. [Phase 2 — Real-Time Order Webhooks](#3-phase-2--real-time-order-webhooks)
4. [Phase 3 — Cross-Platform Inventory Sync](#4-phase-3--cross-platform-inventory-sync)
5. [Phase 4 — Promoted Listings (Marketing API)](#5-phase-4--promoted-listings-marketing-api)
6. [Phase 5 — Analytics, Compliance & Competitor Pricing](#6-phase-5--analytics-compliance--competitor-pricing)
7. [OAuth Scope Additions](#7-oauth-scope-additions)
8. [Database Migration Summary](#8-database-migration-summary)
9. [Edge Function Registry](#9-edge-function-registry)
10. [Dependency Graph](#10-dependency-graph)

---

## 1. Current System Audit

### 1.1 What's Built and Working

| Feature | Edge Function | CRON | Status |
|---------|--------------|------|--------|
| OAuth connection | `ebay-oauth-callback` | — | ✅ Live |
| Token refresh | `ebay-refresh-token` | — | ✅ Live (auto-refresh in sync functions) |
| Account deletion compliance | `ebay-account-deletion` | — | ✅ Live |
| Order sync (Fulfillment API) | `ebay-sync-orders` | Every 2h | ✅ Live |
| Financial transaction sync | `ebay-sync-finances` | Daily 6 AM UTC | ✅ Live |
| CSV order import | Client-side (`ebayImport.js`) | — | ✅ Live |
| CSV transaction import | Client-side (`importEbayTransactions.js`) | — | ✅ Live |

### 1.2 Edge Functions — Detail

#### `ebay-oauth-callback` (index.ts — ~107 lines)
- Exchanges eBay authorization code for access + refresh tokens
- Stores in `marketplace_tokens` table (upsert on `platform = 'ebay'`)
- Refresh token valid for 18 months; access token for 2 hours
- Auth: Basic Auth (Base64 of `clientId:clientSecret`)
- RuName: `Justin_Mcneal-JustinMc-KarryK-ipqfyelqa`
- Deployed with `--no-verify-jwt`

#### `ebay-refresh-token` (index.ts — ~97 lines)
- Standalone access token refresh endpoint
- Called by admin settings UI "Refresh Token" button
- Scopes: `api_scope`, `sell.fulfillment`, `sell.inventory`, `sell.finances`
- Also called internally by `getAccessToken()` in sync functions (auto-refresh with 5-min buffer)

#### `ebay-sync-orders` (index.ts — ~270 lines)
- **Input:** `{ days_back: N }` (default 7, max 90). CRON sends 3, manual sends 30.
- **Flow:**
  1. `getAccessToken()` — reads `marketplace_tokens`, auto-refreshes if < 5 min remaining
  2. Loads all products from `products` table for fuzzy matching
  3. `fetchEbayOrders()` — paginated GET `/sell/fulfillment/v1/order` (limit=50, filtered by `creationdate`)
  4. Deduplicates against existing `orders_raw` (checks both `ebay_api_` and `ebay_` prefixed session IDs)
  5. `matchProduct()` per line item — 4-tier fuzzy matching:
     - Exact normalized match
     - Strip bracket text, re-check
     - Substring containment
     - Token-overlap with stemming (≥2 shared stems)
  6. Inserts `orders_raw` + `line_items_raw` rows
  7. `fetchOrderFulfillments()` — tracking number, carrier, shipped date
  8. Upserts `fulfillment_shipments` with status mapping: `FULFILLED`→`shipped`, `IN_PROGRESS`→`label_purchased`, else→`pending`
- **Session ID format:** `ebay_api_{orderId}`
- **kk_order_id format:** `EBAY-{orderId}`

#### `ebay-sync-finances` (index.ts — ~275 lines)
- **Input:** `{ days_back: N }` (default 30, max 365). CRON sends 30, manual sends 90.
- **API:** `GET https://apiz.ebay.com/sell/finances/v1/transaction` (paginated, limit=200)
- **Transaction handling:**
  | Type | Action | Destination |
  |------|--------|-------------|
  | `SALE` | Aggregate fees per month (FVF, fixed per-order, regulatory) | `expenses` (category "Fees", vendor "eBay") |
  | `SHIPPING_LABEL` | Update label cost per order | `fulfillment_shipments.label_cost_cents` |
  | `NON_SALE_CHARGE` | Individual expense rows (subscriptions, ad fees) | `expenses` (category "Software", vendor "eBay") |
  | `REFUND`, `CREDIT` | Skipped (handled elsewhere) | — |
- **Dedup:** Checks `notes` column with `ilike` before inserting

#### `ebay-account-deletion` (index.ts — ~62 lines)
- eBay Marketplace Account Deletion compliance (required by eBay policy)
- GET: SHA-256 challenge verification (`challengeCode + verificationToken + endpointUrl`)
- POST: Acknowledgement (returns 200 always)
- Env vars: `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT`

### 1.3 Admin UI

All eBay controls live on **`pages/admin/settings.html`** under "Marketplace Integrations":

| Control | Action |
|---------|--------|
| **Connect eBay** | Redirects to `auth.ebay.com/oauth2/authorize` with client_id, scopes, runame |
| **Sync Orders** | POST to `ebay-sync-orders` with `days_back: 30` |
| **Sync Finances** | POST to `ebay-sync-finances` with `days_back: 90` |
| **Refresh Token** | POST to `ebay-refresh-token` |
| **Disconnect** | DELETE `marketplace_tokens?platform=eq.ebay` |

Status indicators: green dot (connected, token valid), yellow (token expiring), gray (disconnected). Shows token expiry timestamp and last sync time.

### 1.4 Client-Side Import Tools

| File | Purpose |
|------|---------|
| `js/admin/lineItemsOrders/ebayImport.js` (~610 lines) | eBay "Orders Report" CSV parser. Drag-and-drop import with fuzzy product matching. Session IDs: `ebay_{orderNumber}` |
| `js/admin/expenses/importEbayTransactions.js` (~310 lines) | eBay "Transaction Report" CSV parser. Imports shipping label costs + selling fees + subscription charges |

Both share the same `matchProduct()` algorithm (code duplication with the edge function).

> **Deprecation note:** CSV imports are legacy tooling from before the API integration existed. Once Phase 1 (listing management) and Phase 2 (webhooks) are stable and proven, disable CSV import paths to eliminate dual-ingestion complexity. All order and transaction data should flow through the API sync.

### 1.5 Database Schema (eBay-relevant)

#### `marketplace_tokens`
| Column | Type | eBay Usage |
|--------|------|------------|
| `platform` | text (UNIQUE) | `'ebay'` |
| `access_token` | text | 2-hour expiry, auto-refreshed |
| `refresh_token` | text | 18-month expiry |
| `token_expires_at` | timestamptz | Used by `getAccessToken()` to decide if refresh needed |
| `scopes` | text | `"User Access Token"` |
| `extra` | jsonb | `{ connected, connected_at, refresh_token_expires_at }` |

#### `orders_raw` (eBay rows)
| Field | API Import | CSV Import |
|-------|-----------|------------|
| `stripe_checkout_session_id` | `ebay_api_{orderId}` | `ebay_{orderNumber}` |
| `kk_order_id` | `EBAY-{orderId}` | `EBAY-{salesRecordNumber}` |

#### `line_items_raw` (eBay rows)
| Field | API Import | CSV Import |
|-------|-----------|------------|
| `stripe_line_item_id` | `ebay_li_{lineItemId}` | `ebay_{orderNumber}_li_{transactionId}` |
| `product_id` | KK code (fuzzy matched) or null | KK code (fuzzy matched) or null |

#### `fulfillment_shipments` (eBay rows)
- Upserted on `stripe_checkout_session_id`
- `label_cost_cents` starts at 0, updated by `ebay-sync-finances` or CSV transaction import

#### `expenses` (eBay rows)
- `vendor = 'eBay'`, `category = 'Fees'` (selling) or `'Software'` (subscriptions)
- Dedup key: `notes` column containing `Ref: {refId}`

#### Views used by eBay orders
- `v_order_summary`, `v_order_financials`, `v_order_summary_plus`, `v_order_lines`, `v_order_refunds`

### 1.6 Active CRON Jobs

| Job | Schedule | Function | Payload |
|-----|----------|----------|---------|
| `ebay-sync-orders-every-2h` | `0 */2 * * *` | `ebay-sync-orders` | `{ "days_back": 3 }` |
| `ebay-sync-finances-daily` | `0 6 * * *` | `ebay-sync-finances` | `{ "days_back": 30 }` |

### 1.7 Current OAuth Scopes

```
api_scope
sell.fulfillment          ← orders
sell.inventory            ← listings (Phase 1 — active)
sell.finances             ← fees/transactions
sell.account              ← business policies (added Phase 1)
sell.account.readonly     ← policy reads (added Phase 1)
```

> **Note:** `prompt=login` is appended to the OAuth URL to force eBay re-consent when scopes change. Without it, eBay caches the previous authorization grant and auto-connects without showing the consent screen for new scopes.

### 1.8 eBay Credentials (Reference)

| Item | Value |
|------|-------|
| Client ID | `JustinMc-KarryKra-PRD-e6c1164ac-5c2cbd4a` |
| Dev ID | `69930660-e185-4bf8-85cd-9c68f3b80f55` |
| RuName | `Justin_Mcneal-JustinMc-KarryK-ipqfyelqa` |
| Deletion Verification Token | *(stored in Supabase secrets — `EBAY_VERIFICATION_TOKEN`)* |
| API Base (Production) | `https://api.ebay.com` |
| Finances API Base | `https://apiz.ebay.com` |

### 1.9 Known Issues & Tech Debt

> ⚠️ Items 1 and 4 should be resolved **before or during Phase 1**. Letting matching and SKU discipline drift will cause reconciliation bugs as eBay scales.

1. **~~🔴 Fuzzy matching code duplication (HIGH)~~** ✅ **RESOLVED (Phase 1)** — `matchProduct()`, `norm()`, `stem()` consolidated into `supabase/functions/_shared/ebayUtils.ts`. `ebay-sync-orders` refactored to import from the shared module. CSV import remains legacy with its own copy but is deprecated.
2. **🟡 SKU discipline** — CSV imports use `ebay_{orderNumber}` while API uses `ebay_api_{orderId}`. Dedup logic must check both prefixes everywhere. Works but fragile. **Action:** Standardize on API-format IDs going forward; CSV import is legacy.
3. **No buyer email** — eBay Fulfillment API does not expose buyer email. `orders_raw.customer_email` is always null for eBay orders.
4. **eBay Client ID exposed in client-side code** — `settings.html` contains the client ID inline. Low risk (it's a public identifier), but the client secret is server-side only.

---

## 2. Phase 1 — Listing Management + Taxonomy

> **Priority:** ✅ **COMPLETE** (April 19, 2026)
> **Prerequisite:** None (uses existing `sell.inventory` scope)
> **Also includes:** Resolve fuzzy matching duplication + SKU discipline (tech debt items 1 & 2)

### 2.1 Goal

Manage eBay listings directly from the admin panel instead of Seller Hub. Create, edit, publish, revise, and end listings using the Inventory API. Migrate all existing Seller Hub listings to API-managed.

### 2.1a Success Criteria

Phase 1 is **done** when all of the following are true:

- [x] Admin can create a draft listing from any product in the products table
- [x] Category suggestion works — top 3 suggestions shown with confidence scores
- [x] Required item specifics are surfaced clearly; admin can fill in missing fields *(auto-fetches aspects via `get_aspects` when category selected; required fields validated before create; Brand pre-filled as "Unbranded")*
- [x] Offer publishes successfully → listing goes live on eBay
- [x] Product row stores `ebay_offer_id`, `ebay_listing_id`, `ebay_status` after publish
- [x] Existing Seller Hub listings have been migrated and remain editable through admin *(N/A — no existing Seller Hub listings to migrate; migration function built and ready if needed)*
- [x] Price and quantity can be revised from admin → live listing updates
- [x] `matchProduct()` duplication is resolved (single source of truth for fuzzy matching)
- [x] End listing (withdraw) works and updates `ebay_status = 'ended'`
- [x] Listing visually verified on eBay frontend — Cherry Necklace (KK-0039) listing `377126818883` published successfully with correct title, image, category (155101), and item specifics (Brand, Style, Type, Material, Theme, Color)

### 2.2 eBay Inventory API Flow

```
Step 1: Create Inventory Item    →  PUT /sell/inventory/v1/inventory_item/{sku}
        (title, description, images, condition, quantity)

Step 2: Create Offer              →  POST /sell/inventory/v1/offer
        (price, eBay category, fulfillment/return/payment policies, marketplace)

Step 3: Publish Offer             →  POST /sell/inventory/v1/offer/{offerId}/publish
        (makes it a live listing, returns eBay listing ID)
```

**Editing:** PUT inventory item (full replacement) → offer auto-updates live listing.
**Quick updates:** `POST /sell/inventory/v1/bulk_update_price_quantity` → batch price/qty changes.

### 2.3 Listing Migration Strategy

> **Decision:** All existing Seller Hub listings will be migrated to API-managed.

Listings created via eBay Inventory API **cannot** be edited in Seller Hub and vice versa. Since we want full admin control, we must migrate existing listings first:

```
POST /sell/inventory/v1/bulk_migrate_listing
Body: { "requests": [{ "listingId": "123456789" }, ...] }
```

This converts traditional listings into Inventory API items + offers. Original listing IDs are preserved. After migration, Seller Hub becomes read-only for those listings.

**Migration steps:**
1. Pull all active listing IDs from Seller Hub (can query via Trading API `GetMyeBaySelling` or manually export)
2. Call `bulk_migrate_listing` in batches of 25
3. Store returned `inventoryItemGroupKey` / `offerId` in our products table
4. Verify each migrated listing is still live and unchanged

### 2.4 Taxonomy API Integration

The Taxonomy API (public, no seller auth needed) provides:
- **Category suggestions** — given a product title, returns best-fit eBay categories with confidence scores
- **Required item specifics** — per-category list of required/recommended fields (Brand, Type, Material, etc.)

**Integration with listing flow:**
1. Admin clicks "List on eBay" → auto-call `GET /commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q={productTitle}`
2. Show top 3 suggested categories with confidence percentages
3. Admin selects category → fetch `GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id={id}`
4. Auto-fill knowable fields: Brand = "Unbranded", Condition = "New" *(see Brand Rule below)*
5. Highlight missing required fields for admin to fill in
6. Cache `categoryId → itemAspects` mapping in `ebay_category_cache` table (refresh monthly)

**Category tree ID:** `0` = eBay US (EBAY_US marketplace)

> **Brand Rule (single source of truth):** Default Brand to **"Unbranded"** on all listings. Karry Kraze is not a registered brand on eBay, so "Unbranded" is the correct eBay-compliant value. The admin can override to a different brand per-listing if reselling a branded item. This applies everywhere: push modal auto-fill, edit modal pre-fill, and aspect validation.

### 2.5 New Edge Functions

#### `ebay-manage-listing` — ✅ DEPLOYED
Unified handler — accepts `{ action, ...params }`:

| Action | eBay Endpoint | Input | Output | Status |
|--------|---------------|-------|--------|--------|
| `create_item` | `PUT /inventory_item/{sku}` | product data | `{ sku }` | ✅ Tested |
| `create_offer` | `POST /offer` | price, categoryId, policies | `{ offerId }` | ✅ Tested |
| `publish` | `POST /offer/{offerId}/publish` | offerId | `{ listingId }` | ✅ Tested |
| `update_item` | `PUT /inventory_item/{sku}` | revised data | `{ sku }` | ✅ Tested |
| `update_offer` | `PUT /offer/{offerId}` | revised price/qty | `{ offerId }` | ✅ Tested |
| `withdraw` | `POST /offer/{offerId}/withdraw` | offerId | `{ success }` | ✅ Tested |
| `delete_item` | `DELETE /inventory_item/{sku}` | sku | `{ deleted }` | ✅ Tested |
| `get_item` | `GET /inventory_item/{sku}` | sku | `{ item }` | ✅ Tested |
| `list_items` | `GET /inventory_item?limit=100` | offset | `{ items[] }` | ✅ Tested |
| `get_offers` | `GET /offer?sku={sku}` | sku | `{ offers[] }` | ✅ Built |
| `bulk_update` | `POST /bulk_update_price_quantity` | `{ items[] }` | `{ responses[] }` | ✅ Built |
| `get_policies` | `GET /account/v1/{policy_type}` | — | `{ policies }` | ✅ Tested |
| `opt_in_policies` | `POST /account/v1/program/opt_in` | — | `{ success }` | ✅ Tested |
| `create_default_policies` | `POST /account/v1/{policy_type}` | — | `{ created }` | ✅ Tested |
| `setup_location` | `POST /inventory_location/{key}` | locationKey | `{ success }` | ✅ Tested |

#### `ebay-migrate-listings` — ✅ DEPLOYED
Migration + scan handler:

| Action | eBay Endpoint | Input | Output | Status |
|--------|---------------|-------|--------|--------|
| `scan` | `GET /inventory_item` | — | `{ items[], matches[] }` | ✅ Built |
| `link` | DB update | `{ sku, productId }` | `{ success }` | ✅ Built |
| `auto_link` | scan + fuzzy match + DB | — | `{ linked[] }` | ✅ Built |

#### `ebay-taxonomy` — ✅ DEPLOYED
Public API wrapper (uses application token, not user token):

| Action | eBay Endpoint | Input | Output | Status |
|--------|---------------|-------|--------|--------|
| `suggest_category` | `GET /category_tree/0/get_category_suggestions` | `{ query }` | `{ suggestions[] }` | ✅ Tested |
| `get_aspects` | `GET /category_tree/0/get_item_aspects_for_category` | `{ categoryId }` | `{ aspects[] }` | ✅ Built (30-day cache) |

#### `_shared/ebayUtils.ts` — ✅ DEPLOYED
Shared module used by all eBay edge functions:

| Export | Purpose |
|--------|---------|
| `EBAY_API` | Base URL constant (`https://api.ebay.com`) |
| `corsHeaders` | Standard CORS headers |
| `createServiceClient()` | Supabase service role client |
| `getAccessToken(supabase)` | User token with auto-refresh |
| `getAppToken()` | Application token (client credentials) |
| `KKProduct`, `norm()`, `stem()` | Fuzzy matching utilities |
| `matchProduct()` | 4-tier product matcher (single source of truth) |

### 2.6 Database Changes

#### New columns on `products` table

| Column | Type | Purpose |
|--------|------|---------|
| `ebay_sku` | text | SKU on eBay (defaults to product `code`, e.g. `KK-0013`) |
| `ebay_offer_id` | text | eBay offer ID (set after publish) |
| `ebay_listing_id` | text | eBay item/listing ID (for direct links to ebay.com) |
| `ebay_status` | text | `'not_listed'` / `'draft'` / `'active'` / `'ended'` |
| `ebay_category_id` | text | eBay category ID for the listing |
| `ebay_price_cents` | integer | eBay-specific price (may differ from website price) |

```sql
ALTER TABLE products
  ADD COLUMN ebay_sku text,
  ADD COLUMN ebay_offer_id text,
  ADD COLUMN ebay_listing_id text,
  ADD COLUMN ebay_status text DEFAULT 'not_listed',
  ADD COLUMN ebay_category_id text,
  ADD COLUMN ebay_price_cents integer;
```

#### New table: `ebay_category_cache`

| Column | Type | Purpose |
|--------|------|---------|
| `category_id` | text (PK) | eBay category ID |
| `category_name` | text | Human-readable name |
| `aspects` | jsonb | Required/recommended item specifics |
| `cached_at` | timestamptz | When this was last fetched |

### 2.7 Admin UI — New Page: `pages/admin/ebay-listings.html`

| Section | Features | Status |
|---------|----------|--------|
| **Products Table** | All products with eBay status badge (Active / Draft / Not Listed / Ended), eBay price, bulk checkboxes, action buttons per status | ✅ Built |
| **Push to eBay** | Select product → auto-fills form → category suggestion → item specifics (auto-fetched, required validated, Brand pre-filled) → 3-step publish | ✅ Built |
| **Edit Listing** | Click active/draft listing → fetches current data from eBay via `get_item` + `get_offers` → edit title, description, price, quantity, condition, aspects → saves via `update_item` + `update_offer` | ✅ Built |
| **Bulk Actions** | Checkbox selection on active/draft listings → bulk update price or quantity via `bulk_update_price_quantity` → updates eBay + local DB | ✅ Built |
| **End Listing** | Withdraw offer (removes from eBay, keeps inventory item for easy re-list) | ✅ Built |
| **Re-list** | Ended listings show "Re-list" button → opens push modal to re-create | ✅ Built |
| **Migrate** | Scan eBay inventory + auto-link to KK products | ✅ Built |

### 2.8 Data Flow: Listing a Product

```
Admin clicks "List on eBay" for KK-0013 (Cherry Bag Charm)
  │
  ├─ 1. ebay-taxonomy: suggest_category("Cherry Bag Charm Keychain")
  │     → returns: [{ categoryId: "169291", name: "Keychains", confidence: 0.92 }, ...]
  │
  ├─ 2. Admin picks category → ebay-taxonomy: get_aspects(169291)
  │     → returns: [{ name: "Brand", required: true }, { name: "Material", required: false }, ...]
  │     → Auto-fill: Brand = "Unbranded", Condition = "New"
  │     → Admin fills remaining required fields
  │
  ├─ 3. ebay-manage-listing: create_item
  │     → PUT /inventory_item/KK-0013
  │     → { condition: "NEW", product: { title, description, imageUrls, aspects }, availability: { quantity: 10 } }
  │
  ├─ 4. ebay-manage-listing: create_offer
  │     → POST /offer { sku: "KK-0013", marketplaceId: "EBAY_US", format: "FIXED_PRICE",
  │         pricingSummary: { price: { value: "8.99", currency: "USD" } },
  │         categoryId: "169291", listingPolicies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId } }
  │
  ├─ 5. ebay-manage-listing: publish
  │     → POST /offer/{offerId}/publish
  │     → Returns { listingId: "123456789012" }
  │
  └─ 6. Update products table:
        ebay_sku = 'KK-0013', ebay_offer_id = '{offerId}',
        ebay_listing_id = '123456789012', ebay_status = 'active',
        ebay_category_id = '169291', ebay_price_cents = 899
```

### 2.9 One-Time Setup Prerequisites

1. ✅ **Opt into Business Policies** — `POST /sell/account/v1/program/opt_in` (program `SELLING_POLICY_MANAGEMENT`). **Done April 19, 2026.**
2. ✅ **Create fulfillment, return, and payment policies** — Created via API. Policy IDs stored as Supabase secrets:
   - `EBAY_FULFILLMENT_POLICY_ID` = `266551432012` (Standard Shipping — free USPS First Class, 3-day handling)
   - `EBAY_RETURN_POLICY_ID` = `266551433012` (30-Day Returns — buyer pays return shipping)
   - `EBAY_PAYMENT_POLICY_ID` = `266551437012` (Immediate Payment — eBay managed payments)
3. **Enable Out-of-Stock Control** — keeps listings alive at 0 quantity instead of ending them (`POST /sell/account/v1/program/opt_in` for `OUT_OF_STOCK_CONTROL`). Recommended by eBay. *(Not yet done — do before scaling listings.)*
4. ✅ **Set up inventory location** — Created via API. `EBAY_LOCATION_KEY` = `default` (set as Supabase secret). Address: 1283 Lynx Crt, Hampton, GA 30228.

### 2.10a Lessons Learned

| Issue | Root Cause | Fix Applied |
|-------|-----------|-------------|
| `Content-Language` header on GET requests | eBay Inventory API rejects `Content-Language` on requests without a body | Only send `Content-Language` when body is present |
| Invalid `Accept-Language` default | Deno runtime sends an invalid `Accept-Language` header | Explicitly set `Accept-Language: en-US` on all requests |
| Location API uses POST not PUT | eBay `createInventoryLocation` uses POST | Corrected method in edge function |
| OAuth re-consent not triggered | eBay caches previous authorization, auto-connects without showing consent for new scopes | Added `prompt=login` to OAuth URL |
| Business policies not eligible | Must opt in to SELLING_POLICY_MANAGEMENT before creating policies | Added `opt_in_policies` action |
| Payment policy creation fails with `paymentMethods` | eBay managed payments doesn't accept `PERSONAL_CHECK` method | Removed `paymentMethods` array, use `immediatePay: true` only |
| `products.price` treated as cents | `price` column stores dollars (e.g. 14.97), not cents | Fixed admin UI to not divide by 100 |

### 2.10 API Constraints

- SKU max length: 50 chars (KK codes are ~7 chars — fits easily)
- Max 24 images per listing (we typically have 3-5)
- Images must be HTTPS (Supabase Storage URLs qualify)
- `Content-Language: en-US` header required on all Inventory API calls
- Listings can be revised up to 250 times per calendar day
- Batch operations: `bulkCreateOrReplaceInventoryItem` supports up to 25 items at once
- Rate limit: 5,000 calls/day (generous for our ~55 products)

---

## 2b. Phase 1b — Enhanced Listing Features

> **Priority:** ✅ **COMPLETE** (April 19, 2026)
> **Prerequisite:** Phase 1 complete (all infrastructure in place)
> **Scope additions:** None — all features use existing `sell.inventory` + `sell.account` scopes
> **Goal:** Bring the admin Push/Edit modals to full parity with eBay's "Revise Your Listing" page

### 2b.0 Gap Summary

| Feature | eBay API Field | Current State | Impact |
|---------|---------------|---------------|--------|
| Multi-image (up to 24) | `product.imageUrls[]` | ✅ Full gallery support (drag reorder, up to 24) | 🔴 HIGH — multi-image = higher conversion |
| HTML description | `product.description` | ✅ Quill rich text + raw HTML + Preview modes | 🔴 HIGH — formatted descriptions look professional |
| Best Offer / Allow Offers | `offer.listingPolicies.bestOfferTerms` | Not exposed | 🟡 MEDIUM — enables negotiation on higher-priced items |
| Package weight & dimensions | `inventoryItem.packageWeightAndSize` | Not sent | 🟡 MEDIUM — required for calculated shipping |
| Policy picker (ship/return/pay) | `offer.listingPolicies.*PolicyId` | Hardcoded to defaults | 🟡 MEDIUM — needed when multiple policies exist |
| Store category | `offer.storeCategoryNames[]` | Not exposed | 🟢 LOW — organizational, not buyer-facing |
| International shipping | Via fulfillment policy selection | Not exposed | 🟡 MEDIUM — handled by policy picker |
| Item location override | `offer.merchantLocationKey` | Hardcoded to "default" | 🟢 LOW — single location currently |
| Volume pricing | Not in Inventory API | No support | 🟢 LOW — requires Marketing API (`sell.marketing`) |

### 2b.1 Multi-Image Management

**Current problem:** Push/Edit modals send only `[catalog_image_url]` — every eBay listing has exactly 1 image. eBay allows up to 24 and multi-image listings get significantly better placement.

**What we already have:**
- `product_gallery_images` table with `product_id`, `url`, `position`, `is_active` columns
- Full admin gallery management in `js/admin/products/modalEditor.js` (drag-and-drop reordering, upload, remove)
- Products also have `catalog_image_url`, `catalog_hover_url`, `primary_image_url`
- Supabase Storage bucket `products` with `catalog/` and `gallery/` folders
- All URLs are HTTPS (Supabase Storage) — eBay requires HTTPS ✅

**Implementation:**

1. **Data layer** — Update `loadProducts()` query to join `product_gallery_images`:
   ```js
   const { data } = await supabase
     .from("products")
     .select("*, product_gallery_images(url, position, is_active)")
     .order("code");
   ```

2. **Push modal** — Build `imageUrls[]` from all available sources:
   ```
   Priority order:
     1. catalog_image_url (main listing image — always position 0, the search-result hero)
     2. primary_image_url (if different from catalog)
     3. catalog_hover_url (if different from above)
     4. product_gallery_images (sorted by position, is_active = true)
   Dedup by URL, cap at 24
   ```

   **Dedupe & ordering rule:** After collecting all URLs, deduplicate by exact string match. The resulting array order is the final eBay image order — `imageUrls[0]` is always the search-result hero image (catalog_image_url). Do not re-sort after dedup; preserve the priority-order insertion sequence.

3. **Edit modal** — Show current eBay images from `get_item` response as a thumbnail grid. Allow reordering (drag-and-drop) and toggling individual images on/off. When saving, send the full reordered `imageUrls[]` to `update_item`. First image in the array = eBay main photo (shown in search results).

4. **Image preview section** — Both modals get a visual image strip:
   ```html
   <div class="flex gap-2 overflow-x-auto">
     <!-- 60×60 thumbnails with drag handles and X remove buttons -->
     <!-- First image = eBay main photo (shown in search results) -->
   </div>
   <p class="text-[10px] text-gray-400">Drag to reorder. First image = main photo. Max 24.</p>
   ```

5. **Edge function** — No changes needed. `create_item` and `update_item` already pass `product.imageUrls` array. Just need UI to build the full array.

**API mapping:**
```json
PUT /sell/inventory/v1/inventory_item/{sku}
{
  "product": {
    "imageUrls": [
      "https://...supabase.co/.../catalog/main.jpg",
      "https://...supabase.co/.../gallery/angle2.jpg",
      "https://...supabase.co/.../gallery/detail.jpg"
    ]
  }
}
```

### 2b.2 HTML Description Editor

**Current problem:** Description field is a plain `<textarea>`. eBay's `product.description` supports full HTML, and most competitive listings use formatted descriptions with headers, bullet points, and styled layouts.

**Approach:** Use [Quill.js](https://cdn.quilljs.com/) — lightweight rich text editor available via CDN (no build step, matches our vanilla JS stack). Outputs clean HTML.

**Implementation:**

1. **CDN includes** — Add to `ebay-listings.html` `<head>`:
   ```html
   <link href="https://cdn.quilljs.com/1.3.7/quill.snow.css" rel="stylesheet">
   <script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
   ```

2. **Push modal** — Replace `<textarea id="modalDescription">` with a Quill container:
   ```html
   <div id="modalDescriptionEditor" style="height: 150px;"></div>
   ```
   Initialize Quill with a limited toolbar (eBay prohibits JavaScript, iframes, forms, and active content):
   ```js
   const quill = new Quill('#modalDescriptionEditor', {
     theme: 'snow',
     modules: {
       toolbar: [
         ['bold', 'italic', 'underline'],
         [{ 'header': [2, 3, false] }],
         [{ 'list': 'ordered' }, { 'list': 'bullet' }],
         [{ 'color': [] }],
         ['clean']
       ]
     }
   });
   ```

3. **Edit modal** — Same Quill editor, pre-filled with existing HTML description from `get_item` response via `quill.root.innerHTML = product.description`.

4. **Collecting value** — When saving, read `quill.root.innerHTML` and pass as `product.description`.

5. **HTML template wrapper** — Wrap the Quill output in a minimal eBay-safe template:
   ```html
   <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
     <h2 style="color: #333;">${title}</h2>
     ${quillHtml}
     <p style="margin-top: 20px; font-size: 12px; color: #666;">
       Thank you for shopping with Karry Kraze! 💕
     </p>
   </div>
   ```
   Store the template wrapper logic client-side. Admin edits the content; wrapper is applied on create/update.

6. **eBay HTML restrictions** — The following are prohibited and must NOT be in descriptions:
   - `<script>`, `<iframe>`, `<form>`, `<input>` tags
   - External CSS `@import` or `<link>` tags
   - JavaScript event handlers (`onclick`, etc.)
   - Active content of any kind
   Quill's limited toolbar prevents all of these naturally.

7. **Client-side sanitization** — Even though Quill's toolbar prevents most bad output, sanitize the final HTML before sending to eBay as a safety net:
   ```js
   function sanitizeForEbay(html) {
     const div = document.createElement('div');
     div.innerHTML = html;
     // Remove all script, iframe, form, input, link, style tags
     div.querySelectorAll('script,iframe,form,input,link,style,object,embed,applet')
        .forEach(el => el.remove());
     // Remove event handler attributes from all elements
     div.querySelectorAll('*').forEach(el => {
       [...el.attributes].forEach(attr => {
         if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
       });
     });
     return div.innerHTML;
   }
   ```
   Call `sanitizeForEbay(quill.root.innerHTML)` before wrapping in the branded template. This catches edge cases like pasted content that bypasses the toolbar.

**Edge function** — No changes needed. `product.description` already accepts a string; HTML is sent as-is.

### 2b.3 Best Offer / Allow Offers

**Current problem:** No way to enable "Allow Offers" on a listing. Buyers can't negotiate, which hurts conversion on higher-priced items.

**eBay API field:** `offer.listingPolicies.bestOfferTerms`

```json
{
  "listingPolicies": {
    "bestOfferTerms": {
      "bestOfferEnabled": true,
      "autoAcceptPrice": { "value": "14.99", "currency": "USD" },
      "autoDeclinePrice": { "value": "10.00", "currency": "USD" }
    }
  }
}
```

**Implementation:**

1. **Push modal UI** — Add after the Price/Quantity grid:
   ```html
   <div>
     <label class="flex items-center gap-2 cursor-pointer">
       <input type="checkbox" id="modalBestOffer" class="accent-kkpink" />
       <span class="text-[11px] font-black uppercase tracking-[.12em] text-black/70">Allow Offers</span>
     </label>
     <div id="bestOfferFields" class="hidden grid grid-cols-2 gap-3 mt-2">
       <div>
         <label>Auto Accept ($)</label>
         <input id="modalAutoAccept" type="number" step="0.01" />
         <p class="text-[10px] text-gray-400">Offers at or above auto-accepted</p>
       </div>
       <div>
         <label>Minimum Offer ($)</label>
         <input id="modalAutoDecline" type="number" step="0.01" />
         <p class="text-[10px] text-gray-400">Offers below auto-declined</p>
       </div>
     </div>
   </div>
   ```
   Toggle checkbox shows/hides the price fields.

2. **Edit modal UI** — Same fields, pre-filled from `get_offers` response (`offer.listingPolicies.bestOfferTerms`).

3. **Edge function update** — `create_offer` and `update_offer` actions need to accept and pass `bestOfferTerms`:
   ```typescript
   // In create_offer:
   if (body.bestOfferTerms?.bestOfferEnabled) {
     offer.listingPolicies.bestOfferTerms = {
       bestOfferEnabled: true,
       autoAcceptPrice: { value: body.bestOfferTerms.autoAcceptPrice, currency: "USD" },
       autoDeclinePrice: { value: body.bestOfferTerms.autoDeclinePrice, currency: "USD" },
     };
   }

   // In update_offer — merge into existing offer:
   if (body.bestOfferTerms !== undefined) {
     updatedOffer.listingPolicies = {
       ...(existing.listingPolicies || {}),
       bestOfferTerms: body.bestOfferTerms.bestOfferEnabled
         ? { bestOfferEnabled: true, ... }
         : { bestOfferEnabled: false },
     };
   }
   ```

4. **DB tracking** — No new columns needed. Best offer settings live on eBay's side and are fetched via `get_offers` when editing.

### 2b.4 Package Weight & Dimensions

**Current problem:** No package info sent to eBay. Required for calculated shipping rates. Without it, eBay can't calculate shipping costs and may default to flat rate or free shipping (depending on fulfillment policy).

**eBay API field:** `inventoryItem.packageWeightAndSize`

```json
{
  "packageWeightAndSize": {
    "dimensions": {
      "height": 1.0,
      "length": 7.0,
      "width": 5.0,
      "unit": "INCH"
    },
    "weight": {
      "value": 5.0,
      "unit": "OUNCE"
    },
    "packageType": "MAILING_OR_SHIPPING"
  }
}
```

**Implementation:**

1. **Push modal UI** — Add a collapsible "Package Details" section:
   ```html
   <details>
     <summary class="text-[11px] font-bold uppercase tracking-wider text-gray-500">
       📦 Package Weight & Dimensions
     </summary>
     <div class="grid grid-cols-4 gap-2 mt-2">
       <div>
         <label>Weight (oz)</label>
         <input id="modalWeightOz" type="number" step="0.1" min="0" />
       </div>
       <div>
         <label>Length (in)</label>
         <input id="modalDimL" type="number" step="0.1" min="0" />
       </div>
       <div>
         <label>Width (in)</label>
         <input id="modalDimW" type="number" step="0.1" min="0" />
       </div>
       <div>
         <label>Height (in)</label>
         <input id="modalDimH" type="number" step="0.1" min="0" />
       </div>
     </div>
   </details>
   ```

2. **Edit modal UI** — Same fields, pre-filled from `get_item` response (`item.packageWeightAndSize`).

3. **Edge function update** — `create_item` and `update_item` need to accept and pass `packageWeightAndSize`:
   ```typescript
   if (product.packageWeightAndSize) {
     invItem.packageWeightAndSize = product.packageWeightAndSize;
   }
   ```

4. **Smart defaults** — Most KK products are lightweight jewelry/accessories. Pre-fill with sensible defaults:
   - Weight: 4 oz (typical for jewelry/accessories)
   - Dimensions: 6×4×1 in (small padded envelope)
   - Package type: `MAILING_OR_SHIPPING`

   > **Future alignment note:** These defaults should eventually align with any Shippo/fulfillment package presets used elsewhere in the system. Not a blocker for Phase 1b, but prevents eBay listing data and actual fulfillment data from drifting apart over time.

### 2b.5 Shipping / Return / Payment Policy Picker

**Current problem:** All listings hardcoded to the 3 default policies stored as Supabase secrets. Can't use different shipping rates for heavier items, different return policies for custom orders, etc.

**What we already have:**
- `get_policies` action in `ebay-manage-listing` — fetches all 3 policy types
- Policies displayed in the Setup panel

**Implementation:**

1. **Push modal UI** — Add a collapsible "Policies" section with 3 dropdowns:
   ```html
   <details>
     <summary class="text-[11px] font-bold uppercase tracking-wider text-gray-500">
       📋 Listing Policies
     </summary>
     <div class="space-y-2 mt-2">
       <select id="modalFulfillmentPolicy"><!-- populated from get_policies --></select>
       <select id="modalReturnPolicy"><!-- populated --></select>
       <select id="modalPaymentPolicy"><!-- populated --></select>
     </div>
   </details>
   ```
   Pre-select the default policy in each dropdown. Populated once on page load (cache the policies).

2. **Edit modal UI** — Same dropdowns, pre-selected based on the offer's current `listingPolicies.*PolicyId` from `get_offers`.

3. **Edge function** — `create_offer` already accepts `policies` object. No edge function changes needed — just need UI to pass selected IDs.

4. **Policy cache** — Fetch policies once on page load, store in a JS variable. The Setup panel already calls `get_policies` — reuse the same call.

5. **International shipping** — This is handled through the fulfillment policy itself. If the admin creates a fulfillment policy with international shipping options (in Seller Hub or via API), it appears in the dropdown. No separate toggle needed — picking a different fulfillment policy = picking different shipping options.

### 2b.6 Store Category

> **Lowest priority in Phase 1b.** If time or scope gets tight, cut this feature first. It's organizational (seller storefront only), not buyer-facing in search results.

**Current problem:** Listings don't assign a store category. Items show up under "Other" in the eBay storefront, making the store look unorganized.

**eBay API field:** `offer.storeCategoryNames[]` — array of category path strings

```json
{
  "storeCategoryNames": ["Jewelry", "Accessories"]
}
```

> **Note:** Store categories are created/managed in eBay Seller Hub or via the Trading API's `SetStoreCategories`. The `storeCategoryNames` field on the offer references existing store categories by name.

**Implementation:**

1. **Fetch store categories** — Add a new `get_store_categories` action to `ebay-manage-listing` if eBay provides an Inventory API endpoint. Otherwise, hardcode the known store categories as a simple JS array (we know our categories: Headwear, Jewelry, Bags, Accessories, Plushies, Lego, etc.).

2. **Push/Edit modal UI** — Add a dropdown after category selection:
   ```html
   <select id="modalStoreCategory">
     <option value="">— None —</option>
     <option value="Jewelry">Jewelry</option>
     <option value="Accessories">Accessories</option>
     <!-- etc. -->
   </select>
   ```
   Auto-suggest based on the KK product's category.

3. **Edge function** — `create_offer` needs to include `storeCategoryNames` in the offer body.

### 2b.7 Item Location Override

**Current problem:** All listings use `merchantLocationKey = "default"`. Only matters if we add multiple shipping locations in the future.

**Implementation:** Low priority — skip for now. If a second location is ever created, add a location dropdown to the push/edit modals populated from a `list_locations` action. The `create_offer` and `update_offer` calls already pass `merchantLocationKey`.

### 2b.8 Volume Pricing

**Current problem:** No volume pricing support. eBay's "Add volume pricing" feature lets sellers offer tiered discounts (e.g., buy 2 get 5% off).

**Limitation:** The Inventory API **does not support volume pricing tiers directly**. eBay's volume pricing on the listing page uses the Trading API's `DiscountPriceInfo` field or the Marketing API's item promotion endpoints.

**Options:**
1. **Marketing API approach** — Use `POST /sell/marketing/v1/item_promotion` to create a volume/order discount. Requires `sell.marketing` scope (planned for Phase 4).
2. **Trading API approach** — Use `ReviseItem` with `DiscountPriceInfo` to add volume pricing to an existing listing. This would require the Trading API XML calls, which we don't currently use.
3. **Skip for now** — Volume pricing is a conversion optimization, not a listing requirement. Defer to Phase 4 when `sell.marketing` scope is added for Promoted Listings anyway.

**Decision:** Defer to Phase 4. When we add `sell.marketing` scope for Promoted Listings, we'll also add volume pricing via item promotions. No action needed in Phase 1b.

### 2b.9 Implementation Order

Build in three passes. Each pass ends with a verification checkpoint.

**Pass 1 — Listing Quality** ✅ COMPLETE (April 19, 2026)

| Step | Feature | Touches | Effort | Status |
|------|---------|---------|--------|--------|
| 1 | Multi-image | UI only (push + edit modals, `loadProducts` query) | Medium | ✅ Done |
| 2 | HTML description | UI only (Quill CDN + Visual/HTML/Preview modes + sanitize) | Small | ✅ Done |

> **Checkpoint:** Revise one live listing with multiple images + HTML description. Verify on eBay before proceeding.

**Pass 1 Features Delivered:**
- `buildImageUrls(product)` — collects images from catalog→primary→hover→gallery, dedupes, caps at 24
- `renderImageStrip()` — 60×60 draggable thumbnails with X remove, first=main photo
- `showGalleryPicker()` — clickable unused gallery images to add
- Quill.js rich text editor (Visual mode) with limited eBay-safe toolbar
- Raw HTML textarea (HTML mode) for complex styled descriptions with grids/flexbox
- `isComplexHtml()` detection — auto-routes complex HTML to textarea mode, prevents Quill crashes
- Preview tab — iframe with `srcdoc` renders description as buyers will see it
- `sanitizeForEbay()` — strips scripts/iframes/forms/event handlers
- `wrapDescription()` — branded template wrapper (Visual mode only)

**Pass 2 — Listing Infrastructure** ✅ COMPLETE (April 19, 2026)

| Step | Feature | Touches | Effort | Status |
|------|---------|---------|--------|--------|
| 3 | Policy picker | UI only (populate dropdowns from cached `get_policies`) | Small | ✅ Done |
| 4 | Package weight/dimensions | UI + edge function (`create_item`, `update_item`) | Small | ✅ Done |

**Pass 2 Features Delivered:**
- Collapsible "📋 Listing Policies" section in both Push and Edit modals
- 3 dropdowns (Shipping, Returns, Payment) populated from cached `get_policies` call
- Default policies pre-selected: fulfillment 266551432012, return 266551433012, payment 266551437012
- Policy selection passed through to `create_offer` and `update_offer`
- Collapsible "📦 Package Weight & Dimensions" section in both modals
- Smart defaults: 4 oz weight, 6×4×1 in dimensions (typical jewelry/accessories)
- Edit modal pre-fills package data from existing eBay item (`item.packageWeightAndSize`)
- Edit modal pre-fills policy dropdowns from existing offer (`offer.listingPolicies.*PolicyId`)
- Edge function updated: accepts `packageWeightAndSize` field and passes to eBay Inventory API

**Pass 3 — Nice-to-Have** ✅ COMPLETE (April 19, 2026)

| Step | Feature | Touches | Effort | Status |
|------|---------|---------|--------|--------|
| 5 | Best Offer | UI + edge function (`create_offer`, `update_offer`) | Medium | ✅ Done |
| 6 | Store category | UI + edge function (`create_offer`, `update_offer`) | Small | ✅ Done |

**Pass 3 Features Delivered:**
- "Allow Offers" checkbox with auto-accept/auto-decline price fields in Push and Edit modals
- Checkbox toggles visibility of price threshold inputs
- Edge function passes `bestOfferTerms` to eBay on create_offer and update_offer
- Edit modal pre-fills Best Offer state from existing offer `listingPolicies.bestOfferTerms`
- Store Category dropdown (Headwear, Jewelry, Bags, Accessories, Plushies, Lego) in both modals
- Edge function passes `storeCategoryNames[]` to eBay on create_offer and update_offer
- Edit modal pre-fills Store Category from existing offer

**Skipped / Deferred**

| Step | Feature | Reason |
|------|---------|--------|
| — | Item location | Single location, no action needed |
| — | Volume pricing | Deferred to Phase 4 (`sell.marketing` scope) |

### 2b.10 Edge Function Changes Required

**`ebay-manage-listing` updates:**

| Action | Change | Fields Added |
|--------|--------|-------------|
| `create_item` / `update_item` | Accept `packageWeightAndSize` | `{ dimensions, weight, packageType }` |
| `create_offer` | Accept `bestOfferTerms`, `storeCategoryNames` | `{ bestOfferEnabled, autoAcceptPrice, autoDeclinePrice }`, `["category"]` |
| `update_offer` | Accept `bestOfferTerms`, `storeCategoryNames` | Same as create_offer |

**No new edge functions needed.** All features use existing `ebay-manage-listing` actions — just need to pass additional fields through.

### 2b.11 Success Criteria

Phase 1b is **done** when:

- [x] Push/Edit modals show all product gallery images and send full `imageUrls[]` to eBay (up to 24)
- [x] Description field uses a rich text editor (Quill) that outputs eBay-safe HTML
- [x] "Allow Offers" toggle with auto-accept/auto-decline price fields works on create and edit
- [x] Package weight + dimensions can be set per listing and are sent to eBay
- [x] Admin can pick shipping/return/payment policies from dropdowns (not hardcoded)
- [x] Store category can be assigned to listings
- [ ] At least one listing has been revised with multiple images + HTML description and verified on eBay

---

## 3. Phase 2 — Real-Time Order Webhooks

> **Priority:** 🟢 NOW — can start alongside Phase 1 (thin initial implementation)
> **Prerequisite:** None (uses existing scopes)

> **Implementation note:** Start with a thin webhook that handles `ItemSold` only. Other events (feedback, unsold, questions) can be wired up later. The core value is order speed, not event coverage.

### 3.1 Goal

Replace the 2-hour order polling CRON with eBay push notifications. Orders appear in admin within seconds of purchase. Keep CRON as a fallback safety net.

### 3.2 How eBay Notifications Work

eBay sends HTTP POST to your endpoint when events occur. Similar to the existing `ebay-account-deletion` endpoint — eBay sends validation challenge first, then real events.

**Registration:** Via eBay Developer Portal notification preferences OR `POST /commerce/notification/v1/subscription`

**Validation:** eBay sends a challenge token → your endpoint returns SHA-256 hash of `challengeCode + verificationToken + endpointUrl` (same pattern as account deletion).

### 3.3 Events to Subscribe

| Event | Trigger | Our Action |
|-------|---------|------------|
| `Marketplace.AccountDeletion` | User requests data deletion | ✅ Already handled by `ebay-account-deletion` |
| `ItemSold` / `FixedPriceTransaction` | Buyer purchases item | Insert order + line items immediately via same logic as `ebay-sync-orders` |
| `AskSellerQuestion` | Buyer sends message | Log alert / push notification to admin |
| `FeedbackReceived` | Buyer leaves feedback | Log to reviews system or alert admin |
| `ItemUnsold` | Listing ends without sale | Update `products.ebay_status = 'ended'` |

### 3.4 New Edge Function: `ebay-webhook`

```
POST /functions/v1/ebay-webhook

Flow:
  1. Validate notification signature (X-EBAY-SIGNATURE header)
  2. Parse event type from notification body
  3. Route to handler:
     - ItemSold → call same order insert logic as ebay-sync-orders
       (getAccessToken → fetchOrder by orderId → matchProduct → insert)
     - FeedbackReceived → insert into reviews or alert table
     - ItemUnsold → update products.ebay_status
     - AskSellerQuestion → insert into alerts table
  4. Return 200 (eBay retries on non-200)
```

Deploy with `--no-verify-jwt` (eBay needs unauthenticated access).

### 3.5 Integration with Existing System

- **`ebay-sync-orders` CRON stays as fallback** — reduce frequency from every 2h to every 6h or 12h. Catches any missed webhook notifications.
- **Same database writes** — webhook handler reuses the same insert/upsert logic (orders_raw, line_items_raw, fulfillment_shipments).
- **Same fuzzy matching** — webhook handler calls `matchProduct()` for product association.
- **Dedup unchanged** — webhook might fire before/after CRON. Existing dedup on `stripe_checkout_session_id` prevents duplicates.

### 3.5a Webhook Failure Detection

> Webhooks can silently die. If eBay stops sending or our endpoint starts failing, we won't know unless we monitor.

- Track `last_webhook_received_at` in `marketplace_tokens.extra` — update on every successful webhook event
- CRON fallback job should check: if no webhook events received in 6+ hours during business hours → log alert
- Compare webhook-sourced order count vs. CRON-sourced order count weekly — significant mismatch indicates webhook delivery issues
- Admin settings page: show "Last webhook event: X hours ago" alongside existing sync timestamps

### 3.6 Benefits

- Orders appear in admin within seconds (vs up to 2 hours)
- Could trigger instant SMS order confirmation to buyer (integrates with existing SMS system)
- Reduces unnecessary API calls from polling
- Enables future real-time inventory decrement

### 3.7 Success Criterion

Phase 2 is **proven** when:

- [ ] At least one real eBay order arrives through the webhook **before** the CRON fallback would have caught it — confirming the webhook is winning the race and delivering the intended speed value
- [ ] Webhook failure detection is active — `last_webhook_received_at` updating, silence alert logic in place

---

## 4. Phase 3 — Cross-Platform Inventory Sync

> **Priority:** 🟡 NEXT — only after Phase 1 listings are stable and Phase 2 order events are reliable
> **Prerequisite:** Phase 1 (Listing Management) + Phase 2 (Webhooks) both proven stable

> ⚠️ **Caution:** This is the easiest phase to get subtly wrong. Cross-platform inventory sync sounds great but creates silent oversell bugs if the source of truth is not extremely disciplined. **Do not start this phase until:**
> 1. Phase 1 listings are stable (no failed publishes, migrations clean)
> 2. Phase 2 order events are reliable (webhook delivery confirmed, CRON fallback catching misses)
> 3. Product matching and SKU mapping are clean (tech debt items resolved)
>
> `products.stock_qty` as single source of truth only works if **every sale source** updates it reliably and **every failure path** is recoverable. Reconciliation should be operationally visible (admin dashboard alerts), not just a silent nightly CRON.

### 4.1 Goal

Unified stock levels across all platforms: website ↔ eBay ↔ Amazon. When an item sells on one platform, stock decreases on all others. Single source of truth in the `products` table.

### 4.2 Architecture

```
                    ┌──────────────┐
                    │   products   │
                    │  stock_qty   │  ← single source of truth
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
        │  Website   │ │ eBay  │ │  Amazon   │
        │ (Stripe)   │ │  API  │ │  SP-API   │
        └────────────┘ └───────┘ └───────────┘
```

### 4.3 Stock Decrement Flow

```
Sale happens on eBay
  → ebay-webhook receives ItemSold event (or ebay-sync-orders CRON catches it)
  → Insert order into orders_raw + line_items_raw
  → Decrement products.stock_qty by quantity sold
  → Push updated quantity to ALL other platforms:
    → eBay: POST /sell/inventory/v1/bulk_update_price_quantity (if multiple eBay listings)
    → Amazon: submitFeed (inventory update) via SP-API
    → Website: stock_qty already updated in products table (read at checkout time)
```

### 4.3a Idempotent Stock Updates

> **Critical rule:** The same order must never decrement stock twice. Retries must be safe.

- Stock decrement keyed on `stripe_checkout_session_id` — if the order row already exists (dedup check), skip the decrement
- Use a `stock_decremented_at` timestamp on `orders_raw` — only decrement if null, then set it atomically
- If webhook fires AND CRON catches the same order: first one inserts + decrements, second one hits dedup → no double decrement
- All stock mutations should go through a single Supabase RPC (`rpc_decrement_stock`) that checks the idempotency key internally
- Reconciliation CRON (§4.7) acts as the safety net — catches any drift from edge cases

### 4.4 New Database Columns

```sql
ALTER TABLE products
  ADD COLUMN stock_qty integer DEFAULT 0,
  ADD COLUMN low_stock_threshold integer DEFAULT 5,
  ADD COLUMN track_inventory boolean DEFAULT false;
```

> Note: Inventory tracking is referenced in `docs/implementation/inventory-stock-tracking.md` as being on hold until cross-platform APIs are ready. This phase activates it.

### 4.5 New Edge Function: `ebay-sync-inventory`

| Action | eBay Endpoint | Purpose |
|--------|---------------|---------|
| `push_quantity` | `POST /bulk_update_price_quantity` | Push stock_qty to eBay for one or more SKUs |
| `pull_quantity` | `GET /inventory_item/{sku}` | Read current eBay quantity (for reconciliation) |
| `reconcile` | Multiple | Compare DB vs eBay vs Amazon, report discrepancies |

### 4.6 Admin Inventory Dashboard

- **Per-product row:** Product name, KK code, total stock, eBay qty, Amazon qty, website qty, sync status
- **Low stock alerts:** Products below threshold highlighted in yellow/red
- **Manual adjustment:** Update stock_qty with audit log
- **Sync button:** Force push current stock to all platforms
- **Reconciliation report:** Shows mismatches between platforms

### 4.7 CRON: Safety Reconciliation

```
Schedule: 0 3 * * * (daily at 3 AM UTC)
Job: ebay-sync-inventory-reconcile
  → For each product with track_inventory = true:
    → Read stock from eBay (GET /inventory_item/{sku})
    → Read stock from Amazon (if integrated)
    → Compare with products.stock_qty
    → If mismatch: push correct qty to all platforms, log discrepancy
```

### 4.8 Rollback Rule

> If the daily reconciliation detects mismatches on **more than 20% of tracked products** (or more than 5 absolute mismatches, whichever is lower), **pause automatic stock pushes** and fall back to manual reconciliation. Alert admin with full mismatch report. Do not resume automatic sync until root cause is identified and resolved.

---

## 5. Phase 4 — Promoted Listings (Marketing API)

> **Priority:** 🔵 LATER — revenue growth, gated on eBay volume
> **Prerequisite:** Phase 1 (listings must be API-managed), Phase 3 (inventory must be accurate)
> **Scope addition needed:** `sell.marketing`

> ⚠️ **Gate:** Only proceed with this phase if eBay is already producing meaningful sales volume and listings are converting well. Promoted Listings amplifies what you already have — if listing quality, category mapping, or pricing aren't dialed in, you're paying to amplify problems. Review eBay conversion rates and revenue trends before investing here.

### 5.1 Goal

Create and manage eBay ad campaigns from the admin panel. Revenue-based budget: a configurable percentage of the previous month's eBay revenue determines the marketing spend cap.

### 5.2 How Promoted Listings Work

eBay Promoted Listings Standard is a **cost-per-sale** model:
- You set an ad rate % per listing (typically 2-8%)
- eBay boosts the listing in search results
- You only pay when someone clicks AND buys
- Promoted listings get ~30% more visibility on average

There is **no upfront cost** — you're paying a percentage of the final sale price only on attributed sales.

### 5.3 Revenue-Based Budget Model

```
Monthly eBay Revenue (previous month)  ×  Ad Rate %  =  Marketing Budget Cap

Example:
  Previous month eBay revenue: $100
  Configured ad rate: 2%
  Marketing budget: $2.00

If spend reaches budget cap → auto-pause campaigns until next month.
```

**How to calculate previous month's eBay revenue:**
- Query `orders_raw` where `stripe_checkout_session_id LIKE 'ebay_%'` and `created_at` in previous month
- Sum `total_amount_cents`
- Store in `ebay_marketing_config` table alongside the configured percentage

### 5.4 eBay Marketing API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/sell/marketing/v1/ad_campaign` | Create ad campaign |
| `POST` | `/sell/marketing/v1/ad_campaign/{id}/ad` | Add listing to campaign |
| `GET` | `/sell/marketing/v1/ad_campaign/{id}/ad` | List ads in campaign |
| `POST` | `/sell/marketing/v1/ad_campaign/{id}/ad/{adId}/update_bid` | Change ad rate % |
| `DELETE` | `/sell/marketing/v1/ad_campaign/{id}/ad/{adId}` | Remove listing from campaign |
| `GET` | `/sell/marketing/v1/ad_report` | Performance: impressions, clicks, sales, ROAS |
| `GET` | `/sell/marketing/v1/ad_campaign/{id}/get_ads_by_inventory_reference` | Find ads by SKU |

### 5.5 New Edge Function: `ebay-manage-ads`

Unified handler — accepts `{ action, ...params }`:

| Action | Purpose |
|--------|---------|
| `create_campaign` | Create campaign with budget and listing selection |
| `add_listings` | Add products to campaign by SKU |
| `remove_listing` | Remove listing from campaign |
| `update_bid` | Change ad rate % for a listing |
| `pause_campaign` | Pause campaign (budget cap reached) |
| `resume_campaign` | Resume campaign (new month) |
| `get_report` | Pull performance data (impressions, clicks, sales, spend, ROAS) |
| `check_budget` | Compare current spend vs. revenue-based budget cap |

### 5.6 New Database Tables

#### `ebay_marketing_config`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | integer (PK) | Single-row config |
| `ad_rate_pct` | numeric | Percentage of revenue allocated to ads (e.g. 2.0) |
| `campaign_id` | text | Active eBay campaign ID |
| `budget_cap_cents` | integer | Calculated monthly budget cap |
| `current_spend_cents` | integer | Running total for current month |
| `last_calculated_at` | timestamptz | When budget was last recalculated |

#### `ebay_ad_performance` (historical snapshots)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid (PK) | — |
| `snapshot_date` | date | — |
| `product_id` | uuid (FK) | — |
| `impressions` | integer | — |
| `clicks` | integer | — |
| `sales_count` | integer | Attributed sales |
| `spend_cents` | integer | Ad cost |
| `revenue_cents` | integer | Attributed revenue |

### 5.7 Admin UI — Campaign Dashboard

| Section | Features |
|---------|----------|
| **Budget Card** | Previous month revenue → configured % → budget cap → current spend → remaining |
| **Campaign Status** | Active / Paused / No Campaign. Pause/Resume buttons |
| **Per-Listing Performance** | Table: product, ad rate %, impressions, clicks, sales, spend, ROAS |
| **Promote Toggle** | Per-product toggle to add/remove from campaign |
| **Ad Rate Slider** | Per-listing slider (2-15%) with eBay's suggested rate shown |
| **ROAS Alert** | Highlight listings with ROAS < 1.0 (spending more than earning) |

### 5.8 CRON: Budget Check + Report Sync

```
Schedule: 0 7 * * * (daily at 7 AM UTC, after finances sync)
Job: ebay-ads-daily-check
  → Pull ad performance report for yesterday
  → Update ebay_ad_performance snapshots
  → Calculate current_spend_cents for the month
  → If current_spend_cents >= budget_cap_cents → pause campaign
  → On 1st of month: recalculate budget_cap_cents from previous month's eBay revenue
```

---

## 6. Phase 5 — Analytics, Compliance & Competitor Pricing

> **Priority:** 🔵 LATER — monitoring & intelligence
> **Prerequisites:** Phase 1 (listings need to exist)
> **Scope addition needed:** `sell.analytics` (for analytics only)

> **Recommendation:** Of the three sub-features here, **lightweight performance reporting** (6.1) is the most useful and could be pulled forward into the "Next" tier alongside Phase 3. Compliance monitoring (6.2) is low-effort and worth doing once listings are API-managed. Competitor pricing (6.3) is the most "looks smart on paper" feature — it's genuinely nice-to-have but nowhere near as important as listing creation, stock accuracy, or sync speed. Build it last, if at all.

### 6.1 Seller Analytics & Traffic Reports

**Scope:** `sell.analytics`

**API Endpoints:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/sell/analytics/v1/traffic_report` | Per-listing: page views, impressions, click-through rate, conversion rate |
| `GET` | `/sell/analytics/v1/seller_standards_profile` | Seller level, defect rate, late shipment rate |
| `GET` | `/sell/analytics/v1/customer_service_metric` | Response time, resolution rate |

**Edge function:** `ebay-analytics` — pulls traffic report + seller standards

**Admin UI — eBay Analytics Dashboard:**
- Traffic table: listing title, impressions, page views, sales, conversion rate (sortable)
- Seller health card: current level (Top Rated / Above Standard / Below Standard), defect rate, late shipment %, open cases
- Underperformers: listings with high views but 0 sales (pricing/listing quality signal)
- Trends chart: weekly impressions + sales (requires historical snapshots)

**Database:** `ebay_analytics_snapshots` table for trend data

**CRON:** Daily at 7 AM UTC — store historical snapshots

### 6.2 Listing Compliance Monitoring

**Scope:** `sell.inventory` (already have it)

**API Endpoints:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/sell/compliance/v1/listing_violation_summary` | Count of violations by type |
| `GET` | `/sell/compliance/v1/listing_violation?compliance_type={type}` | Detailed violations per listing |

**Compliance Types:**
- `PRODUCT_ADOPTION` — listing needs eBay catalog product match
- `OUTSIDE_EBAY_BUYING_AND_SELLING` — links/references outside eBay
- `HTTPS` — non-HTTPS image URLs
- `LISTING_POLICY` — prohibited items, misleading titles

**Edge function:** `ebay-compliance-check` — pulls violation summary + details

**Admin UI:**
- Compliance health badge on eBay listings page: ✅ Clean / ⚠️ N Violations
- Violation detail panel: listing title, violation type, eBay's recommended fix
- One-click fix for common issues (e.g., rebuild image URLs as HTTPS)

**CRON:** Weekly, Sunday 4 AM UTC — alert on new violations

### 6.3 Competitor Price Tracking

**Scope:** Public API (application token — `api_scope`, already have it)

**API Endpoints:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/buy/browse/v1/item_summary/search` | Search for competing listings by keyword |
| `GET` | `/buy/browse/v1/item/{item_id}` | Full details for a specific competitor listing |

**Edge function:** `ebay-competitor-scan` — searches for competitors per product, returns pricing analysis

**Data Flow:**
```
CRON (weekly, Sunday 5 AM UTC)
  → For each product with ebay_listing_id:
    → Search eBay with product keywords + category
    → Collect top 10-20 competing listings (price, shipping, seller rating, sold count)
    → Store snapshot in ebay_competitor_snapshots
    → Calculate: avg_price, min_price, max_price, your_position
```

**Database:** `ebay_competitor_snapshots`

| Column | Type | Purpose |
|--------|------|---------|
| `product_id` | uuid (FK) | — |
| `snapshot_date` | date | — |
| `avg_price_cents` | integer | Market average |
| `min_price_cents` | integer | Lowest competitor |
| `max_price_cents` | integer | Highest competitor |
| `competitor_count` | integer | How many listings found |
| `your_price_cents` | integer | Our price at snapshot time |
| `your_rank` | integer | Price rank (1 = cheapest) |
| `raw_data` | jsonb | Full competitor listing data |

**Admin UI — Price Intelligence Dashboard:**
- Per-product: your price vs. avg vs. lowest, with visual position indicator
- Market position label: "15% above average" / "Priced competitively" / "Lowest price"
- Price alerts: flag when competitor drops below your price
- Sold data: units competitors are moving (via `search` with `sold` filter)

---

## 7. OAuth Scope Additions

Current scopes requested during OAuth:
```
api_scope
sell.fulfillment
sell.inventory
sell.finances
sell.account              ← added Phase 1
sell.account.readonly     ← added Phase 1
```

Scopes to add at specific phases:

| Phase | Scope | Required For | Status |
|-------|-------|-------------|--------|
| Phase 1 | `sell.account` | Business policy management | ✅ Added |
| Phase 1 | `sell.account.readonly` | Policy reads | ✅ Added |
| Phase 4 | `sell.marketing` | Promoted Listings campaigns | ⏳ Planned |
| Phase 5a | `sell.analytics` | Traffic reports + seller standards | ⏳ Planned |

**How to add scopes:**
1. Update the scope list in `pages/admin/settings.html` (the OAuth redirect URL)
2. Update the scope list in `ebay-refresh-token` edge function
3. User must re-authorize via "Connect eBay" button (grants new permissions)
4. New refresh token is issued with expanded scopes

```javascript
// settings.html — update EBAY_SCOPES
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',   // Phase 4
  'https://api.ebay.com/oauth/api_scope/sell.analytics',   // Phase 5
];
```

---

## 8. Database Migration Summary

All schema changes across all phases:

### Phase 1 — Products table additions
```sql
ALTER TABLE products
  ADD COLUMN ebay_sku text,
  ADD COLUMN ebay_offer_id text,
  ADD COLUMN ebay_listing_id text,
  ADD COLUMN ebay_status text DEFAULT 'not_listed',
  ADD COLUMN ebay_category_id text,
  ADD COLUMN ebay_price_cents integer;
```

### Phase 1 — Category cache table
```sql
CREATE TABLE ebay_category_cache (
  category_id text PRIMARY KEY,
  category_name text NOT NULL,
  aspects jsonb,
  cached_at timestamptz DEFAULT now()
);
```

### Phase 3 — Inventory tracking columns
```sql
ALTER TABLE products
  ADD COLUMN stock_qty integer DEFAULT 0,
  ADD COLUMN low_stock_threshold integer DEFAULT 5,
  ADD COLUMN track_inventory boolean DEFAULT false;
```

### Phase 4 — Marketing tables
```sql
CREATE TABLE ebay_marketing_config (
  id integer PRIMARY KEY DEFAULT 1,
  ad_rate_pct numeric DEFAULT 2.0,
  campaign_id text,
  budget_cap_cents integer DEFAULT 0,
  current_spend_cents integer DEFAULT 0,
  last_calculated_at timestamptz
);

CREATE TABLE ebay_ad_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  product_id uuid REFERENCES products(id),
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  sales_count integer DEFAULT 0,
  spend_cents integer DEFAULT 0,
  revenue_cents integer DEFAULT 0
);
```

### Phase 5 — Analytics & competitor tables
```sql
CREATE TABLE ebay_analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  product_id uuid REFERENCES products(id),
  impressions integer DEFAULT 0,
  page_views integer DEFAULT 0,
  sales_count integer DEFAULT 0,
  conversion_rate numeric,
  raw_data jsonb
);

CREATE TABLE ebay_competitor_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id),
  snapshot_date date NOT NULL,
  avg_price_cents integer,
  min_price_cents integer,
  max_price_cents integer,
  competitor_count integer,
  your_price_cents integer,
  your_rank integer,
  raw_data jsonb
);
```

---

## 9. Edge Function Registry

Complete registry of all eBay edge functions (existing + planned):

| Function | Phase | Status | Deploy Flags | CRON |
|----------|-------|--------|-------------|------|
| `ebay-account-deletion` | 0 | ✅ Live | `--no-verify-jwt` | — |
| `ebay-oauth-callback` | 0 | ✅ Live | `--no-verify-jwt` | — |
| `ebay-refresh-token` | 0 | ✅ Live | — | — |
| `ebay-sync-orders` | 0 | ✅ Live (refactored → shared module) | — | `0 */2 * * *` |
| `ebay-sync-finances` | 0 | ✅ Live | — | `0 6 * * *` |
| `_shared/ebayUtils.ts` | 1 | ✅ Live | *(shared module)* | — |
| `ebay-manage-listing` | 1 | ✅ Live | — | — |
| `ebay-migrate-listings` | 1 | ✅ Live | — | — |
| `ebay-taxonomy` | 1 | ✅ Live | — | — |
| `ebay-webhook` | 2 | ⏳ Planned | `--no-verify-jwt` | — |
| `ebay-sync-inventory` | 3 | ⏳ Planned | — | `0 3 * * *` |
| `ebay-manage-ads` | 4 | ⏳ Planned | — | `0 7 * * *` |
| `ebay-analytics` | 5 | ⏳ Planned | — | `0 7 * * *` |
| `ebay-compliance-check` | 5 | ⏳ Planned | — | `0 4 * * 0` (weekly) |
| `ebay-competitor-scan` | 5 | ⏳ Planned | — | `0 5 * * 0` (weekly) |

**Deploy pattern:** `echo y | npx supabase functions deploy <name> --project-ref yxdzvzscufkvewecvagq 2>&1`

---

## 10. Dependency Graph

```
Phase 0 (DONE)
  ├── OAuth connection
  ├── Order sync + product matching
  ├── Financial sync
  └── CSV imports

Phase 1 (DONE — April 19, 2026)
  ├── ✅ _shared/ebayUtils.ts — consolidated matching + token helpers
  ├── ✅ ebay-manage-listing — 14 actions (create/edit/publish/withdraw/delete/policies/location)
  ├── ✅ ebay-taxonomy — category suggestions + item aspects with 30-day cache
  ├── ✅ ebay-migrate-listings — scan/link/auto_link
  ├── ✅ ebay-sync-orders refactored to use shared module
  ├── ✅ Admin UI: pages/admin/ebay-listings.html
  ├── ✅ DB migration applied: ebay columns on products + ebay_category_cache table
  ├── ✅ Business policies created (fulfillment/return/payment)
  ├── ✅ Inventory location "default" created
  ├── ✅ OAuth scopes expanded: sell.account, sell.account.readonly
  └── ✅ First listing test: create → offer → publish → withdraw cycle verified

Phase 1b (NOW — Enhanced Listing Features)
  ├── Multi-image management (gallery images → imageUrls[])
  ├── HTML description editor (Quill.js CDN)
  ├── Best Offer / Allow Offers (bestOfferTerms on offer)
  ├── Package weight & dimensions (packageWeightAndSize on item)
  ├── Policy picker (ship/return/payment dropdowns)
  ├── Store category assignment
  ├── Volume pricing → deferred to Phase 4 (needs sell.marketing)
  └── Item location override → skipped (single location)

── NOW ──────────────────────────────────────────

Phase 2: Real-Time Webhooks (thin — ItemSold only)
  ├── Depends on: nothing (parallel with Phase 1)
  ├── ebay-webhook (receives ItemSold push notifications)
  ├── Reduces CRON frequency (2h → 6-12h fallback)
  └── Other events (feedback, unsold) wired up later

── NEXT (only after Phase 2 is stable) ──────────

Phase 3: Cross-Platform Inventory Sync
  ├── GATE: Phase 2 events reliable
  ├── GATE: Product matching / SKU mapping proven clean
  ├── ebay-sync-inventory (push/pull/reconcile)
  ├── products.stock_qty as single source of truth
  ├── Admin inventory dashboard with sync status visibility
  └── Reconciliation must be operationally visible, not silent

Lightweight eBay Performance Reporting (can pull from Phase 5)
  ├── Basic traffic report + seller standards
  └── No historical snapshots needed initially

── LATER (gated on eBay volume & listing maturity) ──

Phase 4: Promoted Listings
  ├── GATE: eBay producing meaningful sales volume
  ├── GATE: Listings converting well, pricing dialed in
  ├── Requires: sell.marketing scope (re-auth needed)
  ├── ebay-manage-ads (campaigns, bids, reports)
  ├── Revenue-based budget model
  └── Admin campaign dashboard

Phase 5: Compliance + Competitor Pricing
  ├── ebay-compliance-check (low-effort, do when ready)
  ├── ebay-competitor-scan (nice-to-have, lowest priority)
  └── Build last, if at all
```

---

## Appendix: Key eBay API Reference

| API | Base URL | Auth | Rate Limit |
|-----|----------|------|------------|
| Identity (OAuth) | `api.ebay.com` | Basic Auth | — |
| Fulfillment | `api.ebay.com` | User token | 5,000/day |
| Finances | `apiz.ebay.com` | User token | 5,000/day |
| Inventory | `api.ebay.com` | User token | 5,000/day |
| Marketing | `api.ebay.com` | User token | 5,000/day |
| Analytics | `api.ebay.com` | User token | 5,000/day |
| Compliance | `api.ebay.com` | User token | 5,000/day |
| Taxonomy | `api.ebay.com` | Application token | 5,000/day |
| Browse | `api.ebay.com` | Application token | 5,000/day |
| Notification | `api.ebay.com` | User token | — |