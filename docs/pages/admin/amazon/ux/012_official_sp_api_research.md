# Official SP-API Research (Phase 2D)

## 1. Purpose

This document records **official Amazon Selling Partner API (SP-API) research** used to shape the future Karry Kraze Supabase schema (`011_data_model_and_sync_strategy.md`) and edge functions.

**Phase 2D is research only.** No migrations, edge functions, API calls, Supabase logic, or frontend changes are included.

**Implementation order note:** Schema work (Phase 2C) should follow this research so tables align with verified SP-API behavior.

---

## 2. Source Rules

### Authoritative sources used

All findings below cite [Amazon SP-API developer documentation](https://developer-docs.amazon.com/sp-api/) only, including:

| Topic | Official doc |
|-------|----------------|
| Listings overview | [Manage Product Listings with the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide) |
| Listings Items API | [Listings Items API](https://developer-docs.amazon.com/sp-api/docs/listings-items-api) |
| Listings workflows | [Building Listings Management Workflows Guide](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide) |
| Product Type Definitions | [Product Type Definitions API](https://developer-docs.amazon.com/sp-api/docs/product-type-definitions-api) |
| Feeds / JSON listings | [Listings Feed Type Values](https://developer-docs.amazon.com/sp-api/docs/listings-feed-type-values) |
| Catalog | [Catalog Items API](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api) |
| Restrictions | [Listings Restrictions API](https://developer-docs.amazon.com/sp-api/docs/listings-restrictions-api) |
| FBA inventory | [FBA Inventory API](https://developer-docs.amazon.com/sp-api/docs/fba-inventory-api) |
| Product Pricing | [Product Pricing API](https://developer-docs.amazon.com/sp-api/docs/product-pricing-api) |
| Product Fees | [Product Fees API](https://developer-docs.amazon.com/sp-api/docs/product-fees-api) |
| Auth | [Connect to the SP-API](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api) |
| Roles | [Selling Partner API Roles](https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api) |

### Not used as authority

- Blogs, Stack Overflow, unofficial SDK READMEs, AI summaries, third-party repricers

### Confidence labels used in this doc

| Label | Meaning |
|-------|---------|
| **Confirmed (official docs)** | Stated explicitly in SP-API documentation |
| **Likely — live testing required** | Reasonable inference from official docs; must validate on Karry Kraze seller account |
| **Unknown** | Not answered by official docs reviewed |

---

## 3. Findings Summary

| Area | Key official finding | Schema impact |
|------|---------------------|---------------|
| **Listings Items API** | Seller listings accessed by `sellerId` + `sku` + `marketplaceIds`; `searchListingsItems` for bulk read (max 1000 SKUs paged) | `(marketplace_id, seller_sku)` is a strong local unique key |
| **Issues** | `getListingsItem` with `includedData=issues` returns post-processing issues; write responses only show acceptance-time issues | Feed `amazon_listing_issues` from `issues` dataset + enforcements |
| **PTD API** | Schemas are marketplace-specific; `requirements` = `LISTING` / `LISTING_PRODUCT_ONLY` / `LISTING_OFFER_ONLY` | Drafts need `product_type`, `requirements`, `product_type_version`, schema refs |
| **Push workflow** | New catalog vs offer-on-existing-ASIN are distinct official workflows (Catalog search + Restrictions + PTD + `putListingsItem`) | Drafts need `submission_id`, submission status, push outcome enum |
| **Feeds** | `JSON_LISTINGS_FEED` is bulk equivalent of Listings Items API; same PTD schemas | Optional `feed_id`, processing report on `amazon_push_queue` |
| **Catalog** | `searchCatalogItems` / `getCatalogItem` for ASIN discovery and attributes | Mapping/draft ASIN match fields + optional `catalog_snapshot jsonb` |
| **Inventory** | FBM qty in `fulfillmentAvailability`; FBA breakdown in FBA Inventory API | Split quantity columns — single `quantity` is insufficient for FBA |
| **Pricing / fees** | Product Pricing API for competitive/featured offer data; Product Fees API for estimates (not guaranteed) | Separate snapshot tables deferrable; Pricing role required |
| **Auth** | LWA OAuth; refresh token server-side; `sellerId` in listing paths | Need `amazon_seller_accounts` + secure token storage |
| **Existing SC listings** | API manages "selling partner listings" by SKU — **likely** includes manual listings | Supports map-don't-recreate strategy; full import scope needs live test |

---

## 4. Listings Items API

**Official reference:** [Listings Items API v2021-08-01](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)

### What it is used for

**Confirmed:** Programmatic access to **selling partner listings on Amazon** — create, read, update, and delete listings **one SKU at a time** ([Manage Product Listings guide](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)).

Core capabilities listed officially: creating, querying, updating, and deleting listings (SKUs).

### Retrieving seller listings

**Confirmed:**

| Operation | Purpose |
|-----------|---------|
| `getListingsItem` | Return one listing for `sellerId` + `sku` + `marketplaceIds` |
| `searchListingsItems` | Return multiple listings filtered by SKU, ASIN, identifiers, dates, issue severity, status, etc. |

Path pattern (official example):

```http
GET /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds={marketplaceId}&includedData=summaries,attributes,issues,offers,fulfillmentAvailability
```

**Confirmed:** Operations are keyed by **selling partner identifier (`sellerId`)** and **seller-provided SKU** ([getListingsItem](https://developer-docs.amazon.com/sp-api/reference/getlistingsitem), [searchListingsItems](https://developer-docs.amazon.com/sp-api/reference/searchlistingsitems)).

### Operations

| Operation | Confirmed behavior |
|-----------|-------------------|
| `getListingsItem` | Read listing; optional `includedData` datasets |
| `putListingsItem` | Create new listing **or fully replace** existing listing content |
| `patchListingsItem` | Partial update via JSON Patch (`add`, `replace`, `merge`, `delete`) |
| `deleteListingsItem` | Delete a listing SKU |
| `searchListingsItems` | Search/list multiple SKUs (pagination; **max 1000 items** returnable per official note) |

### `includedData` datasets (confirmed)

From official API reference:

| Dataset | Content |
|---------|---------|
| `summaries` | ASIN, productType, conditionType, status (`BUYABLE`, `DISCOVERABLE`), itemName, dates, mainImage, fnSku |
| `attributes` | Structured listing attributes (e.g. `purchasable_offer`, `fulfillment_availability`) |
| `issues` | Listing issues (code, message, severity, categories, enforcements) |
| `offers` | Current offers (B2C/B2B, price, audience) |
| `fulfillmentAvailability` | `fulfillmentChannelCode`, `quantity` |
| `relationships` | Variation / package hierarchy |
| `productTypes` | Product types associated with listing |
| `procurement` | Vendor procurement (vendors) |

### Rate limits

**Confirmed** ([Listings Items API Rate Limits](https://developer-docs.amazon.com/sp-api/docs/listings-items-api-rate-limits)):

| Operation | Per account-app pair | Per application | Burst |
|-----------|---------------------|-------------------|-------|
| `getListingsItem` | 5 req/s | 100 req/s | 5 |
| `searchListingsItems` | 5 req/s | 100 req/s | 5 |
| `putListingsItem` | 5 req/s | 100 req/s | 5 |
| `patchListingsItem` | 5 req/s | 500 req/s | 5 |
| `deleteListingsItem` | 5 req/s | 100 req/s | 5 |

Additional limits for `patchListingsItem` / `putListingsItem` when updating relationship or product-data attributes (100 req/s app limit). Validation previews: 20 req/s.

**Sync design implication:** Full-catalog sync must paginate `searchListingsItems`, respect 1000-SKU search cap, and rate-limit (5 req/s default per seller-app).

### Important limitations

**Confirmed:**

1. **1×1 updates** — bulk use `JSON_LISTINGS_FEED` ([Listings Items API](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)).
2. **`putListingsItem` replaces content** — omitted attributes may be **removed** (especially product facts; offer-only submissions can strip bullets if requirements mismatch).
3. **`patchListingsItem` is for existing listings only** — official workflow warns it is not for initial creation ([Building Listings Management Workflows](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide)).
4. **Merge on patch is limited** — official Listings Items API notes merge applies to **`quantity` in `fulfillment_availability`** and **`quantity_discount_plan` for B2B** only; not general merge for all attributes.
5. **Write vs read issues** — `put`/`patch`/`delete` responses indicate whether submission was **accepted** (`ACCEPTED` / `INVALID` / `VALID` for preview); they include issues blocking acceptance. **`getListingsItem` with `issues`** returns issues after processing ([Listings Items API Considerations](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)).
6. **Attributes vs live fulfillment** — official docs: `attributes` reflects last submitted data; `fulfillmentAvailability` reflects **live** purchasable quantity.
7. **Product type coverage** — not all product types fully supported; offer-only on existing ASINs can use `PRODUCT` product type ([Listings Items API](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)).
8. **Comma in SKU** — official search doc warns SKUs containing commas cannot be used in comma-delimited batch identifier queries; fetch individually ([Search for listings items](https://developer-docs.amazon.com/sp-api/docs/search-for-listings-items-by-id)).

### Schema impact — Listings Items API

| Question | Recommendation |
|----------|----------------|
| Is `(marketplace_id, seller_sku)` a good unique key? | **Yes — confirmed** as SP-API primary identifier for seller listings |
| Store `raw_listing jsonb`? | **Yes — recommended** for selected `includedData` snapshots (attributes, issues, offers, fulfillmentAvailability, relationships); access-restricted |
| Can `issues` feed `amazon_listing_issues`? | **Yes — confirmed**; map `code`, `message`, `severity`, `categories`, `enforcements`, `attributeNames` |
| Listing status enum | Map from `summaries.status` (`BUYABLE`, `DISCOVERABLE`) + issue/enforcement severity — not identical to 011 mock statuses; normalize in app layer |

---

## 5. Product Type Definitions API

**Official reference:** [Product Type Definitions API](https://developer-docs.amazon.com/sp-api/docs/product-type-definitions-api)

### What it is used for

**Confirmed:** Search and retrieve **attribute and data requirements** for Amazon catalog product types as JSON Schemas used by Listings Items API, Catalog Items API, and `JSON_LISTINGS_FEED`.

### Operations

| Operation | Purpose |
|-----------|---------|
| `searchDefinitionsProductTypes` | Find product types by `keywords` or `itemName` recommendation |
| `getDefinitionsProductType` | Return product type definition + links to meta-schema and product schema |

### Requirements sets (confirmed)

From [getDefinitionsProductType](https://developer-docs.amazon.com/sp-api/reference/getdefinitionsproducttype):

| Value | Meaning |
|-------|---------|
| `LISTING` | Product facts **and** sales terms |
| `LISTING_PRODUCT_ONLY` | Product facts only |
| `LISTING_OFFER_ONLY` | Sales terms only (sellers; **not vendors**) |

Additional parameters ([Retrieve a Product Type Definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition)):

| Parameter | Purpose |
|-----------|---------|
| `requirementsEnforced` | e.g. `ENFORCED` |
| `locale` | Localized schema labels |
| `parentageLevel` | `CHILD`, `PARENT`, `NONE` for variation schemas |
| `sellerId` | Optional — retrieve **seller-specific** attributes / audience values |

**Confirmed:** Definitions are **marketplace-specific** (`marketplaceIds` required). `productTypeVersion` returned (version identifier).

Schema download links expire in **7 days** (official retrieve guide) — store checksum/version, re-fetch as needed.

### Rate limits

**Confirmed** ([Product Type Definitions API Rate Limits](https://developer-docs.amazon.com/sp-api/docs/product-type-definitions-api-rate-limits)):

- `getDefinitionsProductType`: 5 req/s per account-app, 100 req/s per app, burst 5
- `searchDefinitionsProductTypes`: same

### Push modal / draft schema impact

**Confirmed needs for `amazon_listing_drafts`:**

| Column | Source |
|--------|--------|
| `product_type` | e.g. `LUGGAGE`, `PRODUCT` for offer-only |
| `requirements` | `LISTING` / `LISTING_PRODUCT_ONLY` / `LISTING_OFFER_ONLY` |
| `requirements_enforced` | From PTD response |
| `product_type_version` | From `productTypeVersion` |
| `parentage_level` | `CHILD` / `PARENT` / `NONE` when variations |
| `draft_payload jsonb` | Attributes matching PTD JSON Schema |
| `validation_errors jsonb` | Client-side JSON Schema validation + API `issues` |

Optional: cache PTD schema URL + checksum in draft or separate `amazon_product_type_cache` table (defer until 2C).

---

## 6. Listing Creation / Update Workflow

**Official reference:** [Building Listings Management Workflows Guide](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide)

### Official workflow paths

#### A. New item not in Amazon catalog

**Confirmed steps:**

1. `searchCatalogItems` — check catalog by identifiers/keywords
2. If no exact match → `searchDefinitionsProductTypes` → `getDefinitionsProductType` (`LISTING` or `LISTING_PRODUCT_ONLY`)
3. Validate against JSON Schema
4. `putListingsItem` (optionally `mode=VALIDATION_PREVIEW` first)
5. Inspect response `status`: `ACCEPTED` | `INVALID` | `VALID` (preview)
6. Subscribe to `LISTINGS_ITEM_STATUS_CHANGE` / `LISTINGS_ITEM_ISSUES_CHANGE`; follow up with `getListingsItem`

#### B. Offer on existing ASIN (catalog item exists)

**Confirmed steps:**

1. `searchCatalogItems` — find ASIN
2. `getListingsRestrictions` — eligibility / approval requirements
3. `getDefinitionsProductType` with product type **`PRODUCT`** and requirements **`LISTING_OFFER_ONLY`**
4. Validate + `putListingsItem`
5. Notifications + `getListingsItem` for post-processing issues

**Confirmed:** Offer-only listings **not supported for vendors** (sellers only).

### Create vs full update vs partial update

| Mechanism | Official use |
|-----------|--------------|
| `putListingsItem` | Create **or full replace** |
| `patchListingsItem` | Partial update on **existing** listing only |
| `mode=VALIDATION_PREVIEW` | Preview validation without submitting ([putListingsItem](https://developer-docs.amazon.com/sp-api/reference/putlistingsitem)) |

**Confirmed seller `putListingsItem` behavior on update:** replaces product facts if omitted; **merges** some sales terms (e.g. omitting offer price may not remove it) — official Building Workflows guide.

### Submission response fields

**Confirmed** from `putListingsItem` / `patchListingsItem` responses:

| Field | Purpose |
|-------|---------|
| `submissionId` | Unique submission identifier |
| `status` | `ACCEPTED`, `INVALID`, or `VALID` (preview) |
| `issues` | Blocking validation issues |
| `identifiers` | ASIN etc. (preview mode with `includedData=identifiers`) |

Post-acceptance processing issues → **`getListingsItem` + notifications**, not write response.

### Schema impact — drafts & submissions

Add to `amazon_listing_drafts` (beyond 011):

| Column | Reason |
|--------|--------|
| `submission_id` | From `submissionId` |
| `submission_status` | `ACCEPTED` / `INVALID` / `VALID` |
| `push_workflow` | `new_catalog` \| `offer_on_asin` |
| `requirements` | PTD requirements set used |
| `last_validation_result jsonb` | Preview + client validation |
| `last_submission_response jsonb` | Restricted snapshot |
| `published_amazon_listing_id` | FK after sync confirms SKU live |

Link draft → listing after `getListingsItem` confirms ASIN/SKU.

---

## 7. Feeds API / Bulk Listing Updates

**Official references:**

- [Feeds API](https://developer-docs.amazon.com/sp-api/docs/feeds-api)
- [Listings Feed Type Values — JSON_LISTINGS_FEED](https://developer-docs.amazon.com/sp-api/docs/listings-feed-type-values)
- [Building Listings Management Workflows — bulk section](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide)

### When Feeds vs Listings Items API

**Confirmed comparison** (official Building Workflows table):

| | Listings Items API | JSON_LISTINGS_FEED |
|--|-------------------|-------------------|
| Throughput | ~5 req/s per operation | 5 feed submissions per 5 minutes |
| Items per request | 1 | 1,500–25,000 (changelog: up to 25,000) |
| Validation | Synchronous | Asynchronous processing report |
| Schema | Same PTD schemas | Same; feed invokes Listings Items API on Amazon's side |

**Confirmed:** Data is **interoperable** between Listings Items API and `JSON_LISTINGS_FEED` ([Manage Product Listings guide](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)).

**Official guidance:** Use Listings Items API when &lt; ~1,500 changed items per 5 minutes; use feed for initial load or large batch sync.

**Confirmed deprecation:** Legacy XML/flat file listing feeds deprecated (July 31, 2025 fatal status per [Listings Feed Type Values](https://developer-docs.amazon.com/sp-api/docs/listings-feed-type-values)).

### Schema impact — `amazon_push_queue`

For bulk push/sync (Phase 2J+), **add when implementing feeds:**

| Column | Purpose |
|--------|---------|
| `feed_id` | From `createFeed` |
| `feed_document_id` | Upload document id |
| `processing_status` | From `getFeed` |
| `processing_report jsonb` | Issues from feed processing report |

Defer until bulk workflow is in scope; single-item push uses Listings Items API first.

---

## 8. Catalog Items API

**Official reference:** [Catalog Items API v2022-04-01](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api)

### Use for Karry Kraze admin

**Confirmed use cases:**

| Operation | Purpose for KK |
|-----------|----------------|
| `searchCatalogItems` | Find ASIN by keyword/identifier for "Map to existing ASIN" push path |
| `getCatalogItem` | Pull catalog attributes, images, identifiers, relationships, sales rankings |

**Role:** Product Listing ([Catalog Items API](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api)).

**Not a substitute for seller listing sync** — catalog describes Amazon catalog items; seller inventory/listing state comes from Listings Items API.

### Schema impact

| Field / table | Recommendation |
|---------------|----------------|
| `amazon_listing_drafts.matched_asin` | Store chosen ASIN from catalog search |
| `match_source` | e.g. `catalog_search`, `manual`, `identifier` |
| `match_confidence` | App-computed; not an SP-API field |
| `catalog_snapshot jsonb` | Optional cache from `getCatalogItem` during mapping/push preview |
| `amazon_listing_mappings` | May store confirmed ASIN separately from listing row |

---

## 9. Inventory / FBA / FBM

### Listings Items — `fulfillmentAvailability`

**Confirmed** ([getListingsItem](https://developer-docs.amazon.com/sp-api/reference/getlistingsitem), [Manage Product Listings guide example](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)):

- `fulfillmentChannelCode` (e.g. `DEFAULT` for merchant fulfillment in examples)
- `quantity` — seller-stated fulfillable quantity in listing attributes
- Official note: **`fulfillmentAvailability` reflects live purchasable quantity**; `attributes.fulfillment_availability` may differ from last submission

### FBA Inventory API

**Confirmed** ([FBA Inventory API](https://developer-docs.amazon.com/sp-api/docs/fba-inventory-api)):

Separate API for FBA network quantities at marketplace level:

- Fulfillable
- Inbound
- Reserved
- Unfulfillable
- Researching

Operation: `getInventorySummaries` (by marketplace, optional `sellerSkus`, `startDateTime` for changes).

**Roles:** Amazon Fulfillment and/or Product Listing.

### Schema impact

**Confirmed:** Single `amazon_listings.quantity` is **not sufficient**.

| Column | Source |
|--------|--------|
| `fulfillment_channel` | From `fulfillmentAvailability.fulfillmentChannelCode` |
| `fbm_quantity` | Listings `fulfillmentAvailability.quantity` when FBM |
| `fba_fulfillable_quantity` | FBA Inventory API |
| `fba_reserved_quantity` | FBA Inventory API |
| `fba_inbound_quantity` | FBA Inventory API (inbound breakdown in API response) |
| `quantity_last_source` | `listings` \| `fba_inventory` |
| `quantity_synced_at` | timestamptz |

**Likely — live testing required:** How FBA SKUs appear in Listings Items `fulfillmentAvailability` vs FBA Inventory API for same seller SKU.

---

## 10. Pricing / Fees / Profit

### Offer price on listing

**Confirmed:** Listings Items `offers` and `attributes.purchasable_offer` contain seller offer pricing ([Manage Product Listings guide JSON example](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)).

Store in `amazon_listings.price` + `currency` from offers dataset.

### Product Pricing API

**Confirmed** ([Product Pricing API](https://developer-docs.amazon.com/sp-api/docs/product-pricing-api)):

- Retrieves **catalog** pricing and competitive/featured offer information
- Operations include `getCompetitiveSummary`, `getFeaturedOfferExpectedPriceBatch`
- **Role: Pricing** (separate from Product Listing)
- Intended for repricing automation; references "Featured Offer" / competitive thresholds ([Product Pricing FAQ](https://developer-docs.amazon.com/sp-api/docs/pricing-faq))

**Not a simple "Amazon fee" field** for profit column in admin UI.

### Product Fees API

**Confirmed** ([Product Fees API](https://developer-docs.amazon.com/sp-api/docs/product-fees-api)):

- `getMyFeesEstimates` — up to **20** ASINs/SKUs per batch
- **Estimated fees are not guaranteed**
- **Roles:** Pricing and/or Product Listing

### Buy Box / Featured Offer

**Confirmed:** Product Pricing API and notifications (`ANY_OFFER_CHANGED`, `PRICING_HEALTH`) discuss featured offer / competitive price threshold — not a dedicated "Buy Box won" boolean in Listings Items API ([Price Adjustment Automation Workflows](https://developer-docs.amazon.com/sp-api/docs/price-adjustment-automation-workflows-guide)).

### Schema impact

| Item | Phase |
|------|-------|
| `amazon_listings.price`, `currency` | **v1 sync** |
| `amazon_pricing_snapshots` | Defer — competitive/FOEP history |
| `amazon_fee_estimates` | Defer — batch fee API on demand for profit preview |
| UI "Est. Amazon Fees" / "Est. Profit" in push modal | Compute on preview via Product Fees API + KK COGS; label as estimates per official disclaimer |

---

## 11. Auth / Roles / Security

### Auth flow

**Confirmed** ([Connect to the SP-API](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api)):

1. Register SP-API application
2. Selling partner authorizes app (OAuth 2.0 / Login with Amazon)
3. Exchange **refresh token** for **access token** (`POST https://api.amazon.com/auth/o2/token`)
4. Access token in `x-amz-access-token` header (1-hour lifetime)
5. Regional SP-API endpoints (e.g. `sellingpartnerapi-na.amazon.com`)

Private apps may self-authorize ([Authorize Applications](https://developer-docs.amazon.com/sp-api/docs/authorizing-selling-partner-api-applications)).

### Roles required for KK admin (minimum set)

**Confirmed** from role mappings on APIs above:

| KK feature | SP-API role (at least one listed per operation) |
|------------|------------------------------------------------|
| Listings read/write | **Product Listing** (+ Inventory and Order Tracking for Listings Items ops) |
| PTD schemas | Product Listing / Inventory and Order Tracking |
| FBA inventory | **Amazon Fulfillment** and/or Product Listing |
| Competitive pricing / FOEP | **Pricing** |
| Fee estimates | **Pricing** and/or Product Listing |

Missing role → **403** ([Selling Partner API Roles](https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api)).

### Security for edge functions

**Confirmed requirements (architecture, not optional):**

- LWA **client_id**, **client_secret**, **refresh_token** — server-side only
- Browser calls Supabase edge functions; edge functions call SP-API
- Do not log tokens or secrets
- Restrict `raw_listing` / `raw_error` JSONB via RLS

### Schema impact — auth tables

**Recommended (new vs 011):**

### `amazon_seller_accounts`

| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `seller_id` | SP-API merchant identifier used in paths |
| `marketplace_ids` | Enabled marketplaces |
| `region` | `na` / `eu` / `fe` endpoint group |
| `account_label` | e.g. "Karry Kraze US" |
| `is_active` | boolean |
| `authorized_at` | timestamptz |
| `created_at` / `updated_at` | |

### `amazon_auth_tokens` (or encrypted vault reference)

| Column | Notes |
|--------|-------|
| `seller_account_id` | FK |
| `lwa_refresh_token_encrypted` | Never expose to client |
| `token_status` | active / revoked / expired |
| `last_refresh_at` | |
| `scopes_roles_snapshot jsonb` | Non-secret role metadata |
| `created_at` / `updated_at` | |

**Do not store access tokens long-term** — refresh per request or short cache.

Add `seller_account_id` FK to `amazon_listings`, `amazon_sync_runs`, `amazon_listing_drafts`.

---

## 12. Existing Seller Central Listings

**Question:** Can listings created manually in Seller Central be retrieved and managed via SP-API with correct permissions?

### Official evidence

**Confirmed:**

- Listings Items API provides access to **"selling partner listings on Amazon"** keyed by **`sellerId` + seller SKU** ([Listings Items API](https://developer-docs.amazon.com/sp-api/docs/listings-items-api)).
- Official lifecycle docs include **"Querying and traversing"** and **"Creating, querying, updating, and deleting listings (SKUs)"** ([Manage Product Listings guide](https://developer-docs.amazon.com/sp-api/docs/manage-product-listings-guide)).
- Update workflow starts with **"Identify the selling partner SKU"** then `getListingsItem` ([Building Listings Management Workflows](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide)).
- `searchListingsItems` returns seller SKUs with summaries, ASIN, status — suitable for import/sync ([searchListingsItems](https://developer-docs.amazon.com/sp-api/reference/searchlistingsitems)).

### Classification

| Statement | Status |
|-----------|--------|
| SP-API can read/update/delete a seller's listing **if you know seller SKU + sellerId + marketplace** | **Confirmed (official docs)** |
| SP-API exposes a single call to dump entire catalog without pagination/filter limits | **Not confirmed** — `searchListingsItems` capped at **1000** items paged; full inventory may need incremental sync strategy |
| Every manually created Seller Central listing appears in `searchListingsItems` | **Likely — live testing required** |
| Legacy listings always use PTD-compatible product types | **Likely — live testing required** — partially supported types may use `PRODUCT` + offer-only |
| Mapping existing listings avoids delete/recreate | **Confirmed as valid strategy** — official workflows update by SKU via `patchListingsItem` / `putListingsItem`; mapping is KK-side metadata |

**KK product decision:** Prefer **import + map** over delete/recreate — aligned with official SKU-based maintenance model.

---

## 13. Recommended Changes to 011 Data Model

Based on official SP-API docs reviewed. **Do not edit 011 migrations yet** — implement in Phase 2C using this section as source.

### Keep as-is

| 011 element | Reason |
|-------------|--------|
| Core tables: `amazon_marketplaces`, `amazon_listings`, `amazon_listing_mappings`, `amazon_listing_drafts`, `amazon_sync_runs`, `amazon_sync_errors`, `amazon_listing_issues` | Aligned with SP-API entities |
| Unique key `(marketplace_id, seller_sku)` on listings | Confirmed SP-API identifier |
| `raw_listing jsonb` | Store `includedData` snapshots |
| `draft_payload jsonb`, `validation_errors jsonb` | PTD + validation workflow |
| `amazon_push_queue` concept | Valid for async submit; extend for feeds later |
| View-to-data mapping (Synced / Ready / Mapping / Drafts) | Still valid |

### Add columns

**`amazon_listings`**

- `seller_id` (text) — SP-API path parameter
- `seller_account_id` (uuid FK)
- `product_type` (text)
- `condition_type` (text)
- `listing_status_buyable` (boolean) — from `BUYABLE`
- `listing_status_discoverable` (boolean) — from `DISCOVERABLE`
- `fn_sku` (text, nullable) — FBA
- `fbm_quantity`, `fba_fulfillable_quantity`, `fba_reserved_quantity`, `fba_inbound_quantity` (integers, nullable)
- `quantity_synced_at`, `price_synced_at`
- `relationships jsonb` — variation/package hierarchy
- `enforcements jsonb` — from issues dataset

**`amazon_listing_drafts`**

- `seller_account_id`, `seller_id`
- `requirements`, `requirements_enforced`
- `product_type_version`
- `parentage_level`
- `push_workflow` (`new_catalog` | `offer_on_asin`)
- `matched_asin`, `catalog_snapshot jsonb`
- `submission_id`, `submission_status`
- `last_validation_result jsonb`, `last_submission_response jsonb`
- `published_amazon_listing_id` (uuid FK, nullable)

**`amazon_listing_issues`**

- `issue_code`, `severity`, `categories` (text[]), `attribute_names` (text[])
- `enforcements jsonb`
- `source_submission_id` (text, nullable)

**`amazon_sync_runs`**

- `seller_account_id`
- `sync_cursor jsonb` — pagination tokens, `lastUpdatedAfter` watermark

**`amazon_push_queue`**

- `submission_id`, `feed_id`, `feed_document_id`, `processing_status`, `processing_report jsonb`

### Remove or defer

| 011 element | Action |
|-------------|--------|
| Single `quantity` column alone | **Replace** with channel-specific columns (keep `quantity` as denormalized display if useful) |
| Simple `status` enum matching mock UI only | **Keep column** but map from SP-API `BUYABLE`/`DISCOVERABLE` + issues — document mapping table in 2C |
| Immediate `amazon_pricing_snapshots` | **Defer** until Pricing role + UI need confirmed |
| `amazon-export-listings` backend | **Defer** — no SP-API "export CSV" operation; build from DB or Reports API (not researched in depth here) |

### New tables

| Table | When |
|-------|------|
| `amazon_seller_accounts` | **Phase 2C** — required before any sync |
| `amazon_auth_tokens` | **Phase 2C** — server-side credential storage |
| `amazon_product_type_cache` | **Optional 2C/2I** — PTD schema checksums |
| `amazon_pricing_snapshots` | **Defer 2J+** |
| `amazon_fee_estimates` | **Defer 2I+** (on-demand preview) |

### Notifications (not in 011)

**Confirmed useful** ([Building Listings Management Workflows](https://developer-docs.amazon.com/sp-api/docs/building-listings-management-workflows-guide)):

- `LISTINGS_ITEM_STATUS_CHANGE`
- `LISTINGS_ITEM_ISSUES_CHANGE`

Plan `amazon_notification_subscriptions` or process via edge function — defer implementation to post-read-sync.

---

## 14. Open Questions for Live Testing

Must be validated on **Karry Kraze's authorized seller account** (not answerable from docs alone):

1. **Full catalog size vs `searchListingsItems` 1000 cap** — incremental sync strategy (`lastUpdatedAfter`, date filters) sufficient for KK SKU count?
2. **Manual Seller Central listings** — do all appear in `searchListingsItems` with correct ASIN/SKU/productType?
3. **Legacy SKUs** — product type compatibility; fallback to `PRODUCT` + `LISTING_OFFER_ONLY`?
4. **FBA vs FBM mixed catalog** — when to read Listings `fulfillmentAvailability` vs FBA Inventory API for admin quantity column?
5. **Variation families** — parent/child SKU rows in search results; mapping one KK product per child SKU?
6. **Listing Restrictions** — frequency of `QUALIFICATION_REQUIRED` issues for KK categories?
7. **Rate limits in practice** — actual `x-amzn-RateLimit-Limit` vs defaults for KK app registration?
8. **Product Fees estimates** — accuracy vs Seller Central fee preview for KK price points?
9. **Featured Offer / competitive data** — is Pricing role approval feasible for v1 admin?
10. **Reports API** — whether any report type supplements listing discovery (not fully researched here; **Unknown** for v1 sync design).

---

## 15. Recommended Next Phase

| Phase | Action |
|-------|--------|
| **2C** | Supabase migrations — **done:** see [`013_supabase_schema.md`](013_supabase_schema.md) |
| **2E** | LWA auth edge functions — planned in [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md) (`amazon-auth-start`, `amazon-auth-callback`, `amazon-auth-status`, `amazon-auth-disconnect`) |
| **2F** | ✅ Read-only sync prototype — [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md) |
| **2G** | Replace mock admin UI data with live reads + normalized status mapping |
| **2H** | ✅ AWS SigV4 signing — [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md) |
| **2I–2J** | Mapping save, PTD-backed push draft, `putListingsItem` submit + issue handling |

**First implementation priority:** `amazon_seller_accounts` + read-only `searchListingsItems` sync — validates existing Seller Central listing import before push/submit work.

---

## Related docs

- `011_data_model_and_sync_strategy.md` — planning baseline (update after 2C)
- `010_light_js_wiring.md` — current frontend behavior
- `009_view_sections.md` — four admin views
- [`013_supabase_schema.md`](013_supabase_schema.md) — Phase 2C Supabase migration implementation
- [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md) — Phase 2E OAuth / token edge function plan
- [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md) — Phase 2F read-only sync prototype
- [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md) — Phase 2H AWS SigV4 signing for read-only sync
- [`024_product_type_validation_preview.md`](024_product_type_validation_preview.md) — Phase 2L PTD fetch/cache + draft validation preview

---

## Disclaimer

Amazon SP-API behavior can change. Re-verify critical paths against [official SP-API documentation](https://developer-docs.amazon.com/sp-api/) before production deployment and after API version upgrades (Listings Items v2021-08-01, PTD v2020-09-01, Catalog v2022-04-01 as cited above).
