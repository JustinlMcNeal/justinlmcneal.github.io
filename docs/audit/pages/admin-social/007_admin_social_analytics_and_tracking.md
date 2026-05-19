# Admin Social — Analytics & Tracking

---

## Implemented (in codebase)

### Post-level metrics (`social_posts`)

Columns from `20260111_add_engagement_tracking.sql`:

- `likes`, `comments`, `shares`, `saves`, `impressions`, `reach`, `clicks`
- `engagement_rate`, `engagement_updated_at`

**Source:** `instagram-insights` edge function (Instagram Graph). Pinterest/Facebook coverage **unclear** from UI.

### UI surfaces

| Surface | Module | Behavior |
|---------|--------|----------|
| Analytics tab | `analytics.js` | Totals, charts, top posts, tone breakdown |
| **Sync Instagram Insights** | `syncInstagramInsights()` | `functions.invoke("instagram-insights", { syncAll: true, daysBack: 30 })` |
| Post analytics modal | `analytics.js` | Per-post metrics + deep analysis |
| Learning insights panel | `postLearning.js` | Patterns, recommendations, category cards |
| Calendar/queue pills | `calendar.js` | Visual status; may show engagement badges |

### Aggregated tables

| Table | Purpose | Populated by |
|-------|---------|--------------|
| `posting_time_performance` | Best hour/day (ET-normalized in insights fn) | `instagram-insights`, `postLearning.js`, `auto-queue` |
| `hashtag_performance` | Hashtag effectiveness | Insights sync + `updateHashtagPerformance` |
| `post_learning_patterns` | JSON rules (timing, hashtag count, etc.) | Migrations seed + runtime aggregation |
| `post_performance_analysis` | Deep per-post analysis row | `analyzePost` / AI |
| `social_hashtag_analytics` | Per-post hashtag snapshots | **Unclear** usage frequency |

### Click / conversion tracking

| Mechanism | Status |
|-----------|--------|
| **UTM query params** on product links in captions | **Implemented** (auto-queue / todo notes) |
| **Meta Pixel** on storefront | **Implemented** on public pages (todo); not admin social page |
| **On-site click tracking** from IG bio/link | **Not** a dedicated admin social table — use analytics vendor / UTM in GA |

### Post outcomes

Tracked via `status` (`queued` → `posted`/`published`/`failed`) + platform IDs + `error_message`.

---

## Planned / unclear

| Item | Notes |
|------|-------|
| Engagement dashboard + comment reply UI | `docs/todo.md` Phase 2 — not implemented |
| Daily follower growth | Planned Sprint 7 |
| Reels metrics | On hold |
| Pinterest insight sync | No dedicated `pinterest-insights` found |
| Zero metrics on old posts | Was P0 in `pSocial_001`; todo marks insights fix **done** — verify data |

---

## Known gaps / risks

| Gap | Impact |
|-----|--------|
| Queries use `status = 'posted'` while migration may use `published` | Analytics under-report |
| Insights only as fresh as last sync | Stale UI if cron not running |
| Minimum sample thresholds | Learning may use seeded defaults until enough posts |
| `btnViewPostOnPlatform` generic fallback | Broken deep link when permalink missing |
| No admin social event analytics | No track of button clicks in manager |

---

## Implemented vs planned (summary)

| Area | Implemented | Planned/unclear |
|------|-------------|-----------------|
| IG metrics sync | Yes | — |
| Hashtag performance | Yes | — |
| Posting time optimization | Yes | Heat map UI |
| Learning patterns | Yes | — |
| UTM on links | Yes | — |
| Pixel / web conversion | Storefront only | Social-specific funnel dashboard |
| Comment engagement tools | No | Phase 2 todo |
