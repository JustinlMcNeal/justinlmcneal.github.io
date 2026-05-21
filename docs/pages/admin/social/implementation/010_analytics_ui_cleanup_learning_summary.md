# Analytics UI cleanup — learning summary (010)

**Date:** 2026-05-21  
**Scope:** Analytics tab copy, section headings, posting-time clarity, Account Learning Summary, generic Instagram tips removal. No Autopilot scheduling changes, no exploration slots, no edge deploy.

## Purpose

Make Analytics answer four questions clearly:

| Question | Where |
|----------|--------|
| What happened? | Performance Overview (metrics, Sync Insights) |
| What worked? | What's Working (scores, top posts, hashtags) |
| Why did this post work? | Post Library & Deep Analysis |
| What can Autopilot use? | Learning Engine (tables + summary) |

## Current confusion

- **Posting Distribution** looked like “best time to post” but counts **scheduled/posted volume** only.
- **Heatmap** mixed with distribution; sample size not visible.
- **Generic Instagram Algorithm Tips** were not Karry Kraze-specific.
- **Sync Insights** vs **Update Learnings** vs **Deep Analysis** sounded interchangeable.

## New section model

1. **Performance Overview** — summary cards, Instagram Engagement, When We Posted, recent activity, status.
2. **What's Working** — scoring, top posts, hashtags, platform, caption tone usage.
3. **Post Library & Deep Analysis** — browse grid + modal behavior copy.
4. **Learning Engine** — actions, Account Learning Summary, recommendations, signals, heatmap, caption patterns, What AI Learned.

## Posting distribution vs performance

| UI | Meaning | Data source |
|----|---------|-------------|
| **When We Posted** | Scheduling habit / volume by time bucket | `social_posts.scheduled_for` (local browser hour) |
| **When Posts Performed Best** | Engagement by hour/day (ET) | `posting_time_performance` from posted IG + Sync Insights |

Helper copy states distribution **does not prove** best times. Heatmap cells show `eng% · n=posts` when available; low **n** labeled directional in summary cards.

## Sample size / confidence

| Signal | Threshold (UI) |
|--------|----------------|
| Hashtag in Autopilot pool | `times_used >= 2` (unchanged; noted in summary) |
| Heatmap cell | Show `n=` from `total_posts`; &lt;3 → directional styling |
| Best time/day cards | Uses top row; subtitle notes need more posts if empty |
| Scoring performance | Existing `SCORING_PERF_MIN_SAMPLE` in module |

## Generic Instagram tips

**Removed** from main tab. Optional **General platform notes** collapsed in `<details>` at bottom of Learning Engine (minimal generic content, not promoted).

**Replaced with Account Learning Summary** — only fields from DB (best time/day, top hashtag, top signal, scoring blurb, last sync / learning labels).

## Files changed

| File | Change |
|------|--------|
| `docs/pages/admin/social/implementation/010_analytics_ui_cleanup_learning_summary.md` | This doc |
| `pages/admin/social.html` | Section headings, copy, Account Learning Summary, tips removal/collapse |
| `js/admin/social/features/analytics/analyticsCharts.js` | When We Posted labels, volume note |
| `js/admin/social/features/analytics/analyticsCards.js` | Hashtag uses + confidence in analytics tab |
| `js/admin/social/features/analytics/learningInsights.js` | Heatmap samples, best time confidence, caption patterns, top signal |
| `js/admin/social/features/analytics/accountLearningSummary.js` | Account Learning Summary panel |
| `js/admin/social/features/analytics/analyticsReload.js` | Load learnings + summary on tab refresh |
| `js/admin/social/features/analytics/postAnalyticsModal.js` | Run Deep Analysis tooltip |

**Not changed:** edge functions, autopilot scheduling, scoring formulas, `postLearning.js` persist fix (separate commit if needed).

## Future: Posting Time Exploration (doc only)

Autopilot should mostly use learned best times but reserve **~20% experimental slots** (e.g. morning/night) so the system does not overfit afternoon-heavy history. OpenClaw could tune explore/exploit later. **Not implemented in 010.**

## Risks

- Browser local hour for “When We Posted” vs Eastern hour in heatmap — documented in copy.
- Account summary shows “Not enough data yet” until Sync Insights + Update Learnings run.

## Manual verification checklist

- [ ] Analytics tab loads; four section headings visible
- [ ] Sync Insights toast + last sync line
- [ ] Update Learnings toast
- [ ] When We Posted helper text visible
- [ ] Heatmap title “When Posts Performed Best” + sample hint
- [ ] Account Learning Summary populates without invented numbers
- [ ] Instagram tips not prominent (collapsed or removed)
- [ ] Deep Analysis modal + Run Deep Analysis title
- [ ] No console errors
