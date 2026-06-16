# Phase 10R — Batch Marketplace Restock Assist Queue + Audit Trail

**Status:** Complete  
**Depends on:** [048_phase_10q_marketplace_restock_assist.md](./048_phase_10q_marketplace_restock_assist.md)  
**Verification:** `node scripts/verify-inventory-phase10r-marketplace-restock-assist-queue.mjs`

---

## Goal

Add a batch review queue and audit trail for marketplace restock assist while keeping every stock mutation admin-confirmed via existing `restock_bundle_component_line`. No auto-restock, auto-RMA, reservation changes, or channel sync.

---

## 1. Queue view

**View:** `v_inventory_marketplace_restock_assist_queue`

Built on `v_inventory_marketplace_restock_assist_candidates` with observation age, stale flag, bucket, and priority.

| queue_bucket | Meaning |
|--------------|---------|
| `ready_to_restock` | `line_confirmed` + physical return confirmed (or inspected resellable) + resellable/unknown condition + max > 0 + not stale |
| `needs_physical_confirmation` | Line-confirmed workflow exists; physical return not confirmed |
| `needs_rma` | Line-confirmed but no return workflow |
| `stale_observation` | Observation older than 48h with restockable qty remaining |
| `manual_review` | SKU inferred, order-level, or other manual paths |
| `blocked` | AFN/FBA external, damaged/missing, or not finalized |
| `already_done` | `max_restockable_qty <= 0` |

**Rules:**

- Ready queue requires `line_confirmed` + physical return confirmation + resellable/unknown condition.
- Stale observations (`> 48 hours`) land in `stale_observation` — not batch-restockable without refresh.
- AFN/FBA remains blocked/manual review via `afn_external_review`.
- `suggested_restock_qty` inherited from candidates view — never exceeds `max_restockable_qty`.

---

## 2. Audit table

**Table:** `marketplace_restock_assist_actions`

| action_type | Purpose |
|-------------|---------|
| `reviewed` | Admin reviewed row in queue |
| `physical_return_confirmed` | Physical return flag set from queue |
| `restock_confirmed` | Admin confirmed restock qty (after RPC success) |
| `skipped` | Row skipped with note |
| `blocked` | Reserved for explicit block logging |
| `refreshed_observation` | Observation refresh triggered from queue |

**RPC:** `log_marketplace_restock_assist_action` — admin-only insert; **does not mutate stock**.

Restock audit includes `observation_id`, confirmed `qty`, suggested qty, and `restock_result` / `ledger_id` in `raw_context`.

---

## 3. Batch UI

**Module:** `marketplaceRestockAssistQueueModal.js`  
**Entry:** Bundle panel **Marketplace Restock Queue** button; issue routes open modal with bucket filter.

**Filters:** Ready to Restock · Needs Physical Confirmation · Needs RMA · Stale Observation · Manual Review · Blocked · Done

**Per-row actions:**

- Review
- Mark Physical Return Confirmed (when applicable)
- Create RMA (when no workflow)
- Refresh Observations
- Restock Confirmed Qty (ready bucket only; individual confirm dialog)
- Skip / Add Note

**Batch actions:**

- Mark selected reviewed
- Refresh selected observations
- **No batch restock** — each restock requires individual confirmation dialog

---

## 4. Stale-observation blocking

Threshold: **48 hours** (`STALE_OBSERVATION_HOURS` in queue API; view uses same interval).

- Stale badge shown in queue and Returns panel assist block
- **Restock Confirmed Qty** disabled when stale
- **Refresh Observations** required first; queue reload re-evaluates bucket
- Panel restock path also blocks stale `eligible_line_confirmed` rows

---

## 5. Restock RPC linkage

Unchanged stock path: **`restock_bundle_component_line`** (Phase 10G).

On success (queue modal or Returns panel):

1. Call existing restock RPC
2. Write `marketplace_restock_assist_actions` with `action_type = restock_confirmed`
3. Optionally prompt to **`link_return_workflow_restock`** when workflow exists

Audit table never changes stock.

---

## 6. Issue routing

| Issue | Primary action |
|-------|----------------|
| `marketplace_restock_assist_ready` | Open Restock Assist Queue → `ready_to_restock` |
| `marketplace_observation_stale` | Open Restock Assist Queue → `stale_observation` |

---

## 7. Verification

```bash
node scripts/verify-inventory-phase10r-marketplace-restock-assist-queue.mjs
```

Checks: queue view + audit table migration, bucket rules, stale blocking, no batch stock mutation, restock RPC + audit linkage, line-count limits, page load.

---

## 8. Limitations

- Queue limit 100 rows per bucket filter
- Batch refresh groups by channel only — not per-order parallel
- Audit does not replace component restock ledger — both records exist
- Create RMA from queue uses existing manual workflow RPC (not auto-RMA)
- Stripe marketplace assist still primarily via Returns panel; queue focuses eBay/Amazon bundle lines
- No notification/email when rows become stale

---

## 9. Recommended next phase — 10S

**Delivered in:** [050_phase_10s_restock_assist_audit_analytics.md](./050_phase_10s_restock_assist_audit_analytics.md)

Queue KPI summary, audit history viewer, snooze/review triage state.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20261012_inventory_phase10r_marketplace_restock_assist_queue.sql` | Audit table, log RPC, queue view |
| `js/admin/inventory/api/marketplaceRestockAssistQueueApi.js` | **New** queue fetch + audit log |
| `js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js` | **New** batch queue modal |
| `js/admin/inventory/ui/bundleReturnRestockPanel.js` | Stale block + restock audit log |
| `js/admin/inventory/ui/bundleReturnRestockMarketplaceAssist.js` | Stale badge + prefill block |
| `js/admin/inventory/renderers/renderBundle.js` | Queue open button |
| `js/admin/inventory/dom.js` | Modal mount |
| `pages/admin/inventory.html` | Modal mount div |
| `js/admin/inventory/services/issueActions.js` | Queue issue routes |
| `js/admin/inventory/services/issueActionHandlers.js` | `open_restock_assist_queue` handler |
| `scripts/verify-inventory-phase10r-marketplace-restock-assist-queue.mjs` | **New** verification |
