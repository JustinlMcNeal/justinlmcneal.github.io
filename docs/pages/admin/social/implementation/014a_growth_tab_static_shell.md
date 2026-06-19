# Growth tab — Phase 1 static shell (014a)

**Date:** 2026-06-19  
**Status:** Implemented (static UI only)  
**Planning:** `docs/pages/admin/social/planning/014_growth_tab_three_phase_plan.md`

---

## Purpose

Add a **Growth** tab to Admin Social with full layout, filters, placeholders, and tab routing — **no data fetching or calculations yet**.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Tab nav + `#tab-growth` panel | Supabase queries |
| Filter controls (static) | Metric aggregation |
| Placeholder cards & charts | Growth Score formula |
| Link to Analytics tab | Sync Insights duplicate |
| Tab lazy-load wiring | Edge functions, DB schema |
| Empty/loading/error containers (hidden) | Analytics / Auto-Queue changes |

---

## Operator decisions (locked)

- **Year preset:** Current YTD vs prior-year YTD (not rolling 365).
- **Sync Insights:** Link/switch to Analytics tab only.
- **FB/Pinterest:** Always show in breakdown; gray + coverage warning when metrics sparse.

---

## Tab placement

Nav order: … **Analytics** → **Growth** → **Carousel** …

---

## Files changed

| File | Change |
|------|--------|
| `pages/admin/social.html` | Growth tab button + `#tab-growth` panel |
| `css/pages/admin/social.css` | Growth platform gray state, chart placeholder |
| `js/admin/social/growth.js` | Thin facade |
| `js/admin/social/features/growth/growthContext.js` | DOM refs |
| `js/admin/social/features/growth/growthState.js` | Default filter state |
| `js/admin/social/features/growth/growthRender.js` | Placeholder render |
| `js/admin/social/features/growth/index.js` | `loadGrowth`, event wiring |
| `js/admin/social/boot/tabRouter.js` | `case "growth"` |
| `js/admin/social/index.js` | Import + `tabHandlers.loadGrowth` |
| `docs/pages/admin/social/planning/014_growth_tab_three_phase_plan.md` | Operator decisions |
| `docs/pages/admin/social/implementation/014a_growth_tab_static_shell.md` | This doc |

---

## Static layout & placeholder IDs

### Header

| Element | ID |
|---------|-----|
| (title in HTML) | — |

### Filters

| Control | ID |
|---------|-----|
| Date range | `#growthFilterRange` |
| Platform | `#growthFilterPlatform` |
| Metric | `#growthFilterMetric` |
| Refresh | `#btnGrowthRefresh` |

### Overall Growth Score

| Element | ID |
|---------|-----|
| Score | `#growthScoreValue` |
| Badge | `#growthScoreBadge` |
| Helper | `#growthScoreHelper` |

### Metric cards

| Metric | Value ID | Change ID |
|--------|----------|-----------|
| Likes | `#growthCardLikes` | `#growthCardLikesChange` |
| Comments | `#growthCardComments` | `#growthCardCommentsChange` |
| Saves | `#growthCardSaves` | `#growthCardSavesChange` |
| Impressions | `#growthCardImpressions` | `#growthCardImpressionsChange` |
| Reach | `#growthCardReach` | `#growthCardReachChange` |
| Eng. Rate | `#growthCardEngRate` | `#growthCardEngRateChange` |

### Charts & breakdown

| Section | ID |
|---------|-----|
| Main chart area | `#growthMainChart` |
| Platform breakdown | `#growthPlatformBreakdown` |
| IG bar | `#growthPlatformBarInstagram` |
| FB bar | `#growthPlatformBarFacebook` |
| PIN bar | `#growthPlatformBarPinterest` |

### Coverage & navigation

| Element | ID |
|---------|-----|
| Coverage note | `#growthCoverageNote` |
| Go to Analytics | `#btnGrowthGoAnalytics` |

### Phase 2 state containers (hidden in Phase 1)

| State | ID |
|-------|-----|
| Loading | `#growthLoadingState` |
| Empty | `#growthEmptyState` |
| Error | `#growthErrorState` |

---

## JS module structure

```text
js/admin/social/growth.js          → export loadGrowth
js/admin/social/features/growth/
  index.js                         → init, loadGrowth, filter listeners
  growthContext.js                 → resolveGrowthElements()
  growthState.js                   → default filters + get/set
  growthRender.js                  → renderGrowthPlaceholders()
```

---

## Intentionally not implemented (Phase 1)

- Supabase `social_posts` fetch
- Date range / platform / metric calculations
- Growth Score (0–100)
- Main chart SVG/data series
- Period-over-period % math
- `instagram-insights` / Sync Insights invoke

---

## Verification checklist

- [ ] Growth tab appears after Analytics
- [ ] `#tab-growth` opens; other tabs still work
- [ ] Filters visible and responsive
- [ ] Metric cards show `--` placeholders
- [ ] Growth Score shows `--` + “Waiting for data”
- [ ] Growth Trend placeholder visible
- [ ] Platform breakdown shows IG/FB/PIN; FB/PIN gray note
- [ ] “Go to Analytics” switches to Analytics tab
- [ ] Refresh re-renders placeholders (no network)
- [ ] No console errors
- [ ] Mobile stacks correctly
- [ ] `node --check` passes on growth JS files

---

## Phase 2 handoff notes

1. Add `growthData.js` — fetch posted rows with metrics; respect YTD vs prior-YTD in `growthFilters.js`.
2. Wire filter change handlers to re-aggregate (replace placeholder-only refresh in `index.js`).
3. Toggle `#growthLoadingState` / `#growthEmptyState` / `#growthErrorState` from data layer.
4. Replace `#growthMainChart` inner HTML with SVG line chart in `growthCharts.js`.
5. Platform breakdown: compute totals; apply `.growth-platform-row--limited` when platform has posts but no engagement metrics.
6. Keep `#btnGrowthGoAnalytics` — do not add Sync Insights button on Growth.

---

## Implementation log

| Date | Status |
|------|--------|
| 2026-06-19 | Phase 1 static shell shipped |
