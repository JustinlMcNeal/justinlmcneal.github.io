# Phase 060 — eBay Variation Group Automation

**Status:** ✅ **Phase 060 Complete / Frozen / Production-ready** (060C.5 final freeze — 2026-06-09)  
**Date:** 2026-06-09  
**Prerequisite:** Phase 059 complete/frozen (Adjust → unified channel restock)  
**Page:** `pages/admin/inventory.html` (Adjust modal integration in 060C)  
**Structure:** 3 major phases (060A–060C) × 5 subphases each (.1–.5) = **15 subphases total**

---

## Completion definition (Phase 060)

**`060C.5` = Phase 060 is 100% complete, finalized, verified, and production-ready.**

At `060C.5` all of the following must be true:

- Active eBay **variation group** listings can sync **one child variant qty** after KK Adjust when mapping is clean.
- Ended eBay **variation group** listings can be relisted when eligible (060B).
- Adjust modal preview/toggle/orchestrator supports variation paths (060C) with all Phase 059 safety rules preserved.
- **`adjust_inventory` remains the only stock writer.**
- No stock rollback; no automatic sync without admin confirmation.
- Final verification script passes; Phase 059 remains frozen.

---

## Phase 060 structure

| Major | Name | Goal |
|-------|------|------|
| **060A** | eBay active variation child qty sync | Update **one child SKU/offer qty** on an **active** group listing — no group rebuild |
| **060B** | eBay ended variation group relist | Recreate/publish ended variation groups when eligible |
| **060C** | Adjust integration + final freeze | Wire 060A (+ optionally 060B preview hints) into Adjust flow; production verify |

Each major phase uses subphases **.1 through .5** only.

---

## Critical guardrails (all subphases — carried from Phase 059)

| Rule | Requirement |
|------|-------------|
| Stock writer | `adjust_inventory` RPC **only** |
| Channel timing | Edge calls **after** successful adjust; never inside adjust RPC |
| Admin confirmation | Sync toggle ON required — no automatic marketplace sync |
| No rollback | Marketplace failures do not undo KK stock |
| Pool safety | No browser snapshot refresh; no heavy issue/dashboard/returns reads in Adjust flow |
| Preview reads | Single-variant lightweight reads — **not** full `fetchChannelSyncPreview()` |
| Qty 0 | **Do not** push qty 0 to eBay from Adjust or variation sync |
| Live gates | Respect `EBAY_ENABLE_LIVE_QUANTITY_PATCH` (060A); `EBAY_ENABLE_LIVE_VARIATION_RELIST` (060B) |
| File size | Keep new JS/TS modules under **500 lines** where practical |
| No guessing | Ambiguous/missing child mapping → **manual** — never patch wrong offer |

---

## Progress tracker

| Subphase | Status |
|----------|--------|
| 060A.1 | ✅ Complete |
| 060A.2 | ✅ Complete |
| 060A.3 | ✅ Complete |
| 060A.4 | ✅ Complete |
| 060A.5 | ✅ Complete |
| **060A** | **✅ Complete / Frozen** |
| 060B.1 | ✅ Complete |
| 060B.2 | ✅ Complete |
| 060B.3 | ✅ Complete |
| 060B.4 | ✅ Complete |
| 060B.5 | ✅ Complete |
| **060B** | **✅ Complete / Frozen** |
| 060C.1 | ✅ Complete |
| 060C.2 | ✅ Complete |
| 060C.3 | ✅ Complete |
| 060C.4 | ✅ Complete |
| 060C.5 | ✅ Complete |
| **060C** | **✅ Complete / Frozen** |
| **Phase 060** | **✅ Complete / Frozen / Production-ready** |

---

## 060A — eBay Active Variation Child Qty Sync

**Goal:** When a variation group listing is **active** on eBay and one child color/size is out of stock on KK, admin Adjust restocks KK and (with sync toggle ON) updates **only that child's** eBay qty.

**Example:** Ribbed Knit Earflap Beanie — Black, Pink, Brown on one eBay group listing. Black KK = 0 → Adjust +1. System updates **Black child SKU qty only**; does not rebuild or relist the group.

**Explicitly not 060A:** ended group relist (060B), group rebuild, bulk multi-variant sync, qty-0 deactivation.

---

### 060A.1 — eBay variation active qty sync audit + design ✅

**Status:** Complete (2026-06-09) — audit/design only; **no runtime changes**

**Verification:** `scripts/verify-inventory-phase060a1-ebay-variation-active-audit.mjs`

---

#### Audit findings — current data model

**No per-variant eBay mapping table.** Unlike Amazon (`amazon_listing_mappings`), eBay identity is **product-scoped** on `products`:

| Field | Scope | Notes |
|-------|-------|-------|
| `ebay_item_group_key` | Parent | e.g. `KK_0064-GROUP` — inventory item group key |
| `ebay_listing_id` | Parent | One live listing ID for the whole group |
| `ebay_offer_id` | Product row | Often primary offer; **child offers not on `products`** |
| `ebay_sku` | Product row | Single-SKU legacy; groups use derived child SKUs |
| `ebay_status` | Product | `active`, `ended`, `not_listed`, etc. |

**Child SKU convention** (`js/admin/ebayListings/utils.js`, `inventoryEbayCacheUtils.ts`):

```text
{product.code}-{UPPERCASE_ALNUM_SUFFIX_MAX_6}
```

Example: `KK_0064-PURPLE`, `KK-0001-BLACK` (from `option_value`).

**Group detection:**

```text
ebay_item_group_key IS NOT NULL  AND  product_active_variant_count > 1
```

Matches `isEffectiveGroupListing()` in eBay Listings admin.

**Cache table:** `ebay_listing_inventory_cache` (`20260906_inventory_phase7d_ebay_cache.sql`)

| Column | Role |
|--------|------|
| `product_id` | Parent product UUID |
| `variant_id` | Matched `product_variants.id` when SKU resolves; nullable |
| `ebay_sku` | **Child** inventory SKU |
| `ebay_item_id` | Listing ID from offer (often parent listing) |
| `current_qty` / `available_qty` | Cached child qty |
| `raw_payload_json` | Includes **child `offerId`** (not a top-level column) |

**Upsert key:** `(product_id, ebay_sku)` — **one row per child SKU**, not per parent.

**Cache refresh for groups** (`inventoryEbayCacheUtils.ts` → `refreshProductEbayCache`):

- `GET /offer?inventory_item_group_key={groupKey}`
- For each offer: match child SKU to local variant via `variantSkuFromOption` or `variant.sku`
- Upsert per-child cache row with `variant_id` when match is unique

**Partial groups (operational risk):** KK_0064 has only PURPLE on eBay; other 5 local variants have **no cache row** → persistent `unsupported_variation`. See `docs/audit/pages/ebayListings/operations/001_variant_mapping_repair_plan.md`.

---

#### Audit findings — current exclusion points

| Layer | File | Mechanism |
|-------|------|-----------|
| SQL candidate view | `20260906_inventory_phase7d_ebay_cache.sql` | `unsupported_variation` when group + multi-variant + **no variant cache SKU** |
| Workspace display | `20261022_inventory_phase058_ebay_workspace_column_cache.sql` | `ebay_stock_source = unsupported_variation` |
| Client push filter | `js/admin/inventory/api/channelSyncPreviewApi.js` | Hard drop: `ebay_item_group_key && product_active_variant_count > 1` |
| Edge eligibility | `supabase/functions/_shared/inventoryEbaySyncUtils.ts` → `isEligibleCandidate` | Same hard drop even if view says `update_qty` |
| Adjust cache chain | `js/admin/inventory/services/adjustChannelEbayCache.js` | `SKIP_BEFORE_REFRESH` includes `unsupported_variation` |
| Adjust orchestrator | `js/admin/inventory/services/adjustChannelEbayBranch.js` | Routes `unsupported_variation` → manual `next_step` |
| Adjust preview/toggle | `js/admin/inventory/services/adjustChannelPreview.js` | Warn card; `computeSyncToggleDefault` excludes — **toggle disabled** |
| Relist (ended) | `ebayRelistCandidateLoaders.ts` | `isVariationBlocked()` — all groups manual (060B scope) |

**Important nuance:** A group child **with** a per-variant cache row can classify as `update_qty` in `v_inventory_channel_sync_candidates`, but push layers **still block** at edge/client. Black beanie with clean cache could show `update_qty` in DB but Adjust toggle stays off because preview uses `unsupported_variation` when action is that, OR if cache missing.

For **KK-0001 Black** (user case): preview shows `unsupported_variation` → sync toggle disabled → KK-only adjust.

---

#### Audit findings — existing eBay qty API path

**Edge:** `sync-ebay-inventory-quantity` (427 lines)  
**Helpers:** `inventoryEbaySyncUtils.ts` (369 lines)

Flow: `loadEbaySyncCandidates` → `isEligibleCandidate` → `candidatesToEbayPatchItems` → `processEbayQuantityPatches` → per-SKU `POST /sell/inventory/v1/bulk_update_price_quantity`.

**Payload (already per-child-SKU capable):**

```typescript
{
  sku: item.ebaySku,
  shipToLocationAvailability: { quantity: targetQty },
  offers: [{ offerId, availableQuantity: targetQty }]
}
```

**Pre-patch validation:** `validateOfferActive` — GET offer, verify SKU match, reject ended offers.

**Conclusion:** The eBay API path **already supports updating one child SKU** in a group via `bulk_update_price_quantity`. Blockers are **eligibility/mapping**, not API shape. Child **offer ID** must come from **variant cache** (`raw_payload_json.offerId`), not `products.ebay_offer_id`.

---

#### API design recommendation (060A.2–060A.3)

**Recommended: Option A — extend `sync-ebay-inventory-quantity` with shared helper split**

| Piece | Approach |
|-------|----------|
| Edge entry | Add optional `mode: "variation_child_update_qty"` (default preserves 059 single-SKU behavior) |
| New shared module | `supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts` — variation candidate load, eligibility, patch item build |
| Keep edge thin | Dispatch mode in `index.ts`; logic in shared helper (&lt;500 lines each) |
| Live gate | Reuse `EBAY_ENABLE_LIVE_QUANTITY_PATCH` |
| Dry run | Same pattern as 059 — gate off → dry_run response |

**Option B (dedicated edge `sync-ebay-variation-quantity`):** Use only if Option A would push `sync-ebay-inventory-quantity/index.ts` or `inventoryEbaySyncUtils.ts` over ~500 lines or create branching complexity. Current line counts (427 + 369) leave room for **thin mode dispatch + new helper file**.

**Do not:** rebuild item group, publish new listing, or touch sibling variants' qty in 060A.

---

#### Clean mapping requirements (eligibility)

A variation child is **eligible for automated qty sync** only when the system can **uniquely** resolve:

| Field | Source |
|-------|--------|
| `productId` | `product_variants.product_id` |
| `variantId` | `product_variants.id` |
| KK variant SKU | `product_variants.sku` or derived |
| eBay parent group key | `products.ebay_item_group_key` |
| eBay parent listing ID | `products.ebay_listing_id` (active, not ended) |
| eBay child SKU | `ebay_listing_inventory_cache.ebay_sku` matched to this variant |
| eBay child offer ID | Cache `raw_payload_json.offerId` (or dedicated column in 060A.2) |
| KK available qty | Post-adjust projected available |
| eBay child current qty | Cache `current_qty` |
| Listing status | Cache `listing_status` active (not ended/withdrawn) |

**Manual / mapping repair required when:**

| Condition | Proposed state |
|-----------|----------------|
| No `ebay_item_group_key` | Use existing 059 single-SKU path — not 060A |
| Child cache row missing | `variation_qty_cache_missing` |
| Child SKU ≠ expected from `variantSkuFromOption` | `variation_mapping_missing` |
| Multiple cache rows match one variant | `variation_mapping_ambiguous` |
| Child offer ID missing in cache | `variation_child_offer_missing` |
| Parent listing ended/inactive | `variation_parent_inactive` |
| eBay qty already matches KK available | `variation_no_change` |
| Unresolved operational cases (KK_0064 partial group) | `variation_manual` |

**No guessing.** If offer lookup returns SKU mismatch → manual.

---

#### Proposed 060A candidate states

| State | Actionable? | Meaning |
|-------|-------------|---------|
| `variation_update_qty` | ✅ Yes (060A.3+) | Clean child mapping; qty mismatch; parent active |
| `variation_qty_cache_missing` | ✅ Yes (cache refresh first) | Group active; child cache absent — run group cache refresh then re-evaluate |
| `variation_no_change` | Skip | Child eBay qty already matches KK available |
| `variation_mapping_missing` | Manual | Child SKU/variant link not provable |
| `variation_mapping_ambiguous` | Manual | Multiple offers/rows match |
| `variation_child_offer_missing` | Manual | Cache exists but no offer ID |
| `variation_parent_inactive` | Manual | Parent ended/withdrawn — defer to 060B |
| `variation_manual` | Manual | Catch-all; partial groups; eBay restrictions |

**View strategy (060A.2):** Prefer new read-only view `v_inventory_ebay_variation_sync_candidates` (single-variant `.eq('variant_id')` from Adjust) over risky changes to `v_inventory_channel_sync_candidates` used by 059 freeze scripts. Adjust preview reads new view when group detected; 059 paths unchanged.

---

#### 060A.2 — DB/view + read-only loaders ✅

**Status:** Complete (2026-06-09) — read-only infrastructure only; **no** eBay API mutations, **no** Adjust wiring.

**Verification:** `scripts/verify-inventory-phase060a2-ebay-variation-candidates.mjs`

**Migration:** `supabase/migrations/20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql`

**View:** `v_inventory_ebay_variation_sync_candidates` — one row per KK variant in an eBay variation group (`ebay_item_group_key` + `product_active_variant_count > 1`).

**Columns:** `product_id`, `variant_id`, `product_code`, `variant_sku`, `option_name`, `option_value`, `ebay_item_group_key`, `parent_ebay_listing_id`, `expected_ebay_sku`, `cache_ebay_sku`, `child_offer_id`, `child_listing_status`, `kk_available_qty`, `ebay_child_qty`, `qty_delta`, `candidate_state`, `candidate_reason`, `is_actionable`, `requires_cache_refresh`, `mapping_confidence`, `cache_last_synced_at`, `product_active_variant_count`.

**Child offer ID source:** `ebay_listing_inventory_cache.raw_payload_json->>'offerId'` (SQL JSON extraction). Populated by existing cache refresh (`inventoryEbayCacheUtils.ts` → `readSkuCache` stores `offerId` in payload).

**Expected eBay SKU derivation (SQL):** `COALESCE(variant.sku, product.code || '-' || UPPER_ALNUM_SUFFIX(option_value, max 6))` — matches `variantSkuFromOption`.

**Cache matching:** Join cache rows by `variant_id`, `expected_ebay_sku`, or `variant_sku`. `match_count > 1` → `variation_mapping_ambiguous`; `0` → `variation_qty_cache_missing`.

**Candidate states implemented in view:**

| State | `is_actionable` | Notes |
|-------|-----------------|-------|
| `variation_update_qty` | true | Parent active, unique cache, offer ID, KK avail > 0, qty differs |
| `variation_qty_cache_missing` | true | Group active, expected SKU derivable, no/stale child cache |
| `variation_no_change` | false | Qty already matches |
| `variation_mapping_missing` | false | No group/parent/expected SKU |
| `variation_mapping_ambiguous` | false | Multiple cache rows |
| `variation_child_offer_missing` | false | Cache row without offer ID |
| `variation_parent_inactive` | false | Ended/inactive parent or child listing |
| `variation_manual` | false | KK avail ≤ 0 or unclassified |

**`requires_cache_refresh`:** true when `variation_qty_cache_missing`, no `cache_last_synced_at`, or cache older than 7 days.

**`mapping_confidence`:** `high` / `medium` / `low` / `none` based on variant_id + expected SKU match quality.

**Shared loader:** `supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts`

- `loadEbayVariationChildCandidate({ supabase, productId, variantId })` — read-only view query
- `validateVariationChildCandidateForQty(candidate)` — server-side eligibility check
- No eBay API calls; no DB mutations

**Admin JS API:** `js/admin/inventory/api/ebayVariationCandidateApi.js`

- `fetchEbayVariationChildCandidate({ productId, variantId })` — authenticated read-only Supabase query
- `validateVariationChildCandidateForQty(candidate)` — client-side mirror of loader validation
- **Not wired** to Adjust preview/toggle/orchestrator yet (060C)

**Known limitations:**

- Partial groups (e.g. KK_0064) remain `variation_qty_cache_missing` or `variation_manual` until child offers exist on eBay and cache is refreshed
- View does not call eBay — stale cache until `sync-ebay-listing-inventory-cache` runs (060A.3 may chain)
- Black beanie (`unsupported_variation` in 059 view) may appear here as `variation_qty_cache_missing` or `variation_update_qty` once per-child cache exists

**Remaining:** 060A.4 — verification matrix; 060A.5 — 060A freeze.

---

#### 060A.3 — Edge variation child qty push ✅

**Status:** Complete (2026-06-09) — server-side mutation path only; **no** Adjust wiring; **no** live eBay test in verify by default.

**Verification:** `scripts/verify-inventory-phase060a3-ebay-variation-edge.mjs`

**Helper:** `supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts`

- `syncEbayVariationChildQuantity({ supabase, request, liveEnabled })`
- `EbayVariationQtySyncRequest` / `EbayVariationQtySyncResult`
- Loads candidate via `loadEbayVariationChildCandidate`
- Validates via `validateVariationChildCandidateForQty` + strict `candidate_state === variation_update_qty`
- Builds **one** `EbayQuantityPatchItem` (child SKU + child offer ID only)
- Live path reuses `processEbayQuantityPatches` with `items: [patchItem]` — no siblings, no group rebuild
- **No** `adjust_inventory`; **no** stock writes; **no** Amazon imports

**Edge:** `supabase/functions/sync-ebay-inventory-quantity/index.ts`

**Mode contract:**

```json
{
  "mode": "variation_child_update_qty",
  "productId": "<uuid>",
  "variantId": "<uuid>",
  "quantity": 1,
  "preview": true,
  "syncContext": {
    "trigger_source": "manual_adjust",
    "trigger_reference_type": "stock_ledger",
    "trigger_reference_id": "<uuid>",
    "stock_ledger_id": "<uuid>",
    "orchestration_id": "<string>"
  }
}
```

Alternate shape: `variantIds: ["<uuid>"]` (length 1) + required `productId`. Bulk `variantIds` rejected. `productId` is **not** derived — missing `productId` → 400.

Default `mode` remains `update_qty` (059 single-SKU path unchanged). Variation mode runs **before** the default `live_patch_disabled` 403 gate so gate-off returns `dry_run` instead of 403.

**Dry-run / live gate:**

| Condition | Behavior |
|-----------|----------|
| `preview: true` | Full DB validation; `status: dry_run`; no eBay PATCH |
| `EBAY_ENABLE_LIVE_QUANTITY_PATCH !== "true"` | Same as preview — `dry_run` with message: *eBay variation quantity sync was previewed only. Live eBay quantity patching is disabled.* |
| Gate on + `preview: false` | Live PATCH for **one** child offer only |

**Result statuses:** `success` | `dry_run` | `skipped` | `manual` | `failed`

| Status | When |
|--------|------|
| `dry_run` | Preview or gate off |
| `success` | Live patch succeeded |
| `skipped` | `variation_no_change`, qty ≤ 0 request, or patch layer no-op |
| `manual` | `variation_mapping_missing`, `variation_mapping_ambiguous`, `variation_child_offer_missing`, `variation_parent_inactive`, `variation_qty_cache_missing`, `variation_manual`, unsupported state |
| `failed` | DB load error, eBay token/patch error, audit logging error |

**Audit / correlation (Phase 059 preserved):**

- `inventory_channel_sync_runs` — channel `ebay`, mode `dry_run` or `push`, notes mention `variation_child_update_qty`
- `inventory_channel_sync_results` — `action: variation_child_update_qty`
- `syncContext` fields: `trigger_source`, `trigger_reference_type`, `trigger_reference_id`, `stock_ledger_id`, `orchestration_id`
- **No** new stock ledger row; **no** `adjust_inventory`

**Limitations (060A.3):**

- One variant per request only
- `variation_update_qty` candidates only (cache-missing → manual, not auto cache refresh)
- Qty must be &gt; 0 — no qty-0 deactivation
- No ended-group relist (060B)
- No Adjust preview/toggle/orchestrator wiring (060C)
- No cache row update after push (may follow in 060A.4 matrix)
- Optional API test uses `preview: true` only — no live mutation in verify

**Not implemented:** Adjust orchestrator, preview/toggle, result panel, sibling sync, group relist/publish, bulk variation sync, Amazon changes.

---

#### 060A.4 — Verification matrix ✅

**Status:** Complete (2026-06-09) — verification and hardening only; **no** Adjust wiring; **no** live eBay mutation by default.

**Verification:** `scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs`

**Matrix coverage (mocked + static):**

| Scenario | Expected |
|----------|----------|
| Clean `variation_update_qty` candidate (gate off) | `dry_run`; one child SKU/offer in payload |
| `preview: true` | `dry_run`; no live PATCH |
| Gate on + clean candidate (mocked live path) | `success`; `wouldPatch: true`; one child only |
| `variation_no_change` | `skipped` |
| `variation_qty_cache_missing` | `manual` — cache refresh required first |
| `variation_mapping_missing` | `manual` |
| `variation_mapping_ambiguous` | `manual` |
| `variation_child_offer_missing` | `manual` |
| `variation_parent_inactive` | `manual` (defer to 060B) |
| Quantity ≤ 0 | `skipped` / edge 400 |
| Bulk `variantIds` (>1) | edge 400 — one variant only |
| Missing `productId` | edge 400 — no guessing |

**Static checks:** 060A.2 view + loaders; 060A.3 helper + edge mode; `EBAY_ENABLE_LIVE_QUANTITY_PATCH`; no sibling/relist/qty-0 push; no Adjust wiring; `adjust_inventory` sole writer; no snapshot/full preview reads.

**Regressions composed (fast mode default):**

- `verify-inventory-phase060a2-ebay-variation-candidates.mjs`
- `verify-inventory-phase060a3-ebay-variation-edge.mjs`
- `verify-inventory-phase059-final.mjs --static` (`VERIFY_FAST=1`, `VERIFY_SKIP_DEEP_REGRESSION=1`)
- `verify-inventory-issue-view-safety.mjs`
- `verify-inventory-phase10y-final-stabilization.mjs`

**Optional API dry-run** (when `SUPABASE_URL` + `TEST_EBAY_VARIATION_*` set):

```bash
TEST_EBAY_VARIATION_PRODUCT_ID=<uuid> \
TEST_EBAY_VARIATION_VARIANT_ID=<uuid> \
TEST_EBAY_VARIATION_QTY=1 \
node scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs
```

Calls `sync-ebay-inventory-quantity` with `mode: variation_child_update_qty`, `preview: true`. Expects `dry_run`, `manual`, `skipped`, or `failed` — never `success`.

**Optional live test (documented only — skipped by default):**

```bash
RUN_LIVE_EBAY_VARIATION_QTY_TEST=true \
EBAY_ENABLE_LIVE_QUANTITY_PATCH=true \
TEST_EBAY_VARIATION_PRODUCT_ID=<uuid> \
TEST_EBAY_VARIATION_VARIANT_ID=<uuid> \
TEST_EBAY_VARIATION_QTY=1 \
node scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs
```

Rules: one test variant; active parent/group; clean child offer mapping; positive qty only; never update siblings. Matrix script does **not** execute live PATCH in 060A.4 even when flag is set — flag is documentation for future manual QA.

**Bugs fixed in 060A.4:** Updated 060A.2/060A.3 regression scripts — removed stale “060A.3 must not exist” checks; roadmap status column lists completed subphases; matrix uses 059 static regression (not full freeze chain) to avoid timeout.

**Safety confirmations:** No Adjust orchestrator/preview/toggle wiring; no Amazon changes; no stock writes; no live eBay mutation in default verify path; Phase 059 freeze regression passes in fast mode.

#### 060A.5 — 060A QA freeze ✅

**Status:** Complete (2026-06-09) — QA, documentation, and freeze only; **no** new runtime behavior; **no** Adjust wiring.

**Verification:** `scripts/verify-inventory-phase060a-final-freeze.mjs`

**Composed regressions (fast/static default):**

- `verify-inventory-phase060a1-ebay-variation-active-audit.mjs`
- `verify-inventory-phase060a2-ebay-variation-candidates.mjs`
- `verify-inventory-phase060a3-ebay-variation-edge.mjs`
- `verify-inventory-phase060a4-ebay-variation-active-matrix.mjs`
- `verify-inventory-phase059-final.mjs --static`
- `verify-inventory-issue-view-safety.mjs`
- `verify-inventory-phase10y-final-stabilization.mjs`

**060A final summary (foundation delivered):**

| Subphase | Deliverable |
|----------|-------------|
| 060A.1 | Audit + design — data model, candidate states, API recommendation |
| 060A.2 | View `v_inventory_ebay_variation_sync_candidates` + TS/JS read-only loaders |
| 060A.3 | Edge `variation_child_update_qty` + `inventoryEbayVariationSyncUtils.ts` |
| 060A.4 | Verification matrix (14 scenarios + fast regressions) |
| 060A.5 | Final freeze script + docs |

**Verification result:** `node scripts/verify-inventory-phase060a-final-freeze.mjs` — PASS (fast mode, no live eBay mutation).

**Optional API dry-run** (not required for freeze):

```bash
TEST_EBAY_VARIATION_PRODUCT_ID=<uuid> \
TEST_EBAY_VARIATION_VARIANT_ID=<uuid> \
TEST_EBAY_VARIATION_QTY=1 \
node scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs
```

**Optional live test** (skipped by default — not required for 060A freeze):

```bash
RUN_LIVE_EBAY_VARIATION_QTY_TEST=true \
EBAY_ENABLE_LIVE_QUANTITY_PATCH=true \
TEST_EBAY_VARIATION_PRODUCT_ID=<uuid> \
TEST_EBAY_VARIATION_VARIANT_ID=<uuid> \
TEST_EBAY_VARIATION_QTY=1 \
node scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs
```

Warnings: one test variant only; active parent/group only; clean child offer mapping; positive qty only; do not repeat; never update siblings.

**Production / deployment checklist (060A foundation):**

| Step | Item |
|------|------|
| Migration | `20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql` |
| Edge | `sync-ebay-inventory-quantity` (`mode: variation_child_update_qty`) |
| Shared TS | `inventoryEbayVariationSyncUtils.ts`, `ebayVariationChildCandidateLoaders.ts` |
| Admin JS | `ebayVariationCandidateApi.js` (read-only; not wired to Adjust) |
| Live gate | `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` for live child qty PATCH |
| Note | 060A is **foundation-only** until **060C** Adjust integration |

**Safety confirmations at freeze:**

- No Adjust orchestrator / preview / toggle / result panel wiring
- No Amazon changes
- No stock writes from variation edge path
- `adjust_inventory` remains the only stock writer
- No browser snapshot refresh; no full `fetchChannelSyncPreview()` in Adjust flow
- Phase 059 remains complete/frozen

**Remaining Phase 060 roadmap:**

- **060B** — eBay ended variation group relist automation (next: **060B.1** audit)
- **060C** — Adjust integration + final freeze (preview/toggle/orchestrator/result panel)

---

## Frozen 060A limitations (intentionally deferred)

| Item | Deferred to |
|------|-------------|
| Adjust integration for variation qty sync | 060C |
| Preview / toggle / result panel wiring | 060C |
| Cache-refresh-before-variation-sync orchestration | 060C |
| Ended variation group relist | 060B |
| Shared SKU / multi-color relist | Future / manual |
| Qty-0 marketplace deactivation | Future / out of scope |
| Bulk variation sync | Future / out of scope |
| Automatic sync without admin confirmation | Out of scope |
| Stock rollback | Out of scope |

---

### 060B — eBay Ended Variation Group Relist

**Goal:** When an eBay **variation group** listing has ended/inactivated and KK stock is restored for one or more children, safely relist/republish the **whole group** (child inventory items + group shell + child offers + group publish) — not single-SKU recreate.

**Example:** Ribbed Knit Earflap Beanie — Black, Pink, Brown on one ended group listing. All variations went to 0; eBay ended the group. Admin Adjust +1 Black. If group metadata and child mappings are clean, system relists the group with Black qty &gt; 0 and siblings at 0 only when eBay requires them and mapping is provably safe.

**Explicitly not 060B:** active child qty-only sync (060A), partial guess relist of one color under wrong SKU, qty-0 marketplace deactivation, Adjust wiring (060C until B is frozen).

---

#### 060B.1 — eBay ended variation group relist audit + design ✅

**Status:** Complete (2026-06-09) — audit/design only; **no** runtime changes; **no** live eBay calls.

**Verification:** `scripts/verify-inventory-phase060b1-ebay-variation-relist-audit.mjs`

---

##### Audit findings — single-SKU relist path (059D)

**Files:** `relist-ebay-from-product/index.ts`, `ebayRelistFromProduct.ts`, `ebayRelistCandidateLoaders.ts`, `ebayListingPublishUtils.ts`, `v_inventory_ebay_relist_candidates`, `adjustChannelEbayBranch.js` (`runEbayEndedRelist`).

**Flow (single SKU only):**

1. Adjust orchestrator calls `relistEbayFromProduct` when `ebay_sync_action === ended_needs_relist` and `relist_action === ready_to_relist`.
2. Edge validates admin auth, positive quantity, **`EBAY_ENABLE_LIVE_RELIST`** gate (`dryRun` when gate off or `preview: true`).
3. `loadRelistCandidate` from `v_inventory_ebay_relist_candidates` + `validateCandidate`.
4. `loadProductForRelist` + `validateMetadata` (SKU, category, price, title, ≥1 image).
5. Live path: `createEbayInventoryItem` → `createEbayOffer` → `publishEbayOffer` (single inventory item).
6. Reconcile `products`: `ebay_sku`, `ebay_offer_id`, `ebay_listing_id`, `ebay_status: active`. Warn if old listing ID ≠ new (does **not** reactivate old listing).
7. Audit: `inventory_channel_sync_runs` + `action: relist_from_product`.

**Why this does not support variation groups:**

| Layer | Block |
|-------|-------|
| SQL view | `relist_action = unsupported_variation` when `ebay_item_group_key` + `product_active_variant_count > 1`; `ready_to_relist` excludes groups |
| `isVariationBlocked()` | Returns true for `unsupported_variation` or group + multi-variant |
| `validateCandidate()` | Returns `manual` / `unsupported_variation` |
| `ebayListingPublishUtils.ts` | No `create_item_group`, `create_group_offer`, `publish_by_inventory_item_group` |
| Adjust preview/toggle | `unsupported_variation` → manual card; sync toggle disabled |
| Adjust branch | Post-cache `unsupported_variation` → manual `next_step`, not relist |

**Reuse for 060B:** candidate validation pattern, audit/correlation (`syncContext`), dry_run gate pattern, metadata validation concepts — **not** the single-item publish chain itself.

---

##### Audit findings — variation group publish requirements

**Reference implementation:** `ebay-manage-listing` + `js/admin/ebayListings/pushModal.js`.

**Group publish chain (admin push modal today):**

1. **Per-child inventory items** — `create_item` (PUT `/inventory_item/{childSku}`) for each checked variant with variant aspects (e.g. Color), images, qty.
2. **Group shell** — `create_item_group` / `update_item_group` (PUT `/inventory_item_group/{groupKey}`) with shared title, description, imageUrls, aspects (Color stripped from parent), `variantSKUs`, `variesBy` (e.g. Color specifications).
3. **Child offers** — `create_group_offer` loops `variantSKUs`, POST `/offer` per child SKU (shared category/price/policies).
4. **Group publish** — `publish_group` → GET offers by group key; validate ≥2 offers; sync price/qty/aspects per child; POST `/offer/publish_by_inventory_item_group`; update base `products.ebay_listing_id`, `ebay_item_group_key`, primary `ebay_offer_id`.

**Design answers (060B.1):**

| Question | Answer |
|----------|--------|
| Recreate all child items/offers? | **Yes** for ended groups — cannot assume old offers are publishable; mirror push-modal recreate chain |
| Republish existing group offer? | **Unlikely safe** when listing ended; treat as full recreate + new publish |
| Every child variant or only in-stock? | **Include all KK group variants** in structure; set qty &gt; 0 only where `kk_available_qty > 0`; qty 0 for siblings only when eBay/API requires full variant matrix and SKU mapping is clean |
| One child relist while siblings 0? | **Not as partial single-child relist** — group publish requires coherent group; 060A handles active single-child qty |
| Minimum child set | All KK variants in group with derivable child SKUs; eBay `publish_group` requires ≥2 offers historically — validate at edge |
| Variation aspects | `variesBy` + per-child Color (or option) aspects from `product_variants.option_value` |
| Missing for automation | Group title/description/aspects/variesBy not fully persisted in DB; policies from env/cache; partial groups (KK_0064) lack all children on eBay |

**Data sources:**

| Field | Primary source | Fallback |
|-------|----------------|----------|
| Group key | `products.ebay_item_group_key` | `{product.code}-GROUP` convention |
| Child SKU | `product_variants.sku` | `variantSkuFromOption(code, option_value)` |
| Category/policies | `products.ebay_category_id` + env policy IDs | Push-modal policy cache pattern |
| Images | `products` gallery + `product_variants.preview_image_url` | Cache `raw_payload_json` (read-only hint) |
| Aspects | Product metadata + variant Color | Cache / prior push payload — **manual if conflict** |
| Old listing/offer IDs | `products` + `ebay_listing_inventory_cache` | For audit only; do not reactivate old IDs |

---

##### Data/mapping requirements

**Parent/group (all required for automation):**

`productId`, product code, `ebay_item_group_key`, ended `ebay_listing_id` (audit), title, category, condition, description, fulfillment/return/payment policies, shipping/package weight, shared images, variation option name (Color/Size), `product_active_variant_count > 1`.

**Per child:**

`variantId`, variant SKU, expected eBay child SKU, `option_value`, `kk_available_qty`, old child offer ID (cache), old child inventory SKU, previous eBay child qty, child listing status, `in_stock_now` flag, `include_in_relist_payload` flag.

**Manual triggers (no guessing):**

| Condition | Result |
|-----------|--------|
| Missing `ebay_item_group_key` | Manual — not a variation group relist |
| Missing category/aspects/policies/images | `variation_group_missing_*` |
| Ambiguous option names/values | `variation_group_mapping_ambiguous` |
| Child SKU not derivable | `variation_group_mapping_missing` |
| Multiple cache rows per variant | `variation_group_mapping_ambiguous` |
| Cache/raw payload conflicts with KK | `variation_group_child_offer_conflict` or manual |
| No child with KK avail &gt; 0 | `variation_group_no_in_stock_children` |
| Partial group / unsupported structure | `variation_group_unsupported_structure` |

---

##### Safe relist model (recommended)

1. **Validate whole group** — all KK variants, group metadata, policies, aspects before any eBay write.
2. **Include all group variants** in payload structure; qty &gt; 0 only where KK available &gt; 0.
3. **Preserve child SKUs** when they match expected derivation and cache; never remap color to wrong SKU.
4. **Preserve group key** when safe; new key only if documented conflict (rare; manual default).
5. **Full chain:** child items → group shell → child offers → `publish_by_inventory_item_group`.
6. **Reconcile** parent `products` + schedule group cache refresh for all children.
7. **Any ambiguity → manual** — no partial publish.

**Do not:** publish one child offer under wrong variation spec; skip required siblings when eBay requires full matrix without proof; reactivate old listing ID as success.

---

##### Proposed 060B candidate states

| State | Actionable? | Meaning |
|-------|-------------|---------|
| `variation_group_ready_to_relist` | ✅ Yes (060B.3+) | Ended/inactive parent; metadata complete; clean child mapping; ≥1 child KK avail &gt; 0 |
| `variation_group_relist_dry_run_ready` | ✅ Preview | Same as ready; live gate off |
| `variation_group_active` | Skip | Active parent — use 060A |
| `variation_group_no_change` | Skip | Nothing to relist |
| `variation_group_missing_metadata` | Manual | Title/category/policies/description incomplete |
| `variation_group_missing_aspects` | Manual | Required aspects/variesBy missing |
| `variation_group_missing_images` | Manual | No valid shared/variant images |
| `variation_group_mapping_missing` | Manual | Child SKU/variant link not provable |
| `variation_group_mapping_ambiguous` | Manual | Multiple rows/offers match |
| `variation_group_child_offer_conflict` | Manual | Cache vs KK conflict |
| `variation_group_no_in_stock_children` | Manual/Skip | All KK avail ≤ 0 |
| `variation_group_unsupported_structure` | Manual | Partial group, API constraints |
| `variation_group_manual` | Manual | Catch-all |

**View strategy (060B.2):** New read-only `v_inventory_ebay_variation_relist_candidates` — product/group scoped with sibling rows or aggregated flags; do **not** alter `v_inventory_ebay_relist_candidates` (059 frozen).

---

##### Live gate recommendation

**Use dedicated gate:** `EBAY_ENABLE_LIVE_VARIATION_RELIST=true`

**Do not reuse** `EBAY_ENABLE_LIVE_RELIST` for variation group relist — group publish is higher risk (multi-SKU, multi-offer, aspect matrix).

| Condition | Behavior |
|-----------|----------|
| Gate off or `preview: true` | Full validation; `dry_run`; no eBay publish |
| Gate on + clean candidate | Live recreate + group publish allowed |

---

##### 060B.2 — Read-only candidate infrastructure ✅

**Status:** Complete (2026-06-09) — read-only infrastructure only; **no** eBay API mutations; **no** Adjust wiring.

**Verification:** `scripts/verify-inventory-phase060b2-ebay-variation-relist-candidates.mjs`

**Migration:** `supabase/migrations/20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql`

**View:** `v_inventory_ebay_variation_relist_candidates` — one row per KK parent product in an eBay variation group (`ebay_item_group_key` + `variant_count > 1`).

**Key columns:** parent/group metadata flags (`has_images`, `has_category`, `has_policy_data`, `has_required_aspects`, `has_variation_options`), child summary arrays (`child_skus`, `in_stock_child_skus`, `missing_child_skus`, `conflict_child_skus`), counts (`mapped_child_count`, `ambiguous_child_count`, `missing_child_count`, `in_stock_child_count`), `child_payload_json`, `candidate_state`, `candidate_reason`, `is_actionable`, `requires_manual_review`, `mapping_confidence`.

**Candidate states in view:**

| State | Meaning |
|-------|---------|
| `variation_group_active` | Parent active — skip (060A path) |
| `variation_group_missing_metadata` | Title/description/category/options/policy unknown |
| `variation_group_missing_aspects` | Required aspects not persisted in DB |
| `variation_group_missing_images` | No product/variant images |
| `variation_group_mapping_missing` | Child SKU/cache mapping incomplete |
| `variation_group_mapping_ambiguous` | Multiple cache rows per child |
| `variation_group_child_offer_conflict` | Cache SKU conflicts with expected |
| `variation_group_no_in_stock_children` | All KK available ≤ 0 |
| `variation_group_unsupported_structure` | Not a multi-variant group |
| `variation_group_ready_to_relist` | Structural checks pass (rare until aspects/policies persisted) |
| `variation_group_manual` | Catch-all |

**Reserved (edge/docs, not SQL-emitted today):** `variation_group_relist_dry_run_ready`, `variation_group_no_change`.

**Child payload JSON (`child_payload_json`):**

```json
[
  {
    "variantId": "uuid",
    "sku": "KK-0001-BLK",
    "optionValue": "Black",
    "availableQty": 1,
    "includeInRelist": true,
    "previousOfferId": "optional",
    "previousEbayQty": 0,
    "mappingState": "clean"
  }
]
```

All KK variants included; `includeInRelist = true` when `availableQty > 0`; siblings never dropped from structure.

**Metadata / aspects / policy gap handling (conservative):**

| Field | View behavior |
|-------|----------------|
| `has_policy_data` | Always `false` — policies come from edge env (`EBAY_FULFILLMENT/RETURN/PAYMENT_POLICY_ID`); forces manual until 060B.3 validates |
| `has_required_aspects` | Always `false` — full eBay aspect matrix not on `products`; forces `variation_group_missing_aspects` until persisted or cache-derived |
| `condition_id` | `NULL` — not stored on products today |

**Loader:** `supabase/functions/_shared/ebayVariationGroupRelistCandidateLoaders.ts`

- `loadEbayVariationGroupRelistCandidate({ supabase, productId })`
- `validateVariationGroupRelistCandidate(candidate)` — read-only eligibility
- `EBAY_VARIATION_RELIST_METADATA_GAPS` — documented unknown fields

**Admin JS API:** `js/admin/inventory/api/ebayVariationRelistCandidateApi.js`

- `fetchEbayVariationRelistCandidate({ productId })` — authenticated read-only query
- `validateVariationGroupRelistCandidate(candidate)` — client mirror
- **Not wired** to Adjust preview/toggle/orchestrator (060C)

**Known limitations:**

- Most ended groups classify as manual until aspects/policies can be sourced (060B.3 may read cache/push history)
- View does not call eBay — stale cache until refresh
- `variation_group_ready_to_relist` requires `has_required_aspects` + `has_policy_data` true — unlikely from SQL alone today
- Partial groups (KK_0064) → `variation_group_mapping_missing` or `variation_group_unsupported_structure`

---

##### 060B.3 — Edge variation group relist ✅

**Status:** Complete (2026-06-09) — server-side relist edge + helpers; **no** Adjust wiring; **no** live eBay calls by default.

**Verification:** `scripts/verify-inventory-phase060b3-ebay-variation-relist-edge.mjs`

**Edge:** `supabase/functions/relist-ebay-variation-group/index.ts`

**Request contract (POST, admin-only):**

```json
{
  "productId": "<uuid>",
  "triggeringVariantId": "<uuid optional>",
  "preview": false,
  "syncContext": {
    "trigger_source": "manual_adjust",
    "trigger_reference_type": "stock_ledger",
    "trigger_reference_id": "<uuid>",
    "stock_ledger_id": "<uuid>",
    "orchestration_id": "<string>"
  }
}
```

**Response:** `status` (`success` | `dry_run` | `manual` | `skipped` | `failed`), `mode: "variation_group_relist"`, `productId`, optional `listingId`, `groupKey`, `offerIds`, `childResults`, `runId`, `message`, `errors`, `warnings`, `syncContext`.

**Helpers (split by responsibility):**

| File | Role |
|------|------|
| `ebayVariationGroupRelistUtils.ts` | Orchestration, sync run logging, reconciliation |
| `ebayVariationGroupRelistValidation.ts` | Structural validation, metadata resolution, plan build |
| `ebayVariationGroupRelistPublish.ts` | Live publish chain (items → group → offers → publish) |

**Metadata resolution (edge-time, priority order):**

1. KK `products` (title, description, category, images, group key, variation option name)
2. Candidate view + `child_payload_json` (SKUs, qty, mapping state)
3. Env business policies (`EBAY_FULFILLMENT/RETURN/PAYMENT_POLICY_ID`)
4. Push-modal default aspects (`normalizeProductAspects`) — with warning
5. Optional read-only `GET /inventory_item/{sku}` for aspects when live token available

Missing policies → `manual`. Missing title/category/images/group key → `manual`.

**Dry-run / live gate:**

| Condition | Behavior |
|-----------|----------|
| `preview: true` | `dry_run` — no eBay writes |
| `EBAY_ENABLE_LIVE_VARIATION_RELIST` ≠ `true` | `dry_run` |
| Gate on + `preview: false` + full validation | Live publish allowed |

**Does not reuse** `EBAY_ENABLE_LIVE_RELIST` as sole gate.

**Publish chain (live only):**

1. `PUT /inventory_item/{childSku}` — all KK variants (qty from KK available)
2. `PUT /inventory_item_group/{groupKey}`
3. `POST /offer` per child SKU (`create_group_offer` pattern)
4. `POST /offer/publish_by_inventory_item_group`

**Reconciliation (live success):**

- Update parent `products`: new `ebay_listing_id`, `ebay_item_group_key`, `ebay_status: active`, category, price, primary `ebay_offer_id`
- Old ended `ebay_listing_id` is **not** reactivated — warning if new ID differs
- Reconcile failure → `failed` with warning that eBay may have published

**Sync run logging:** `inventory_channel_sync_runs` + `inventory_channel_sync_results` with `action: variation_group_relist` and full `syncContext` correlation. No `adjust_inventory` call.

**Known limitations:**

- eBay `publish_group` may require all variant offer qty > 0 — OOS siblings with qty 0 may fail publish (returns `failed` with clear message)
- Aspects use push-modal defaults when cache/GET unavailable
- `condition_id` defaults to `NEW` when not stored
- No per-variant `products` row updates (child offers not on schema)
- Adjust preview/toggle/orchestrator not wired (060C)

**Optional API test:** `TEST_EBAY_VARIATION_RELIST_PRODUCT_ID` + `preview: true`

**Optional live test (documented only, skipped by default):**

```bash
RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true \
EBAY_ENABLE_LIVE_VARIATION_RELIST=true \
TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \
node scripts/verify-inventory-phase060b3-ebay-variation-relist-edge.mjs
```

##### 060B.4 — Verification matrix ✅

**Status:** Complete (2026-06-09) — verification and hardening only; **no** Adjust wiring; **no** live eBay calls by default.

**Verification:** `scripts/verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs`

**Matrix coverage (mocked + static):**

| Scenario | Expected | eBay write |
|----------|----------|------------|
| Clean ended group + policies + gate off / preview | `dry_run` | No |
| Mocked live success (all steps) | `success` | Yes (mock) |
| Missing env policy IDs | `manual` | No |
| Missing images / category | `manual` | No |
| Mapping missing / ambiguous / conflict | `manual` | No |
| No in-stock children | `skipped` | No |
| Group already active | `skipped` (060A path) | No |
| Condition unknown | `dry_run` with `condition_default_new` warning | No |
| Qty-0 siblings in group | `dry_run` includes all SKUs; warning that publish may fail | No |
| Mocked publish failure (offer step) | `failed` with step | Partial possible |
| Mocked qty-0 publish rejection | `failed` clear reason | No false success |
| Reconciliation failure after publish | `failed` + partial-publish warning | eBay may have published |

**Qty-0 sibling behavior:**

- All KK variants remain in `child_payload_json` and dry-run plan (`planned_out_of_stock` for qty 0).
- Edge adds warning: *"Group includes N qty-0 sibling variant(s); eBay publish may reject zero-quantity offers."*
- eBay `publish_by_inventory_item_group` may require all variant offer qty > 0 — live publish can fail; response is `failed` with clear message (not false success).

**Optional API dry-run:** `TEST_EBAY_VARIATION_RELIST_PRODUCT_ID` + `preview: true` — skipped when env vars missing.

**Optional live test (documented only, skipped by default):**

```bash
RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true \
EBAY_ENABLE_LIVE_VARIATION_RELIST=true \
TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \
node scripts/verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs
```

**Bugs fixed in 060B.4:** Added qty-0 sibling publish warning in `ebayVariationGroupRelistUtils.ts`.

**Safety confirmations:** No Adjust wiring; no Amazon changes; `adjust_inventory` sole stock writer; no snapshot refresh; fast-mode regressions (90s timeout per script).

**Remaining:** 060B.5 — QA freeze.

---

##### 060B.5 — 060B QA freeze ✅

**Status:** Complete (2026-06-09) — QA, documentation, and freeze only; **no** new runtime behavior; **no** Adjust wiring.

**Verification:** `scripts/verify-inventory-phase060b-final-freeze.mjs`

**060B final summary (foundation delivered):**

| Subphase | Deliverable |
|----------|-------------|
| 060B.1 | Audit + design — group relist chain, candidate states, dedicated live gate |
| 060B.2 | View `v_inventory_ebay_variation_relist_candidates` + TS/JS read-only loaders |
| 060B.3 | Edge `relist-ebay-variation-group` + split publish helpers |
| 060B.4 | Verification matrix (15 scenarios + fast regressions) |
| 060B.5 | Final freeze script + docs |

**Verification result:** `node scripts/verify-inventory-phase060b-final-freeze.mjs` — PASS (fast mode, no live eBay mutation).

**Optional API dry-run** (not required for freeze):

```bash
TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \
node scripts/verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs
```

**Optional live test** (skipped by default — not required for 060B freeze):

```bash
RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true \
EBAY_ENABLE_LIVE_VARIATION_RELIST=true \
TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \
node scripts/verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs
```

Warnings: test product only; clean group mapping; at least one in-stock child; **check qty-0 sibling risk first**; do not repeat; creates a real eBay variation listing.

**Production / deployment checklist (060B foundation):**

| Step | Item |
|------|------|
| Migration | `20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql` |
| Edge | `relist-ebay-variation-group` |
| Shared TS | `ebayVariationGroupRelistUtils.ts`, `ebayVariationGroupRelistValidation.ts`, `ebayVariationGroupRelistPublish.ts`, `ebayVariationGroupRelistCandidateLoaders.ts` |
| Admin JS | `ebayVariationRelistCandidateApi.js` (read-only; not wired to Adjust) |
| Policy env | `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID` |
| Live gate | `EBAY_ENABLE_LIVE_VARIATION_RELIST=true` for live ended group relist |
| Note | 060B is **foundation-only** until **060C** Adjust integration |

**Safety confirmations at freeze:**

- No Adjust orchestrator / preview / toggle / result panel wiring
- No Amazon changes
- No stock writes from relist edge path
- `adjust_inventory` remains the only stock writer
- No browser snapshot refresh; no full `fetchChannelSyncPreview()` in Adjust flow
- Phase 059 and 060A remain complete/frozen

**Remaining Phase 060 roadmap:**

- **060C.1** — Adjust integration plan (preview/toggle/orchestrator/result panel for 060A + 060B)
- **060C.2–060C.5** — Wire, verify, final Phase 060 freeze

---

## Frozen 060B limitations (intentionally deferred)

| Item | Deferred to |
|------|-------------|
| Adjust integration for ended variation group relist | 060C |
| Preview / toggle / result panel wiring | 060C |
| Routing from Adjust after successful stock adjustment | 060C |
| Active variation qty Adjust integration | 060C (060A foundation) |
| Qty-0 sibling live publish uncertainty | Warning/dry_run or clear `failed` — eBay may reject qty-0 child offers |
| Shared SKU / multi-color relist edge cases | Future / manual |
| Qty-0 marketplace deactivation | Future / out of scope |
| Bulk variation relist | Future / out of scope |
| Automatic sync without admin confirmation | Out of scope |
| Stock rollback | Out of scope |

---

##### 060B risks (audit)

| Risk | Mitigation |
|------|------------|
| Wrong child color on wrong SKU | Full group validation; no guess; manual on ambiguity |
| Partial group (KK_0064) | `variation_group_unsupported_structure` until repair |
| Stale cache aspects vs KK | Manual on conflict |
| `publish_group` requires ≥2 offers | Validate sibling count before publish |
| Old listing ID treated as success | Reconcile new IDs only; warn on mismatch |
| 059D single-SKU regression | New edge/view; leave `relist-ebay-from-product` frozen |
| God files | Split `ebayVariationGroupRelistUtils.ts`; extract publish helpers |

---

##### 060B out of scope (060B.1)

- Adjust preview/toggle/orchestrator (060C)
- Active child qty sync (060A)
- Qty-0 deactivation push
- Bulk multi-product relist
- Automatic sync without admin toggle
- Stock rollback
- Amazon changes
- Live eBay calls in 060B.1 verify
- Shared SKU / KK-0039 multi-color edge cases unless later audited

---


### 060C — Adjust Integration + Final Freeze

**Goal:** Wire 060A (active variation child qty) and 060B (ended variation group relist) into Adjust preview/toggle/orchestrator/result panel.

**Subphases:** C.1 plan ✅ · C.2 preview/toggle · C.3 orchestrator · C.4 verify · C.5 freeze

**Rules:** After adjust; sync toggle ON; projected available &gt; 0; clean mapping; no qty-0 push; no stock rollback; no `fetchChannelSyncPreview()` in Adjust flow.

---

#### 060C.1 — Adjust integration audit + wiring plan ✅

**Status:** Complete (2026-06-09) — audit/design only; **no** runtime Adjust wiring; **no** marketplace calls.

**Verification:** `scripts/verify-inventory-phase060c1-adjust-integration-audit.mjs`

---

##### Audit findings — current Adjust preview integration

**Files inspected:**

| File | Role today |
|------|------------|
| `adjustModalChannelPreview.js` | Loads preview on modal open; preserves `syncToggleUserSet` |
| `adjustChannelPreview.js` | Maps KK/Amazon/eBay cards; `computeSyncToggleDefault` |
| `renderAdjustChannelPreview.js` | Renders cards + toggle hint |
| `channelSyncCandidateApi.js` | **Single-variant** read: `v_inventory_channel_sync_candidates` + optional `v_inventory_ebay_relist_candidates` |
| `ebayVariationCandidateApi.js` | Read-only 060A view — **not called from Adjust** |
| `ebayVariationRelistCandidateApi.js` | Read-only 060B view — **not called from Adjust** |

**Current preview data flow:**

1. `loadAdjustChannelPreview` → `fetchChannelSyncCandidateForVariant(variantId)` only.
2. If `ebay_sync_action === ended_needs_relist`, also loads single-SKU relist row from `v_inventory_ebay_relist_candidates`.
3. `buildAdjustChannelPreviewState` maps `ebay_sync_action` via `mapEbayPreviewStatus` (059 paths only).
4. **Does not** call `fetchChannelSyncPreview()` (full-table read — confined to `syncDryRunModal.js`).
5. **Does not** refresh browser issue snapshot.

**Where variation is blocked today:**

| Layer | Behavior |
|-------|----------|
| `v_inventory_channel_sync_candidates` | `ebay_sync_action = unsupported_variation` when group + multi-variant + missing child cache |
| `mapEbayPreviewStatus` | `unsupported_variation` → manual card; `ended_needs_relist` + `relist_action === unsupported_variation` → manual |
| `computeSyncToggleDefault` | Toggle ON only for `update_qty`, `qty_cache_missing`, or safe single-SKU `ended_needs_relist` — **excludes** `unsupported_variation` |
| `adjustChannelEbayBranch.resolveEbayBranch` | No branch for variation — falls through to `resolveEbayChannelStep` → manual `unsupported_variation` |

**Toggle override:** `syncToggleUserSet` in `adjustModalChannelPreview.js` — when user toggles manually, default is not reapplied until modal reset. If toggle becomes disabled (`!toggleEnabled`), forced OFF.

**Loading/failure:** Spinner → cards or `renderAdjustChannelPreviewError`; toggle disabled until successful load.

**060C.2 preview design (read-only):**

- After existing `fetchChannelSyncCandidateForVariant`, add **parallel optional** reads (same modal scope only):
  - `fetchEbayVariationChildCandidate({ productId, variantId })` when `ebay_item_group_key` or `unsupported_variation` or parent active group signals.
  - `fetchEbayVariationRelistCandidate({ productId })` when `ended_needs_relist` or ended parent status.
- Extend `buildAdjustChannelPreviewState` with variation-aware eBay card resolver:
  - **Priority:** single-SKU `update_qty` / `qty_cache_missing` / safe single-SKU relist **before** variation paths (avoid double intent).
  - If channel says `unsupported_variation` but 060A candidate is `variation_update_qty` with clean mapping → show 060A card (override stale channel action).
  - If ended + 060B candidate actionable → show group relist card; suppress single-SKU relist card when `relist_action === unsupported_variation`.
- **No** `fetchChannelSyncPreview()`; **no** snapshot refresh; max 3 narrow queries per variant.

---

##### Audit findings — current eBay orchestrator branch

**Files:** `adjustChannelOrchestrator.js`, `adjustChannelEbayBranch.js`, `adjustSyncContext.js`, `adjustChannelEbayCache.js`, `ebayRelistFromProductApi.js`.

**Current `resolveEbayBranch` order (059 only):**

1. `update_qty` → `pushEbayInventoryQuantity` (bulk edge, single variant)
2. `qty_cache_missing` → cache refresh chain → re-read candidate → may chain to (1) or (3) or manual
3. `ended_needs_relist` → `relistEbayFromProduct` (059D single-SKU; **blocks variation groups** at edge)
4. Else → `resolveEbayChannelStep` (`unsupported_variation`, `missing_mapping`, etc.)

**`adjustSyncContext`:** Builds `trigger_source`, `stock_ledger_id`, `orchestration_id` — pass through to all new edge calls unchanged.

**Proposed 060C.3 eBay branch order (final):**

| Step | Condition | Action |
|------|-----------|--------|
| 1 | `ebay_sync_action === update_qty` (single-SKU) | Existing `runEbayUpdateQty` |
| 2 | `qty_cache_missing` (single-SKU) | Existing cache chain (may chain to 1 or 3) |
| 3 | `ended_needs_relist` + single-SKU relist ready (not `unsupported_variation`) | Existing `runEbayEndedRelist` |
| 4 | 060A candidate `variation_update_qty` + clean child + offer + active parent | `syncEbayVariationChildQuantity` → `variation_child_update_qty` |
| 5 | 060A `variation_qty_cache_missing` | Variation-scoped cache refresh → re-read 060A candidate → step 4 if ready (060C.3) |
| 6 | 060B group relist candidate actionable + ended group + in-stock children | `relistEbayVariationGroup` → `relist-ebay-variation-group` |
| 7 | Manual / fallback | `resolveEbayChannelStep` or skipped |

**Double-call guards:**

- Never run step 1 and 4 in same adjust (single-SKU `update_qty` wins).
- Never run step 3 and 6 (single-SKU relist vs group relist — detect via `relist_action`, `ebay_item_group_key`, 060B candidate).
- Load 060A/060B candidates once post-adjust; reuse for branch decision.

---

##### 060A Adjust behavior (spec for 060C.3)

**Run only when:**

- Adjust succeeded (`adjust_inventory` already committed)
- Sync toggle ON
- Projected/post-adjust `available_qty > 0`
- 060A candidate `variation_update_qty`
- `productId` + `variantId` present
- Child SKU clean; child offer ID present
- Parent/group active (`variation_parent_inactive` excluded)
- No ambiguous/manual 060A state

**Edge call:**

```json
{
  "mode": "variation_child_update_qty",
  "productId": "<uuid>",
  "variantId": "<uuid>",
  "quantity": 1,
  "preview": false,
  "syncContext": { "trigger_source": "manual_adjust", "stock_ledger_id": "...", "orchestration_id": "..." }
}
```

**Do not:** patch siblings; push qty 0; relist group; retry ambiguous mappings; run when candidate is manual.

**Live gate:** `EBAY_ENABLE_LIVE_QUANTITY_PATCH` (edge default dry_run when off).

---

##### 060B Adjust behavior (spec for 060C.3)

**Run only when:**

- Adjust succeeded; sync toggle ON
- At least one group child with KK available &gt; 0 (post-adjust)
- 060B candidate indicates ended/inactive group (not `variation_group_active`)
- Edge validation can resolve metadata (policies from env; aspects at edge)
- `productId` present
- Actionable states: `variation_group_ready_to_relist` or `variation_group_relist_dry_run_ready` (live gate controls dry_run)

**Edge call:**

```json
{
  "productId": "<uuid>",
  "triggeringVariantId": "<uuid>",
  "preview": false,
  "syncContext": { ... }
}
```

**Do not:** relist active group; relist on ambiguous mapping; bypass `EBAY_ENABLE_LIVE_VARIATION_RELIST`; run without toggle; reactivate old listing ID.

---

##### Preview / toggle state design (060C.2)

**Active variation (060A):**

| Candidate state | Preview label | Toggle default |
|-----------------|---------------|----------------|
| `variation_update_qty` | eBay variation quantity can update. | ON if projected available &gt; 0 |
| `variation_qty_cache_missing` | eBay variation cache will refresh before sync. | ON if projected available &gt; 0 (060C.3 wires refresh) |
| `variation_no_change` | eBay variation already matches. | OFF |
| Manual states (`variation_mapping_*`, `variation_child_offer_missing`, `variation_parent_inactive`, `variation_manual`) | eBay variation requires manual mapping review. | OFF |

**Ended variation group (060B):**

| Candidate state | Preview label | Toggle default |
|-----------------|---------------|----------------|
| `variation_group_ready_to_relist` | eBay variation group can be relisted. | ON if projected available &gt; 0 |
| `variation_group_relist_dry_run_ready` | eBay variation group relist can be previewed. | ON only when policies env present |
| Manual states | eBay variation group relist requires manual review. | OFF |
| `variation_group_no_in_stock_children` | (muted) No in-stock children for relist. | OFF |
| `variation_group_active` | Route to 060A active qty card, not relist. | Per 060A rules |

**Preserve:** `syncToggleUserSet` — admin manual toggle choice sticks until modal reset.

---

##### Result panel state design (060C.3)

**Active variation qty (new copy — add to `adjustOrchestratorSummary.js` in 060C.3):**

| Status | Message |
|--------|---------|
| success | eBay variation quantity updated. |
| dry_run | eBay variation quantity sync was previewed only. Live eBay quantity patching is disabled. |
| manual | eBay variation requires manual mapping review. |
| skipped | eBay variation quantity sync skipped. |
| failed | eBay variation quantity sync failed. KK stock remains adjusted. |

**Ended variation group relist:**

| Status | Message |
|--------|---------|
| success | eBay variation group relisted successfully. |
| dry_run | eBay variation group relist was previewed only. Live variation relist is disabled. |
| manual | eBay variation group relist requires manual review. |
| skipped | eBay variation group relist skipped. |
| failed | eBay variation group relist failed. KK stock remains adjusted. |

**Keep:** Phase 059 partial-success banner; no KK rollback on channel failure.

---

##### API wrapper plan (implement in 060C.2–060C.3)

**New:** `js/admin/inventory/api/ebayVariationQtySyncApi.js`

```js
export async function syncEbayVariationChildQuantity({
  productId, variantId, quantity, preview = false, syncContext = null,
} = {}) {}
```

→ `sync-ebay-inventory-quantity` with `mode: variation_child_update_qty`.

**New:** `js/admin/inventory/api/ebayVariationGroupRelistApi.js`

```js
export async function relistEbayVariationGroup({
  productId, triggeringVariantId = null, preview = false, syncContext = null,
} = {}) {}
```

→ `relist-ebay-variation-group`.

**Reuse:** `pushEbayInventoryQuantity`, `relistEbayFromProduct` unchanged for single-SKU paths.

---

##### 060C.2 scope — preview/toggle read-only ✅

**Status:** Complete (2026-06-09) — read-only preview/toggle only; **no** orchestrator, **no** edge calls, **no** Adjust submit wiring.

**Verification:** `scripts/verify-inventory-phase060c2-adjust-preview-toggle.mjs`

**Files changed:**

| File | Change |
|------|--------|
| `adjustModalChannelPreview.js` | Loads channel bundle, then optional 060A/060B candidate reads (parallel, product/variant scoped) |
| `adjustChannelVariationPreview.js` | **New** — priority resolver, labels, toggle contribution, card detail |
| `adjustChannelPreview.js` | Delegates eBay card + toggle to variation resolver |

**Preview read flow:**

1. `fetchChannelSyncCandidateForVariant(variantId)` (existing)
2. If `shouldFetchVariationChildCandidate` → `fetchEbayVariationChildCandidate({ productId, variantId })`
3. If `shouldFetchVariationRelistCandidate` → `fetchEbayVariationRelistCandidate({ productId })`
4. Max 3 narrow reads; no `fetchChannelSyncPreview()`; no snapshot refresh

**Candidate priority (`resolveEbayPreviewPath`):**

1. Single-SKU actionable (`update_qty`, `qty_cache_missing`, safe `ended_needs_relist`)
2. Ended variation group relist (060B) when group not `variation_group_active`
3. Active variation child (060A)
4. Channel fallback (`mapEbayPreviewStatus`) — `unsupported_variation` replaced when clean 060A/060B row exists

**Toggle defaults (`computeSyncToggleDefault`):**

- ON when projected available &gt; 0 and safe path: single-SKU Amazon/eBay, `variation_update_qty`, `variation_qty_cache_missing`, `variation_group_ready_to_relist`, `variation_group_relist_dry_run_ready`
- OFF for manual states, `variation_no_change`, `variation_group_no_in_stock_children`, projected available ≤ 0
- `syncToggleUserSet` preserved — admin manual choice until modal reset

**Browser smoke:** Adjust modal opens, preview loads, sync toggle present, no console errors (no Adjust submit).

**Safety:** No marketplace mutations; orchestrator/result panel unchanged; Amazon unchanged; `adjust_inventory` sole writer.

**Remaining:** 060C.3 orchestrator + result panel + API wrappers.

---

##### 060C.3 scope — orchestrator + result panel ✅

**Status:** Complete (2026-06-09) — post-adjust orchestrator wiring; live gates on edges; no stock rollback.

**Verification:** `scripts/verify-inventory-phase060c3-adjust-variation-orchestrator.mjs`

**Files:**

| File | Role |
|------|------|
| `ebayVariationQtySyncApi.js` | `syncEbayVariationChildQuantity` → `sync-ebay-inventory-quantity` `mode: variation_child_update_qty` |
| `ebayVariationGroupRelistApi.js` | `relistEbayVariationGroup` → `relist-ebay-variation-group` |
| `adjustChannelEbayVariationBranch.js` | `runEbayVariationQtySync`, `runEbayVariationGroupRelist`, `resolveEbayVariationBranch` |
| `adjustChannelEbayBranch.js` | Extended `resolveEbayBranch` order; skips single-SKU relist when `unsupported_variation` |
| `adjustChannelOrchestrator.js` | Passes `relist` bundle + `projectedAvailable` to eBay branch |
| `adjustOrchestratorSummary.js` | Variation qty + group relist result copy |
| `renderAdjustResultPanel.js` | Variation action links + group/offer detail |
| `adjustChannelNextSteps.js` | `resolveEbayVariationManualStep` |

**eBay branch order (post-adjust, sync ON):**

1. Single-SKU `update_qty`
2. Single-SKU `qty_cache_missing` cache chain
3. Single-SKU `ended_needs_relist` (not `unsupported_variation` relist row)
4. 060B ended variation group relist (`variation_group_ready_to_relist` / `variation_group_relist_dry_run_ready`)
5. 060A active variation qty (`variation_update_qty` only)
6. `variation_qty_cache_missing` → manual next-step (cache refresh deferred)
7. Manual/skipped fallback

**Guards:** availableQty &gt; 0; no double-call qty+relist; no siblings; syncContext passed; gates off → dry_run from edges.

**Browser smoke:** API modules load in Adjust modal; mock edge routes registered; no live calls by default.

**Remaining:** 060C.4 full integration verification matrix.

---

##### 060C.4 scope — full integration verification matrix ✅

**Status:** Complete (2026-06-09) — verification/hardening only; no new marketplace behavior.

**Verification:** `scripts/verify-inventory-phase060c4-adjust-integration-matrix.mjs`

**Matrix coverage (18 scenarios):**

| # | Area | Result |
|---|------|--------|
| 1–6 | Phase 059 baseline (KK-only, Amazon, single-SKU eBay) | Simulated path + static guards |
| 7–10 | 060A active variation preview + orchestration | Preview labels/toggles + wrapper simulation |
| 11–13 | 060B ended group relist | Preview + group relist path + qty-0 warning passthrough |
| 14–18 | Safety (toggle OFF, qty≤0, failure copy, double-call, priority) | Simulated + result panel |

**Result panel:** All variation qty + group relist statuses rendered (success, dry_run, manual, skipped, failed); KK/Amazon/eBay card order; partial-success banner; no-rollback note.

**Optional API/live:** Skipped by default; env vars documented; live requires explicit flags + gates.

**Bugs fixed:** None — matrix passed without integration changes.

**Remaining:** None — Phase 060 frozen at 060C.5.

---

##### 060C.5 scope — Phase 060 final freeze ✅

**Status:** Complete (2026-06-09) — final QA, docs, deployment checklist, and freeze verification only. No new marketplace behavior.

**Verification:** `scripts/verify-inventory-phase060-final-freeze.mjs`

**Final verification result:** PASS (fast/static regression; composed 060C.1–060C.4 + 060A/060B freezes + Phase 059 static + issue-view safety + 10Y stabilization). No live marketplace calls.

| Script | Role |
|--------|------|
| `verify-inventory-phase060c4-adjust-integration-matrix.mjs` | 18-scenario Adjust integration matrix |
| `verify-inventory-phase060c3-adjust-variation-orchestrator.mjs` | Post-adjust orchestrator + result panel |
| `verify-inventory-phase060c2-adjust-preview-toggle.mjs` | Read-only preview/toggle |
| `verify-inventory-phase060c1-adjust-integration-audit.mjs` | Audit doc frozen (runtime superseded by 060C.2+) |
| `verify-inventory-phase060b-final-freeze.mjs` | 060B foundation frozen |
| `verify-inventory-phase060a-final-freeze.mjs` | 060A foundation frozen |
| `verify-inventory-phase059-final.mjs --static` | Phase 059 static regression |
| `verify-inventory-issue-view-safety.mjs` | Pool-safe issue reads |
| `verify-inventory-phase10y-final-stabilization.mjs` | Returns/restock freeze guard |

**Final Phase 060 behavior delivered:**

| Major | Delivered |
|-------|-----------|
| **060A** | Active eBay variation child qty candidate view; active child validation; `variation_child_update_qty` one-child-only patch; no sibling update; no group relist from active qty path; dry_run/live gate via `EBAY_ENABLE_LIVE_QUANTITY_PATCH` |
| **060B** | Ended variation group relist candidate view; full group validation; `relist-ebay-variation-group` edge; dedicated `EBAY_ENABLE_LIVE_VARIATION_RELIST` gate; qty-0 sibling warning/failure clarity; no old ended listing reactivation |
| **060C** | Adjust preview/toggle integration; post-adjust orchestration; result panel support; partial-success/no-rollback clarity; full integration verification matrix |

**Safety confirmations at final freeze:**

- `adjust_inventory` remains the **only** stock writer
- No stock rollback
- No qty-0 eBay push
- No automatic sync without admin sync toggle
- No browser snapshot refresh; no full `fetchChannelSyncPreview()` in Adjust flow
- No heavy issue/dashboard/returns reads in Adjust flow
- No Amazon behavior changed by Phase 060
- Live gates documented and unchanged: `EBAY_ENABLE_LIVE_QUANTITY_PATCH`, `EBAY_ENABLE_LIVE_VARIATION_RELIST`; Phase 059 gates preserved: `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_RELIST`
- Phase 059 remains complete/frozen

**Optional dry-run tests (not run by freeze script):**

```bash
TEST_EBAY_VARIATION_PRODUCT_ID=<uuid> \
TEST_EBAY_VARIATION_VARIANT_ID=<uuid> \
TEST_EBAY_VARIATION_QTY=1 \
node scripts/verify-inventory-phase060c4-adjust-integration-matrix.mjs
```

```bash
TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \
node scripts/verify-inventory-phase060c4-adjust-integration-matrix.mjs
```

**Optional live tests (skipped by default — not required for freeze):**

```bash
RUN_LIVE_EBAY_VARIATION_QTY_TEST=true \
EBAY_ENABLE_LIVE_QUANTITY_PATCH=true \
TEST_EBAY_VARIATION_PRODUCT_ID=<uuid> \
TEST_EBAY_VARIATION_VARIANT_ID=<uuid> \
TEST_EBAY_VARIATION_QTY=1 \
node scripts/verify-inventory-phase060c4-adjust-integration-matrix.mjs
```

```bash
RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true \
EBAY_ENABLE_LIVE_VARIATION_RELIST=true \
TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \
node scripts/verify-inventory-phase060c4-adjust-integration-matrix.mjs
```

Warnings: use test products only; one variant/group only; do not repeat; live relist can create a real eBay variation listing; live qty patch changes real eBay quantity.

---

##### 060C risks

| Risk | Mitigation |
|------|------------|
| Channel view `unsupported_variation` hides actionable 060A child | Preview/orchestrator prefer 060A view when child cache clean |
| Single-SKU + variation both eligible | Strict branch priority; single-SKU first |
| Group relist + single-SKU relist both eligible | `unsupported_variation` on relist row blocks 059D; 060B only when group candidate ready |
| Qty-0 siblings on group relist | Warning in edge; failed result with clear message |
| Preview query sprawl | Max 3 narrow reads; no full preview |
| God files | Split `adjustChannelVariationPreview.js` / branch helpers if &gt;500 lines |

---

##### 060C out of scope (060C.1)

- Runtime preview/toggle changes (060C.2)
- Orchestrator/result panel wiring (060C.3)
- New DB migrations (unless discovered in later subphase)
- Amazon changes
- Stock rollback
- Automatic sync without toggle
- Live eBay calls in verify scripts by default

---

## Production deployment checklist (Phase 060)

Apply in order after Phase 059 is live. No new migrations beyond 060A/060B foundation.

| Step | Item |
|------|------|
| **Migrations** | `20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql` |
| | `20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql` |
| **Edge functions** | `sync-ebay-inventory-quantity` (`mode: variation_child_update_qty`) |
| | `relist-ebay-variation-group` |
| **Shared helpers** | `ebayVariationChildCandidateLoaders.ts`, `inventoryEbayVariationSyncUtils.ts` |
| | `ebayVariationGroupRelistCandidateLoaders.ts`, `ebayVariationGroupRelistUtils.ts` |
| | `ebayVariationGroupRelistValidation.ts`, `ebayVariationGroupRelistPublish.ts` |
| **Admin JS** | `ebayVariationCandidateApi.js`, `ebayVariationRelistCandidateApi.js` |
| | `ebayVariationQtySyncApi.js`, `ebayVariationGroupRelistApi.js` |
| | `adjustChannelVariationPreview.js`, `adjustChannelEbayVariationBranch.js` |
| | Updated preview/orchestrator/result panel (`adjustModalChannelPreview.js`, `adjustChannelOrchestrator.js`, `renderAdjustResultPanel.js`, etc.) |
| **Env / live gates** | `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` — active variation child qty live patch (060A) |
| | `EBAY_ENABLE_LIVE_VARIATION_RELIST=true` — ended variation group live relist (060B) |
| | Phase 059 gates unchanged: `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_RELIST` |
| **eBay policy env** | `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID` (group relist) |
| **Post-deploy smoke** | Inventory page loads; Adjust modal opens; active variation preview; ended variation group preview |
| | Sync toggle default ON/OFF states; active variation dry_run; group relist dry_run |
| | Manual mapping state; partial failure result panel |
| | `node scripts/verify-inventory-phase10y-final-stabilization.mjs` |
| **Final freeze verify** | `node scripts/verify-inventory-phase060-final-freeze.mjs` |

---

## Frozen Phase 060 limitations

Intentionally out of scope — do not implement without a new phase:

| Limitation | Notes |
|------------|-------|
| Qty-0 marketplace deactivation | No push of qty 0 to eBay from Adjust or variation sync |
| Bulk variation sync | One child or one group per confirmed Adjust only |
| Shared SKU / multi-color edge cases | Manual unless mapping is clean |
| Automatic sync without admin confirmation | Sync toggle must be ON; no background marketplace sync |
| Stock rollback | Marketplace failures do not undo KK stock |
| Live marketplace testing | Requires explicit flags (`RUN_LIVE_EBAY_VARIATION_QTY_TEST`, `RUN_LIVE_EBAY_VARIATION_RELIST_TEST`) + gates |
| Qty-0 sibling group relist | May fail if eBay rejects zero-quantity variation offers; system warns and fails clearly |
| Browser snapshot refresh | Forbidden in Adjust flow |
| Full `fetchChannelSyncPreview()` | Forbidden in Adjust flow — narrow candidate reads only |
| Amazon changes | Phase 060 did not modify Amazon inactive restock behavior |
| Sibling variation updates | Only validated active child qty path; no bulk sibling patch |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Partial group on eBay (KK_0064) | Manual repair; `variation_manual` — no patch |
| Wrong child offer patched | Require offer ID + SKU match validation; no guess |
| `products.ebay_offer_id` is parent not child | Use cache child offer only |
| eBay account restrictions | Surface manual; do not retry blindly |
| View change breaks 059 | New view; leave `v_inventory_channel_sync_candidates` frozen |
| God files | Split `inventoryEbayVariationSyncUtils.ts`; keep edge thin |

---

## Out of scope (Phase 060 and beyond)

- Shared SKU / multi-color relist (KK-0039 style)
- Qty-0 marketplace deactivation
- Bulk multi-variant Adjust sync in one confirmation
- Automatic sync without admin toggle
- Stock rollback
- 10T checklist in Adjust flow
- Amazon changes
- Live testing without explicit flags

---

## Related docs

| Doc | Relevance |
|-----|-----------|
| [059_adjust_stock_unified_channel_restock_plan.md](./059_adjust_stock_unified_channel_restock_plan.md) | Phase 059 frozen baseline |
| [018_phase_7d_ebay_quantity_cache_readiness.md](./018_phase_7d_ebay_quantity_cache_readiness.md) | Cache table + view |
| [020_phase_7f_ebay_quantity_sync.md](./020_phase_7f_ebay_quantity_sync.md) | Single-SKU qty push |
| [001_variant_mapping_repair_plan.md](../../../audit/pages/ebayListings/operations/001_variant_mapping_repair_plan.md) | KK_0064/KK_0065 repair |

---

## Changelog

| Date | Subphase | Change |
|------|----------|--------|
| 2026-06-09 | 060C.5 | Phase 060 final freeze — `verify-inventory-phase060-final-freeze.mjs`; deployment checklist; frozen limitations; production-ready |
| 2026-06-09 | 060C.4 | Full Adjust integration verification matrix (18 scenarios + regressions) |
| 2026-06-09 | 060C.3 | Post-adjust orchestrator + result panel for variation qty + group relist |
| 2026-06-09 | 060C.2 | Read-only Adjust preview/toggle for 060A+060B variation candidates; no orchestrator/edges |
| 2026-06-09 | 060C.1 | Adjust integration audit + wiring plan; no runtime wiring |
| 2026-06-09 | 060B.4 | Verification matrix + qty-0 sibling warning; fast regressions |
| 2026-06-09 | 060B.3 | Edge `relist-ebay-variation-group` + split publish helpers; dedicated live gate; no Adjust wiring |
| 2026-06-09 | 060B.2 | View `v_inventory_ebay_variation_relist_candidates` + TS/JS read-only loaders; conservative metadata gaps |
| 2026-06-09 | 060B.1 | Ended variation group relist audit + design; dedicated `EBAY_ENABLE_LIVE_VARIATION_RELIST` gate; no runtime |
| 2026-06-09 | 060A.5 | Final freeze `verify-inventory-phase060a-final-freeze.mjs`; 060A marked complete/frozen |
| 2026-06-09 | 060A.4 | Verification matrix script + scenario coverage + fast regressions; no Adjust/live mutation |
| 2026-06-09 | 060A.3 | Edge `variation_child_update_qty` mode + `inventoryEbayVariationSyncUtils.ts`; dry_run when gate off; no Adjust/Amazon |
| 2026-06-09 | 060A.2 | Read-only view `v_inventory_ebay_variation_sync_candidates` + TS/JS loaders + verify script; no push/Adjust wiring |
| 2026-06-09 | 060A.1 | Audit + design — data model, exclusion points, API recommendation, candidate states |
