# Admin Social — Current File Size & Responsibility Map

**Date:** 2026-05-19  
**Method:** Repo inspection (`Measure-Object -Line` on committed files)  
**Entry:** `pages/admin/social.html` → `<script type="module" src="/js/admin/social/index.js">`

**Thresholds:**

| Lines | Flag |
|-------|------|
| > 500 | Refactor candidate |
| > 1,000 | **High-priority** split candidate |

---

## 1. HTML & CSS

### `pages/admin/social.html` — **2,389 lines** — HIGH-PRIORITY

| Aspect | Detail |
|--------|--------|
| **Responsibilities** | Header (OAuth, settings, auto-queue CTA, new post); stats row; 8 tab panels (`calendar`, `queue`, `assets`, `templates` hidden, `boards`, `autoqueue`, `analytics`, `carousel`); upload/settings/post-detail/post-analytics modals; inline Tailwind config |
| **JS entry** | `index.js` only (+ `pwa.js`) |
| **DOM** | `#tabContent`, `#tab-*`, `#kkAdminNavMount`, hundreds of element IDs consumed by modules |
| **Supabase** | None direct |
| **Split?** | Yes — defer until JS boundaries clear (Phase 4g optional) |
| **Edit risk** | **Very high** — any ID rename breaks multiple JS files |

### `css/pages/admin/social.css` — **912 lines** — Refactor candidate

| Aspect | Detail |
|--------|--------|
| **Responsibilities** | Modals, pool grid, calendar pills, animations |
| **Split?** | Optional by tab/modal later; low urgency vs JS |

---

## 2. Page JS (`js/admin/social/`)

### `postLearning.js` — **1,385 lines** — HIGH-PRIORITY

| Aspect | Detail |
|--------|--------|
| **Exports** | `checkAndResearchCategories`, `getCategoryInsights`, `getAllCategoryInsights`, `BEST_PRACTICES`, `analyzePost`, `updateHashtagPerformance`, `updateTimingPerformance`, `updateCaptionPerformance`, `generateRecommendations`, `getTopHashtags`, `getBestPostingTimes`, `getActiveRecommendations`, `getLearnedPatterns`, `getPostCreationTips` |
| **Imports** | `supabaseClient`, `postStatus`, `env` |
| **DOM** | None direct (logic/service layer) |
| **Tables** | `social_posts`, `post_learning_patterns`, `hashtag_performance`, `posting_time_performance`, `social_hashtag_analytics`, `post_performance_analysis`, `social_category_insights`, etc. |
| **Edge** | `ai-generate` (category research) |
| **Split?** | **Yes** → `learning/analysis.js`, `learning/aggregates.js`, `learning/recommendations.js`, `learning/categoryResearch.js` |
| **Edit risk** | **Very high** — analytics + upload + captions import subsets |

---

### `analytics.js` — **972 lines** — Refactor candidate (near high-priority)

| Aspect | Detail |
|--------|--------|
| **Exports** | `initAnalytics`, `setupAnalytics`, `syncInstagramInsights`, `loadAnalytics`, `openPostAnalytics`, `loadLearningInsights`, `processAllPostsForLearning`, `initPostAnalyticsModal`, `initLearningInsights`, `loadCategoryInsightsUI` |
| **Imports** | `api.getPublicUrl`, `postStatus`, `postLearning` (many), `scoringPerformance` |
| **DOM** | Heavy — `#tab-analytics`, `#analytics*`, `#postAnalytics*`, `#learning*`, `#scoringPerformance*`, `#btnSyncInstagramInsights`, etc. (~63 `getElementById`/`querySelector` uses) |
| **Tables** | `social_posts`, `hashtag_performance`, `post_performance_analysis` |
| **Edge** | `instagram-insights` via `client.functions.invoke` |
| **Split?** | **Yes** → controller + cards + modals + learning UI bridge |
| **Edit risk** | **High** |

---

### `index.js` — **954 lines** — Refactor candidate (near high-priority)

| Aspect | Detail |
|--------|--------|
| **Exports** | None (entry module); exposes `window.testInstagramPost` |
| **Imports** | `api`, `calendar`, `captions`, all feature `init*` modules |
| **Responsibilities** | Global `state`; toast; OAuth (IG/Pinterest); platform post wrappers; Pinterest boards CRUD UI; templates tab CRUD; queue list; calendar/queue loaders; tab switching; module `init()` wiring; hardcoded `sync-pinterest-boards` URL in one path |
| **DOM** | `els` map (~20+ IDs), tab buttons, stat cards, template/board lists |
| **Tables** | `social_settings`, via `api` for products/posts/templates/boards |
| **Edge** | `instagram-oauth`, `pinterest-oauth`, `instagram-post`, `facebook-post`, `pinterest-post`, `pinterest-boards`, `sync-pinterest-boards` |
| **Split?** | **Yes** — extract OAuth, boards, templates, queue, boot |
| **Edit risk** | **Very high** — touches every feature at init |

---

### `uploadModal.js` — **843 lines** — Refactor candidate

| Aspect | Detail |
|--------|--------|
| **Exports** | `initUploadModal`, `setScoreFunctions`, `setupUploadModal`, `openUploadModal`, `closeUploadModal`, `openUploadModalWithAsset` |
| **Imports** | `api`, `imageProcessor`, `captions`, `postLearning` |
| **DOM** | Upload modal steps, crop UI, schedule fields |
| **Edge** | `ai-generate` |
| **Split?** | Medium priority — split steps: upload/crop vs caption/schedule |
| **Edit risk** | **High** |

---

### `autoQueue.js` — **753 lines** — Refactor candidate

| Aspect | Detail |
|--------|--------|
| **Exports** | `initAutoQueue`, `setupAutoQueue`, `getAutoQueueSettings`, `loadAutoQueueSettings`, `saveAutoQueueSettings`, `loadAutoQueueStats` |
| **Imports** | `supabaseClient` |
| **DOM** | Auto-queue tab — preview list, scoring weights, compare toggle, repost (~31 DOM refs) |
| **Tables** | `social_settings`, `products` (stats) |
| **Edge** | `auto-queue`, `auto-repost` via `fetch` |
| **Split?** | **Yes** — settings, preview, scoring UI, repost (Phase 4c) |
| **Edit risk** | **High** — recent Phase 3 work |

---

### `carouselBuilder.js` — **722 lines** — Refactor candidate

| Aspect | Detail |
|--------|--------|
| **Exports** | `initCarouselBuilder`, `calculateEngagementScore`, `updateEngagementScoreUI`, `triggerInputEvent`, `updatePostCountersAndScore`, `updateCarouselCountersAndScore`, `calculatePostEngagementScore`, `setupCarouselBuilder`, `loadRecentCarousels` |
| **Imports** | `api`, `captions`, `postLearning`, `supabaseClient` |
| **DOM** | Carousel tab, score UI (shared with upload via `setScoreFunctions`) |
| **Edge** | `ai-generate` |
| **Split?** | Medium — builder vs schedule/publish |
| **Edit risk** | **Medium–high** |

---

### `captions.js` — **645 lines** — Refactor candidate

| Aspect | Detail |
|--------|--------|
| **Exports** | Template load/cache, `generateCaption`, hashtags, `scoreCaption`, `formatHashtags`, `parseHashtags`, etc. |
| **Imports** | `api`, `supabaseClient`, `env` |
| **DOM** | Minimal |
| **Edge** | `ai-generate` (multiple call sites) |
| **Split?** | Templates vs AI caption/hashtag vs scoring |
| **Edit risk** | **Medium** |

---

### `api.js` — **562 lines** — Refactor candidate

| Aspect | Detail |
|--------|--------|
| **Exports** | CRUD for products, assets, variations, posts, templates, hashtags, boards, settings, storage, `fetchStats`, `getPublicUrl` |
| **Imports** | `supabaseClient`, `postStatus` |
| **DOM** | None |
| **Split?** | **Yes** — `services/postsApi.js`, `assetsApi.js`, `settingsApi.js`, etc. |
| **Edit risk** | **High** — widest import surface |

---

### `imagePool.js` — **471 lines** — Under threshold (monitor)

| Aspect | Detail |
|--------|--------|
| **Exports** | `initImagePool`, `setupImagePool`, `loadAssets` |
| **DOM** | Pool tab, tag modal, catalog browser |
| **Edge** | `ai-tag-assets` (**hardcoded** project URL) |
| **Split?** | Later — upload vs tag vs catalog |
| **Edit risk** | **Medium** |

---

### `postDetail.js` — **373 lines** — OK size

| Aspect | Detail |
|--------|--------|
| **Exports** | `initPostDetail`, `setupPostDetailModal`, `openPostDetail` |
| **Imports** | `api`, `captions`, `postStatus` |
| **DOM** | Post detail modal |
| **Split?** | Optional with post actions module |
| **Edit risk** | **Medium** |

---

### `scoringPerformance.js` — **218 lines** — OK (already focused)

| Aspect | Detail |
|--------|--------|
| **Exports** | Quartile report + `loadScoringPerformance` |
| **Split?** | No — move to `features/analytics/` as-is |
| **Edit risk** | **Low** |

---

### `platformSettings.js` — **264 lines** — OK

| Aspect | Detail |
|--------|--------|
| **Responsibilities** | Settings modal, IG/FB profile via Graph API |
| **Edit risk** | **Medium** |

---

### `calendar.js` — **204 lines** — OK

| Aspect | Detail |
|--------|--------|
| **Responsibilities** | Month grid, post pills |
| **Edit risk** | **Low–medium** |

---

### `autopilot.js` — **174 lines** — OK

| Aspect | Detail |
|--------|--------|
| **Edge** | `autopilot-fill` |
| **Edit risk** | **Low** |

---

### `imageProcessor.js` — **150 lines** — OK (pure utilities)

| Aspect | Detail |
|--------|--------|
| **Responsibilities** | Canvas crop, aspect ratios, blob export |
| **Edit risk** | **Low** |

---

### `postStatus.js` — **12 lines** — OK (canonical constants)

| Aspect | Detail |
|--------|--------|
| **Edit risk** | **Low** — keep at `js/admin/social/postStatus.js` or `utils/postStatus.js` |

---

## 3. Related shared JS (not under `js/admin/social/`)

| File | Lines (approx) | Role |
|------|----------------|------|
| `js/shared/supabaseClient.js` | — | Auth + client |
| `js/shared/adminNav.js` | — | Admin nav insert |
| `js/config/env.js` | — | `SUPABASE_URL`, anon key |
| `js/shared/pwa.js` | — | PWA on admin page |

---

## 4. Stale / ignore

| File | Note |
|------|------|
| `js/admin/social/index.js.bak` | Removed in Phase 2e — **do not restore** |

---

## 5. Summary table

| File | Lines | Flag | Split priority |
|------|------:|------|----------------|
| `pages/admin/social.html` | 2389 | >1000 | After JS (4g) |
| `postLearning.js` | 1385 | >1000 | **P0** |
| `analytics.js` | 972 | >500 | **P1** |
| `index.js` | 954 | >500 | **P1** |
| `css/pages/admin/social.css` | 912 | >500 | P3 |
| `uploadModal.js` | 843 | >500 | P2 |
| `autoQueue.js` | 753 | >500 | **P1** (Phase 4c) |
| `carouselBuilder.js` | 722 | >500 | P2 |
| `captions.js` | 645 | >500 | P2 |
| `api.js` | 562 | >500 | P1 (with services/) |
| `imagePool.js` | 471 | — | P3 |
| Others | <400 | — | Move with features |

---

*Line counts from workspace at audit time; re-run `Measure-Object` after large edits.*
