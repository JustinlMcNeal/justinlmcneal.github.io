# Admin Social — Phase 3f: Scoring Performance Readout

**Date:** 2026-05-19  
**Type:** Implementation (read-only analytics)  
**Prerequisites:** `019`, `020`, `021` (3c scoring, validation SQL, admin weight controls)  
**Scope:** Engagement by priority-score quartile in Admin Social Analytics — **no** scoring, queue, or publish changes

---

## 1. Purpose

Give operators a lightweight way to see whether **higher auto-queue priority scores** correlate with **better post engagement** after publish, using existing `social_posts` rows and Instagram insights fields.

Answers: *“Are top-quartile scored posts performing better than bottom quartile?”* without changing formulas or volume.

---

## 2. Data sources

| Source | Fields used |
|--------|-------------|
| `social_posts` (Supabase, client read) | `status`, `platform`, `posted_at`, `selection_metadata`, `likes`, `comments`, `saves`, `impressions`, `reach`, `engagement_rate` |
| `selection_metadata` | `priority_score` (preferred), fallback `score_breakdown.subtotal`; optional `scoring_version` (not shown in UI) |
| `instagram-insights` edge (existing) | Populates engagement columns via existing sync — **not modified in 3f** |

**Not required:** new tables, migrations, or edge deploy for this phase.

**Posted filter:** `POST_SUCCESS_STATUSES` (`posted` only) via `isPostedSuccessStatus()`.

**Query:** Last 500 posted rows by `posted_at` desc (all platforms in sample; engagement often Instagram-heavy).

---

## 3. Query / helper behavior

**File:** `js/admin/social/scoringPerformance.js`

| Function | Role |
|----------|------|
| `extractPriorityScore(meta)` | Reads `priority_score` or `score_breakdown.subtotal`; returns `null` if missing/invalid |
| `buildScoringQuartileReport(posts)` | Client-side quartile buckets (mirrors `020` SQL `NTILE(4)` on score DESC) |
| `loadScoringPerformance(getClient)` | Supabase `.from("social_posts").select(...)` — **read only** |
| `renderScoringPerformanceReadout(report)` | Renders alert + compact table |

### Quartile buckets

| Bucket | Assignment |
|--------|------------|
| Top 25% | Highest priority scores among scored posted rows |
| 50–75% | Next quartile |
| 25–50% | Next quartile |
| Bottom 25% | Lowest scored quartile |
| Missing score | Posted rows without extractable `priority_score` |

Scored rows sorted by score descending; rank index maps to quartile 1–4 (same intent as `NTILE(4) OVER (ORDER BY priority_score DESC)` in `020`).

### Metrics per bucket (when data exists)

- Post count  
- Average priority score  
- Primary: average `engagement_rate` if any row has it; else average `likes`  
- Secondary hint in cell: avg likes (when eng rate primary) or avg eng rate when likes primary  
- Internal averages also computed for comments, saves, reach, impressions (not all shown in compact table)

---

## 4. UI added

**`pages/admin/social.html`** — Analytics tab, after engagement metrics card:

- Section title: **Scoring performance**  
- `#scoringPerformanceAlert` — low-sample warnings  
- `#scoringPerformanceTable` — quartile table  

**`js/admin/social/analytics.js`**

- `loadScoringPerformance(_getClient)` from `loadAnalytics()` (and thus after Instagram insights sync via `loadAnalytics()` refresh)

Columns shown: Quartile · Posts · Avg score · Avg engagement (or Avg likes).

---

## 5. Low-sample handling

| Constant | Value | Behavior |
|----------|-------|----------|
| `SCORING_PERF_HARD_MIN` | 3 | Below: alert *“Not enough scored posts yet”*, table replaced with short guidance |
| `SCORING_PERF_MIN_SAMPLE` | 20 | Below but ≥ 3: alert *“Directional only”*, table still shown |
| Per-bucket `n < 5` | — | Row note `(n<5)` in amber |

Missing-score rows do not crash UI; they appear in **Missing score** bucket when present.

---

## 6. Intentionally not changed

- Scoring formulas and `3c-v1` weights in `auto-queue`  
- Scoring defaults and `social_settings.auto_queue` save semantics (3e)  
- Auto-queue / autopilot volume and generate path  
- Publishing, cron, and `process-scheduled-posts`  
- Public Socials page (`pages/social.html`)  
- Admin page layout beyond one analytics card  
- Edge functions (no deploy for 3f)

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Small sample sizes | Hard/directional alerts; per-row `n<5` |
| Old posts lack `priority_score` | **Missing score** bucket; scored count in alert |
| Engagement only on synced IG posts | Fallback to avg likes; footnote when no `engagement_rate` |
| 500-row cap | Recent posts bias; increase later if needed |
| Quartile is score-rank, not calendar cohort | Documented; matches validation SQL intent |

---

## 8. Manual verification checklist

- [ ] Open Admin Social → Analytics tab: **Scoring performance** loads without console errors  
- [ ] Existing engagement metrics and top posts still work  
- [ ] Rows with null `selection_metadata` / missing score: UI stable, **Missing score** if any  
- [ ] With &lt; 3 scored posts: “Not enough scored posts yet” alert  
- [ ] With 3–19 scored posts: directional alert + table  
- [ ] Sync Instagram insights → section refreshes (via `loadAnalytics`)  
- [ ] No new write/update/insert calls in `scoringPerformance.js`  
- [ ] Network tab: only `social_posts` SELECT for this feature  

**Deploy:** None required for 3f.

---

## 9. Files

| File | Change |
|------|--------|
| `js/admin/social/scoringPerformance.js` | **New** — quartile helper + readout |
| `js/admin/social/analytics.js` | Import + call `loadScoringPerformance` |
| `pages/admin/social.html` | Scoring performance card in analytics |
| `docs/audit/pages/admin-social/022_admin_social_phase3f_scoring_performance.md` | This doc |

---

## 10. Recommended next phase

- Optional drill-down: list posts per quartile in a modal  
- Platform filter (Instagram-only toggle) when multi-platform volume grows  
- Persist weekly quartile snapshot to `social_settings` for trend history  
- Surface `scoring_version` breakdown when multiple versions coexist in metadata
