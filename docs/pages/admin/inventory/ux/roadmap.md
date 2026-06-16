# KK Universal Storage — Admin Inventory UX Roadmap

**Project:** KK Universal Storage  
**Status:** Phase 7D complete — eBay quantity cache + sync readiness  
**Target page:** `pages/admin/inventory.html`  
**Design reference:** `pages/admin/amazon.html` (Amazon Listings admin) + inventory mockup  
**Started:** 2026-06-09  
**Phase 1 closed:** 2026-06-09

---

## 1. Project goal

Build the **universal inventory dashboard** for Karry Kraze admin — the future source-of-truth view for stock across **KK Store**, **eBay**, **Amazon**, and **Parcel Imports**.

This roadmap tracks UX and implementation from static shell through full automation. **Phase 1 is visual/layout only** with placeholder mock data. No Supabase, ledger mutations, channel sync, or order deduction in Phase 1.

---

## 2. Business context

### Already exists

| Capability | Notes |
|------------|--------|
| KK products & orders | Store catalog and order flow |
| eBay API | Listings connected |
| Amazon API | Listings connected |
| Parcel Import page | Baestao import, mapping, CPI approve |
| Parcel receive | Approved parcel lines add stock (separate flow today) |

### Future automation (not Phase 1)

- **Universal inventory / ledger** = source of truth
- **KK, eBay, Amazon** = sales channels that read/sync from ledger
- **Unified stock display** — same quantity on all channels for now (no per-channel buffer)
- **Reserve on paid** — deduct/reserve when order is paid
- **Finalize on ship** — finalize deduction when fulfilled/shipped
- **Reverse on cancel** — release stock if canceled/refunded before shipment
- **Missing mappings → issues** — never guess deductions
- **Variant-level inventory** whenever possible
- **Temporary negative stock** allowed but flagged as issue
- **Bundle/component logic** — future; bundle SKUs like “Brass D Ring x3” treated as separate stocked items for now

### Channel-specific notes (future phases)

| Channel | Behavior |
|---------|----------|
| Amazon | Out-of-stock listings often go inactive; reactivate when quantity updated |
| eBay | Listings may auto-end at qty 0; restocking may require relist/new listing flow |
| eBay relist | **Phase 7E complete** — assist-only in Sync Channels modal (no auto-relist) |

---

## 3. Scope matrix

| In scope (Phase 1) | Out of scope (Phase 1+) |
|--------------------|---------------------------|
| Static HTML page shell | Supabase reads/writes |
| Tailwind styling (Amazon admin parity) | `stock_ledger` mutations |
| Mock/placeholder data via JS modules | Order deduction / reservation |
| Client-side tab/filter UX on mock data | Channel quantity sync API calls |
| Admin nav link | eBay relist automation |
| Responsive layout (desktop + mobile) | Amazon inventory update calls |
| Section render modules | Parcel import / CPI write-path changes |
| Roadmap + completion docs | Bundle BOM / component deduction |

---

## 4. Design constraints

Mirror patterns from `pages/admin/amazon.html`:

| Pattern | Usage on Inventory page |
|---------|---------------------------|
| `body.kk-page.kk-admin.bg-gray-50` | Page canvas |
| `main.max-w-[88rem] mx-auto px-3 sm:px-6 py-4 sm:py-8` | Container |
| Header card | Kicker, title, subtitle, action buttons |
| KPI grid | 8 stat cards |
| Work-area tabs | All Inventory · Low Stock · Unmapped · Issues |
| Alert pills | Issue summary strip |
| Filter card | Search + 7 filter dropdowns |
| Tables | Sticky header, `overflow-x-auto`, mobile scroll |
| Status pills | Healthy / Low / Issue + channel mismatch hints |
| Connection strip | KK / eBay / Amazon + last sync + live badge |

Optional: `css/pages/admin/inventory.css` only if Tailwind repetition is excessive.

---

## 5. File targets

### Phase 1 (static UX)

| File | Purpose |
|------|---------|
| `pages/admin/inventory.html` | Page shell + mount points |
| `js/admin/inventory/index.js` | Entry — init, orchestrate renders |
| `js/admin/inventory/dom.js` | DOM refs |
| `js/admin/inventory/events.js` | Tabs, filters, mock actions |
| `js/admin/inventory/mockData.js` | Placeholder data |
| `js/admin/inventory/renderers/renderKpis.js` | KPI cards |
| `js/admin/inventory/renderers/renderChannelStatus.js` | Channel connection strip |
| `js/admin/inventory/renderers/renderInventoryTable.js` | Main inventory table |
| `js/admin/inventory/renderers/renderLedger.js` | Recent stock ledger |
| `js/admin/inventory/renderers/renderIssues.js` | Inventory issues panel |
| `js/admin/inventory/renderers/renderBundle.js` | Bundle rules placeholder |
| `js/admin/inventory/utils/formatters.js` | Shared HTML escape helper |
| `css/pages/admin/inventory.css` | Optional page-specific rules |
| `page_inserts/admin-nav.html` | Add Inventory nav link |
| `docs/pages/admin/inventory/ux/roadmap.md` | This roadmap |

**Module layout:**

```
js/admin/inventory/
├── index.js
├── dom.js
├── events.js
├── mockData.js
├── renderers/
│   ├── renderKpis.js
│   ├── renderChannelStatus.js
│   ├── renderInventoryTable.js
│   ├── renderLedger.js
│   ├── renderIssues.js
│   └── renderBundle.js
└── utils/
    └── formatters.js
```

### Future (implementation phases)

| File / area | Purpose |
|-------------|---------|
| `js/admin/inventory/api.js` | Supabase / edge function layer |
| `js/admin/inventory/state.js` | Live session + filter state |
| `supabase/migrations/*` | Ledger schema, views, RPCs |
| `docs/pages/admin/inventory/implementation/roadmap.md` | Backend wiring phases |

---

## 6. Page structure (top to bottom)

```
#kkAdminNavMount
<main id="inventoryPage" data-page="inventory">
  ├─ Header (kicker, title, subtitle, Sync / Receive / Export / Settings)
  ├─ Channel connection strip (KK · eBay · Amazon · Last Global Sync · Live)
  ├─ KPI row (8 cards)
  ├─ Work Area tabs (All · Low Stock · Unmapped · Issues)
  ├─ Alerts strip (pill badges)
  ├─ Search + filters card
  ├─ Inventory Table (summary pills + columns)
  ├─ Recent Stock Ledger
  ├─ Inventory Issues panel
  └─ Bundle Rules (Future) placeholder card
</main>
```

---

## 7. Phase-by-phase roadmap

Build sequentially. Pause for review between major phases.

---

### Phase 0 — Discovery / style audit

**Status:** Complete

**Tasks**

- [x] Read `pages/admin/amazon.html` — header, KPIs, tabs, filters, tables, pills
- [x] Confirm admin shell: `#kkAdminNavMount`, `initAdminNav` pattern
- [x] Confirm mobile table pattern (horizontal scroll + mobile cards)
- [x] Document reusable Tailwind class strings in this roadmap §4

**Acceptance**

- Team agrees Amazon Listings is the visual source of truth
- No functional wiring required for Phase 1

---

### Phase 1 — Static UX / page shell

**Status:** Complete

**Build**

- [x] Create `docs/pages/admin/inventory/ux/roadmap.md` (this file)
- [x] Create `pages/admin/inventory.html` with mount points
- [x] Create `js/admin/inventory/*` modules with mock data
- [x] Header: Admin Panel kicker, title, subtitle, 4 action buttons
- [x] Channel status strip: KK / eBay / Amazon connected + last sync + live badge
- [x] 8 KPI cards with specified placeholder values
- [x] 4 work-area tabs with counts
- [x] Alerts strip (5 pill alerts)
- [x] Search + 7 filters (Status, Channel, Inventory State, Category, Sync State, Issue Type, Sort By)
- [x] Inventory table with KK-style product rows, channel columns, mismatch examples, negative stock row
- [x] Recent Stock Ledger table
- [x] Inventory Issues panel (5 issue types)
- [x] Bundle Rules (Future) placeholder card
- [x] Client-side tab/filter behavior on mock data only
- [x] Add Inventory link to admin nav (desktop + mobile)
- [x] Responsive polish; no console errors
- [x] Completion doc: `docs/pages/admin/inventory/ux/001_static_ux_shell_complete.md`

**Acceptance**

- Page loads without console errors
- Desktop layout matches mockup direction and Amazon admin style
- Mobile layout usable (scrollable tables or cards)
- No Supabase, fetch to inventory APIs, or stock logic
- Mock actions (Sync, Receive, Export, Settings) show placeholder feedback only

---

### Phase 2 — Schema & wiring plan

**Status:** Complete

**Tasks**

- [x] Create `docs/pages/admin/inventory/implementation/001_wiring_plan.md`
- [x] Create `docs/pages/admin/inventory/implementation/roadmap.md`
- [x] Audit existing schema: `product_variants.stock`, `stock_ledger`, parcel receive, orders, Amazon/eBay views
- [x] Audit code paths: products, parcelImports, lineItemsOrders, ebayListings, amazon, stripe-webhook
- [x] Document current vs target stock flow
- [x] Propose views/RPCs: `v_inventory_workspace`, `v_inventory_kpis`, `v_inventory_issues`, reservations (Phase 6)
- [x] Propose JS structure: `api/`, `services/`, `state/`
- [x] Define implementation phases 3–10 aligned with wiring plan

**Deliverable:** [implementation/001_wiring_plan.md](../implementation/001_wiring_plan.md)

**Acceptance**

- Implementation roadmap approved before any migrations — **ready for Phase 3 PR planning**

---

### Phase 3A — KPI + ledger read wiring (live read-only)

**Status:** ✅ Complete — [implementation/002_phase_3a_readonly_kpis_ledger.md](../implementation/002_phase_3a_readonly_kpis_ledger.md)

**Tasks**

- [x] Baseline migration: `stock_ledger` IF NOT EXISTS + `v_inventory_kpis` + `v_inventory_ledger_recent`
- [x] Add `js/admin/inventory/api/inventoryApi.js`, `state.js`
- [x] Wire KPI + Recent Stock Ledger panels; mock fallback on read failure
- [x] Admin session gate (`requireAdmin`)
- [x] Playwright smoke script
- [x] Main inventory table, channel strip, issues, bundle remain mock

**Acceptance**

- KPI + ledger show live data when views deployed; table still mock; no writes

---

### Phase 3B — Inventory table + issues read wiring

**Status:** ✅ Complete — [implementation/003_phase_3b_workspace_issues.md](../implementation/003_phase_3b_workspace_issues.md)

**Tasks**

- [x] Create read views: `v_inventory_workspace`, `v_inventory_issues`
- [x] Wire main table, tab counts, issues panel
- [x] Client-side search, tabs, filters on live rows
- [x] Channel strip + alert pills remain mock

**Acceptance**

- Table + issues show live data; Sync/Receive/Export remain placeholder actions

---

### Phase 3C — Channel strip + alert pills (read-only polish)

**Status:** ✅ Complete — [implementation/004_phase_3c_channel_alerts.md](../implementation/004_phase_3c_channel_alerts.md)

**Tasks**

- [x] Live channel strip (KK / eBay / Amazon + last sync)
- [x] Live alert pills from `v_inventory_issues`
- [x] Alert pill click → table filter
- [x] eBay qty limitation tooltips
- [x] Bundle rules + header write actions remain placeholder

---

### Phase 4 — Manual ledger adjustments

**Status:** ✅ Complete — [implementation/005_phase_4_manual_adjustments.md](../implementation/005_phase_4_manual_adjustments.md)

**Tasks**

- [x] RPC `adjust_inventory` with ledger + idempotency
- [x] Extend `stock_ledger` columns (`note`, `source`, `reference_type`, `idempotency_key`, `created_by`)
- [x] Manual adjustment UI from inventory row actions
- [ ] Address Products admin silent stock edits (deferred — out of Phase 4 scope)

**Acceptance**

- All manual stock changes from Inventory page create auditable ledger rows ✅

---

### Phase 5 — Parcel receive unified with ledger UI

**Status:** ✅ Complete — [implementation/006_phase_5_parcel_receive_visibility.md](../implementation/006_phase_5_parcel_receive_visibility.md)

**Tasks**

- [x] Read-only `v_inventory_parcel_receive_summary` view
- [x] Parcel Receive Summary card on Inventory dashboard
- [x] Receive Stock header → Parcel Imports deep link
- [x] Ledger parcel_receive badges + filter + link
- [x] Parcel mapping issue/alert → Parcel Imports navigation
- [x] Parcel Imports URL query param support (`tab`, `status`, `received`)

**Acceptance**

- Parcel receive visible in universal dashboard; existing receive RPC unchanged ✅

---

### Phase 6 — Order deduction & reservation

**Status:** 6A complete — [implementation/007_phase_6_order_reservation_design.md](../implementation/007_phase_6_order_reservation_design.md)

**Sub-phases**

| Slice | Scope | Status |
|-------|--------|--------|
| **6A** | Design audit (KK/eBay/Amazon flows, double-deduct risk, transition plan) | ✅ Complete |
| **6B** | `inventory_reservations` table + read views only | ✅ Complete — [008](../implementation/008_phase_6b_reservation_schema_views.md) |
| **6C** | Stripe idempotency + KK shadow reservations | ✅ Complete — [009](../implementation/009_phase_6c_stripe_idempotency_shadow_reservations.md) |
| **6D-Prep** | Cutover readiness + backfill dry-run | ✅ Complete — [010](../implementation/010_phase_6d_prep_kk_cutover_readiness.md) |
| **6D-Validation** | Shadow checkout validation checklist | ✅ Complete — [011](../implementation/011_phase_6d_validation_shadow_checkout.md) |
| **6D-Validation Diagnostic** | Stripe webhook environment check | ✅ Complete — [012](../implementation/012_phase_6d_validation_webhook_diagnostic.md) |
| **6D** | Execute cutover (backfill + reserve-only) | ✅ Complete — [013](../implementation/013_phase_6d_kk_reserve_only_cutover.md) |
| **6E** | Fulfillment finalize on ship | ✅ Complete — [014](../implementation/014_phase_6e_fulfillment_finalize.md) |
| **7A** | Channel sync design + dry-run | ✅ Complete — [015](../implementation/015_phase_7a_channel_sync_design_dry_run.md) |
| **7B** | KK available-stock alignment | ✅ Complete — [016](../implementation/016_phase_7b_kk_available_stock_alignment.md) |
| **7C** | Amazon FBM quantity sync push | ✅ Complete — [017](../implementation/017_phase_7c_amazon_fbm_quantity_sync.md) |
| **7D** | eBay quantity cache + readiness | ✅ Complete — [018](../implementation/018_phase_7d_ebay_quantity_cache_readiness.md) |
| **7E** | eBay relist assist | ✅ Complete — [019](../implementation/019_phase_7e_ebay_relist_assist.md) |
| **7F** | eBay quantity sync push | ✅ Complete — [020](../implementation/020_phase_7f_ebay_quantity_sync.md) |
| **6F** | eBay/Amazon MFN reserve (mapped lines only) | Planned |

**Tasks (rollup)**

- [x] Document current KK/Stripe deduct/refund path and idempotency gaps
- [x] Document eBay/Amazon import paths (no stock today)
- [x] Propose reservation schema + ledger reason model + cutover plan
- [x] `inventory_reservations` table (empty) + read view reserved/available math
- [x] `v_inventory_unmapped_order_lines` + issues integration
- [x] Stripe webhook idempotency for stock deduct/restore
- [x] KK shadow reservations (`is_shadow=true`, excluded from official KPIs)
- [x] Cutover readiness views + backfill dry-run (6D-Prep)
- [x] Shadow checkout validation checklist (6D-Validation)
- [x] Stripe webhook environment diagnostic (6D-Validation Diagnostic)
- [x] Manual post-6C checkout validation (`post_6c_matched_lines >= 1`)
- [x] Transition stripe-webhook to reserve-only (Phase 6D execute)
- [x] Fulfillment finalize on ship (Phase 6E)
- [x] Channel sync dry-run planner (Phase 7A)
- [x] KK storefront available alignment (Phase 7B)
- [x] Amazon FBM quantity sync push (Phase 7C)
- [x] eBay quantity cache + sync readiness (Phase 7D)
- [x] eBay ended-listing relist assist (Phase 7E)
- [x] eBay quantity sync push (Phase 7F)
- [ ] eBay/Amazon paid orders: reserve when mapped; issue when not (Phase 6F)
- [ ] Fulfillment finalize + cancel/refund release (Phase 6E)
- [ ] Negative stock → issue flag

**Acceptance**

- `reserved` / `available` live; order lifecycle reflected in inventory columns

---

### Phase 7 — Channel sync (push quantities)

**Status:** Planned

**Tasks**

- [ ] Sync Channels pushes `available` to KK / eBay / Amazon FBM
- [ ] Unified qty — no per-channel buffer in v1
- [ ] Track last channel sync; surface mismatches

**Acceptance**

- Operator can sync all channels from Inventory page

---

### Phase 8 — Issue handling workflows

**Status:** Phase 8 complete — see implementation phases 8A–8H

**Tasks**

- [x] Issue drill-down modal (read-only samples + recommended next step)
- [x] Primary action routes per issue type (Orders, Parcels, Amazon, eBay, Sync modal, Adjust Stock)
- [x] Alert pills filter table / open Sync modal for sync-related issues
- [x] Resolve/snooze/review workflow state (Phase 8B)
- [x] Mapping-assist wizards (Phase 8C — unmapped lines + Amazon variant)
- [x] Reservation retry for mapped lines (Phase 8D)
- [x] Shipped finalize audit (Phase 8E — read-only)
- [x] Manual finalize assist (Phase 8F — admin confirm)
- [x] eBay safe mapping hints (Phase 8G)
- [x] eBay bulk mapping worklist + selected apply (Phase 8H)
- [x] Post-map workflow checklist (Phase 9A)
- [x] Post-map action queue (Phase 9B)
- [x] Queue resolution assist + work screen (Phase 9C)

**Acceptance**

- [x] Each issue type has a clear resolution path (navigation to existing admin flows)
- [x] Operator can mark issues reviewed/snoozed/resolved without mutating inventory

---

### Phase 9 — eBay relist & listing recovery

**Status:** Partially delivered in Phase 7E — [019](../implementation/019_phase_7e_ebay_relist_assist.md)

**Tasks**

- [x] Detect ended eBay listings; restock guidance (Sync Channels relist assist)
- [x] Manual relist assist (no full automation in first slice)
- [ ] Auto-open KK Listings Push modal from deep link
- [ ] Post-relist product field reconciliation helpers

**Acceptance**

- Operator can recover eBay sellability after restock

---

### Phase 10 — Bundle & component inventory

**Status:** Phase 10H complete — [039](../implementation/039_phase_10h_partial_refund_return_guidance.md)

**Tasks**

- [x] Bundle/component model design (Model A vs B)
- [x] `inventory_bundle_rules` table (config only)
- [x] Read-only availability preview views
- [x] Inventory bundle preview panel + modal
- [x] Preview-only issue groups (no alert pills)
- [x] Product/variant picker for rule configuration
- [x] Rule edit / disable / remove (config only)
- [x] Config audit log
- [x] Virtual bundle mode flags (default preview_only)
- [x] Simulate Sale + shadow event logging (admin only)
- [x] Cutover readiness advisory view
- [x] Global/per-bundle shadow mode controls
- [x] Checkout reservation shadow hook (Stripe webhook)
- [x] Fulfillment finalize shadow hook (Shippo webhook)
- [x] Recent shadow events viewer
- [x] Independent stock acknowledgement UI
- [x] Live readiness checklist + live request staging
- [x] Live component deduction on reserve/finalize (Phase 10F)
- [x] Storefront available stock from virtual BOM (Phase 10F)
- [x] Admin live enablement UI + revert + audit
- [x] Admin returns/restock for finalized component lines (Phase 10G)
- [x] Refund context + suggested restock guidance (Phase 10H)
- [x] Order deep links + post-restock sync checklist (Phase 10H)
- [x] Unified returns/restock dashboard with deep links, presets, grouping, export (Phase 10U–10V)
- [x] Scheduled digest preview/send (Phase 10W)
- [x] Server-side paginated worklist + count-aware filters + target-row lookup (Phase 10X)
- [x] Production stabilization + feature freeze (Phase 10Y)

**Acceptance**

- [x] Operator can preview virtual bundle availability without affecting live stock
- [x] Operator can simulate virtual bundle sales and record shadow events (no inventory change)
- [x] Checkout can log reservation shadow events when shadow mode enabled
- [x] Operator can acknowledge independent stock and request live staging
- [x] Bundle sales deduct components when live cutover enabled (explicit per-bundle live only)
- [x] Operator can restock component variants after confirmed returns (admin only; parent bundle unchanged)
- [x] Operator sees refund-aware restock guidance without automatic inventory changes
- [x] Operator can paginate large returns/restock backlogs without loading all rows (50/100/250 per page)
- [x] Deep links resolve to target rows outside the first page via server lookup
- [x] Returns/Restock experience feature-frozen for production (Phase 10Y)

---

## 8. Acceptance criteria summary

| Phase | Done when |
|-------|-----------|
| 0 | Style audit complete; patterns documented |
| 1 | Static page + mock JS; nav link; completion doc — **complete** |
| 1b | JS reorganized into `renderers/` + `utils/formatters.js` — **complete** |
| 2 | Wiring plan / audit — **complete** ([001_wiring_plan.md](../implementation/001_wiring_plan.md)) |
| 3 | Live read-only page wiring |
| 4 | Manual ledger adjustments |
| 5 | Parcel receive + ledger UI |
| 6 | Order reserve / finalize / reverse |
| 7 | Channel sync push |
| 8 | Issue workflows (8A routing + 8B resolution tracking) — **complete** |
| 9 | eBay relist assist |
| 10 | Bundle / component rules |

---

## 9. Phase 1 QA checklist

- [x] Visual match to Amazon admin (cards, buttons, tabs, tables, pills)
- [x] Mockup direction reflected (connection strip, 8 KPIs, alerts, ledger, issues)
- [x] No Supabase inventory queries
- [x] No stock_ledger mutations
- [x] No CPI or order fulfillment logic changes
- [x] Placeholder data clearly fictional
- [x] Tables scroll horizontally on narrow viewports; mobile cards for inventory table
- [x] Tab `aria-selected` and table `scope` present
- [x] Admin nav includes Inventory

---

## 10. Build order for agents

When implementing Phase 1:

`0 (audit) → 1 (shell + all sections) → update roadmap + completion doc`

Do **not** wire Supabase or change parcel/CPI/order modules during Phase 1.

**Recommended next doc (Phase 3):**  
Implement read views + `js/admin/inventory/api/` per [implementation/001_wiring_plan.md](../implementation/001_wiring_plan.md) §16.

---

## 11. Change log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-06-12 | 10Y-Pool | Supabase pool safety — no browser snapshot RPC; issues staggered; post-map lightweight refresh |
| 2026-06-09 | 10Y | Final stabilization + feature freeze |
| 2026-06-09 | 10X | Server-side paginated worklist + target lookup |
| 2026-06-09 | 10W | Scheduled returns/restock digest + preview modal |
| 2026-06-09 | 10V | Dashboard deep links, presets, grouped worklist, CSV export |
| 2026-06-09 | 10U | Unified returns/restock dashboard modal + summary/worklist views |
| 2026-06-09 | 10T | Post-restock channel follow-up checklist + sync modal context |
| 2026-06-09 | 10S | Queue KPI strip + audit history tab + snooze/review triage |
| 2026-06-09 | 10R | Marketplace Restock Assist Queue modal + bucket filters + audit trail |
| 2026-06-09 | 10Q | Marketplace restock assist + physical return confirm + stale obs issue |
| 2026-06-09 | 10P | Post-sync observation refresh; eBay webhook cancel/refund; Line Items status badges |
| 2026-06-09 | 10O | Amazon cancel retention; eBay cancel upsert; line-level finance mapping |
| 2026-06-09 | 10N | Persisted observations + backfill RPC; Refresh Marketplace Observations panel |
| 2026-06-09 | 10M | eBay/Amazon refund observability view; marketplace guidance + issue groups; read-only panel |
| 2026-06-09 | 10L | Webhook auto-populates order_refund_details; shared stripeRefundDetails helper |
| 2026-06-09 | 10K | Stripe refund block + Refresh Refund Data; refund issue groups; guidance suggestions (no auto-RMA/restock) |
| 2026-06-09 | 10J | RMA/return workflow table, RPCs, panel actions, issue groups |
| 2026-06-09 | 10I | Line Items deep-link line focus; return panel Open Order Line, copy ref, dismissible checklist |
| 2026-06-09 | 10B | Variant picker + rule management UI |
| 2026-06-09 | 10A | Bundle preview panel + modal + preview issues |
| 2026-06-09 | 9C | Work Queue resolution banners, evidence, bulk status |
| 2026-06-09 | 9B | Post-map action queue modal + persistence |
| 2026-06-09 | 9A | Post-map checklist after mapping apply |
| 2026-06-09 | 8H | eBay mapping worklist modal + grouped visibility |
| 2026-06-09 | 1 | Roadmap created; Phase 1 marked current/in progress |
| 2026-06-09 | 1 | Static UX shell complete — see `001_static_ux_shell_complete.md` |
| 2026-06-09 | 1b | JS reorganized — render modules moved to `renderers/`, shared `esc()` in `utils/formatters.js` |
| 2026-06-09 | 2 | Implementation wiring plan complete — [001_wiring_plan.md](../implementation/001_wiring_plan.md) |
