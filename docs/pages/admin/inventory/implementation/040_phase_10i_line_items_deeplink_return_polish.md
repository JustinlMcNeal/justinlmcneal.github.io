# Phase 10I — Line Items Deep-Link Focus + Return Workflow Polish

**Status:** Complete  
**Depends on:** [039_phase_10h_partial_refund_return_guidance.md](./039_phase_10h_partial_refund_return_guidance.md)  
**Verification:** `node scripts/verify-inventory-phase10i-line-items-deeplink-return-polish.mjs`

---

## Summary

Phase 10I improves operational navigation between Inventory admin and Line Items Orders. Deep links now reliably open the correct order workspace, switch tabs, scroll to a line, and highlight it temporarily. The Bundle Return/Restock panel gains per-candidate order-line actions, copyable references, selection persistence, restock result feedback, and a dismissible post-restock checklist. **UI/navigation only** — no stock, reservation, or ledger behavior changes beyond existing confirmed restock RPC (10G/10H).

---

## 1. URL param behavior

Supported Line Items Orders query params:

| Param | Purpose |
|-------|---------|
| `session_id` | Primary order key (Stripe / eBay / Amazon session id) |
| `order_id` | Alias for `session_id` |
| `line_id` | Line item id to scroll + highlight on Overview |
| `channel` | `ebay` \| `amazon` \| `kk` — disambiguation hint |
| `tab` | `overview` \| `fulfillment` \| `financials` \| `labels` \| `ids` |
| `q` | Search prefill (also set automatically by `buildLineItemsOrdersUrl`) |

Shared helpers in `js/admin/inventory/constants/orderLinks.js`:

- `buildLineItemsOrdersUrl(opts)` — canonical link builder
- `parseLineItemsDeepLinkParams(searchParams)` — parse incoming URLs
- `channelFromOrderId(orderId)` — infer channel from id prefix
- `buildOrderReferenceLabel(opts)` — clipboard-friendly label
- `buildInventoryPageUrl({ q })` — inventory page with optional SKU search hint

**Consumers consolidated to shared helper:**

- Bundle Return/Restock panel
- Issue detail modal (return + mapping samples)
- Shipped Finalize Audit
- Mapping Assist
- Post-map Queue (`postMapQueueRowActions.js` — unchanged, already used helper)
- Post-map Checklist (via `openQueueOrder`)

---

## 2. Focus / highlight behavior

`js/admin/lineItemsOrders/index.js` — `applyLineItemsDeepLink`:

1. Prefills search from `q` / `session_id` / `order_id` (existing).
2. After initial table load, finds order in loaded rows **or** calls `fetchOrderSummaryRow` (new API helper).
3. Opens workspace with requested tab (defaults to `overview` when `line_id` present without `tab`).
4. If order not found anywhere → status bar: `Order not found for deep link: …`

`js/admin/lineItemsOrders/workspace.js`:

- Overview tab: scrolls matching `[data-ws-line-item="…"]` into view, pink ring + pulse animation (~3.5s), then fades ring.
- Line not on order → banner: **“Order opened, but line could not be found in the loaded items.”**
- Non-overview tab + `line_id` → info banner with **Switch to Overview** button.

---

## 3. Return panel UI changes

`bundleReturnRestockPanel.js`:

| Change | Detail |
|--------|--------|
| **Open Order Line** | Per-candidate button with full deep link (`session_id`, `line_id`, `channel`, `tab=overview`) |
| **Copy ref** | Copies `buildOrderReferenceLabel` to clipboard |
| **Selection preserve** | Selected candidate ring + scroll restored after panel refresh post-restock |
| **Restock result** | Shows last RPC result on matching candidate (qty, stock_after, idempotent replay) |
| **Evidence row** | Reservation id (tooltip), finalize ledger link → Inventory, restock ledger id after confirm, order line link |

`bundleReturnRestockChecklist.js`:

- **Dismiss** button — checklist stays until dismissed or page reload
- Re-shown after panel refresh if restock just completed and not dismissed
- Inventory link uses `buildInventoryPageUrl({ q: componentSku })`

---

## 4. Limitations

| Limitation | Notes |
|------------|-------|
| Line focus only on Overview | Other tabs show switch prompt |
| No dedicated reservation/ledger admin routes | Evidence links use Inventory page + tooltips |
| Inventory `?q=` hint not auto-applied on load | URL param reserved for future; link still valid |
| Clipboard copy requires secure context | Falls back to toast error on HTTP without permission |
| Deep-link order fetch uses search (`q=`) | Rare collisions if search matches multiple orders |
| Selection/checklist state is in-memory | Lost on full page reload |

---

## 5. Verification results

Run:

```bash
node scripts/verify-inventory-phase10i-line-items-deeplink-return-polish.mjs
```

Static checks:

- Shared URL helpers and param wiring
- Line Items deep-link fetch + not-found messages
- Workspace scroll/highlight + line-not-found banner
- Return panel polish controls
- Navigation modules do not invoke restock RPC
- File line-count limits
- Inventory + Line Items pages load without JS module 404s

---

## 6. Recommended next phase — 10J (complete) · 10K

See [041_phase_10j_rma_return_workflow.md](./041_phase_10j_rma_return_workflow.md) for RMA workflow. **10K:** Stripe per-line refund refresh + guidance auto-suggest.

---

## Files touched

| File | Change |
|------|--------|
| `js/admin/inventory/constants/orderLinks.js` | Shared parse/build/copy helpers |
| `js/admin/lineItemsOrders/api.js` | `fetchOrderSummaryRow` |
| `js/admin/lineItemsOrders/index.js` | Robust deep-link open + fetch fallback |
| `js/admin/lineItemsOrders/workspace.js` | Scroll, highlight, banners |
| `js/admin/inventory/ui/bundleReturnRestockPanel.js` | Return workflow polish |
| `js/admin/inventory/ui/bundleReturnRestockChecklist.js` | Dismiss + inventory URL helper |
| `js/admin/inventory/ui/shippedFinalizeAuditModal.js` | Deep links per audit row |
| `js/admin/inventory/ui/mappingAssistModal.js` | Open Order Line link |
| `js/admin/inventory/ui/issueDetailModal.js` | Order line links + channel |
| `scripts/verify-inventory-phase10i-line-items-deeplink-return-polish.mjs` | Verification |
| Roadmap / wiring plan / 10H doc | Status updates |
