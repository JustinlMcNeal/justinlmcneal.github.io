# Admin Social — Phase 4f-4 Templates Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4f-3 (`012`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Extract caption template management from `index.js` into `js/admin/social/features/templates/`.

---

## 2. Before / after structure

### Before

```
js/admin/social/index.js
  setupTemplates / loadTemplates / renderTemplateList
  addTemplate / editTemplate / removeTemplate (~100 lines)
```

### After

```
js/admin/social/index.js
  imports initTemplates, setupTemplates, loadTemplates

js/admin/social/features/templates/
  templatesContext.js      # state, els
  templatesController.js   # init, setup, loadTemplates
  templatesRender.js       # renderTemplateList + row handlers
  templateActions.js       # add / edit / remove + clearTemplateCache
```

---

## 3. Functions moved

| Function | Module |
|----------|--------|
| `initTemplates` | `templatesController.js` |
| `setupTemplates` | `templatesController.js` |
| `loadTemplates` | `templatesController.js` |
| `renderTemplateList` | `templatesRender.js` |
| `addTemplate` | `templateActions.js` |
| `editTemplate` | `templateActions.js` |
| `removeTemplate` | `templateActions.js` |

---

## 4. Behavior preserved

| Area | Status |
|------|--------|
| Supabase | `social_caption_templates` via `api.js` (`fetchTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`) |
| Tone tabs | `.tone-tab`, default `casual` active |
| Add button | `#btnAddTemplate`, same prompt text |
| List DOM | `.template-item`, `.btn-edit-template`, `.btn-delete-template` |
| `clearTemplateCache` | After each mutation |
| Tab lazy load | `tabHandlers.loadTemplates` unchanged |
| Hidden tab | No HTML changes |

No `window.*` template globals.

---

## 5. Files created

- `features/templates/templatesContext.js`
- `features/templates/templatesController.js`
- `features/templates/templatesRender.js`
- `features/templates/templateActions.js`
- This doc

## 6. Files modified

- `js/admin/social/index.js`
- `docs/audit/pages/admin-social-refactor/000_admin_social_refactor_index.md`

---

## 7. Intentionally left in `index.js`

- Boards (`setupBoards`, `renderBoardList`, …)
- Calendar, queue, platforms, feature inits
- `state.templates` array (owned by shared `state`)

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Controller ↔ actions circular import | `templateActions` uses dynamic `import()` for `loadTemplates` |
| `initTemplates` before tab load | Called in `init()` with `{ state, els }` |

---

## 9. Manual verification checklist

- [ ] Page loads — no module errors
- [ ] Templates tab (hidden ok) — tone tabs switch list
- [ ] Add template via prompt
- [ ] Edit / delete template
- [ ] Caption generation still sees updated templates after cache clear

---

## 10. Recommended next phase

**Phase 4f-5** — Boards extraction from `index.js`.

---

## 11. Rollback

```bash
git revert <phase-4f4-commit>
```
