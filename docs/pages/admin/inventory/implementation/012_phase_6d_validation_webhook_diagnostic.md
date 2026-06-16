# Phase 6D-Validation Diagnostic — Stripe Webhook Environment Check

**Status:** Complete (read-only diagnostic — no behavior changes)  
**Date:** 2026-06-09  
**Prerequisite:** Phase 6D-Validation attempt (checkout not found in linked DB)  
**Related:** [011_phase_6d_validation_shadow_checkout.md](./011_phase_6d_validation_shadow_checkout.md)

---

## Summary

Phase 6D shadow validation failed because **no post-checkout artifacts appeared** in the linked Supabase database. This diagnostic documents the **expected webhook environment**, confirms repo/deploy alignment, and provides manual Stripe + Supabase checks to find where the checkout went.

**Conclusion:** Linked DB, frontend config, and deployed `stripe-webhook` all point to **`yxdzvzscufkvewecvagq`**. The checkout likely **never delivered `checkout.session.completed`** to that endpoint (wrong Stripe account/mode, wrong webhook URL, payment not completed, or event delivery failure).

---

## Linked Supabase project

| Item | Value |
|------|-------|
| **Project ref** | `yxdzvzscufkvewecvagq` |
| **Name** | Karry Kraze Website |
| **Region** | West US (Oregon) |
| **CLI link** | `●` linked (via `npx supabase db query --linked`) |
| **Frontend** | `js/config/env.js` → `https://yxdzvzscufkvewecvagq.supabase.co` ✓ |
| **Validation scripts** | `scripts/supabase/dbConnect.mjs` → `PROJECT_REF = yxdzvzscufkvewecvagq` ✓ |

**Other project in same org (not linked):** `worvqswzdixjgwtjqtub` (KKNumbers). If Stripe webhook points there, orders will **not** appear in validation queries.

---

## Expected Stripe webhook URL

```
https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/stripe-webhook
```

| Config | Value |
|--------|-------|
| Function | `stripe-webhook` |
| `verify_jwt` | `false` (required for Stripe signatures) |
| Deploy command | `npx supabase functions deploy stripe-webhook` |
| Last deploy (CLI list) | **2026-06-09 18:30:38 UTC** (includes Phase 6C dedup + shadow) |
| Entrypoint | `supabase/functions/stripe-webhook/index.ts` |
| Shared inventory helpers | `supabase/functions/_shared/stripeWebhookInventory.ts` |

### Edge function environment variables (names only)

Set as Supabase secrets on linked project:

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Stripe API (must match live/test mode of checkout) |
| `STRIPE_WEBHOOK_SECRET` | Verifies `stripe-signature` header (must match Stripe Dashboard endpoint signing secret) |
| `SUPABASE_URL` | Auto-injected / secret — should be `https://yxdzvzscufkvewecvagq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | DB writes from webhook |

**Mismatch symptom:** Event delivers but function returns **400 Invalid signature** → no DB writes.

---

## Expected Stripe mode

Historical KK orders in linked DB use **`cs_live_*`** session ids → production store runs **Stripe Live mode**.

| Mode | Session prefix | Webhook endpoint |
|------|----------------|------------------|
| Live | `cs_live_` | Live mode webhook in Stripe Dashboard |
| Test | `cs_test_` | Test mode webhook in Stripe Dashboard |

**Common failure:** Checkout created with live key but webhook configured only in test mode (or vice versa). Event exists in Dashboard but under the **other** mode tab.

---

## Expected event type

**`checkout.session.completed`**

Other events (`charge.refunded`, etc.) are handled but do not create new orders.

---

## Tables touched after successful checkout

| Table | Expected change |
|-------|-----------------|
| `orders_raw` | Upsert 1 row (`stripe_checkout_session_id`, `kk_order_id`, …) |
| `line_items_raw` | Upsert line rows |
| `fulfillment_shipments` | Ensure row (`label_status=pending`) |
| `product_variants` | Stock decrement (legacy shadow mode) |
| `stock_ledger` | 1+ rows `reason='order'`, negative `change` |
| `inventory_event_dedup` | 1 row `action_type='checkout_stock_deduct'` (Phase 6C+) |
| `inventory_reservations` | 1+ rows `is_shadow=true`, `status='reserved'` (Phase 6C+, when variant resolves) |

---

## What validation found missing (2026-06-09)

| Artifact | Found |
|----------|------:|
| New `orders_raw` (order_date ≥ 2026-06-09) | 0 |
| New `stock_ledger` `reason='order'` today | 0 |
| `inventory_event_dedup` rows (all time) | 0 |
| `inventory_reservations` rows (all time) | 0 |
| `post_6c_matched_lines` | 0 |
| Latest KK order | **2026-06-06** (`KKO-824779`) |

Today's ledger: only `parcel_receive` and `manual_adjustment`.

---

## Likely environment mismatch causes

1. **Payment not completed** — cart abandoned before Stripe confirmation; no `checkout.session.completed`.
2. **Stripe Live vs Test** — event fired in mode where webhook endpoint is not configured.
3. **Wrong webhook URL** — endpoint points to old URL, different Supabase project (`worvqswzdixjgwtjqtub`), or localhost.
4. **Wrong signing secret** — delivery returns 400; Stripe shows failed attempts.
5. **Wrong Stripe account** — checkout on different Stripe business account than webhook listener.
6. **Checkout on non-production site** — stale GitHub Pages deploy pointing at different Supabase (unlikely: `env.js` is committed to `yxdzvzscufkvewecvagq`).
7. **Function error before DB write** — rare; would still show in Supabase function logs with 500 response.

---

## Read-only diagnostic script

```bash
node scripts/verify-stripe-webhook-environment-readiness.mjs
node scripts/verify-stripe-webhook-environment-readiness.mjs --since 2026-06-09T00:00:00Z
node scripts/verify-stripe-webhook-environment-readiness.mjs --session cs_live_...
node scripts/verify-stripe-webhook-environment-readiness.mjs --order KKO-123456
```

Checks: project ref alignment, latest orders, ledger/dedup/reservations, optional session/order lookup. **Writes nothing.**

---

## Manual Stripe Dashboard checklist

1. Open [Stripe Dashboard → Developers → Events](https://dashboard.stripe.com/events).
2. Toggle **Live / Test** to match how you paid (site history = **Live**).
3. Search by:
   - Checkout session id `cs_live_...` or `cs_test_...`
   - Event id `evt_...`
   - Payment intent id if known
4. Find event type **`checkout.session.completed`** for your purchase time.
5. If **no event** → checkout did not complete in this Stripe account/mode.
6. If event exists → open it → **Webhook attempts** section:
   - **Endpoint URL** — must be `https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/stripe-webhook`
   - **Response code** — expect **200**
   - If **400** → signing secret mismatch (`STRIPE_WEBHOOK_SECRET`)
   - If **500** → open response body / Supabase logs
   - If delivered to **different URL** → document mismatch (e.g. KKNumbers project, old endpoint)
7. Copy error message if failed.

### Webhook endpoint configuration

Developers → Webhooks → select endpoint → verify:

- URL matches expected above
- Events include `checkout.session.completed` (and `charge.refunded` for refunds)
- Signing secret matches Supabase secret `STRIPE_WEBHOOK_SECRET`

---

## Supabase function log inspection

CLI `supabase functions logs` is **not available** in current CLI version. Use Dashboard:

1. [Supabase Dashboard → Functions → stripe-webhook → Logs](https://supabase.com/dashboard/project/yxdzvzscufkvewecvagq/functions/stripe-webhook/logs)
2. Filter around checkout time
3. Search for:
   - `[stripe-webhook]`
   - `checkout.session.completed`
   - Session id `cs_...`
   - `Invalid signature` / `stock decrement` / `shadow reservation`
   - `checkout stock deduct dedup skip`

Successful checkout log patterns (Phase 6C):

- `stock: ... → ... (-1)`
- `shadow reservation: {session}/{lineItemId} qty=1`
- Or `checkout stock deduct dedup skip` on replay only

---

## Checkout flow reference (for tracing)

```
Browser checkout → create-checkout-session (edge function, same project)
                → Stripe Checkout (cs_live_ or cs_test_)
                → payment complete
                → Stripe POST → stripe-webhook (checkout.session.completed)
                → orders_raw + line_items + stock + shadow
```

Frontend invoke: `js/checkout/index.js` → `supabase.functions.invoke("create-checkout-session", ...)`

Both functions must use same Supabase project secrets as linked DB.

---

## What to provide if checkout still not found

| Identifier | Example | Where to find |
|------------|---------|---------------|
| Stripe session id | `cs_live_...` | Stripe confirmation email, success page URL, Dashboard |
| Stripe event id | `evt_...` | Stripe Dashboard → Events |
| KK order id | `KKO-123456` | Success page, Stripe metadata |
| Approx checkout time | timezone + date | Your records |
| Live vs test | live / test | Stripe session prefix |
| Webhook delivery screenshot | URL + status code | Stripe event detail |

Then run:

```bash
node scripts/verify-stripe-webhook-environment-readiness.mjs --session cs_live_...
node scripts/verify-inventory-phase6d-validation-readiness.mjs
```

---

## Can 6D validation be retried?

**Yes**, after one successful webhook delivery creates:

- `orders_raw` row for new session
- `inventory_event_dedup` checkout row
- `inventory_reservations` shadow row(s)
- `post_6c_matched_lines >= 1`
- `safe_to_proceed_hint = true` (with zero active blockers)

**Phase 6D execute is not recommended until validation passes.**

---

## Deploy reference (no changes made in this phase)

```bash
# Deploy webhook to linked project (already done 2026-06-09)
npx supabase functions deploy stripe-webhook

# Confirm linked project
npx supabase projects list

# Confirm function active
npx supabase functions list
```

---

## Verification

**Script:** `scripts/verify-stripe-webhook-environment-readiness.mjs` — read-only  
**No stock, reservation, webhook, or mode changes in this phase.**
