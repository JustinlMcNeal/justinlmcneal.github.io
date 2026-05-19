# Admin Social — Phase 4d Analytics Module Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4b (`006`), Phase 4c (`007`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Split monolithic `analytics.js` (~1,002 lines) into feature modules under `js/admin/social/features/analytics/`, with:

- `js/admin/social/analytics.js` as a **compatibility barrel**
- `js/admin/social/scoringPerformance.js` as a **barrel** to the moved scoring readout module

---

## 2. Before / after structure

### Before

```
js/admin/social/analytics.js          (~1,002 lines)
js/admin/social/scoringPerformance.js (~238 lines)
```

### After

```
js/admin/social/analytics.js              # barrel
js/admin/social/scoringPerformance.js     # barrel
js/admin/social/features/analytics/
  analyticsContext.js       # injected deps
  analyticsReload.js        # tab refresh orchestration (no circular imports)
  analyticsCards.js           # engagement metrics, top posts, grid, hashtags
  analyticsCharts.js          # overview stats, platform/status, time/tone charts
  analyticsTables.js          # re-export alias → analyticsCharts (recent activity)
  instagramInsights.js        # syncInstagramInsights
  postAnalyticsModal.js       # openPostAnalytics, modal init, deep analysis UI
  learningInsights.js         # learning dashboard + init
  categoryInsights.js         # category insight cards
  scoringPerformance.js         # quartile readout (moved from root)
  analyticsController.js        # init, setup, loadAnalytics, public re-exports
```

---

## 3. Public exports preserved

### `js/admin/social/analytics.js`

| Export | Module |
|--------|--------|
| `initAnalytics` | `analyticsController.js` |
| `setupAnalytics` | `analyticsController.js` |
| `syncInstagramInsights` | `instagramInsights.js` |
| `loadAnalytics` | `analyticsController.js` → `reloadAnalyticsTab` |
| `openPostAnalytics` | `postAnalyticsModal.js` |
| `loadLearningInsights` | `learningInsights.js` |
| `processAllPostsForLearning` | `learningInsights.js` |
| `initPostAnalyticsModal` | `postAnalyticsModal.js` |
| `initLearningInsights` | `learningInsights.js` |
| `loadCategoryInsightsUI` | `categoryInsights.js` |

**Importer:** `js/admin/social/index.js` — unchanged import path.

### `js/admin/social/scoringPerformance.js`

Re-exports: `SCORING_PERF_MIN_SAMPLE`, `SCORING_PERF_HARD_MIN`, `extractPriorityScore`, `buildScoringQuartileReport`, `renderScoringPerformanceReadout`, `loadScoringPerformance`.

**Importer:** `features/analytics/scoringPerformance.js` (internal); root barrel for any external use.

### Global

`window.openPostAnalytics` — still set in `postAnalyticsModal.js`.

---

## 4. Files created

All under `js/admin/social/features/analytics/` (see §2) plus this doc.

## 5. Files modified

| File | Change |
|------|--------|
| `js/admin/social/analytics.js` | Barrel only |
| `js/admin/social/scoringPerformance.js` | Barrel only (implementation moved) |

---

## 6. Behavior preserved

| Area | Status |
|------|--------|
| Analytics tab load (`loadAnalytics`) | Same sequence: dashboard → engagement metrics → scoring performance |
| Instagram insights sync | Same invoke body; still refreshes analytics + calendar + queue |
| Engagement cards / top posts / grid / hashtags | Unchanged HTML in `analyticsCards.js` |
| Overview + charts + recent activity | Unchanged in `analyticsCharts.js` |
| Post analytics modal + deep analysis | Unchanged in `postAnalyticsModal.js` |
| Learning + category UI | Unchanged; still uses `postLearning.js` imports only |
| Scoring quartile readout | Logic unchanged; import paths updated to `../../utils/` |

---

## 7. Intentionally left in barrels

- No logic in `analytics.js` or root `scoringPerformance.js` except re-exports.
- `analyticsTables.js` is a thin alias — recent activity lives in `analyticsCharts.js` to avoid an extra tiny file with duplicate logic.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Circular imports (sync ↔ loadAnalytics) | `analyticsReload.js` orchestrates refresh |
| `getClient()` replace typo during split | Fixed to `getAnalyticsContext().getClient()` |
| Duplicate `loadEngagementMetrics` on sync | Preserved (same as pre-split: `loadAnalytics` + explicit call) |
| `postLearning.js` untouched | No changes to learning engine |

---

## 9. Manual verification checklist

- [ ] Admin Social loads — no module 404
- [ ] Analytics tab: summary cards, platform bars, time/tone charts, recent activity
- [ ] Engagement row + top posts + all-posts grid + hashtag cloud
- [ ] Scoring performance section + low-sample alert
- [ ] Sync Instagram insights — spinner, last sync text, data refresh
- [ ] Click top post → post analytics modal; deep analysis; refresh
- [ ] Learning section + category research buttons
- [ ] `btnRefreshAnalytics` reloads tab

---

## 10. Recommended next phase

**Phase 4e** — Split `postDetail.js` / queue list helpers from `index.js` (per `004`).

**Phase 4f** — Slim `index.js` boot (OAuth, templates, boards).

---

## 11. Rollback

```bash
git revert <phase-4d-commit>
```

Restores single-file `analytics.js` and root `scoringPerformance.js`.
