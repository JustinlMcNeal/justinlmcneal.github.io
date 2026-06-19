# Growth tab — Phase 3 score, insights, and polish (014c)

**Date:** 2026-06-19  
**Status:** Implemented  
**Planning:** `docs/pages/admin/social/planning/014_growth_tab_three_phase_plan.md`  
**Prior phases:** `014a_growth_tab_static_shell.md`, `014b_growth_tab_data_filters_charts.md`

---

## Purpose

Complete the Growth tab as a **production-ready read-only dashboard**: Overall Growth Score (0–100), trend badges, rule-based insights, optional normalized metric comparison chart, mobile polish, and verification script — without changing Analytics, posting, edge functions, or DB schema.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Growth Score formula + breakdown UI | Analytics tab changes |
| Trend badge + momentum note | Sync Insights duplicate |
| Rule-based insights strip | AI recommendations |
| Compare metrics toggle (SVG) | Chart.js |
| Score trend when Key metric = Growth Score | Autopilot / posting changes |
| Mobile CSS polish | Edge functions, migrations |
| Verify script | Public Socials page |

---

## Files changed

| File | Change |
|------|--------|
| `js/admin/social/features/growth/growthMetrics.js` | Score, insights, comparison series, score buckets |
| `js/admin/social/features/growth/growthCharts.js` | Normalized multi-line comparison chart |
| `js/admin/social/features/growth/growthRender.js` | Score card, insights, compare mode |
| `js/admin/social/features/growth/growthState.js` | `compareMetrics` flag |
| `js/admin/social/features/growth/growthContext.js` | Phase 3 DOM refs |
| `js/admin/social/features/growth/index.js` | Compare toggle listener |
| `pages/admin/social.html` | Score details, insights strip, compare checkbox |
| `css/pages/admin/social.css` | Badges, insights, mobile, compare legend |
| `scripts/verify-social-phase014-growth.mjs` | **New** lightweight verify |
| `docs/pages/admin/social/implementation/014c_growth_score_insights_polish.md` | This doc |

---

## Growth Score formula

Uses **period-over-period momentum** across six metrics with default weights:

| Metric | Weight |
|--------|--------|
| Reach | 20% |
| Impressions | 20% |
| Engagement Rate | 25% |
| Likes | 15% |
| Comments | 10% |
| Saves | 10% |

For each included metric:

```text
growthRate = clamp((current - previous) / max(previous, ε), -1, 1)
normalized = (growthRate + 1) / 2    // 0..1
contribution = normalized × weight
GrowthScore = round(100 × Σ(contribution) / Σ(weights of included metrics))
```

**Rules:**

- Both periods missing/zero → metric **excluded**, weights **renormalized**
- Previous 0, current > 0 → growthRate = **+1** (capped)
- Current 0, previous > 0 → growthRate = **-1** (capped)
- Engagement Rate uses Phase 2 **reach-weighted** period totals
- No score when **no metrics qualify** (`--`, “Waiting for data”)

**Score delta:** Compares current score to score computed on previous vs before-previous windows (same span).

---

## Trend badge logic

Based on **current period score** (0–100):

| Score | Badge |
|-------|-------|
| 70–100 | **Growing** (green) |
| 45–69 | **Stable / Mixed** (amber) |
| 0–44 | **Declining** (red) |
| Insufficient data | **Waiting for data** (gray) |

**Momentum note** (score delta vs prior score window):

- Δ ≥ +3 → “Momentum improving”
- Δ ≤ −3 → “Momentum weakening”
- Otherwise → “Momentum steady” or “Baseline forming…”

---

## Insights logic

Rule-based only (no AI). Up to four items:

1. **Best platform** — highest reach total in platform breakdown  
2. **Top growth driver** — metric with highest weighted score contribution  
3. **Weakest metric** — lowest/negative contribution or lagging PoP card  
4. **Coverage** — FB/PIN incomplete; Instagram-heavy score warning when applicable  

---

## Comparison chart behavior

Toggle **Compare metrics** on Growth Trend:

- Renders **normalized 0–100 SVG multi-line** chart for Likes, Comments, Saves, Impressions, Reach, Engagement Rate
- Each series scaled to its **max within the selected period** (shape comparison, not absolute values)
- Color legend below chart; note explains normalization
- Uses existing bucket timeline from date preset
- No Chart.js

When toggle off, normal single-metric (or Growth Score bucket) chart applies.

---

## Mobile polish

- Metric grid `min-width: 0`; smaller card numbers on narrow screens  
- Score value scales down on mobile  
- Chart area horizontal scroll contained in wrapper (no page overflow)  
- `<details>` score explanation collapses by default  
- Insights strip uses responsive auto-fit grid  

---

## What remains as future follow-up

- Tunable score weights in UI  
- Multi-metric comparison as separate panel toggle persistence  
- Daily rollup table if posted count exceeds ~2k  
- Playwright smoke test for Growth tab (optional)  
- Facebook/Pinterest insights sync pipeline (outside Growth tab)  

---

## Verification checklist

### Static

- [ ] `node --check` on all growth JS modules  
- [ ] `node scripts/verify-social-phase014-growth.mjs`  

### Manual

- [ ] Phase 2 filters/cards/chart/breakdown still work  
- [ ] Growth Score 0–100 when data exists; `--` when not  
- [ ] Trend badge + momentum note  
- [ ] “How calculated” expands with weights / included / excluded  
- [ ] Insights strip sensible copy  
- [ ] Compare metrics toggle renders normalized chart  
- [ ] FB/PIN coverage warnings preserved  
- [ ] Go to Analytics works  
- [ ] Mobile layout usable; no console errors  
- [ ] No Supabase writes  

---

## Risks / follow-ups

| Risk | Mitigation |
|------|------------|
| Score distrust | Expandable breakdown + excluded metrics list |
| Instagram-heavy score | Coverage warning in score details + insights |
| Bucket score noise | Bucket score compares consecutive buckets only |
| Compare chart misread | Normalization footnote on chart |

---

## Implementation log

| Date | Status |
|------|--------|
| 2026-06-19 | Phase 3 score, insights, compare chart, polish shipped |
