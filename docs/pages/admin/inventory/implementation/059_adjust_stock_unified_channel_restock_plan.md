# Phase 059 — Adjust Stock → Unified Channel Restock

**Status:** ✅ Phase 059 Complete / Frozen / Production-ready (2026-06-09)  
**Date:** 2026-06-09  
**Prerequisite:** Phase 4 (manual adjust), Phase 7C–7F (channel sync), Phase 7E (eBay relist assist), Phase 10T (restock follow-up), storefront zero-stock backorder  
**Page:** `pages/admin/inventory.html`  
**Structure:** 5 major phases (059A–059E) × 5 subphases each (.1–.5) = **25 subphases total**

---

## Completion definition (Phase 059)

**`059E.5` = Phase 059 is 100% complete, finalized, verified, and production-ready.**

At `059E.5` all of the following must be true:

- From **Inventory → Adjust**, admin can restock a variant with a unified, safe marketplace flow.
- **KK** stock updates only through existing `adjust_inventory`.
- **Amazon** can update/reactivate when eligible (active `update_qty` in 059A; inactive restore in 059B).
- **eBay active** listings can refresh cache and push qty when eligible (059A shell + 059C polish).
- **eBay ended single-SKU** listings can be recreated/published when eligible (059D).
- All results appear in **one unified result panel** with next-step links.
- All channel actions are **audited** with correlation to adjust ledger.
- **No** stock changes outside `adjust_inventory`.
- **No** channel API calls inside the adjust DB transaction.
- Final verification script passes: `scripts/verify-inventory-phase059-final.mjs`
- Pool-safety guardrails hold (no browser snapshot refresh, no heavy issue-view joins in this flow).
- Roadmap marks **059 complete**; deferred items live only in [Deferred outside Phase 059](#deferred-outside-phase-059).

---

## Primary feature goal

From **Inventory → Adjust**, an admin restocks a variant (e.g. `0 → 1`) and gets a unified marketplace restock flow:

| Channel | Target behavior |
|---------|-----------------|
| **KK** | `adjust_inventory` updates on-hand; storefront reflects available qty |
| **Amazon** | Active FBM qty push; inactive offer restore + qty (059B) |
| **eBay active** | Cache refresh when needed → qty push |
| **eBay ended (single-SKU)** | Recreate inventory item → offer → publish from stored product metadata (059D) |

Today: **Adjust = KK only** + manual **Sync Channels**. Phase 059 closes that gap in strict subphases.

---

## Critical guardrails (all subphases)

| Rule | Requirement |
|------|-------------|
| Stock writer | `adjust_inventory` RPC **only** |
| Channel timing | Channel edge calls **after** successful adjust; **never** inside adjust RPC transaction |
| Concurrency | Sequential operations; **one variant** per orchestration |
| Pool safety | No heavy issue snapshot refresh from browser; no dashboard/returns/heavy issue view joins in adjust flow |
| Preview reads | Single-variant lightweight query on `v_inventory_channel_sync_candidates` (`.eq('variant_id')`) — **not** full-table `fetchChannelSyncPreview()` |
| Live gates | Respect `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_QUANTITY_PATCH` |
| eBay variation groups | **Not** automated in Phase 059 v1 |
| eBay qty 0 | **Do not** push qty 0 to active eBay listings in this feature |
| File size | Keep new JS modules under **500 lines** where practical |
| Down-adjust / deactivation | **Not** in core 059 goal — see [Deferred](#deferred-outside-phase-059) unless explicitly handled in 059E.2 polish |

---

## JavaScript structure guardrails (all subphases)

Phase 059 code must follow project organization rules:

| Rule | Requirement |
|------|-------------|
| File size | Keep JS files **under 500 lines** where practical |
| Responsibility split | Separate UI rendering, API calls, formatters, state helpers, and event handlers |
| Feature folders | Create focused files/folders by page section or feature area when it improves clarity |
| No god files | Do not grow large monolithic modules — split before adding more logic |
| Thin entry points | Keep `index.js` and modal entry controllers thin; delegate to services |
| Split threshold | If a file approaches 500 lines, split **before** adding more logic |

**059 module layout (growing):**

```
js/admin/inventory/
├── api/channelSyncCandidateApi.js      # single-variant reads (059A.2)
├── services/adjustChannelPreview.js    # status mappers + toggle default (059A.2)
├── renderers/renderAdjustChannelPreview.js
├── ui/adjustModalChannelPreview.js     # preview controller (059A.2)
├── ui/adjustModal.js                   # thin modal shell
└── services/adjustChannelOrchestrator.js  # 059A.3 orchestrator
    adjustChannelNextSteps.js               # next-step labels/URLs
    adjustOrchestratorSummary.js            # toast summary (059A.3)
```

---

## Scope

### In scope (Phase 059)

- Adjust modal channel preview + sync toggle
- Post-adjust orchestrator shell chaining existing safe APIs
- Unified result panel + audit correlation
- Amazon inactive FBM restore + qty (059B)
- eBay active cache refresh + qty polish (059C)
- eBay ended single-SKU auto-relist (059D)
- End-to-end integration, failure clarity, operator UX, production verification (059E)
- Verification scripts per major phase + final `verify-inventory-phase059-final.mjs`

### Out of scope (moved to Deferred)

See [Deferred outside Phase 059](#deferred-outside-phase-059).

---

## Current system baseline (confirmed 059A.1)

### Adjust flow (059A.2 — channel preview added; sync not executed yet)

| Step | Component |
|------|-----------|
| UI entry | Table `Adjust` → `openAdjustModal(rowId)` — `js/admin/inventory/ui/adjustModal.js` |
| Modal markup | `js/admin/inventory/renderers/renderAdjustModal.js` + `renderAdjustChannelPreview.js` |
| Channel preview | `adjustModalChannelPreview.js` → `channelSyncCandidateApi.js` (single-variant read) |
| Preview mappers | `js/admin/inventory/services/adjustChannelPreview.js` |
| Stock preview math | `js/admin/inventory/services/adjustmentMath.js` |
| RPC on confirm | `adjust_inventory` — **unchanged** (still KK-only until 059A.3) |
| Client API | `js/admin/inventory/api/adjustInventoryApi.js` |
| Post-success | `refreshInventoryAfterAdjustment()` — `js/admin/inventory/services/refreshInventoryData.js` |

**On confirm (059A.3):** `runAdjustChannelOrchestration` → `adjust_inventory` first; optional Amazon/eBay `update_qty` push when sync toggle ON and projected available > 0.

### Channel sync APIs (existing — orchestrator calls these)

| Channel | Client API | Edge function | Eligible action (059A safe paths) |
|---------|------------|---------------|-----------------------------------|
| Amazon active | `js/admin/inventory/api/amazonSyncPushApi.js` | `sync-amazon-inventory-quantity` | `amazon_sync_action = update_qty` only |
| eBay cache | `js/admin/inventory/api/ebayCacheRefreshApi.js` | `sync-ebay-listing-inventory-cache` | Single product refresh (059C chains) |
| eBay active qty | `js/admin/inventory/api/ebaySyncPushApi.js` | `sync-ebay-inventory-quantity` | `ebay_sync_action = update_qty` only |
| eBay relist assist | `js/admin/inventory/api/ebayRelistAssistApi.js` | *(none — links only)* | `ended_needs_relist` → manual links until 059D |
| Amazon inactive | `amazon-patch-listing` (offer restore) | Not wired to Inventory sync | `inactive_can_update` → 059B |
| Preview (full table) | `channelSyncPreviewApi.js` → `fetchChannelSyncPreview()` | — | **Do not use in adjust flow** (pool risk) |

### Lightweight read for adjust preview (059A.2 target)

New helper (not yet implemented): `fetchChannelSyncCandidateForVariant(variantId)` — single row from `v_inventory_channel_sync_candidates` with columns:

`variant_id, available_qty, on_hand_qty, reserved_qty, amazon_sync_action, amazon_listing_status, amazon_current_qty, ebay_sync_action, ebay_listing_status, ebay_current_qty, issue_flags`

Optional: single row from `v_inventory_ebay_relist_candidates` when `ebay_sync_action = ended_needs_relist`.

### Sync action reference

| `amazon_sync_action` | 059A orchestrator | Later phase |
|---------------------|-------------------|-------------|
| `update_qty` | ✅ Call existing push | — |
| `inactive_can_update` | ✅ `mode: inactive_restock` when sync ON (059B.3) | — |
| `afn_skip` | Skip + label | — |
| `missing_mapping` | Skip + label | — |
| `no_change` | Skip | — |

| `ebay_sync_action` | 059A orchestrator | Later phase |
|---------------------|-------------------|-------------|
| `update_qty` | ✅ Call existing push (cache if API supports single-SKU) | 059C polish chain |
| `qty_cache_missing` | Next-step: refresh cache | 059C automate |
| `ended_needs_relist` | Next-step: Relist Assist | 059D automate |
| `unsupported_variation` | Manual only | Deferred |
| `missing_mapping` | Manual only | — |

### Orchestration boundaries (059A.1)

```
┌─────────────────────────────────────────────────────────────┐
│  Adjust modal (browser)                                      │
│  ├─ Preview: single-variant candidate read (lightweight)    │
│  ├─ Toggle: sync channels after adjust                      │
│  └─ Confirm                                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  adjustChannelOrchestrator.js (059A.3+)                        │
│  1. adjust_inventory RPC          ← ONLY stock writer       │
│  2. if sync off → KK-only result                            │
│  3. if sync on → sequential channel steps (edge functions)  │
│  4. unified result panel + audit correlation (059A.4)       │
└─────────────────────────────────────────────────────────────┘

FORBIDDEN:
  × Amazon/eBay API inside adjust_inventory transaction
  × Parallel multi-variant channel sync
  × fetchChannelSyncPreview() full table in adjust flow
  × Browser issue snapshot refresh RPC
```

---

## Progress tracker

| Subphase | Status |
|----------|--------|
| 059A.1 | ✅ Complete |
| 059A.2 | ✅ Complete |
| 059A.3 | ✅ Complete |
| 059A.4 | ✅ Complete |
| 059A.5 | ✅ Complete |
| **059A** | **✅ Complete (frozen)** |
| 059B.1 | ✅ Complete |
| 059B.2 | ✅ Complete |
| 059B.3 | ✅ Complete |
| 059B.4 | ✅ Complete |
| 059B.5 | ✅ Complete |
| **059B** | **✅ Complete (frozen)** |
| 059C.1 | ✅ Complete |
| 059C.2 | ✅ Complete |
| 059C.3 | ✅ Complete |
| 059C.4 | ✅ Complete |
| 059C.5 | ✅ Complete |
| **059C** | **✅ Complete (frozen)** |
| 059D.1 | ✅ Complete |
| 059D.2 | ✅ Complete |
| 059D.3 | ✅ Complete |
| 059D.4 | ✅ Complete |
| 059D.5 | ✅ Complete |
| **059D** | **✅ Complete (frozen)** |
| 059E.1 | ✅ Complete |
| 059E.2 | ✅ Complete |
| 059E.3 | ✅ Complete |
| 059E.4 | ✅ Complete |
| 059E.5 | ✅ Complete |
| **059E** | **✅ Complete (frozen)** |
| **Phase 059** | **✅ Complete / Frozen / Production-ready** |

---

## 059A — Adjust Orchestration Shell + Safe Existing Paths ✅

**Status:** Complete and frozen (2026-06-09) — verified by `verify-inventory-phase059a-adjust-orchestration.mjs`

**Purpose:** One admin confirmation runs stock adjust first, then **existing safe channel steps** where already supported. **No** Amazon inactive restore or eBay auto-relist in 059A.

**Major phase complete when:** 059A.5 verification passes and docs mark 059A production-safe. ✅

---

### 059A.1 — Plan rewrite + orchestration boundaries ✅

**Status:** Complete (2026-06-09)

**Tasks:**

- [x] Rewrite Phase 059 doc with strict 059A–059E / .1–.5 structure
- [x] Add completion definition for each subphase
- [x] Add final definition: `059E.5 = 100% complete`
- [x] Document in-scope / out-of-scope / deferred
- [x] Confirm current adjust flow and channel sync APIs
- [x] Create implementation checklist for 059A.2–059A.5
- [x] Update roadmap with strict 059 structure

**Deliverables:**

- This document (rewritten)
- `roadmap.md` updated

**Verification:**

- Static doc verification only
- No JS/DB/runtime behavior changes in 059A.1

**Completion criteria:** Doc + roadmap updated; boundaries documented; no code changes.

---

### 059A.2 — Adjust modal channel preview ✅

**Status:** Complete (2026-06-09)

**Tasks:**

- [x] Add channel preview strip to Adjust modal
- [x] Add `fetchChannelSyncCandidateForVariant(variantId)` — `channelSyncCandidateApi.js` (single-row `.eq("variant_id").maybeSingle()`)
- [x] Optional relist row when `ended_needs_relist`
- [x] Status mappers in `adjustChannelPreview.js`
- [x] Preview controller in `adjustModalChannelPreview.js`
- [x] **“Sync channels after adjust”** toggle (UI only)
- [x] Toggle default ON when projected available &gt; 0 and (`amazon_sync_action === update_qty` OR `ebay_sync_action === update_qty`)
- [x] Toggle default OFF otherwise; user manual change preserved
- [x] Preview-only copy referencing 059A.3
- [x] Verification script

**Files created:**

| File | Purpose |
|------|---------|
| `js/admin/inventory/api/channelSyncCandidateApi.js` | Single-variant candidate + optional relist read |
| `js/admin/inventory/services/adjustChannelPreview.js` | Status mappers + toggle default logic |
| `js/admin/inventory/renderers/renderAdjustChannelPreview.js` | Preview markup |
| `js/admin/inventory/ui/adjustModalChannelPreview.js` | Preview load/refresh controller |
| `scripts/verify-inventory-phase059a2-adjust-channel-preview.mjs` | Verification |

**Files changed:**

| File | Change |
|------|--------|
| `js/admin/inventory/renderers/renderAdjustModal.js` | Channel preview shell |
| `js/admin/inventory/ui/adjustModal.js` | Wire preview load + form refresh |

**Verification:**

```bash
node scripts/verify-inventory-phase059a2-adjust-channel-preview.mjs
```

**Result:** PASS (static + browser)

**Completion criteria:** Preview + toggle visible; zero channel sync side effects; pool-safe single-variant reads only.

---

### 059A.3 — Orchestrator shell after adjust ✅

**Status:** Complete (2026-06-09)

**Tasks:**

- [x] Add `adjustChannelOrchestrator.js` + `adjustChannelNextSteps.js` + `adjustOrchestratorSummary.js`
- [x] Flow: adjust → optional channel sync when toggle ON and projected available > 0
- [x] Amazon: `pushAmazonFbmInventory({ variantIds: [id], limit: 1 })` only when post-adjust `amazon_sync_action === update_qty`
- [x] eBay: `pushEbayInventoryQuantity({ variantIds: [id], limit: 1 })` only when post-adjust `ebay_sync_action === update_qty` and available > 0
- [x] `inactive_can_update` → next_step (059B); `ended_needs_relist` → next_step (059D); `qty_cache_missing` → next_step (059C)
- [x] Wire orchestrator into `adjustModal.js`; toast summary until 059A.4 panel
- [x] Re-fetch single-variant candidate after adjust before channel branches

**Files created:**

| File | Purpose |
|------|---------|
| `js/admin/inventory/services/adjustChannelOrchestrator.js` | Orchestrator (`runAdjustChannelOrchestration`) |
| `js/admin/inventory/services/adjustChannelNextSteps.js` | Next-step labels + URLs |
| `js/admin/inventory/services/adjustOrchestratorSummary.js` | Toast formatter |
| `scripts/verify-inventory-phase059a3-adjust-orchestrator.mjs` | Verification |

**Files changed:**

| File | Change |
|------|--------|
| `js/admin/inventory/ui/adjustModal.js` | Submit uses orchestrator + summary toast |

**Safe channel rules (059A.3):**

| Action | Behavior |
|--------|----------|
| Sync toggle OFF | KK adjust only |
| Projected available ≤ 0 | Skip all marketplace sync |
| Amazon `update_qty` | Single-variant live push via existing API |
| Amazon `inactive_can_update` | `next_step` — no API call |
| eBay `update_qty` | Single-variant push; skip if available ≤ 0 |
| eBay `ended_needs_relist` | `next_step` — no relist |
| eBay `qty_cache_missing` | `next_step` — no cache refresh in 059A.3 |

**Verification:**

```bash
node scripts/verify-inventory-phase059a3-adjust-orchestrator.mjs
```

**Result:** PASS (static + browser)

**Completion criteria:** Orchestrator chains adjust + safe APIs; deferred paths return structured next-step objects.

---

### 059A.4 — Unified result panel + audit correlation ✅

**Status:** Complete (2026-06-09)

**Tasks:**

- [x] Result panel after adjust: KK / Amazon / eBay / warnings / errors / next steps / orchestration + ledger ids
- [x] Deep links: Sync Channels modal, Amazon Listings, eBay Relist Assist, eBay Listings, inventory row hash
- [x] `orchestrationId` reuses adjust `idempotencyKey`; shown in panel + returned from orchestrator
- [x] Channel sync runs log `trigger_source=manual_adjust`, `trigger_reference_type=stock_ledger`, ledger + orchestration ids via `syncContext` passthrough
- [x] Partial failure banner when KK succeeds but a channel fails — no stock rollback
- [x] Toast remains as short summary; panel is primary UX; modal stays open until Done
- [x] **No new stock writer**

**Files created:**

| File | Purpose |
|------|---------|
| `js/admin/inventory/ui/adjustResultPanel.js` | Result panel controller + link actions |
| `js/admin/inventory/renderers/renderAdjustResultPanel.js` | Result panel markup |
| `js/admin/inventory/services/adjustSyncContext.js` | `buildAdjustSyncContext()` for channel push correlation |
| `supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql` | Extends `inventory_channel_sync_runs` with trigger/orchestration fields |
| `scripts/verify-inventory-phase059a4-result-panel-audit.mjs` | Verification |

**Files changed:**

| File | Change |
|------|--------|
| `js/admin/inventory/ui/adjustModal.js` | Shows result panel after orchestration; refresh before panel; Done closes modal |
| `js/admin/inventory/services/adjustChannelOrchestrator.js` | Passes `syncContext`; captures `runId`; panel-friendly messages |
| `js/admin/inventory/services/adjustOrchestratorSummary.js` | Partial-failure copy + `hasPartialChannelFailure()` |
| `js/admin/inventory/api/amazonSyncPushApi.js` | Accepts optional `syncContext` in payload |
| `js/admin/inventory/api/ebaySyncPushApi.js` | Accepts optional `syncContext` in payload |
| `supabase/functions/_shared/inventoryAmazonSyncUtils.ts` | `parseInventorySyncRunContext()` + correlation columns on run insert |
| `supabase/functions/_shared/inventoryEbaySyncUtils.ts` | Re-exports `parseInventorySyncRunContext` |
| `supabase/functions/sync-amazon-inventory-quantity/index.ts` | Persists sync context on run rows |
| `supabase/functions/sync-ebay-inventory-quantity/index.ts` | Persists sync context on run rows |

**Result panel behavior:**

| Element | Behavior |
|---------|----------|
| KK card | Success: “Stock adjusted successfully.” + delta/on-hand detail |
| Amazon card | `success` / `failed` / `skipped` / `next_step` with message; optional sync `runId` |
| eBay card | Same as Amazon |
| Partial failure | Amber banner: “Stock remains adjusted. Retry channel sync from Sync Channels.” |
| Meta footer | Orchestration id + stock ledger id (selectable) |
| Done | Closes modal (inventory already refreshed) |
| Links | Retry → Sync Channels modal; next-step → Amazon/eBay admin or Relist Assist |

**Audit / correlation behavior:**

| Field | Value (adjust-triggered sync) |
|-------|-------------------------------|
| `trigger_source` | `manual_adjust` |
| `trigger_reference_type` | `stock_ledger` |
| `trigger_reference_id` | `stock_ledger.id` from adjust RPC |
| `stock_ledger_id` | Same ledger id |
| `orchestration_id` | Adjust idempotency key |

Client passes `syncContext` on `pushAmazonFbmInventory` / `pushEbayInventoryQuantity`; edge functions write columns on `inventory_channel_sync_runs` insert. Existing sync paths without `syncContext` unchanged.

**Known limitations (059A.4):**

- Amazon inactive restore, eBay ended auto-relist, eBay cache refresh chain still `next_step` only (059B/C/D)
- Panel does not live-query sync run status after push — shows orchestrator result + `runId` when returned
- Migration must be applied before correlation columns populate in production
- Edge functions must be redeployed for `syncContext` persistence

**Remaining for 059A.5:** Full 059A QA script freeze (`verify-inventory-phase059a-adjust-orchestration.mjs`), mark 059A major phase complete.

**Verification:**

```bash
node scripts/verify-inventory-phase059a4-result-panel-audit.mjs
```

**Result:** PASS (static + browser)

**Completion criteria:** Operator sees unified outcome in panel; audit trail can correlate adjust ledger + channel runs; partial failures clear; stock mutation only via adjust RPC.

---

### 059A.5 — 059A QA + freeze ✅

**Status:** Complete (2026-06-09)

**Tasks:**

- [x] Add `scripts/verify-inventory-phase059a-adjust-orchestration.mjs` (composes 059A.2–059A.4 + full slice)
- [x] Verify: modal, preview, orchestrator, result panel, audit, no heavy pool-risk reads
- [x] Pool-safety: `verify-inventory-issue-view-safety.mjs` + `verify-inventory-phase10y-final-stabilization.mjs`
- [x] Browser smoke: preview cards, sync OFF submit (mocked RPC), result panel, Done closes modal
- [x] Mark 059A major phase complete in doc + roadmap
- [x] **Stop** after 059A.5 before starting 059B

**Files created:**

| File | Purpose |
|------|---------|
| `scripts/verify-inventory-phase059a-adjust-orchestration.mjs` | Final 059A QA — composes A.2–A.4 sub-scripts + smoke |

**Files changed (059A cumulative — reference):**

| Area | Files |
|------|-------|
| Preview (A.2) | `channelSyncCandidateApi.js`, `adjustChannelPreview.js`, `renderAdjustChannelPreview.js`, `adjustModalChannelPreview.js`, `renderAdjustModal.js`, `adjustModal.js` |
| Orchestrator (A.3) | `adjustChannelOrchestrator.js`, `adjustChannelNextSteps.js`, `adjustOrchestratorSummary.js` |
| Result + audit (A.4) | `adjustResultPanel.js`, `renderAdjustResultPanel.js`, `adjustSyncContext.js`, push APIs, edge functions, migration |
| QA (A.5) | This doc, `roadmap.md` |

**Verification:**

```bash
node scripts/verify-inventory-phase059a-adjust-orchestration.mjs
```

**Result:** PASS — prior A.2/A.3/A.4 scripts PASS; pool-safety PASS; browser smoke PASS (mocked `adjust_inventory` RPC; no live marketplace writes)

**059A production deployment checklist:**

| Step | Action |
|------|--------|
| 1 | Apply `supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql` |
| 2 | Redeploy edge function `sync-amazon-inventory-quantity` |
| 3 | Redeploy edge function `sync-ebay-inventory-quantity` |
| 4 | Confirm `AMAZON_ENABLE_LIVE_PATCH=true` before live Amazon qty sync |
| 5 | Confirm `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` before live eBay qty sync |

Do **not** run live marketplace sync tests unless gates above are explicitly enabled.

**Remaining limitations (059A frozen scope):**

| Path | 059A behavior | Starts in |
|------|---------------|-----------|
| Amazon inactive restore | `next_step` only | **059B** |
| eBay cache refresh chain | `next_step` only | **059C** |
| eBay ended auto-relist | `next_step` only | **059D** |
| eBay variation automation | manual / `next_step` | 059D+ |
| qty-0 eBay push | skipped | — |
| Full `fetchChannelSyncPreview()` in adjust flow | not used | — |
| Browser issue snapshot refresh from adjust | not used | — |

**Completion criteria (059A major phase):** ✅

- Adjust modal supports preview + toggle
- Existing safe channel sync paths chain after adjust when toggle ON
- Inactive Amazon and ended eBay detected but **not** automated
- Unified result panel + audit correlation
- 059A verification script passes
- 059A is production-safe (with deployment checklist above)

**Next:** 059B.1 — Amazon inactive restock audit

---

### 059A.2–059A.5 implementation checklist

| # | Item | Subphase |
|---|------|----------|
| 1 | `fetchChannelSyncCandidateForVariant(variantId)` — single `.eq('variant_id')` | 059A.2 |
| 2 | Preview status label mapper (Amazon/eBay/KK) | 059A.2 |
| 3 | Sync toggle + default-on logic (0→positive + safe candidate) | 059A.2 |
| 4 | `adjustChannelOrchestrator.js` skeleton + types | 059A.3 |
| 5 | Wire orchestrator to adjust submit | 059A.3 |
| 6 | Amazon `update_qty` single-variant push | 059A.3 |
| 7 | eBay `update_qty` single-variant push | 059A.3 |
| 8 | Next-step objects for inactive/ended/unsupported | 059A.3 |
| 9 | `adjustResultPanel.js` render + wire | 059A.4 |
| 10 | Audit correlation fields (migration or metadata) | 059A.4 |
| 11 | `verify-inventory-phase059a-adjust-orchestration.mjs` | 059A.5 |
| 12 | Mark 059A complete in doc + roadmap | 059A.5 |

---

## 059B — Amazon Inactive Restock / Offer Restore ✅

**Purpose:** Amazon inactive/suppressed FBM offers restore and update after Adjust when stock is positive.

**Status:** **059B major phase complete** (2026-06-09) — frozen before 059C.

**Major phase complete when:** 059B.5 verification passes. ✅

**Final verification:**

```bash
node scripts/verify-inventory-phase059b-final-freeze.mjs
```

**Result:** PASS (composed 059B.1–059B.4 + 059A regression + pool safety)

---

### 059B.1 — Amazon inactive audit + edge design ✅

**Status:** Complete (2026-06-09) — **design/audit only; no runtime changes**

**Completion criteria:** Design doc section with restore path, `inactive_can_update` detection, live gate, failure modes documented. ✅

---

#### Audit findings — how `inactive_can_update` is determined

Source: `v_inventory_channel_sync_candidates` (`20260903_inventory_phase7a_channel_sync_candidates.sql`, unchanged in 7D).

Amazon branch (FBM only — `amazon_is_afn` must be false):

| Condition | Result |
|-----------|--------|
| AFN/FBA (`amazon_is_afn`) | `afn_skip` |
| No mapped listing | `missing_mapping` |
| `amazon_current_qty` known, ≠ `available_qty`, and `listing_status` ∈ **`inactive`, `suppressed`, `issue`** | **`inactive_can_update`** |
| Same qty mismatch but status not inactive/suppressed/issue | `update_qty` |
| Mapped, qty matches | `no_change` |

**Statuses that trigger inactive path:** `inactive`, `suppressed`, `issue` (case-insensitive via `LOWER(listing_status)`).

**AFN detection:** fulfillment channel contains `AMAZON` or equals `AFN`, or FBA fulfillable > 0 with FBM ≤ 0.

**Mapping join:** `amazon_listing_mappings` where `mapping_status = 'mapped'` and `kk_variant_id` matches; latest by `mapped_at` / `created_at`. Requires `amazon_listings.fbm_quantity` not null for inactive vs update_qty split.

**`listing_status` normalization** (import/sync): `amazonSpApiUtils.normalizeListingStatus()` sets:

- `issue` — SP-API error-severity issues
- `inactive` — missing offer/price, or not buyable without suppressed flag
- `suppressed` — summary status contains SUPPRESSED
- `out_of_stock` — qty 0 with offer present
- `active` — buyable

**Tables involved:**

| Table / view | Role |
|--------------|------|
| `amazon_listings` | Seller SKU, `listing_status`, `listing_status_buyable`, `price`, `fbm_quantity`, `fulfillment_channel`, `asin`, `raw_listing`, `product_type` |
| `amazon_listing_mappings` | `kk_variant_id` → `amazon_listing_id`, `mapping_status = mapped` |
| `v_inventory_channel_sync_candidates` | Computes `amazon_sync_action` read-only |

---

#### Audit findings — current 7C sync excludes inactive listings

`loadAmazonSyncCandidates()` in `inventoryAmazonSyncUtils.ts`:

```typescript
.eq("amazon_sync_action", "update_qty")
```

Post-filter also requires `amazon_sync_action === "update_qty"`. **`inactive_can_update` rows never enter `sync-amazon-inventory-quantity`.**

`processPerListingQuantityPatches()` (`amazonBulkPatchUtils.ts`) uses **PATCH only** (`buildListingPatchOperations` + `patchListingsItemLiveUpdate`). It does **not** call `buildOfferRestorePutBody` or `putListingsItemLiveSubmit`.

**Implication:** Even if inactive rows were loaded, qty-only PATCH on a non-buyable offer is unlikely to restore the listing. Inactive restock needs the **LISTING_OFFER_ONLY PUT** path already implemented in `amazon-patch-listing`.

---

#### Audit findings — existing offer restore (`amazon-patch-listing`)

**Live gate:** `AMAZON_ENABLE_LIVE_PATCH !== "true"` → `403 live_patch_disabled` unless `preview: true` (same pattern as `sync-amazon-inventory-quantity`).

**Offer restore decision:** `listingNeedsOfferPut(listing, { price, quantity })` when:

- `listing_status_buyable !== true`, or
- missing ASIN + missing offer price, or
- live offer price in `raw_listing` differs from submitted price by ≥ $0.01

**Restore payload:** `buildOfferRestorePutBody(listing, patch)` → `putListingsItemLiveSubmit` / `putListingsItemValidationPreview` with:

- `requirements: "LISTING_OFFER_ONLY"`
- `productType: "PRODUCT"`
- `attributes.purchasable_offer` (price from listing or patch)
- `attributes.fulfillment_availability` (FBM channel + **target quantity**)
- `attributes.merchant_suggested_asin` when ASIN known

**Preconditions for restore body:** `marketplace_id`, `price > 0` (from listing row or patch), optional qty ≥ 0.

**Restore + qty:** **Combined in one PUT** when offer restore path is selected — safe for inactive restock (same as manual Amazon admin patch).

**After live success:** `applyLocalListingPatchUpdate()` updates local `fbm_quantity` / `price`; **no immediate SP-API re-sync** (async submission noted in comments).

**Success response shape:**

```json
{
  "ok": true,
  "preview": false,
  "submissionStatus": "ACCEPTED",
  "submissionId": "...",
  "issues": [],
  "patch": { "quantity": 3 },
  "amazonListingId": "uuid",
  "offerRestore": true
}
```

**Failure shapes:** `live_patch_disabled`, `listing_not_found`, `listing_not_patchable`, `invalid_price`, `fba_quantity_not_supported`, `patch_failed`, `patch_rejected` (422 + issues), `database_error`.

**Not wired to Inventory:** Client uses direct `amazon-patch-listing` from Amazon admin flows only; `pushAmazonFbmInventory()` → `sync-amazon-inventory-quantity` only.

---

#### Selected implementation approach for 059B.2

**Recommendation: Option A — extend `sync-amazon-inventory-quantity`**

| Criterion | Option A (extend existing) | Option B (new function) |
|-----------|---------------------------|-------------------------|
| Code duplication | Reuse run logging, auth, live gate, `syncContext` | Duplicate boilerplate |
| Sync Channels safety | Default `mode: "update_qty"` preserves current bulk behavior | Risk of two entry points |
| Orchestrator integration | Same `pushAmazonFbmInventory()` with `mode: "inactive_restock"` | New client API |
| Offer restore logic | Extract shared helper from `amazon-patch-listing` path into `_shared` | Same extraction needed anyway |

**Do not** create `sync-amazon-inventory-restock` unless Option A becomes unwieldy.

**059B.2 contract (proposed):**

**Endpoint:** existing `sync-amazon-inventory-quantity` POST

**New payload fields:**

```typescript
{
  preview?: boolean;
  variantIds?: string[];       // required for adjust; max 1 when mode=inactive_restock from orchestrator
  amazonListingIds?: string[];
  limit?: number;              // default 25; orchestrator passes limit: 1
  syncContext?: { ... };       // 059A.4 correlation (manual_adjust, stock_ledger_id, orchestration_id)
  mode?: "update_qty" | "inactive_restock";  // default "update_qty" — backward compatible
}
```

**Preconditions (inactive_restock):**

| # | Rule |
|---|------|
| 1 | Candidate row exists with `amazon_sync_action = inactive_can_update` |
| 2 | `available_qty` / `available_qty_nonneg` > 0 |
| 3 | Not AFN (`amazon_is_afn = false`) |
| 4 | Mapped listing + seller SKU + `product_type` |
| 5 | `amazon_listings.price > 0` (required by `buildOfferRestorePutBody`) |
| 6 | Live gate: `AMAZON_ENABLE_LIVE_PATCH=true` for push; `preview:true` when off |

**Behavior (single listing, sequential):**

1. Load candidate(s) with `inactive_can_update` (new loader or `loadAmazonSyncCandidates` accepts `actions[]`).
2. Fetch full `amazon_listings` row (needs `asin`, `raw_listing`, `listing_status_buyable`, `price` — not all on `v_amazon_listing_workspace`).
3. If `listingNeedsOfferPut` → `buildOfferRestorePutBody` + PUT with target qty = `targetQtyFromAvailable(available)`.
4. Else fallback PATCH qty only (edge case — log warning; should be rare for inactive_can_update).
5. Log `inventory_channel_sync_runs` + `inventory_channel_sync_results` with `action: "inactive_restock"` and 059A correlation fields.
6. `applyLocalListingPatchUpdate` on live success (no stock mutation).

**Output (align with 7C shape for orchestrator):**

```json
{
  "ok": true,
  "mode": "inactive_restock",
  "preview": false,
  "runId": "uuid",
  "candidateCount": 1,
  "summary": { "total": 1, "succeeded": 1, "failed": 0, "skipped": 0 },
  "results": [{
    "variantId": "uuid",
    "amazonListingId": "uuid",
    "sellerSku": "KK-1234",
    "previousQty": 0,
    "targetQty": 3,
    "status": "success",
    "offerRestore": true,
    "submissionStatus": "ACCEPTED",
    "submissionId": "...",
    "issues": []
  }]
}
```

**Shared helper extraction (059B.2):** Move offer-restore submit block from `amazon-patch-listing` into e.g. `_shared/amazonOfferRestoreUtils.ts`; call from both patch-listing and inventory sync to avoid drift.

**Sync Channels modal:** Keep calling with default `mode: "update_qty"` only — **no bulk inactive restore** until explicitly designed later.

**Optional 059B.2 migration:** Extend `inventory_channel_sync_runs.mode` check to allow `inactive_restock`, or reuse `mode: "push"` with `notes: "Amazon inactive FBM restock"`.

---

#### Safety rules (059B — mandatory)

| Rule | Detail |
|------|--------|
| One variant per Adjust orchestration | `variantIds: [id]`, `limit: 1` from orchestrator |
| No AFN/FBA | Skip when `amazon_is_afn`; reject `fba_quantity_not_supported` |
| No bulk inactive restore | `inactive_restock` requires explicit `mode`; Sync Channels unchanged |
| No restore when available ≤ 0 | Skip with clear message (same as 059A marketplace skip) |
| No stock mutation | Amazon API + local listing cache only; KK stock already adjusted |
| No DB transaction wrapping Amazon calls | Same as 7C — sequential API, log after |
| No browser snapshot refresh | No issue snapshot reads from adjust/inactive path |
| No heavy dashboard/issue views | Single-variant candidate read only |
| Live gate required | `AMAZON_ENABLE_LIVE_PATCH` for live push |
| Preview when gate off | `preview: true` → SP-API validation only |

---

#### Failure handling (059B)

| Scenario | Behavior |
|----------|----------|
| KK adjust succeeded, Amazon restore failed | **Stock remains adjusted** — no rollback |
| Result panel | KK success; Amazon **failed** separately with message |
| Partial failure copy | Reuse 059A banner: “Stock remains adjusted. Retry channel sync from Sync Channels.” |
| Retry | Sync Channels modal + Amazon Listings admin link |
| Audit | `inventory_channel_sync_runs` + results with correlation; `status: failed`, `error_message` from Amazon |
| Invalid price / missing mapping | Failed result row; no retry loop in edge |
| Live gate off | `403 live_patch_disabled` or preview-only validation |

---

#### Verification plan — 059B.2 through 059B.5

| Subphase | Script / checks |
|----------|-----------------|
| **059B.2** | `scripts/verify-inventory-phase059b2-amazon-inactive-edge.mjs` — mode flag, inactive loader, offer PUT path, live gate, preview, AFN skip, no stock writes |
| **059B.3** | Orchestrator calls inactive path when `inactive_can_update`; preview label “will restore”; still one variant |
| **059B.4** | `scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs` — end-to-end static + optional live SKU test behind env flag |
| **059B.5** | `scripts/verify-inventory-phase059b-final-freeze.mjs` — compose all 059B scripts + freeze guardrails |

**059B.1 verification:**

```bash
node scripts/verify-inventory-phase059b1-amazon-inactive-audit.mjs
```

**Result:** PASS (static — doc + no runtime drift)

**Files changed (059B.1):**

| File | Change |
|------|--------|
| `docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md` | This audit + contract |
| `docs/pages/admin/inventory/implementation/roadmap.md` | 059B.1 complete |
| `scripts/verify-inventory-phase059b1-amazon-inactive-audit.mjs` | Static verification |

**No runtime files changed** in 059B.1.

**Next:** See 059B.2 (complete) and 059B.3.

---

### 059B.2 — Edge function support ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** Edge accepts inactive restock mode; restore + qty push for one listing; respects `AMAZON_ENABLE_LIVE_PATCH`; logs to `inventory_channel_sync_runs`. ✅

**Files created:**

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/amazonOfferRestoreUtils.ts` | Shared `submitAmazonOfferRestore()` — reuses `buildOfferRestorePutBody` + PUT submit |
| `supabase/functions/_shared/inventoryAmazonInactiveRestock.ts` | Inactive candidate loader + `handleAmazonInactiveRestockSync()` |
| `scripts/verify-inventory-phase059b2-amazon-inactive-edge.mjs` | Static verification |

**Files changed:**

| File | Change |
|------|--------|
| `supabase/functions/sync-amazon-inventory-quantity/index.ts` | `mode` param; routes `inactive_restock` to handler; default `update_qty` unchanged |

**Request contract:**

```typescript
POST /functions/v1/sync-amazon-inventory-quantity
{
  mode?: "update_qty" | "inactive_restock";  // default "update_qty"
  preview?: boolean;
  variantIds?: string[];   // inactive_restock: exactly 1 required
  amazonListingIds?: string[];  // inactive_restock: not allowed
  limit?: number;          // inactive_restock: must be 1 if set
  syncContext?: { trigger_source, stock_ledger_id, orchestration_id, ... }
}
```

**Inactive restock flow:**

1. Validate single `variantId`; reject bulk.
2. Load `inactive_can_update` candidate (`available_qty > 0`, FBM, mapped).
3. Fetch full `amazon_listings` row for offer restore.
4. Skip AFN/FBA; skip when `available <= 0`.
5. **Live gate off + no preview:** return `dry_run` status, no Amazon API call.
6. **Preview or live enabled:** `submitAmazonOfferRestore()` with target qty = available.
7. Log run/result with `action: inactive_restock` + 059A correlation fields.

**Response shape (`mode: inactive_restock`):**

```json
{
  "ok": true,
  "mode": "inactive_restock",
  "preview": false,
  "runId": "uuid",
  "candidateCount": 1,
  "summary": { "total": 1, "succeeded": 1, "failed": 0, "skipped": 0 },
  "results": [{
    "status": "success|failed|skipped|dry_run",
    "mode": "inactive_restock",
    "variantId": "uuid",
    "amazonListingId": "uuid",
    "sellerSku": "KK-1234",
    "targetQty": 3,
    "previousQty": 0,
    "message": "...",
    "offerRestore": true,
    "submissionStatus": "ACCEPTED",
    "submissionId": "..."
  }],
  "message": "..."
}
```

**Dry-run / live gate behavior:**

| Condition | Behavior |
|-----------|----------|
| `mode: update_qty` (default) | Unchanged — 403 if live off and no preview |
| `mode: inactive_restock`, gate off, no preview | `status: dry_run`, no API call, structured 200 |
| `mode: inactive_restock`, `preview: true` | SP-API validation preview via offer PUT |
| `mode: inactive_restock`, gate on | Live offer restore PUT + local listing cache update |

**Safety rules enforced:**

- Single variant only; `limit` capped at 1
- `inactive_can_update` filter only in inactive mode
- AFN/FBA skipped (`amazon_is_afn`, `isFbaManagedListing`)
- No restore when available ≤ 0
- No stock mutation; correlation fields preserved
- Sync Channels unchanged (no `mode` passed → `update_qty` only)

**Known limitations (059B.2 edge only):**

- `amazon-patch-listing` not refactored to use `submitAmazonOfferRestore` yet (can follow in polish)
- No live marketplace test in verify script (static only)
- Listing must have `price > 0` for offer restore body

**Verification (059B.2):**

```bash
node scripts/verify-inventory-phase059b2-amazon-inactive-edge.mjs
```

**Result:** PASS (static)

---

### 059B.3 — Adjust orchestrator integration ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** When `inactive_can_update` and positive available after adjust, orchestrator calls Amazon restore path; result panel shows outcome. ✅

**Files changed:**

| File | Change |
|------|--------|
| `js/admin/inventory/services/adjustChannelOrchestrator.js` | `runAmazonInactiveRestock()` → `pushAmazonFbmInventory({ mode: "inactive_restock", ... })` |
| `js/admin/inventory/services/adjustChannelPreview.js` | Inactive preview copy; toggle default includes `inactive_can_update` |
| `js/admin/inventory/services/adjustChannelNextSteps.js` | `inactive_can_update` handled by orchestrator (returns null) |
| `js/admin/inventory/services/adjustOrchestratorSummary.js` | Toast handles `dry_run` |
| `js/admin/inventory/renderers/renderAdjustResultPanel.js` | `dry_run` status badge |
| `js/admin/inventory/api/amazonSyncPushApi.js` | JSDoc for `mode` param |
| `scripts/verify-inventory-phase059a2-adjust-channel-preview.mjs` | Updated inactive preview label check |
| `scripts/verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs` | Verification |

**Orchestrator behavior (post-adjust, sync ON, projected available > 0):**

| Post-adjust `amazon_sync_action` | Action |
|----------------------------------|--------|
| `update_qty` | `pushAmazonFbmInventory({ variantIds, limit: 1, syncContext })` — unchanged |
| `inactive_can_update` | `pushAmazonFbmInventory({ mode: "inactive_restock", variantIds: [id], limit: 1, syncContext })` |
| Other | Skipped / manual via `resolveAmazonChannelStep` |

Uses **post-adjust** `fetchChannelSyncCandidateForVariant` — not stale preview data.

**Inactive restock call contract (orchestrator → API):**

```js
pushAmazonFbmInventory({
  mode: "inactive_restock",
  variantIds: [variantId],
  limit: 1,
  syncContext: buildAdjustSyncContext(orchestrationId, ledgerId),
});
```

**Result panel / orchestrator messages:**

| Edge/orchestrator status | Amazon message |
|--------------------------|----------------|
| `success` | “Amazon inactive offer restore requested.” |
| `dry_run` | “Amazon inactive restore previewed; live patch is disabled.” (warning, not KK failure) |
| `failed` | “Amazon inactive restore failed. Stock remains adjusted.” |
| `skipped` | Edge skip message (no candidate, AFN, etc.) |

**Dry-run / live gate:** Edge returns `dry_run` when `AMAZON_ENABLE_LIVE_PATCH` is off; orchestrator surfaces as `dry_run` + warning — KK still success.

**Audit/correlation:** Same `syncContext` as 059A.4 (`manual_adjust`, `stock_ledger`, `orchestration_id`).

**Preview copy:** “Amazon inactive — restore available after adjust” when projected available > 0.

**Remaining for 059B.4:** Dedicated inactive verification script + optional live SKU test behind env flag.

**Verification:**

```bash
node scripts/verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs
```

**Result:** PASS (static + browser smoke)

---

### 059B.4 — Amazon inactive verification ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** Verification script covers preview, restore, qty update, live gate off, failures. ✅

**Verification script:** `scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs`

```bash
node scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs
```

**Static checks:** PASS — edge `inactive_restock` mode, single variant/limit 1, AFN skip, available>0, dry_run gate, syncContext correlation, orchestrator post-adjust wiring, update_qty unchanged, eBay untouched, adjust_inventory sole stock writer.

**Regression scripts composed (all PASS):**

| Script | Scope |
|--------|--------|
| `verify-inventory-phase059a-adjust-orchestration.mjs` | 059A freeze + pool safety |
| `verify-inventory-phase059b2-amazon-inactive-edge.mjs` | Edge inactive mode |
| `verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs` | Orchestrator wiring |
| `verify-inventory-issue-view-safety.mjs` | Issues snapshot safety |
| `verify-inventory-phase10y-final-stabilization.mjs` | Pre-059 freeze |

**Browser smoke:** PASS — inventory loads, adjust modal opens, mocked `inactive_can_update` shows “restore available after adjust”, sync toggle defaults ON, dry_run result panel support, no console errors.

**Dry-run API test:** Skipped unless `TEST_AMAZON_INACTIVE_VARIANT_ID` is set (with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). When set, calls edge with `mode: inactive_restock`, `preview: true`, test `syncContext`; verifies response + optional `inventory_channel_sync_runs` correlation row.

**Live test:** Skipped unless `RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true`, `AMAZON_ENABLE_LIVE_PATCH=true`, and `TEST_AMAZON_INACTIVE_VARIANT_ID` — one variant only, warning printed, no retries.

**Known limitations:**

- Live Amazon call not run in default CI/local verify (env-gated)
- Dry-run API requires real inactive candidate variant UUID in env
- `amazon-patch-listing` not refactored to shared offer-restore helper yet
- Listing must have `price > 0` for offer restore body
- No bulk inactive restore from Sync Channels

**Files changed (059B.4):**

| File | Change |
|------|--------|
| `scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs` | **NEW** — full 059B verification + optional API/live + browser smoke |
| `scripts/verify-inventory-phase059b2-amazon-inactive-edge.mjs` | Remove stale “orchestrator not wired” check |
| `scripts/verify-inventory-phase059a-adjust-orchestration.mjs` | inactive_can_update orchestrated (not next_step) |
| `scripts/verify-inventory-phase059a3-adjust-orchestrator.mjs` | Accept inactive_restock mode; preview copy check |
| `scripts/verify-inventory-phase059a4-result-panel-audit.mjs` | Allow orchestrator inactive restore; dry_run status |

---

### 059B.5 — 059B QA + freeze ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** 059B marked complete in doc + roadmap; freeze before 059C. ✅

**Verification script:** `scripts/verify-inventory-phase059b-final-freeze.mjs`

```bash
node scripts/verify-inventory-phase059b-final-freeze.mjs
```

**Composed scripts (all must PASS):**

| Script | Scope |
|--------|--------|
| `verify-inventory-phase059b1-amazon-inactive-audit.mjs` | Design audit + Option A alignment |
| `verify-inventory-phase059b2-amazon-inactive-edge.mjs` | Edge inactive_restock mode |
| `verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs` | Orchestrator wiring |
| `verify-inventory-phase059b-amazon-inactive-restock.mjs` | Full 059B path + browser smoke |
| `verify-inventory-phase059a-adjust-orchestration.mjs` | 059A regression |
| `verify-inventory-issue-view-safety.mjs` | Pool-safe issues |
| `verify-inventory-phase10y-final-stabilization.mjs` | Pre-059 freeze |

**Result:** PASS (static + composed scripts; optional API/live skipped without env)

---

#### 059B major phase summary

From **Inventory → Adjust**, when sync toggle is ON and projected available > 0:

1. `adjust_inventory` runs first (sole stock writer).
2. Post-adjust candidate is re-fetched.
3. Amazon `update_qty` → existing FBM qty push (unchanged).
4. Amazon `inactive_can_update` → `pushAmazonFbmInventory({ mode: "inactive_restock", variantIds: [id], limit: 1, syncContext })`.
5. eBay unchanged in 059B (cache refresh = 059C; ended relist = 059D).

**Files created/changed across 059B:**

| Phase | Files |
|-------|--------|
| **059B.1** | Plan doc audit; `verify-inventory-phase059b1-amazon-inactive-audit.mjs` |
| **059B.2** | `inventoryAmazonInactiveRestock.ts`, `amazonOfferRestoreUtils.ts`; `sync-amazon-inventory-quantity/index.ts`; `verify-inventory-phase059b2-amazon-inactive-edge.mjs` |
| **059B.3** | `adjustChannelOrchestrator.js`, `adjustChannelPreview.js`, `adjustChannelNextSteps.js`, `renderAdjustResultPanel.js`, `adjustOrchestratorSummary.js`, `amazonSyncPushApi.js`; `verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs` |
| **059B.4** | `verify-inventory-phase059b-amazon-inactive-restock.mjs`; 059A regression script updates |
| **059B.5** | `verify-inventory-phase059b-final-freeze.mjs`; doc + roadmap freeze |

**Known limitations (frozen):**

| Limitation | Deferred to |
|------------|-------------|
| eBay active cache refresh before qty push | **059C** |
| eBay ended listing auto-relist | **059D** |
| Amazon AFN/FBA listings | Skipped permanently in 059 |
| Bulk inactive restore from Sync Channels | Not supported |
| Down-adjust / marketplace deactivation on qty 0 | Outside Phase 059 scope |
| `amazon-patch-listing` refactor to shared offer-restore helper | Optional polish |

---

#### Optional controlled test commands

**Dry-run / preview API** (no live patch required on client; uses `preview: true`):

```bash
TEST_AMAZON_INACTIVE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs
```

Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

**Live inactive restore test** (explicit opt-in only):

```bash
RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true \
AMAZON_ENABLE_LIVE_PATCH=true \
TEST_AMAZON_INACTIVE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs
```

**Warnings for live test:**

- One variant / one listing only — no bulk, no retries
- Use a real test SKU you control
- Verify Amazon listing status and qty before and after
- Do not run repeatedly
- Do not use on AFN/FBA listings
- Server must have `AMAZON_ENABLE_LIVE_PATCH=true`

Default verify runs **do not** call live Amazon.

---

#### 059B production deployment checklist

| Step | Action |
|------|--------|
| 1 | Apply migration `20261023_inventory_phase059a4_adjust_sync_run_correlation.sql` if not already applied |
| 2 | Deploy edge function `sync-amazon-inventory-quantity` (includes 059B.2 `inactive_restock` mode) |
| 3 | Confirm env `AMAZON_ENABLE_LIVE_PATCH=true` on Supabase for live inactive restore |
| 4 | Smoke: Adjust modal → inactive preview label → sync toggle → result panel (no console errors) |
| 5 | Confirm 059A correlation: `inventory_channel_sync_runs` rows include `trigger_source`, `orchestration_id` after adjust+sync |
| 6 | Optional: run dry-run test with `TEST_AMAZON_INACTIVE_VARIANT_ID` before live |
| 7 | Optional: one live inactive restore test when ready (see warnings above) |

**No eBay deploys required for 059B** unless 059A correlation migration was not yet applied (same migration covers Amazon runs).

**Next major phase:** **059D.2 — Relist edge function** (next).

---

## 059C — eBay Active Listing Cache Refresh + Quantity Push Polish ✅

**Status:** **059C major phase complete** (2026-06-09) — frozen before 059D.

**Purpose:** Reliable eBay **active** listing restock before ended-listing auto-relist (059D).

**Major phase complete when:** 059C.5 verification passes. ✅

**Final verification:**

```bash
node scripts/verify-inventory-phase059c-final-freeze.mjs
```

**Result:** PASS (composed 059C.1–059C.4 + 059A/059B regression + pool safety)

**Scope delivered:** Active eBay listings only — no ended relist, no variation automation, no qty-0 push from Adjust.

---

### 059C.1 — eBay active sync audit ✅

**Status:** Complete (2026-06-09) — **design/audit only; no runtime changes**

**Completion criteria:** Cache refresh + qty push flow documented; candidate statuses, stale/missing cache handling confirmed. ✅

**Verification:**

```bash
node scripts/verify-inventory-phase059c1-ebay-active-audit.mjs
```

**Result:** PASS (static — doc + no 059C runtime drift + 059B freeze regression)

**No runtime files changed** in 059C.1.

---

#### Audit findings — eBay cache refresh flow

**Edge:** `supabase/functions/sync-ebay-listing-inventory-cache/index.ts`  
**Client API:** `js/admin/inventory/api/ebayCacheRefreshApi.js` → `refreshEbayListingCache()`  
**Shared helpers:** `supabase/functions/_shared/inventoryEbayCacheUtils.ts`  
**Sync Channels UI:** `js/admin/inventory/ui/syncEbayReadiness.js` — “Refresh eBay Cache” button (bulk `limit: 25`, admin confirm)

**Request contract:**

```json
{
  "productIds": ["uuid", "..."],
  "limit": 25
}
```

| Field | Behavior |
|-------|----------|
| `productIds` | Optional UUID array; when set, restricts refresh to those products |
| `limit` | Default 25, max 50; caps products loaded from `products` table |

**Not accepted today:** `variant_id`, `ebay_listing_id`, seller SKU — refresh is **product-scoped** only.

**Single product refresh:** ✅ Supported via `productIds: [productId]` + `limit: 1`. The edge loads one product row, fetches active variants, calls `refreshProductEbayCache()` for that product only.

**Product selection query:** Products with `ebay_listing_id` or `ebay_offer_id` set, excluding `ebay_status = 'not_listed'`.

**What it writes — `ebay_listing_inventory_cache`:**

| Column | Source |
|--------|--------|
| `product_id`, `variant_id` | Product + matched variant (single-SKU: variant when one active variant) |
| `ebay_sku` | Product `ebay_sku` / code, or per-offer SKU in variation groups |
| `ebay_item_id` | Live offer listing id |
| `listing_status` | `mapOfferListingStatus()` → `active`, `ended`, etc. |
| `current_qty`, `available_qty` | Offer qty preferred, else inventory item ship-to qty |
| `last_synced_at`, `updated_at` | Refresh timestamp |
| `raw_payload_json` | offerId, quantities snapshot |

Upsert key: `(product_id, ebay_sku)`.

**Missing cache representation:** Candidate view sets `ebay_current_qty IS NULL` → `qty_cache_missing` when listing is active-mapped but no cache row qty.

**Stale cache:** View has `ebay_cache_synced_at` / `last_synced_at` but **no separate stale action**. Stale row with known qty → `update_qty` or `no_change` based on qty mismatch only. 059C may treat very stale cache as refresh trigger in orchestrator (optional polish in 059C.2+).

**Ended listings:** Cache refresh still **reads** ended/withdrawn offers via eBay Inventory API; `mapOfferListingStatus` → `ended`. Rows upserted with ended status. Candidate view maps ended statuses → `ended_needs_relist` (059D), not active sync.

**Variation groups (`ebay_item_group_key`):** `refreshProductEbayCache` loads **all offers** in the group and writes **multiple cache rows** (one per SKU). Not single-variant safe for Adjust — candidate view marks `unsupported_variation` when group + multi-variant + no per-variant cache SKU.

**Live gate:** **None** for cache refresh — read-only eBay Inventory API calls always run (admin auth required). Failures return per-product `failed` / `skipped`.

**Correlation / audit:** Creates `inventory_channel_sync_runs` with `channel: ebay`, `mode: cache_refresh`. **Does not** accept `syncContext` today — no `trigger_source` / `orchestration_id` on adjust-triggered refresh. **059C.2 should add optional `syncContext` passthrough** for parity with 059A.4.

---

#### Audit findings — eBay quantity push flow

**Edge:** `supabase/functions/sync-ebay-inventory-quantity/index.ts`  
**Client API:** `js/admin/inventory/api/ebaySyncPushApi.js` → `pushEbayInventoryQuantity()`  
**Shared:** `supabase/functions/_shared/inventoryEbaySyncUtils.ts`  
**Sync Channels UI:** `js/admin/inventory/ui/syncEbayQuantityPush.js` — bulk push `limit: 25`

**Request contract:**

```json
{
  "preview": false,
  "variantIds": ["uuid"],
  "productIds": ["uuid"],
  "limit": 1,
  "syncContext": {
    "trigger_source": "manual_adjust",
    "trigger_reference_type": "stock_ledger",
    "trigger_reference_id": "uuid",
    "stock_ledger_id": "uuid",
    "orchestration_id": "uuid"
  }
}
```

| Field | Behavior |
|-------|----------|
| `variantIds` | ✅ Supported — filters candidate view |
| `productIds` | ✅ Supported — alternative filter |
| `limit` | Default 25, max 50; orchestrator already uses `limit: 1` |
| `preview` | Dry-run validation path (no eBay writes) |
| `syncContext` | ✅ Parsed via `parseInventorySyncRunContext`; persisted on sync run (059A.4) |

**Candidate loading:** `loadEbaySyncCandidates()` queries `v_inventory_channel_sync_candidates` with `.eq("ebay_sync_action", "update_qty")` only.

**Post-filter `isEligibleCandidate` rejects:**

- Not `update_qty`
- `ebay_current_qty == null` (cache missing — **not loaded**)
- Missing eBay SKU, offer id, listing id
- Ended statuses: `ended`, `out_of_stock`, `withdrawn`, `inactive`
- Variation group: `ebay_item_group_key` + `product_active_variant_count > 1`

**`qty_cache_missing` treatment:** Never enters qty push loader → edge returns `candidateCount: 0` with message *“No eligible eBay update_qty candidates. Refresh eBay cache first…”*

**Qty 0:** `targetQtyFromAvailable()` can compute `0`. Edge does not block zero target. **Adjust orchestrator** already skips eBay push when `available_qty <= 0` (`runEbayUpdateQty`). Sync Channels bulk path could still push 0 — out of 059C Adjust scope.

**Live gate:** `EBAY_ENABLE_LIVE_QUANTITY_PATCH !== "true"` → **403** `live_patch_disabled` unless `preview: true`.

**Response shape:**

```json
{
  "ok": true,
  "preview": false,
  "runId": "uuid",
  "candidateCount": 1,
  "summary": { "succeeded": 1, "failed": 0, "skipped": 0 },
  "results": [{
    "variantId": "uuid",
    "status": "success|failed|skipped",
    "targetQty": 3,
    "previousQty": 1,
    "error": "...",
    "errorCode": "..."
  }]
}
```

**Logging:** `inventory_channel_sync_runs` + `inventory_channel_sync_results` with `action: set_quantity`. After live success, `updateEbayCacheQtyAfterPush()` updates local cache qty.

**059A correlation:** ✅ Qty push edge already persists `trigger_source`, `stock_ledger_id`, `orchestration_id` when `syncContext` provided (Adjust orchestrator passes this today for `update_qty`).

---

#### Audit findings — candidate view eBay actions

**Source:** `v_inventory_channel_sync_candidates` (`20260906_inventory_phase7d_ebay_cache.sql`)

**eBay-related fields:**

| Field | Meaning |
|-------|---------|
| `ebay_sync_action` | Computed action for this variant |
| `ebay_listing_status` | `COALESCE(cache.listing_status, products.ebay_status)` |
| `ebay_current_qty` | From `ebay_listing_inventory_cache.current_qty` (lateral join per variant/product) |
| `available_qty` | KK on_hand − reserved |
| `ebay_cache_synced_at` | Cache row `last_synced_at` |
| `ebay_item_group_key` | Variation group indicator on product |
| `product_active_variant_count` | Active variants on product |
| `ebay_offer_id`, `ebay_listing_id`, `ebay_sku` | Product-level mapping |

**Action determination (eBay branch, in order):**

| Action | Conditions |
|--------|------------|
| `no_active_listing` | No listing id, not_listed status, no offer id |
| `missing_mapping` | Offer id present but listing id null |
| `ended_needs_relist` | Status ∈ ended, out_of_stock, withdrawn, inactive |
| `unsupported_variation` | Item group key + >1 active variant + no per-variant cache SKU |
| `qty_cache_missing` | Active-mapped listing, not ended, **`ebay_current_qty IS NULL`** |
| `update_qty` | Cache qty known and ≠ `available_qty` |
| `no_change` | Mapped, qty matches |
| `unavailable` | Fallback |

**Adjust preview today:** `qty_cache_missing` → “Refresh eBay cache — handled in 059C” + sync toggle default OFF unless `update_qty` path exists.

**Adjust orchestrator today:** Only automates `update_qty`; all other actions → `resolveEbayChannelStep()` next_step/skipped.

---

#### 059C active eBay contract (059C.2–059C.5 target)

When **Adjust sync toggle ON**, **projected available > 0**, after successful `adjust_inventory`:

| Post-adjust `ebay_sync_action` | Behavior |
|--------------------------------|----------|
| `update_qty` | `pushEbayInventoryQuantity({ variantIds: [id], limit: 1, syncContext })` — unchanged |
| `qty_cache_missing` | `refreshEbayListingCache({ productIds: [productId], limit: 1, syncContext? })` → re-fetch candidate → push qty **only if** now `update_qty` |
| `ended_needs_relist` | **No relist** — 059D next_step |
| `unsupported_variation` | Manual only — next_step |
| `missing_mapping` | Manual — skipped + admin link |
| `no_change` | Skipped |
| available ≤ 0 | Skip all eBay channel actions |

Sequential chain: **cache refresh (if needed) → candidate re-read → qty push (if eligible)**. No parallel bulk.

---

#### Selected implementation approach for 059C.2

| Option | Summary | Verdict |
|--------|---------|---------|
| **A — Use existing cache edge as-is** | Orchestrator calls `refreshEbayListingCache({ productIds: [productId], limit: 1 })` | **✅ Recommended** |
| B — Extend cache edge with variant mode | Add `variantIds` filter / single-SKU guard | Defer unless audit finds product-only insufficient |
| C — New dedicated Adjust cache edge | Separate function for adjust flow | Rejected — unnecessary duplication |

**Recommendation: Option A (minimal extend).**

Rationale:

- `productIds` + `limit: 1` already provides single-product refresh for typical single-SKU listings.
- Qty push stays in existing `sync-ebay-inventory-quantity` (already supports `variantIds` + `syncContext`).
- **059C.2 minor additions:** optional `syncContext` on cache refresh edge for audit correlation; orchestrator helper to chain refresh → re-fetch → push; preview copy update.
- Variation groups remain `unsupported_variation` — do not call group-wide refresh from Adjust.

---

#### Safety rules (059C — mandatory)

- **One variant/listing per Adjust orchestration** — `limit: 1`, single `productIds` / `variantIds`
- **Active listings only** — ended → 059D deferral, no relist in 059C
- **No unsupported variation automation** — manual only
- **No qty 0 push to eBay** from Adjust when available ≤ 0
- **No bulk refresh/push** from Adjust modal
- **Channel actions only after successful `adjust_inventory`**
- **`adjust_inventory` remains sole stock writer** — cache refresh is read-only; qty push does not mutate KK stock
- **No browser snapshot refresh** — no `issueSnapshot` / heavy views in adjust flow
- **No `fetchChannelSyncPreview()`** in adjust flow — single-variant candidate only
- **Respect `EBAY_ENABLE_LIVE_QUANTITY_PATCH`** — preview/dry-run when gate off
- **Cache refresh failure must not attempt qty push**

---

#### Failure handling (059C)

| Scenario | Behavior |
|----------|----------|
| KK adjust succeeds, eBay cache refresh fails | Stock remains adjusted; result panel shows eBay failure separately |
| Cache refresh succeeds, candidate still not `update_qty` | Show next_step/manual (e.g. still unsupported, ended, mapping issue) — **no qty push** |
| Cache refresh ok, qty push fails | Stock remains adjusted; partial failure banner (059A) |
| Live gate off | Qty push returns 403 / preview-only; non-fatal warning, not KK failure |
| Retry | Sync Channels modal + eBay Listings admin link |
| Rollback | **Never** — no stock rollback on channel failure |

---

#### Verification plan — 059C.2 through 059C.5

| Subphase | Script |
|----------|--------|
| **059C.1** | `scripts/verify-inventory-phase059c1-ebay-active-audit.mjs` |
| **059C.2** | `scripts/verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs` |
| **059C.3** | `scripts/verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs` |
| **059C.4** | `scripts/verify-inventory-phase059c-ebay-active-sync.mjs` |
| **059C.5** | `scripts/verify-inventory-phase059c-final-freeze.mjs` |

**059C.1 verification:**

```bash
node scripts/verify-inventory-phase059c1-ebay-active-audit.mjs
```

**Files changed (059C.1):**

| File | Change |
|------|--------|
| `docs/.../059_adjust_stock_unified_channel_restock_plan.md` | This audit + contract |
| `docs/.../roadmap.md` | 059C.1 complete |
| `scripts/verify-inventory-phase059c1-ebay-active-audit.mjs` | Static verification |

**Next:** 059C.2 — single-variant cache refresh chain.

---

### 059C.2 — Single-variant cache refresh chain ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** Safe single-product cache refresh callable before qty push when `qty_cache_missing`; syncContext correlation on cache runs. ✅

**Verification:**

```bash
node scripts/verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs
```

**Result:** PASS (static + browser smoke; optional API skipped without env)

---

#### Cache refresh chain contract

**Edge request** (`sync-ebay-listing-inventory-cache`):

```json
{
  "productIds": ["product-uuid"],
  "limit": 1,
  "syncContext": {
    "trigger_source": "manual_adjust",
    "trigger_reference_type": "stock_ledger",
    "trigger_reference_id": "uuid",
    "stock_ledger_id": "uuid",
    "orchestration_id": "uuid"
  }
}
```

| Field | Behavior |
|-------|----------|
| `productIds` | Optional; when set filters products; Adjust-chain uses exactly one id |
| `limit` | Default 25, max 50; Adjust-chain uses `1` |
| `syncContext` | Optional; parsed via `parseInventorySyncRunContext`; persisted on `inventory_channel_sync_runs` |

**Sync Channels (unchanged):** `refreshEbayListingCache({ limit: 25 })` — no `syncContext` required.

**Client helper:** `js/admin/inventory/services/adjustChannelEbayCache.js` → `runAdjustEbayCacheRefreshChain()`

```js
await runAdjustEbayCacheRefreshChain({
  variantId,
  productId,
  syncContext,
  candidate, // optional pre-refresh row
});
```

**Helper response:**

```js
{
  status: "success" | "failed" | "skipped",
  cacheRefresh: { status, message, runId },
  candidate,       // post-refresh row from fetchChannelSyncCandidateForVariant
  nextAction: "update_qty" | "manual" | "ended_relist" | "unsupported_variation" | "missing_mapping" | "no_change",
  message
}
```

**syncContext behavior:** ✅ **Persisted** on `inventory_channel_sync_runs` (`trigger_source`, `orchestration_id`, etc.) when provided; also **echoed** in edge JSON response.

**Safety (059C.2):**

- Single product id only in helper (no multi-product Adjust use)
- Skips refresh when pre-candidate is `ended_needs_relist` or `unsupported_variation`
- No qty push, no stock mutation, no orchestrator wiring
- Cache refresh failure → `status: failed`, `nextAction: manual`

**Optional API test:**

```bash
TEST_EBAY_CACHE_PRODUCT_ID=<uuid> node scripts/verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs
```

Optional `TEST_EBAY_CACHE_VARIANT_ID` for future helper integration tests in 059C.4.

**Files created/changed:**

| File | Change |
|------|--------|
| `js/admin/inventory/services/adjustChannelEbayCache.js` | **NEW** — refresh + candidate re-read chain |
| `supabase/functions/sync-ebay-listing-inventory-cache/index.ts` | Optional `syncContext` + correlation on sync run |
| `js/admin/inventory/api/ebayCacheRefreshApi.js` | JSDoc for `syncContext` passthrough |
| `scripts/verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs` | Verification |

**Next:** 059C.3 — Adjust orchestrator eBay cache + qty integration (complete — see below).

---

### 059C.3 — Adjust orchestrator integration ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** After adjust, eBay `qty_cache_missing` runs cache refresh then qty push when refreshed candidate is `update_qty`. ✅

**Verification:**

```bash
node scripts/verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs
```

**Result:** PASS (static + regression + browser smoke)

---

#### Orchestrator eBay flow (post-adjust, sync ON, projected available > 0)

| Post-adjust `ebay_sync_action` | Behavior |
|--------------------------------|----------|
| `update_qty` | Direct `pushEbayInventoryQuantity({ variantIds: [id], limit: 1, syncContext })` — unchanged |
| `qty_cache_missing` | `runAdjustEbayCacheRefreshChain` → if refreshed `update_qty`, push qty; else next_step/manual/skipped |
| `ended_needs_relist` | 059D next_step (no relist) |
| `unsupported_variation` | Manual only |
| Other | `resolveEbayChannelStep` |

**Cache refresh → re-read → qty push:** Both steps receive the same `syncContext`. Cache failure blocks qty push. Refreshed candidate must confirm `ebay_sync_action === "update_qty"` before push.

**Result panel:** eBay card shows primary message + optional `detail` line (cache refresh sub-status).

**Preview copy:** `qty_cache_missing` → “eBay cache missing — will refresh before sync” when projected available > 0; sync toggle default includes `qty_cache_missing`.

**Files created/changed:**

| File | Change |
|------|--------|
| `js/admin/inventory/services/adjustChannelEbayBranch.js` | **NEW** — eBay update_qty + qty_cache_missing branch |
| `js/admin/inventory/services/adjustChannelOrchestrator.js` | Delegates eBay to `resolveEbayBranch` |
| `js/admin/inventory/services/adjustChannelNextSteps.js` | `qty_cache_missing` returns null (orchestrator handles) |
| `js/admin/inventory/services/adjustChannelPreview.js` | Preview copy + toggle default for cache missing |
| `js/admin/inventory/renderers/renderAdjustResultPanel.js` | eBay `detail` sub-line |
| `scripts/verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs` | Verification |

**Next:** 059C.5 — 059C QA + docs freeze.

---

### 059C.4 — eBay active verification ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** Tests cover active qty push, cache missing, stale cache, live gate off; no qty 0 push to active listing. ✅

**Verification script:**

```bash
node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
```

Optional cache refresh API:

```bash
TEST_EBAY_CACHE_PRODUCT_ID=<uuid> \
TEST_EBAY_CACHE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
```

Optional qty push dry-run / live:

```bash
RUN_EBAY_ACTIVE_QTY_TEST=true \
TEST_EBAY_CACHE_PRODUCT_ID=<uuid> \
TEST_EBAY_CACHE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
```

Live qty push additionally requires `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` and `RUN_LIVE_EBAY_ACTIVE_QTY_TEST=true`.

**Result:** PASS (static + regression compose + browser smoke; optional API sections skipped unless env set)

| Check | Result |
|-------|--------|
| Static 059C active path | PASS |
| Regression (059A–C.3, issue-view, phase10y) | PASS |
| Browser smoke (qty_cache_missing preview + toggle) | PASS |
| Optional cache refresh API | Skipped unless `TEST_EBAY_CACHE_PRODUCT_ID` |
| Optional qty push test | Skipped unless `RUN_EBAY_ACTIVE_QTY_TEST=true` |
| Live eBay quantity patch | NO (unless explicit live flags) |

**Known limitations:**

- Browser smoke mocks candidate view only; does not run full orchestration against live eBay.
- Optional qty push test requires candidate `ebay_sync_action === update_qty` and positive available.
- Cache refresh API test does not invoke qty push unless qty test flags are set separately.
- Ended relist and variation automation remain deferred to 059D / manual.

**Files created/changed:**

| File | Change |
|------|--------|
| `scripts/verify-inventory-phase059c-ebay-active-sync.mjs` | **NEW** — full 059C active verification |
| `scripts/verify-inventory-phase059c1-ebay-active-audit.mjs` | Regression-safe drift checks post-059C.3 |

**Remaining for 059C.5:** None — see 059C.5 freeze section below.

**Next:** 059D.1 — eBay relist architecture audit.

---

### 059C.5 — 059C QA + freeze ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** 059C marked complete in doc + roadmap; freeze before 059D. ✅

**Verification script:** `scripts/verify-inventory-phase059c-final-freeze.mjs`

```bash
node scripts/verify-inventory-phase059c-final-freeze.mjs
```

**Composed scripts (all must PASS):**

| Script | Scope |
|--------|--------|
| `verify-inventory-phase059c1-ebay-active-audit.mjs` | Design audit + contract |
| `verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs` | Single-product cache refresh chain |
| `verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs` | Orchestrator eBay branch wiring |
| `verify-inventory-phase059c-ebay-active-sync.mjs` | Full 059C active path + browser smoke |
| `verify-inventory-phase059a-adjust-orchestration.mjs` | 059A regression |
| `verify-inventory-phase059b-final-freeze.mjs` | 059B frozen regression |
| `verify-inventory-issue-view-safety.mjs` | Pool-safe issues |
| `verify-inventory-phase10y-final-stabilization.mjs` | Pre-059 freeze |

**Result:** PASS (static + composed scripts; optional API/live skipped without env)

---

#### 059C major phase summary

From **Inventory → Adjust**, when sync toggle is ON and projected available > 0:

| Post-adjust `ebay_sync_action` | Behavior |
|--------------------------------|----------|
| `update_qty` | Direct `pushEbayInventoryQuantity({ variantIds: [id], limit: 1, syncContext })` |
| `qty_cache_missing` | `runAdjustEbayCacheRefreshChain` → re-read candidate → push qty **only** if refreshed `update_qty` |
| `ended_needs_relist` | 059D next-step — no auto-relist |
| `unsupported_variation` | Manual only |
| Other | `resolveEbayChannelStep` (skipped / next_step) |

**Cache refresh → re-read → qty push:** Both steps share the same `syncContext`. Cache failure blocks qty push.

**Files created/changed across 059C:**

| Subphase | Key files |
|----------|-----------|
| **059C.1** | Plan audit sections; `verify-inventory-phase059c1-ebay-active-audit.mjs` |
| **059C.2** | `adjustChannelEbayCache.js`; cache edge `syncContext`; `verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs` |
| **059C.3** | `adjustChannelEbayBranch.js`; orchestrator delegation; preview/result panel; `verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs` |
| **059C.4** | `verify-inventory-phase059c-ebay-active-sync.mjs` |
| **059C.5** | `verify-inventory-phase059c-final-freeze.mjs`; doc + roadmap freeze |

**Known limitations (frozen):**

| Limitation | Deferred to |
|------------|-------------|
| eBay ended listing auto-relist | **059D** |
| eBay variation group automation | Manual / deferred |
| Qty-0 eBay push from Adjust | Not supported |
| Down-adjust / marketplace deactivation on qty 0 | Outside Phase 059 scope |
| Bulk eBay cache refresh from Adjust | Sync Channels only (unchanged) |
| Browser snapshot / heavy dashboard reads | Out of scope |

**No Amazon runtime changes in 059C.** `adjust_inventory` remains the only stock writer.

---

#### Optional controlled test commands

**Cache refresh API** (read-only eBay fetch + DB cache upsert):

```bash
TEST_EBAY_CACHE_PRODUCT_ID=<uuid> \
TEST_EBAY_CACHE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
```

Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

**Qty push dry-run / preview** (no live patch unless flags set):

```bash
RUN_EBAY_ACTIVE_QTY_TEST=true \
TEST_EBAY_CACHE_PRODUCT_ID=<uuid> \
TEST_EBAY_CACHE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
```

**Live eBay quantity push** (explicit opt-in only):

```bash
RUN_EBAY_ACTIVE_QTY_TEST=true \
RUN_LIVE_EBAY_ACTIVE_QTY_TEST=true \
EBAY_ENABLE_LIVE_QUANTITY_PATCH=true \
TEST_EBAY_CACHE_PRODUCT_ID=<uuid> \
TEST_EBAY_CACHE_VARIANT_ID=<uuid> \
node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
```

**Warnings:**

- One variant only (`limit: 1`)
- Active listing only — candidate must be `update_qty`
- Target available qty must be positive
- Do not run on ended listings or unsupported variation groups
- Do not run repeatedly in production

---

#### 059C production deployment checklist

| Step | Action |
|------|--------|
| 1 | Deploy `sync-ebay-listing-inventory-cache` (059C.2 `syncContext` support) if not already on production |
| 2 | Deploy `sync-ebay-inventory-quantity` only if production lacks 059A correlation (`syncContext` on sync runs) |
| 3 | Confirm `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` on Supabase **before** live eBay qty push from Adjust |
| 4 | Smoke: Adjust modal → channel preview → sync toggle → result panel (no console errors) |
| 5 | Smoke: `qty_cache_missing` preview shows “will refresh before sync” when projected available > 0 |
| 6 | Optional: one-product cache refresh via `TEST_EBAY_CACHE_PRODUCT_ID` |
| 7 | Optional: one live qty push test when ready (see warnings above) |

**No eBay relist deploys required for 059C.**

**Next:** 059D.2 — Relist edge function.

---

## 059D — eBay Ended Single-SKU Auto-Relist

**Purpose:** Automate eBay ended-listing restock for **safe single-SKU listings only**.

**Major phase complete when:** 059D.5 verification passes.

---

### 059D.1 — eBay relist architecture audit ✅

**Status:** Complete (2026-06-09) — **design/audit only; no runtime changes**

**Completion criteria:** `ebay-manage-listing` create/publish flow documented; product metadata inventory listed; variation groups explicitly excluded. ✅

**Verification:**

```bash
node scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs
```

**Result:** PASS (static — doc + no 059D runtime drift + 059C freeze regression)

**No runtime files changed** in 059D.1.

---

#### Audit findings — eBay publish path (`ebay-manage-listing`)

**Edge:** `supabase/functions/ebay-manage-listing/index.ts`  
**Client UI:** `pages/admin/ebay-listings.html` + `js/admin/ebayListings/pushModal.js`  
**Client API:** `js/admin/ebayListings/api.js` → `callEdge("ebay-manage-listing", body)`

**Auth:** Admin session (`is_admin` RPC) or service role. No dedicated publish live gate exists today — publish is always live when invoked.

**Actions relevant to 059D single-SKU relist:**

| Action | Purpose | 059D use |
|--------|---------|----------|
| `create_item` | PUT inventory item | ✅ Step 1 — new item for relist |
| `create_offer` | POST offer | ✅ Step 2 — new offer |
| `publish` | POST offer publish | ✅ Step 3 — new listing ID |
| `get_item` | GET inventory item | Optional — recover aspects/description from prior SKU |
| `update_item` / `update_offer` | Patch existing | ❌ Not relist — ended listing needs new publish |
| `publish_group` / `create_item_group` / `create_group_offer` | Variation groups | ❌ Out of scope for 059D |
| `withdraw` / `delete_item` | End/cleanup | ❌ Not auto-called from Adjust relist |

**Other actions exist** (reconcile, policies, webhooks, volume discount) — not part of minimal relist chain.

---

##### `create_item` contract

```json
{
  "action": "create_item",
  "sku": "<ebay_sku or product.code>",
  "product": {
    "title": "...",
    "description": "...",
    "imageUrls": ["https://..."],
    "aspects": { "Brand": ["..."], ... },
    "condition": "NEW",
    "quantity": 1,
    "lotSize": 1
  },
  "packageWeightAndSize": { "weight": { "value": "4.0", "unit": "OUNCE" }, ... }
}
```

| Field source (Push modal today) | KK source for 059D auto-relist |
|---------------------------------|--------------------------------|
| `sku` | `products.ebay_sku` or `products.code` |
| `title` | `products.name` |
| `description` | Product description if stored; else `wrapDescription(title, …)` template; optional `get_item` fallback |
| `imageUrls` | `buildImageUrls(product)` — catalog_image_url, primary_image_url, gallery (max 24) |
| `aspects` | **Gap:** collected from taxonomy UI at push time — not on `products` row. 059D.2 should prefer `get_item` on prior SKU or cache `raw_payload_json` fallback |
| `condition` | Default `NEW` (Push modal default) |
| `quantity` | Post-adjust available qty (must be > 0) |
| `packageWeightAndSize` | `products.weight_g` → ounces (Push modal formula) |

**DB reconciliation after `create_item`:** `products` updated where `code = sku` → `ebay_sku = sku`, `ebay_status = 'draft'` (create only; never downgrades active).

---

##### `create_offer` contract

```json
{
  "action": "create_offer",
  "sku": "...",
  "categoryId": "12345",
  "priceCents": 1999,
  "quantity": 5,
  "policies": {
    "fulfillmentPolicyId": "...",
    "returnPolicyId": "...",
    "paymentPolicyId": "..."
  },
  "bestOfferTerms": { "bestOfferEnabled": false },
  "storeCategoryNames": []
}
```

| Field | Source |
|-------|--------|
| `categoryId` | `products.ebay_category_id` (required) |
| `priceCents` | `products.ebay_price_cents` or `round(products.price * 100)` |
| `quantity` | Relist target qty (available after adjust) |
| `policies` | Env defaults: `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`; or stored policy IDs from Push modal cache |
| `merchantLocationKey` | Env `EBAY_LOCATION_KEY` (default `default`) — set server-side |

**DB reconciliation:** `ebay_offer_id`, `ebay_category_id`, `ebay_price_cents` on `products` where `code = sku`.

**Duplicate offer (25002):** Edge reuses existing offerId and syncs price.

---

##### `publish` contract

```json
{
  "action": "publish",
  "offerId": "...",
  "sku": "...",
  "categoryId": "12345",
  "priceCents": 1999,
  "quantity": 5
}
```

**Pre-publish checks:** price sync, quantity > 0, required aspects on inventory item. Retries on eBay 25604 eventual-consistency.

**DB reconciliation on success:**

```sql
UPDATE products SET
  ebay_listing_id = <new listingId>,
  ebay_status = 'active',
  ebay_category_id = ...,
  ebay_price_cents = ...
WHERE code = sku;
```

**Critical 059D rule:** Do **not** assume old `ebay_listing_id` becomes active. Publish returns a **new** `listingId`; reconcile new IDs. Old ended listing ID remains for audit (`old_ebay_listing_id` in relist view).

**Errors:** Structured failures (`PUBLISH_QUANTITY_REQUIRED`, `PUBLISH_ASPECTS_REQUIRED`, `PUBLISH_PRICE_SYNC_FAILED`) with message + details JSON.

---

#### Audit findings — Relist Assist (Phase 7E)

**View:** `v_inventory_ebay_relist_candidates` (`20260907_inventory_phase7e_ebay_relist_assist.sql`)  
**UI:** `js/admin/inventory/ui/syncEbayRelistAssist.js`  
**API:** `js/admin/inventory/api/ebayRelistAssistApi.js`  
**Audit table:** `ebay_relist_assist_actions`

**Source filter:** `ebay_sync_action = 'ended_needs_relist'` from channel sync candidates.

**Why ended:** Cache/local status ∈ `ended`, `out_of_stock` (view); product had mapped offer/listing that eBay ended.

**`relist_action` classification (priority order):**

| Action | Condition |
|--------|-----------|
| `unsupported_variation` | `product_active_variant_count > 1` AND `ebay_item_group_key IS NOT NULL` |
| `no_available_stock` | `available_qty <= 0` |
| `needs_mapping` | `missing_mapping` or offer without listing ID |
| `missing_required_listing_data` | missing `ebay_category_id`, `ebay_price_cents <= 0`, or SKU |
| `ready_to_relist` | available > 0, single-SKU (no group or ≤1 active variant), category + price + SKU present |
| `manual_review` | fallback |

**`required_fields_missing` array:** `ebay_category_id`, `ebay_price_cents`, `ebay_sku`.

**Available from old listing/cache:**

| Data | Source |
|------|--------|
| Old listing/offer IDs | `products.ebay_listing_id`, `ebay_offer_id` |
| Old status | `ebay_listing_status` / cache `listing_status` |
| Cache qty snapshot | `ebay_listing_inventory_cache` via sync view |
| `raw_payload_json` | offerId, quantities — optional fallback for 059D.2 |
| Public/Sell Similar URLs | `ebaySellSimilarUrl(old_ebay_listing_id)` |

**Current actions (manual only):**

- **eBay Admin** — Sell Similar / Seller Hub (audit log `opened_admin`)
- **KK Listings** — `ebay-listings.html?relist={code}` opens Push modal path (`draft_created` log only — no auto publish)
- **Mark Review** — `ebay_relist_assist_actions` insert

**Adjust orchestrator today:** `ended_needs_relist` → `next_step` with 059D copy; **no relist edge call**.

---

#### “Same details” source of truth (059D auto-relist)

Recreate listing from **KK stored product data**, matching Push modal defaults:

| Listing field | Primary source | Optional fallback |
|---------------|----------------|-------------------|
| Title | `products.name` | Cache/`get_item` if product name empty |
| Description | Product HTML/description field | `get_item` on prior `ebay_sku`; `wrapDescription` template |
| SKU | `products.ebay_sku` or `products.code` | — |
| Price | `products.ebay_price_cents` or `products.price` | — |
| Category | `products.ebay_category_id` | Required — block if missing |
| Aspects | **Not on product row** | `get_item(sku)` or cache payload; 059D.2 must resolve |
| Images | Gallery + catalog URLs (`buildImageUrls`) | Cache image URLs if product gallery empty |
| Condition | `NEW` default | Prior item condition via `get_item` |
| Weight/dimensions | `products.weight_g` | Prior `packageWeightAndSize` via `get_item` |
| Policies | Env policy IDs (same as edge defaults) | — |
| Quantity | Post-adjust available (orchestrator input) | Must be > 0 |

**Do not** reactivate old listing ID. Flow: create → offer → publish → reconcile **new** `ebay_listing_id` / `ebay_offer_id`.

---

#### 059D auto-relist eligibility (059D.2 preconditions)

**Eligible when ALL:**

- Post-adjust `ebay_sync_action === 'ended_needs_relist'`
- Relist candidate `relist_action === 'ready_to_relist'`
- Sync toggle ON + admin confirmed Adjust submit
- Projected available qty > 0
- Single-SKU / non-variation (`ebay_item_group_key IS NULL` or `product_active_variant_count <= 1`)
- `products.ebay_category_id` present
- `products.ebay_price_cents > 0` (or convertible price)
- SKU present (`ebay_sku` or `code`)
- Required aspects resolvable (059D.2 validation)
- Images resolvable (≥1 URL)
- One variant / one product per orchestration

**Not eligible → skipped / manual / next_step:**

- Variation groups / shared SKU multi-variant
- `unsupported_variation`, `needs_mapping`, `missing_required_listing_data`, `no_available_stock`, `manual_review`
- qty ≤ 0
- Missing category, price, images, policies, SKU, or aspects
- Live gate off → preview/dry-run only (no publish)

---

#### 059D.2 edge contract — `relist-ebay-from-product` (design only)

**Not implemented in 059D.1.**

```ts
{
  productId: string;
  variantId: string;
  quantity: number;
  syncContext?: {
    trigger_source?: string;
    trigger_reference_type?: string;
    trigger_reference_id?: string;
    stock_ledger_id?: string;
    orchestration_id?: string;
  };
  preview?: boolean;
}
```

**Expected steps (059D.2):**

1. Validate admin/auth
2. Load product + relist candidate; enforce eligibility
3. Validate metadata (category, price, SKU, images, aspects)
4. If `preview === true` or live gate off → dry-run response (no eBay writes)
5. `create_item` (reuse ebay-manage-listing logic or internal helpers)
6. `create_offer`
7. `publish`
8. Reconcile new listing/offer IDs on `products`; log `inventory_channel_sync_runs` with `syncContext`
9. Return panel-friendly `{ status, message, listingId, offerId, runId, preview }`

**Implementation note:** Prefer extracting shared publish helpers from `ebay-manage-listing` rather than duplicating eBay API calls.

---

#### Live gate recommendation

| Gate | Used for | Exists today? |
|------|----------|---------------|
| `EBAY_ENABLE_LIVE_QUANTITY_PATCH` | Qty push (`sync-ebay-inventory-quantity`) | ✅ |
| `EBAY_ENABLE_LIVE_RELIST` | Publish new listing from Adjust | ❌ **Recommend for 059D.2** |

**Recommendation:** Add dedicated **`EBAY_ENABLE_LIVE_RELIST=true`** for publish/relist. Publishing a listing is higher risk than quantity patch. When gate off, edge returns preview/dry-run (same pattern as Amazon inactive + eBay qty push).

Do **not** reuse `EBAY_ENABLE_LIVE_QUANTITY_PATCH` for relist — separate concerns.

---

#### Safety rules (059D — mandatory)

- One variant / one product per Adjust orchestration
- Single-SKU only — reject variation groups
- No bulk relist from Adjust or Sync Channels
- Quantity must be > 0 — never publish qty 0
- **No stock mutation** — `adjust_inventory` only stock writer
- Channel relist only after successful adjust + sync toggle ON
- No DB transaction wrapping external eBay API calls
- KK stock never rolled back on relist failure
- Relist failure shown separately in result panel (partial success pattern)
- New listing IDs reconciled atomically on success only
- No browser snapshot refresh; no heavy issue/dashboard reads
- Old ended listing ID preserved for audit; do not delete ended listing on eBay automatically

---

#### Failure handling (059D target)

| Result status | Meaning |
|---------------|---------|
| `success` | New listing published; IDs reconciled |
| `dry_run` | Preview only — live gate off or `preview: true` |
| `failed` | Relist failed; KK stock remains adjusted |
| `skipped` | Candidate not eligible |
| `manual` | Variation/metadata issue — use Relist Assist |

**Retry paths:** eBay Relist Assist · eBay Listings admin Push modal · Sync Channels

---

#### Verification plan — 059D.2 through 059D.5

| Subphase | Script |
|----------|--------|
| **059D.1** | `scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs` |
| **059D.2** | `scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs` |
| **059D.3** | `scripts/verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs` |
| **059D.4** | `scripts/verify-inventory-phase059d-ebay-auto-relist.mjs` |
| **059D.5** | `scripts/verify-inventory-phase059d-final-freeze.mjs` |

**059D.1 verification:**

```bash
node scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs
```

**Files changed (059D.1):**

| File | Change |
|------|--------|
| `docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md` | This audit + contract |
| `docs/pages/admin/inventory/implementation/roadmap.md` | 059D.1 complete |
| `scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs` | Static verification |

**Next:** 059D.3 — Adjust orchestrator relist integration.

---

### 059D.2 — Relist edge function ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** `relist-ebay-from-product` edge function implemented; preconditions enforced; DB reconciliation on success; no orchestrator wiring. ✅

**Verification:**

```bash
node scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs
```

Optional dry-run API:

```bash
TEST_EBAY_RELIST_PRODUCT_ID=<uuid> \
TEST_EBAY_RELIST_VARIANT_ID=<uuid> \
TEST_EBAY_RELIST_QTY=1 \
node scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs
```

**Result:** PASS (static + 059D.1 regression; optional API skipped unless env set)

---

#### Edge contract — `relist-ebay-from-product`

**Request:**

```json
{
  "productId": "<uuid>",
  "variantId": "<uuid>",
  "quantity": 5,
  "preview": true,
  "syncContext": {
    "trigger_source": "manual_adjust",
    "trigger_reference_type": "stock_ledger",
    "orchestration_id": "..."
  }
}
```

**Response:** `{ status, mode: "ebay_relist_from_product", productId, variantId, quantity, listingId?, offerId?, sellerSku?, runId?, message, errors?, warnings?, syncContext? }`

**Status values:** `success` | `failed` | `skipped` | `manual` | `dry_run`

---

#### Eligibility validation

Loads `v_inventory_ebay_relist_candidates` + confirms `v_inventory_channel_sync_candidates.ebay_sync_action === ended_needs_relist`.

| Check | Outcome |
|-------|---------|
| `relist_action === ready_to_relist` | Required for live/preview proceed |
| `available_qty > 0` and request `quantity > 0` | Required |
| Variation group / `unsupported_variation` | `manual` |
| Missing category, price, SKU, title, images | `manual` |
| Not ended / no candidate | `skipped` |

---

#### Live gate — `EBAY_ENABLE_LIVE_RELIST=true`

| Condition | Behavior |
|-----------|----------|
| `preview: true` | `dry_run` — no eBay API publish |
| Gate off | `dry_run` — validates candidate + metadata only |
| Gate on + `preview: false` | Live create item → offer → publish |

Dry-run returns intended SKU, title, category, price, quantity summary in `warnings`.

---

#### Metadata / aspects strategy

Primary source: KK `products` row (title, description, price, category, images via gallery URLs, weight).

Aspects: attempt `GET inventory_item` on prior SKU; apply `normalizeProductAspects` defaults (Brand, Type, Department). If publish fails with missing specifics → `manual` with “Open eBay Listings / Relist Assist.”

---

#### Publish chain + reconciliation

1. `createEbayInventoryItem`
2. `createEbayOffer` (env policy IDs)
3. `publishEbayOffer`
4. Update `products` by `id`: new `ebay_listing_id`, `ebay_offer_id`, `ebay_status=active`

Old ended listing ID is **not** reactivated; warning when new ID differs from `old_ebay_listing_id`.

Reconciliation failure after publish → `failed` with listing/offer IDs in response.

---

#### Audit / correlation

Uses `inventory_channel_sync_runs` (`channel: ebay`, mode `dry_run`|`push`) + `inventory_channel_sync_results` (`action: relist_from_product`).

Honors `syncContext`: `trigger_source`, `trigger_reference_type`, `stock_ledger_id`, `orchestration_id`.

---

#### Files created/changed

| File | Change |
|------|--------|
| `supabase/functions/relist-ebay-from-product/index.ts` | **NEW** — edge entry |
| `supabase/functions/_shared/ebayRelistFromProduct.ts` | **NEW** — handler |
| `supabase/functions/_shared/ebayRelistCandidateLoaders.ts` | **NEW** — candidate/product loaders |
| `supabase/functions/_shared/ebayListingPublishUtils.ts` | **NEW** — single-SKU publish helpers |
| `scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs` | **NEW** — verification |
| `scripts/verify-inventory-phase059c-final-freeze.mjs` | Allow relist edge when 059D.2 complete (059C frozen regression) |
| `scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs` | Post-059D.2 regression allowances |

**Not changed:** Adjust orchestrator, eBay branch, Amazon paths.

---

#### Known limitations

- Aspects may require manual completion for category-specific required fields.
- No orchestrator integration yet (059D.3).
- No live publish test in verify script by default.
- Variation groups permanently excluded.

**Remaining for 059D.3:** Wire `relist-ebay-from-product` into Adjust orchestrator when `ended_needs_relist` + `ready_to_relist`.

**Next:** 059D.3 — Adjust orchestrator integration.

---

### 059D.3 — Adjust orchestrator integration ✅

**Status:** Complete (2026-06-09)

**Completion criteria:** Orchestrator calls relist edge when `ended_needs_relist` + sync toggle on + projected available > 0; preview/result panel updated. ✅

**Verification:**

```bash
node scripts/verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs
```

**Result:** PASS (static + fast regressions; deep 059C freeze skipped unless `RUN_DEEP_059C_FREEZE=1`)

---

#### Orchestrator behavior — `ended_needs_relist`

After successful `adjust_inventory`, when sync toggle is ON and projected available > 0:

1. Post-adjust candidate loaded via `fetchChannelSyncCandidateForVariant`
2. `resolveEbayBranch` → `runEbayEndedRelist` when `ebay_sync_action === ended_needs_relist`
3. Cache-missing chain: if refresh resolves to `ended_needs_relist`, same relist path runs
4. Edge owns final eligibility; client maps `success` | `dry_run` | `manual` | `skipped` | `failed`

Direct `update_qty`, `qty_cache_missing` chain, `unsupported_variation` manual, qty ≤ 0 skip — unchanged.

---

#### Relist API wrapper — `ebayRelistFromProductApi.js`

```js
relistEbayFromProduct({ productId, variantId, quantity, preview: false, syncContext })
```

Invokes `relist-ebay-from-product` with admin session token. Validates UUIDs and positive quantity.

---

#### Result panel / preview

| Edge status | User message |
|-------------|--------------|
| `success` | eBay listing relisted successfully. |
| `dry_run` | eBay relist previewed; live relist is disabled. |
| `manual` | eBay relist requires manual review. |
| `skipped` | eBay relist skipped. |
| `failed` | eBay relist failed. Stock remains adjusted. |

Listing/offer IDs shown in eBay card detail when returned.

Preview: “eBay ended — will relist after adjust” when eligible; sync toggle defaults ON for `ready_to_relist`.

---

#### Live gate / dry-run

Live publish only when `EBAY_ENABLE_LIVE_RELIST=true` on edge. Gate off → `dry_run` (warning, not KK failure).

---

#### Audit / correlation

Same `syncContext` as Amazon/eBay qty sync: `manual_adjust`, `stock_ledger`, `orchestration_id`.

---

#### Files created/changed

| File | Change |
|------|--------|
| `js/admin/inventory/api/ebayRelistFromProductApi.js` | **NEW** — edge client |
| `js/admin/inventory/services/adjustChannelEbayBranch.js` | `runEbayEndedRelist` + branch wiring |
| `js/admin/inventory/services/adjustChannelPreview.js` | Ended relist preview + toggle default |
| `js/admin/inventory/services/adjustChannelNextSteps.js` | `ended_needs_relist` → null (branch-owned) |
| `js/admin/inventory/renderers/renderAdjustResultPanel.js` | Relist status + listing/offer IDs |
| `scripts/verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs` | **NEW** |
| `scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs` | Post-059D.3 allowances |
| `scripts/verify-inventory-phase059c-final-freeze.mjs` | Allow 059D.3 relist wiring |
| `scripts/verify-inventory-phase059c-ebay-active-sync.mjs` | Allow 059D.3 relist wiring |
| `scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs` | Edge-only scope (orchestrator checks moved to D.3) |

**Not changed:** Amazon paths, stock writers, Relist Assist (assist-only links).

**Remaining:** 059D.4 — full relist verification matrix.

**Next:** 059D.4 — eBay relist verification.

---

### 059D.4 — eBay relist verification ✅

**Status:** Complete (2026-06-09)

**Verification script:** `scripts/verify-inventory-phase059d-ebay-auto-relist.mjs`

```bash
node scripts/verify-inventory-phase059d-ebay-auto-relist.mjs
```

Optional dry-run API:

```bash
TEST_EBAY_RELIST_PRODUCT_ID=<uuid> \
TEST_EBAY_RELIST_VARIANT_ID=<uuid> \
TEST_EBAY_RELIST_QTY=1 \
node scripts/verify-inventory-phase059d-ebay-auto-relist.mjs
```

Optional live publish (all flags required):

```bash
RUN_LIVE_EBAY_RELIST_TEST=true \
EBAY_ENABLE_LIVE_RELIST=true \
TEST_EBAY_RELIST_*=... \
node scripts/verify-inventory-phase059d-ebay-auto-relist.mjs
```

**Result:** PASS

---

#### Static matrix (edge 15/15, orchestrator 13/13)

| Path | Validated |
|------|-----------|
| Success | create item → offer → publish → reconcile; sync run logging |
| Gate-off dry_run | `EBAY_ENABLE_LIVE_RELIST` not true → no publish |
| Preview dry_run | `preview: true` → no publish |
| Manual | missing metadata/aspects, unsupported variation |
| Skipped | qty ≤ 0, not ready, not ended |
| Failed | API failure; reconcile failure with publish-succeeded warning |
| Orchestrator | ended→relist; update_qty/cache unchanged; after adjust only |

#### Browser smoke

- Inventory + adjust modal load
- Mocked `ended_needs_relist` + `ready_to_relist`: “will relist after adjust” preview
- Sync toggle ON when projected available > 0
- Result panel renders success (listing/offer IDs), dry_run, manual, skipped, failed
- No significant console errors

#### Optional API

- Dry-run: skipped (no `TEST_EBAY_RELIST_*` env)
- Live publish: **not attempted**

#### Regression (fast mode)

- 059D.2, 059D.3, 059D.1 (VERIFY_FAST), 059B freeze, issue-view-safety, phase10y — PASS
- Deep 059C freeze skipped unless `RUN_DEEP_059C_FREEZE=1`

#### Files created/changed

| File | Change |
|------|--------|
| `scripts/verify-inventory-phase059d-ebay-auto-relist.mjs` | **NEW** — full matrix |
| `scripts/verify-inventory-phase059a2-adjust-channel-preview.mjs` | Post-059D.3 preview copy |
| `scripts/verify-inventory-phase059a3-adjust-orchestrator.mjs` | Post-059D.3 ended relist wiring |

#### Known limitations

- Live publish test requires explicit flags + test product on edge
- Aspects may still require manual completion for some categories
- Deep 059C compose not run by default (fast boundary checks)

**Remaining:** 059D.5 — 059D QA + docs freeze.

**Next:** 059D.5.

---

### 059D.5 — eBay ended relist QA freeze ✅

**Status:** Complete (2026-06-09) — **059D major phase complete (frozen)**

**Verification:**

```bash
node scripts/verify-inventory-phase059d-final-freeze.mjs
```

**Result:** PASS (~4 min; composed 059D.1–D.4 + 059B/issue-view/phase10y; deep 059C optional)

---

#### Final 059D summary

Single-SKU ended eBay listings can be relisted from Adjust when sync toggle is ON, post-adjust available qty > 0, and candidate is `ended_needs_relist` + `ready_to_relist`. Edge validates metadata/aspects; live publish requires `EBAY_ENABLE_LIVE_RELIST=true`. KK stock is never rolled back on channel failure.

| Subphase | Deliverable |
|----------|-------------|
| D.1 | Architecture audit + edge contract |
| D.2 | `relist-ebay-from-product` edge + publish helpers |
| D.3 | `ebayRelistFromProductApi.js` + orchestrator branch |
| D.4 | Full verification matrix + browser smoke |
| D.5 | QA freeze + deployment checklist |

#### Files across 059D

| File | Phase |
|------|-------|
| `supabase/functions/relist-ebay-from-product/index.ts` | D.2 |
| `supabase/functions/_shared/ebayRelistFromProduct.ts` | D.2 |
| `supabase/functions/_shared/ebayRelistCandidateLoaders.ts` | D.2 |
| `supabase/functions/_shared/ebayListingPublishUtils.ts` | D.2 |
| `js/admin/inventory/api/ebayRelistFromProductApi.js` | D.3 |
| `js/admin/inventory/services/adjustChannelEbayBranch.js` | D.3 |
| `js/admin/inventory/services/adjustChannelPreview.js` | D.3 |
| `js/admin/inventory/services/adjustChannelNextSteps.js` | D.3 |
| `js/admin/inventory/renderers/renderAdjustResultPanel.js` | D.3 |
| `scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs` | D.1 |
| `scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs` | D.2 |
| `scripts/verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs` | D.3 |
| `scripts/verify-inventory-phase059d-ebay-auto-relist.mjs` | D.4 |
| `scripts/verify-inventory-phase059d-final-freeze.mjs` | D.5 |
| `scripts/verify-inventory-phase059d1-ebay-relist-audit.mjs` | D.5 roadmap check post-freeze |
| `scripts/lib/verifyFastMode.mjs` | D.2 verify fix |

#### Optional test commands

Dry-run (preview only — no live publish):

```bash
TEST_EBAY_RELIST_PRODUCT_ID=<uuid> \
TEST_EBAY_RELIST_VARIANT_ID=<uuid> \
TEST_EBAY_RELIST_QTY=1 \
node scripts/verify-inventory-phase059d-ebay-auto-relist.mjs
```

Live publish (**all flags required** — creates real eBay listing):

```bash
RUN_LIVE_EBAY_RELIST_TEST=true \
EBAY_ENABLE_LIVE_RELIST=true \
TEST_EBAY_RELIST_PRODUCT_ID=<uuid> \
TEST_EBAY_RELIST_VARIANT_ID=<uuid> \
TEST_EBAY_RELIST_QTY=1 \
node scripts/verify-inventory-phase059d-ebay-auto-relist.mjs
```

Warnings for live test:

- One test variant only; single-SKU only; `ready_to_relist` only
- Qty must be positive; verify title/images/category/price/aspects first
- Do not run repeatedly; live publish creates a real listing

#### Production deployment checklist

1. Deploy `relist-ebay-from-product` edge function
2. Deploy shared helpers: `ebayRelistFromProduct.ts`, `ebayRelistCandidateLoaders.ts`, `ebayListingPublishUtils.ts`
3. Deploy admin JS: `ebayRelistFromProductApi.js`, updated eBay branch/preview/result panel
4. Confirm eBay OAuth credentials/secrets available on Supabase
5. Leave `EBAY_ENABLE_LIVE_RELIST` unset/false until ready; gate-off returns `dry_run`
6. Set `EBAY_ENABLE_LIVE_RELIST=true` only after dry-run smoke on test product
7. Smoke Adjust modal: ended preview copy, sync toggle, result panel dry_run, Relist Assist link
8. Run optional dry-run API test before any live relist
9. Run at most one live relist after manual review

#### Limitations (frozen scope)

- Variation groups: manual / Relist Assist only
- Shared SKU / multi-color: deferred / manual
- Qty-0 eBay deactivation: not in 059D
- Bulk relist: not supported
- Auto-relist without admin confirmation (sync toggle): not supported
- Live publish requires explicit `EBAY_ENABLE_LIVE_RELIST=true`

**Next major phase:** **059E.1 — End-to-end integration pass** (pending).

---

### 059D.5 — 059D QA + docs (superseded by section above)

**Completion criteria:** 059D marked complete; stop before 059E. ✅

---

## 059E — Final Integration, Rollout, and Completion

**Purpose:** Finish, stabilize, freeze full Adjust → Unified Channel Restock feature.

**Major phase complete when:** 059E.5 signed off — **100% complete**.

---

### 059E.1 — End-to-end integration pass ✅

**Status:** Complete (2026-06-09)

**Verification:**

```bash
node scripts/verify-inventory-phase059e1-end-to-end-integration.mjs
```

**Result:** PASS (static matrix 8/8, browser scenarios 8/8, frozen regressions; no live calls)

---

#### Scenario matrix result

| # | Scenario | Static | Browser |
|---|----------|--------|---------|
| 1 | KK only (sync off) | ✅ | ✅ |
| 2 | Amazon active `update_qty` | ✅ | ✅ |
| 3 | Amazon inactive `inactive_restock` | ✅ | ✅ |
| 4 | eBay active `update_qty` | ✅ | ✅ |
| 5 | eBay `qty_cache_missing` → refresh → push | ✅ | ✅ |
| 6 | eBay ended `ready_to_relist` → relist dry_run | ✅ | ✅ |
| 7 | eBay unsupported variation | ✅ | ✅ |
| 8 | Channel failure after KK success | ✅ | ✅ |

#### Browser smoke

- Inventory + adjust modal; preview cards; toggle behavior
- All 8 mocked submit flows; result panel KK/Amazon/eBay; Done closes modal
- No significant console errors

#### Optional API/live

- Skipped by default (no `TEST_*` / live `RUN_*` flags in E2E.1 runner)
- Live marketplace: **not attempted**

#### Bugs found/fixed

| Issue | Fix |
|-------|-----|
| 059A verify expected pre-059D preview copy | Updated `verify-inventory-phase059a2-adjust-channel-preview.mjs` labels (059D.3+) |

No new runtime behavior added in 059E.1.

#### Remaining

None — 059E.1 complete.

---

### 059E.2 — Failure handling + rollback clarity ✅

**Completion criteria:** Partial failure messaging explicit; KK adjust never rolled back by orchestrator; retry links present; dry_run distinct from failed.

**Copy changes (059E.2):**

| Context | Message |
|---------|---------|
| KK success | KK stock was adjusted successfully. |
| Partial banner title | Stock update complete. Some marketplace actions need attention. |
| Partial banner body | Stock remains adjusted. Retry marketplace sync from the links below. |
| No rollback | Marketplace failures do not undo the stock adjustment. |
| Amazon failed | Amazon sync failed. KK stock remains adjusted. |
| Amazon dry_run | Amazon sync was previewed only. Live Amazon patching is disabled. |
| eBay qty failed | eBay quantity sync failed. KK stock remains adjusted. |
| eBay cache failed | eBay cache refresh failed. Quantity sync was not attempted. |
| eBay relist dry_run | eBay relist was previewed only. Live relist is disabled. |
| eBay relist manual | eBay relist requires manual review. |
| eBay relist failed | eBay relist failed. KK stock remains adjusted. |

**Failure handling rules:**

- If KK Adjust succeeds, stock **remains adjusted** even when Amazon/eBay fail, dry_run, or need manual review.
- No auto-rollback of KK stock in orchestrator or UI.
- Channel failures shown on separate Amazon/eBay cards from KK success card.
- Partial-success amber banner when sync was requested and any channel needs attention (`failed`, `manual`, `dry_run`, `next_step`, or non-`no_change` skip).
- Dry run uses amber/info tone — gate off, no live action; failed uses red/error tone.

**Retry / next-step links (result panel):**

| Channel state | Links |
|---------------|-------|
| Amazon failed | Retry via Sync Channels · Amazon Listings |
| Amazon dry_run | Sync Channels · Amazon Listings |
| eBay failed (qty/cache) | Retry via Sync Channels · eBay Listings |
| eBay dry_run relist | Sync Channels · eBay Relist Assist |
| eBay manual / unsupported | eBay Relist Assist · eBay Listings · Sync Channels |
| eBay ended next_step | eBay Relist Assist · Sync Channels |

**Verification:** `scripts/verify-inventory-phase059e2-failure-rollback-clarity.mjs` ✅

- Static: copy constants, no rollback, sole `adjust_inventory` writer, 059E.1 static regression
- Browser: panel render cases (failure, dry_run, manual, cache failure) + inventory/adjust modal smoke
- No live marketplace calls

**Remaining 059E work:** None — Phase 059 frozen (059E.5 complete).

---

### 059E.3 — Operator UX polish ✅

**Completion criteria:** Adjust modal, preview, toggle, and result panel are operator-friendly; toggle defaults preserved; no clutter on simple success flows.

**UX polish summary:**

| Area | Change |
|------|--------|
| Toggle label | “Sync marketplaces after stock adjustment” |
| Toggle helper | “Runs after KK stock is updated. Marketplace failures do not undo the stock adjustment.” |
| Preview section | “Marketplace preview” with KK-first copy; concise Amazon/eBay labels |
| Result panel | Status badges: “Preview only” (dry_run), “Manual review required”; link labels “Open Sync Channels” / “Open Relist Assist” |
| Accessibility | `aria-busy` on loading, `aria-describedby` on toggle, `aria-label` on result links and Done |

**Toggle default behavior (unchanged logic, documented):**

| Default ON | Default OFF |
|------------|-------------|
| projected available > 0 AND (Amazon `update_qty` / `inactive_can_update`, OR eBay `update_qty` / `qty_cache_missing`, OR eBay ended single-SKU `ready_to_relist`) | no actionable path, avail ≤ 0, unsupported variation only, mapping-only/manual-only |

Manual toggle changes are preserved (`syncToggleUserSet`) until modal close.

**10T follow-up checklist deferred:** Intentionally **deferred** — `restockFollowupChecklist.js` targets parcel restock ledger flows and would add heavy API reads; adjust result panel links cover follow-up for 059E.3. Revisit in Phase 060+ only if heavy reads can be avoided.

**Verification:** `scripts/verify-inventory-phase059e3-operator-ux-polish.mjs` ✅

**Remaining:** None — 059E.3 complete; 059E.4/059E.5 frozen.

---

### 059E.3 — Operator UX polish (original checklist)

**Completion criteria:** Manual matrix passes: KK only, Amazon active, Amazon inactive, eBay active, eBay ended eligible — all from one Adjust modal. ✅

**Verification:** `verify-inventory-phase059e1-end-to-end-integration.mjs` ✅

---

### 059E.2 — Failure handling + rollback clarity (original checklist)

**Completion criteria:** Partial failure messaging explicit; KK adjust never rolled back by orchestrator; retry links present. ✅

**Tasks:** Polish result panel copy; document “stock stays adjusted even if marketplace fails”. ✅

**Verification:** `verify-inventory-phase059e2-failure-rollback-clarity.mjs` ✅

---

### 059E.1 — End-to-end integration pass (original checklist)

**Completion criteria:** Manual matrix passes: KK only, Amazon active, Amazon inactive, eBay active, eBay ended eligible — all from one Adjust modal. ✅

**Verification:** `verify-inventory-phase059e1-end-to-end-integration.mjs` ✅

---

### 059E.4 — Production verification ✅

**Completion criteria:** `scripts/verify-inventory-phase059-final.mjs` passes; pool-safety checks pass; deployment checklist documented. ✅

**Official verification script:** `scripts/verify-inventory-phase059-final.mjs`

**Production verification results (2026-06-09):**

| Section | Result |
|---------|--------|
| Production static checks | ✅ PASS |
| 059E.1 E2E integration | ✅ PASS |
| 059E.2 failure/rollback clarity | ✅ PASS |
| 059E.3 operator UX polish | ✅ PASS |
| 059A orchestration | ✅ PASS |
| 059B freeze | ✅ PASS |
| 059C fast boundary + C.1 audit | ✅ PASS |
| 059D freeze | ✅ PASS |
| issue-view-safety | ✅ PASS |
| phase10y pool safety | ✅ PASS |
| Deep 059C freeze | ○ Skipped (default fast mode) |
| Optional live marketplace | ○ Skipped (no `RUN_LIVE_*` flags) |
| **Overall** | **✅ PASS** |

**Live marketplace calls during verification:** **NO**

**Fast mode (default):** `VERIFY_FAST=1`, `VERIFY_SKIP_DEEP_REGRESSION=1`

**Deep optional mode:** `RUN_DEEP_059_FINAL=1`, `RUN_DEEP_059C_FREEZE=1` — not run by default.

**Static production checks verified:**

- Strict 5×5 structure in docs; 059A–059D frozen; 059E.1–059E.3 complete
- `adjust_inventory` sole stock writer; channel actions after adjust only
- Sync toggle / admin confirmation required; no auto marketplace sync
- No stock rollback; no browser snapshot refresh; no full `fetchChannelSyncPreview()` in adjust flow
- No heavy issue/dashboard/returns reads in adjust flow
- No qty-0 eBay push/relist from Adjust; eBay variation groups manual/deferred
- Live gates: `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_QUANTITY_PATCH`, `EBAY_ENABLE_LIVE_RELIST`
- Admin JS under 500 lines (Amazon edge `sync-amazon-inventory-quantity/index.ts` at 516 lines — pre-existing)

**Browser production smoke (mocked):** Inventory page loads; Adjust modal; preview cards; sync toggle defaults; result panel; KK-only; Amazon inactive dry_run; eBay cache-missing; eBay relist dry_run; partial failure; Done closes modal; no significant console errors.

**Production deployment checklist:**

1. Apply migration: `supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql`
2. Deploy edge functions: `sync-amazon-inventory-quantity`, `sync-ebay-inventory-quantity`, `sync-ebay-listing-inventory-cache`, `relist-ebay-from-product`
3. Deploy shared edge helpers: `inventoryAmazonInactiveRestock.ts`, `amazonOfferRestoreUtils.ts`, `inventoryEbaySyncUtils.ts`, `ebayRelistFromProduct.ts`, `ebayRelistCandidateLoaders.ts`, `ebayListingPublishUtils.ts`
4. Deploy admin JS/static bundle (adjust modal, orchestrator, result panel, APIs)
5. Confirm Supabase secrets: Amazon + eBay OAuth/credentials (existing sync/relist)
6. Set live gates in production when ready: `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_QUANTITY_PATCH`, `EBAY_ENABLE_LIVE_RELIST`
7. Run `verify-inventory-phase10y-final-stabilization.mjs` after deploy (pool safety)

**Optional live/API verification (not run in 059E.4 default pass):**

| Test | Required flags | Notes |
|------|----------------|-------|
| Amazon inactive restock | `RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true` + `AMAZON_ENABLE_LIVE_PATCH=true` | One test variant only; do not repeat |
| eBay active qty | `RUN_LIVE_EBAY_ACTIVE_QTY_TEST=true` + `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` | Test product/listing only |
| eBay relist publish | `RUN_LIVE_EBAY_RELIST_TEST=true` + `EBAY_ENABLE_LIVE_RELIST=true` | **Creates a real listing** — one variant only |

Optional dry-run API checks may run when `TEST_*` env vars are set in sub-scripts (see 059B/059C/059D verify scripts).

**Verification bug fixes (no feature changes):** Updated composed verify scripts for 059E.3 centralized copy constants (`adjustOrchestratorSummary.js`); 059D.4 matrix now checks `EBAY_RELIST_DRY_RUN_COPY` import.

**Remaining:** None — Phase 059 frozen.

---

### 059E.5 — 100% complete / final freeze ✅

**Completion criteria:** Phase 059 is 100% complete, finalized, verified, documented, and production-ready. ✅

**Official freeze script:** `scripts/verify-inventory-phase059-final-freeze.mjs` (composes `scripts/verify-inventory-phase059-final.mjs`)

**Final verification (2026-06-09):** Freeze script PASS — production verification PASS — live marketplace calls: **NO**

---

## Phase 059 — Final summary

**Feature:** From **Inventory → Adjust**, admin restocks a variant with unified KK + marketplace channel sync in one confirmation flow.

### Delivered

| Capability | Phase |
|------------|-------|
| Adjust modal channel preview (single-variant lightweight read) | 059A |
| Sync toggle with safe defaults + admin confirmation | 059A / 059E.3 |
| Adjust-first orchestration (`adjust_inventory` then channels) | 059A |
| Amazon active quantity sync | 059A |
| Amazon inactive FBM restock / offer restore | 059B |
| eBay active quantity sync | 059A / 059C |
| eBay cache refresh before quantity sync | 059C |
| eBay ended single-SKU relist (create item → offer → publish) | 059D |
| Unified result panel with partial-success handling | 059A / 059E.2 |
| Failure / rollback clarity (stock stays adjusted) | 059E.2 |
| Operator UX polish (preview, toggle, badges, links) | 059E.3 |
| Production verification script | 059E.4 |
| Final freeze script + docs | 059E.5 |
| Pool-safety preservation (no snapshot refresh, no heavy reads) | All |

### Safety constraints (frozen)

- **`adjust_inventory` is the only stock writer**
- Channel edge calls run **after** successful adjust; **never** inside the adjust RPC transaction
- **Sync toggle ON** required for any marketplace action (no automatic sync without admin confirmation)
- **No stock rollback** — marketplace failures do not undo KK stock
- **Live gates:** `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_QUANTITY_PATCH`, `EBAY_ENABLE_LIVE_RELIST`
- **No browser snapshot refresh** or full `fetchChannelSyncPreview()` in adjust flow
- **No heavy** issue/dashboard/returns view reads in adjust flow
- **No qty-0** eBay push/relist from Adjust
- **eBay variation groups** remain manual/deferred

### Production deployment checklist

1. **Apply migration:** `supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql`
2. **Deploy edge functions:**
   - `sync-amazon-inventory-quantity`
   - `sync-ebay-inventory-quantity`
   - `sync-ebay-listing-inventory-cache`
   - `relist-ebay-from-product`
3. **Deploy shared helpers:** Amazon inactive restore (`inventoryAmazonInactiveRestock.ts`, `amazonOfferRestoreUtils.ts`); eBay cache/relist/publish (`inventoryEbaySyncUtils.ts`, `ebayRelistFromProduct.ts`, `ebayRelistCandidateLoaders.ts`, `ebayListingPublishUtils.ts`)
4. **Deploy admin JS/static bundle** (adjust modal, orchestrator, preview, result panel, APIs)
5. **Confirm Supabase secrets:** Amazon sync credentials; eBay OAuth credentials (existing sync/relist)
6. **Set live gates in production when ready:** `AMAZON_ENABLE_LIVE_PATCH`, `EBAY_ENABLE_LIVE_QUANTITY_PATCH`, `EBAY_ENABLE_LIVE_RELIST`
7. **Post-deploy smoke (mocked or dry_run):**
   - Inventory page loads
   - Adjust modal opens
   - KK-only adjust path
   - Amazon inactive dry_run path
   - eBay active/cache dry_run or mocked path
   - eBay ended relist dry_run path
   - Result panel partial-success copy
   - `verify-inventory-phase10y-final-stabilization.mjs` (pool safety)

### Optional live/API tests (not required for freeze)

**Not run by default.** Use **test product/listing only**, **one variant only**, **do not repeat**.

| Test | Live flag | Live gate | Notes |
|------|-----------|-----------|-------|
| Amazon inactive restock | `RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true` | `AMAZON_ENABLE_LIVE_PATCH=true` | One variant only |
| eBay active qty | `RUN_LIVE_EBAY_ACTIVE_QTY_TEST=true` | `EBAY_ENABLE_LIVE_QUANTITY_PATCH=true` | Test listing only |
| eBay relist publish | `RUN_LIVE_EBAY_RELIST_TEST=true` | `EBAY_ENABLE_LIVE_RELIST=true` | **Creates a real listing** |

Optional dry-run API checks: set `TEST_*` env vars in 059B/059C/059D sub-scripts.

### Frozen limitations (deferred outside Phase 059 → Phase 060)

- **eBay variation group active qty sync** — deferred to **Phase 060A**
- **eBay variation group ended relist** — deferred to **Phase 060B**
- Shared SKU / multi-color relist (e.g. KK-0039)
- Down-adjust-to-zero marketplace deactivation (Amazon qty 0, eBay withdraw)
- Bulk relist / bulk Adjust marketplace sync (multi-variant batch)
- Automatic marketplace sync without admin confirmation
- Stock rollback on marketplace failure
- 10T restock follow-up checklist integration in Adjust result panel (deferred in 059E.3)
- Live marketplace testing without explicit `RUN_LIVE_*` + gate flags
- Full marketplace listing rewrite / content migration
- Scheduled/automatic channel sync cron from adjust events

### Next recommended work (outside Phase 059)

- **Deploy** Phase 059 artifacts per checklist above when ready for production
- **Optional live smoke** with explicit flags on test SKUs only (one-time)
- **Phase 060 — eBay variation group automation** (not started):
  - **060A** — Active variation child qty sync (per-child offer mapping, cache, push)
  - **060B** — Ended variation group relist automation
  - **060C** — Adjust integration + final freeze
- **Recommended next subphase:** **060A.1** — plan + audit (variation group qty sync boundaries)

---

## End-to-end manual test matrix (059E.1)

| # | Scenario | KK | Amazon | eBay | Expected |
|---|----------|-----|--------|------|----------|
| 1 | Sync off | ✅ adjust | — | — | KK only result |
| 2 | Amazon active mismatch | ✅ | ✅ push | — | Unified success |
| 3 | Amazon inactive | ✅ | ✅ restore+push (059B) | — | Listing active |
| 4 | eBay active mismatch | ✅ | — | ✅ push | Qty updated |
| 5 | eBay cache missing | ✅ | — | ✅ refresh+push (059C) | Qty updated |
| 6 | eBay ended single-SKU | ✅ | — | ✅ relist (059D) | New listing live |
| 7 | eBay variation group | ✅ | — | manual link | No automation |
| 8 | Live gates off | ✅ adjust | preview/fail msg | preview/fail msg | Stock still updated |

---

## Deferred outside Phase 059

These items are **explicitly not** part of Phase 059. Deferred to **Phase 060** or later — do not reference as “future 059 work.”

- **eBay variation group active qty sync** → Phase **060A**
- **eBay variation group ended relist** → Phase **060B**
- Shared single-SKU across multiple color variants (e.g. KK-0039) automation
- Down-adjust-to-zero marketplace deactivation (Amazon qty 0, eBay withdraw)
- Bulk adjust channel sync / bulk relist (multi-variant batch)
- Automatic channel sync without admin confirmation
- Stock rollback on marketplace failure
- 10T restock follow-up checklist integration in Adjust flow (deferred 059E.3)
- Live marketplace testing without explicit `RUN_LIVE_*` + gate flags
- Full marketplace listing rewrite / content migration
- Legacy Stripe refund stock restore deprecation
- Scheduled/automatic channel sync cron from adjust events

---

## Related docs

| Doc | Relevance |
|-----|-----------|
| [005_phase_4_manual_adjustments.md](./005_phase_4_manual_adjustments.md) | Current adjust scope |
| [017_phase_7c_amazon_fbm_quantity_sync.md](./017_phase_7c_amazon_fbm_quantity_sync.md) | Amazon push |
| [019_phase_7e_ebay_relist_assist.md](./019_phase_7e_ebay_relist_assist.md) | eBay ended assist |
| [020_phase_7f_ebay_quantity_sync.md](./020_phase_7f_ebay_quantity_sync.md) | eBay active push |
| [051_phase_10t_restock_channel_followup.md](./051_phase_10t_restock_channel_followup.md) | Follow-up pattern (059E.3) |
| [057_supabase_pool_exhaustion_runbook.md](./057_supabase_pool_exhaustion_runbook.md) | Pool guardrails |
| [058_ebay_inventory_column_cache_patch.md](./058_ebay_inventory_column_cache_patch.md) | eBay column observability |

---

## Changelog

| Date | Subphase | Change |
|------|----------|--------|
| 2026-06-09 | **059E.5 / Phase 059** | **Phase 059 — Adjust Stock → Unified Channel Restock complete.** Delivered: Adjust preview + sync toggle + adjust-first orchestration + Amazon active/inactive + eBay active/cache/single-SKU relist + result panel + pool safety. Safety: `adjust_inventory` sole writer, no rollback, live gates, admin confirmation required. Deferred: variation groups → Phase 060. Freeze script PASS; no live marketplace calls |
| 2026-06-09 | 059E.4 | Production verification — `verify-inventory-phase059-final.mjs` PASS; deployment checklist; optional live test docs |
| 2026-06-09 | 059E.3 | Operator UX polish — preview/toggle/result panel copy; 10T deferred; verify PASS |
| 2026-06-09 | 059E.2 | Standardized failure/partial-success copy; partial banner + retry links; verify script PASS |
| 2026-06-09 | 059A.2 | Adjust modal channel preview + toggle; JS structure guardrails; verify script PASS |
| 2026-06-09 | 059A.3 | Adjust channel orchestrator shell; safe update_qty paths; verify script PASS |
