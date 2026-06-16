# Phase 10L — Stripe Refund Webhook Enrichment

**Status:** Complete  
**Depends on:** [042_phase_10k_stripe_refund_return_guidance.md](./042_phase_10k_stripe_refund_return_guidance.md)  
**Verification:** `node scripts/verify-inventory-phase10l-stripe-refund-webhook-enrichment.mjs`

---

## Summary

Phase 10L adds idempotent webhook enrichment so `order_refund_details` is populated automatically on `charge.refunded`, using the same normalization and upsert rules as admin refresh. **Observational only** — legacy refund stock/reservation behavior is unchanged.

---

## 1. Webhook path audited

### Event types handled (`stripe-webhook`)

| Event | Behavior |
|-------|----------|
| `charge.refunded` | Order summary update + **10L refund detail enrichment** + legacy full-refund stock path |
| `checkout.session.completed` | Order/line upsert + inventory reservation/deduct |
| Other | Ignored (`received: true, ignored: true`) |

### `charge.refunded` — available data

| Field | Use |
|-------|-----|
| `charge.payment_intent` | Resolve checkout session / order |
| `charge.amount_refunded` | Order-level summary on `orders_raw` (unchanged) |
| `charge.amount` | Full vs partial heuristic |
| `charge.refunds.data` | Embedded refund list (may be partial page) |
| Stripe `refunds.list({ charge })` | Full refund list (preferred in 10L helper) |

Each refund object provides: `id`, `amount`, `currency`, `status`, `reason`, `created`, `charge`, `metadata` (optional line hints).

### Order resolution

Shared helper `resolveOrderSessionFromPaymentIntent`:

1. `checkout.sessions.list({ payment_intent })`
2. Fallback: `orders_raw.stripe_payment_intent_id`

### Legacy stock guard

Full-refund inventory still uses `claimStripeInventoryDedup(..., DEDUP_REFUND_STOCK_RESTORE, ...)` — **separate** from refund detail enrichment. Enrichment runs in its own non-fatal try/catch before stock logic.

---

## 2. Shared helper — `stripeRefundDetails.ts`

| Function | Responsibility |
|----------|----------------|
| `buildLineTotalsMap` | Line amount map from `line_items_raw` |
| `classifyLineAllocation` | `order_level` / `line_inferred` / `line_confirmed` |
| `normalizeRefundDetailRow` | Canonical row shape for `order_refund_details` |
| `upsertRefundDetailRow` | Idempotent upsert by `stripe_refund_id` |
| `enrichOrderRefundDetails` | Batch upsert for refund array |
| `enrichRefundDetailsFromChargeEvent` | Webhook entry point |
| `fetchAllRefundsForPaymentIntent` | Admin refresh list |
| `fetchAllRefundsForCharge` | Webhook list (API + embedded fallback) |
| `summarizeRefunds` / `syncOrdersRawRefundSummary` | Admin refresh order summary |

**Does not:** mutate stock, reservations, ledger, return workflows, or call restock RPCs.

---

## 3. Webhook enrichment behavior

On `charge.refunded`, after `orders_raw` summary update:

```typescript
try {
  await enrichRefundDetailsFromChargeEvent({ sb, stripe, charge, sessionId, paymentIntentId });
} catch (enrichErr) {
  console.error("[stripe-webhook] refund detail enrichment failed (non-fatal):", enrichErr);
}
```

- Lists all refunds for the charge via Stripe API when possible
- Upserts each into `order_refund_details` with `sync_source = 'webhook'`
- Failure does not fail the webhook response or block legacy stock restore

---

## 4. Admin refresh reuse

`stripe-refresh-refund-details` imports the same helper:

- `fetchAllRefundsForPaymentIntent` → `enrichOrderRefundDetails({ syncSource: 'admin_refresh' })`
- `summarizeRefunds` + `syncOrdersRawRefundSummary` for order summary

Webhook and admin paths produce identical row shapes (including `line_allocation_confidence`, `raw_payload`).

---

## 5. Return guidance refresh

No view changes required — existing `refund_agg` in `v_inventory_bundle_component_return_guidance` reads from `order_refund_details`. Webhook-populated rows update `refund_detail_count` and guidance automatically.

Optional `sync_source` column added for audit (`webhook` vs `admin_refresh`).

---

## 6. Idempotency strategy

| Layer | Mechanism |
|-------|-----------|
| Row | Unique index on `stripe_refund_id` + upsert |
| Webhook retry | Re-upsert same refund ids — no duplicate rows |
| Stock restore | Unchanged `DEDUP_REFUND_STOCK_RESTORE` per event id |

---

## 7. What remains observational / manual

**Observational (automatic):** refund detail cache, guidance counts, issue group inputs

**Manual (unchanged):**

- Return workflow creation
- Confirmed component restock RPC
- Partial multi-line refund quantity mapping
- Physical return / resellable condition confirmation

---

## 8. Verification results

```bash
node scripts/verify-inventory-phase10l-stripe-refund-webhook-enrichment.mjs
```

| Check | Expected |
|-------|----------|
| Shared helper exists | Pass |
| Webhook imports enrichment | Pass |
| Non-fatal enrichment wrapper | Pass |
| Admin refresh uses helper | Pass |
| Legacy stock dedup unchanged | Pass |
| Idempotent upsert | Pass (DB when connected) |
| No workflow auto-create | Pass (DB) |
| Inventory page loads | Pass |

---

## 9. Limitations

- KK Store / Stripe only
- Webhook uses charge-scoped refund list; admin uses payment-intent list (should match for standard checkouts)
- `sync_source` not yet shown in UI (detail count reflects webhook data)
- Legacy webhook full-refund stock path still active (intentionally unchanged)

---

## 10. Recommended next phase — 10M (complete)

See [044_phase_10m_multichannel_refund_observability.md](./044_phase_10m_multichannel_refund_observability.md) for eBay/Amazon read-only refund observability.

**10N:** Marketplace refund persistence + sync hardening.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/_shared/stripeRefundDetails.ts` | **New** shared normalization/upsert |
| `supabase/functions/_shared/stripeWebhookChargeRefunded.ts` | **New** charge.refunded handler |
| `supabase/functions/stripe-webhook/index.ts` | Delegates to charge refunded handler |
| `supabase/functions/stripe-refresh-refund-details/index.ts` | Refactored to shared helper |
| `supabase/migrations/20261001_inventory_phase10l_refund_sync_source.sql` | `sync_source` column |
| `scripts/verify-inventory-phase10l-stripe-refund-webhook-enrichment.mjs` | Verification |
| Roadmaps + 042 doc | Status updates |
