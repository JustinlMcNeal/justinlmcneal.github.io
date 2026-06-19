# Growth tab — Phase 2 data, filters, and charts (014b)

**Date:** 2026-06-19  
**Status:** Implemented  
**Planning:** `docs/pages/admin/social/planning/014_growth_tab_three_phase_plan.md`  
**Phase 1:** `docs/pages/admin/social/implementation/014a_growth_tab_static_shell.md`

---

## Purpose

Turn the Growth tab static shell into a **read-only dashboard** powered by posted `social_posts` rows: filters, metric cards with period-over-period deltas, SVG growth trend chart, and platform breakdown — without changing Analytics, Auto-Queue, posting, edge functions, or DB schema.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Supabase read of `social_posts` (posted only) | Growth Score formula (Phase 3) |
| Date / platform / metric filters | Sync Insights duplicate button |
| Metric totals + PoP deltas | Analytics tab changes |
| Reach-weighted engagement rate | Chart.js or new dependencies |
| SVG line chart + CSS platform bars | Edge functions, migrations |
| Data coverage footnote + FB/PIN warnings | Public Socials page |

---

## Files changed

| File | Change |
|------|--------|
| `js/admin/social/features/growth/growthData.js` | **New** — fetch + normalize rows |
| `js/admin/social/features/growth/growthFilters.js` | **New** — period windows, buckets |
| `js/admin/social/features/growth/growthMetrics.js` | **New** — aggregation, PoP, coverage |
| `js/admin/social/features/growth/growthCharts.js` | **New** — SVG chart, platform bars |
| `js/admin/social/features/growth/growthState.js` | Cache, loading/error, render generation |
| `js/admin/social/features/growth/growthRender.js` | Live dashboard render |
| `js/admin/social/features/growth/growthContext.js` | Retry + coverage DOM refs |
| `js/admin/social/features/growth/index.js` | Lazy load, debounced filters, refresh |
| `pages/admin/social.html` | Error retry, coverage details wrapper |
| `css/pages/admin/social.css` | Growth chart styles |

---

## Data source

- Table: **`social_posts`**
- Filter: **`status = 'posted'`**
- Timeline: **`posted_at`** primary; if null on a posted row, **`scheduled_for`** fallback (console warning)
- Fields: `id`, `platform`, `status`, `posted_at`, `scheduled_for`, `likes`, `comments`, `saves`, `impressions`, `reach`, `engagement_rate`, `engagement_updated_at`
- Missing numeric metrics → **0**; `engagement_rate` → **null**
- Read-only — no writes

Fetch strategy: single fetch of all posted rows on first Growth tab open; cached until **Refresh**. Client-side period filtering (~173 posted rows today).

---

## Filter behavior

| Preset | Current period | Previous period | Buckets |
|--------|----------------|-----------------|---------|
| Last 7 days | Rolling 7 days (local) | Prior 7 days | Daily |
| Last 30 days | Rolling 30 days | Prior 30 days | Daily |
| Last 90 days | Rolling 90 days | Prior 90 days | Weekly (Mon start) |
| Year | Jan 1 → today (YTD) | Prior-year YTD (same calendar date) | Weekly |
| Since first post | Earliest post → today | Same duration immediately before | Adaptive: daily ≤60d, weekly ≤365d, else monthly |

- **Platform:** all / instagram / facebook / pinterest
- **Key metric:** likes, comments, saves, impressions, reach, engagement_rate; **Overall Growth Score** remains Phase 3 placeholder
- Filter changes debounced **150ms**; re-aggregate from cache (no refetch)
- **Refresh** invalidates cache and re-queries Supabase
- Day boundaries use **local browser timezone**

---

## Metric definitions

| Metric | Period total | Per-bucket |
|--------|--------------|------------|
| Likes, comments, saves, impressions, reach | Sum | Sum in bucket |
| Engagement rate | Reach-weighted avg: Σ(rate × reach) / Σ(reach); fallback simple mean of non-null rates | Same within bucket |

**Period-over-period change:**

- Previous 0, current > 0 → **New activity**
- Both 0 → **`--`**
- Otherwise signed **%** change

Growth Score card: **`--`**, badge **Coming in Phase 3**.

---

## Chart behavior

- **Main chart:** SVG polyline for selected metric over bucket timeline
- Sparse X-axis labels (first, middle, last)
- Y-axis compact numbers (`formatCompactNumber`); engagement rate as **%**
- Circle tooltips: date label, value, post count in bucket
- **Overall Growth Score** selected → placeholder message (no series)
- Empty range → empty-state copy with Analytics sync hint

---

## Platform breakdown behavior

- Always shows **Instagram, Facebook, Pinterest**
- Bar width = platform share of selected metric total (current period, all platforms — not platform-filtered)
- When platform has posts but zero/stale engagement (`engagement_updated_at` > 14 days or missing): **muted row** + coverage warning
- When Growth Score selected, breakdown uses **likes** totals (chart stays placeholder)

---

## Missing metric handling

- Null engagement fields treated as 0 for sums
- Null `engagement_rate` excluded from weighted average unless reach-weight path applies
- FB/Pinterest often zero/stale — gray bars + amber coverage warnings; never hidden
- Rows without `posted_at` or `scheduled_for` excluded from timeline

---

## What remains for Phase 3

- Overall Growth Score (0–100) formula and trend badge
- Score-driven chart series
- Insights strip (best platform, top driver)
- Optional multi-metric comparison chart
- Mobile polish pass
- Optional `scripts/verify-social-phase014-growth.mjs`

---

## Verification checklist

### Static

- [ ] `node --check` on all growth JS modules

### Manual

- [ ] Growth tab opens; no Supabase query before tab open
- [ ] Posted data loads; Refresh re-fetches
- [ ] All date presets produce sensible buckets
- [ ] Year = YTD vs prior-year YTD
- [ ] Platform filter restricts cards/chart
- [ ] Metric selector updates chart + card highlight
- [ ] PoP deltas and engagement rate weighting spot-check
- [ ] Platform breakdown always IG/FB/PIN; limited data muted
- [ ] Growth Score Phase 3 placeholder
- [ ] Go to Analytics switches tabs
- [ ] Other Admin Social tabs unchanged
- [ ] No console errors; mobile usable

---

## Risks / follow-ups

| Risk | Mitigation |
|------|------------|
| FB/PIN sparse metrics | Coverage UI; link to Analytics only |
| Full-table fetch at scale | Revisit pagination/rollups if posted count >> 2k |
| `posted_at` null rows | `scheduled_for` fallback + console warn |
| Year PoP leap-day edge | `priorYearSameCalendarDay` clamps month-end |
| Stale insight detection | 14-day threshold — tune if needed |

---

## Implementation log

| Date | Status |
|------|--------|
| 2026-06-19 | Phase 2 data, filters, charts implemented |
