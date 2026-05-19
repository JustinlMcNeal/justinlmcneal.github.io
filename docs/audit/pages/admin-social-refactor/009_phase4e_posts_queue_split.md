# Admin Social — Phase 4e Posts / Queue Module Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4d (`008`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Extract post detail modal logic from `postDetail.js` and queue list rendering from `index.js` into `js/admin/social/features/posts/`, keeping import paths stable via a `postDetail.js` barrel.

---

## 2. Before / after structure

### Before

```
js/admin/social/postDetail.js   (~387 lines)
js/admin/social/index.js        (queue block ~lines 707–770)
```

### After

```
js/admin/social/postDetail.js              # barrel
js/admin/social/index.js                   # boot; imports queue from features/posts
js/admin/social/features/posts/
  postsContext.js           # injected deps (state, els, publish, refresh callbacks)
  queueFilters.js           # setupQueueFilter
  queueList.js              # loadQueuePosts, renderQueueList
  postDetailRender.js       # carousel, selection metadata, populate/close modal
  postActions.js            # delete, save, post now
  postDetailController.js   # init, setup, openPostDetail
```

---

## 3. Public exports / globals preserved

### `js/admin/social/postDetail.js`

| Export | Module |
|--------|--------|
| `initPostDetail` | `postDetailController.js` |
| `setupPostDetailModal` | `postDetailController.js` |
| `openPostDetail` | `postDetailController.js` |

**Importer:** `js/admin/social/index.js` — unchanged import path.

### `window.*`

No `window.openPostDetail` (never existed). Queue empty-state button still uses `document.getElementById('btnUpload').click()` inline.

### `index.js` exports

`loadQueuePosts` remains a function in `index.js` scope (imported from `queueList.js`, passed to upload/autoQueue/analytics/postDetail init). Not a global.

---

## 4. Files created

All under `js/admin/social/features/posts/` (see §2) plus this doc.

## 5. Files modified

| File | Change |
|------|--------|
| `js/admin/social/postDetail.js` | Barrel only |
| `js/admin/social/index.js` | Queue block removed; imports `initPostsContext`, `setupQueueFilter`, `loadQueuePosts` |
| `docs/audit/pages/admin-social-refactor/000_admin_social_refactor_index.md` | Phase 4e status |

---

## 6. Behavior preserved

| Area | Status |
|------|--------|
| Queue filter change → reload | `queueFilters.js` |
| Queue list HTML / badges / schedule labels | Unchanged in `queueList.js` |
| Queue item click → detail modal | `openPostDetail(post)` |
| Calendar click → detail modal | `index.js` `setupCalendar` unchanged |
| Post detail carousel | `postDetailRender.js` |
| Queue selection / scoring metadata block | `renderPostDetailSelection` |
| Delete / save / post now | `postActions.js` |
| Tab refresh after actions | Same `currentTab` branches |
| Pinterest board picker in modal | Unchanged |

---

## 7. Intentionally left in `index.js`

- OAuth handlers, platform connect, `testInstagramPost`
- Tab router, stats, products/categories/boards/templates
- Calendar setup (`setupCalendar`, `loadCalendarPosts`)
- Upload, carousel, auto-queue, autopilot, image pool, settings, analytics wiring
- Global boot / `DOMContentLoaded`

---

## 8. Circular import mitigation

- `postActions.js` imports `closePostDetail` from `postDetailRender.js` (not controller).
- `queueList.js` imports `openPostDetail` from `postDetailController.js` only.
- Feature modules do not import `index.js`.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| `initPostsContext` not called before queue setup | `index.js` calls `initPostsContext({ state, els })` before module inits |
| `loadQueuePosts` undefined in post detail actions | `initPostDetail` merges full deps into context |
| Queue ↔ detail circular import | Close helper on render module |

---

## 10. Manual verification checklist

- [ ] Admin Social loads — no module 404
- [ ] Queue tab: list renders; platform filter works
- [ ] Click queue row → post detail modal
- [ ] Calendar pill click → same modal
- [ ] Carousel (multi-image posts)
- [ ] Queue selection metadata when present
- [ ] Save / Delete / Post Now (per platform)
- [ ] After delete/post, correct tab refresh

---

## 11. Recommended next phase

**Phase 4f** — Slim `index.js` boot: OAuth → `features/platforms/*`, tab router → `boot/tabRouter.js` (per `004`).

---

## 12. Rollback

```bash
git revert <phase-4e-commit>
```
