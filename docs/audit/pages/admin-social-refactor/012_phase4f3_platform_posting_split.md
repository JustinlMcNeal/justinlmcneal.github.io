# Admin Social — Phase 4f-3 Platform Posting Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4f-2 (`011`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Move `postToInstagram`, `postToFacebook`, and `postToPinterest` from `index.js` into `features/platforms/platformPosting.js`, reusing `platformsContext.js` for edge URL and anon key.

---

## 2. Before / after structure

### Before

```
js/admin/social/index.js
  postToInstagram / postToFacebook / postToPinterest (~50 lines)
```

### After

```
js/admin/social/index.js
  imports posting helpers; passes into initPostDetail (unchanged shape)

js/admin/social/features/platforms/
  platformPosting.js   # three publish helpers
  platformsContext.js  # unchanged (SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY)
```

---

## 3. Functions moved

| Function | Edge function | Notes |
|----------|---------------|--------|
| `postToInstagram` | `instagram-post` | `{ postId, imageUrl, caption }` |
| `postToFacebook` | `facebook-post` | `{ postId, imageUrl, caption, linkUrl }` |
| `postToPinterest` | `pinterest-post` | `{ postId, imageUrl, title, description, link, boardId }` |

---

## 4. Behavior preserved

| Area | Status |
|------|--------|
| Request URLs / auth headers | Via `getPlatformsContext()` |
| Success/error `alert` messages | Unchanged |
| Return values (`data` or `null`) | Unchanged |
| `console.error` logging | Unchanged |
| Post detail injection | `index.js` still passes `postTo*` into `initPostDetail` |
| Reload after post | Still in `postActions.js` (unchanged) |

`postDetail` does **not** import `platformPosting.js` directly.

---

## 5. Files created

- `js/admin/social/features/platforms/platformPosting.js`
- This doc

## 6. Files modified

- `js/admin/social/index.js` — import + remove inline implementations
- `docs/audit/pages/admin-social-refactor/000_admin_social_refactor_index.md`

---

## 7. Intentionally left in `index.js`

- `fetchPinterestBoards`, `populateBoardDropdown`, boards UI
- OAuth/connect (4f-2 modules)
- Templates, calendar, queue, feature orchestration
- `window.testInstagramPost` (uses `instagram-post` directly in `platformTestActions.js`)

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Context unset when posting | `initPlatformsContext` runs at module load before any post |
| Circular imports | `platformPosting` only imports `platformsContext` |

---

## 9. Manual verification checklist

- [ ] Page loads — no module errors
- [ ] Open queued post → Post Now (Instagram / Pinterest / Facebook as applicable)
- [ ] Same success/failure alerts
- [ ] Calendar/queue refresh after successful post

---

## 10. Recommended next phase

**Templates** or **boards** extraction from `index.js` (per `004` Phase 4e note).

---

## 11. Rollback

```bash
git revert <phase-4f3-commit>
```
