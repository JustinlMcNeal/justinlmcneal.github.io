# Phase 1 — Static UX Shell Complete

**Project:** KK Universal Storage  
**Phase:** 1 — Static UX / page shell  
**Completed:** 2026-06-09  
**Page:** `pages/admin/inventory.html`

---

## Summary

Built the Karry Kraze admin **Inventory** dashboard as a static UX shell with mock data. The page matches Amazon Listings admin visual language and implements all sections from the Phase 1 spec. No Supabase, ledger, channel sync, or order deduction wiring was added.

---

## Deliverables

| Item | Status |
|------|--------|
| UX roadmap | `docs/pages/admin/inventory/ux/roadmap.md` |
| Page shell | `pages/admin/inventory.html` |
| JS modules | `js/admin/inventory/` (root entry + `renderers/` + `utils/`) |
| Page CSS | `css/pages/admin/inventory.css` |
| Admin nav link | `page_inserts/admin-nav.html` (desktop + mobile) |

---

## Sections implemented

1. **Header** — Admin Panel kicker, title, subtitle, Sync Channels / Receive Stock / Export / Settings
2. **Connection strip** — KK Store, eBay, Amazon connected + Last Global Sync + Live badge
3. **KPI cards (8)** — Total SKUs 188, On Hand 642, Reserved 14, Available 628, Low Stock 9, Unmapped 3, Issues 6, Last Channel Sync 12 min ago
4. **Work area tabs (4)** — All Inventory, Low Stock, Unmapped, Issues with counts
5. **Alerts strip** — 5 pill alerts (unmapped, negative stock, eBay ended, Amazon inactive, parcel mapping)
6. **Search + filters** — 7 filter dropdowns + settings icon; client-side filter on mock rows
7. **Inventory table** — Full column set, channel mismatch diffs, negative stock row, mobile cards
8. **Recent Stock Ledger** — 6 placeholder entries with reason/source/reference
9. **Inventory Issues** — All 5 issue types with severity and affected counts
10. **Bundle Rules (Future)** — Placeholder copy for separate SKU treatment

---

## Mock data highlights

Sample products: Ribbed Knit Earflap Beanie, Puffy Heart Bag Charm, Star Keychain, Bow Beanie, Checkered Lanyard, Brass D Ring x3.

Channel mismatch examples:

- eBay 40 vs on-hand 38 (−2 diff badge)
- Amazon 41 vs on-hand 40 (+1 diff badge)
- Brass D Ring x3 — negative on-hand (−2), eBay listing ended

---

## Verification

| Check | Result |
|-------|--------|
| Page HTTP 200 | Pass |
| JS modules load | Pass |
| Console errors (Playwright) | None |
| KPI cards rendered | 8 |
| Work area tabs | 4 |
| Inventory row nodes | 10 SKUs (20 DOM nodes — desktop + mobile) |
| Admin nav Inventory link | Present |

**Local verify:** serve repo root, open `/pages/admin/inventory.html`

---

## Intentionally not implemented

- Supabase reads/writes
- `stock_ledger` mutations
- Order reserve / finalize / reverse
- Channel quantity sync (Amazon/eBay/KK push)
- eBay relist automation
- Parcel import / CPI / fulfillment logic changes
- Admin auth gate on this page (nav loads without login; wiring phase will add `requireAdmin`)

---

## Assumptions

- **Unified stock model in UI** — table shows universal on-hand/reserved/available plus per-channel columns for comparison; future sync will push `available` to all channels equally.
- **Receive Stock button** — placeholder toast; future link to Parcel Imports receive flow or inline receive modal.
- **10 mock table rows** — representative subset of 188 total SKUs; KPI/tab counts reflect full fictional catalog.
- **Client-side tabs/filters** — demonstrate UX only; counts on tabs do not update when filters change (full catalog counts stay static).

---

## Follow-up recommendations

1. **Phase 3:** Baseline `stock_ledger` migration + `v_inventory_kpis` / ledger views — see [implementation/001_wiring_plan.md](../implementation/001_wiring_plan.md) §16.
2. Define `inventory_reservations` and order idempotency keys before Phase 6.
3. Wire **Receive Stock** to Parcel Imports receive flow (Phase 5); do not rewrite RPC until audited.
4. Reuse Amazon/eBay auth for connection strip in Phase 3.
5. Add `requireAdmin` session gate in Phase 3.
6. Plan stripe-webhook transition (payment deduct → reserve) before Phase 6.

---

## JS module layout

```
js/admin/inventory/
├── index.js          — page entry
├── dom.js            — DOM mount refs
├── events.js         — tabs, filters, placeholder actions
├── mockData.js       — static placeholder data
├── renderers/
│   ├── renderKpis.js
│   ├── renderChannelStatus.js
│   ├── renderInventoryTable.js
│   ├── renderLedger.js
│   ├── renderIssues.js
│   └── renderBundle.js
└── utils/
    └── formatters.js — shared esc() helper
```

---

## Files created

```
pages/admin/inventory.html
css/pages/admin/inventory.css
js/admin/inventory/index.js
js/admin/inventory/dom.js
js/admin/inventory/mockData.js
js/admin/inventory/events.js
js/admin/inventory/renderers/renderKpis.js
js/admin/inventory/renderers/renderChannelStatus.js
js/admin/inventory/renderers/renderInventoryTable.js
js/admin/inventory/renderers/renderLedger.js
js/admin/inventory/renderers/renderIssues.js
js/admin/inventory/renderers/renderBundle.js
js/admin/inventory/utils/formatters.js
docs/pages/admin/inventory/ux/roadmap.md
docs/pages/admin/inventory/ux/001_static_ux_shell_complete.md
```

## Files changed

```
page_inserts/admin-nav.html
```
