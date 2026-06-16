# Phase 10Q — Admin-Confirmed Marketplace Restock Assist

**Status:** Complete  
**Depends on:** [047_phase_10p_observation_cron_webhooks.md](./047_phase_10p_observation_cron_webhooks.md)  
**Verification:** `node scripts/verify-inventory-phase10q-marketplace-restock-assist.mjs`

---

## Goal

Provide admin-confirmed restock assistance for finalized live bundle component lines when marketplace observations are **`line_confirmed`**. Prefill and suggest quantities only — **no auto-restock**, no auto-RMA, no stock/reservation/ledger/channel mutations outside existing confirmed restock RPC.

---

## 1. Assist candidates view

**View:** `v_inventory_marketplace_restock_assist_candidates`

Joins finalized bundle component reservations with best line-level `marketplace_refund_observations` and active return workflow.

| assist_status | Meaning |
|---------------|---------|
| `eligible_line_confirmed` | Line-confirmed obs + workflow + physical return confirmed — restock assist ready |
| `needs_rma_workflow` | Line-confirmed but no return workflow |
| `needs_physical_return_confirmation` | Line-confirmed workflow exists; physical return not confirmed |
| `sku_inferred_manual_review` | SKU inferred — no suggested qty prefill |
| `order_level_manual_review` | Order-level / missing line confidence — manual review |
| `already_restocked` | `max_restockable_qty <= 0` |
| `afn_external_review` | Amazon AFN/FBA — external/manual |
| `not_finalized` | Reservation not finalized |

**Rules:**

- Only `line_confirmed` sets `suggested_restock_qty` (capped at `max_restockable_qty`).
- `sku_inferred`, `order_level`, `manual_review` never prefill suggested qty.
- AFN/FBA always `afn_external_review`.
- Finalized local bundle component reservation required.

---

## 2. Physical return confirmation

**Table:** `inventory_return_workflow`

New columns (no stock change):

- `physical_return_confirmed_at`
- `physical_return_confirmed_by`
- `physical_return_confirmed_note`

**RPC:** `update_inventory_return_workflow` extended with `p_physical_return_confirmed`, `p_physical_return_confirmed_note`.

**UI:** “Mark Physical Return Confirmed” sets confirmation + marks inspected/resellable on workflow. Restock still requires separate confirmed action via `restock_bundle_component_line`.

---

## 3. Bundle Return/Restock panel UI

**Module:** `bundleReturnRestockMarketplaceAssist.js`

Per marketplace order row:

- Source (eBay/Amazon), confidence, evidence, finalized/restocked/max qty
- Suggested qty (line_confirmed only)
- Assist status + reason
- Actions:
  - **Use Suggested Qty** — fills qty input only
  - **Mark Physical Return Confirmed** — workflow flag only
  - **Create/Update Return Workflow** — existing 10J buttons
  - **Restock Confirmed Qty** — calls existing `restock_bundle_component_line`

**Confirmation copy (required for eligible line-confirmed restock):**

> I confirmed the component was physically returned and is resellable.

Blocked when workflow condition is `damaged` or `missing`.

---

## 4. Stale observation issue

**Issue:** `marketplace_observation_stale` (medium severity)

Triggers when persisted/marketplace observations on restock-relevant lines are **older than 48 hours**.

**Routes:**

- Primary: **Refresh Marketplace Observations** (`refresh_marketplace_observations` action)
- Secondary: Open Bundle Preview — Returns

**Also added:** `marketplace_restock_assist_ready` issue when `assist_status = eligible_line_confirmed`.

---

## 5. Restock RPC

Unchanged: **`restock_bundle_component_line`** (Phase 10G) is the only stock mutation path.

Workflow link after restock still optional via `link_return_workflow_restock`.

---

## 6. Verification

```bash
node scripts/verify-inventory-phase10q-marketplace-restock-assist.mjs
```

PASSED (static + browser; DB when migration applied).

---

## 7. Limitations

- Suggested qty uses observation quantity when present; many finance payloads lack qty — falls back to finalized component qty
- Physical return confirmation is admin attestation — not tied to carrier scan
- Stale issue uses 48h threshold on persisted obs timestamp only
- Stripe line-confirmed refunds still use existing Stripe refund detail path; marketplace assist view focuses eBay/Amazon
- No automatic channel qty sync after restock

---

## 8. Recommended next phase — 10R

**Delivered in:** [049_phase_10r_marketplace_restock_assist_queue.md](./049_phase_10r_marketplace_restock_assist_queue.md)

Batch restock assist queue + audit trail — queue view, audit table, batch UI, stale blocking, issue routes to queue modal.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20261011_inventory_phase10q_marketplace_restock_assist.sql` | View, workflow columns, RPC, issues |
| `js/admin/inventory/api/marketplaceRestockAssistApi.js` | **New** assist fetch/map |
| `js/admin/inventory/ui/bundleReturnRestockMarketplaceAssist.js` | **New** assist UI block |
| `js/admin/inventory/ui/bundleReturnRestockPanel.js` | Assist integration + confirmation gates |
| `js/admin/inventory/api/returnWorkflowApi.js` | Physical return confirm + new fields |
| `js/admin/inventory/ui/bundleReturnRestockWorkflow.js` | Physical return display |
| `js/admin/inventory/services/issueActions.js` | Stale + assist-ready issues |
| `js/admin/inventory/services/issueActionHandlers.js` | Refresh observations action |
| `js/admin/inventory/api/issuesApi.js` | Issue detail queries |
| `js/admin/inventory/api/inventoryApi.js` | Issue labels |
| `scripts/verify-inventory-phase10q-marketplace-restock-assist.mjs` | **New** verification |
