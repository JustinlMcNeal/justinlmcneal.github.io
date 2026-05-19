# Admin Social — Phase 4f-5 Boards Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4f-4 (`013`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Extract Pinterest board management from `index.js` into `js/admin/social/features/boards/`.

---

## 2. Before / after structure

### Before

```
js/admin/social/index.js
  fetchPinterestBoards / populateBoardDropdown (~35 lines)
  loadBoards (~15 lines)
  setupBoards / addBoard / renderBoardList (~125 lines)
  populateBoardSelect (~3 lines)
```

### After

```
js/admin/social/index.js
  imports initBoards, setupBoards, loadBoards, renderBoardList, populateBoardDropdown

js/admin/social/features/boards/
  boardsContext.js       # state, els, getSupabaseClient, function URL/key
  boardActions.js        # fetch, sync, add, update category, delete
  boardsRender.js        # populateBoardDropdown, renderBoardList
  boardsController.js    # init, setup, loadBoards + re-exports
```

---

## 3. Functions moved

| Function | Module |
|----------|--------|
| `initBoards` | `boardsController.js` |
| `setupBoards` | `boardsController.js` |
| `loadBoards` | `boardsController.js` |
| `fetchPinterestBoards` | `boardActions.js` |
| `populateBoardDropdown` | `boardsRender.js` (re-exported) |
| `renderBoardList` | `boardsRender.js` (re-exported) |
| `addBoard` | `boardActions.js` |
| `syncPinterestBoards` | `boardActions.js` (from `#btnSyncBoards` handler) |
| Category update / delete | `boardActions.js` |

---

## 4. Behavior preserved

| Area | Status |
|------|--------|
| `pinterest-boards` GET | Unchanged |
| `sync-pinterest-boards` POST | Same hardcoded Supabase project URL + session token |
| `social_settings` pinterest_connected gate | In `loadBoards` |
| `pinterest_boards` CRUD | Via `api.js` `createBoard` / `updateBoard` / `deleteBoard` |
| DOM | `#btnSyncBoards`, `#btnAddBoard`, `.board-item`, `.board-category-select`, etc. |
| Tab lazy load | `renderBoardList` in tab router |
| External injection | `populateBoardDropdown` still passed to upload/carousel/postDetail |

No `window.*` board globals.

---

## 5. Files created

- `features/boards/boardsContext.js`
- `features/boards/boardsController.js`
- `features/boards/boardsRender.js`
- `features/boards/boardActions.js`
- This doc

## 6. Files modified

- `js/admin/social/index.js`
- `docs/audit/pages/admin-social-refactor/000_admin_social_refactor_index.md`

---

## 7. Intentionally left in `index.js`

- Feature orchestration, calendar, queue, platforms, templates
- `populateProductSelect` and other helpers
- `state.boards` / `state.categories` on shared `state`

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Circular imports | Dynamic `import()` in `boardActions` for reload |
| `initBoards` before `loadBoards` in init | Called in `init()` with URL/key |

---

## 9. Manual verification checklist

- [ ] Page loads — no module errors
- [ ] Boards tab — list, add, category select, delete
- [ ] Auto-Sync Boards button
- [ ] Upload/post detail Pinterest board dropdown populates when connected
- [ ] Disconnected Pinterest clears boards on load

---

## 10. Recommended next phase

**Phase 4g** — `index.js` milestone wrap-up doc / remaining helpers (`loadProducts`, `loadCategories`, stats) or optional `postLearning` split (high risk per `004`).

---

## 11. Rollback

```bash
git revert <phase-4f5-commit>
```
