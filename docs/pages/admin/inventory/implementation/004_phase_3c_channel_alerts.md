# Phase 3C — Channel Strip + Alert Pills Complete

**Project:** KK Universal Storage  
**Phase:** 3C — Read-only dashboard polish (channel strip + alerts)  
**Completed:** 2026-06-09  
**Page:** `pages/admin/inventory.html`

---

## Summary

Completed the read-only dashboard layer: **channel connection strip** and **alert pills** now use live data where safe. Added eBay quantity limitation tooltips. Bundle Rules and header write actions remain placeholders.

---

## Migrations added

| File | View |
|------|------|
| `supabase/migrations/20260825_inventory_phase3c_channel_status.sql` | `v_inventory_channel_status` — Amazon/eBay listing sync aggregates (no tokens) |

---

## Files created

| File | Purpose |
|------|---------|
| `js/admin/inventory/api/channelStatusApi.js` | Read-only `fetchChannelStatus()` |
| `js/admin/inventory/services/buildAlerts.js` | Derive alert pills from `v_inventory_issues` rows |
| `scripts/verify-inventory-phase3c-channel-alerts.mjs` | Playwright verification |

## Files changed

| File | Change |
|------|--------|
| `js/admin/inventory/state.js` | Channel status + alerts state; load in `loadLiveData()` |
| `js/admin/inventory/index.js` | Render channel strip + alerts after load |
| `js/admin/inventory/events.js` | Live alert pills; click → filter table |
| `js/admin/inventory/renderers/renderChannelStatus.js` | Passed data + honest connection states |
| `js/admin/inventory/renderers/renderInventoryTable.js` | eBay qty `—` tooltip on header/cells |
| Roadmaps + wiring plan | Phase 3C marked complete |

---

## Live vs mock

| Section | Source |
|---------|--------|
| KPI cards | Live `v_inventory_kpis` |
| Recent Stock Ledger | Live `v_inventory_ledger_recent` |
| Main inventory table | Live `v_inventory_workspace` |
| Inventory Issues panel | Live `v_inventory_issues` |
| **Channel connection strip** | **Live** (see sources below) |
| **Alert pills** | **Live** (derived from issue rows) |
| Bundle Rules card | Mock/static |
| Header actions (Sync/Receive/Export/Settings) | Placeholder toasts |

---

## Channel status data sources

| Channel | Sources | Notes |
|---------|---------|-------|
| **KK Store** | Static | Always shown as online (our storefront) |
| **Amazon** | GET `amazon-auth-status` edge function + `v_inventory_channel_status` | OAuth connected / token status; listing count |
| **eBay** | `marketplace_tokens` metadata (if readable) + `products.ebay_*` counts from view | OAuth verified when token row exists; otherwise “listings present · OAuth not verified” |
| **Last Global Sync** | Max of Amazon listing sync, stock ledger activity, Amazon token refresh, eBay token update | Relative time via `formatRelativeTime()` |

States shown honestly: `Connected`, `Needs attention`, `Not connected`, `Status unavailable`, `Listings present · OAuth not verified`.

---

## Alert count sources

Derived from live `state.issueRows` (`v_inventory_issues`) — no separate view:

| Alert pill | Issue type |
|------------|------------|
| Negative Stock | `negative_stock` |
| Low Stock | `low_stock` |
| Amazon Inactive | `amazon_listing_inactive` |
| eBay Listing Ended | `ebay_listing_ended` |
| Parcel Rows Awaiting Mapping | `parcel_mapping_missing` |

**Omitted:** Unmapped order lines (not safely detectable read-only).

Clicking a pill applies tab + issue/inventory-state filters via `applyAlertFilter()`.

---

## Known limitations

1. **eBay stock column** — still `—`; tooltip explains qty cache is future Phase 7.
2. **eBay OAuth** — `marketplace_tokens` may be unreadable from client; falls back to product listing counts.
3. **Unmapped order lines** — no alert pill.
4. **Category filter** — slug from category name; may not match mock ids.
5. **No channel sync actions** — Sync Channels button remains placeholder.

---

## Verification

**Script:** `node scripts/verify-inventory-phase3c-channel-alerts.mjs`

| Check | Result (2026-06-09) |
|-------|---------------------|
| No writes/RPC in inventory JS | Pass |
| All panels still live | Pass |
| Channel strip (3 blocks) | Pass |
| Live alert pills | Pass |
| eBay qty tooltip on header | Pass |
| Alert click filters table | Pass |
| Console errors | None |

---

## Next recommended phase

**Phase 4 — Manual ledger adjustments** (`adjust_inventory` RPC + admin UI). Optional parallel work: Phase 7 channel quantity sync for eBay qty cache.

See [implementation/roadmap.md](./roadmap.md).
