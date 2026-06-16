# KK Universal Storage — Implementation Wiring Plan

**Status:** Phase 2 complete — audit + plan only (no code, no migrations)  
**Prerequisite:** Static UX complete ([ux/001_static_ux_shell_complete.md](../ux/001_static_ux_shell_complete.md))  
**UI contract:** `pages/admin/inventory.html`  
**JS root:** `js/admin/inventory/`  
**Strategy:** Ledger-first — extend existing `product_variants.stock` + `stock_ledger` before adding reservations, channel sync, and issue automation

*Last updated: 2026-06-09*

---

## 1. Project overview

The Inventory admin page is the future **universal stock dashboard** for Karry Kraze. Today it is a static mock. This plan describes how to wire it to real data and evolve the backend toward a single source of truth without breaking CPI, parcel receive, or existing channel listing flows.

### End-state capabilities (not all in early phases)

| Capability | Description |
|------------|-------------|
| **Universal on-hand view** | Variant-level stock with product rollups |
| **Reserved / available** | Reserve on paid order; finalize on ship; reverse on cancel/refund |
| **Audited ledger** | Every stock change via `stock_ledger` with reason + reference |
| **Channel comparison** | KK vs eBay vs Amazon qty on one row (no per-channel buffer in v1) |
| **Issue detection** | Unmapped lines, negative stock, channel listing ended/inactive, parcel mapping gaps |
| **Manual adjustments** | Admin corrections with reason — never silent edits |
| **Parcel receive** | Continue existing receive RPC; surface in universal ledger UI |
| **Channel sync push** | Push `available` qty to KK/eBay/Amazon equally |
| **eBay relist assist** | Future — detect ended listings after restock |
| **Bundle BOM rules** | Future — separate SKUs for now |

### Decisions locked for v1

- **Source of truth:** `product_variants.stock` remains the on-hand column; `stock_ledger` is the audit trail; new `inventory_reservations` table holds reserved qty (Phase 6+).
- **Unified channel qty:** All channels display/push the same sellable number (`available = on_hand - reserved`). No channel buffers yet.
- **Variant-first:** Inventory rows keyed by `product_variant_id` wherever possible.
- **No guessed deductions:** Unmapped order lines create issues; do not decrement stock.
- **Negative stock:** Allowed temporarily but flagged as `negative_stock` issue.
- **Bundle SKUs:** Treated as separate stocked items (e.g. Brass D Ring x3) until Phase 10.
- **Manual edits:** Must write ledger rows (fix Products admin silent-edit gap).
- **Parcel receive:** Audit existing RPC before changing; already writes ledger with `reason = parcel_receive`.

---

## 2. Implementation principles

| Principle | Rule |
|-----------|------|
| **Read before write** | Phase 3 wires live reads only; no stock mutations from Inventory page until Phase 4+ |
| **File size cap** | Keep JS files **< 500 lines**; split at ~400 lines |
| **Thin entry** | `index.js` orchestrates init — no business logic blob |
| **Renderers stay dumb** | `renderers/*` accept data shapes; no Supabase calls |
| **API layer** | New `api/*` for Supabase reads/writes; views/RPCs preferred over client-side joins |
| **Services for rules** | `services/*` for filter/sort/KPI math on client when views are insufficient |
| **State module** | `state.js` when live session + filter state outgrows `events.js` |
| **Idempotency** | All order-line stock effects keyed by `(source, order_id, line_id, event_type)` |
| **Do not break CPI** | Parcel approve RPC stays cost-only; receive stays stock-only |
| **Migrate legacy DDL** | Add repo migrations for `stock_ledger` / `inventory_summary` before fresh-env deploy |

### Module dependency direction (target)

```
index.js
  → dom.js, events.js, state.js (Phase 3+)
  → api/* (Supabase reads/writes)
  → services/* (client transforms when needed)
  → renderers/* (HTML only)
  → utils/* (formatters, shared helpers)
```

---

## 3. Current state discovered (audit summary)

### What works today

| Flow | Stock behavior | Ledger? |
|------|----------------|---------|
| **KK Store checkout** | Decrement on Stripe payment (`stripe-webhook`) | Yes — `reason: order` |
| **KK Store full refund** | Re-increment stock | Yes — `reason: refund` |
| **Parcel receive** | Increment on approved import (`receive_parcel_import_inventory`) | Yes — `reason: parcel_receive` |
| **Products admin save** | Direct `product_variants.stock` update | **No ledger** |
| **eBay publish/update qty** | Pushes KK stock → eBay Inventory API | No local stock change |
| **Amazon patch qty** | Pushes KK stock → Amazon; updates `amazon_listings.fbm_quantity` | No local stock change |
| **eBay/Amazon order sync** | Imports orders to `orders_raw` / `line_items_raw` | **No stock change** |

### Critical gaps

1. **No reservations** — UI mock shows `reserved` / `available` but DB has no reservation table.
2. **Channel sales don't reduce KK stock** — eBay/Amazon orders are imported for profit/fulfillment views only.
3. **KK deducts at payment, not ship** — conflicts with target "reserve on paid, finalize on ship" model.
4. **Admin product edits bypass ledger** — silent stock changes from `upsertVariants()`.
5. **Legacy DDL not in migrations** — `stock_ledger`, `inventory_summary`, base `products` / `product_variants` CREATE statements missing from repo.
6. **No universal issue table** — Amazon has `amazon_listing_issues`; eBay has link-check states; no cross-channel inventory issue model.
7. **Inventory page unwired** — mock data only; no `requireAdmin`.

### Auth patterns (admin pages)

| Page | Guard | Notes |
|------|-------|-------|
| Products, Amazon, Parcel Imports | `requireAdmin()` / `is_admin` RPC | Canonical |
| Line Items Orders | Session only | Does not verify admin role |
| eBay Listings | `requireAdmin()` called but result not always enforced | Inconsistent |
| **Inventory (today)** | **None** | Must add in Phase 3 |

---

## 4. Existing tables and views

### Core stock (legacy + migrations)

| Object | Role | In repo migrations? |
|--------|------|---------------------|
| **`product_variants`** | **On-hand SOT** — `stock INTEGER NOT NULL DEFAULT 0` | Partial (phase1 columns only) |
| **`products`** | Parent catalog — **no stock column**; `code` is internal SKU prefix | No base CREATE |
| **`stock_ledger`** | Audit trail — `variant_id`, `product_id`, `change`, `reason`, `reference_id`, `stock_before`, `stock_after` | **No CREATE** (used in prod) |
| **`inventory_summary`** | Product-level rollup (`total_stock`) for Products admin | **No CREATE** (queried in JS) |

### Parcel imports (fully migrated)

| Table | Stock relevance |
|-------|-----------------|
| `parcel_imports` | `inventory_received_at`, `inventory_received_by`, `inventory_receive_idempotency_key` |
| `parcel_import_items` | `quantity` per Baestao row |
| `parcel_import_item_mappings` | `product_id`, `product_variant_id`, `row_type`, `mapping_status` |
| `parcel_import_events` | `inventory_received` event type |

**RPC:** `receive_parcel_import_inventory(import_id, idempotency_key)` — only SQL RPC that writes stock + ledger today.

### Orders

| Table | Stock relevance |
|-------|-----------------|
| `orders_raw` | Order header; KK (`stripe_*`), eBay (`ebay_*`), Amazon session prefixes |
| `line_items_raw` | `quantity`, `product_id` (text SKU/code), `variant_id` (UUID, migration-added), `variant_sku`, fulfillment fields |

Order sync RPCs/edges import rows — **no stock side effects**.

### Amazon channel

| Object | Role |
|--------|------|
| `amazon_listings` | Channel qty: `fbm_quantity`, `fba_fulfillable_quantity`, `fba_reserved_quantity`, `fba_inbound_quantity` |
| `amazon_listing_mappings` | `kk_product_id`, `kk_variant_id`, `mapping_status` |
| `amazon_listing_issues` | Open listing issues (status, severity) |
| **`v_amazon_listing_workspace`** | `kk_stock`, `inventory_compare_status`, `inventory_delta`, `has_inventory_mismatch` |

### eBay channel

| Object | Role |
|--------|------|
| `products.ebay_*` | Local listing pointers (`ebay_sku`, `ebay_offer_id`, `ebay_listing_id`, `ebay_status`, …) |
| **`v_ebay_listing_workspace`** | `active_variant_stock_total`, listing health flags, sales metrics |
| No separate eBay listings table | Mapping lives on `products` + variant SKUs |

---

## 5. Existing code paths (by area)

### Products admin — `js/admin/products/`

| File | Stock role |
|------|------------|
| `api.js` | Reads `inventory_summary`; `upsertVariants()` writes `product_variants.stock` directly |
| `modalEditor.js` / `modalRows.js` | Per-variant stock inputs |
| `renderTable.js` / `index.js` | OOS/low badges from aggregated stock |

### Parcel imports — `js/admin/parcelImports/`

| File | Stock role |
|------|------------|
| `api/inventoryReceiveApi.js` | Calls `receive_parcel_import_inventory` RPC |
| `ui/inventoryReceiveActions.js` | Receive button UX; blocks unmapped business rows |
| `api/approvalApi.js` | CPI approve — **no stock** |
| `ui/itemMappingTable.js` | Maps rows → `product_variant_id` |

### Line items / orders — `js/admin/lineItemsOrders/`

| File | Stock role |
|------|------------|
| `workspaceFulfillment.js` | Ship/label UI — no stock |
| `ebayOrderSync.js` / `amazonOrderSync.js` | Order import edges — no stock |
| `api.js` | Order reads, KPIs |

### eBay listings — `js/admin/ebayListings/`

| File | Stock role |
|------|------------|
| `utils.js` | `publishQuantityForProduct()` sums active variant stock |
| `tableActions.js` / `pushModal.js` / `bulkActions.js` | Push qty to eBay API |
| `linkCheck.js` / `reconcileActions.js` | Stale, out-of-stock, SKU mismatch detection |

### Amazon listings — `js/admin/amazon/`

| File | Stock role |
|------|------------|
| `api.js` | Reads `v_amazon_listing_workspace` |
| `listingInventoryMismatch.js` | KK vs Amazon compare UI |
| `listingPatch.js` / `bulkPatch.js` | Patch Amazon qty; `match_kk_stock` bulk op |

### Edge functions (stock-related)

| Function | Writes `product_variants.stock`? |
|----------|----------------------------------|
| `stripe-webhook` | Yes — order/refund |
| `create-checkout-session` | Pre-check only |
| `ebay-manage-listing` | No — eBay API only |
| `ebay-sync-orders` | No |
| `amazon-sync-listings` | No — pulls Amazon qty |
| `amazon-patch-listing` / `amazon-bulk-patch-listings` | No — channel qty only |

### Inventory page (mock) — `js/admin/inventory/`

| Path | Role |
|------|------|
| `index.js`, `events.js`, `mockData.js` | Static UX |
| `renderers/*` | Section HTML from mock data |
| `utils/formatters.js` | `esc()` helper |

---

## 6. Current source of truth map

| Concept | Current SOT | Notes |
|---------|-------------|-------|
| **Product on-hand** | `SUM(product_variants.stock WHERE is_active)` | No product-level stock column |
| **Variant on-hand** | `product_variants.stock` | Integer, can hit 0 via webhook clamp |
| **Channel listing stock (eBay)** | eBay Inventory API (live) | Local push reads from KK variants |
| **Channel listing stock (Amazon FBM)** | `amazon_listings.fbm_quantity` + live Seller Central | Compared to `kk_stock` in view |
| **Channel listing stock (Amazon FBA)** | `amazon_listings.fba_*` | Managed by Amazon; not patchable from admin |
| **Parcel received stock** | Applied via receive RPC → variant stock | Idempotent per import |
| **Order line quantity** | `line_items_raw.quantity` | Sales record, not stock |
| **Reserved quantity** | **Does not exist** | Mock only |
| **Available quantity** | **Same as on-hand today** | No reservation subtraction |
| **Fulfilled/shipped qty** | Fulfillment fields on orders/line items | Not tied to stock finalize |
| **Stock audit history** | `stock_ledger` | Incomplete — admin edits missing |
| **Ledger reasons in prod** | `order`, `refund`, `parcel_receive` | No `manual_adjustment`, `reserve`, `finalize`, `release` yet |

---

## 7. Mapping relationships

```
products (id, code)
  └── product_variants (id, sku, option_value, stock)
        ↑ parcel_import_item_mappings.product_variant_id  (business_inventory + matched)
        ↑ amazon_listing_mappings.kk_variant_id
        ↑ stripe checkout line_items.variant_id
        ↑ line_items_raw.variant_id (when populated)

products.code  ←→  line_items_raw.product_id (text SKU)
products.ebay_sku / variant SKU pattern {code}-{OPTION}
amazon_listings.seller_sku / asin  ←→  amazon_listing_mappings → kk_product_id / kk_variant_id
parcel_import_items  ←→  parcel_import_item_mappings → product_id / product_variant_id
```

### Mapping gaps (issue sources)

| Gap | Where it surfaces | Future issue type |
|-----|-------------------|-------------------|
| eBay order line fuzzy match fails | `ebay-sync-orders` logs unmatched | `unmapped_order_line` |
| Amazon order import without variant | Amazon order sync | `unmapped_order_line` |
| KK Stripe line missing `variant_id` | webhook falls back to SKU+option text | Risk of wrong variant or skip |
| Parcel business row unmapped | receive blocked | `parcel_mapping_missing` |
| Amazon listing unmapped | `v_amazon_listing_workspace` | compare status `unmapped` |
| eBay product without offer/listing | `v_ebay_listing_workspace` health flags | `ebay_listing_ended` / unlisted |
| Amazon inactive/suppressed | `listing_status`, issues table | `amazon_listing_inactive` |

---

## 8. Current stock flow (text diagram)

```
                         ┌─────────────────────────────────┐
                         │     product_variants.stock      │
                         │   (variant-level on-hand SOT)   │
                         └─────────────────────────────────┘
                              ↑           ↑           ↑
                              │           │           │
              ┌───────────────┘           │           └────────────────┐
              │                           │                            │
    ┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
    │  Parcel Receive RPC │    │   stripe-webhook     │    │  Products admin     │
    │  (+qty, approved    │    │   payment: -qty      │    │  upsertVariants     │
    │   import only)      │    │   refund: +qty       │    │  (direct set, NO    │
    └─────────────────────┘    └──────────────────────┘    │   ledger)           │
              │                           │                └─────────────────────┘
              ↓                           ↓
    ┌─────────────────────────────────────────────────────────────────┐
    │                        stock_ledger                              │
    │   reasons: parcel_receive | order | refund                       │
    └─────────────────────────────────────────────────────────────────┘

    Channel qty (READ/PUSH only — separate from ledger today):
    ┌──────────────┐     read KK stock      ┌──────────────┐
    │  eBay API    │ ←───────────────────── │ publishQty   │
    └──────────────┘                        └──────────────┘
    ┌──────────────┐     read kk_stock      ┌──────────────┐
    │ Amazon SC    │ ←───────────────────── │ patch/bulk   │
    │ fbm_quantity │                        └──────────────┘
    └──────────────┘

    Orders (NO stock effect today):
    eBay sync ──→ orders_raw / line_items_raw
    Amazon sync ──→ orders_raw / line_items_raw
    Fulfillment UI ──→ labels/tracking only
```

---

## 9. Proposed target stock flow

```
Sources of stock CHANGE (all via RPC/edge + ledger):
  parcel_receive | manual_adjustment | order_reserve | order_finalize |
  order_release | order_refund_release | sync_correction (future)

                         ┌─────────────────────────────────┐
                         │     product_variants.stock        │
                         │          (on_hand)                │
                         └─────────────────────────────────┘
                              ↑                    │
                              │                    ↓
                    ledger write (always)   ┌──────────────────┐
                              │             │ inventory_       │
                              ↓             │ reservations     │
                    ┌─────────────────┐   │ (reserved qty)   │
                    │  stock_ledger   │   └──────────────────┘
                    │  + idempotency  │            │
                    └─────────────────┘            ↓
                                         available = on_hand - reserved

Order lifecycle (target):
  paid     → reserve (+issue if unmapped, no guess)
  shipped  → finalize (move reserved → deducted)
  cancel/refund before ship → release reservation

Channel sync (target, Phase 7):
  push available qty → KK storefront / eBay / Amazon FBM (same number)

Issues (target):
  inventory_issues view/table ← negative stock, unmapped lines, channel status, parcel gaps
```

---

## 10. Proposed database changes

**Phase 2: plan only. Implement in phased migrations starting Phase 3–4.**

### 10.1 Prerequisite — document legacy DDL (Phase 3 prep)

| Migration | Purpose |
|-----------|---------|
| `20260xxx_stock_ledger_baseline.sql` | CREATE `stock_ledger` if not exists; indexes on `variant_id`, `created_at`, `reason` |
| `20260xxx_inventory_summary_view.sql` | Recreate `inventory_summary` from `product_variants` |
| Verify live Supabase DDL | Dump prod columns (`created_at`, FKs) before writing migration |

### 10.2 New tables (Phase 4–6)

#### `inventory_reservations` (Phase 6)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `variant_id` | uuid FK → product_variants | Required |
| `product_id` | uuid FK → products | Denormalized |
| `quantity` | integer | Reserved units |
| `source` | text | `kk` \| `ebay` \| `amazon` |
| `order_id` | text | Session / marketplace order id |
| `line_item_id` | uuid/null | FK → line_items_raw when resolvable |
| `status` | text | `reserved` \| `finalized` \| `released` |
| `idempotency_key` | text UNIQUE | `{source}:{order_id}:{line_ref}:reserve` |
| `created_at` / `updated_at` | timestamptz | |

#### `inventory_stock_events` (optional — if ledger alone insufficient for idempotency)

Alternative: add `idempotency_key` column to `stock_ledger` instead of separate table. **Recommendation:** extend `stock_ledger` with:

- `idempotency_key text UNIQUE NULL`
- `created_at timestamptz DEFAULT now()`
- `source text` — `kk`, `ebay`, `amazon`, `parcel`, `admin`
- `metadata jsonb` — channel-specific context

### 10.3 Issue model (Phase 3 read view → Phase 8 workflow)

Start as **`v_inventory_issues`** (read-only union view), migrate to **`inventory_issues`** table when resolve/snooze needed.

| Issue type | Detection source |
|------------|------------------|
| `negative_stock` | `product_variants.stock < 0` |
| `unmapped_order_line` | `line_items_raw` where `variant_id IS NULL` and order paid |
| `parcel_mapping_missing` | approved import, not received, unmapped business rows |
| `amazon_listing_inactive` | `v_amazon_listing_workspace` listing_status / buyable |
| `ebay_listing_ended` | `products.ebay_status` / link-check out_of_stock |
| `channel_stock_mismatch` | kk_stock vs channel qty delta ≠ 0 |

### 10.4 Views / RPCs for Inventory page (Phase 3)

#### `v_inventory_workspace` (primary table feed)

One row per **active variant** (or per mapped channel SKU — start variant-level):

| Column | Source |
|--------|--------|
| `variant_id`, `product_id`, `product_code`, `product_name` | products + variants |
| `variant_title`, `variant_sku`, `internal_sku` | variant fields |
| `on_hand` | `product_variants.stock` |
| `reserved` | `SUM(inventory_reservations)` or 0 until Phase 6 |
| `available` | `on_hand - reserved` |
| `threshold` | new `product_variants.reorder_threshold` or product default (Phase 4) |
| `kk_stock` | same as on_hand for KK storefront |
| `ebay_stock` | from eBay API cache or last-sync column (Phase 3: nullable) |
| `amazon_stock` | `amazon_listings.fbm_quantity` via mapping |
| `sync_state` | computed |
| `status` | healthy / low / issue |
| `updated_at` | max(variant updated, last ledger entry) |

#### `v_inventory_kpis`

Aggregates: total_skus, on_hand_units, reserved_units, available_units, low_stock_count, unmapped_lines, issue_count, last_channel_sync.

#### `v_inventory_ledger_recent`

Last N rows from `stock_ledger` joined to variant/product names.

#### RPCs (Phase 4+)

| RPC | Purpose |
|-----|---------|
| `adjust_inventory(variant_id, change, reason, note, idempotency_key)` | Manual adjustment + ledger |
| `reserve_order_line(...)` | Phase 6 |
| `finalize_order_line(...)` | Phase 6 |
| `release_order_line(...)` | Phase 6 |

**Do not rewrite** `receive_parcel_import_inventory` until Phase 5 audit sign-off — extend/wrap if needed.

---

## 11. Proposed JS structure (wiring phases)

Current layout (keep):

```
js/admin/inventory/
├── index.js
├── dom.js
├── events.js
├── mockData.js          ← replace incrementally; delete when fully wired
├── renderers/
│   ├── renderKpis.js
│   ├── renderChannelStatus.js
│   ├── renderInventoryTable.js
│   ├── renderLedger.js
│   ├── renderIssues.js
│   └── renderBundle.js
└── utils/
    └── formatters.js
```

Add when justified:

```
js/admin/inventory/
├── state.js             # Phase 3 — session, filters, active tab, loaded data
├── api/
│   ├── inventoryApi.js      # v_inventory_workspace, KPIs, ledger
│   ├── channelStatusApi.js  # reuse amazon/eBay auth patterns
│   └── issuesApi.js         # v_inventory_issues
├── services/
│   ├── filterInventory.js   # client filter if view params insufficient
│   ├── sortInventory.js
│   └── mapRowToTable.js     # DB row → renderer shape
└── constants.js             # issue types, reason enums, tab ids
```

### Phase 3 wiring map (reads)

| UI section | Data source | Module |
|------------|-------------|--------|
| KPI cards | `v_inventory_kpis` | `api/inventoryApi.js` → `renderKpis.js` |
| Channel strip | Amazon auth panel + eBay setup state + KK store config | `api/channelStatusApi.js` |
| Inventory table | `v_inventory_workspace` | `api/inventoryApi.js` → `services/mapRowToTable.js` → `renderInventoryTable.js` |
| Ledger panel | `v_inventory_ledger_recent` | `api/inventoryApi.js` → `renderLedger.js` |
| Issues panel | `v_inventory_issues` | `api/issuesApi.js` → `renderIssues.js` |
| Tabs/filters | Client-side on loaded rows initially | `events.js` + `services/filterInventory.js` |

Replace `mockData.js` imports in `index.js` / `events.js` one section at a time; keep mock as fallback until view is stable.

---

## 12. Implementation phases (recommended sequence)

Aligns with [ux/roadmap.md](../ux/roadmap.md) — refined numbering after this audit.

### Phase 2 — Wiring plan / audit ✅ (this document)

Deliverables: this plan, implementation roadmap index, UX roadmap Phase 2 marked complete.

### Phase 3 — Live read-only Inventory page

**Scope:** Wire page to Supabase views; add `requireAdmin`; no writes.

| Task | Notes |
|------|-------|
| Migration: baseline `stock_ledger` + `inventory_summary` | Document legacy DDL |
| Create `v_inventory_workspace`, `v_inventory_kpis`, `v_inventory_ledger_recent`, `v_inventory_issues` | Start with SQL-only issue detection |
| Add `api/inventoryApi.js`, `state.js` | |
| Swap renderers from mock → live data | Keep client filters |
| Channel strip: read Amazon/eBay connection from existing auth | |
| `requireAdmin()` in `index.js` | Match Products page |
| Remove or gate `mockData.js` behind dev flag | |

**Exit:** Page shows real stock; Sync/Receive/Export still placeholder toasts.

### Phase 4 — Manual ledger adjustments

**Scope:** Admin corrections with audit; fix Products silent-edit gap (coordinate separately or deprecate stock field there).

| Task | Notes |
|------|-------|
| Extend `stock_ledger` with `idempotency_key`, `source`, `created_at` | Migration |
| RPC `adjust_inventory` | Reason enum includes `manual_adjustment` |
| Inventory page: adjustment modal from row actions | |
| Optional: `reorder_threshold` on variants | Powers low-stock KPI |

**Exit:** Manual edits only through ledger RPC; Products admin stock input flagged for migration.

### Phase 5 — Parcel receive unified with ledger UI

**Scope:** Surface existing receive in Inventory context; **audit RPC before changing**.

| Task | Notes |
|------|-------|
| Read-only audit of `receive_parcel_import_inventory` | Confirm idempotency, ledger rows |
| Inventory "Receive Stock" → link/filter to Parcel Imports awaiting receive | No RPC rewrite unless gaps found |
| Ledger panel shows `parcel_receive` entries (already in DB) | |
| KPI: parcel rows awaiting mapping | From parcel tables |

**Exit:** Operators see parcel receive impact in universal ledger; receive action may still live on Parcel page.

### Phase 6 — Order reserve / finalize / reverse

**Scope:** Largest behavioral change — coordinate with order flows.

| Task | Notes |
|------|-------|
| Create `inventory_reservations` | |
| RPCs: reserve, finalize, release | Idempotency keys per order line |
| Hook KK paid orders | May require changing stripe-webhook from immediate deduct → reserve |
| Hook eBay/Amazon paid imports | Only when `variant_id` mapped; else issue |
| Fulfillment finalize | `lineItemsOrders` ship event → finalize RPC |
| Cancel/refund before ship → release | |
| Negative stock → auto-issue | |

**Exit:** `reserved` / `available` columns live; unified lifecycle documented.

### Phase 7 — Channel quantity sync

**Scope:** Push `available` to all channels (same qty).

| Task | Notes |
|------|-------|
| `Sync Channels` action → orchestration edge or sequential calls | |
| Reuse `ebay-manage-listing`, `amazon-patch-listing` / bulk | |
| KK storefront stock | Confirm where KK store reads qty (variants) |
| Track `last_channel_sync` per variant or global | |
| Surface mismatches in table (already in mock) | |

**Exit:** One-button sync pushes available qty; mismatches visible.

### Phase 8 — Issue workflows

**8B complete** — [022_phase_8b_issue_resolution_tracking.md](./022_phase_8b_issue_resolution_tracking.md)

| Task | Status |
|------|--------|
| `inventory_issue_states` table + RLS | ✅ |
| `v_inventory_issues_with_state` view | ✅ |
| Group issue keys + sample key helpers | ✅ |
| Detail modal: reviewed / snooze / resolve / ignore / reopen | ✅ |
| Issues panel workflow filters | ✅ |
| Alert counts exclude resolved + active snoozes | ✅ |

**8C complete** — [023_phase_8c_mapping_assist_wizards.md](./023_phase_8c_mapping_assist_wizards.md)

| Task | Status |
|------|--------|
| Mapping suggestions view | ✅ |
| Mapping assist modal + confirm apply RPC | ✅ |
| Unmapped order line → `variant_id` | ✅ |
| Amazon variant → `amazon_listing_mappings` | ✅ |
| Audit log `inventory_mapping_assist_actions` | ✅ |

**8D complete** — [024_phase_8d_reservation_retry_mapped_lines.md](./024_phase_8d_reservation_retry_mapped_lines.md)

| Task | Status |
|------|--------|
| `v_inventory_reservation_retry_candidates` view | ✅ |
| `retry_inventory_reservation_for_order_line` RPC | ✅ |
| `inventory_reservation_retry_actions` audit | ✅ |
| Post-mapping reservation prompt in assist modal | ✅ |
| Issue detail retry candidates + action | ✅ |

**8E complete** — [025_phase_8e_shipped_finalize_audit.md](./025_phase_8e_shipped_finalize_audit.md)

| Task | Status |
|------|--------|
| `v_inventory_shipped_finalize_audit` view | ✅ |
| Issue group `shipped_finalize_audit_needed` | ✅ |
| Shipped audit modal (read-only) | ✅ |
| Issue detail samples + workflow reuse | ✅ |

**8F complete** — [026_phase_8f_manual_finalize_assist.md](./026_phase_8f_manual_finalize_assist.md)

| Task | Status |
|------|--------|
| `is_finalize_eligible` on audit view | ✅ |
| `manual_finalize_shipped_order_line` RPC | ✅ |
| `inventory_manual_finalize_actions` audit | ✅ |
| Shipped audit modal Manual Finalize | ✅ |
| Issue detail eligible sample action | ✅ |

**8G complete** — [027_phase_8g_ebay_safe_mapping_hints.md](./027_phase_8g_ebay_safe_mapping_hints.md)

| Task | Status |
|------|--------|
| eBay match types on `v_inventory_mapping_suggestions` | ✅ |
| eBay evidence + variant pick in Mapping Assist | ✅ |
| Map Line from Shipped Finalize Audit | ✅ |
| `v_inventory_ebay_unmapped_group_counts` | ✅ |

**8H complete** — [028_phase_8h_bulk_mapping_visibility.md](./028_phase_8h_bulk_mapping_visibility.md)

| Task | Status |
|------|--------|
| `v_inventory_ebay_mapping_worklist` + lines view | ✅ |
| `inventory_mapping_assist_batches` batch audit | ✅ |
| `apply_inventory_mapping_assist_batch` RPC | ✅ |
| eBay Mapping Worklist modal (groups → review → select apply) | ✅ |
| Launch from issues, shipped audit, mapping assist | ✅ |

**9A complete** — [029_phase_9a_post_map_workflow_assist.md](./029_phase_9a_post_map_workflow_assist.md)

| Task | Status |
|------|--------|
| `v_inventory_post_mapping_workflow_candidates` view | ✅ |
| Post-map checklist modal (single + batch mapping) | ✅ |
| `buildLineItemsOrdersUrl` + Line Items deep-link open | ✅ |
| Shipped audit filter by order line | ✅ |

**9B complete** — [030_phase_9b_post_map_action_queue.md](./030_phase_9b_post_map_action_queue.md)

| Task | Status |
|------|--------|
| `inventory_post_map_action_queue` table | ✅ |
| `upsert_post_map_queue_from_checklist` RPC | ✅ |
| Post-Map Queue modal + issues panel entry | ✅ |
| Checklist → queue upsert | ✅ |
| Line Items `line_id` focus highlight | ✅ |

**9C complete** — [031_phase_9c_queue_resolution_assist.md](./031_phase_9c_queue_resolution_assist.md)

| Task | Status |
|------|--------|
| `v_inventory_post_map_queue_with_resolution` view | ✅ |
| `update_post_map_queue_items_bulk` RPC | ✅ |
| Work Queue screen (counts, filters, bulk status) | ✅ |
| Resolution banners + evidence drilldown | ✅ |
| Post-action mark-done suggestion (confirm only) | ✅ |

**Next:** Phase 10B — live virtual bundle deduction.

### Phase 9 — eBay relist assist

**Scope:** Planning + manual assist only — no full automation.

| Task | Notes |
|------|-------|
| Detect ended listings at qty 0 | From link-check / listing status |
| Restock + relist guidance in issue panel | Link to eBay Listings admin |
| Optional relist draft flow | Future |

### Phase 10 — Bundle / component rules

**10H complete** — [039_phase_10h_partial_refund_return_guidance.md](./039_phase_10h_partial_refund_return_guidance.md)

| Task | Status |
|------|--------|
| Model A vs B design + recommendation | ✅ |
| `inventory_bundle_rules` table (config only) | ✅ |
| Preview views (like, availability, summary) | ✅ |
| Bundle preview panel + modal | ✅ |
| Preview-only issue groups | ✅ |
| Product/variant picker + rule CRUD UI | ✅ |
| Config audit `inventory_bundle_rule_actions` | ✅ |
| Virtual bundle mode flags (`preview_only` default) | ✅ |
| `simulate_virtual_bundle_order` read-only RPC | ✅ |
| `inventory_bundle_shadow_events` + admin save | ✅ |
| `v_inventory_bundle_cutover_readiness` view | ✅ |
| Simulate Sale UI in Bundle Preview modal | ✅ |
| Global/per-bundle shadow mode controls | ✅ |
| Stripe checkout `reservation_shadow` hook | ✅ |
| Shippo `finalize_shadow` hook | ✅ |
| Recent shadow events admin UI | ✅ |
| Independent stock acknowledgement | ✅ |
| Live readiness checklist + evaluation RPC | ✅ |
| Live request staging (`live_requested`) | ✅ |
| `is_bundle_live_deduction_enabled` real guard | ✅ |
| Live enablement UI + audit | ✅ |
| Component reservation on paid checkout | ✅ |
| Component finalization + ledger | ✅ |
| Virtual availability in `v_kk_variant_available_stock` | ✅ |
| Live bundle issue groups | ✅ |
| Return candidates view + admin restock RPC | ✅ |
| Bundle Preview returns/restock UI | ✅ |
| Component restock audit + over-restock protection | ✅ |
| Refund context + restock guidance view | ✅ |
| Order deep links + post-restock sync checklist | ✅ |
| Line Items line focus + return panel polish (10I) | ✅ |
| RMA / return workflow table + RPCs (10J) | ✅ |
| Stripe refund detail cache + admin refresh (10K) | ✅ |
| Refund guidance issue groups + panel refresh (10K) | ✅ |
| Stripe webhook refund detail enrichment (10L) | ✅ |
| Multi-channel refund observability view + guidance (10M) | ✅ |
| Marketplace refund observation persistence + backfill (10N) | ✅ |
| eBay finance REFUND/CREDIT/REVERSAL sync hardening (10N) | ✅ |
| Amazon canceled order retention + line mapping (10O) | ✅ |
| Post-sync observation refresh + webhook cancel/refund (10P) | ✅ |
| Admin-confirmed marketplace restock assist (10Q) | ✅ |
| Batch restock assist queue + audit trail (10R) | ✅ |
| Restock assist audit viewer + queue analytics (10S) | ✅ |
| Channel restock follow-up checklist (10T) | ✅ |
| Unified returns/restock dashboard (10U) | ✅ |
| Dashboard deep links / presets / export (10V) | ✅ |
| Scheduled returns/restock digest (10W) | ✅ |
| Server-side paginated worklist (10X) | ✅ |
| Final stabilization / feature freeze (10Y) | ✅ |

**Next:** Future / Deferred only — see [056_phase_10y_final_stabilization.md](./056_phase_10y_final_stabilization.md).

---

## 13. Risks and unknowns

| Risk | Impact | Mitigation |
|------|--------|------------|
| **`stock_ledger` DDL unknown in repo** | Fresh env / migration drift | Dump prod DDL before Phase 3 migration |
| **Stripe webhook already deducts at payment** | Phase 6 conflicts with reserve/finalize model | Migration plan: transition webhook to reserve-only; backfill reservations |
| **eBay/Amazon sales never deducted KK stock** | Enabling deduction may double-count if channel also reduces | Audit current channel qty behavior; idempotency keys |
| **Products admin silent stock edits** | Ledger incomplete | Phase 4 RPC; eventually remove direct stock write from `upsertVariants` |
| **Variant_id missing on historical order lines** | Cannot reserve/deduct accurately | Issue + manual mapping; backfill job |
| **FBA Amazon qty** | Cannot push FBM logic to FBA | Exclude FBA rows from sync; show in UI as FBA-managed |
| **eBay ended listings** | Restock doesn't auto-relist | Phase 9 manual assist; document operator workflow |
| **Multi-variant eBay group listings** | Qty mapping ambiguous | Start with single-variant listings; flag groups |
| **`inventory_summary` view undefined** | Products page may break on fresh DB | Recreate view in baseline migration |
| **Line Items Orders lacks admin guard** | Security gap adjacent to fulfillment finalize | Fix separately before Phase 6 hooks |

### Open questions (resolve in Phase 3 prep)

1. Does live `stock_ledger` have `created_at`? Indexes?
2. Does KK storefront read stock from `product_variants` at checkout only, or cached elsewhere?
3. Is eBay live qty cached locally anywhere, or only on API read?
4. Should Inventory table row = variant or product? **Recommendation:** variant row, product grouped in UI later.
5. When stripe-webhook can't find variant — should it create `unmapped_order_line` issue? **Recommendation:** yes, Phase 6.

---

## 14. Edge cases

| Case | Handling |
|------|----------|
| Order line unmapped | Create issue; **no stock deduction** |
| Partial refund | Release proportional reservation or manual adjustment policy (define in Phase 6) |
| Parcel receive twice | Existing idempotency on `inventory_received_at` — preserve |
| Parcel approved but not received | Show in issues; stock unchanged |
| Negative stock after manual adjust | Allow; flag `negative_stock` issue |
| Amazon FBA listing | Show FBA qty read-only; sync button skips |
| eBay listing ended | Issue `ebay_listing_ended`; qty push may fail — surface error |
| Bundle SKU (Brass D Ring x3) | Treat as normal variant until Phase 10 |
| Variant deactivated with stock > 0 | Exclude from available sync; show in table with flag |
| Concurrent admin adjust + order reserve | Row-level lock on variant in RPCs (`FOR UPDATE`) |
| Webhook stock failure (non-fatal today) | Order succeeds, stock unchanged — must become issue |

---

## 15. Verification plan

### Phase 3 (read wiring)

| Test | Method |
|------|--------|
| Page loads admin-only | Unauthenticated redirect |
| KPI numbers match SQL | Compare `v_inventory_kpis` to manual query |
| Table rows match variants | Spot-check 5 SKUs vs Products admin |
| Ledger shows recent entries | Compare to raw `stock_ledger` |
| Issues match view | Inject known negative stock variant in staging |
| No console errors | Playwright smoke |
| Mobile layout | Playwright 390px viewport |

### Phase 4 (manual adjust)

| Test | Method |
|------|--------|
| Adjust +5 creates ledger row | SQL assert |
| Idempotent retry | Same key doesn't double-apply |
| Products admin edit policy | Document whether still allowed |

### Phase 5 (parcel)

| Test | Method |
|------|--------|
| Receive import → ledger + stock | Existing `verify-parcel-phase11-receive-inventory.mjs` |
| Inventory page shows parcel_receive rows | UI assert |

### Phase 6 (orders)

| Test | Method |
|------|--------|
| KK paid → reserved | Stripe test checkout |
| Ship → finalized | Fulfillment action |
| Cancel → released | Refund before ship |
| Unmapped → issue only | Order with bad SKU |

### Phase 7 (sync)

| Test | Method |
|------|--------|
| Sync pushes same qty to eBay + Amazon | Staging listings |
| Mismatch flags after intentional drift | |

---

## 16. Recommended next implementation phase

**Phase 6D Execute complete** — see [013_phase_6d_kk_reserve_only_cutover.md](./013_phase_6d_kk_reserve_only_cutover.md).

**Phase 6E complete** — see [014_phase_6e_fulfillment_finalize.md](./014_phase_6e_fulfillment_finalize.md).

**Phase 10E complete** — see [036_phase_10e_virtual_bundle_live_readiness.md](./036_phase_10e_virtual_bundle_live_readiness.md).

**Next:** Phase 10F — live virtual bundle deduction when readiness and shadow evidence are satisfied.

---

## 17. Related documents

| Doc | Purpose |
|-----|---------|
| [ux/roadmap.md](../ux/roadmap.md) | UX phases + completion tracking |
| [ux/001_static_ux_shell_complete.md](../ux/001_static_ux_shell_complete.md) | Phase 1 closeout |
| [implementation/roadmap.md](./roadmap.md) | Implementation phase index |
| [002_phase_3a_readonly_kpis_ledger.md](./002_phase_3a_readonly_kpis_ledger.md) | Phase 3A KPI + ledger closeout |
| [003_phase_3b_workspace_issues.md](./003_phase_3b_workspace_issues.md) | Phase 3B workspace + issues closeout |
| [004_phase_3c_channel_alerts.md](./004_phase_3c_channel_alerts.md) | Phase 3C channel + alerts closeout |
| [parcelImport/implementation/003_existing_schema_inspection.md](../../parcelImport/implementation/003_existing_schema_inspection.md) | Stock SOT audit (parcel context) |
| [parcelImport/implementation/016_phase_11_inventory_receiving_plan.md](../../parcelImport/implementation/016_phase_11_inventory_receiving_plan.md) | Parcel receive RPC spec |
| [parcelImport/implementation/017_phase_11_receive_inventory.md](../../parcelImport/implementation/017_phase_11_receive_inventory.md) | Parcel receive complete |
| [056_phase_10y_final_stabilization_pool_safety.md](./056_phase_10y_final_stabilization_pool_safety.md) | **Production pool safety** — 10AA/10AB, no browser snapshot RPC |
| [057_supabase_pool_exhaustion_runbook.md](./057_supabase_pool_exhaustion_runbook.md) | Incident runbook + recovery |

---

## 18. Production pool safety (Phase 10Y-Pool)

**Problem:** Live heavy `v_inventory_issues` scans (10Z pattern) + browser snapshot refresh exhausted Supabase Postgres pool connections.

**Required migrations (apply 10AA + 10AB; never 10Z):**

- `20261020_inventory_phase10aa_issues_snapshot.sql` — `v_inventory_issues_core` + `inventory_issue_snapshots` + pg_cron
- `20261021_inventory_phase10ab_missing_sku_product_code.sql` — product.code as SKU fallback

**Client rules:**

- Page load: stagger issues after core panels; 45s timeout with mock fallback
- After Map Assist/finalize: reload **issues + post-map queue only** — no workspace hammer, no snapshot RPC
- Extended issue counts may lag up to 15 minutes (cron)

**Verify:** `node scripts/verify-inventory-phase10y-final-stabilization.mjs`

---

## 19. Change log

| Date | Notes |
|------|-------|
| 2026-06-12 | Phase 10Y-Pool — pool exhaustion stabilization doc + verification (see §18) |
| 2026-06-09 | Phase 2 audit + wiring plan created |
