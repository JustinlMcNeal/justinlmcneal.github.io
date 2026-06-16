# Phase 10T — Channel Restock Follow-Up Checklist

**Status:** Complete  
**Depends on:** [050_phase_10s_restock_assist_audit_analytics.md](./050_phase_10s_restock_assist_audit_analytics.md)  
**Verification:** `node scripts/verify-inventory-phase10t-restock-channel-followup.mjs`

---

## Goal

Add post-restock follow-up reminders, links, and completion tracking so admins know when a restock may require channel sync review. **Informational only** — no automatic channel sync or stock mutations.

---

## 1. Follow-up candidates view

**View:** `v_inventory_restock_followup_candidates`

Built from `inventory_bundle_component_restock_actions` (last 30 days) joined with channel sync candidates, KK available stock, virtual bundle preview, and marketplace assist audit linkage.

| followup_status | When |
|-----------------|------|
| `needs_channel_review` | Amazon FBM + eBay mapped, or live virtual bundle availability |
| `needs_amazon_review` | Amazon FBM mapping only |
| `needs_ebay_review` | eBay mapping only |
| `kk_updated` | KK component stock changed; no marketplace mapping signal |
| `no_channel_mapping` | No Amazon/eBay mapping — "No mapped marketplace quantity to sync" |
| `completed` | Admin marked reviewed/dismissed/sync completed |

Does not infer that every restock requires channel sync.

---

## 2. Follow-up state table

**Table:** `inventory_restock_followup_states`  
**RPC:** `upsert_inventory_restock_followup_state`

| status | Meaning |
|--------|---------|
| `open` | Default — follow-up visible |
| `reviewed` | Admin reviewed checklist |
| `sync_not_needed` | No channel sync required |
| `sync_completed` | Admin completed manual sync |
| `dismissed` | Dismissed from UI |

Workflow-only — no stock or channel push.

---

## 3. Checklist UI

**Module:** `restockFollowupChecklist.js`

Shown after successful restock in:

- Bundle Return/Restock panel (via `bundleReturnRestockChecklist.js` wrapper)
- Marketplace Restock Assist Queue (modal after restock)
- Audit History (`View follow-up` on `restock_confirmed` rows)

Checklist items: component stock, virtual bundle availability, Amazon/eBay mapping review, KK available qty.

Actions: Open Sync Channels, Open Bundle Preview, Open Inventory, Mark Reviewed, Sync Not Needed, Sync Completed, Dismiss.

---

## 4. Sync Channels modal link

`openSyncDryRunModal({ highlightSku, highlightVariantId, contextNote })` shows post-restock banner. **Does not auto-run sync.**

---

## 5. Issue group

**Issue:** `restock_channel_followup_needed` (low severity)

Triggers when recent restock has mapped marketplace listing or live bundle availability impact, follow-up state still `open`, within 14 days.

Routes: Open Sync Channels · Open Restock Audit History tab.

---

## 6. Verification

```bash
node scripts/verify-inventory-phase10t-restock-channel-followup.mjs
```

---

## 7. Limitations

- Follow-up view limited to 30-day restock window
- Issue count uses 14-day threshold
- Sync modal highlights SKU in copy only — does not filter candidate tables server-side
- No automatic detection of whether admin actually pushed channel qty

---

## 8. Recommended next phase — 10U ✅

**Unified returns/restock dashboard** — implemented in [052_phase_10u_returns_restock_dashboard.md](./052_phase_10u_returns_restock_dashboard.md). Follow-up checklist and queue remain available; dashboard is the unified entry point.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20261014_inventory_phase10t_restock_channel_followup.sql` | View, state table, RPC, issues update |
| `js/admin/inventory/api/restockFollowupApi.js` | **New** follow-up fetch/state API |
| `js/admin/inventory/ui/restockFollowupChecklist.js` | **New** checklist + modal |
| `js/admin/inventory/ui/bundleReturnRestockChecklist.js` | Delegates to follow-up module |
| `js/admin/inventory/ui/bundleReturnRestockPanel.js` | Passes restock audit/ledger ids |
| `js/admin/inventory/ui/marketplaceRestockAssistQueueActions.js` | Follow-up modal after queue restock |
| `js/admin/inventory/ui/marketplaceRestockAssistAuditPanel.js` | View follow-up on audit rows |
| `js/admin/inventory/ui/syncDryRunModal.js` | Post-restock context banner |
| `js/admin/inventory/services/issueActions.js` | `restock_channel_followup_needed` |
| `js/admin/inventory/services/issueActionHandlers.js` | Audit tab route |
| `js/admin/inventory/api/inventoryApi.js` | Issue label |
