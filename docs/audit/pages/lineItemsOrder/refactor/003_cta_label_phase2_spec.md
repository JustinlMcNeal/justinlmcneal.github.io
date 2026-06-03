# CTA Label Feature — Phase 2 Spec (Reference Only)

**Doc ID:** 003  
**Created:** 2026-05-17  
**Status:** NOT IMPLEMENTING — planning document only  
**Phase:** Phase 2 (future — do not start until Phase 1 refactor is complete)  
**Depends on:** `001_module_audit.md`, `002_refactor_plan.md`

---

## Purpose

This document defines the intended behavior of the CTA label feature so Phase 1 refactor
decisions (seams, stub module, `getOrderSource()`) can be made with the Phase 2 design in mind.

Nothing in this document should be implemented until the Phase 1 refactor is merged and verified.

---

## 1. Feature Summary

For each order, print a packing insert or label that includes:

| Order source | Label type | Content |
|---|---|---|
| KK website (`kk`) | **Review CTA** | "Thanks for ordering!" + QR→ review page + 15% first-website-order discount |
| eBay (`ebay`) | **Channel CTA** | "Order direct at karrykraze.com for a lower price" + QR → homepage |
| Amazon (`amazon`) | **Channel CTA** | Same as eBay (placeholder until Amazon API connects) |
| Unknown | None | No label rendered |

---

## 2. Label Anatomy

### KK Review CTA Label

```
┌─────────────────────────────────┐
│  KARRY KRAZE                    │
│  Thanks for your order! 💖      │
│                                 │
│  [QR CODE]                      │
│  Scan to leave a review         │
│  & get 15% off your next order  │
│                                 │
│  karrykraze.com                 │
└─────────────────────────────────┘
```

- QR target: `https://karrykraze.com/pages/leave-review?order=<kk_order_id>`
- Discount: 15% coupon — either a per-order generated code or a generic reusable code
- Size: print-optimized — 3.5" × 2" (business card) or 4" × 6" (insert)

### eBay / Amazon Channel CTA Label

```
┌─────────────────────────────────┐
│  KARRY KRAZE                    │
│  Order direct for a            │
│  lower price!                   │
│                                 │
│  [QR CODE]                      │
│  karrykraze.com                 │
└─────────────────────────────────┘
```

- QR target: `https://karrykraze.com`
- No discount code

---

## 3. Technical Components Needed

### 3a. `labelPrint.js` (stub created in Phase 1)

Full implementation in Phase 2:

```js
export function determineLabelType(source) {
  if (source === "kk") return "review_cta";
  if (source === "ebay" || source === "amazon") return "channel_cta";
  return "none";
}

export function buildLabelHtml(order, labelType) {
  if (labelType === "none") return "";
  // renders print-safe HTML string
  // calls QR generation helper
  // returns complete label HTML
}

export async function printLabel(order) {
  const source = getOrderSource(order);
  const type = determineLabelType(source);
  const html = buildLabelHtml(order, type);
  // open print window with label HTML
}

export async function trackLabelPrint(sessionId) {
  // record label_printed_at in fulfillment_shipments or separate table
}
```

### 3b. QR Code generation

Phase 2 must decide: client-side library or server-generated image.

**Option A (preferred):** CDN QR code library (e.g. `qrcode` via `esm.sh`).
Keeps it client-side, no edge function needed. Generate a `<canvas>` or SVG inline.

**Option B:** Edge function that generates a QR image URL. More overhead for a simple label.

### 3c. Discount code

Decision tree:
1. **Generic reusable code** (e.g. `THANKS15`) — simplest. No per-order DB write. Survives
   across orders. Downside: code could be shared by customers.
2. **Per-order generated code** — requires a DB migration (`coupons` table entry per order),
   a Supabase Edge Function call, and expiry logic. High effort.
3. **Order-specific URL** — embed the order ID in the QR URL and generate the discount on
   the review landing page server-side.

Recommendation for Phase 2 start: use a generic code like `THANKS15` to avoid DB complexity.
Upgrade to per-order codes in a future iteration if Analytics shows abuse.

### 3d. Label print UI

Options for where to place the Print Label trigger:

**Option A:** "Print Label" button in each order row (desktop table + mobile card).
- Requires the row seam from R-04. Lowest friction — click from the table without opening workspace.

**Option B:** "Labels" workspace tab — preview + print button.
- More space for preview. User must open the workspace first.

**Recommendation:** Both. Row button for quick print, workspace tab for full preview and analytics.

### 3e. Analytics

Track: `label_printed_at`, `label_type`, optional `coupon_code_shown`.

**Minimal DB change:** Add `label_printed_at TIMESTAMPTZ` and `label_type TEXT` to
`fulfillment_shipments`. Upsert on print.

**Migration required before Phase 2 start.** Add to `supabase/migrations/`.

---

## 4. Out of Scope for Phase 2

| Item | Notes |
|---|---|
| Amazon API integration | Phase 2 label uses TSV-imported orders only |
| Per-order coupon code generation | Start with generic code; upgrade later |
| Email delivery of label | Print-only for Phase 2 |
| Label design editor UI | Hardcoded template for Phase 2 |
| Label performance reporting | Phase 3 — requires scan tracking on the review page |

---

## 5. Phase Gates

| Gate | Condition |
|---|---|
| Phase 1 complete | All refactor items (R-01 through R-06) are merged and QA-checked |
| Phase 2 start | Phase 1 complete + DB migration for `label_printed_at` drafted |
| Phase 2 feature flag | (optional) Gate label UI behind an admin feature flag so it can be shipped dark |
| Phase 2 complete | Label renders correctly for KK orders, eBay orders; print opens correctly; analytics write succeeds |
