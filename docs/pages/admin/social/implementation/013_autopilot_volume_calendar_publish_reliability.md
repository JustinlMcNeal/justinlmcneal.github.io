# Autopilot volume, calendar clarity, and publish reliability (013)

**Date:** 2026-06-19  
**Status:** Implemented (pending edge deploy)  
**Scope:** Autopilot fill volume math, calendar status UX, Instagram carousel error passthrough, Facebook Graph rate-limit retries.  
**Out of scope:** Carousel frequency tuning (50% roll is intentional), OpenClaw, hashtag explore/exploit, comment learning, scoring formula changes.

---

## Related docs

| Doc | Relationship |
|-----|----------------|
| `004_autopilot_publish_reliability_investigation.md` | Prior May 2026 investigation (tokens, stale last-run) |
| `006_autopilot_run_now_reliability.md` | Run Now UI truthfulness, UTC window, Post Now soft-success |
| `001_calendar_queue_unification.md` | Calendar as scheduling hub; pill click routing |
| `002_image_pool_autopilot_reliability.md` | Image pool policy and asset insert fixes |
| `007_auto_queue_tab_clarity_strategy.md` | Autopilot vs manual queue ownership |

---

## Operator report (June 2026)

| Observation | Detail |
|---------------|--------|
| Todo item | “Fix Socials page — figure out why Instagram posts have been failing and not posting.” |
| Calendar impression | Instagram pills appear most days → feels like daily IG success |
| Gaps | Some days have **no posts at all**; some days **one or two platforms** missing |
| Carousels | Many recent IG posts show 🎠; unclear if bug or feature |
| Automation Health | Autopilot enabled; last cron run reported success but window still under-filled |

---

## Production findings (read-only, 2026-06-19)

Queries against `social_posts` and `social_settings` (last ~45 days, service role).

### Volume and status (recent window)

| Metric | Value |
|--------|------:|
| Posts in sample | 83 |
| `posted` | 72 |
| `queued` | 5 |
| `failed` | 6 |
| By platform | IG 29 · FB 28 · Pinterest 26 |

### Instagram specifically

| Period | Result |
|--------|--------|
| **May 23–25** | 2 IG posts/day, all `posted` |
| **June 1, 3, 7** | 3 **carousel** posts `failed` (only IG failures in window) |
| **June 11–17** | **7 consecutive days** `posted` (6 carousel + 1 single image) |
| **June 19** | 1 IG post `queued` for scheduled time |

**Conclusion:** Instagram is **not** in a sustained outage. Early-June carousel failures were real but **recovered**; the todo item is partially stale. Calendar UX makes healthy-looking coverage easy to misread.

### Autopilot under-fill (primary systemic issue)

Current autopilot settings:

```json
{
  "enabled": true,
  "days_ahead": 3,
  "posts_per_day": 2,
  "platforms": ["instagram", "facebook", "pinterest"],
  "posting_times": ["10:00", "18:00"]
}
```

**Target in fill window:** `3 × 2 × 3 = 18` queued posts.

**Last cron run (`autopilot_last_run`, 2026-06-19 02:00 UTC):**

| Field | Value |
|-------|------:|
| `target_count` | 18 |
| `current_count` | 0 |
| `deficit` | 18 |
| `posts_created` | 5 |
| `no_pool_asset_skipped` | 1 |

Only **5** posts were created when **18** were needed.

### Empty calendar days (last 21 days)

No `social_posts` with any status on: **June 2, 6, 9, 10, 12, 18**.

### Platform skew examples

| Day | Pattern |
|-----|---------|
| June 17 | IG + FB posted; Pinterest nothing scheduled |
| June 11 | IG + Pinterest posted; Facebook nothing |
| May 26 | FB + Pinterest only; Instagram missing |

### Carousel behavior (not a bug)

- Auto-queue `shouldUseCarousel()`: Instagram only, when product has **≥3 image pool assets**, **50% random** chance → 3–5 images.
- Pool data: **19 products** with 3+ pool images (carousel-eligible).
- May–June IG posted mix: **20 single + 9 carousel** (~36% carousel share).
- Recent streak (June 11–16) was carousel-heavy because those posts **succeeded** after early-June carousel failures stopped.

### Publish failures in window

| Platform | Error pattern | Count |
|----------|---------------|------:|
| Instagram (carousel) | Generic `Instagram carousel post failed` | 3 |
| Facebook | `Please reduce the amount of data you're asking for, then retry your request` | 3 |

---

## Root causes

### 1. Autopilot volume math mismatch (critical)

`autopilot-fill` computes:

```
target_count  = days_ahead × posts_per_day × platforms.length   // 18
deficit       = target_count - current_count_in_window
postsToGenerate = ceil(deficit / platforms.length)              // ceil(18/3) = 6
```

It then POSTs to `auto-queue` with `{ count: postsToGenerate }`.

**Assumption baked in:** each `count` slot produces **one post per platform** (3 posts per product).

**Actual auto-queue default:** `allow_multi_platform_per_product` is **false** unless explicitly set in `social_settings.auto_queue` or request body. With round-robin, each product slot produces **exactly one post** on a single platform:

```typescript
// auto-queue/index.ts
const platformsForProduct = allowMultiPlatformPerProduct
  ? platformList
  : [platformList[i % platformList.length]];
```

So `count: 6` → ~6 total posts, not 18. After eligibility skips, runs often land at **4–5 posts**.

This explains empty days, missing platforms, and only ~1 IG post/day despite `posts_per_day: 2`.

### 2. Calendar misleading coverage

`loadCalendarPosts()` fetches **all statuses** in the month range. `calendar.js` renders a pill for every post with `scheduled_for` on that day.

| Status | Visual today | Operator reads as |
|--------|--------------|-------------------|
| `posted` | Full-opacity IG gradient | Live on Instagram |
| `queued` | 70% opacity, same gradient | Live on Instagram |
| `failed` | Red background | Often missed among many pills |

There is **no status glyph** on the pill (only platform icon + optional 🎠). Past failed/queued items look like success at a glance.

### 3. Carousel errors swallowed upstream

`process-scheduled-posts` calls `instagram-carousel`, parses JSON, then:

```typescript
if (!igResult.success) {
  throw new Error(igResult.error || "Instagram carousel post failed");
}
```

When the edge returns non-JSON, empty `error`, or HTTP 500 with a generic body, `social_posts.error_message` stores the **fallback string** — not the Meta API message. `instagram-carousel` itself writes detailed errors on some paths (`Carousel creation failed: …`, `Publish failed: …`) but the scheduler overwrites with the generic fallback when `igResult.error` is missing.

### 4. Facebook Graph rate limiting (no retry)

Failed Facebook posts in June show Meta’s throttling message. `facebook-post` performs a **single** Graph API attempt with no backoff. Transient rate limits permanently mark the post `failed` until manual retry.

### 5. Todo item drift

The “Instagram failing” todo predates the June 11–17 recovery streak. Failures were **carousel-specific** and **time-bounded**, not a broken token or cron chain.

---

## Implementation plan

Five work items, shipped together in one phase. Order reflects dependency (volume fix first — it reduces empty days that make other issues louder).

---

### Work item A — Fix autopilot volume math

**Goal:** When autopilot requests posts, `auto-queue` `count` must match how many **individual queued posts** are needed for the fill window.

#### Design decision

Keep **round-robin single platform per product** as the default (variety, avoids triple-captioning the same product on the same day). Fix the **count** passed from autopilot, do **not** flip `allow_multi_platform_per_product` on globally.

| Mode | Posts per product slot | `count` to pass |
|------|------------------------|-----------------|
| Round-robin (default) | 1 | `deficit` |
| Multi-platform per product | `platforms.length` | `ceil(deficit / platforms.length)` |

#### Changes

| File | Change |
|------|--------|
| `supabase/functions/autopilot-fill/index.ts` | Read `allow_multi_platform_per_product` from `social_settings.auto_queue` (default false). Compute `postsToGenerate` per table above. Pass flag through to `auto-queue` body for consistency. Log `volume_mode: round_robin \| multi_platform` in `autopilot_last_run`. |
| `docs/pages/admin/social/implementation/013_…md` | Mark section implemented after deploy |

#### Acceptance criteria

- With settings `3 days × 2/day × 3 platforms`, empty window, and enough eligible products: next autopilot run creates **up to 18** queued posts (minus skips), not ~6.
- `autopilot_last_run` includes `volume_mode` and `posts_requested` (= `postsToGenerate`).
- Round-robin distribution: over a full fill, each platform receives roughly `posts_per_day × days_ahead` slots (±1 due to ordering).
- No change to manual Auto-Queue Preview/Generate count semantics.

#### Risks

- Larger batch per cron run → longer `auto-queue` execution (monitor timeout).
- More products consumed per day → watch `min_days_between_repeat` and pool exhaustion (existing guards).

---

### Work item B — Calendar status clarity

**Goal:** Calendar should answer “what actually went live?” at a glance, without removing access to queued/failed items.

#### UX spec

**Pill label** (compact, fits mobile):

| Status | Prefix | CSS class (existing + new) |
|--------|--------|----------------------------|
| `posted` | `✓` | `.cal-post.posted` |
| `queued` | `⏳` | `.cal-post.queued` |
| `failed` | `✗` | `.cal-post.failed` |
| `processing` | `…` | `.cal-post.processing` (new) |
| `deleted` | `❌` (keep) | `.cal-post.deleted` |

**Past vs future behavior:**

| Rule | Behavior |
|------|----------|
| **Today and future** | Show all statuses (queued + posted + failed) |
| **Past dates** | Default calendar view emphasizes **posted** pills; queued/failed on past days render **muted** (lower opacity + dashed border) so they read as “did not go live” |

**Optional hub toggle** (Calendar tab header, next to Calendar / List View):

- **Show all statuses** (default on) — current behavior + new glyphs
- When off: past days only render `posted` (+ `deleted` if present)

If toggle adds too much UI noise for v1, ship **glyphs + past-day muting** only; defer toggle.

#### Changes

| File | Change |
|------|--------|
| `js/admin/social/calendar.js` | Status prefix in `renderPostPill`; `isPastDate(dateStr)` helper; muted styling class for past non-posted |
| `css/pages/admin/social.css` | `.cal-post.processing`, `.cal-post.past-not-posted` (muted/dashed), ensure failed red wins over platform gradient |
| `pages/admin/social.html` | Optional status filter toggle in calendar hub header |
| `js/admin/social/features/posts/calendarHubView.js` | Wire toggle state + `calendar.refresh()` |

#### Acceptance criteria

- Failed IG posts on June 1, 3, 7 are immediately identifiable (✗ + red).
- Posted streak June 11–17 shows ✓ on IG pills.
- Queued future posts still visible with ⏳.
- List View unchanged (already shows status filters).

---

### Work item C — Instagram carousel error passthrough

**Goal:** `social_posts.error_message` stores the **actionable Meta / edge error**, not a generic fallback.

#### Changes

| File | Change |
|------|--------|
| `supabase/functions/process-scheduled-posts/index.ts` | On IG carousel failure: if `!igResp.ok`, include HTTP status in thrown error; if JSON parse fails, throw first 200 chars of body; prefer `igResult.error`, then `igResult.message`, then `igResult.db_warning`; never overwrite a detailed DB `error_message` already written by `instagram-carousel` (re-read post row before update on failure, or skip duplicate update if carousel edge already set `failed`) |
| `supabase/functions/instagram-carousel/index.ts` | Top-level `catch`: return `{ success: false, error: … }` with consistent shape; include `stage` (`create_item` \| `create_carousel` \| `publish`) in error string for logs |
| `supabase/functions/_shared/instagramPublish.ts` | No change required unless publish timeout messaging needs `stage` prefix |

#### Acceptance criteria

- Simulated carousel failure (bad image URL in staging) yields `error_message` containing Meta message or `Carousel creation failed: …` / `Publish failed: …`, not bare `Instagram carousel post failed`.
- Successful carousel path unchanged.

---

### Work item D — Facebook rate-limit retry

**Goal:** Transient Graph API throttling does not permanently fail scheduled posts.

#### Design

In `facebook-post/index.ts`:

1. Detect rate-limit responses:
   - Message contains `reduce the amount of data`
   - Graph `error.code` **4** or **17** (application / user rate limit) when present
2. Retry up to **3** attempts with delays **2s → 5s → 10s** (same pattern as `instagramPublish.ts` polling).
3. On final failure, persist full error to `social_posts` (existing path).

Optional: extract tiny `graphApiRetry.ts` in `_shared` if FB and future platforms need the same helper — only if it stays &lt;30 lines; otherwise inline in `facebook-post`.

#### Changes

| File | Change |
|------|--------|
| `supabase/functions/facebook-post/index.ts` | Retry loop around photo publish `fetch` |
| `supabase/functions/process-scheduled-posts/index.ts` | No change if `facebook-post` handles retries internally |

#### Acceptance criteria

- Unit-level: function recognizes rate-limit JSON and retries (log lines show attempt count).
- Manual: after deploy, failed FB posts from throttling can be reset to `queued` and succeed on retry window (document in QA).

---

### Work item E — Todo and operator messaging cleanup

**Goal:** Align `docs/todoPersonal.md` and in-app copy with investigated reality.

#### Changes

| File | Change |
|------|--------|
| `docs/todoPersonal.md` | Replace single “Instagram failing” bullet with split items: **done** carousel error passthrough + volume fix; **optional follow-up** carousel reliability monitoring; remove stale “IG not posting” framing |
| `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js` | When `autopilot_last_run.deficit > 0` after `success`, show amber note: “Window under-filled (created X, need Y more)” — uses existing last-run fields after Work item A adds `posts_requested` |

#### Acceptance criteria

- Todo reflects shipped fixes and remaining optional work.
- Automation Health surfaces under-fill without implying “queue full”.

---

## Files summary (implementation phase)

| Area | Files |
|------|--------|
| Autopilot volume | `supabase/functions/autopilot-fill/index.ts` |
| Calendar UX | `js/admin/social/calendar.js`, `css/pages/admin/social.css`, optionally `calendarHubView.js`, `pages/admin/social.html` |
| IG carousel errors | `supabase/functions/process-scheduled-posts/index.ts`, `supabase/functions/instagram-carousel/index.ts` |
| Facebook retry | `supabase/functions/facebook-post/index.ts` |
| Health + todo | `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js`, `docs/todoPersonal.md` |
| This doc | `docs/pages/admin/social/implementation/013_autopilot_volume_calendar_publish_reliability.md` |

**Not changed:** auto-queue scoring, carousel 50% probability, image pool policy, Pinterest routing, OAuth flows, public storefront social links.

---

## Files changed (implementation)

| File | Work item | Change |
|------|-----------|--------|
| `supabase/functions/autopilot-fill/index.ts` | A | Round-robin `posts_requested = deficit`; multi-platform keeps `ceil(deficit/n)`; passes `allow_multi_platform_per_product`; logs `volume_mode` |
| `js/admin/social/calendar.js` | B | Status glyphs (✓/⏳/✗/…); `past-not-posted` for past non-live pills |
| `css/pages/admin/social.css` | B | `.facebook`, `.processing`, `.past-not-posted` styles |
| `pages/admin/social.html` | E | `#aqHealthUnderfillWarning` |
| `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js` | E | Under-fill amber warning; `volume_mode` / `posts_requested` in last-run line |
| `supabase/functions/process-scheduled-posts/index.ts` | C | `resolveCarouselEdgeError`, `markPostFailed` with preserve detailed errors |
| `supabase/functions/instagram-carousel/index.ts` | C | `failCarousel()` with `stage` on all failure paths |
| `supabase/functions/facebook-post/index.ts` | D | Rate-limit detection + 3 retries (2s/5s/10s) |
| `docs/todoPersonal.md` | E | Split stale IG todo into shipped 013 items + optional monitoring |
| `docs/pages/admin/social/implementation/013_autopilot_volume_calendar_publish_reliability.md` | E | This doc |

**Skipped (optional):** Calendar “Show all statuses” toggle — shipped glyphs + past-day muting only.

---

## Deploy checklist

Edge functions (deploy when implementation is merged):

1. `autopilot-fill` — **required** for volume fix
2. `process-scheduled-posts` — **required** for carousel error passthrough
3. `instagram-carousel` — recommended (`stage` errors)
4. `facebook-post` — recommended (rate-limit retry)

Static assets (GitHub Pages / site deploy):

- `calendar.js`, `social.css`, optional HTML/hub toggle, `autoQueueAutomationHealth.js`

No new migrations expected.

---

## Manual verification checklist

### A — Autopilot volume

1. Note queued count in autopilot window (Automation Health “in window” after deploy adds field, or query `social_posts` where `status = queued` and `scheduled_for` in window).
2. Trigger **Run Now** with empty window and autopilot `3×2×3`.
3. Expect **up to 18** new queued rows (minus pool/eligibility skips), not ~6.
4. Confirm platform spread: each platform should have multiple slots across the 3-day window.

### B — Calendar

1. Open Calendar for June 2026.
2. Confirm June 1, 3, 7 IG pills show **✗** and muted/red styling.
3. Confirm June 11–17 show **✓** on posted IG pills.
4. Confirm future queued pills show **⏳**.

### C — Carousel errors

1. Find a failed carousel row (or staging test).
2. `error_message` must contain specific Meta or stage text.
3. Post a valid carousel — still `posted` with `external_id`.

### D — Facebook retry

1. Check edge logs for retry attempts on throttling (or staging mock).
2. Reset a throttled failed post to `queued`; verify publish on retry.

### E — Health / todo

1. After under-filled cron, Automation Health shows under-fill warning (not “at target”).
2. Todo item updated.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `auto-queue` timeout on `count: 18` | Monitor duration; if needed, split into two autopilot-fill passes in follow-up |
| Calendar muting hides failed posts | Failed keeps ✗ and red; only opacity reduction |
| Retries extend `process-scheduled-posts` wall time | FB retries capped at 3; total +17s max per FB post |
| Operator expects fewer carousels | Document 50% rule in Auto-Queue tab copy (optional follow-up, not this phase) |

---

## Optional follow-ups (not in 013)

| Item | Notes |
|------|-------|
| Carousel frequency knob | Setting for `carousel_probability` (default 0.5) |
| Autopilot loop until full | Multiple `auto-queue` invocations per cron until `deficit === 0` or no candidates |
| Unify posting times | Autopilot vs `auto_queue` times (see `007`) |
| Staging verify script | `scripts/verify-social-phase013.mjs` mirroring inventory verify scripts |

---

## Implementation log

| Date | Status | Notes |
|------|--------|-------|
| 2026-06-19 | **Planned** | Investigation complete; doc written before code |
| 2026-06-19 | **Implemented** | Work items A–E coded; edge functions not deployed |
