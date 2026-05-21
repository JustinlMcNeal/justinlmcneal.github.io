# Analytics pipeline investigation (009)

**Date:** 2026-05-21  
**Scope:** Document Sync Insights, Deep Analysis, Update Learnings, and what Autopilot can use today. Small UI reliability/clarity fixes only. No Analytics tab reorg, no generic Instagram tips removal, no scoring/autopilot/image-pool/board changes.

## Purpose

Answer the product questions before Analytics UI cleanup:

1. **What happened?** — Metrics on `social_posts`, charts, top posts.
2. **Why did it happen?** — Deep Analysis + learning aggregates (hashtags, times, tones).
3. **What should Autopilot do differently?** — Partially: `auto-queue` reads learning tables; Autopilot does not read Deep Analysis or recommendations yet.

## Current Analytics tab sections (top → bottom)

| Section | Source |
|---------|--------|
| Summary cards (posted / week / scheduled) | `analyticsReload.js` / stats |
| Instagram Engagement + **Sync Insights** | `analyticsCards.js`, `instagramInsights.js` |
| Scoring performance | `scoringPerformance.js` |
| Top Performing Posts / Browse All | `analyticsCards.js` |
| Hashtag Performance (tab) | `hashtag_performance` via `analyticsCards.js` |
| Platform Performance | analytics reload |
| Recent Activity / Posting Distribution | `analyticsCharts.js` |
| Caption Tone Usage | `analyticsCharts.js` |
| Post Status Overview | analytics reload |
| **AI Learning Insights** header + **Update Learnings** | `learningInsights.js` |
| Smart Recommendations | `content_recommendations` via `getActiveRecommendations()` |
| Best posting time / heatmap / top hashtags | `posting_time_performance`, `hashtag_performance` |
| What AI Learned / category insights | `post_learning_patterns`, category research |
| Instagram Algorithm Tips (2026) | **Static HTML** — not data-driven |
| Post Analytics modal (Deep Analysis) | `postAnalyticsModal.js`, `postLearning.analyzePost()` |

## 1. Sync Insights pipeline

### UI → edge

| Step | Detail |
|------|--------|
| Button | `#btnSyncInstagramInsights` (“Sync Insights”) in Analytics tab |
| Handler | `setupAnalytics()` → `syncInstagramInsights()` in `instagramInsights.js` |
| Invoke | `client.functions.invoke("instagram-insights", { body: { syncAll: true, daysBack: 30 } })` |
| Modal refresh | `btnRefreshPostAnalytics` calls `syncInstagramInsights(postId)` with single-post scope |

### Edge: `instagram-insights`

| Input mode | Post selection |
|------------|----------------|
| `postId` | One post |
| `syncAll: true` + `daysBack: 30` | Instagram `posted` rows with `external_id`, `posted_at` ≥ 30 days ago, **limit 50** |
| Default (cron-style) | Posts with `engagement_updated_at` null or &gt; 6h old, `posted_at` within 30 days, **limit 50** |

### Writes

| Target | Fields |
|--------|--------|
| **`social_posts`** (primary) | `likes`, `comments`, `saves`, `shares`, `impressions`, `reach`, `engagement_rate`, `engagement_updated_at`, `permalink` / `instagram_permalink`, `updated_at`; deleted posts → `status: deleted`, metrics zeroed |
| **`social_hashtag_analytics`** | Per-post hashtag rows (tracking table) |
| **`posting_time_performance`** | Via `refreshTimingPerformance()` after any successful updates |
| **Learning aggregation** | Internal `fetch` to `auto-queue` with `{ learning_only: true }` → `runLearningAggregation()` |

**No separate “insights only” table** for post metrics. Timestamp used in UI: **`engagement_updated_at`** (not `insights_synced_at`).

### Errors

- Edge returns `{ success, updated, failed, deleted, errors[] }`.
- UI: `alert()` on failure; console log on success (improved in 009: clearer message with counts).

### Cron

| Job | Schedule | Same function? |
|-----|----------|----------------|
| `sync-instagram-insights` | `0 */6 * * *` | Yes — `instagram-insights` |
| `instagram-insights-weekly-sync` | `0 3 * * 0` | Yes |

Cron typically uses **default body** (stale &gt; 6h, last 30 days). Manual Sync uses **`syncAll` + 30 days** — broader sweep, same update path.

## 2. Deep Analysis pipeline

### Trigger

| Path | Behavior |
|------|----------|
| Open modal (`openPostAnalytics`) | If `engagement_updated_at` set: load `post_performance_analysis`; **if row exists and fresh → show cache**; if missing or **stale (&gt; 7 days)** → auto-run once; if no insights sync yet → no auto AI run |
| **Run Deep Analysis** button | Always **force refresh** (`analyzePost`) |
| Top post click / calendar posted | `openPostAnalytics(postId)` |

### Processing (`postLearning.analyzePost`)

1. Rule-based scores (timing, caption, hashtag, visual).
2. Optional **OpenAI** via `ai-generate` `type: "analyze_post"` (~1500 max tokens).
3. **Persists** to `post_performance_analysis` (`updated_at` on upsert).
4. `storeLearnings()` → `post_learning_patterns` (AI patterns for captions — not full autopilot driver).

### Does **not** update on Deep Analysis

- `social_posts` metrics (use Sync Insights).
- `hashtag_performance` / `posting_time_performance` directly (use Sync Insights side-effect or Update Learnings).
- Autopilot schedule or auto-queue scoring weights.

### Cache / staleness (after 009 UI pass)

- Cached row: `post_performance_analysis` for `post_id`.
- **Stale:** `updated_at` older than 7 days → auto-run on open.
- **Debounce:** same post won’t auto-trigger twice within 60s on repeated modal opens.
- UI shows **Last analyzed** when `updated_at` present.

## 3. Update Learnings pipeline

### UI

| Control | ID | Label |
|---------|-----|--------|
| Button | `#btnRefreshLearnings` | **Update Learnings** (helper text: rebuilds hashtag/time/recommendation tables from posted history) |

### Handler (`processAllPostsForLearning`)

1. Last **100** posted-success posts: `updateCaptionPerformance()` per caption.
2. `updateHashtagPerformance()` — client-side aggregate → `hashtag_performance`.
3. `updateTimingPerformance()` — → `posting_time_performance`.
4. `generateRecommendations()` — rule-based rows → `content_recommendations` (deactivates recs older than 24h first).

**Does not** call `instagram-insights` or OpenAI by default.

### Overlap with Sync Insights

After Sync Insights updates posts, edge also runs `refreshTimingPerformance` + `auto-queue` `learning_only`. **Update Learnings** is still useful to refresh caption perf + recommendations without hitting Instagram API.

## 4. Smart Recommendations / What AI Learned

| Block | Data-driven? | Autopilot use |
|-------|----------------|---------------|
| Smart Recommendations | Yes — `content_recommendations` from `generateRecommendations()` | **No** — display only |
| Top hashtags / heatmap | Yes — `hashtag_performance`, `posting_time_performance` | **Indirect** — `auto-queue` reads these for hashtag merge + `getNextPostingTimes()` |
| What AI Learned | `post_learning_patterns` | Caption AI / category research; not autopilot-fill |
| Instagram Algorithm Tips | **Static** | None — remove in UI cleanup phase |

## What Autopilot / auto-queue uses today

| Signal | Used by |
|--------|---------|
| `posting_time_performance` | `auto-queue` `getNextPostingTimes()` when enough samples |
| `hashtag_performance` | `auto-queue` hashtag merge / learned tags |
| `social_settings.auto_queue.scoring_weights` | Product scoring (not learning tables) |
| `engagement_rate` on old posts | Resurface winner pick (autopilot strategy) |
| Deep Analysis / `content_recommendations` | **Not wired** to autopilot-fill |

## Gaps (product vs goal)

| Gap | Impact |
|-----|--------|
| No single “learning engine” narrative in UI | Users see static IG tips + disconnected buttons |
| Deep Analysis not fed back to Autopilot | “What should Autopilot do?” only via implicit time/hashtag tables |
| Sync vs Update Learnings overlap | Confusing which button to press |
| Manual sync `syncAll` vs cron stale filter | Different coverage, same writer |
| Generic Instagram tips | Contradicts “learn from our data” story |

## Recommended UI cleanup phase (next)

1. Collapse/remove **Instagram Algorithm Tips**; replace with **Account Learning Summary** (sync time, last learn rebuild, peak slot, top hashtag).
2. Group actions: **Sync metrics** | **Rebuild learning tables** | per-post **Analyze**.
3. Surface `engagement_updated_at` + `post_performance_analysis.updated_at` consistently.
4. Optional: wire top 1–2 `content_recommendations` into Autopilot Control Center (read-only hints).
5. OpenClaw later: tune weights/times from performance — out of scope.

## Small fixes in 009 (code)

- Clearer Sync Insights success/partial-failure messaging.
- Deep Analysis: cache staleness (7d), 60s debounce, Last analyzed label, force refresh on button.
- Update Learnings button `title` helper text (label unchanged).

## Risks

- Stale analysis auto-run still costs OpenAI tokens (bounded by 7d + debounce).
- Sync Insights limit 50 posts per run — large catalogs need repeated syncs or cron.
- `learning_only` from insights does not run caption-element aggregation identically to full `processAllPostsForLearning`.

## Verification checklist

- [ ] Analytics tab loads without console errors
- [ ] Sync Insights: message shows updated/failed/deleted counts
- [ ] `#analyticsLastSync` reflects latest `engagement_updated_at` after load/sync
- [ ] Top post → modal; cached analysis shows without re-calling AI within 7d
- [ ] Run Deep Analysis forces new AI call
- [ ] Update Learnings refreshes recommendations / heatmap
- [ ] Scoring performance section loads
- [ ] Manual Preview/Generate does not call `analyze_post`
- [ ] Test Resurface / Repost still use `auto-repost`

## Edge deploy

**Not required** for 009 doc/UI-only pass. Redeploy `instagram-insights` / `ai-generate` only when those functions change.
