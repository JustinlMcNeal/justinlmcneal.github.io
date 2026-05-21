# Autopilot Run Now reliability fix

**Date:** 2026-05-19  
**Scope:** Admin Social autopilot fill, Run Now UI, Automation Health last-run, Post Now false-error handling.

## Symptoms

- Platform tokens healthy (Instagram, Facebook, Pinterest connected).
- Auto-Queue Preview works; pool-ready assets ~105.
- **Run Now** showed: `Queue is full! (0/18 posts scheduled)` while Automation Health showed **Queued: 0**, **Scheduled: 0**.
- **Last autopilot run** stuck at 5/18/2026 · 0 posts.
- **Post Now** on a failed Instagram post showed an error, but after refresh the post was **posted** with a working View on Instagram link.

## Root cause

### “Queue full 0/18”

Two separate issues:

1. **UI (`js/admin/social/autopilot.js`)** — Any run with `generated === 0` was labeled “Queue is full!” using `current/target`, even when `current < target` and `deficit > 0`. That matches the user message: **0/18 is not queue-full**, it means **auto-queue created nothing** while the window still needs posts.

2. **Server no-op paths (`supabase/functions/autopilot-fill/index.ts`)** — Early returns (disabled, queue full) and some failure paths **did not upsert `autopilot_last_run`**, so Automation Health looked stale even when Run Now was clicked daily.

3. **Window math (minor)** — `windowEnd` used `setDate` on a Date after UTC midnight setup, which can drift in non-UTC server locales. Fixed to **UTC-only** `setUTCDate` for `[tomorrow 00:00 UTC, tomorrow + days_ahead)`.

**Not the cause:** Counting all historical posts. Count query only includes `status IN ('queued','draft')` and `scheduled_for` in the fill window.

### Stale last autopilot run

`autopilot_last_run` was only written on successful auto-queue generation paths in older code. No-op and error runs left the 5/18 timestamp.

### Post Now false error

Likely combinations:

- **HTTP / JSON parsing** — Non-2xx or malformed body treated as hard failure in `platformPosting.js` even when partial success occurred.
- **DB update after IG publish** — `instagram-post` published to Meta then failed updating `social_posts`; edge still returned `success: true` in current code, but UI could show failure on network/parse errors.
- **Concurrent publish** — `process-scheduled-posts` may have posted after token reconnect while Post Now showed token error.

Low-risk mitigations: verify DB status after failed client response; return explicit `db_warning` when publish succeeds but DB update fails.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/autopilot-fill/index.ts` | UTC window, structured response, always write `autopilot_last_run`, `source: manual \| cron` |
| `js/admin/social/autopilot.js` | Truthful Run Now alerts; send `{ source: "manual" }`; refresh health after run |
| `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js` | Show status, reason, window counts from last run |
| `js/admin/social/features/posts/postActions.js` | Re-fetch post after failed Post Now; soft success if `status === posted` |
| `js/admin/social/features/platforms/platformPosting.js` | Safer JSON parse; return `{ success: false }` object instead of `null` |
| `supabase/functions/instagram-post/index.ts` | `db_warning` when publish OK but DB update fails |
| `docs/pages/admin/social/implementation/006_autopilot_run_now_reliability.md` | This doc |

**Not changed:** auto-queue scoring, image pool policy, Pinterest board routing, OAuth, public Socials page.

## autopilot-fill count logic

- **target_count** = `days_ahead × posts_per_day × platforms.length`
- **current_count** = posts with `status IN ('queued','draft')` and `scheduled_for` in `[tomorrow 00:00 UTC, tomorrow + days_ahead)` (exclusive end)
- **deficit** = `max(0, target_count - current_count)`
- **queue_full** only when `deficit <= 0` (returns `status: no_op`, `reason: queue_full`)
- **no_candidates** when `deficit > 0` but auto-queue `generated === 0`

## last-run payload (`autopilot_last_run`)

Every run (including no-op and errors) upserts:

- `ran_at`, `source` (`manual` \| `cron`), `enabled`
- `target_count`, `current_count`, `deficit`
- `posts_created` / `generated`, `skipped_count` when available
- `status`: `success` \| `no_op` \| `error`
- `reason`: `queue_full`, `disabled`, `no_platforms`, `no_candidates`, `error`, etc.
- `message`, `platforms`, `window_start`, `window_end`, `error` (sanitized)

## Run Now UI behavior

- **At target:** “Queue is at target … (current/target)” — only when `deficit <= 0` or `reason === queue_full`
- **Filled:** “Created N … (current+N/target)”
- **No posts:** “No posts were created (current/target; need deficit)” + server `message`
- Never shows “queue full” when `current < target`

## Post Now false-error findings

- Primary fix: after failed `postToInstagram`, **re-query** `social_posts`; if `posted`, show soft-success and refresh hub.
- Edge: if IG publish succeeds but DB update fails, response includes `success: true` + `db_warning` (UI still treats as success via `success` flag).

## Risks

- Deploy **autopilot-fill** and **instagram-post** required for server fixes in production.
- First Run Now after deploy will overwrite stale `autopilot_last_run` even if zero posts created (intended).
- Window counts in health “in window” may differ from global Queued/Scheduled totals (by design).

## Manual verification checklist

1. Do **not** Generate from Auto-Queue unless intended.
2. Note **Queued**, **Scheduled**, autopilot target (days × posts/day × platforms).
3. Click **Run Now**.
4. Confirm alert is **not** “queue full 0/18”.
5. Confirm **Last autopilot run** updates to **Just now** / today.
6. If deficit > 0 and candidates exist, queued count in window should increase.
7. If zero created, confirm **no_candidates** / clear message.
8. **Auto-Queue Preview** still works.
9. Optional: Post Now on a queued post — if error then refresh shows posted, UI should soft-success on retry path.

## Deploy note

Edge functions were **not** auto-deployed in this change. Deploy when ready:

- `autopilot-fill`
- `instagram-post` (optional but recommended for `db_warning`)
