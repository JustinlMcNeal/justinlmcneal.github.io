# 012 — Analytics compact columns layout

**Date:** 2026-05-21  
**Status:** Implemented (HTML layout only)  
**Suggested commit:** `style(admin-social): compact analytics dashboard layout`

## Purpose

Reduce vertical scrolling on the Admin Social **Analytics** tab by using responsive multi-column grids and tighter (not cramped) spacing, while keeping the four logical sections from 010 and all existing JS behavior.

## Current issue

After 010, content was clearer but most blocks were **full-width stacked cards**, wasting horizontal space on desktop and making the tab feel long.

## Layout strategy

### 1. Performance Overview

| Block | Layout |
|-------|--------|
| Summary metrics (Total, Published, This Week, Scheduled) | Full width, `grid-cols-2 lg:grid-cols-4` |
| Instagram Engagement + When We Posted | `lg:grid-cols-2`, `items-start` |
| Recent Activity + Post Status Overview | `md:grid-cols-2` |

### 2. What’s Working

| Block | Layout |
|-------|--------|
| Scoring Performance + Platform Performance | `lg:grid-cols-2` |
| Top Performing Posts | Full width |
| Hashtag Performance + Caption Tone Usage | `lg:grid-cols-2` |

### 3. Post Library & Deep Analysis

| Block | Layout |
|-------|--------|
| Browse All Posts thumbnail grid | Full width; denser `xl:grid-cols-12`; click → Deep Analysis unchanged |

### 4. Learning Engine

| Block | Layout |
|-------|--------|
| Learning actions (Update Learnings) | Full width |
| Account Learning Summary + Smart Recommendations | `lg:grid-cols-2` |
| Signal cards (Best Time, Day, Hashtags, Top Signal) | `grid-cols-2 lg:grid-cols-4` |
| Your Top Hashtags + When Posts Performed Best (heatmap) | `lg:grid-cols-2` |
| Caption Best Practices | Full width (internal 2-col dos/don’ts) |
| General platform notes | `<details>` collapsed by default |
| What AI Learned + All AI Learnings | Full width; All AI Learnings stays in `<details>` |

**Spacing:** Tab outer `gap-6` → `gap-4`; section wrappers `space-y-6` → `space-y-4`; card headers `p-4` → `p-3 sm:p-4` where touched.

## Files changed

| File | Change |
|------|--------|
| `docs/pages/admin/social/implementation/012_analytics_compact_columns_layout.md` | This document |
| `pages/admin/social.html` | Analytics tab (`#tab-analytics`) responsive grids only |

**Not changed:** `js/admin/social/features/analytics/*.js`, `js/admin/social/analytics.js`, edge functions, DB schema, calculations, Sync/Deep Analysis/Update Learnings logic.

## Sections affected

All four Analytics sections (wrappers now `<section class="space-y-4">`). No other tabs modified in this pass.

## Responsive behavior

- **&lt; md:** Single column stack; no forced side-by-side.
- **md:** Recent Activity + Status Overview in two columns.
- **lg+:** Two-column pairs for engagement/time, scoring/platform, hashtags/tone, learning summary/recommendations, hashtags/heatmap.
- Scrollable sub-panels use `max-h-*` + `overflow-y-auto` so paired columns don’t stretch the page unevenly.
- Heatmap table keeps `overflow-x-auto` and `min-w-[400px]` for small screens.

## Risks

| Risk | Mitigation |
|------|------------|
| Duplicate IDs after moving nodes | Verified single instance per bound ID; no ID renames |
| Charts/lists too narrow in 2-col | `items-start`; scroll caps; full width for Top Posts and Browse grid |
| Uneven column heights | Expected; `items-start` avoids stretch artifacts |

## Manual verification checklist

- [ ] Open Admin Social → Analytics tab — no console errors
- [ ] Summary cards populate
- [ ] **Sync Insights** updates metrics and last-sync text
- [ ] Scoring Performance table renders
- [ ] Top Performing Posts load; click opens Deep Analysis modal
- [ ] Browse All Posts grid loads; click opens Deep Analysis
- [ ] **Update Learnings** still refreshes learning blocks
- [ ] Account Learning Summary renders
- [ ] Desktop (≥1024px): two-column sections visible, less scrolling than before
- [ ] Mobile (~375px): single column, no horizontal page overflow
- [ ] Carousel tab still works (not nested inside Analytics)

## Static checks (run locally)

```bash
node --check js/admin/social/features/analytics/analyticsCharts.js
node --check js/admin/social/features/analytics/analyticsCards.js
node --check js/admin/social/features/analytics/learningInsights.js
node --check js/admin/social/features/analytics/accountLearningSummary.js
node --check js/admin/social/features/analytics/scoringPerformance.js
node --check js/admin/social/analytics.js
```

All passed on 2026-05-21.
