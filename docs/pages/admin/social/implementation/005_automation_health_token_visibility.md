# Automation Health — Token & Publish Failure Visibility

**Date:** 2026-05-21  
**Status:** Implemented (client/UI only)

---

## Purpose

Surface **expired or missing platform tokens** and **recent publish failures** in Admin Social so operators see that “Autopilot Active” does not mean posts will successfully publish.

Investigation reference: `004_autopilot_publish_reliability_investigation.md`.

---

## Files changed

| File | Change |
|------|--------|
| `js/admin/social/features/platforms/tokenHealth.js` | **New** — read-only token assessment (no secrets) |
| `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js` | Token list, warning banner, latest failure, `generated`/`posts_created` |
| `js/admin/social/autopilot.js` | Warnings when autopilot on + invalid tokens |
| `pages/admin/social.html` | Health + autopilot warning containers |
| `js/admin/social/index.js` | Wire new health element refs |

**Not changed:** auto-queue scoring, image pool policy, board routing, posting edge functions.

---

## Before / after

| Area | Before | After |
|------|--------|--------|
| Automation Health | Queue counts, last run times | + platform publish readiness, token expiry dates, blocking warning when autopilot on |
| Autopilot card | “Active” only | + amber warning when selected platforms cannot publish |
| Failed publish | Only in post detail / DB | + latest failure summary on Auto-Queue tab |
| `autopilot_last_run` count | Often missing (`generated` vs `posts_created`) | Reads both fields |

---

## Token health rules

Settings read (values never shown):

| Platform | Keys |
|----------|------|
| Instagram | `instagram_connected`, `instagram_username`, `instagram_access_token`, `instagram_token_expires_at` |
| Pinterest | `pinterest_connected`, `pinterest_access_token`, `pinterest_refresh_token`, `pinterest_token_expires_at` |
| Facebook | `facebook_connected`, `facebook_page_id`, `facebook_page_token` |

States:

- **valid** — token present, expiry &gt; 7 days away (Instagram/Pinterest)
- **expiring soon** — ≤ 7 days (Instagram/Pinterest)
- **expired** — past `expires_at`
- **missing token** — connected flag but no token row / empty token
- **not connected** — `connected !== true`

Facebook: requires `facebook_page_token` + `facebook_page_id` (same OAuth flow as Instagram). No expiry row; warns if page token missing or Instagram token invalid.

**Can publish** = rules above pass for each autopilot-selected platform.

---

## Refresh-token findings (not implemented)

`refresh-tokens` (daily 03:00 UTC cron):

1. **Instagram** — Only attempts refresh when token expires within **7 days**. Once expired (e.g. 2026-05-14), refresh still runs (`daysUntilExpiry <= 7`) but Meta **`fb_exchange_token` fails on dead tokens** — error stored in `token_refresh_last_run` but not shown in UI.
2. **Pinterest** — Uses `pinterest_refresh_token`; does **not** update `pinterest_token_expires_at` on success, so UI expiry can stay stale even after refresh.
3. **Facebook** — Refreshed only as side effect of Instagram page token exchange; no standalone Facebook OAuth path in refresh.
4. **Cron “succeeded”** — pg_cron only confirms HTTP dispatch, not edge JSON `success`.

**Proposed follow-up (low-risk):** persist refresh errors to `social_settings`, update Pinterest expiry on refresh, attempt Instagram reconnect prompt when refresh errors; optional: refresh when `daysUntilExpiry < 0` with clear “reconnect required” result.

---

## Risks

- Token **presence** is inferred from settings shape; edge cases (partial OAuth) may show “connected” but still fail at API.
- Pinterest “can publish” uses stored expiry; may be stale if refresh succeeded without updating expiry.
- Latest failure shows **one** row (most recent `failed` by `updated_at`).

---

## Manual verification checklist

- [ ] Open Admin Social → Auto-Queue tab  
- [ ] Automation Health shows Instagram **expired** with date if applicable  
- [ ] Pinterest **expired** visible when applicable  
- [ ] Facebook **missing token** when selected without page token  
- [ ] Amber banner: “Autopilot is active, but selected platforms cannot publish…”  
- [ ] Latest failure shows Instagram token message (no raw tokens)  
- [ ] Autopilot card warning when enabled + bad tokens  
- [ ] Header Connect buttons still work  
- [ ] Auto-Queue Preview still works  
- [ ] Reconnect Instagram/Pinterest → health turns green after reload  

---

## Operational action

1. Reconnect **Instagram** (required for today’s failed post).  
2. Reconnect **Pinterest** (and Facebook via Instagram OAuth if Facebook remains enabled).  
3. Confirm token expiry dates in Automation Health.  
4. Run Autopilot or wait for 02:00 UTC fill after tokens valid.  
5. Do not retry failed posts until publish readiness is green.
