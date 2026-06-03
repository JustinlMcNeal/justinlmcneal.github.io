# KK Amazon Listings Admin Page — Project Milestone Checklist

**Page:** `/pages/admin/amazon.html`  
**Last updated:** 2026-05-29 (after Phase **6C** — table settings)  
**Purpose:** Single checklist from project start → 100% done. Use this to see what shipped, what is next, and what remains in the long-term backlog.

---

## Progress at a Glance

| Track | Done | Total | Progress |
|-------|------|-------|----------|
| **Phase 1 — UX/UI shell** | 9 | 9 | **100%** |
| **Phase 2 — Core SP-API pipeline (2A–2S)** | 19 | 19 | **100%** |
| **Phase 2 — Near-term polish (2T–2U)** | 2 | 2 | **100%** |
| **Phase 3 — Synced tab & row ops** | 6 | 6 | **100%** |
| **Phase 4 — Listing updates & bulk** | 6 | 6 | **100%** |
| **Phase 5 — Financial & health depth** | 6 | 6 | **100%** |
| **Phase 6 — UX polish & analytics** | 4 | 8 | **50%** |

### Overall estimate

| Definition of “done” | Approx. progress | Remaining work |
|----------------------|------------------|----------------|
| **Core pipeline** — connect, sync, map, draft, validate, submit, verify, ready-to-push | **100%** | — |
| **Operational MVP** — above + search/filter/export + row actions + scheduled sync | **100%** | — |
| **Full vision** — profit/fees, bulk ops, health dashboard, analytics, media sync | **~50%** | Phases 5B–6 |

> **You are here:** Table settings (6C) shipped. Next: **6D** readiness gates or **6F** activity history.

---

## How to use this doc

- `[x]` = shipped and documented (or UI shell complete for Phase 1)
- `[ ]` = not started or still placeholder/disabled in UI
- `[~]` = partially done (backend exists but UI/ops incomplete)
- Doc links point to implementation notes under [`ux/`](ux/)

---

## Phase 1 — UX/UI Shell (Complete)

Static admin page layout, mock data, and interaction hooks. No backend.

- [x] **1A — Page overview & admin nav** — [`001_amazon_page_overview.md`](ux/001_amazon_page_overview.md)
- [x] **1B — Header actions** (Sync, Push, Import/Map, Export shells) — [`002_header_actions.md`](ux/002_header_actions.md)
- [x] **1C — Stats cards** — [`003_stats_cards.md`](ux/003_stats_cards.md)
- [x] **1D — Filters & toolbar** (UI only) — [`004_filters_toolbar.md`](ux/004_filters_toolbar.md)
- [x] **1E — Listings table** (desktop + mobile mock rows) — [`005_listings_table.md`](ux/005_listings_table.md)
- [x] **1F — Empty / loading / error states** (HTML placeholders) — [`006_empty_loading_error_states.md`](ux/006_empty_loading_error_states.md)
- [x] **1G — View tabs** (Synced, Ready to Push, Needs Mapping, Drafts/Issues) — [`009_view_sections.md`](ux/009_view_sections.md)
- [x] **1H — Actions & push/mapping modals** (disabled shells) — [`008_actions_and_push_flow.md`](ux/008_actions_and_push_flow.md)
- [x] **1I — Future improvements backlog captured** — [`007_future_improvements.md`](ux/007_future_improvements.md)

---

## Phase 2 — Core SP-API Pipeline

Backend-first build: auth → read sync → mapping → drafts → validation → live submit → verification → ready-to-push.

### Planning & foundation

- [x] **2A — Light JS wiring** (tabs, modals, row menus, mock hydration) — [`010_light_js_wiring.md`](ux/010_light_js_wiring.md)
- [x] **2B — Data model & sync strategy** (planning) — [`011_data_model_and_sync_strategy.md`](ux/011_data_model_and_sync_strategy.md)
- [x] **2C — Supabase schema & views** — [`013_supabase_schema.md`](ux/013_supabase_schema.md)
- [x] **2D — Official SP-API research** — [`012_official_sp_api_research.md`](ux/012_official_sp_api_research.md)

### Auth (2E)

- [x] **2E.1 — Auth status** (`amazon-auth-status`) — [`015_auth_status_implementation.md`](ux/015_auth_status_implementation.md)
- [x] **2E.2 — OAuth start + callback** — [`016_auth_start_callback_implementation.md`](ux/016_auth_start_callback_implementation.md)
- [x] **2E.3 — Auth disconnect** — [`017_auth_disconnect_implementation.md`](ux/017_auth_disconnect_implementation.md)
- [x] **2E plan** — [`014_auth_edge_function_plan.md`](ux/014_auth_edge_function_plan.md)

### Read sync (2F–2I)

- [x] **2F — Read-only sync prototype** (`amazon-sync-listings`) — [`018_read_only_sync_prototype.md`](ux/018_read_only_sync_prototype.md)
- [x] **2G — Frontend live wiring** (Synced tab live read, stats, auth UI) — [`020_frontend_live_wiring.md`](ux/020_frontend_live_wiring.md)
- [x] **2H — AWS SigV4 signing** — [`019_sigv4_sync_signing.md`](ux/019_sigv4_sync_signing.md)
- [x] **2I — Incremental + full sync strategy** — [`021_incremental_full_sync.md`](ux/021_incremental_full_sync.md)

### Mapping & drafts (2J–2K)

- [x] **2J — Mapping save workflow** (`amazon-map-listing`, Needs Mapping live) — [`022_mapping_save_workflow.md`](ux/022_mapping_save_workflow.md)
- [x] **2K — Local push draft save** (`amazon-save-draft`, Drafts/Issues) — [`023_push_draft_workflow.md`](ux/023_push_draft_workflow.md)

### Validation & submit (2L–2N)

- [x] **2L — PTD fetch/cache + draft validation preview** — [`024_product_type_validation_preview.md`](ux/024_product_type_validation_preview.md)
- [x] **2M — Amazon submit validation preview** — [`025_submit_validation_preview.md`](ux/025_submit_validation_preview.md)
- [x] **2N — Live submit** (`amazon-submit-draft`, env gate) — [`026_live_submit.md`](ux/026_live_submit.md)

### Post-submit & ready-to-push (2O–2S)

- [x] **2O — Post-submit verification + published reconciliation** — [`027_post_submit_verification.md`](ux/027_post_submit_verification.md)
- [x] **2P — Live Ready to Push + post-submit UX polish** — [`028_ready_to_push_live.md`](ux/028_ready_to_push_live.md)
- [x] **2Q — Scheduled verification retry** (cron + queue metadata) — [`029_scheduled_verification_retry.md`](ux/029_scheduled_verification_retry.md)
- [x] **2R — Product type search + Ready to Push eligibility** — [`030_product_type_search_and_eligibility.md`](ux/030_product_type_search_and_eligibility.md)
- [x] **2S — Max-attempt alerts, requeue, header product picker** — [`031_verify_requeue_and_product_picker.md`](ux/031_verify_requeue_and_product_picker.md)

### Near-term polish (next in numbered sequence)

- [x] **2T — PTD `itemName` recommendation + pre-submit gate** — [`032_product_type_recommendation_submit_gate.md`](ux/032_product_type_recommendation_submit_gate.md)
- [x] **2U — Bulk requeue + max-attempt operator alerts** — [`033_bulk_requeue_and_max_attempt_alerts.md`](ux/033_bulk_requeue_and_max_attempt_alerts.md)
- [x] **2V — Synced tab search, filters, export, row actions** — [`034_synced_tab_search_and_row_actions.md`](ux/034_synced_tab_search_and_row_actions.md)

---

## Phase 3 — Synced Tab & Row Operations

Make the main listings dashboard fully operable day-to-day.

- [x] **3A — Manual Sync Amazon button** — wired when connected; full/incremental via `amazon-sync-listings`
- [x] **3B — Synced tab search** — [`034_synced_tab_search_and_row_actions.md`](ux/034_synced_tab_search_and_row_actions.md)
- [x] **3C — Synced tab filters** (status, category, marketplace, inventory, sort)
- [x] **3D — Pagination & rows-per-page** (client-side on loaded rows)
- [x] **3E — Export listings CSV** (filtered rows, client-side)
- [x] **3F — Row action menu items** — View Details, Sync SKU, View on Amazon, Edit Listing, Update Inventory, Delete Draft (when draft linked); issue placeholders remain

**Doc:** [`034_synced_tab_search_and_row_actions.md`](ux/034_synced_tab_search_and_row_actions.md)

---

## Phase 4 — Listing Updates & Automation

Beyond create/submit — keep listings healthy without Seller Central.

- [x] **4A — Scheduled sync cron + stale listing detection** — [`035_scheduled_sync_and_stale_detection.md`](ux/035_scheduled_sync_and_stale_detection.md)
- [x] **4B — Single-SKU refresh** (row action → `single_sku` sync; shipped in Phase 3F)
- [x] **4C — Listing PATCH** (price/qty via `amazon-patch-listing`) — [`037_listing_patch_price_qty.md`](ux/037_listing_patch_price_qty.md)
- [x] **4D — Delete local draft** (`amazon-delete-draft`, row/card actions) — [`038_delete_local_draft.md`](ux/038_delete_local_draft.md)
- [x] **4E — Bulk price/qty** (`amazon-bulk-patch-listings`, row selection + modal) — [`039_bulk_patch_price_qty.md`](ux/039_bulk_patch_price_qty.md)
- [x] **4F — Sync run history UI** — [`036_sync_run_history_ui.md`](ux/036_sync_run_history_ui.md)

**Docs:** [`035`](ux/035_scheduled_sync_and_stale_detection.md) · [`036`](ux/036_sync_run_history_ui.md) · [`037`](ux/037_listing_patch_price_qty.md) · [`038`](ux/038_delete_local_draft.md) · [`039`](ux/039_bulk_patch_price_qty.md)

---

## Phase 5 — Financial, Inventory & Listing Health

From [`007_future_improvements.md`](ux/007_future_improvements.md) — high value but not blocking core push flow.

- [x] **5A — Live profit column** — [`040_live_profit_column.md`](ux/040_live_profit_column.md)
- [x] **5B — Amazon fee breakdown** (Product Fees API tooltip) — [`041_amazon_fee_breakdown.md`](ux/041_amazon_fee_breakdown.md)
- [x] **5C — KK vs Amazon price mismatch highlights** — [`042_price_mismatch_highlights.md`](ux/042_price_mismatch_highlights.md)
- [x] **5D — Inventory mismatch detection** (warehouse vs Amazon FBM qty) — [`043_inventory_mismatch_highlights.md`](ux/043_inventory_mismatch_highlights.md)
- [x] **5E — Listing health / suppression issues** — [`044_listing_health_dashboard.md`](ux/044_listing_health_dashboard.md)
- [x] **5F — FBA vs FBM / reserved inventory columns** — [`045_fba_fbm_inventory_columns.md`](ux/045_fba_fbm_inventory_columns.md)

---

## Phase 6 — UX Polish, Media & Analytics

Nice-to-have for a “complete” admin experience.

- [x] **6A — View tabs** (Synced / Ready / Mapping / Drafts)
- [x] **6B — Push & mapping modals** (live workflows)
- [x] **6C — Table settings** (density / column visibility) — [`046_table_settings.md`](ux/046_table_settings.md)
- [ ] **6D — Category & image readiness gates** on Ready to Push (partially via 2R eligibility flags)
- [x] **6E — Sync run history / logs UI** — [`036_sync_run_history_ui.md`](ux/036_sync_run_history_ui.md) (same as 4F)
- [ ] **6F — Activity history** (who changed price/qty and when)
- [ ] **6G — Deep link to Seller Central** (View on Amazon row action — shipped 3F; full polish TBD)
- [ ] **6H — Listing image quality / gallery sync**
- [ ] **6I — Sales velocity & issue dashboard analytics**

---

## Phase 7 — Planned (not started)

Future tracks documented for implementation when ready:

- [x] **7A — Product variants (Phases 1–3)** — [`ux/048_amazon_variants_implementation_plan.md`](ux/048_amazon_variants_implementation_plan.md) — variant infrastructure, variation families, bulk push + recovery
- [x] **7B — Amazon orders on line items page (SP-API sync)** — Phase A–C shipped; cron SQL in `supabase/SETUP_AMAZON_ORDERS_CRON.sql`

---

## Edge Functions Inventory

| Function | Status | Phase |
|----------|--------|-------|
| `amazon-auth-status` | ✅ | 2E |
| `amazon-auth-start` | ✅ | 2E |
| `amazon-auth-callback` | ✅ | 2E |
| `amazon-auth-disconnect` | ✅ | 2E |
| `amazon-sync-listings` | ✅ | 2F–2I |
| `amazon-map-listing` | ✅ | 2J |
| `amazon-save-draft` | ✅ | 2K |
| `amazon-product-type-definition` | ✅ | 2L |
| `amazon-preview-draft` | ✅ | 2L |
| `amazon-submit-draft-preview` | ✅ | 2M |
| `amazon-submit-draft` | ✅ | 2N |
| `amazon-verify-submitted-draft` | ✅ | 2O |
| `amazon-verify-submitted-drafts-cron` | ✅ | 2Q |
| `amazon-search-product-types` | ✅ | 2R |
| `amazon-bulk-requeue-draft-verification` | ✅ (deploy pending) | 2U |
| `amazon-requeue-draft-verification` | ✅ | 2S |
| `amazon-sync-listings-cron` | ✅ (deploy pending) | 4A |
| Listing PATCH / update | ✅ | 4C |
| `amazon-patch-listing` | ✅ (deploy pending) | 4C |
| `amazon-delete-draft` | ✅ (deploy pending) | 4D |
| `amazon-bulk-patch-listings` | ✅ (deploy pending) | 4E |
| `amazon-estimate-listing-fees` | ✅ (deploy pending) | 5B |
| Export CSV | ✅ | 3E / 2V |

---

## Security Rules (Always On)

These apply to every remaining phase:

- [x] No Amazon listing writes from the browser
- [x] No service role key or LWA/AWS tokens in frontend
- [x] Admin JWT for mutating edge functions
- [x] Cron secret for automated verify retry and scheduled sync
- [x] Live submit behind env gate + confirmation phrase
- [x] Maintain above as PATCH/export/bulk features are added

---

## Recommended Build Order (Remaining)

Shortest path to “ops-ready” after 2S:

1. **6D** — Category & image readiness gates polish
2. **6F** — Activity history (price/qty audit)

**Rough effort (order-of-magnitude):**

| Milestone | Phases | Est. sessions |
|-----------|--------|---------------|
| Finish numbered Phase 2 | 2T–2V | done |
| Operational MVP | 4B–4C | 1–2 |
| Full listing management | Phase 4 | done |
| Financial & health depth | Phase 5 | 3–5 |
| UX & analytics polish | Phase 6 | ongoing |

---

## Related Docs Index

| Range | Topic |
|-------|-------|
| `001`–`009` | Phase 1 UX/UI |
| `010`–`013` | Wiring, planning, schema |
| `014`–`017` | Auth |
| `018`–`021` | Sync |
| `022`–`026` | Map, draft, validate, submit |
| `027`–`046` | Verify through table settings |
| `007` | Long-term backlog |

---

## Acceptance: “100% Done” Definition

Pick the bar that matches your goal:

### A — Core pipeline complete ✅ (current)

- [x] Connect Amazon
- [x] Sync listings (manual)
- [x] Map unmapped listings
- [x] Create/save/preview/submit drafts
- [x] Verify + cron retry + requeue
- [x] Ready to Push live list + eligibility
- [x] Header push with product picker

### B — Operational MVP ✅ (current)

- [x] All of A
- [x] Phase 3 (search, filter, paginate Synced tab)
- [x] Export CSV
- [x] Row actions (at minimum: Sync SKU, View on Amazon)
- [x] Scheduled sync cron + stale detection

### C — Full product vision

- [ ] All of B
- [x] Live profit (COGS + Product Fees API when loaded)
- [x] PATCH price/qty from admin
- [x] Bulk operations (price/qty via Listings API)
- [x] Health/issue dashboard (Synced tab — [5E](ux/044_listing_health_dashboard.md))
- [ ] Sync logs & activity history
- [ ] Media sync & advanced analytics

**Current status: Definition A and B are met. Definition C (full vision) is the remaining roadmap.**
