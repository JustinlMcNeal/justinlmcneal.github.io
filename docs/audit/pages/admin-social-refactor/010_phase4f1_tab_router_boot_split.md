# Admin Social — Phase 4f-1 Tab Router & Boot Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4e (`009`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Slim `index.js` by extracting main tab navigation and the DOMContentLoaded boot sequence into `js/admin/social/boot/`. OAuth, platform connect, templates, and boards remain in `index.js` for a later 4f phase.

---

## 2. Before / after structure

### Before

```
js/admin/social/index.js
  setupTabs() / switchTab()     (~40 lines)
  DOMContentLoaded listener     (~5 lines)
```

### After

```
js/admin/social/index.js              # entry; orchestrates init + OAuth
js/admin/social/boot/
  socialBootContext.js    # state, $, tab lazy-load callbacks
  tabRouter.js            # setupTabRouter, activateTab, switchTab, getActiveTab
  pageBoot.js             # startSocialAdminPage (DOMContentLoaded)
```

---

## 3. Files created

| File | Role |
|------|------|
| `boot/socialBootContext.js` | Injected `state`, `$`, `tabHandlers` |
| `boot/tabRouter.js` | Tab buttons/panels + lazy loaders |
| `boot/pageBoot.js` | `startSocialAdminPage` |

## 4. Files modified

| File | Change |
|------|--------|
| `js/admin/social/index.js` | Imports boot modules; calls `initSocialBootContext` at start of `init()`; `setupTabRouter` / `startSocialAdminPage` |

---

## 5. Behavior preserved

| Area | Status |
|------|--------|
| Default tab | `switchTab("calendar")` after setup |
| Tab selectors | `.tab-btn`, `.tab-panel`, `id="tab-{name}"` |
| Active button class | `active` on matching `.tab-btn` |
| Panel visibility | `hidden` on all panels; remove on active |
| Lazy loads per tab | Same `switch` cases via injected handlers |
| `switchTab` passed to features | Same function (`switchTab` → `activateTab`) |
| OAuth on load | Still `window.addEventListener("DOMContentLoaded", …)` in `index.js` |
| `window.testInstagramPost` | Unchanged in `index.js` |
| Post-analytics boot | Still runs after `init()` in `pageBoot` |

---

## 6. Public API

| Symbol | Location | Consumers |
|--------|----------|-----------|
| `switchTab` | `tabRouter.js` | `index.js` imports; passed to upload/autoQueue/postDetail/carousel |
| `setupTabRouter` | `tabRouter.js` | `index.js` `init()` |
| `getActiveTab` | `tabRouter.js` | Available; not required by index yet |
| `startSocialAdminPage` | `pageBoot.js` | `index.js` bottom |

No new `window.*` assignments.

---

## 7. Intentionally left in `index.js`

- Pinterest / Instagram OAuth handlers and `DOMContentLoaded` listeners
- Platform connect buttons (Pinterest, Facebook)
- `window.testInstagramPost`
- Feature module init/setup
- Templates, boards, calendar, stats, posting helpers
- `state`, `els`, `$`

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| `initSocialBootContext` called after `switchTab` used | Context set at top of `init()` before module wiring |
| Missing tab handler | Optional chaining `tabHandlers.loadX?.()` |
| Circular imports | Boot modules do not import `index.js` |

---

## 9. Manual verification checklist

- [ ] Page loads — no module errors
- [ ] Each tab: calendar, queue, assets, templates, boards, auto-queue, analytics, carousel
- [ ] Default tab is calendar with data
- [ ] Auto-queue button in UI still switches to auto-queue tab
- [ ] OAuth query params still handled (Pinterest / Instagram)
- [ ] Post analytics / learning modals still init

---

## 10. Recommended next phase

**Phase 4f-2** — Extract OAuth + platform connect into `boot/oauthHandlers.js` / `features/platforms/*` (per `004`).

---

## 11. Rollback

```bash
git revert <phase-4f1-commit>
```
