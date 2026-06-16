# Phase 7E — eBay Ended-Listing Relist Assist (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 7D (eBay quantity cache + sync readiness)  
**Next:** Phase 7F — eBay quantity sync push

---

## Summary

Added a **conservative, assist-only** workflow for ended eBay listings in Inventory → Sync Channels. Admins can see relist candidates classified by readiness, open eBay Seller Hub or KK eBay Listings admin, mark items for review, and log actions locally. **No automatic relist, no eBay quantity push, no stock/reservation mutations** from Inventory.

---

## eBay relist / create audit

| Area | Finding |
|------|---------|
| Admin UI | `pages/admin/ebay-listings.html` + `js/admin/ebayListings/*` (not `pages/admin/ebay.html`) |
| Edge function | `ebay-manage-listing` — actions: `create_item`, `create_offer`, `publish`, `publish_group`, `withdraw`, `reconcile_listing`, `clear_stale_listing_link` |
| Native relist API | **None** — no dedicated `relist` action in edge function |
| Ended representation | Local `products.ebay_status = ended`; sync view `ebay_sync_action = ended_needs_relist` when status is ended/out_of_stock/withdrawn/inactive |
| After qty-0 auto-end | eBay Inventory API typically requires **create-new + publish** flow; old listing ID remains for audit |
| Existing draft path | Push modal (`js/admin/ebayListings/pushModal.js`): `create_item` → `ebay_status=draft` (no publish until explicit Publish step on eBay Listings page) |
| Safest 7E flow | **Manual assist:** Inventory identifies candidates → admin opens eBay Sell Similar / KK Listings → draft + publish only from eBay Listings admin with confirmation |

### Recommended operator flow (ready_to_relist)

1. Inventory → **Sync Channels** → review **eBay Ended-Listing Relist Assist** table.
2. **eBay Admin** — opens eBay Sell Similar (when old listing ID known) or Seller Hub ended list.
3. **KK Listings** — opens `ebay-listings.html?relist={product_code}` for draft creation via existing Push modal.
4. After new listing publishes, reconcile product fields on eBay Listings admin (`ebay_listing_id`, `ebay_offer_id`, mark old listing ended if needed).
5. Optional: **Mark Review** logs intent in `ebay_relist_assist_actions`.

---

## What relist assist can and cannot do

| Can | Cannot |
|-----|--------|
| List ended listings with `relist_action` classification | Blind automatic relist |
| Show available qty and suggested relist qty | Push quantity to active eBay listings |
| Link to eBay public listing / Sell Similar | One-click live publish from Inventory |
| Link to KK eBay Listings admin for draft workflow | Change stock or reservations |
| Log assist actions (`opened_admin`, `marked_review`, `draft_created`) | Sync All Channels |
| Restrict `ready_to_relist` to available > 0, non-variation | Amazon changes |

---

## Database objects

### View: `v_inventory_ebay_relist_candidates`

**Migration:** `20260907_inventory_phase7e_ebay_relist_assist.sql`

Source: `v_inventory_channel_sync_candidates` where `ebay_sync_action = 'ended_needs_relist'`.

| Field | Purpose |
|-------|---------|
| `product_id`, `variant_id`, `product_label`, `internal_sku`, `product_code` | Identity |
| `ebay_sku`, `old_ebay_listing_id`, `old_ebay_offer_id`, `old_status` | Prior listing |
| `available_qty`, `on_hand`, `reserved`, `suggested_qty` | Stock context |
| `relist_action` | Classification (see rules below) |
| `required_fields_missing` | `text[]` — category, price, SKU gaps |
| `last_seen_status`, `last_cache_sync_at` | Cache observability |

**`relist_action` rules (priority order):**

1. `unsupported_variation` — multi-variant product with `ebay_item_group_key`
2. `no_available_stock` — `available_qty <= 0` (stay ended)
3. `needs_mapping` — offer without listing ID
4. `missing_required_listing_data` — missing category, price, or SKU
5. `ready_to_relist` — available > 0, single-SKU listing, category + price present
6. `manual_review` — fallback

### Table: `ebay_relist_assist_actions`

Audit log only — **not inventory truth**.

| Column | Purpose |
|--------|---------|
| `action_type` | `opened_admin`, `marked_review`, `draft_created`, `relist_attempted` |
| `status`, `notes`, `created_by`, `created_at` | Operator context |

RLS: authenticated SELECT + INSERT; service_role ALL.

---

## Candidate counts (linked DB, post-migration)

| `relist_action` | Count |
|-----------------|-------|
| `unsupported_variation` | 19 |
| `ready_to_relist` | 2 |
| `no_available_stock` | 1 |
| **Total** | **22** (= `ended_needs_relist` in sync view) |

Pre-7D baseline (before cache refresh): 22 `ended_needs_relist`, 40 `unsupported_variation` in full sync view (variation rows that are still active, not ended).

---

## UI behavior

**Location:** Inventory → Sync Channels modal (below eBay Sync Readiness)

**Section:** eBay Ended-Listing Relist Assist

- Summary tiles: ended total, ready, no stock, unsupported variation, missing data, manual review
- Table (up to 12 rows): product/SKU, old listing ID (link to eBay), available, action badge, assist buttons

**Buttons per row:**

| Button | Behavior |
|--------|----------|
| **eBay Admin** | Opens Sell Similar URL or public listing; logs `opened_admin` |
| **Mark Review** | Prompt for note; inserts `marked_review` |
| **KK Listings** | Shown for `ready_to_relist` / `missing_required_listing_data`; opens eBay Listings admin with `?relist={code}`; logs `draft_created` |

**Not present:** Sync eBay Qty (still disabled), one-click relist/publish, stock mutations.

---

## Files

| Path | Role |
|------|------|
| `supabase/migrations/20260907_inventory_phase7e_ebay_relist_assist.sql` | View + audit table |
| `js/admin/inventory/api/ebayRelistAssistApi.js` | Fetch candidates, log actions, URL helpers |
| `js/admin/inventory/ui/syncEbayRelistAssist.js` | Relist assist section render + wire |
| `js/admin/inventory/ui/syncDryRunModal.js` | Loads candidates on modal open |
| `scripts/verify-inventory-phase7e-ebay-relist-assist.mjs` | Verification |

---

## Limitations

- No eBay API relist call — ended listings need manual or KK Listings draft + publish flow
- Variation group ended listings (19 rows) require per-variant handling outside Inventory assist
- `?relist=` query param is a deep link hint only; eBay Listings page does not auto-open Push modal yet
- Audit log is assist tracking only; does not drive sync candidate classification
- Cache refresh still required for accurate `last_seen_status` on active listings (unchanged from 7D)

---

## Verification

```bash
node scripts/verify-inventory-phase7e-ebay-relist-assist.mjs
```

**Result:** PASS

- View + table exist
- `ready_to_relist` excludes available ≤ 0
- Relist total matches `ended_needs_relist` (22)
- No eBay edge calls from relist API/UI
- Amazon 7C path intact
- eBay cache edge read-only
- No stock/reservation mutations
- Inventory page + modal source load cleanly

---

## Live relist / publish

**None from Inventory.** Publish remains on `pages/admin/ebay-listings.html` via existing Push modal with explicit user confirmation.

---

## Recommended Phase 7F

Delivered — see [020_phase_7f_ebay_quantity_sync.md](./020_phase_7f_ebay_quantity_sync.md).

**Recommended next:** Phase 8 — Issue workflows.
