# CTA Label Phase 2D — QR Scan Tracking Plan

**Date:** 2026-05-17  
**Status:** Planning only. No code changes. Phase 2C is the current deployed baseline.

---

## 1. Current State

Phase 2C is complete and browser-verified:

- CTA labels print for KK and eBay orders.
- Each label contains a QR code that points **directly** to the final destination:
  - KK: `https://karrykraze.com/pages/leave-review.html?oid=<kk_order_id>&utm_source=packing_label&utm_medium=qr&utm_campaign=review_cta`
  - eBay: `https://karrykraze.com/?utm_source=packing_label&utm_medium=qr&utm_campaign=ebay_direct_cta`
- Print events are logged to `cta_label_prints` (authenticated INSERT, service_role ALL).
- `metadata.qr_target` stores the destination URL per print.
- **No scan or click tracking exists yet.** We know a label was printed; we do not know if the customer scanned it.

---

## 2. Existing Redirect System Found in This Project

### `/r/` static redirect page (GitHub Pages)

**File:** `r/index.html`

- Used by the SMS click-tracking system.
- Extracts `?c={short_code}` from the URL.
- Forwards to `https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/sms-redirect?code={short_code}`.
- This is a **static HTML page acting as a relay** — GitHub Pages serves it, then JS kicks the customer to the Edge Function URL to record the click and 302-redirect to the final target.
- The `/r/` route already exists at the project root (`r/index.html`).

### `sms-redirect` Edge Function

**File:** `supabase/functions/sms-redirect/index.ts`

- Receives `?code={short_code}`.
- Looks up `sms_messages` by `short_code`.
- Inserts into `sms_events` (service-role, fire-and-forget).
- Updates `customer_contacts.last_clicked_at`.
- Returns `302 Location: {redirect_url}` with `Cache-Control: no-store`.
- Fallback to `https://karrykraze.com` on missing/invalid code.

### Token generation patterns found in Edge Functions

| Function | Pattern |
|----------|---------|
| `send-review-request` | `crypto.randomUUID().replace(/-/g, "").slice(0, 10)` — 10-char hex |
| `sms-abandoned-cart`, `sms-welcome-series` | alphanumeric chars loop — 8-char code |
| `generate-social-image` | `Math.random().toString(36).substring(2, 8)` — 6-char alphanumeric |

**Recommended token approach for Phase 2D:** `crypto.randomUUID().replace(/-/g, "").slice(0, 16)` — 16-char hex, matches Deno's `crypto.randomUUID()` which is CSPRNG-backed (not `Math.random()`). Enough entropy to be unguessable; short enough for a QR-embedded URL.

### `sms_messages.short_code` column (SMS system)

The existing SMS system stores `short_code TEXT` on `sms_messages` and `redirect_url TEXT`. This is the direct model to follow for CTA label links — the two-table pattern (link + scan) is preferred over polluting `cta_label_prints` with scan data.

---

## 3. Recommended Architecture

### Design decision: Token-based redirect via existing `/r/` route

**Preferred path:**

```
QR code → karrykraze.com/r/?t={token}
         → r/index.html JS (already exists) reads ?t=, forwards to Edge Function
         → cta-label-redirect Edge Function:
             1. Look up token in cta_label_links
             2. Insert row in cta_label_scans (service-role, async)
             3. 302 → destination_url
```

**Why this approach:**
- `/r/` already exists and is deployed on GitHub Pages.
- The relay pattern (static page → Edge Function) is already proven by the SMS system.
- Service-role writes from the Edge Function satisfy the security constraint (no public anon inserts to scan tables).
- The final destination URL is stored server-side — the QR code does not expose it.
- Scan tracking failure → QR still works (fallback redirect built in).
- Works even for customers on slow connections or aggressive content blockers (302 is fast).

**Alternative considered and rejected:**

> **Static page with JS scan tracking before redirect.**  
> Problem: requires a localStorage/cookie write before redirect; fails if the page doesn't fully load before the customer navigates; exposes destination URL in page source.

---

## 4. Recommended Tables

### `cta_label_links` — one row per printed label

```sql
CREATE TABLE IF NOT EXISTS cta_label_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text        UNIQUE NOT NULL,           -- 16-char hex, embedded in QR
  print_id        uuid        NULL REFERENCES cta_label_prints(id) ON DELETE SET NULL,
  session_id      text        NOT NULL,
  kk_order_id     text        NULL,
  order_source    text        NOT NULL
                  CHECK (order_source IN ('kk', 'ebay', 'amazon', 'unknown')),
  label_type      text        NOT NULL
                  CHECK (label_type IN ('review_cta', 'channel_cta')),
  destination_url text        NOT NULL,                  -- full final URL
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NULL,                      -- NULL = never expires
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cta_label_links_token ON cta_label_links (token);
CREATE INDEX IF NOT EXISTS idx_cta_label_links_print_id ON cta_label_links (print_id);
CREATE INDEX IF NOT EXISTS idx_cta_label_links_session_id ON cta_label_links (session_id);
CREATE INDEX IF NOT EXISTS idx_cta_label_links_kk_order_id ON cta_label_links (kk_order_id)
  WHERE kk_order_id IS NOT NULL;

ALTER TABLE cta_label_links ENABLE ROW LEVEL SECURITY;

-- No public INSERT/UPDATE/SELECT — all writes via service_role Edge Function
-- Authenticated SELECT allows admin UI to load link metadata (e.g. workspace Labels tab)
CREATE POLICY "cta_label_links_service_role_all"
  ON cta_label_links FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "cta_label_links_authenticated_select"
  ON cta_label_links FOR SELECT TO authenticated USING (true);
```

### `cta_label_scans` — one row per QR scan event

```sql
CREATE TABLE IF NOT EXISTS cta_label_scans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text        NOT NULL,                  -- denormalized for fast insert
  link_id         uuid        NULL REFERENCES cta_label_links(id) ON DELETE SET NULL,
  print_id        uuid        NULL REFERENCES cta_label_prints(id) ON DELETE SET NULL,
  session_id      text        NULL,                      -- denormalized from link
  order_source    text        NULL,                      -- denormalized from link
  label_type      text        NULL,                      -- denormalized from link
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  user_agent      text        NULL,                      -- from request header
  ip_hash         text        NULL,                      -- SHA-256 hash of IP — NOT raw IP
  referrer        text        NULL,                      -- Referer header if present
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cta_label_scans_token ON cta_label_scans (token);
CREATE INDEX IF NOT EXISTS idx_cta_label_scans_link_id ON cta_label_scans (link_id);
CREATE INDEX IF NOT EXISTS idx_cta_label_scans_print_id ON cta_label_scans (print_id);
CREATE INDEX IF NOT EXISTS idx_cta_label_scans_session_id ON cta_label_scans (session_id);
CREATE INDEX IF NOT EXISTS idx_cta_label_scans_scanned_at ON cta_label_scans (scanned_at DESC);

ALTER TABLE cta_label_scans ENABLE ROW LEVEL SECURITY;

-- All writes via service_role only — no public or authenticated insert
CREATE POLICY "cta_label_scans_service_role_all"
  ON cta_label_scans FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "cta_label_scans_authenticated_select"
  ON cta_label_scans FOR SELECT TO authenticated USING (true);
```

**Why two tables (not one):**
- `cta_label_links`: represents an intent — a specific label print + its assigned tracking token + destination. Exists before any scan happens.
- `cta_label_scans`: represents an event — a customer scan. One link can have multiple scans (reprints, customer scans multiple times).
- Matches the SMS system pattern: `sms_messages` (intent) → `sms_events` (events).

**Why denormalize `session_id`, `order_source`, `label_type` onto `cta_label_scans`:**
- Enables fast analytics queries without a join: "how many eBay scans this week?" can run against `cta_label_scans` alone.
- Matches SMS system pattern (`sms_events` stores `phone` and `sms_message_id`).

---

## 5. Recommended Edge Function: `cta-label-redirect`

**File:** `supabase/functions/cta-label-redirect/index.ts`  
**Route:** Called from `r/index.html` relay, receiving `?t={token}`

### Logic:

```
1. OPTIONS → 200 CORS
2. Extract token from ?t= or path segment
3. If no token → 302 to SITE_URL
4. createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
5. SELECT * FROM cta_label_links WHERE token = $1
6. If not found → 302 to SITE_URL (never expose "invalid token" to customer)
7. If expires_at is set and now() > expires_at → 302 to SITE_URL (silently expire)
8. destination = row.destination_url

   Fire-and-forget scan insert:
   INSERT INTO cta_label_scans (token, link_id, print_id, session_id, order_source, label_type, scanned_at, user_agent, ip_hash, referrer)
   VALUES ($token, $link_id, $print_id, $session_id, $source, $type, now(), $ua, sha256($ip), $ref)

9. Return:
   302 Location: {destination}
   Cache-Control: no-store, no-cache, must-revalidate
   X-Robots-Tag: noindex
```

**IP handling:** Hash with SHA-256 (`crypto.subtle.digest("SHA-256", ...)`) — same pattern used by `verify-review-token`. Never store raw IP.

**Fallback on all errors:** Always redirect somewhere — never return an error page to the customer. Log errors to console only.

---

## 6. `/r/` Page Update

Current `r/index.html` handles `?c=` (SMS short_code). It needs to ALSO handle `?t=` (CTA token):

```js
// Updated relay logic (both SMS and CTA):
var params = new URLSearchParams(window.location.search);

var code = params.get('c');   // SMS click
var token = params.get('t');  // CTA label scan

if (code) {
  window.location.replace('https://...supabase.co/functions/v1/sms-redirect?code=' + encodeURIComponent(code));
} else if (token) {
  window.location.replace('https://...supabase.co/functions/v1/cta-label-redirect?t=' + encodeURIComponent(token));
} else {
  window.location.href = '/';
}
```

---

## 7. Token Generation Strategy

**Location:** Generated server-side inside `trackCtaLabelPrint`'s success path — or in a new `createCtaLabelLink()` call from `wireCta()` after a successful print.

**Timing:** Token is created **when the label is printed** (after `printLabel()` succeeds and `trackCtaLabelPrint()` returns `ok: true`). This ensures a `cta_label_prints` row exists before the `cta_label_links` row is inserted.

**Token format:**
```ts
const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
// e.g. "a3f9b21c7e480d6f" — 16 hex chars, 64 bits of entropy
```

**Rationale:**
- Uses `crypto.randomUUID()` (CSPRNG, not `Math.random()`).
- 16 hex chars = 64 bits of entropy — unguessable by brute force.
- Short enough to embed cleanly in a QR URL without bloat.
- Matches the style of `send-review-request` (which uses 10 chars — 16 is safer for a public-facing system).

**Token insert:** Done server-side via an authenticated API call that in turn calls an Edge Function (Option A) OR directly from the authenticated admin browser via Supabase client using service-role-equivalent logic (not recommended — service role key must not go to the browser).

**Recommended token write path:**
- Option A: A new Edge Function `create-cta-label-link` that accepts `{ print_id, session_id, kk_order_id, order_source, label_type, destination_url }` from the authenticated admin browser, generates the token server-side, inserts into `cta_label_links`, and returns the token. The admin browser then uses the returned token as the QR URL.
- Option B: Add a server-side token generation step to the existing `trackCtaLabelPrint` RPC path — not possible since tracking is currently a direct browser insert.

**Decision:** Option A is preferred. A small `create-cta-label-link` Edge Function keeps the token generation server-side (CSPRNG guaranteed to be server entropy) and keeps the service role key off the browser.

---

## 8. Updated `labelPrint.js` Integration Plan

Phase 2D requires changing the QR target from the direct destination URL to the tracking redirect URL. The cleanest integration:

```js
// labelPrint.js buildQrTarget() (Phase 2D version):
// Instead of returning the final URL directly, return a token-based redirect URL.
// The token is passed in from wireCta() after createCtaLabelLink() resolves.

// wireCta() in index.js (Phase 2D version):
// 1. Call printLabel() with direct URL (same as Phase 2C) — window opens.
// 2. In onPrinted callback:
//    a. Call trackCtaLabelPrint() → get print row ID.
//    b. Call createCtaLabelLink({ printId, sessionId, ... destination_url }) → get token.
//    c. Regenerate QR code with new tracking URL.
//    d. Rewrite print window with updated HTML (pw.document.open/write/close again).
// 3. If step 2b/2c fails → print window already has the direct QR. Acceptable fallback.
```

**Alternative integration (simpler):** Do token generation **before** showing the QR. This requires an async call before `window.open()` — which would break popup-blocker safety. Not acceptable.

**Confirmed safest integration sequence:**
1. `window.open()` — synchronous, in click handler. Print window opens.
2. Generate direct-URL QR, write first version of label HTML.
3. `onPrinted` callback → `trackCtaLabelPrint()` → if ok, call `createCtaLabelLink()` Edge Function → get token.
4. Regenerate QR with tracking URL.
5. `pw.document.open()` / `pw.document.write()` / `pw.document.close()` — rewrite window with tracking QR.
6. `onload` triggers `window.print()` — admin sees final version with tracking QR.

If step 3–5 fails (Edge Function down, admin offline, etc.): the print window is already open with the direct-URL QR. Customer can still scan it. No tracking is recorded. This is acceptable — the direct URL is the fallback.

---

## 9. Privacy / Security / RLS Design

| Concern | Decision |
|---------|---------|
| No raw IP stored | Hash IP with SHA-256 before insert — same as verify-review-token pattern |
| Scan insert must be service-role only | RLS: no anon/authenticated INSERT on `cta_label_scans` — only service_role. Edge Function holds the service role key. |
| Token must not expose order data | Token is opaque hex. Link lookup returns `destination_url` only to the Edge Function — never to the customer's browser. |
| Destination URL not visible before redirect | The Edge Function owns the lookup. The QR code contains only the token. |
| Expired/missing tokens | Always redirect to `SITE_URL` — never return an error page. Log to console only. |
| No customer login required | The scan endpoint is anonymous — no auth needed for the redirect. Only the Edge Function (service key) writes the scan event. |
| Admin can still read analytics | `authenticated SELECT` policy on both new tables. |

---

## 10. File-by-File Implementation Plan

### New files

| File | Purpose |
|------|---------|
| `supabase/functions/cta-label-redirect/index.ts` | Scan tracking redirect Edge Function |
| `supabase/migrations/20260517_cta_label_links_scans.sql` | Two new tables + indexes + RLS |

_(Note: migration file should use the next available date prefix if this ships on a later date.)_

### Modified files

| File | Change |
|------|--------|
| `r/index.html` | Add `?t=` handler alongside existing `?c=` SMS handler |
| `js/admin/lineItemsOrders/index.js` | `wireCta()` — add `createCtaLabelLink()` call in `onPrinted`, regenerate QR + rewrite print window |
| `js/admin/lineItemsOrders/api.js` | Add `createCtaLabelLink({ printId, sessionId, kkOrderId, orderSource, labelType, destinationUrl })` — calls new Edge Function |
| `js/admin/lineItemsOrders/labelPrint.js` | `printLabel()` — accept optional `trackingUrl` argument: if provided, regenerate QR and rewrite window after initial write |

### Unchanged files

| File | Notes |
|------|-------|
| `js/admin/lineItemsOrders/api.js` `trackCtaLabelPrint()` | No change — Phase 2C behavior preserved |
| `cta_label_prints` table | No schema change — `print_id` FK from `cta_label_links` references it |
| All other admin JS | No changes |

---

## 11. Testing Checklist

### Migration
- [ ] `cta_label_links` table created with all columns and indexes
- [ ] `cta_label_scans` table created with all columns and indexes
- [ ] RLS enabled on both tables
- [ ] `service_role ALL` policy on both tables
- [ ] `authenticated SELECT` policy on both tables
- [ ] No `anon` or `authenticated` INSERT policy on either table

### Edge Function: `cta-label-redirect`
- [ ] OPTIONS → 200
- [ ] Valid token → 302 to destination, scan row inserted
- [ ] Missing token → 302 to homepage, no insert
- [ ] Unknown token → 302 to homepage, no insert
- [ ] Expired token → 302 to homepage, no insert
- [ ] Edge Function down → N/A (direct QR fallback in print window)
- [ ] IP stored as SHA-256 hash, not raw
- [ ] `Cache-Control: no-store` on redirect
- [ ] Scan row has correct `token`, `link_id`, `print_id`, `session_id`, `order_source`, `label_type`

### `/r/` relay page
- [ ] `?c=` (SMS) still works as before
- [ ] `?t=` (CTA) correctly routes to `cta-label-redirect`
- [ ] No `?c=` and no `?t=` → fallback to `/`

### Frontend (admin orders page)
- [ ] KK print: tracking QR (with `/r/?t=...`) appears in print window
- [ ] eBay print: tracking QR appears in print window
- [ ] If `createCtaLabelLink` fails: direct QR still shows (fallback OK)
- [ ] `node --check js/admin/lineItemsOrders/*.js` passes

### Analytics
- [ ] Scan QR from phone → row in `cta_label_scans`
- [ ] Scan same QR twice → two rows in `cta_label_scans`
- [ ] `link_id` on scan row matches `id` in `cta_label_links`
- [ ] `print_id` on both link and scan rows matches `id` in `cta_label_prints`

---

## 12. Rollback Plan

Phase 2D is additive — no existing behavior is removed.

**If `cta-label-redirect` has a critical bug:**
- Revert `r/index.html` to Phase 2C version (remove `?t=` handler) — takes effect on next GitHub Pages deploy.
- Direct QR URLs (`leave-review.html` and homepage with UTM) continue to work unchanged.
- `cta_label_links` and `cta_label_scans` tables remain but receive no new data.
- `cta_label_prints` is unaffected.

**If `r/index.html` change causes issues:**
- Revert `r/index.html`. SMS `?c=` behavior is restored immediately.
- CTA labels fall back to direct QR (Phase 2C behavior).

**There is no required coordinated rollback** — each component degrades gracefully.

---

## 13. Recommended Phase 2D Implementation Prompt

> **Prompt:** Implement CTA label QR scan tracking (Phase 2D) for the Karry Kraze admin line items orders page.
>
> **Do these things in order:**
>
> 1. Create the migration file `supabase/migrations/<date>_cta_label_links_scans.sql` with `cta_label_links` and `cta_label_scans` tables, indexes, and RLS exactly as specified in `docs/audit/implementation/ctaLabel/005_phase2d_qr_scan_tracking_plan.md`.
>
> 2. Apply the migration via `pg` client (`node --env-file=.env _apply_migration.mjs`) — same approach used for `20260517_cta_label_prints.sql`.
>
> 3. Create `supabase/functions/cta-label-redirect/index.ts` — Deno Edge Function following the `sms-redirect` pattern. Must: accept `?t={token}`, lookup `cta_label_links`, insert `cta_label_scans` (fire-and-forget), 302 redirect. Always redirect on error/missing/expired — never return error page to customer. Hash IP with SHA-256.
>
> 4. Deploy the Edge Function: `echo y | npx supabase functions deploy cta-label-redirect --project-ref yxdzvzscufkvewecvagq`
>
> 5. Update `r/index.html` to handle `?t=` token redirect alongside existing `?c=` SMS handler.
>
> 6. Add `createCtaLabelLink({ printId, sessionId, kkOrderId, orderSource, labelType, destinationUrl })` to `js/admin/lineItemsOrders/api.js`. This calls the `cta-label-redirect` ... no, it calls a new `create-cta-label-link` Edge Function (or the admin inserts directly via authenticated client into `cta_label_links` — reconsider: use a small dedicated Edge Function to keep service role key server-side).
>
> 7. Update `printLabel()` in `labelPrint.js` to accept an optional `trackingUrl` parameter. If provided, after the initial label render, regenerate QR with tracking URL and rewrite the print window.
>
> 8. Update `wireCta()` in `index.js` to call `createCtaLabelLink()` in the `onPrinted` callback, then pass the returned tracking URL to `printLabel()` for a window rewrite.
>
> 9. Run `node --check js/admin/lineItemsOrders/*.js`.
>
> 10. Provide browser test steps for scan tracking verification.
>
> **Stop after Phase 2D. Do not implement coupon attribution (Phase 2E). Do not add a workspace Labels tab (Phase 2F).**

---

## 14. Open Questions Before Implementation

1. **Should `create-cta-label-link` be a dedicated Edge Function, or should the admin browser use the authenticated Supabase client to insert into `cta_label_links` directly?**  
   If the authenticated INSERT policy is used (not service_role), server-side token generation is not guaranteed — the browser calls `crypto.randomUUID()` which is CSPRNG-backed in modern browsers and Deno equally. Either is acceptable. Using a dedicated Edge Function is cleaner for auditability.

2. **Should `cta_label_links` have an `expires_at` populated at creation time?**  
   Suggested default: NULL (never expires). Labels on physical packages can be scanned months after printing. Only set `expires_at` if there is a specific campaign expiry requirement.

3. **Should reprints (admin clicks Print CTA again for same order) create a new token or reuse the existing one?**  
   Recommended: always create a new token. This allows distinguishing first-print vs. reprint scan events. The `cta_label_prints` table already records multiple prints per order.

4. **Should the scan event update `cta_label_prints` in any way (e.g. a `first_scanned_at` column)?**  
   Recommended: no — keep `cta_label_prints` as an insert-only event log. All scan data lives in `cta_label_scans`. Phase 2F workspace tab can JOIN the two tables.
