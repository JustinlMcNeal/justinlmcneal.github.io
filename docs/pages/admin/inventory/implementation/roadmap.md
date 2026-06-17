# KK Universal Storage — Implementation Roadmap

**Status:** Phase 10Y-Pool complete + post-freeze patches  
**Primary plan:** [001_wiring_plan.md](./001_wiring_plan.md)  
**UX roadmap:** [../ux/roadmap.md](../ux/roadmap.md)  
**Page:** `pages/admin/inventory.html`  
**JS root:** `js/admin/inventory/`

---

## Phase index

| Phase | Name | Status | Doc |
|-------|------|--------|-----|
| 1 | Static UX shell | ✅ Complete | [ux/001_static_ux_shell_complete.md](../ux/001_static_ux_shell_complete.md) |
| 1b | JS `renderers/` refactor | ✅ Complete | [ux/roadmap.md](../ux/roadmap.md) changelog |
| 2 | Wiring plan / audit | ✅ Complete | **This phase — [001_wiring_plan.md](./001_wiring_plan.md)** |
| 3A | Read-only KPI + ledger wiring | ✅ Complete | [002_phase_3a_readonly_kpis_ledger.md](./002_phase_3a_readonly_kpis_ledger.md) |
| 3B | Read-only inventory table + issues view | ✅ Complete | [003_phase_3b_workspace_issues.md](./003_phase_3b_workspace_issues.md) |
| 3C | Channel strip + alert pills polish | ✅ Complete | [004_phase_3c_channel_alerts.md](./004_phase_3c_channel_alerts.md) |
| 4 | Manual ledger adjustments | ✅ Complete | [005_phase_4_manual_adjustments.md](./005_phase_4_manual_adjustments.md) |
| 5 | Parcel receive + ledger UI | ✅ Complete | [006_phase_5_parcel_receive_visibility.md](./006_phase_5_parcel_receive_visibility.md) |
| 6A | Order reservation design audit | ✅ Complete | [007_phase_6_order_reservation_design.md](./007_phase_6_order_reservation_design.md) |
| 6B | Reservation schema + read views | ✅ Complete | [008_phase_6b_reservation_schema_views.md](./008_phase_6b_reservation_schema_views.md) |
| 6C | Stripe idempotency + KK shadow reservations | ✅ Complete | [009_phase_6c_stripe_idempotency_shadow_reservations.md](./009_phase_6c_stripe_idempotency_shadow_reservations.md) |
| 6D-Validation | Shadow checkout validation + readiness cleanup | ✅ Complete | [011_phase_6d_validation_shadow_checkout.md](./011_phase_6d_validation_shadow_checkout.md) |
| 6D-Validation Diagnostic | Stripe webhook environment check | ✅ Complete | [012_phase_6d_validation_webhook_diagnostic.md](./012_phase_6d_validation_webhook_diagnostic.md) |
| 6D | KK cutover execute (backfill + reserve-only) | ✅ Complete | [013_phase_6d_kk_reserve_only_cutover.md](./013_phase_6d_kk_reserve_only_cutover.md) |
| 6E | Fulfillment finalize + reservation release | ✅ Complete | [014_phase_6e_fulfillment_finalize.md](./014_phase_6e_fulfillment_finalize.md) |
| 7A | Channel sync design + dry-run planner | ✅ Complete | [015_phase_7a_channel_sync_design_dry_run.md](./015_phase_7a_channel_sync_design_dry_run.md) |
| 7B | KK storefront available-stock alignment | ✅ Complete | [016_phase_7b_kk_available_stock_alignment.md](./016_phase_7b_kk_available_stock_alignment.md) |
| 7C | Amazon FBM quantity sync push | ✅ Complete | [017_phase_7c_amazon_fbm_quantity_sync.md](./017_phase_7c_amazon_fbm_quantity_sync.md) |
| 7D | eBay quantity cache + sync readiness | ✅ Complete | [018_phase_7d_ebay_quantity_cache_readiness.md](./018_phase_7d_ebay_quantity_cache_readiness.md) |
| 7E | eBay ended-listing relist assist | ✅ Complete | [019_phase_7e_ebay_relist_assist.md](./019_phase_7e_ebay_relist_assist.md) |
| 7F | eBay active-listing quantity sync push | ✅ Complete | [020_phase_7f_ebay_quantity_sync.md](./020_phase_7f_ebay_quantity_sync.md) |
| 8A | Issue workflows + action routing | ✅ Complete | [021_phase_8a_issue_workflows.md](./021_phase_8a_issue_workflows.md) |
| 8B | Issue resolution tracking (snooze/resolve) | ✅ Complete | [022_phase_8b_issue_resolution_tracking.md](./022_phase_8b_issue_resolution_tracking.md) |
| 8C | Mapping assist wizards | ✅ Complete | [023_phase_8c_mapping_assist_wizards.md](./023_phase_8c_mapping_assist_wizards.md) |
| 8D | Reservation retry (mapped lines) | ✅ Complete | [024_phase_8d_reservation_retry_mapped_lines.md](./024_phase_8d_reservation_retry_mapped_lines.md) |
| 8E | Shipped finalize audit (read-only) | ✅ Complete | [025_phase_8e_shipped_finalize_audit.md](./025_phase_8e_shipped_finalize_audit.md) |
| 8F | Manual finalize assist (shipped mapped) | ✅ Complete | [026_phase_8f_manual_finalize_assist.md](./026_phase_8f_manual_finalize_assist.md) |
| 8G | eBay safe mapping hints | ✅ Complete | [027_phase_8g_ebay_safe_mapping_hints.md](./027_phase_8g_ebay_safe_mapping_hints.md) |
| 8H | Bulk eBay mapping visibility + selected apply | ✅ Complete | [028_phase_8h_bulk_mapping_visibility.md](./028_phase_8h_bulk_mapping_visibility.md) |
| 9A | Post-map workflow assist | ✅ Complete | [029_phase_9a_post_map_workflow_assist.md](./029_phase_9a_post_map_workflow_assist.md) |
| 9B | Post-map action queue | ✅ Complete | [030_phase_9b_post_map_action_queue.md](./030_phase_9b_post_map_action_queue.md) |
| 9C | Queue resolution assist + work screen | ✅ Complete | [031_phase_9c_queue_resolution_assist.md](./031_phase_9c_queue_resolution_assist.md) |
| 10A | Bundle/component design + read-only preview | ✅ Complete | [032_phase_10a_bundle_component_design_preview.md](./032_phase_10a_bundle_component_design_preview.md) |
| 10B | Bundle rule management + product picker | ✅ Complete | [033_phase_10b_bundle_rule_management.md](./033_phase_10b_bundle_rule_management.md) |
| 10C | Virtual bundle simulation + shadow mode | ✅ Complete | [034_phase_10c_virtual_bundle_shadow.md](./034_phase_10c_virtual_bundle_shadow.md) |
| 10D | Virtual bundle checkout shadow hook | ✅ Complete | [035_phase_10d_virtual_bundle_checkout_shadow.md](./035_phase_10d_virtual_bundle_checkout_shadow.md) |
| 10E | Virtual bundle live readiness + guardrails | ✅ Complete | [036_phase_10e_virtual_bundle_live_readiness.md](./036_phase_10e_virtual_bundle_live_readiness.md) |
| 10F | Live virtual bundle reservation + finalization | ✅ Complete | [037_phase_10f_live_virtual_bundle_inventory.md](./037_phase_10f_live_virtual_bundle_inventory.md) |
| 10G | Bundle component returns/restock | ✅ Complete | [038_phase_10g_bundle_component_returns_restock.md](./038_phase_10g_bundle_component_returns_restock.md) |
| 10H | Partial refund + return guidance | ✅ Complete | [039_phase_10h_partial_refund_return_guidance.md](./039_phase_10h_partial_refund_return_guidance.md) |
| 10I | Line Items deep-link focus + return polish | ✅ Complete | [040_phase_10i_line_items_deeplink_return_polish.md](./040_phase_10i_line_items_deeplink_return_polish.md) |
| 10J | RMA / return workflow status | ✅ Complete | [041_phase_10j_rma_return_workflow.md](./041_phase_10j_rma_return_workflow.md) |
| 10K | Stripe refund refresh + return guidance | ✅ Complete | [042_phase_10k_stripe_refund_return_guidance.md](./042_phase_10k_stripe_refund_return_guidance.md) |
| 10L | Stripe refund webhook enrichment | ✅ Complete | [043_phase_10l_stripe_refund_webhook_enrichment.md](./043_phase_10l_stripe_refund_webhook_enrichment.md) |
| 10M | Multi-channel refund observability | ✅ Complete | [044_phase_10m_multichannel_refund_observability.md](./044_phase_10m_multichannel_refund_observability.md) |
| 10N | Marketplace refund persistence + sync hardening | ✅ Complete | [045_phase_10n_marketplace_refund_persistence.md](./045_phase_10n_marketplace_refund_persistence.md) |
| 10O | Marketplace cancel retention + line mapping | ✅ Complete | [046_phase_10o_marketplace_cancel_line_mapping.md](./046_phase_10o_marketplace_cancel_line_mapping.md) |
| 10P | Post-sync observation cron + eBay webhook cancel/refund | ✅ Complete | [047_phase_10p_observation_cron_webhooks.md](./047_phase_10p_observation_cron_webhooks.md) |
| 10Q | Admin-confirmed marketplace restock assist | ✅ Complete | [048_phase_10q_marketplace_restock_assist.md](./048_phase_10q_marketplace_restock_assist.md) |
| 10R | Batch restock assist queue + audit trail | ✅ Complete | [049_phase_10r_marketplace_restock_assist_queue.md](./049_phase_10r_marketplace_restock_assist_queue.md) |
| 10S | Restock assist audit viewer + queue analytics | ✅ Complete | [050_phase_10s_restock_assist_audit_analytics.md](./050_phase_10s_restock_assist_audit_analytics.md) |
| 10T | Channel restock follow-up checklist | ✅ Complete | [051_phase_10t_restock_channel_followup.md](./051_phase_10t_restock_channel_followup.md) |
| 10U | Unified returns/restock dashboard | ✅ Complete | [052_phase_10u_returns_restock_dashboard.md](./052_phase_10u_returns_restock_dashboard.md) |
| 10V | Dashboard deep links, presets, export | ✅ Complete | [053_phase_10v_dashboard_deeplinks_exports.md](./053_phase_10v_dashboard_deeplinks_exports.md) |
| 10W | Scheduled returns/restock digest | ✅ Complete | [054_phase_10w_returns_restock_digest.md](./054_phase_10w_returns_restock_digest.md) |
| 10X | Server-side paginated worklist | ✅ Complete | [055_phase_10x_dashboard_pagination.md](./055_phase_10x_dashboard_pagination.md) |
| 10Y | Returns/Restock feature freeze | ✅ Complete | [056_phase_10y_final_stabilization.md](./056_phase_10y_final_stabilization.md) |
| 10AA | Issues snapshot architecture (pool safety) | ✅ Complete | [056_phase_10y_final_stabilization_pool_safety.md](./056_phase_10y_final_stabilization_pool_safety.md) |
| 10AB | Missing SKU uses product.code | ✅ Complete | [056_phase_10y_final_stabilization_pool_safety.md](./056_phase_10y_final_stabilization_pool_safety.md) |
| 10Y-Pool | DB recovery + production stabilization | ✅ Complete | [056_phase_10y_final_stabilization_pool_safety.md](./056_phase_10y_final_stabilization_pool_safety.md) · [057 runbook](./057_supabase_pool_exhaustion_runbook.md) |
| **058** | **eBay column cache patch (post-freeze)** | ✅ Complete | [058_ebay_inventory_column_cache_patch.md](./058_ebay_inventory_column_cache_patch.md) |
| **059** | **Adjust → unified channel restock** | ✅ Complete / Frozen | [059_adjust_stock_unified_channel_restock_plan.md](./059_adjust_stock_unified_channel_restock_plan.md) |
| **060** | **eBay variation group automation** | ✅ Complete / Frozen / Production-ready | [060_ebay_variation_group_automation_plan.md](./060_ebay_variation_group_automation_plan.md) |

### Phase 059 subphases (5 × 5 — complete at 059E.5)

| Major | Name | Subphases | Status |
|-------|------|-----------|--------|
| **059A** | Adjust orchestration shell + safe existing paths | A.1 plan · A.2 preview · A.3 orchestrator · A.4 result/audit · A.5 QA | **059A ✅ Complete** |
| **059B** | Amazon inactive restock / offer restore | B.1 audit · B.2 edge · B.3 integrate · B.4 verify · B.5 QA | **059B ✅ Complete** |
| **059C** | eBay active cache refresh + qty polish | C.1 audit · C.2 cache chain · C.3 integrate · C.4 verify · C.5 QA | **059C ✅ Complete** |
| **059D** | eBay ended single-SKU auto-relist | D.1 audit · D.2 edge · D.3 integrate · D.4 verify · D.5 QA | **059D ✅ Complete** |
| **059E** | Final integration + completion | E.1 E2E · E.2 failures · E.3 UX · E.4 prod verify · E.5 freeze | **059E ✅ Complete (frozen)** |

**Phase 059:** ✅ **Complete / Frozen / Production-ready** (2026-06-09). Verified by `scripts/verify-inventory-phase059-final-freeze.mjs` + `scripts/verify-inventory-phase059-final.mjs`.

### Phase 060 — eBay variation group automation (5 × 5 per major at 060C.5)

| Major | Name | Subphases | Status |
|-------|------|-----------|--------|
| **060A** | eBay active variation child qty sync | A.1 audit · A.2 view/loaders · A.3 edge · A.4 verify · A.5 freeze | **060A ✅ Complete / Frozen** |
| **060B** | eBay ended variation group relist | B.1 audit · B.2 candidates · B.3 edge · B.4 verify · B.5 freeze | **060B ✅ Complete / Frozen** |
| **060C** | Adjust integration + final freeze | C.1 plan · C.2 preview · C.3 orchestrator · C.4 verify · C.5 freeze | **060C.4 ✅ · 060C.5 ✅ · 060C Complete / Frozen** |

**Phase 060:** ✅ **Complete / Frozen / Production-ready** (2026-06-09). Verified by `scripts/verify-inventory-phase060-final-freeze.mjs`.

**060 complete when:** `060C.5` — variation qty + relist + Adjust integration frozen. **Achieved.**

**JS organization:** Phase 059 modules must stay under 500 lines where practical; split by feature/responsibility (see [059 plan](./059_adjust_stock_unified_channel_restock_plan.md#javascript-structure-guardrails-all-subphases)).

---

## JS module layout (current — Phase 8A)

```
js/admin/inventory/
├── index.js
├── dom.js
├── events.js
├── mockData.js
├── state.js
├── constants/
│   ├── parcelLinks.js
│   ├── orderLinks.js
│   └── channelLinks.js
├── api/
│   ├── inventoryApi.js
│   ├── channelStatusApi.js
│   ├── adjustInventoryApi.js
│   ├── parcelReceiveApi.js
│   ├── issuesApi.js
│   ├── ebayRelistAssistApi.js
│   └── ebaySyncPushApi.js
├── services/
│   ├── …
│   ├── issueActions.js
│   ├── issueActionHandlers.js
│   ├── issueKeys.js
│   └── issueWorkflow.js
├── api/
│   ├── …
│   ├── issuesApi.js
│   └── issueStateApi.js
├── renderers/
│   └── … (KPIs, table, ledger, issues, parcel, bundle)
└── utils/
    └── formatters.js
```

## JS module layout (Phase 3+ target)

```
js/admin/inventory/
├── index.js
├── dom.js
├── events.js
├── state.js
├── constants.js
├── api/
│   ├── inventoryApi.js
│   ├── channelStatusApi.js
│   └── issuesApi.js
├── services/
│   ├── filterInventory.js
│   ├── sortInventory.js
│   └── mapRowToTable.js
├── renderers/          (unchanged — rendering only)
└── utils/
    └── formatters.js
```

Remove `mockData.js` after Phase 3 read wiring is stable.

---

## Next action

**Phase 060 is frozen.** No new inventory marketplace automation until a new phase is opened. Recommended next work outside Phase 060:

- Production apply of Phase 060 migrations + edge functions if not yet live (see [060 deployment checklist](./060_ebay_variation_group_automation_plan.md#production-deployment-checklist-phase-060))
- Optional live dry-run on test products only (explicit flags required)
- Parcel import / CPI / products margin work (separate tracks in repo)

For Returns/Restock baseline: run `node scripts/verify-inventory-phase10y-final-stabilization.mjs`. See [056_phase_10y_final_stabilization_pool_safety.md](./056_phase_10y_final_stabilization_pool_safety.md).

---

## Change log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-06-09 | 060 | eBay variation group automation complete/frozen — Adjust integration for active child qty + ended group relist |
| 2026-06-12 | 10Y-Pool | Supabase pool exhaustion fix: 10AA snapshot issues, 10AB missing-SKU, browser snapshot RPC removed, verification + runbook |
| 2026-06-09 | 10Y | Feature freeze, deployment checklist, regression guard, UI polish |
| 2026-06-09 | 10X | Paginated worklist RPC + target lookup + filtered export |
| 2026-06-09 | 10W | Scheduled returns/restock digest views + edge function + preview |
| 2026-06-09 | 10V | Dashboard deep links, presets, grouping, export metrics |
| 2026-06-09 | 10U | Unified returns/restock dashboard views + modal + issue |
| 2026-06-09 | 10T | Post-restock channel follow-up view + checklist + issue |
| 2026-06-09 | 10S | Queue KPI summary + audit viewer + snooze/review triage |
| 2026-06-09 | 10R | Batch restock assist queue view + audit table + modal UI |
| 2026-06-09 | 10Q | Marketplace restock assist view + physical return confirm + stale obs issue |
| 2026-06-09 | 10P | Post-sync observation refresh; eBay webhook cancel/refund; Amazon TSV canceled retention; Line Items status view |
| 2026-06-09 | 10O | Amazon canceled retention; eBay cancel upsert; line-level finance extraction |
| 2026-06-09 | 10N | marketplace_refund_observations table + backfill RPC + eBay finance REFUND sync |
| 2026-06-09 | 10M | eBay/Amazon refund observations view; marketplace guidance + issue groups |
| 2026-06-09 | 10E | Live readiness checklist + independent stock ack + live request staging |
| 2026-06-09 | 10D | Checkout/ship bundle shadow hooks + mode controls + events UI |
| 2026-06-09 | 10C | Virtual bundle simulate RPC + shadow events + readiness view |
| 2026-06-09 | 10B | Variant picker + rule management + config audit |
| 2026-06-09 | 10A | Bundle rules table + preview views + UI (read-only) |
| 2026-06-09 | 9C | Queue resolution view + work screen + bulk workflow status |
| 2026-06-09 | 9B | Post-map action queue table + modal + checklist upsert |
| 2026-06-09 | 9A | Post-map workflow checklist + Line Items deep links |
| 2026-06-09 | 8H | eBay mapping worklist views + selected batch apply UI |
| 2026-06-09 | 8D | Reservation retry candidates + admin RPC + UI |
| 2026-06-09 | 8C | Mapping assist wizards (unmapped lines + Amazon variant) |
| 2026-06-09 | 8B | Issue state table, snooze/resolve UI, workflow filters |
| 2026-06-09 | 8A | Issue action routes, detail modal, extended issues view |
| 2026-06-09 | 7F | eBay active qty sync push + preview UI |
| 2026-06-09 | 7E | eBay relist assist view + audit log + Sync modal section |
| 2026-06-09 | 6E | Fulfillment finalize RPC + Shippo/admin wiring |
| 2026-06-09 | 6D Execute | Cutover RPC; reserve_only mode; webhook mode-aware; +8 backfill / 10 reserved |
| 2026-06-09 | 6D-Validation Diagnostic | Webhook env check; linked DB has no post-6C checkout artifacts |
| 2026-06-09 | 6D-Validation | Checkout validation checklist; active vs historical readiness split |
| 2026-06-09 | 6D-Prep | Cutover readiness views + backfill dry-run; safe_to_proceed_hint=false |
| 2026-06-09 | 6C | Stripe dedup + KK shadow reservations; official KPIs exclude shadow |
| 2026-06-09 | 6B | `inventory_reservations` table + read views; unmapped order lines issue |
| 2026-06-09 | 6A | Order reserve/finalize/reverse design audit (docs only) |
| 2026-06-09 | 3C | Channel strip + live alert pills + eBay qty tooltips |
| 2026-06-09 | 3A | KPI + ledger read-only wiring, views migration, admin gate |
| 2026-06-09 | 2 | Wiring plan + implementation roadmap created |
