# Admin Social — Target Module Structure

**Date:** 2026-05-19  
**Constraints:** Native ES modules, no bundler, match existing `init(deps)` / named export style.

---

## 1. Principles

1. **Feature folders** over technical layers only.  
2. **~300–600 lines** per file where reasonable.  
3. **Barrel re-exports** at old paths during transition (e.g. keep `api.js` importing from `services/*`).  
4. **No new runtime dependencies.**  
5. **`postStatus.js`** stays a tiny shared module (root or `utils/`).  
6. **HTML** stays single file until Phase 4g (optional).

---

## 2. Proposed tree

```
js/admin/social/
├── index.js                    # Thin boot: auth check, init modules, tab router
├── postStatus.js               # Canonical status constants (unchanged)
│
├── state/
│   ├── socialState.js          # products, categories, boards, templates cache
│   └── uploadState.js          # upload + carousel slice (optional split from index)
│
├── services/
│   ├── edgeClient.js           # SUPABASE_URL/functions/v1, invoke + fetch helpers
│   ├── postsApi.js             # social_posts CRUD, fetchStats
│   ├── assetsApi.js            # social_assets, variations, storage paths
│   ├── templatesApi.js         # caption templates
│   ├── boardsApi.js            # pinterest_boards
│   ├── settingsApi.js          # social_settings get/update
│   └── api.js                  # DEPRECATED barrel — re-exports all services (compat)
│
├── features/
│   ├── autoQueue/
│   │   ├── autoQueueController.js    # init, setup, wiring
│   │   ├── autoQueueSettings.js    # load/save/getAutoQueueSettings
│   │   ├── autoQueuePreview.js     # preview + confirm UI
│   │   ├── autoQueueScoringUI.js   # weights, compare, comparison table
│   │   └── autoQueueRepost.js      # repost preview/run
│   │
│   ├── autopilot/
│   │   └── autopilotController.js  # from autopilot.js
│   │
│   ├── analytics/
│   │   ├── analyticsController.js  # init, setup, loadAnalytics
│   │   ├── analyticsEngagement.js  # metrics cards, top posts, sync
│   │   ├── analyticsPostModal.js   # openPostAnalytics, modal
│   │   ├── analyticsLearningUI.js  # learning tab sections
│   │   └── scoringPerformance.js   # move existing file
│   │
│   ├── learning/
│   │   ├── postAnalysis.js         # analyzePost
│   │   ├── learningAggregates.js   # hashtag/timing/caption performance
│   │   ├── learningRecommendations.js
│   │   ├── categoryResearch.js     # checkAndResearchCategories, insights
│   │   └── learningConstants.js    # BEST_PRACTICES
│   │
│   ├── imagePool/
│   │   ├── imagePoolController.js
│   │   ├── imagePoolUpload.js
│   │   └── imagePoolTagging.js
│   │
│   ├── upload/
│   │   ├── uploadModalController.js
│   │   └── uploadSteps.js          # or split image vs caption step files
│   │
│   ├── carousel/
│   │   └── carouselController.js
│   │
│   ├── posts/
│   │   ├── postDetailModal.js
│   │   ├── queueList.js
│   │   └── calendarController.js   # from calendar.js
│   │
│   ├── platforms/
│   │   ├── oauthHandlers.js
│   │   ├── publishActions.js
│   │   ├── platformSettings.js     # from platformSettings.js
│   │   └── boardsController.js
│   │
│   ├── templates/
│   │   └── templatesController.js
│   │
│   └── ai/
│       ├── captionService.js       # from captions.js (AI + templates)
│       └── hashtagService.js
│
└── utils/
    ├── dom.js                    # $, setEl, showToast (optional move from index)
    ├── formatters.js             # formatNum, formatHashtags wrappers
    ├── dates.js                  # schedule helpers
    └── html.js                   # escapeHtml
```

---

## 3. What stays at legacy paths (transition)

| Legacy path | Transition strategy |
|-------------|---------------------|
| `js/admin/social/autoQueue.js` | Re-export from `features/autoQueue/autoQueueController.js` until imports updated |
| `js/admin/social/analytics.js` | Re-export from `features/analytics/analyticsController.js` |
| `js/admin/social/postLearning.js` | Re-export from `features/learning/*` |
| `js/admin/social/captions.js` | Re-export from `features/ai/captionService.js` |
| `js/admin/social/calendar.js` | Move to `features/posts/calendarController.js`; re-export |
| `js/admin/social/imageProcessor.js` | Move to `utils/imageProcessor.js` or `features/upload/` |

**Entry unchanged:** `pages/admin/social.html` → `/js/admin/social/index.js`

---

## 4. Naming conventions

- **Controllers** — `init(deps)`, `setup*`, event binding, tab lifecycle.  
- **Services** — async Supabase/edge I/O, no DOM.  
- **UI modules** — DOM render + listeners for one panel/modal.  
- **Utils** — pure functions only.

Match existing repo: camelCase files, named exports, dependency injection via `init({ getClient, ... })`.

---

## 5. What we are not doing

- No React/Vue/Svelte  
- No monorepo packages  
- No dynamic `import()` unless needed for code-splitting (unlikely on admin page)  
- No change to edge function names or payloads  
- No splitting `social.html` in early phases

---

## 6. Size targets (after refactor)

| Module | Target lines |
|--------|-------------|
| Controllers | 150–350 |
| UI/render | 200–500 |
| Services | 100–250 each |
| `postLearning` split parts | 250–400 each |
| `index.js` | < 200 |

---

## 7. Related CSS

Keep `css/pages/admin/social.css` as-is initially. Optional later: `social-calendar.css`, `social-modals.css` imported via extra `<link>` tags in HTML (still no build step).
