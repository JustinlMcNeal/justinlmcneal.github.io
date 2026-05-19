# Admin Social — Refactor Phase Plan

**Date:** 2026-05-19  
**Rule:** Each phase is **behavior-preserving**. One phase per PR/commit series where possible.

---

## Phase 4a — Documentation / refactor plan only

| Item | Detail |
|------|--------|
| **Scope** | This folder (`admin-social-refactor/`) |
| **Files affected** | Docs only |
| **Risk** | None |
| **Verification** | N/A |
| **Rollback** | N/A |

**Status:** This document set.

---

## Phase 4b — Extract pure utilities / helpers

| Item | Detail |
|------|--------|
| **Scope** | Create `js/admin/social/utils/*`; move pure functions duplicated across modules |
| **Files affected** | New: `utils/html.js`, `utils/formatters.js`, `utils/dates.js`, optional `utils/dom.js`; touch: `analytics.js`, `autoQueue.js`, `scoringPerformance.js`, `postDetail.js`, others only to update imports |
| **Do not** | Change function signatures consumed by HTML `onclick` or `window.*` |
| **Risk** | **Low** |
| **Verification** | See [005](./005_phase4b_first_refactor_prompt.md); manual smoke: load page, switch tabs, open post detail, auto-queue preview |
| **Rollback** | `git revert` single commit; imports point back to inline helpers |

**Also consider (still 4b):** `services/edgeClient.js` with **no call-site changes** except 1–2 files as proof — optional second commit.

---

## Phase 4c — Split `autoQueue.js`

| Item | Detail |
|------|--------|
| **Scope** | `features/autoQueue/*`; `autoQueue.js` becomes re-export barrel |
| **Files affected** | `autoQueue.js` → 4–5 modules; `index.js` import unchanged if barrel kept |
| **Risk** | **Medium–high** (recent Phase 3 work) |
| **Verification** | Load Auto-Queue tab; save settings; preview with/without compare; generate (staging); repost preview; stats card |
| **Rollback** | Revert; single `autoQueue.js` restored |

**Order inside file:** settings → preview render → scoring UI → repost → controller wiring.

---

## Phase 4d — Split `analytics.js`

| Item | Detail |
|------|--------|
| **Scope** | `features/analytics/*`; move `scoringPerformance.js` under `features/analytics/` |
| **Files affected** | `analytics.js`, `scoringPerformance.js`, `index.js` import path only if needed |
| **Risk** | **Medium–high** |
| **Verification** | Analytics tab load; sync insights; top posts; post analytics modal; learning sections; scoring performance table; low-sample alert |
| **Rollback** | Revert commit series |

**Note:** Keep `postLearning` imports stable — do not split learning in same PR.

---

## Phase 4e — Split posts / detail / queue / calendar

| Item | Detail |
|------|--------|
| **Scope** | Extract from `index.js`: `queueList.js`, `boardsController.js`, `templatesController.js`; refine `postDetail.js`, `calendar.js` |
| **Files affected** | `index.js`, `postDetail.js`, `calendar.js`, new `features/posts/*`, `features/boards/*` |
| **Risk** | **Medium** |
| **Verification** | Calendar pills click → detail; queue list filters; boards sync; template CRUD (hidden tab ok); post now / delete |
| **Rollback** | Revert |

---

## Phase 4f — Slim `index.js` boot sequence

| Item | Detail |
|------|--------|
| **Scope** | OAuth + publish → `features/platforms/*`; toast/dom → `utils/dom.js`; tab router → `boot/tabRouter.js` |
| **Files affected** | `index.js` (target < 200 lines), new boot/platform modules |
| **Risk** | **High** |
| **Verification** | Full smoke: OAuth redirect handling (manual), connect buttons, all tabs, new post modal, publish from detail |
| **Rollback** | Revert |

---

## Phase 4g — (Optional) HTML / CSS split

| Item | Detail |
|------|--------|
| **Scope** | Extract tab panels to `page_inserts/admin-social/tab-*.html` fetched at runtime **or** duplicate-safe static partials — **only if** team accepts fetch/async complexity |
| **Alternative** | Comments + `<!-- region:autoqueue -->` markers only (no file split) |
| **Risk** | **High** for fetch approach; **low** for comment regions |
| **Verification** | Visual parity all tabs/modals |
| **Rollback** | Revert HTML changes |

**Recommendation:** Defer 4g until 4b–4f stable.

---

## Phase 4h — (Optional) Split `postLearning.js` + `api.js` services

| Item | Detail |
|------|--------|
| **Scope** | Largest service extraction; do after analytics split |
| **Risk** | **Very high** |
| **Verification** | Learning refresh, category research, hashtag/timing updates, post analysis modal |
| **Rollback** | Revert |

---

## Phase 4i — (Optional) `uploadModal` + `carouselBuilder` splits

| Item | Detail |
|------|--------|
| **Risk** | **High** (scheduling + assets creation) |
| **When** | After platforms/edge client centralized |

---

## Cross-phase rules

1. **One concern per PR** — easier review and revert.  
2. **Keep barrels** at old paths until all importers updated.  
3. **No drive-by fixes** (alerts → toast, URL cleanup) mixed into structural PRs — track as separate infra tasks per [`023`](../admin-social/023_admin_social_milestone_wrapup.md).  
4. **Run manual checklist** from `002_admin_social_current_ui_behavior.md` after each phase.  
5. **Do not deploy edge functions** for JS-only refactors.

---

## Suggested timeline

| Week | Phase |
|------|-------|
| 1 | 4a (done) + 4b |
| 2 | 4c |
| 3 | 4d |
| 4 | 4e + 4f |
| 5+ | 4g–4i as needed |

---

## Production reminders (not part of refactor)

From milestone wrap-up — still apply independently:

- Migration `20260720_social_posts_status_alignment.sql` if not applied  
- Deploy `auto-queue` when repo edge ahead of prod  
- `config.toml` parity (Phase infra 4a from wrap-up)
