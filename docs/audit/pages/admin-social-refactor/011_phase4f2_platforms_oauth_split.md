# Admin Social — Phase 4f-2 Platforms / OAuth Split

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor  
**Prerequisites:** Phase 4f-1 (`010`), [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md)

---

## 1. Purpose

Extract OAuth redirect handling, platform connect buttons, connection status UI, and `window.testInstagramPost` from `index.js` into `js/admin/social/features/platforms/`.

---

## 2. Before / after structure

### Before

```
js/admin/social/index.js
  OAuth handlers + DOMContentLoaded listeners (~60 lines)
  window.testInstagramPost (~28 lines)
  connect button handlers in init() (~22 lines)
  checkConnectionStatus() (~62 lines)
```

### After

```
js/admin/social/index.js
  initPlatformsContext + register calls at module load
  postTo* publishing helpers (unchanged location)
  fetchPinterestBoards / boards helpers (unchanged)

js/admin/social/features/platforms/
  platformsContext.js       # SUPABASE_FUNCTIONS_URL, ANON_KEY, getSupabaseClient
  oauthHandlers.js          # Pinterest/Instagram callback + registerOAuthRedirectHandlers
  platformConnections.js    # setupPlatformConnectButtons, checkConnectionStatus
  platformTestActions.js    # registerPlatformTestActions → window.testInstagramPost
```

---

## 3. Public globals preserved

| Global | Module |
|--------|--------|
| `window.testInstagramPost` | `platformTestActions.js` (assigned at module load) |

OAuth still uses two `DOMContentLoaded` listeners via `registerOAuthRedirectHandlers()`.

---

## 4. OAuth / connect behavior preserved

| Item | Unchanged |
|------|-----------|
| Pinterest app ID | `1542566` |
| Instagram app ID | `2162145877936737` |
| Redirect URI | `https://karrykraze.com/pages/admin/social.html` |
| Pinterest scopes | `pins:read,pins:write,boards:read,boards:write` |
| Instagram scopes | Full Meta scope string (unchanged) |
| Instagram OAuth state | `instagram` |
| Edge calls | `pinterest-oauth`, `instagram-oauth` |
| URL cleanup | `history.replaceState` before/after per platform |
| Success UX | `alert` + `location.reload()` |
| DOM IDs | `connect-pinterest`, `connect-instagram`, `*StatusIcon`, `*StatusText`, `instagramTestBtn` |

---

## 5. Files created

| File | Role |
|------|------|
| `platformsContext.js` | Injected platform deps |
| `oauthHandlers.js` | Redirect callbacks |
| `platformConnections.js` | Connect clicks + status |
| `platformTestActions.js` | Test post global |

## 6. Files modified

| File | Change |
|------|--------|
| `js/admin/social/index.js` | Imports platforms; wires init at load + `setupPlatformConnectButtons` in `init()` |

---

## 7. Intentionally left in `index.js`

- `postToInstagram`, `postToFacebook`, `postToPinterest` (post detail publishing)
- `fetchPinterestBoards`, `populateBoardDropdown`, `loadBoards`, boards UI
- Templates, calendar, queue, feature inits, tab router, page boot
- `state`, `els`, `$`, stats loaders

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Context unset before OAuth DOMContentLoaded | `initPlatformsContext` runs at module load before `registerOAuthRedirectHandlers` |
| `window.testInstagramPost` missing | `registerPlatformTestActions()` at module load |

---

## 9. Manual verification checklist

- [ ] Page loads — no module errors
- [ ] Connect Pinterest / Instagram buttons redirect with same URLs
- [ ] OAuth callback with `?code=` (staging/manual) shows same alerts/reload
- [ ] Connected state updates status icons/text
- [ ] `window.testInstagramPost` exists in console
- [ ] Instagram test button visible when connected

---

## 10. Recommended next phase

**Phase 4g** — Extract `postTo*` publishing helpers to `features/platforms/platformPosting.js` (optional), or **templates/boards** split per `004`.

---

## 11. Rollback

```bash
git revert <phase-4f2-commit>
```
