# Phase 2D Completion Checkpoint

**Date:** 2026-05-17  
**Status:** COMPLETE ✅  
**Feature:** Token-based QR scan tracking for CTA packing labels

---

## Feature Summary

Every packing label printed through the admin orders page can now include a unique QR code that,
when scanned by the customer, records a scan event and redirects to the appropriate destination.

- **KK orders** → Review request URL (`/pages/leave-review.html?oid=...`)
- **eBay orders** → Homepage with UTM attribution

All flow steps are tracked in the database:
`print` → `link+token` → `scan` → `redirect`

---

## Final Verified Behavior

| KK Order Flow | eBay Order Flow |
|---|---|
| Admin clicks **Print CTA** | Admin clicks **Print CTA** |
| Print window opens with label + QR | Print window opens with label + QR |
| `trackCtaLabelPrint` → `cta_label_prints` row | Same |
| `createCtaLabelLink` → `cta_label_links` row + token | Same |
| QR URL rewritten to `/r/?t=<token>` | Same |
| Status: "CTA label opened for printing. Scan tracking enabled." | Same |
| Customer scans QR → `r/index.html` | Same |
| JS relays to `cta-label-redirect?t=<token>` | Same |
| Edge Function inserts `cta_label_scans` row | Same |
| **302 → `/pages/leave-review.html?oid=<id>&utm_source=packing_label&utm_medium=qr&utm_campaign=review_cta`** | **302 → `https://karrykraze.com/?utm_source=packing_label&utm_medium=qr&utm_campaign=ebay_direct_cta`** |

---

## Files Changed in Phase 2D

### JavaScript (admin)

| File | Change |
|---|---|
| `js/admin/lineItemsOrders/index.js` | Added `_ctaRowExtras()`, `wireCta()`, calls to `trackCtaLabelPrint` + `createCtaLabelLink` |
| `js/admin/lineItemsOrders/api.js` | Added `trackCtaLabelPrint()` (Edge Function fetch) + `createCtaLabelLink()` |
| `js/admin/lineItemsOrders/renderTable.js` | Added `normalizeRowExtras()`, `getRowExtras` param to `renderDesktopRows`/`renderMobileCards`, CTA button injection in Actions cell |
| `js/admin/lineItemsOrders/labelPrint.js` | New file — `buildQrTarget()`, `printLabel()`, `rewriteQr()` |
| `js/admin/lineItemsOrders/dom.js` | Added `export function getOrderSource()`, null-guard in `moneyFromCents` |
| `js/admin/lineItemsOrders/modalEditor.js` | Deprecation comment added |

### Static pages / routing

| File | Change |
|---|---|
| `r/index.html` | Added `?t=` handler to relay to `cta-label-redirect` Edge Function; `?c=` SMS path preserved with priority |

### Service Worker

| File | Change |
|---|---|
| `sw.js` | `CACHE_VERSION` bumped `kk-v6` → `kk-v7` (evicts stale admin JS from cache) |

### Supabase

| File | Change |
|---|---|
| `supabase/config.toml` | Added `[functions.cta-label-redirect]` with `verify_jwt = false` |
| `supabase/functions/track-cta-label-print/index.ts` | New Edge Function |
| `supabase/functions/create-cta-label-link/index.ts` | New Edge Function |
| `supabase/functions/cta-label-redirect/index.ts` | New Edge Function |
| `supabase/migrations/20260517_cta_label_prints.sql` | Creates `cta_label_prints` table |
| `supabase/migrations/20260517_b_cta_label_links_scans.sql` | Creates `cta_label_links` + `cta_label_scans` tables |
| `supabase/migrations/20260517_c_cta_label_prints_rls_cleanup.sql` | Drops `authenticated INSERT` policy; adds `authenticated SELECT` policy on `cta_label_prints` |

---

## Database Tables

### `cta_label_prints`
Records every time an admin prints a CTA label.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | text | Stripe/eBay order ID |
| `order_source` | text | `'kk'` or `'ebay'` |
| `label_type` | text | `'review_cta'` or `'channel_cta'` |
| `printed_at` | timestamptz | |

### `cta_label_links`
One token per print. Used by QR code.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `print_id` | uuid FK → `cta_label_prints.id` | |
| `token` | text | 16-char hex, unique |
| `destination_url` | text | Final redirect target |
| `created_at` | timestamptz | |

### `cta_label_scans`
One row per QR scan event.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `link_id` | uuid FK → `cta_label_links.id` | |
| `scanned_at` | timestamptz | |
| `user_agent` | text | |
| `ip_hash` | text | SHA-256 of IP, not raw IP |

---

## Edge Functions

### `track-cta-label-print`
- **Auth:** Requires admin JWT (`Authorization` header)
- **Action:** Inserts row into `cta_label_prints` using service role
- **Returns:** `{ ok: true, id, row }` or `{ ok: false, error }`

### `create-cta-label-link`
- **Auth:** Requires admin JWT
- **Action:** Generates 16-char hex token, inserts `cta_label_links` row
- **Returns:** `{ ok: true, token, trackingUrl }` where `trackingUrl = https://karrykraze.com/r/?t=<token>`

### `cta-label-redirect`
- **Auth:** `--no-verify-jwt` (public — called by customer QR scan)
- **Action:** Looks up token → inserts `cta_label_scans` row → responds `302` to `destination_url`
- **CORS:** Handles OPTIONS preflight → 200

---

## Static Route: `/r/`

`r/index.html` handles two path patterns:

| Query param | Behavior |
|---|---|
| `?c=<code>` | SMS coupon relay (original, priority) |
| `?t=<token>` | CTA label relay → `cta-label-redirect` Edge Function |

No server needed — GitHub Pages serves `r/index.html` and JS does the relay.

---

## Commits (Phase 2D)

| Commit | Description |
|---|---|
| `4629081` | Phase 2D: token-based QR scan tracking for CTA labels |
| `f564aaa` | fix: export getOrderSource from dom.js |
| `954cdb1` | fix: add cta-label-redirect to config.toml with verify_jwt=false |
| `373e4aa` | fix: bump SW cache to kk-v7 to evict stale dom.js |
| `7eb0bea` | fix: add getRowExtras seam to renderTable.js so Print CTA buttons render |

---

## Problems Encountered and Resolved

| Problem | Root Cause | Fix |
|---|---|---|
| 403 on `cta_label_prints` INSERT | Direct browser INSERT; page is unauthenticated role (anon) | Moved INSERT to `track-cta-label-print` Edge Function called with admin JWT |
| QR codes redirecting to homepage | `cta-label-redirect` deployed without `--no-verify-jwt`; Supabase gateway 401'd unauthenticated scans → JS fell back to homepage | Redeployed with `--no-verify-jwt`; added to `config.toml` |
| `SyntaxError: dom.js does not provide export 'getOrderSource'` | `dom.js` modified locally but never committed; old deployed version had no export | Committed `dom.js` |
| Stale `dom.js` still served after git push | SW `kk-v6-dynamic` cache was serving stale file (Cache-Control: max-age=14400) | Bumped `CACHE_VERSION` to `kk-v7`; SW activate handler evicts old caches |
| Print CTA buttons not appearing | `renderTable.js` never committed; deployed version had no `getRowExtras` support; `index.js` passed `getRowExtras: _ctaRowExtras` but it was silently ignored | Committed `renderTable.js` with `getRowExtras` seam |

---

## Live Verification Results

**Date:** 2026-05-17

### Git
- HEAD: `7eb0bea` — pushed to `origin/main`
- No required CTA files uncommitted

### Live file symbols (fetched from CDN, cache-busted)
| File | Symbol | Result |
|---|---|---|
| `dom.js` | `getOrderSource` | ✅ FOUND |
| `renderTable.js` | `getRowExtras` | ✅ FOUND |
| `index.js` | `_ctaRowExtras` | ✅ FOUND |

### Syntax check
```
node --check js/admin/lineItemsOrders/{api,dom,index,labelPrint,renderTable,modalEditor}.js
Exit code: 0
```

### Browser test (Playwright, live karrykraze.com)
- ✅ 25/25 order rows have Print CTA buttons
- ✅ eBay CTA → status "CTA label opened for printing. Scan tracking enabled."
- ✅ KK CTA → status "CTA label opened for printing. Scan tracking enabled."
- ✅ `cta_label_prints` rows created for both
- ✅ `cta_label_links` rows created with correct tokens and destination URLs
- ✅ KK: `302 → /pages/leave-review.html?oid=KKO-759666&utm_source=packing_label&utm_medium=qr&utm_campaign=review_cta`
- ✅ eBay: `302 → https://karrykraze.com/?utm_source=packing_label&utm_medium=qr&utm_campaign=ebay_direct_cta`
- ✅ `cta_label_scans` rows inserting with `ip_hash`

---

## Known Unrelated Warnings

These warnings exist in the browser console but are unrelated to Phase 2D:

1. **Tailwind CDN warning** — "cdn.tailwindcss.com should not be used in production". Not fixed; deferred.
2. **PWA install prompt** — "Push API requires user permission" in incognito mode. Expected browser behavior.
3. **Multiple GoTrueClient instances** — Auth client instantiated in multiple modules. Pre-existing; deferred.
4. **Content-script / extension warnings** — Browser extension noise; not from app code.

---

## Pending (Not Part of Phase 2D)

### Manual DB migration to apply
`supabase/migrations/20260517_c_cta_label_prints_rls_cleanup.sql` has not been applied to the remote DB. Apply in Supabase SQL Editor:

```sql
DROP POLICY IF EXISTS "cta_label_prints_authenticated_insert" ON cta_label_prints;
CREATE POLICY "cta_label_prints_authenticated_select"
  ON cta_label_prints FOR SELECT TO authenticated USING (true);
```

### Uncommitted work (intentionally deferred)
| File | Reason |
|---|---|
| `js/admin/lineItemsOrders/workspace.js` | Large in-progress refactor (688 lines); not ready |
| `js/admin/lineItemsOrders/workspaceFinancials.js` | New workspace module split; not ready |
| `js/admin/lineItemsOrders/workspaceFulfillment.js` | Same |
| `js/admin/lineItemsOrders/workspaceIds.js` | Same |
| `js/admin/lineItemsOrders/workspaceOverview.js` | Same |
| `js/admin/lineItemsOrders/workspaceUtils.js` | Same |
| `docs/todoPersonal.md` | Personal todo; unrelated |

---

## Recommended Next Phases

| Phase | Description |
|---|---|
| **2E** | Coupon attribution — tie `cta_label_scans` to coupon redemption events |
| **2F** | Workspace Labels tab — show QR scan history per order in the order workspace |
| **2G** | Amazon CTA label support — detect Amazon orders and route to appropriate QR destination |
| **Housekeeping** | Complete and commit workspace.js refactor (split into workspaceFinancials, workspaceFulfillment, workspaceIds, workspaceOverview, workspaceUtils) |
