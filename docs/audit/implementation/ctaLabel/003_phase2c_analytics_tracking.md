# Phase 2C: CTA Label Print Analytics Tracking

## Status: Implemented (not yet deployed)

---

## DB Approach: Option B — Separate `cta_label_prints` Table

**Chosen over Option A (columns on `fulfillment_shipments`) because:**

- Print events are time-stamped analytics events, not fulfillment operational state.
- An order can be printed multiple times (reprints, test prints before packing).
- Separating event data keeps `fulfillment_shipments` focused on shipping workflow state.
- Consistent with existing event log pattern: `coupon_attempt_logs`, `shippo_webhook_events`, `ebay_finance_transactions`.

---

## Migration File

`supabase/migrations/20260517_cta_label_prints.sql`

### Table: `cta_label_prints`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `session_id` | `text NOT NULL` | `stripe_checkout_session_id` (or `ebay_api_` prefix) |
| `kk_order_id` | `text NULL` | Null for eBay (no kk_order_id) |
| `order_source` | `text NOT NULL` | `'kk'` or `'ebay'` |
| `label_type` | `text NOT NULL` | `'review_cta'` or `'channel_cta'` |
| `printed_at` | `timestamptz NOT NULL` | `DEFAULT now()` |
| `printed_by` | `text NULL` | Reserved for future admin auth |
| `metadata` | `jsonb NOT NULL` | `DEFAULT '{}'` — for future enrichment |

### RLS

- `anon INSERT` — browser admin JS uses anon key (no Supabase Auth on admin page).
- `service_role ALL` — edge functions for future reporting / backfills.
- No anon SELECT — analytics reads handled separately (future admin views).

### Indexes

- `idx_cta_label_prints_session_id` — "how many prints for this order?"
- `idx_cta_label_prints_printed_at` — time-series queries
- `idx_cta_label_prints_label_type` — review_cta vs. channel_cta breakdown
- `idx_cta_label_prints_order_source` — channel breakdown

---

## API Helper Added

`js/admin/lineItemsOrders/api.js` — `export async function trackCtaLabelPrint(...)`

```js
trackCtaLabelPrint({ sessionId, kkOrderId, orderSource, labelType, metadata })
// Returns: { ok: true } | { ok: false, error: string }
// Never throws — caller handles failure as non-blocking.
```

---

## Tracking Flow

```
Admin clicks "Print CTA" button
  ↓ wireCta() in index.js
  ↓ printLabel(row, { onPrinted: async ({ order, source, labelType }) => { ... } })
      ↓ window.open() [synchronous — popup opens]
      ↓ generateQrDataUrl() [async]
      ↓ buildLabelHtml() [sync]
      ↓ pw.document.write(html) [print window ready]
      ↓ onPrinted callback fires
          ↓ trackCtaLabelPrint({ sessionId, kkOrderId, orderSource, labelType }) [api.js]
              ↓ supabase.from("cta_label_prints").insert(...)
              ↓ returns { ok: true } or { ok: false, error }
      ↓ wireCta() reads result:
          - ok: true  → setStatus("CTA label opened for printing.")
          - ok: false → setStatus("CTA label opened, but print tracking failed.")
```

### Dependency Direction

```
index.js → api.js (trackCtaLabelPrint)
index.js → labelPrint.js (printLabel)
labelPrint.js → dom.js (getOrderSource, esc)
labelPrint.js does NOT import api.js — no circular dependency
```

---

## What Is Tracked

- `session_id` — links to the order
- `kk_order_id` — for KK orders (enables join to reviews)
- `order_source` — channel breakdown (kk vs. ebay)
- `label_type` — which CTA (review_cta vs. channel_cta)
- `printed_at` — timestamp (auto, server-side)

## What Is Intentionally NOT Tracked Yet

- **QR scans** — requires a redirect/tracking URL; deferred to Phase 2D
- **Coupon redemption** — tracked separately via existing coupon system
- **Print window close** — not reliably detectable cross-origin
- **Admin identity** — `printed_by` column reserved but null; admin auth not implemented
- **UTM parameters** — implicit in `label_type` (can be derived)

---

## Failure Handling

| Scenario | Behavior |
|---|---|
| Print window blocked by popup blocker | `alert()` shown; tracking skipped |
| QR generation fails | Fallback text URL used; print continues; tracking fires |
| `trackCtaLabelPrint` fails (network, RLS) | Console warning; status shows "tracking failed"; print still happened |
| `printLabel` throws before `onPrinted` | `wireCta` catches; `setStatus(..., true)` shows error; no tracking |

---

## Future: Phase 2D (QR Scan Tracking)

To track QR scans, route the QR code through a redirect:

```
https://karrykraze.com/r?lp=review&sid=<session_id>&t=<timestamp_hash>
→ /r/index.html reads params → logs scan → 301 to leave-review.html?oid=...
```

The `metadata` column on `cta_label_prints` can receive the `qr_target` URL now,
enabling Phase 2D to correlate scans with prints by session_id + date.
