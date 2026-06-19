# Admin Social — Growth tab three-phase plan (014)

**Date:** 2026-06-19  
**Status:** Planning only — no code in this phase  
**Scope:** New **Growth** tab on Admin Social (`pages/admin/social.html`) showing social presence growth over time.  
**Out of scope (this plan):** Analytics tab changes, Auto-Queue, posting pipeline, edge functions, DB schema migrations, public Socials page, OpenClaw.

---

## Related docs

| Doc | Relationship |
|-----|----------------|
| `009_analytics_pipeline_investigation.md` | Sync Insights, `social_posts` engagement fields, learning tables |
| `010_analytics_ui_cleanup_learning_summary.md` | Analytics section ownership |
| `013_autopilot_volume_calendar_publish_reliability.md` | Recent Admin Social tab patterns |
| `000_docs_structure_convention.md` | Planning doc location convention |
| `docs/audit/pages/admin-social/007_admin_social_analytics_and_tracking.md` | Legacy analytics audit |

---

## 1. Purpose

Give the operator a **dedicated growth view** separate from the learning-heavy Analytics tab. Growth answers:

- Is Karry Kraze’s social presence **improving over time**?
- **Which platform** is driving growth?
- **Which metric** is improving or lagging?
- Is overall momentum **Growing**, **Flat**, or **Declining**?

Analytics remains the home for learning, Deep Analysis, Sync Insights, and recommendations. Growth focuses on **trends and period comparisons**, not caption/hashtag research.

---

## 2. User goals

| Goal | Success signal |
|------|----------------|
| See whether metrics are up or down vs last period | Metric cards show total + % change |
| Understand trend shape over time | Main growth chart updates with filters |
| Compare platforms | Platform breakdown bars or stacked contribution |
| One simple “am I growing?” answer | Overall Growth Score 0–100 + trend badge |
| Filter by time and platform quickly | Preset date ranges + platform selector work on mobile |
| Trust the numbers | Empty/partial-data states explain Instagram vs FB/Pinterest coverage |

---

## 3. Current data sources to inspect (before Phase 2)

### Primary table: `social_posts`

Engagement columns (from `20260111_add_engagement_tracking.sql`):

| Column | Use in Growth |
|--------|----------------|
| `likes`, `comments`, `saves` | Sum over period; chart series |
| `impressions`, `reach` | Sum over period; chart series |
| `engagement_rate` | Weighted average (see §8) |
| `platform` | Filter + breakdown |
| `posted_at` | **Primary date axis** for growth (when post went live) |
| `scheduled_for` | Fallback only if `posted_at` null on posted rows |
| `status` | Include **`posted` only** for growth metrics |
| `engagement_updated_at` | Data freshness indicator |
| `engagement_rate` null | Missing metric handling |

### How metrics get populated today

| Source | Platforms | Notes |
|--------|-----------|-------|
| `instagram-insights` edge + **Sync Insights** button | Instagram | Writes likes, comments, saves, impressions, reach, `engagement_rate` on `social_posts` |
| Cron `sync-instagram-insights` | Instagram | Same pipeline; 30-day window, batch limit 50 |
| Facebook / Pinterest publish | FB, Pinterest | Posts exist; **engagement fields often 0 or stale** unless manually synced later |

**Inspect during Phase 2 spike:**

- `js/admin/social/features/analytics/analyticsCards.js` — Instagram-only engagement totals query
- `js/admin/social/features/analytics/analyticsCharts.js` — overview stats; **HTML/CSS bar charts** (no Chart.js)
- `js/admin/social/features/analytics/scoringPerformance.js` — bucket averages pattern
- `js/admin/social/postStatus.js` — `POST_SUCCESS_STATUSES`, `isPostedSuccessStatus`
- `js/admin/social/utils/formatters.js` — `formatCompactNumber`
- `js/admin/social/boot/tabRouter.js` — lazy tab load switch
- `js/admin/social/index.js` — `tabHandlers` wiring

### Secondary tables (not Phase 2 primary)

| Table | Use |
|-------|-----|
| `posting_time_performance` | Analytics learning only — do not duplicate in Growth v1 |
| `hashtag_performance` | Analytics only |
| `social_engagement_snapshots` | If exists in migrations — check; may help future daily rollups |

**Decision:** Growth v1 reads **`social_posts` only**. No new edge functions in this plan.

---

## 4. Proposed tab layout

### Tab navigation

Insert after **Analytics**, before **Carousel** (or after Carousel — operator preference; default **after Analytics**):

```text
📊 Analytics  |  📈 Growth  |  🎠 Carousel
```

### Panel structure (`#tab-growth`)

```text
┌─────────────────────────────────────────────────────────────┐
│ Header: Growth — Social presence over time                  │
│ Subtext: Posted metrics · period vs previous period         │
├─────────────────────────────────────────────────────────────┤
│ Filters row (wrap on mobile)                                │
│ [Date range ▼] [Platform ▼] [Key metric ▼] [Refresh]          │
├─────────────────────────────────────────────────────────────┤
│ Overall Growth Score card (Phase 3) + trend badge             │
├─────────────────────────────────────────────────────────────┤
│ Metric cards row (6): Likes | Comments | Saves |            │
│   Impressions | Reach | Eng Rate — each: total + Δ%         │
├──────────────────────────┬──────────────────────────────────┤
│ Main growth chart        │ Platform breakdown               │
│ (selected metric)        │ (contribution to period total)   │
├──────────────────────────┴──────────────────────────────────┤
│ Optional multi-metric comparison chart (Phase 3 toggle)       │
├─────────────────────────────────────────────────────────────┤
│ Insights strip (Phase 3): best platform, top driver, note   │
├─────────────────────────────────────────────────────────────┤
│ Data coverage footnote (IG sync via Analytics; FB/PIN gray when sparse) │
└─────────────────────────────────────────────────────────────┘
```

Match existing Admin Social visual language: white cards, `rounded-xl`, `shadow-sm`, Tailwind utility classes from Analytics tab.

---

## 5. Filters

### Date range (preset)

| Preset | Current period | Chart aggregation (see §7) |
|--------|----------------|----------------------------|
| Last 7 days | Rolling 7 calendar days ending today (local) | **Daily** |
| Last 30 days | Rolling 30 days | **Daily** |
| Last 90 days | Rolling 90 days | **Weekly** (Mon–Sun buckets) |
| Year | **Current calendar year Jan 1 → today (YTD)** | **Weekly** |
| Since first post | `min(posted_at)` among posted rows → today | **Adaptive** (daily if ≤60 days span, weekly if ≤365, monthly if longer) |

**Timezone:** Use **local browser timezone** for day boundaries (consistent with Analytics time distribution in `analyticsCharts.js`). Document in UI footnote.

### Platform

| Value | Query filter |
|-------|----------------|
| All platforms | No platform filter |
| Instagram | `platform = instagram` |
| Facebook | `platform = facebook` |
| Pinterest | `platform = pinterest` |

### Key metric selector

| Value | Chart Y-axis | Card highlight |
|-------|--------------|----------------|
| Likes | Sum per bucket | Likes card emphasized |
| Comments | Sum per bucket | Comments card emphasized |
| Saves | Sum per bucket | Saves card emphasized |
| Impressions | Sum per bucket | Impressions card emphasized |
| Reach | Sum per bucket | Reach card emphasized |
| Engagement Rate | Weighted avg per bucket | Eng rate card emphasized |
| Overall Growth Score | Score per bucket (Phase 3) | Score card emphasized |

Changing any filter re-runs client-side aggregation (Phase 2) without full page reload.

---

## 6. Metrics definitions

All metrics computed from **`status = posted`** rows in the selected date range and platform filter.

| Metric | Period total | Per-bucket value |
|--------|--------------|------------------|
| Likes | Σ `likes` | Σ likes in bucket |
| Comments | Σ `comments` | Σ comments in bucket |
| Saves | Σ `saves` | Σ saves in bucket |
| Impressions | Σ `impressions` | Σ impressions in bucket |
| Reach | Σ `reach` | Σ reach in bucket |
| Engagement Rate | **Weighted avg** (§8) | Weighted avg in bucket |

**Period-over-period % change:**

```text
Δ% = ((currentTotal - previousTotal) / previousTotal) × 100
```

- If `previousTotal === 0` and `currentTotal > 0` → show **+100%** or **New activity** label.
- If both zero → show **—** or **0%**.

### Previous comparison period (answered)

**Mirror-length immediately preceding period** (standard PoP):

| Current range | Previous range |
|---------------|----------------|
| Last 7 days (days 0–6 ago) | Prior 7 days (days 7–13 ago) |
| Last 30 days | Prior 30 days |
| Last 90 days | Prior 90 days |
| **Year (YTD)** | **Prior-year YTD:** Jan 1 – same calendar date last year (same day-of-year window) |

**Operator decision (locked):** Year preset uses **current YTD vs prior-year YTD** — not rolling 365 vs previous 365.

**Since first post:** Previous period = same duration immediately before first post date (may be empty → show “No prior baseline”).

---

## 7. Growth chart behavior

### Aggregation strategy (answered)

**Adaptive by date range preset** (not one-size-fits-all):

| Range | Bucket size | Rationale |
|-------|-------------|-----------|
| 7 / 30 days | Daily | Enough points for trend |
| 90 days / Year | Weekly | Avoid noisy daily spikes |
| Since first post | Adaptive by span | Keeps 12–52 chart points target |

Bucket labels: short date (e.g. `Jun 12`) on X-axis; compact numbers on Y-axis via `formatCompactNumber`.

### Chart rendering (reuse vs new)

**Existing utilities to reuse:**

| Utility | Location | Reuse |
|---------|----------|-------|
| `formatCompactNumber` | `js/admin/social/utils/formatters.js` | Y-axis labels, cards |
| `setText` | `js/admin/social/utils/dom.js` | Card updates |
| HTML/CSS horizontal bars | `analyticsCharts.js` platform bars | Platform breakdown |
| `isPostedSuccessStatus` | `postStatus.js` | Filter posted rows |

**No Chart.js in repo today.** Phase 2 options (pick one during implementation):

1. **Recommended v1:** SVG polyline or CSS column chart (no new dependency; matches Analytics bar style).
2. **Optional v2:** Add Chart.js CDN on `social.html` only if SVG proves too brittle for multi-series comparison.

Main chart: **line or area** for single metric over time.  
Comparison chart (Phase 3): normalized index lines (each metric = % of its period max) so scales are comparable.

### Interactions

- Hover/tooltip on bucket: date, metric value, post count in bucket.
- Loading skeleton while fetching.
- Empty: “No posted data in this range — try Sync Insights on Analytics or widen range.”
- Error: retry button.

---

## 8. Overall Growth Score concept

### Purpose

Single **0–100** score answering “Is presence growing?” combining period-over-period momentum across six metrics.

### Starting formula (adjustable after real usage)

For each metric *m*, compute period PoP growth rate *g_m* (capped):

```text
g_m = clamp((current_m - previous_m) / max(previous_m, ε), -1, 1)
normalized_m = (g_m + 1) / 2   → 0..1
```

**Default weights:**

| Metric | Weight |
|--------|--------|
| Reach | 20% |
| Impressions | 20% |
| Engagement Rate | 25% |
| Likes | 15% |
| Comments | 10% |
| Saves | 10% |

```text
GrowthScore = round(100 × Σ (weight_m × normalized_m))
```

**Missing metrics:** If a metric has **no data in both periods**, exclude from sum and **renormalize remaining weights**. If metric missing in one period only, treat missing side as 0 for PoP (and show coverage warning).

**Engagement rate averaging (answered):**

- **Period total engagement rate:** weighted by reach  
  `Σ(engagement_rate × reach) / Σ(reach)` for posts with `reach > 0` and non-null `engagement_rate`.
- **Fallback:** simple mean of `engagement_rate` where not null if Σ reach = 0.
- **Per-bucket:** same weighting within bucket.

**Not** a straight average of post-level rates without weights (avoids small-post skew).

### Trend badges (Phase 3)

| Score Δ vs previous period | Badge |
|----------------------------|-------|
| ≥ +5 points | **Growing** (green) |
| −5 to +5 | **Flat** (amber) |
| ≤ −5 | **Declining** (red) |

Show expandable “How is this calculated?” linking to weights table.

---

## 9. Three implementation phases

### Phase 1 — Foundation and static UI

**Goal:** Tab shell and layout only; no real data calculations.

| Task | Detail |
|------|--------|
| Add Growth tab button | `data-tab="growth"` in `pages/admin/social.html` nav |
| Add `#tab-growth` panel | Full layout per §4 with placeholder IDs |
| Metric cards | Six cards with `--` placeholders + `%` change placeholders |
| Filter controls | Date range, platform, metric `<select>`s; Refresh button (no-op) |
| Chart containers | `#growthMainChart`, `#growthCompareChart`, `#growthPlatformBreakdown` empty shells |
| Growth Score card | Placeholder score `--` + hidden explanation |
| States | Loading skeleton CSS, empty state copy, error state copy |
| Tab router | `case "growth": tabHandlers.loadGrowth?.()` in `tabRouter.js` |
| Boot wiring | Stub `loadGrowth` in `index.js` / `pageBoot.js` |
| CSS | Optional `css/pages/admin/social.css` growth section |
| Guardrails | All existing tabs unchanged; no Analytics edits |

**Deliverable:** Operator can open Growth tab and see layout; numbers/charts static or zero.

**Files (expected):**

- `pages/admin/social.html`
- `css/pages/admin/social.css`
- `js/admin/social/boot/tabRouter.js`
- `js/admin/social/boot/pageBoot.js` or `index.js`
- `js/admin/social/features/growth/index.js` (stub)
- `js/admin/social/features/growth/growthRender.js` (static HTML bind)
- `docs/pages/admin/social/implementation/014a_growth_tab_phase1_static_ui.md` (after ship)

---

### Phase 2 — Data, filters, and charts

**Goal:** Real aggregation and interactive charts from `social_posts`.

| Task | Detail |
|------|--------|
| Data fetch | `growthData.js`: query posted rows with metrics + `posted_at` + `platform`; client-side filter by range |
| Posted-only filter | `status IN ('posted')` or `isPostedSuccessStatus` |
| Date range engine | `growthFilters.js`: compute current/previous windows per §5–6 |
| Aggregation | `growthMetrics.js`: daily/weekly/monthly buckets, totals, PoP % |
| Main chart | `growthCharts.js`: render selected metric series |
| Platform breakdown | Sum selected metric by platform for current period |
| Metric cards | Update totals + Δ% from `growthMetrics.js` |
| Filter wiring | Change handlers debounced 150ms; refresh button |
| Data coverage note | “Instagram: N posts with insights · Facebook: …” |
| Performance | Single fetch per tab visit; cache in `growthState.js` until Refresh |

**Query shape (Supabase):**

```javascript
.from("social_posts")
.select("id, platform, posted_at, likes, comments, saves, impressions, reach, engagement_rate, engagement_updated_at")
.eq("status", "posted")
.not("posted_at", "is", null)
.gte("posted_at", fetchStartISO)  // earliest needed for previous period
```

**Deliverable:** Filters drive chart and cards; Growth Score still placeholder or hidden until Phase 3.

**Files (expected):** All modules in §10; wire through `growth/index.js` + `growthContext.js`.

---

### Phase 3 — Growth Score, polish, and insights

**Goal:** Score, insights, comparison chart, mobile polish, docs.

| Task | Detail |
|------|--------|
| Growth Score | Implement formula §8 in `growthMetrics.js` |
| Score UI | Large score, trend badge, “How calculated” accordion |
| Comparison chart | Toggle “Compare metrics” — normalized multi-line |
| Insights strip | Best platform (highest Δ% on selected metric or score); top driver metric (largest weighted contribution) |
| Recommendations | Optional 1–2 rule-based tips (e.g. “Reach up but engagement flat — review captions”) — **no AI** |
| Mobile | Stack charts; horizontal scroll on metric cards; filter row wrap |
| Analytics boundary | Link “Sync Insights” → switch to Analytics tab (**no duplicate sync on Growth v1**) |
| Verification script | Optional `scripts/verify-social-phase014-growth.mjs` |
| Implementation doc | `014b`, `014c` phase completion notes |

**Deliverable:** Full Growth tab production-ready.

---

## 10. File structure

After inspecting Admin Social patterns (`features/analytics/*`, `boot/tabRouter.js`), **final recommended structure:**

| File | Responsibility | Est. lines |
|------|----------------|------------|
| `features/growth/growthContext.js` | DI: `getClient`, DOM refs, shared deps | ~40 |
| `features/growth/growthState.js` | Cached posts, filter state, last fetch time | ~80 |
| `features/growth/growthData.js` | Supabase fetch, normalize rows | ~120 |
| `features/growth/growthFilters.js` | Date/platform presets, period boundaries | ~150 |
| `features/growth/growthMetrics.js` | Bucketing, totals, PoP, weighted eng rate, score | ~250 |
| `features/growth/growthCharts.js` | SVG/CSS chart render, platform bars | ~200 |
| `features/growth/growthRender.js` | Cards, badges, insights, empty/error/loading | ~200 |
| `features/growth/index.js` | `initGrowth`, `setupGrowth`, `loadGrowthDashboard` | ~80 |

**Total:** ~1,120 lines across 8 files — each **under 500 lines**.

**HTML/CSS:** Growth panel in `pages/admin/social.html`; styles in `css/pages/admin/social.css` under `/* Growth tab */`.

**Do not** add all logic to `index.js` orchestrator — follow `analytics.js` thin facade pattern:

```javascript
// analytics.js pattern
export { loadAnalytics } from "./features/analytics/analyticsReload.js";
// growth.js (new)
export { loadGrowth } from "./features/growth/index.js";
```

---

## 11. Data assumptions

| Assumption | Impact |
|------------|--------|
| `posted_at` is set when post succeeds | Primary timeline axis |
| Instagram metrics refreshed via Sync Insights | Richest data; Growth chart most accurate for IG |
| Facebook/Pinterest may have zeros | **Always show in platform breakdown**; gray bar + coverage warning when metrics missing/stale — do not hide |
| ~173 posted rows today | Client-side aggregation OK; revisit if >2k posted |
| No historical snapshots table | PoP uses live `social_posts` only — deleted posts leave history gaps |
| `engagement_rate` is percentage 0–100 | Display with `%` suffix |

### Future migration (optional — not Phase 1–3)

Consider **`social_growth_daily_rollups`** materialized table if:

- Posted count exceeds ~2,000 and client fetch slows.
- Operator wants growth after post deletion.
- Facebook/Pinterest insights sync added later.

**Not required for initial Growth tab.**

---

## 12. Edge cases

| Case | Behavior |
|------|----------|
| No posted posts in range | Empty state; score hidden |
| Posts in range but all metrics zero | Chart flat at zero; footnote “Sync Insights for Instagram data” |
| `posted_at` null on posted row | Exclude from growth or fall back to `scheduled_for` (log warning in console) |
| Single post in bucket | Valid point; tooltip shows n=1 |
| Previous period empty | Δ% shows “New” or “—”; score uses normalized partial weights |
| Platform filter + sparse data | Breakdown shows one bar; others zero |
| Since first post &lt; 7 days | Daily buckets; previous period may be empty |
| Deleted Instagram posts | Excluded (`status != posted`); may reduce historical totals vs memory |
| User changes filter rapidly | Debounce; cancel in-flight render via generation counter in `growthState.js` |

---

## 13. Risks

| Risk | Mitigation |
|------|------------|
| FB/Pinterest metrics mostly empty | Data coverage UI; don’t imply cross-platform parity |
| Analytics vs Growth confusion | Clear subtitles; **link to Analytics tab** for Sync Insights — **no duplicate Sync button on Growth v1** |
| Chart library scope creep | Start SVG/CSS; defer Chart.js |
| Wrong PoP for “Year” | Document formula; unit test `growthFilters.js` |
| Large fetch on “Since first post” | Cap fetch at 2 years in v1 or paginate if needed |
| Growth Score distrust | Show breakdown of metric contributions; tunable weights later |
| Tab load regression | Lazy load only on Growth tab activate |
| Mobile clutter | Phase 3 polish; collapsible filters |

---

## 14. Verification checklist

### Phase 1

- [ ] Growth tab appears in nav
- [ ] Growth panel opens; other tabs still work
- [ ] Metric cards, filters, chart placeholders visible
- [ ] Empty / loading / error states render (toggle via dev flags)
- [ ] No console errors on tab switch
- [ ] Mobile: filters wrap; no horizontal page overflow

### Phase 2

- [ ] Filters update chart and metric cards
- [ ] Last 7 / 30 / 90 / Year / Since first post all produce sensible buckets
- [ ] Platform filter restricts data
- [ ] Metric selector changes main chart series
- [ ] Platform breakdown matches filtered totals
- [ ] Period-over-period % matches manual spot-check on 2–3 posts
- [ ] Only `posted` rows included
- [ ] Refresh reloads data

### Phase 3

- [ ] Growth Score displays 0–100 with explanation
- [ ] Trend badge Growing / Flat / Declining matches score delta
- [ ] Best platform / top driver insights show sensible text
- [ ] Comparison chart toggle works (optional)
- [ ] Mobile layout acceptable
- [ ] No changes to Analytics, Auto-Queue, posting behavior
- [ ] JS files under 500 lines each
- [ ] No console errors

---

## 15. Suggested commit plan

| Commit | Message | Phase |
|--------|---------|-------|
| 1 | `feat(admin-social): add Growth tab static shell (014 phase 1)` | HTML, CSS, tab router, stub modules |
| 2 | `feat(admin-social): Growth tab data filters and charts (014 phase 2)` | growthData, metrics, charts, filters |
| 3 | `feat(admin-social): Growth score and insights polish (014 phase 3)` | score, insights, mobile, docs |

Optional doc commits:

- `docs(admin-social): Growth tab phase 1 implementation`
- `docs(admin-social): Growth tab phase 2 implementation`
- `docs(admin-social): Growth tab phase 3 implementation`

**Do not** bundle with Analytics refactors or edge deploys.

---

## Planning questions — decisions recorded

| Question | Decision |
|----------|----------|
| Daily vs weekly aggregation? | **Adaptive by preset** (§7) |
| Previous period calculation? | **Same-length immediately preceding period** (§6) |
| Missing metrics? | Exclude from weighted score when both periods empty; renormalize weights; show coverage (§8, §12) |
| Engagement rate averaging? | **Reach-weighted** period and bucket averages; fallback to simple mean (§8) |
| Growth Score weights? | Default **25% eng rate, 20% reach, 20% impressions, 15% likes, 10% comments, 10% saves** — tunable later (§8) |
| Reuse chart utilities? | **`formatCompactNumber`, CSS bars, `setText`**; SVG line for main chart; no Chart.js in v1 (§7) |
| Year preset comparison? | **Current YTD vs prior-year YTD** (same calendar dates) — not rolling 365 |
| Sync Insights entry point? | **Link/switch to Analytics tab only** — no duplicate Sync Insights button on Growth v1 |
| FB/Pinterest in breakdown? | **Always show**; gray out + coverage warning when metrics missing/stale — never hide |

---

## Open questions for operator (resolved)

| Question | **Decision** |
|----------|--------------|
| Year preset comparison | **Current year-to-date vs prior-year year-to-date** |
| Sync Insights entry point | **Link/switch to Analytics tab only** — no duplicate button on Growth v1 |
| Facebook/Pinterest growth | **Show in breakdown**; gray/coverage warning when metrics missing — do not hide |

---

## Implementation log

| Date | Status | Notes |
|------|--------|-------|
| 2026-06-19 | **Planned** | Planning doc only; no code changes |
| 2026-06-19 | **Phase 1** | Operator decisions locked; static shell — see `014a_growth_tab_static_shell.md` |
