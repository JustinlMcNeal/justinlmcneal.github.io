# Admin Social — Phase 4c Auto-Queue Module Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4b (`006`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Split monolithic `autoQueue.js` (~753 lines) into feature modules under `js/admin/social/features/autoQueue/` while keeping `js/admin/social/autoQueue.js` as a **compatibility barrel** for `index.js` imports.

---

## 2. Before / after structure

### Before

```
js/admin/social/autoQueue.js   (~753 lines, all logic)
```

### After

```
js/admin/social/autoQueue.js                          # barrel re-exports only
js/admin/social/features/autoQueue/
  autoQueueContext.js       # injected deps (state, els, URLs, callbacks)
  autoQueueAuth.js          # getAuthHeaders()
  scoringControls.js        # weights, compare toggle, reset
  autoQueueSettings.js      # load/save/getAutoQueueSettings
  autoQueuePreview.js       # preview + repost HTML renderers
  autoQueueActions.js       # preview / generate / confirm queue
  autoQueueRepost.js        # repost preview / generate / confirm
  autoQueueStats.js         # loadAutoQueueStats
  autoQueueController.js    # initAutoQueue, setupAutoQueue, public exports
```

---

## 3. Public exports preserved

`js/admin/social/autoQueue.js` still exports:

| Export | Module |
|--------|--------|
| `initAutoQueue` | `autoQueueController.js` |
| `setupAutoQueue` | `autoQueueController.js` |
| `getAutoQueueSettings` | `autoQueueSettings.js` |
| `loadAutoQueueSettings` | `autoQueueSettings.js` |
| `saveAutoQueueSettings` | `autoQueueSettings.js` |
| `loadAutoQueueStats` | `autoQueueStats.js` |

**Importer:** `js/admin/social/index.js` — unchanged import path.

---

## 4. Files created

All under `js/admin/social/features/autoQueue/` (9 modules listed above).

## 5. Files modified

| File | Change |
|------|--------|
| `js/admin/social/autoQueue.js` | Replaced body with barrel re-exports |

---

## 6. Behavior preserved

| Behavior | Status |
|----------|--------|
| Settings load/save (`social_settings.auto_queue`) | Unchanged |
| Scoring weights + penalties + reset (3e) | Unchanged |
| Preview `compareScoring` when toggle on | Unchanged |
| Generate `preview: false` only (no `compareScoring`) | Unchanged |
| Skipped panel + comparison table HTML | Unchanged |
| Repost preview/generate | Unchanged |
| Stats queries on `products` | Unchanged |
| Request bodies to `auto-queue` / `auto-repost` | Unchanged |

---

## 7. Intentionally not split further

- `formatGuardLabel` / `formatScoreLabel` — preview-only, kept in `autoQueuePreview.js`
- Edge URL + auth — minimal `autoQueueAuth.js` (no repo-wide `edgeClient` yet)
- Repost render in `autoQueuePreview.js` (shared HTML helpers with queue preview)

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Wrong relative import depth to `shared/` | Fixed to `../../../../shared/` |
| Context not initialized before setup | Same `initAutoQueue` before `setupAutoQueue` order in `index.js` |
| Missing export on barrel | Grep importers; only `index.js` |

---

## 9. Manual verification checklist

- [ ] Admin Social page loads (no module 404)
- [ ] Auto-Queue tab opens; stats populate
- [ ] Save Auto-Queue Settings → toast/alert
- [ ] Reset scoring defaults → message; Save persists
- [ ] Preview with compare **on** → comparison table + banner
- [ ] Preview with compare **off** → no comparison block
- [ ] Generate → confirm dialog; network body has `preview: false` only
- [ ] Repost preview + generate (if data available)
- [ ] Confirm queue / confirm repost flows

---

## 10. Recommended next phase

**Phase 4d** — Split `analytics.js` into `features/analytics/*` with barrel at `analytics.js`.

---

## 11. Rollback

```bash
git revert <phase-4c-commit>
```

Restores single-file `autoQueue.js`.
