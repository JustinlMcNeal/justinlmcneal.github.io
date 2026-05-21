# Autopilot & Publish Reliability Investigation

**Date:** 2026-05-21  
**Type:** Read-only production investigation (no code/deploy/migration changes)  
**Edge versions referenced:** `auto-queue` v57, `autopilot-fill` v33 (deployed prior to this doc)

---

## Symptoms (operator report)

| Observation | Value |
|-------------|--------|
| Autopilot UI | Enabled, 3 days ahead, 2 posts/day, IG + Facebook + Pinterest |
| Automation Health | Last autopilot: **5/18/2026 ~10:00 PM** (local) · Last auto-queue: **just now (preview)** |
| Queue | **0 queued**, **0 scheduled** |
| Pool | **105** pool-ready assets |
| Manual preview | **4 posts**, **0 skipped** |
| Publish | A post scheduled for **today failed** |
| Migrations | `20260519_social_assets_content_type`, `20260520_pinterest_board_strategy` applied |

---

## Timeline (UTC unless noted)

| When | Event |
|------|--------|
| 2026-05-14 18:48 | `instagram_token_expires_at` — token expiry recorded |
| 2026-05-19 02:00 | `autopilot-fill-daily` cron **succeeded** (pg_cron) |
| 2026-05-19 02:00:20 | `autopilot_last_run.ran_at` updated; **`posts_created: 0`** |
| 2026-05-19 02:06 | `pinterest_token_expires_at` — Pinterest token expiry recorded |
| 2026-05-20 02:00 | `autopilot-fill-daily` cron **succeeded** — **no** `autopilot_last_run` update |
| 2026-05-21 02:00 | `autopilot-fill-daily` cron **succeeded** — **no** `autopilot_last_run` update |
| 2026-05-21 03:00 | Post `3a52911a-…` due (queued → processing) |
| 2026-05-21 03:00:07 | Post marked **failed**: `Instagram token expired. Please reconnect Instagram.` |
| 2026-05-21 14:34 | Manual **auto-queue preview**: 4 posts, `platform_distribution` IG 2 / Pinterest 2, image pool OK |

Local display **5/18 10:00 PM** ≈ **2026-05-19 02:00:20 UTC** (`autopilot_last_run.ran_at`).

---

## Files / functions inspected

| Area | Path |
|------|------|
| Autopilot edge | `supabase/functions/autopilot-fill/index.ts` |
| Queue generator | `supabase/functions/auto-queue/index.ts` |
| Publisher cron chain | `supabase/functions/process-scheduled-posts/index.ts` |
| Platform publishers | `instagram-post`, `facebook-post`, `pinterest-post` |
| Token refresh | `refresh-tokens` |
| Health UI | `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js` |
| Cron setup | `supabase/SETUP_CRON_JOB.sql`, `docs/audit/pages/admin-social/012_admin_social_phase2b_cron_oauth_runbook.md` |
| Prior docs | `002_image_pool_autopilot_reliability.md`, `003_pinterest_board_strategy_routing.md` |

---

## Code behavior summary

### `autopilot-fill` inputs & flow

1. Reads `social_settings.autopilot` (`enabled`, `days_ahead`, `posts_per_day`, `platforms`, `tones`, `posting_times`).
2. **Early exit (no `autopilot_last_run` update):**
   - `enabled === false` → `{ skipped: true, generated: 0 }`
   - `deficit <= 0` → queue “full” → `{ generated: 0, message: "Queue is full" }`
3. Counts posts with `status IN ('queued','draft')` and `scheduled_for` from **tomorrow 00:00 UTC** through **tomorrow + days_ahead** (calendar-day `setDate` on UTC midnight).
4. `targetCount = days_ahead × posts_per_day × platforms.length` (e.g. 3×2×3 = **18**).
5. `postsToGenerate = ceil(deficit / platforms.length)` → POSTs to `auto-queue` with `preview: false`.
6. **Only on successful auto-queue HTTP response** upserts `autopilot_last_run` with `ran_at`, `generated`, skip counts, etc.

**No dry-run / preview mode** — invoking autopilot-fill can create real posts.

### `auto_queue_last_run`

Written by **`auto-queue`** on every run (including **preview**), key `auto_queue_last_run`. Manual preview explains “just now” in Health while autopilot appears stale.

### Image Pool policy

`autopilot-fill` does not set image policy; **`auto-queue`** reads `social_settings.auto_queue` → default **`image_pool_only`**. Manual preview today used pool assets (`image_source: image_pool`, 0 `no_pool_asset_skipped`). **Image pool is not blocking generation now.**

### Pinterest routing

Only applied inside `auto-queue` for `platform === "pinterest"`. Not involved in today’s failed Instagram post.

---

## Production DB findings (read-only)

Queries: `scripts/investigation/q*.sql` via `npx supabase db query --linked -f …`

### `social_settings` (safe fields)

| Key | Notes |
|-----|--------|
| `autopilot` | `enabled: true`, `days_ahead: 3`, `posts_per_day: 2`, platforms `instagram`, `facebook`, `pinterest` |
| `autopilot_last_run` | `ran_at: 2026-05-19T02:00:20Z`, **`posts_created: 0`** (legacy field name; edge now writes `generated`) |
| `auto_queue_last_run` | `preview: true`, `ran_at: 2026-05-21T14:34:15Z`, 4 preview posts, `image_pool_only` |
| `auto_queue` | `image_asset_policy: image_pool_only`, UI platforms IG+Pinterest (autopilot uses 3 platforms) |

### `social_posts` status counts

| Status | Count |
|--------|------:|
| posted | 105 |
| failed | 26 |
| deleted | 10 |
| **queued** | **0** |
| **scheduled** | **0** (status unused in practice) |

### Autopilot window (tomorrow → +3 days)

- `queued` + `draft`: **0**
- All statuses in window: **0** (only the failed post below was in range historically)

### Failed post (today)

| Field | Value |
|-------|--------|
| **id** | `3a52911a-c4dd-4723-bf36-0d60a3377f06` |
| **platform** | `instagram` |
| **status** | `failed` |
| **scheduled_for** | `2026-05-21 03:00:00+00` |
| **error_message** | `Instagram token expired. Please reconnect Instagram.` |
| **image** | Public pool URL present |
| **selection_metadata** | `image_pool_only`, `image_source: image_pool`, AI caption accepted |
| **Pinterest** | N/A (`pinterest_board_id` null) |

Failure path: `process-scheduled-posts` → `instagram-post` → expiry check on `instagram_token_expires_at` before Graph API call.

### Token settings (presence / expiry only)

| Key | Status |
|-----|--------|
| `instagram_access_token` | Present |
| `instagram_token_expires_at` | **`2026-05-14T18:48:27Z` — expired** |
| `instagram_user_id` | Present |
| `pinterest_access_token` | Present |
| `pinterest_token_expires_at` | **`2026-05-19T02:06:08Z` — expired** |
| `facebook_page_id` | Present |
| `facebook_access_token` | **Not found** in token key query (publish likely broken for FB) |

`instagram_connected` / `facebook_connected` / `pinterest_connected` show `connected: true` but tokens live in **separate keys** (`instagram_access_token`, etc.).

### Cron jobs (active)

| jobname | schedule | active | URL |
|---------|----------|--------|-----|
| `autopilot-fill-daily` | `0 2 * * *` | yes | hardcoded `…/autopilot-fill` |
| `process-scheduled-social-posts` | `* * * * *` | yes | hardcoded `…/process-scheduled-posts` |
| `refresh-social-tokens-daily` | `0 3 * * *` | yes | hardcoded `…/refresh-tokens` |
| `sync-instagram-insights` | `0 */6 * * *` | yes | insights |
| `instagram-insights-weekly-sync` | `0 3 * * 0` | yes | insights |

No duplicate publish jobs found.

### Cron run history

- **`autopilot-fill-daily`:** **succeeded** every day 2026-05-12 through **2026-05-21 02:00 UTC** (`return_message: "1 row"` = pg_net dispatch only).
- **`process-scheduled-posts`:** No failed rows in last 48h in filtered query; publish failure is recorded on **`social_posts.error_message`**, not necessarily cron failure.

### `app.settings` (migration-style cron)

- `app.settings.service_role_key`: **not configured** (hardcoded Bearer in SETUP SQL jobs — OK if key in cron command).
- Autopilot/publish jobs use **hardcoded project URL** in `SETUP_CRON_JOB.sql`, not `app.settings.supabase_url`.

---

## Edge logs

Supabase CLI on this machine has **no `functions logs` subcommand**. Log review requires **Dashboard → Edge Functions → Logs** for:

- `autopilot-fill`, `auto-queue`, `process-scheduled-posts`, `instagram-post`, `refresh-tokens`

Suggested filter: since **2026-05-19 02:00 UTC** and **2026-05-21 03:00 UTC**.

---

## Safe tests performed

| Test | Result |
|------|--------|
| `autopilot-fill` dry-run | **Not available** — do not invoke in prod without explicit approval |
| `auto-queue` preview (prod API, prior session) | 4 posts, 0 skipped, pool OK, round-robin IG/Pinterest |
| Real Generate / Post Now / retry | **Not run** (per instructions) |

---

## Answers to primary questions

### 1. Why has autopilot-fill not run since 5/18?

**It has run.** Cron `autopilot-fill-daily` **succeeded daily** through 2026-05-21 02:00 UTC.

The UI is stale because **`autopilot_last_run` was last updated only on 2026-05-19 02:00 UTC**. Later cron fires did **not** update that row.

### 2. If it ran, why no queued/scheduled posts?

**Likely combination:**

1. **2026-05-19 run** completed auto-queue path but **`generated: 0`** (recorded as `posts_created: 0`) — all candidates skipped or empty batch at that time.
2. **2026-05-20 / 2026-05-21 02:00 runs** probably hit an **early exit** (`deficit <= 0` or `enabled: false` at that moment) which **does not update** `autopilot_last_run`. pg_cron still shows “succeeded” because it only means **HTTP POST was queued**.
3. **Today’s queue is empty** — the one post in the near window **failed** at publish time; nothing replaced it.
4. **Not** because Image Pool is empty today (preview proves 105 ready assets work).

### 3. Why did today’s scheduled post fail?

**Instagram OAuth token expired** (`instagram_token_expires_at` = 2026-05-14). `process-scheduled-posts` invoked `instagram-post`, which rejects expired tokens before posting. Image URL and pool metadata were fine.

### 4. Is cron invoking the right functions?

**Yes** — active jobs match runbook: `autopilot-fill`, `process-scheduled-posts`, `refresh-tokens`, insights.

### 5. Are cron secrets/settings valid?

- Jobs use **hardcoded** Supabase URL + embedded service role in SQL (repo SETUP pattern).
- `app.settings.service_role_key` is **not** set; not required for current job definitions.
- **Cannot verify** Bearer token validity from DB; HTTP dispatch succeeds.

### 6. Are autopilot / social_settings valid?

- **Autopilot config** in DB matches UI intent (enabled, 3d, 2/day, 3 platforms).
- **`autopilot_last_run`** is misleading (stale + legacy field `posts_created` vs `generated`).
- **`auto_queue` UI settings** differ slightly (2 platforms in `auto_queue` vs 3 in `autopilot`) — autopilot uses **`autopilot`** key only.

### 7. Are platform tokens valid enough to publish?

| Platform | Publish-ready? |
|----------|----------------|
| **Instagram** | **No** — token expired 2026-05-14 |
| **Pinterest** | **No** — token expired 2026-05-19 |
| **Facebook** | **Likely no** — `facebook_access_token` row missing |

Reconnect / refresh required before scheduled publish succeeds.

### 8. Does Image Pool-only policy block autopilot?

**Not currently.** Failed post was created with `image_pool` asset. Manual preview: 0 `no_pool_asset_skipped`. Policy could have caused **zero** `autopilot-fill` output on **2026-05-19** if pool was thinner then; **does not explain** publish failure today.

---

## Likely root cause (ranked)

| Priority | Issue |
|----------|--------|
| **P0** | **Expired Instagram token** → scheduled publish fails |
| **P0** | **Expired Pinterest token** → future Pinterest publishes will fail |
| **P0** | **Missing Facebook access token** → Facebook publishes likely fail |
| **P0** | **`refresh-tokens` not keeping IG valid** (expired since May 14; daily cron at 03:00 UTC not sufficient or refresh failing) |
| **P1** | **`autopilot_last_run` not updated** on queue-full / disabled / error paths → Health panel looks “stuck” while cron runs |
| **P1** | **pg_cron “succeeded” ≠ autopilot success** — no response-body checking |
| **P1** | **No autopilot dry-run** — hard to diagnose deficit/generate without creating posts |
| **P2** | Health UI reads `generated` but DB row may have `posts_created` |
| **P2** | `autopilot` vs `auto_queue` platform list mismatch |

Pinterest board routing: **not** implicated in today’s failure.

---

## Recommended fix phase (do not implement in this investigation)

### Phase A — Restore publish path (P0)

1. **Reconnect Instagram** in Admin Social (OAuth).
2. **Reconnect Pinterest** (and Facebook if used).
3. Confirm `instagram_token_expires_at` / `pinterest_token_expires_at` are in the future.
4. Review **Dashboard logs** for `refresh-tokens` on 2026-05-15–21 — fix refresh failures if any.
5. **Do not** mass-retry failed posts until tokens are valid.

### Phase B — Refill queue (after tokens)

1. Run **Autopilot Run Now** or wait for 02:00 UTC cron — expect `autopilot_last_run` to update with `generated > 0` if deficit > 0.
2. Confirm Health: queued > 0 for next 3 days.
3. Optional: single **Post Now** test on IG after reconnect.

### Phase C — Hardening (P1, separate PR)

- Update `autopilot_last_run` on **all** outcomes (full, skipped, error) with `last_status`, `message`, `deficit`.
- Add **`dry_run: true`** to `autopilot-fill` (no auto-queue write).
- Surface last error in Automation Health card.
- Align `posts_created` → `generated` in UI reader.

---

## Safe manual recovery steps

1. Reconnect **Instagram** (required).
2. Reconnect **Pinterest** / **Facebook** if those platforms stay enabled.
3. Verify token expiry rows in settings (future dates).
4. **Preview** auto-queue (4 products, 3 platforms) — confirm 0 skipped.
5. **Run Autopilot Now** once tokens are valid — verify queued count rises.
6. Watch one due post publish via cron (or Post Now on a test post).
7. **Do not** use Generate until preview + token state look correct.

---

## Risks

- Running autopilot-fill while tokens are expired → posts queue then **fail** at publish (repeat of today).
- Invoking autopilot-fill without dry-run → unintended live posts.
- Facebook enabled in autopilot but token missing → wasted slots / failed publishes.

---

## Verification checklist (post-fix)

- [ ] `instagram_token_expires_at` > now  
- [ ] `pinterest_token_expires_at` > now (if Pinterest enabled)  
- [ ] `facebook_access_token` present (if Facebook enabled)  
- [ ] `autopilot_last_run.ran_at` updates after Run Now or 02:00 cron  
- [ ] `autopilot_last_run.generated` > 0 when deficit > 0  
- [ ] Health: queued > 0 for next 3 days  
- [ ] `process-scheduled-posts` posts one test without `failed`  
- [ ] Preview: 4 posts, expected `platform_distribution` for 3 platforms  
- [ ] Edge logs: no token errors on publish path  

---

## Step 0 — UI parity push

Pushed **`da5b90a`** `fix(admin-social): distribute auto-queue platforms fairly` to `origin/main` (preview banner + round-robin; edge already v57).

---

## Investigation artifacts

Read-only SQL: `scripts/investigation/q01_settings.sql` … `q15_history_window.sql` (not committed).
