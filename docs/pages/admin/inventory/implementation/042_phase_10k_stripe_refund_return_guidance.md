# Phase 10K — Stripe Refund Refresh + Return Guidance Suggestions

**Status:** Complete  
**Depends on:** [041_phase_10j_rma_return_workflow.md](./041_phase_10j_rma_return_workflow.md)  
**Verification:** `node scripts/verify-inventory-phase10k-stripe-refund-return-guidance.mjs`

---

## Summary

Phase 10K improves refund awareness and return guidance for live virtual bundle component lines. Stripe refund details are cached in a read-only table, refreshed on demand by an admin edge function, and surfaced in the Bundle Return/Restock panel and inventory issue groups. **Guidance-first only** — no automatic RMA creation, no automatic restock, no stock/reservation/ledger mutations from refund refresh.

---

## 1. Refund data audit

### Current webhook (`stripe-webhook`)

| Aspect | Finding |
|--------|---------|
| Event | `charge.refunded` only |
| Order update | `orders_raw.refund_status`, `refund_amount_cents`, `refunded_at`, `stripe_refund_id` (latest only) |
| Line items | **No** line-level refund columns on `line_items_raw` |
| Partial refunds | Order-level `partial` vs `full` from charge `amount_refunded` vs `total_paid_cents` |
| Metadata | Webhook does not persist per-refund rows or Stripe refund list |
| Inventory | Webhook may still run legacy full-refund stock path (pre–bundle-component model) — **unchanged in 10K** |

### What can be inferred safely

| Signal | Confidence | Use |
|--------|------------|-----|
| Full order refund after finalize | High (order-level) | Suggest create return workflow; suggest restock qty = remaining component qty |
| Partial order refund | Low–medium | Manual review unless line metadata or single-line heuristic |
| Stripe metadata `stripe_line_item_id` / `line_id` on refund | High | Line-confirmed allocation in cache |
| Single-line order + refund amount ≥ line total | Medium | Line-inferred allocation |

### What remains manual

- Physical return confirmation before restock
- Partial refund → returned quantity mapping on multi-line orders
- RMA / return workflow creation (admin button only)
- Confirmed restock RPC (only stock-changing path)
- eBay / Amazon refunds (Stripe refresh is KK Store only)

---

## 2. Storage — `order_refund_details`

Observational cache table (migration `20260929_inventory_phase10k_order_refund_details.sql`):

| Column | Purpose |
|--------|---------|
| `source_order_id` | Stripe checkout session id |
| `source_order_item_id` | Nullable line allocation |
| `stripe_refund_id` | Idempotency key (partial unique index) |
| `stripe_payment_intent_id`, `stripe_charge_id` | Stripe references |
| `refund_amount_cents`, `currency`, `refund_status`, `refund_reason` | Refund summary |
| `line_allocation_confidence` | `order_level` \| `line_inferred` \| `line_confirmed` \| `none` |
| `refund_created_at`, `raw_payload` | Audit / future enrichment |

**Rules:** SELECT for authenticated; service_role write. No triggers on stock, reservations, or `inventory_return_workflow`.

---

## 3. Stripe refund refresh

**Edge function:** `supabase/functions/stripe-refresh-refund-details/index.ts`  
**Client:** `js/admin/inventory/api/refundRefreshApi.js`

| Behavior | Detail |
|----------|--------|
| Auth | JWT required (`verify_jwt = true` in config) |
| Input | `POST { stripe_checkout_session_id }` |
| Stripe | Lists refunds for payment intent; upserts `order_refund_details` by `stripe_refund_id` |
| Order sync | Updates `orders_raw` refund summary fields (same as webhook summary) |
| Excluded | Stock, reservations, ledger, return workflow |

Line allocation heuristics: refund metadata → `line_confirmed`; single-line order → `line_inferred`; else `order_level`.

**Webhook enrichment:** Deferred — admin refresh first per phase scope.

---

## 4. Guidance logic

Enhanced views in Phase 10K migration:

### `v_inventory_bundle_component_return_guidance`

New columns: `refund_guidance_status`, `refund_confidence`, `refund_detail_count`, `latest_refund_at`, `line_refund_cents`, `suggested_panel_action`.

| `refund_guidance_status` | Meaning |
|--------------------------|---------|
| `no_refund` | No refund on order |
| `full_refund_detected` | Full order refund |
| `partial_refund_detected` | Partial refund |
| `line_refund_confirmed` | Line-level refund in cache with confirmed metadata |

### `v_inventory_bundle_component_return_workflow_guidance`

Adds `refund_guidance_status_resolved`:

| Resolved status | When |
|-----------------|------|
| `refund_without_return_workflow` | Full refund, no open workflow |
| `refund_with_return_workflow_open` | Full refund + open workflow |
| `refund_restock_review_needed` | Refund + restock review suggested |
| `partial_refund_detected` | Partial refund (manual review) |

`suggested_panel_action`: `create_return_workflow`, `return_workflow_open`, `restock_review`, `manual_review`.

---

## 5. UI behavior

`bundleReturnRestockPanel.js`:

| Element | Behavior |
|---------|----------|
| **Stripe Refund block** | Amount, date, full/partial flag, confidence, detail row count |
| **Refresh Refund Data** | Calls edge function; reloads panel |
| **Partial warning** | “Manual review — refund may not represent returned quantity.” |
| **Full refund hint** | “Suggested: create return workflow…” when no workflow |
| **Create Return Workflow** | Existing workflow block (10J) — not auto-fired |
| **Open Order Line** | Deep link per candidate (10I) |
| **Copy ref** | Clipboard order reference |

---

## 6. Issue groups

Migration `20260929_inventory_phase10k_refund_issues.sql` extends `v_inventory_issues`:

| Issue type | Route |
|------------|-------|
| `refund_without_return_workflow` | Bundle Return/Restock panel + Open order line |
| `partial_refund_return_review` | Bundle Return/Restock panel + Open order line |
| `refund_restock_review_needed` | Bundle Return/Restock panel + Open order line |

JS: `issueActions.js`, `issuesApi.js`, `inventoryApi.js`, `issueDetailModal.js`.

---

## 7. Verification results

Run: `node scripts/verify-inventory-phase10k-stripe-refund-return-guidance.mjs`

| Check | Expected |
|-------|----------|
| Source files + line limits | Pass |
| `order_refund_details` + guidance columns | Pass |
| Edge function observational only | Pass |
| Refund upsert idempotent | Pass (DB) |
| Full refund → `refund_without_return_workflow` | Pass (DB) |
| Partial → manual review, no restock qty from refund alone | Pass (DB) |
| No workflow auto-create | Pass (DB) |
| No stock mutation from cache | Pass (DB) |
| Panel + config.toml | Pass |

---

## 8. Limitations

- KK Store / Stripe only for refresh action
- Order-level partial refunds on multi-line orders stay low confidence
- Webhook still stores only latest `stripe_refund_id` on `orders_raw` until refresh
- Supabase JS upsert on partial unique index may need raw SQL fallback in edge cases
- Legacy webhook full-refund stock path not removed (out of 10K scope)

---

## 9. Phase 10L follow-up — webhook enrichment

Delivered in [043_phase_10l_stripe_refund_webhook_enrichment.md](./043_phase_10l_stripe_refund_webhook_enrichment.md):

- Shared `stripeRefundDetails.ts` helper
- Automatic `order_refund_details` upsert on `charge.refunded`
- Admin refresh refactored to same normalization

---

## 10. Recommended next phase — 10M (complete)

Delivered in [044_phase_10m_multichannel_refund_observability.md](./044_phase_10m_multichannel_refund_observability.md):

- eBay/Amazon read-only refund/cancel observations view
- Marketplace guidance statuses + issue groups
- Bundle Return/Restock panel source/confidence labels

**10N:** Marketplace refund persistence + sync hardening.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20260929_inventory_phase10k_order_refund_details.sql` | Cache table + guidance views |
| `supabase/migrations/20260929_inventory_phase10k_refund_issues.sql` | Refund issue groups |
| `supabase/functions/stripe-refresh-refund-details/index.ts` | Admin refresh edge function |
| `supabase/functions/stripe-refresh-refund-details/deno.json` | Deno config |
| `supabase/config.toml` | Register edge function |
| `js/admin/inventory/api/refundRefreshApi.js` | Client refresh + labels |
| `js/admin/inventory/api/returnWorkflowApi.js` | Refund guidance field mapping |
| `js/admin/inventory/ui/bundleReturnRestockPanel.js` | Panel orchestration |
| `js/admin/inventory/ui/bundleReturnRestockRefund.js` | Refund block + refresh wiring |
| `js/admin/inventory/ui/bundleReturnRestockWorkflow.js` | Workflow block UI |
| `js/admin/inventory/api/issuesApi.js` | Refund issue samples |
| `js/admin/inventory/services/issueActions.js` | Refund issue defs |
| `js/admin/inventory/api/inventoryApi.js` | Issue labels |
| `js/admin/inventory/ui/issueDetailModal.js` | Refund issue deep links |
| `scripts/verify-inventory-phase10k-stripe-refund-return-guidance.mjs` | Verification |
| Roadmap / wiring plan / 041 / UX roadmap | Status updates |
