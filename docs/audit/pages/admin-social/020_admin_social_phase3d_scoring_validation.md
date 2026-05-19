# Admin Social — Phase 3d: Scoring Validation & Dry-Run Comparison

**Date:** 2026-05-19  
**Type:** Implementation (preview-only scoring comparison)  
**Prerequisites:** `018`, `019` (safety guards, 3c scoring)  
**Scope:** Operator visibility into 3c vs legacy ranking — **no** volume or publish changes

---

## 1. Purpose

Answer: *“Would the new 3c scoring pick different products than the old formula?”* without writing queue rows or changing autopilot math.

---

## 2. Comparison mode behavior

| Rule | Behavior |
|------|----------|
| Trigger | `preview: true` **and** `compareScoring: true` (or `compare_scoring`) |
| Writes | **None** — same as normal preview |
| Generate / autopilot | Ignored — flag only honored in preview |
| Admin UI | Preview Posts always sends `compareScoring: true` |

Returns:

- Normal preview posts (3c selection + captions/images)
- `scoring_comparison.candidates[]` — per-product comparison rows
- `scoring_comparison.summary` — run-level movement stats
- Each post may include `scoring_comparison` for its product

---

## 3. Legacy scoring approximation

Label: `legacy-pre-3c`

| Component | Max | Formula (matches pre-3c audit) |
|-----------|-----|--------------------------------|
| Recency | 40 | Never posted = 40; else min(40, days/30 × 40) |
| Category | 30 | `(catEng/max)×30` or **15** default if no data |
| Image freshness | 20 | min(20, unused_pool_count × 5) |
| Reserved | 10 | Flat +10 always |

**No** 3c penalties, inventory health split, or category sample gating.

Actual queue generation **always** uses 3c (`3c-v1`) only.

---

## 4. Fields returned

### Per candidate (`scoring_comparison.candidates[]`)

| Field | Description |
|-------|-------------|
| `current_score` | 3c total before post-level image-reuse penalty |
| `legacy_score` | Legacy approximation total |
| `score_delta` | current − legacy |
| `current_rank` | Rank among queue-ready products (3c sort) |
| `legacy_rank` | Rank if sorted by legacy score |
| `rank_delta` | legacy_rank − current_rank (positive = moved **up** under 3c) |
| `why_current_rank_changed` | Human-readable summary |
| `penalties_applied` / `boosts_applied` | From 3c score |
| `warnings` | Eligibility warnings (3b) |
| `selected_in_current_top` | In top `count` under 3c |
| `selected_in_legacy_top` | In top `count` under legacy |

### Run summary (`scoring_comparison.summary`)

- `candidates_compared`, `queue_ready_total`, `selection_count`
- `moved_up_by_new_scoring`, `moved_down_by_new_scoring`, `rank_unchanged`
- `skipped_by_guards`
- `top_reasons_for_rank_movement` — aggregated penalty/boost labels

---

## 5. UI display added

**`js/admin/social/autoQueue.js`**

- Indigo **Scoring comparison** table after run settings (preview only)
- Per-post line: 3c vs legacy score, rank movement
- Existing skipped panel and 3b/3c badges unchanged

---

## 6. How to interpret rank movement

| Signal | Meaning |
|--------|---------|
| **↑ rank_delta** | Product ranks higher under 3c (may still have lower absolute score vs legacy if neighbors changed) |
| **↓ rank_delta** | Product ranks lower under 3c (common when inventory penalties apply) |
| **legacy top only** | Would have been selected pre-3c but not in current top N |
| **selected** | In current preview batch top N |
| Large negative `score_delta` + **↑ rank** | Neighbors penalized more heavily under 3c |

Use preview to validate: zero-stock warnings should often correlate with ↓ rank or lower 3c score.

---

## 7. Engagement quartile evaluation (read-only SQL)

No dashboard in this phase. When `social_posts` rows include `selection_metadata.priority_score` (or JSON path) and `engagement_rate` after posting, run in Supabase SQL editor:

```sql
-- Posted Instagram rows with a stored priority score (adjust status/platform as needed)
WITH scored AS (
  SELECT
    id,
    COALESCE(
      (selection_metadata->>'priority_score')::numeric,
      (selection_metadata->'score_breakdown'->>'subtotal')::numeric
    ) AS priority_score,
    COALESCE(engagement_rate, 0) AS engagement_rate,
    posted_at
  FROM social_posts
  WHERE status = 'posted'
    AND platform = 'instagram'
    AND selection_metadata IS NOT NULL
    AND posted_at > NOW() - INTERVAL '90 days'
),
quartiles AS (
  SELECT
    *,
    NTILE(4) OVER (ORDER BY priority_score DESC NULLS LAST) AS score_quartile
  FROM scored
  WHERE priority_score IS NOT NULL
)
SELECT
  score_quartile,
  COUNT(*) AS posts,
  ROUND(AVG(engagement_rate)::numeric, 2) AS avg_engagement_rate,
  ROUND(AVG(priority_score)::numeric, 1) AS avg_priority_score
FROM quartiles
GROUP BY score_quartile
ORDER BY score_quartile;
```

Interpretation: over time, Q1 (highest priority scores) should average **≥** Q4 engagement if scoring aligns with outcomes. Small samples → inconclusive.

---

## 8. Manual validation checklist

- [ ] Preview with network tab: `compareScoring: true`, response has `scoring_comparison`, **no** new `social_posts` rows
- [ ] Generate & Schedule still creates posts; comparison absent or ignored
- [ ] Comparison table shows ↑/↓ counts and product rows
- [ ] Product with zero-stock warning often has lower 3c score or ↓ rank vs legacy
- [ ] Autopilot-fill: unchanged `days_ahead × posts_per_day` (grep only)
- [ ] Phase 3b skipped products still appear in skipped panel

**Deploy:**

```bash
npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq
```

---

## 9. Intentionally not changed

- Autopilot volume and `autopilot-fill` logic
- Publishing / cron functions
- 3c weights defaults and generate-path scoring
- Public social page
- Scoring weights admin UI
- Engagement dashboard

---

## 10. Risks

| Risk | Note |
|------|------|
| Legacy formula is approximation | Category default 15 vs 35% neutral in 3c — ranks are indicative |
| Comparison limited to top `max(count×3, 25)` candidates | Full catalog not listed |
| `rank_delta` vs `score_delta` can diverge | Relative ordering among peers |
| Old posts lack `priority_score` in metadata | Quartile SQL only works for new auto-queue posts |

---

## 11. Recommended next phase (3e)

- Optional checkbox to disable comparison (faster preview)
- Persist comparison snapshot to `social_settings` for audit trail
- Lightweight quartile report in admin analytics tab when N ≥ 30 posted rows
