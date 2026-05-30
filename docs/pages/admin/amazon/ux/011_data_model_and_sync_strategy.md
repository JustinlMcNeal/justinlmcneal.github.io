# Data Model & Sync Strategy (Phase 2B — Planning Only)

> **Implementation order:** Phase 2D official SP-API research should be completed before migrations. See [`012_official_sp_api_research.md`](012_official_sp_api_research.md). **Phase 2C migrations:** see [`013_supabase_schema.md`](013_supabase_schema.md).

## 1. Purpose

This document defines the **future data model, mapping strategy, and sync strategy** for the Karry Kraze Amazon Listings admin page (`pages/admin/amazon.html`).

**Current state:**

- Phase 1A–1C built the UX shell (stats, filters, four view panels, modals, mock data).
- Phase 2A wired frontend-only behavior (tabs, modals, row menus, mock hydration). See `010_light_js_wiring.md`.

**This phase is planning only.** No Supabase migrations, edge functions, Amazon SP-API calls, or live sync/push/submit behavior should be implemented from this doc alone.

The admin page exposes four work-area views (see `009_view_sections.md`):

| View | Panel |
|------|-------|
| Synced Listings | `#amazonViewSynced` |
| Ready to Push | `#amazonViewReadyToPush` |
| Needs Mapping | `#amazonViewNeedsMapping` |
| Drafts / Issues | `#amazonViewDraftsIssues` |

The proposed data model must support **all four views** with clear query rules and lifecycle transitions between them.

---

## 2. Core Concepts

### KK Product

An **internal Karry Kraze website product** stored in the existing `products` table (UUID primary key, SKU/code, title, price, inventory, images, category, etc.). This is the source of truth for what Karry Kraze sells on its own storefront.

### Amazon Listing

A **seller-side Amazon record** representing a sellable item in a specific marketplace — typically identified by marketplace + seller SKU, and often associated with an ASIN. In Seller Central this may appear as a listing, offer, or inventory record depending on context.

### Amazon Offer

The **seller’s offer** on an Amazon catalog item: price, quantity, fulfillment channel, condition, and seller SKU. One catalog ASIN can have multiple seller offers (different sellers). Karry Kraze cares about **our** offers/listings only.

### ASIN

**Amazon Standard Identification Number** — often identifies a catalog product page on Amazon. A KK product may map to an existing ASIN (create offer) or require a new catalog submission (create new ASIN). ASIN alone does not guarantee a unique seller SKU.

### Seller SKU

Amazon’s **seller-defined SKU** (Seller SKU / SKU in Seller Central). This is the primary upsert key for sync alongside marketplace. **Seller SKU may differ from KK SKU** — especially for legacy listings.

### Marketplace

An Amazon regional marketplace (e.g. US `ATVPDKIKX0DER`). Listings and offers are scoped per marketplace. Karry Kraze may start with US only and expand later.

### Mapping

The **link between an Amazon listing/offer and a KK product** (`amazon_listing_mappings`). Mapping enables synced inventory/pricing views, profit preview, and unified admin actions. Unmapped Amazon records appear in **Needs Mapping**.

### Draft

**Local or pre-submission listing data** (`amazon_listing_drafts`) built from a KK product before Amazon accepts/publishes it. Drafts may fail validation or submission and move to **Drafts / Issues**.

### Sync Run

A **tracked job** (`amazon_sync_runs`) that pulls or reconciles Amazon listing data. Each run records counts, errors, and summary metadata for admin visibility and debugging.

### Issue

A **listing health or workflow problem** (`amazon_listing_issues`) — suppression, rejected images, price mismatch, low stock warning, missing attributes, submission errors, etc. Surfaces in **Drafts / Issues** and may also flag rows in **Synced Listings**.

### Legacy Listing

An Amazon listing that **predates KK catalog conventions** (old seller SKU, manual Seller Central creation, unclear product match). May be **mapped**, **ignored**, or marked **legacy** without full KK sync participation.

### Important distinctions

| Concept | Role |
|---------|------|
| KK Product | Internal catalog; source for push |
| Amazon Listing/Offer | External seller record per marketplace + seller SKU |
| ASIN | Amazon catalog identifier; may be shared across sellers |
| Mapping | Join layer between KK product and Amazon listing |

**One KK product may map to one or more Amazon listings/offers** (e.g. US + CA, or parent/child variations). **One Amazon listing should map to at most one KK product** for normal sync workflows (exceptions: legacy/ignored).

---

## 3. Key UX Paths

### A. Sync Existing Amazon Listings

**Purpose:** Pull listings from Amazon Seller Central into Karry Kraze.

**Used for:**

- Listings already live on Amazon
- Listings created manually in Seller Central
- Detecting unmapped seller SKUs

**Result:** Records land in:

- **Synced Listings** — if auto- or manually mapped to a KK product
- **Needs Mapping** — imported Amazon rows with no mapping
- **Drafts / Issues** — suppressed, error, or health-flagged listings

**UI trigger (future):** Header `data-action="sync-amazon"`.

### B. Map Existing Amazon Listing

**Purpose:** Connect an existing Seller Central listing to a KK product.

**Result:** Listing moves **Needs Mapping → Synced Listings** when `mapping_status = mapped`.

**Important:** Mapping does **not** assume delete/recreate on Amazon. It is a **KK-side association** so future sync, reporting, and inventory comparison can treat the listing as managed. Amazon-side updates still go through SP-API when implemented.

**UI trigger (future):** `map-existing-listing` → `#amazonMappingModal` → save mapping.

### C. Push KK Product to Amazon

**Purpose:** Prepare a KK product for Amazon listing (offer creation or new catalog submission).

**Result possibilities:**

| Outcome | Target view |
|---------|-------------|
| Missing attributes / local draft only | Drafts / Issues |
| Submission rejected | Drafts / Issues |
| Pending Amazon processing | Drafts / Issues |
| Matched existing ASIN, offer created | Synced Listings or Needs Mapping (if SKU mismatch) |
| Published successfully | Synced Listings |

**UI triggers (future):** `push-kk-product`, `push-product-to-amazon`, `create-amazon-draft` → `#amazonPushModal`.

### D. Resolve Drafts / Issues

**Purpose:** Fix problems blocking sync or publication.

**Examples:**

- Missing required Amazon category attributes
- Rejected image requirements
- Price mismatch between KK and Amazon
- Low stock below threshold
- Suppression / policy issues

**UI triggers (future):** `continue-amazon-draft`, `resolve-amazon-issue`, `update-amazon-inventory`, `review-amazon-sync`, row menu actions by status.

---

## 4. Proposed Supabase Tables

**Planning only — do not create migrations yet.**

Existing KK table to reference: `products` (UUID `id`, SKU/code, title, price, stock, `amazon_url` already exists for storefront links).

---

### `amazon_marketplaces`

**Purpose:** Store supported Amazon marketplaces and enable/disable per region.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Internal row id |
| `marketplace_id` | text UNIQUE | Amazon marketplace id (e.g. `ATVPDKIKX0DER`) |
| `country_code` | text | ISO country |
| `name` | text | Display name |
| `domain` | text | e.g. `amazon.com` |
| `is_enabled` | boolean | Whether KK syncs this marketplace |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Relationships:** Referenced by listings, drafts, sync runs (via marketplace_id text or FK).

---

### `amazon_listings`

**Purpose:** Store seller Amazon listing/offer records imported from sync.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `marketplace_id` | text | FK → `amazon_marketplaces.marketplace_id` |
| `asin` | text NULL | Catalog ASIN when known |
| `seller_sku` | text | Seller SKU — sync upsert key with marketplace |
| `amazon_title` | text | Title from Amazon |
| `status` | text | See listing status enums |
| `price` | numeric | Current offer price |
| `currency` | text | e.g. USD |
| `quantity` | integer NULL | Fulfillable qty (FBM/FBA semantics TBD) |
| `fulfillment_channel` | text NULL | FBA / FBM / Amazon enum mapping TBD |
| `last_synced_at` | timestamptz | Last successful sync touch |
| `raw_listing` | jsonb | Restricted raw SP-API payload snapshot |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Unique constraint (suggested):** `(marketplace_id, seller_sku)`

**Relationships:**

- One-to-many → `amazon_listing_mappings`
- One-to-many → `amazon_listing_issues`
- Optional link from mapping to `products`

---

### `amazon_listing_mappings`

**Purpose:** Connect Amazon listings to KK products.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `amazon_listing_id` | uuid FK | → `amazon_listings.id` |
| `kk_product_id` | uuid FK | → `products.id` |
| `kk_sku` | text | Denormalized KK SKU at map time |
| `mapping_status` | text | mapped, ignored, legacy, needs_review, etc. |
| `mapping_confidence` | text | high, medium, low (for auto-suggest) |
| `mapped_by` | uuid NULL | Admin user |
| `mapped_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Relationships:** Join table between `amazon_listings` and `products`.

**Notes:** Ignored/legacy mappings keep listing out of **Synced Listings** active workflows but retain history.

---

### `amazon_listing_drafts`

**Purpose:** Local draft listing data before/during Amazon submission.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `kk_product_id` | uuid FK | → `products.id` |
| `kk_sku` | text | |
| `marketplace_id` | text | Target marketplace |
| `asin` | text NULL | If creating offer on existing ASIN |
| `seller_sku` | text NULL | Proposed seller SKU |
| `product_type` | text NULL | Amazon product type (PTD API) |
| `draft_status` | text | See draft status enums |
| `draft_payload` | jsonb | Full form state (title, bullets, attrs, images) |
| `validation_errors` | jsonb | Client/server validation snapshot |
| `last_previewed_at` | timestamptz NULL | |
| `submitted_at` | timestamptz NULL | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Relationships:** Links to `products`; may later link to `amazon_listings` after publish.

---

### `amazon_sync_runs`

**Purpose:** Track sync jobs for observability and admin UI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `sync_type` | text | full, incremental, single_sku, etc. |
| `marketplace_id` | text NULL | Scope |
| `status` | text | See sync status enums |
| `started_at` | timestamptz | |
| `finished_at` | timestamptz NULL | |
| `records_seen` | integer | |
| `records_created` | integer | |
| `records_updated` | integer | |
| `records_failed` | integer | |
| `triggered_by` | uuid NULL | Admin user |
| `summary` | jsonb | Counts by view bucket, error samples |
| `created_at` | timestamptz | |

**Relationships:** Optional one-to-many → `amazon_sync_errors`.

---

### `amazon_sync_errors`

**Purpose:** Row-level or batch errors during sync (companion to sync runs).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `sync_run_id` | uuid FK | → `amazon_sync_runs.id` |
| `seller_sku` | text NULL | |
| `asin` | text NULL | |
| `error_code` | text NULL | |
| `message` | text | |
| `raw_error` | jsonb | Restricted |
| `created_at` | timestamptz | |

---

### `amazon_listing_issues`

**Purpose:** Track listing health and workflow problems.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `amazon_listing_id` | uuid NULL FK | → `amazon_listings.id` |
| `kk_product_id` | uuid NULL FK | → `products.id` |
| `draft_id` | uuid NULL FK | → `amazon_listing_drafts.id` |
| `issue_type` | text | draft, submission, sync_warning, low_stock, suppression, etc. |
| `severity` | text | info, warning, error |
| `message` | text | Human-readable |
| `source` | text | sync, push, manual, amazon_webhook TBD |
| `status` | text | open, acknowledged, resolved |
| `raw_error` | jsonb NULL | Restricted |
| `resolved_at` | timestamptz NULL | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `amazon_push_queue`

**Purpose:** Optional async queue for push/submit jobs (heavy SP-API work off the browser).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `kk_product_id` | uuid FK | |
| `draft_id` | uuid NULL FK | |
| `marketplace_id` | text | |
| `action` | text | preview, submit, create_offer, etc. |
| `status` | text | queued, running, success, failed |
| `payload` | jsonb | Job input |
| `result` | jsonb NULL | Job output |
| `attempts` | integer | |
| `last_error` | text NULL | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Notes:** May be deferred until submit workflow exists; useful if SP-API calls are slow or rate-limited.

---

### Suggested read model (future)

Mirror eBay pattern (`v_ebay_listing_workspace`): a view such as `v_amazon_listing_workspace` joining listings + mappings + products + open issues for the **Synced Listings** table and stats cards.

---

## 5. Suggested Status Enums

Values are proposals until schema migration; use text + check constraints or enum types later.

### Listing status (`amazon_listings.status`)

| Value | Meaning |
|-------|---------|
| `active` | Buyable / active offer |
| `inactive` | Not buyable, not necessarily deleted |
| `out_of_stock` | Zero fulfillable quantity |
| `low_stock` | Below configured threshold |
| `draft` | Amazon-side draft or incomplete |
| `issue` | Open health issue attached |
| `suppressed` | Amazon suppression |
| `unknown` | Unparsed or missing from API |

### Mapping status (`amazon_listing_mappings.mapping_status`)

| Value | Meaning |
|-------|---------|
| `mapped` | Active KK connection |
| `unmapped` | No row yet (query via absence of mapping) |
| `suggested` | Auto-match candidate, not confirmed |
| `ignored` | Admin chose not to map |
| `legacy` | Tracked but excluded from sync |
| `needs_review` | Ambiguous match |

### Draft status (`amazon_listing_drafts.draft_status`)

| Value | Meaning |
|-------|---------|
| `draft` | Editable local draft |
| `needs_attributes` | Missing required product-type fields |
| `ready_to_submit` | Validation passed locally |
| `submitted` | Sent to Amazon, awaiting result |
| `rejected` | Amazon rejected submission |
| `published` | Live listing created/updated |
| `archived` | No longer active |

### Sync run status (`amazon_sync_runs.status`)

| Value | Meaning |
|-------|---------|
| `queued` | Waiting to start |
| `running` | In progress |
| `success` | Completed without failures |
| `partial_success` | Some records failed |
| `failed` | Run failed entirely |
| `cancelled` | Admin or system cancelled |

---

## 6. View-to-Data Mapping

| View | Future data source | Query logic (conceptual) |
|------|-------------------|--------------------------|
| **Synced Listings** | `amazon_listings` + `amazon_listing_mappings` + `products` | Listings with `mapping_status = mapped` and not ignored/legacy; join KK title, price, stock for comparison columns |
| **Ready to Push** | `products` LEFT JOIN mappings/listings | KK products eligible for Amazon (in stock, has images, category known) **minus** products with active mapped listing for target marketplace |
| **Needs Mapping** | `amazon_listings` LEFT JOIN mappings | Listings with no mapping OR `mapping_status IN (suggested, needs_review)`; exclude ignored/legacy |
| **Drafts / Issues** | `amazon_listing_drafts` UNION `amazon_listing_issues` | Open drafts, rejected submissions, sync warnings, price mismatches, suppression — dedupe by product/listing in UI |

**Stats cards (future):**

| Stat | Source |
|------|--------|
| Total | Count mapped + unmapped listings for enabled marketplaces |
| Active | `status = active` |
| Low Stock | `low_stock` or issue type |
| Issues | Open rows in `amazon_listing_issues` + draft rejects |

**Tab counts:** Same queries with `COUNT(*)` — replace mock `data-count` attributes in Phase 2G.

---

## 7. Sync Strategy

### Likely sync flow (to be verified against official SP-API docs)

```
1. Admin clicks Sync Amazon (sync-amazon)
2. Browser calls Supabase edge function (e.g. amazon-sync-listings)
3. Edge function creates amazon_sync_runs row (status: running)
4. Server fetches seller listings/offers/inventory from Amazon SP-API
      → Exact endpoints TBD (Listings Items API, Reports, Inventory APIs, etc.)
5. Upsert amazon_listings by (marketplace_id, seller_sku)
6. Auto-mapping pass:
      a. Exact match: seller_sku = products.code (or normalized SKU field)
      b. Existing mapping row
      c. Prior ASIN ↔ product association if stored
      d. Fuzzy title/SKU similarity → mapping_status = suggested
7. Create/update amazon_listing_issues for suppressions, parse failures, qty/price anomalies
8. Write amazon_sync_errors for row failures
9. Finalize amazon_sync_runs (counts, summary jsonb, status)
10. Frontend reloads view data / listens for completion
```

### Sync types (future)

| Type | Use |
|------|-----|
| Full | Initial import or periodic reconciliation |
| Incremental | Since last sync timestamp (if API supports) |
| Single SKU | Row action “Sync SKU” |

### Important caveats

- **Amazon SP-API behavior is not confirmed in this doc.** Endpoint choice, pagination, rate limits, and field availability must be verified in Phase 2D against [official Amazon SP-API documentation](https://developer-docs.amazon.com/sp-api/).
- FBA vs FBM quantity may require different API calls.
- Parent/child variation listings may not flatten cleanly into one row per seller SKU.

---

## 8. Mapping Strategy

### Priority order

1. **Exact SKU match** — normalized `seller_sku` = `products.code` (or dedicated SKU column)
2. **Existing stored mapping** — `amazon_listing_mappings` row already present
3. **ASIN previously associated** — if KK product or mapping history stores ASIN
4. **Title similarity** — fuzzy match → `suggested`, admin confirms in `#amazonMappingModal`
5. **Manual admin mapping** — admin selects KK product, sets `mapped`
6. **Mark legacy / ignored** — exclude from active sync without deleting on Amazon

### Risks

| Risk | Mitigation |
|------|------------|
| Amazon seller SKU ≠ KK SKU | Normalization rules; manual mapping; don’t assume auto-match |
| Legacy Seller Central naming | Legacy/ignored status; optional “create new KK product from Amazon” path in modal |
| Variants (parent/child) | Plan parent ASIN + child seller SKU model; may map one KK product per child variant |
| Multiple marketplaces | One mapping per listing row; same KK product can have many listing rows |
| Duplicate suggestions | Confidence score + admin review queue in Needs Mapping |

**Mapping does not require delete/recreate** on Amazon. KK mapping is associative metadata plus future bidirectional sync rules.

---

## 9. Push Strategy

### Future Push KK Product flow

```
1. Admin selects KK product (Ready to Push or header action)
2. Load product + images + category into #amazonPushModal
3. Admin chooses match method (existing ASIN vs new catalog vs offer-only)
4. Load product type + required attributes (Product Type Definitions API — TBD)
5. Validate locally → save amazon_listing_drafts
6. Preview issues (amazon-preview-listing edge function)
7. Submit (amazon-submit-listing) → queue or direct SP-API call
8. On success: upsert amazon_listings + mapping → Synced Listings
9. On failure: amazon_listing_issues → Drafts / Issues
```

### Possible push outcomes

| Outcome | Description |
|---------|-------------|
| `create_offer_on_existing_asin` | Offer created on known ASIN |
| `create_new_catalog_item` | New ASIN/catalog submission |
| `create_local_draft_only` | Saved locally; not sent to Amazon |
| `needs_required_attributes` | Blocked until PTD fields filled |
| `submission_rejected` | Amazon returned errors |
| `published` | Live on Amazon |

### Fields likely required (non-exhaustive)

- Marketplace, product type, ASIN (if applicable)
- Seller SKU, title, brand, condition
- Description, bullet points, images
- Price, quantity, fulfillment channel
- Product-type-specific attributes (PTD schema)
- Variation theme / parent-child relationships if applicable

**Note:** Amazon often requires **product-type-specific attributes** before submission. Confirm required fields via **Product Type Definitions API** in Phase 2D — not assumed here.

---

## 10. Edge Function Plan

**Planning only — do not create these functions yet.**

| Function | Future purpose |
|----------|----------------|
| `amazon-auth-start` | Begin OAuth / LWA authorization for Seller Central |
| `amazon-auth-callback` | Complete auth; store refresh token server-side |
| `amazon-sync-listings` | Run sync job; upsert listings, mappings, issues |
| `amazon-get-listing` | Fetch single listing detail for row/modal |
| `amazon-preview-listing` | Validate draft against Amazon rules before submit |
| `amazon-submit-listing` | Submit draft / create offer / patch listing |
| `amazon-map-listing` | Persist mapping, update statuses |
| `amazon-export-listings` | Generate CSV export for admin download |

All functions: **admin-authenticated**, **server-side SP-API**, **no secrets in browser**.

---

## 11. Security Notes

- **Amazon credentials and refresh tokens must never be exposed in browser JS.**
- Browser calls **Supabase edge functions** (or RPC) only; edge functions call SP-API.
- **Admin authentication required** for all Amazon admin operations (match existing admin RLS patterns).
- **Logs must not store** refresh tokens, client secrets, or full LWA responses.
- **`raw_listing` / `raw_error` JSONB** — store only if needed for debugging; restrict via RLS to admin/service role; consider retention policy.
- **Rate limiting** on sync/submit endpoints to protect SP-API quotas and Supabase resources.
- Align with existing eBay integration pattern: secrets in Supabase vault / env, not in `js/admin/amazon/`.

---

## 12. Open Questions

These must be answered during SP-API research (Phase 2D) and schema design (Phase 2C):

1. **Import scope:** Can existing Seller Central listings be fully imported and managed by seller SKU alone, or are additional identifiers (ASIN, FNSKU, listing id) required for reliable upsert?
2. **SP-API endpoints:** Which official APIs handle listing fetch, inventory patch, price patch, and new listing submission for Karry Kraze’s seller account type?
3. **Variations:** How should parent/child variation listings map to KK products — one product per child SKU, or parent product with variant rows?
4. **Inventory:** How should FBA fulfillable/reserved/inbound quantities differ from FBM website stock in the UI and sync rules?
5. **Multi-marketplace:** One listing row per marketplace vs single product with many offers — which model fits KK’s catalog and admin UX?
6. **Legacy listings:** Should legacy Amazon listings be **mapped**, **ignored**, **left read-only**, or **recreated** under KK SKU conventions?
7. **Product types:** What Amazon product types correspond to each Karry Kraze category, and which PTD attributes are mandatory?
8. **Credentials:** Single seller account or multiple — how are tokens stored and rotated?
9. **Delete/archive:** When a listing is removed on Amazon, soft-delete locally or hard-delete mapping rows?
10. **Buy Box / orders:** Are order APIs in scope for profit/velocity columns, or listings-only for v1?

---

## 13. Recommended Implementation Order

| Phase | Focus |
|-------|--------|
| **2C** | Supabase schema draft + migrations (`amazon_*` tables, RLS, indexes) |
| **2D** | Amazon SP-API research against **official docs** (endpoints, PTD, auth) |
| **2E** | Edge function auth/token storage plan (`amazon-auth-*`) |
| **2F** | Read-only sync prototype (`amazon-sync-listings`, upsert listings only) |
| **2G** | Frontend live read integration (replace mock data, stats, tab counts) |
| **2H** | Mapping workflow (`amazon-map-listing`, Needs Mapping → Synced) |
| **2I** | Push draft workflow (save draft, preview validation) |
| **2J** | Submit listing workflow (queue, publish, issue handling) |

After 2J: enable `sync-amazon`, `export-listings`, modal save/submit, filters, pagination, and row menu real actions per `008_actions_and_push_flow.md`.

---

## Related Docs

- `009_view_sections.md` — UI view panels and mock data
- `010_light_js_wiring.md` — Current frontend behavior
- `008_actions_and_push_flow.md` — Action inventory
- `007_future_improvements.md` — Longer-term product roadmap

---

## Disclaimer

Amazon SP-API behavior, required fields, and endpoint availability described here are **planning assumptions**. Implementation must validate all integration details against **official Amazon SP-API documentation** before production use.
