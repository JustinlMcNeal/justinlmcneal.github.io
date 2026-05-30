# Supabase Schema (Phase 2C)

## Overview

Phase 2C creates the **database foundation** for the Karry Kraze Amazon Listings admin page. Schema design follows [`012_official_sp_api_research.md`](012_official_sp_api_research.md) §13.

**Not included in this phase:**

- Amazon SP-API edge functions
- Frontend live data wiring
- Browser access to LWA refresh tokens

---

## Migration File

| File | Purpose |
|------|---------|
| `supabase/migrations/20260721_amazon_listings_schema.sql` | All Amazon tables, RLS, triggers, US marketplace seed, workspace view |

Naming follows repo convention: `YYYYMMDD_description.sql` (after latest migration `20260720_*`).

---

## Tables Created

| Table | Purpose |
|-------|---------|
| `amazon_seller_accounts` | Authorized seller metadata (no secrets) |
| `amazon_auth_tokens` | Server-side token storage — **service_role only** |
| `amazon_marketplaces` | Supported marketplaces (US seeded) |
| `amazon_listings` | Imported seller listings/offers |
| `amazon_listing_mappings` | Amazon listing ↔ `products` join |
| `amazon_listing_drafts` | Push/draft payloads and submission metadata |
| `amazon_sync_runs` | Sync job tracking |
| `amazon_sync_errors` | Row-level sync failures |
| `amazon_listing_issues` | Listing health / workflow issues |
| `amazon_push_queue` | Async push/submit/feed jobs |
| `amazon_product_type_cache` | PTD schema metadata cache |

---

## Relationships

```
amazon_seller_accounts
  ├── amazon_auth_tokens (1:1 per account)
  ├── amazon_listings
  ├── amazon_listing_drafts
  ├── amazon_sync_runs
  ├── amazon_push_queue
  └── amazon_product_type_cache

amazon_marketplaces
  ├── amazon_listings.marketplace_id
  ├── amazon_listing_drafts.marketplace_id
  ├── amazon_sync_runs.marketplace_id
  └── amazon_push_queue.marketplace_id

amazon_listings
  ├── amazon_listing_mappings
  ├── amazon_listing_issues
  └── amazon_listing_drafts.published_amazon_listing_id

products (existing)
  ├── amazon_listing_mappings.kk_product_id  (uuid)
  ├── amazon_listing_drafts.kk_product_id
  ├── amazon_listing_issues.kk_product_id
  └── amazon_push_queue.kk_product_id

amazon_sync_runs
  └── amazon_sync_errors

amazon_listing_drafts
  ├── amazon_listing_issues.draft_id
  └── amazon_push_queue.draft_id
```

**Upsert key for listings:** `(seller_account_id, marketplace_id, seller_sku)` — matches SP-API seller SKU scope per marketplace.

**Mapping uniqueness:** Partial unique index on `amazon_listing_id WHERE mapping_status = 'mapped'`.

---

## Read Model View

### `v_amazon_listing_workspace`

Denormalized view for future **Synced Listings** tab (mirrors `v_ebay_listing_workspace`).

**Joins:**

- `amazon_listings`
- Latest `mapped` row from `amazon_listing_mappings`
- `products` (title, price, code)
- `product_variants` stock aggregate → `kk_stock`
- Open issue counts from `amazon_listing_issues`

**Granted:** `SELECT` to `authenticated`, `service_role`.

---

## RLS & Security

Pattern matches existing admin tables (`ebay_finance_transactions`, `customer_contacts`, social admin):

| Table group | service_role | authenticated |
|-------------|--------------|---------------|
| `amazon_auth_tokens` | ALL | **No access** (REVOKE) |
| Seller accounts, listings, sync, issues, queue, PTD cache, marketplaces | ALL | SELECT |
| Mappings, drafts | ALL | ALL (read/write for future admin workflows) |

**Token security:**

- No RLS policy grants browser users access to `amazon_auth_tokens`
- `lwa_refresh_token_encrypted` / `vault_secret_name` never exposed via authenticated GRANT
- Edge functions (Phase 2E+) use `service_role` for token read/write

**Assumption:** Admin pages are already behind Supabase auth for UX; **edge functions** that touch tokens must use the `is_admin()` RPC pattern (see [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md) §7). Table RLS remains open authenticated SELECT like other admin tables.

---

## Indexes

Per-table indexes on:

- Foreign keys (`seller_account_id`, `amazon_listing_id`, `kk_product_id`, etc.)
- Query filters (`listing_status`, `mapping_status`, `draft_status`, `sync run status`)
- Lookups (`seller_sku`, `asin`, `submission_id`, `feed_id`)
- Partial unique: one `mapped` mapping per listing

---

## Check Constraints

Status enums enforced at DB level for:

- `amazon_seller_accounts.region`, `token_status`
- `amazon_listings.listing_status`, `quantity_last_source`
- `amazon_listing_mappings.mapping_status`, `mapping_confidence`
- `amazon_listing_drafts` — PTD `requirements`, `parentage_level`, `push_workflow`, `draft_status`, `submission_status`
- `amazon_sync_runs.sync_type`, `status`
- `amazon_listing_issues.severity`, `source`, `status`
- `amazon_push_queue.action`, `status`
- `amazon_product_type_cache.requirements`

---

## Triggers

`public.set_updated_at()` — applied to all tables with `updated_at` (except `amazon_sync_runs` and `amazon_sync_errors` which are append-only for runs/errors).

---

## Seed Data

US marketplace inserted with `ON CONFLICT DO NOTHING`:

| marketplace_id | country | name | domain | region |
|----------------|---------|------|--------|--------|
| ATVPDKIKX0DER | US | Amazon.com | amazon.com | na |

---

## How Tables Support UI Tabs

| Admin tab | Primary data sources |
|-----------|---------------------|
| **Synced Listings** | `v_amazon_listing_workspace` — mapped listings + KK product + issues |
| **Ready to Push** | `products` LEFT JOIN mappings/listings (query in Phase 2G) |
| **Needs Mapping** | `amazon_listings` LEFT JOIN mappings WHERE status ≠ mapped/ignored |
| **Drafts / Issues** | `amazon_listing_drafts` + `amazon_listing_issues` |

Stats cards (future): aggregate from `amazon_listings`, `amazon_listing_issues`, mapping counts.

---

## Intentionally Not Implemented

- ~~SP-API sync edge function~~ — **2F prototype:** [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md)
- ~~Auth OAuth edge functions~~ — **2E complete** (see `014`–`017`)
- Frontend Supabase reads in `js/admin/amazon/`
- Realtime subscriptions
- Notifications webhook handlers
- Auto-mapping logic
- Row-level admin user scoping (`mapped_by` is uuid without auth.users FK)

---

## TODOs / Assumptions

1. **`amazon_auth_tokens.lwa_refresh_token_encrypted`** — prefer Supabase Vault (`vault_secret_name`); detailed in [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md) §5.
2. **`mapped_by` / `triggered_by`** — uuid only; no FK to `auth.users` to avoid auth schema coupling.
3. **`listing_status`** — app-normalized from SP-API `BUYABLE`/`DISCOVERABLE` + issues; not auto-computed in DB yet.
4. **Ready to Push view** — still mock; **Needs Mapping** uses `v_amazon_unmapped_listings` (Phase 2J — [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)).
5. **Low stock threshold** — not in schema; future rule engine or config table.

---

## Related Docs

- [`011_data_model_and_sync_strategy.md`](011_data_model_and_sync_strategy.md) — original planning baseline
- [`012_official_sp_api_research.md`](012_official_sp_api_research.md) — SP-API research + §13 schema adjustments
- [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md) — Phase 2E OAuth / token edge function plan
- [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md) — Phase 2F read-only sync
- [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md) — Phase 2J mapping + `v_amazon_unmapped_listings`

---

## Recommended Next Phase

**2E — Edge function auth/token plan** — see [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)

1. `amazon-auth-status` → `amazon-auth-start` / `amazon-auth-callback` → `amazon-auth-disconnect`
2. Write `amazon_seller_accounts` + `amazon_auth_tokens` (service_role + Vault)
3. Then **2G** frontend live reads + Sync button wiring (2F sync done: [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md))
