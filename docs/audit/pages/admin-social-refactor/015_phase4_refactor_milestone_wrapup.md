# Admin Social — Phase 4 Refactor Milestone Wrap-Up

**Date:** 2026-05-19  
**Type:** Milestone documentation (no code changes)  
**Scope:** Admin Social Media Manager (`pages/admin/social.html`, `js/admin/social/*`)  
**Out of scope:** Public `/pages/social.html`, edge function deployments, DB migrations

---

## 1. Executive summary

Phases **4a–4f-5** completed a **behavior-preserving** modularization of the Admin Social JS layer. Large monoliths were split into feature folders with **compatibility barrels** at legacy paths so `index.js` remains the single HTML entry module and existing `init(deps)` wiring stayed stable.

**Primary wins:**

- `analytics.js`, `autoQueue.js`, and most of `index.js` tab/feature logic now live in focused modules.
- Shared **utils**, **boot**, and **features/** directories match the target layout from [`003_target_module_structure.md`](./003_target_module_structure.md).
- Eight focused refactor commits on `main` (local; push pending verification).

**Recommended next action:** Run the manual smoke checklist below, then **push** refactor commits before starting more splits ([Option A](#10-recommended-next-phases)).

---

## 2. Phases completed

| Phase | Doc | What moved |
|-------|-----|------------|
| **4a** | `000`–`005` | Refactor audit / phase plan only (no production JS moves) |
| **4b** | [006](./006_phase4b_utilities_extraction.md) | `js/admin/social/utils/*` (html, formatters, dates, dom) |
| **4c** | [007](./007_phase4c_autoqueue_split.md) | `autoQueue.js` → `features/autoQueue/*` |
| **4d** | [008](./008_phase4d_analytics_split.md) | `analytics.js`, `scoringPerformance.js` → `features/analytics/*` |
| **4e** | [009](./009_phase4e_posts_queue_split.md) | `postDetail.js`, queue list from `index.js` → `features/posts/*` |
| **4f-1** | [010](./010_phase4f1_tab_router_boot_split.md) | Tab router + `DOMContentLoaded` boot → `boot/*` |
| **4f-2** | [011](./011_phase4f2_platforms_oauth_split.md) | OAuth callbacks + connect UI → `features/platforms/*` |
| **4f-3** | [012](./012_phase4f3_platform_posting_split.md) | `postToInstagram/Facebook/Pinterest` → `platformPosting.js` |
| **4f-4** | [013](./013_phase4f4_templates_split.md) | Templates tab → `features/templates/*` |
| **4f-5** | [014](./014_phase4f5_boards_split.md) | Boards tab + dropdowns → `features/boards/*` |

---

## 3. Before / after structure

### Before (pre–Phase 4b code)

```
js/admin/social/
  index.js              (~950+ lines — boot, OAuth, posting, templates, boards, queue, tabs)
  analytics.js          (~1,000 lines)
  autoQueue.js          (~750 lines)
  postDetail.js         (~390 lines)
  scoringPerformance.js (~240 lines, at root)
  utils/                (inline duplicates in multiple files)
```

### After (current)

```
js/admin/social/
  index.js                    (~483 lines — orchestrator, calendar, data loaders, toast, state)
  api.js                      (~621 lines — unchanged monolith)
  postLearning.js             (~1,425 lines — unchanged; analytics still imports)
  uploadModal.js              (~954 lines)
  carouselBuilder.js          (~829 lines)
  imagePool.js                (~548 lines)
  captions.js                 (~890 lines)
  calendar.js                 (~280 lines)
  autopilot.js                (~181 lines)
  platformSettings.js         (~278 lines)
  postStatus.js               (small constants)
  imageProcessor.js           (~180 lines)
  analytics.js                (barrel → features/analytics)
  autoQueue.js                (barrel → features/autoQueue)
  postDetail.js               (barrel → features/posts)
  scoringPerformance.js       (barrel → features/analytics)
  utils/
    html.js, formatters.js, dates.js, dom.js
  boot/
    socialBootContext.js, tabRouter.js, pageBoot.js
  features/
    autoQueue/     (10 modules)
    analytics/     (12 modules)
    posts/         (7 modules)
    platforms/     (5 modules)
    templates/     (4 modules)
    boards/        (4 modules)
```

**39** files under `features/` (excluding barrels at root).

---

## 4. Main files reduced

| File | Approx. before | Approx. after | Notes |
|------|---------------|---------------|--------|
| `index.js` | ~954 | **~483** | −~49%; templates, boards, queue, OAuth, posting, tabs extracted |
| `analytics.js` | ~972 | **~15** (barrel) | Logic in `features/analytics/*` |
| `autoQueue.js` | ~753 | **~11** (barrel) | Logic in `features/autoQueue/*` |
| `postDetail.js` | ~387 | **~8** (barrel) | Logic in `features/posts/*` |
| `scoringPerformance.js` | ~238 | **~10** (barrel) | Moved under `features/analytics/` |

---

## 5. New feature folders created

| Folder | Modules | Responsibility |
|--------|---------|----------------|
| `utils/` | 4 | Pure helpers (HTML escape, numbers, dates, DOM text) |
| `boot/` | 3 | Tab routing, page boot, shared boot context |
| `features/autoQueue/` | 10 | Settings, preview, scoring UI, repost, stats, actions |
| `features/analytics/` | 12 | Dashboard, cards, charts, insights sync, modals, learning UI, scoring |
| `features/posts/` | 7 | Queue list/filter, post detail modal, actions |
| `features/platforms/` | 5 | OAuth, connect, test post, publish helpers |
| `features/templates/` | 4 | Tone tabs, CRUD, list render |
| `features/boards/` | 4 | Sync, list, dropdown population |

---

## 6. Behavior-preserving rules followed

1. **One concern per commit series** — easier revert (4c, 4d, 4e, 4f-*).
2. **Compatibility barrels** — `analytics.js`, `autoQueue.js`, `postDetail.js`, `scoringPerformance.js` keep old import paths.
3. **No intentional behavior changes** — same Supabase queries, edge function names, request bodies, DOM IDs/classes, alerts/toasts.
4. **`index.js` still sole entry** — `pages/admin/social.html` unchanged.
5. **Injected deps** — `init(deps)` / `*Context.js` patterns; feature modules do not import `index.js`.
6. **Circular import mitigation** — dynamic `import()` in some action modules (templates, boards); `analyticsReload.js` for tab refresh.
7. **No edge deploys / migrations** during refactor commits.
8. **Public Socials page** explicitly out of scope.

---

## 7. Refactor commits (local `main`)

| Commit | Message | Phases |
|--------|---------|--------|
| `3ec2eab` | `refactor: modularize admin social auto-queue utilities` | 4b utilities + 4c auto-queue split (single commit in history) |
| `830003e` | `refactor: split admin social analytics modules` | 4d |
| `69031a7` | `refactor: split admin social posts and queue modules` | 4e |
| `07b1fe1` | `refactor: extract admin social boot and tab router` | 4f-1 |
| `6a7c375` | `refactor: split admin social platform oauth modules` | 4f-2 |
| `242be87` | `refactor: split admin social platform posting helpers` | 4f-3 |
| `96236c9` | `refactor: split admin social templates modules` | 4f-4 |
| `ddebc1e` | `refactor: split admin social boards modules` | 4f-5 |

**Note:** Phase **4a** is documentation only (`docs/audit/pages/admin-social-refactor/000`–`005`). There is no separate “4a-only” code commit.

**Push status:** These commits are on local `main` as of this wrap-up. **Not pushed** in this milestone step — verify then push.

---

## 8. Manual smoke checklist

Run on staging or local against real Supabase (admin session required).

### Boot / shell

- [ ] Open `pages/admin/social.html` — no console module errors
- [ ] Admin nav loads; unauthenticated redirect to login still works

### Tabs (`boot/tabRouter.js`)

- [ ] Switch every tab: Calendar, Queue, Assets, Templates (hidden OK), Boards, Auto-Queue, Analytics, Carousel
- [ ] Default tab remains **Calendar**
- [ ] Lazy loaders fire (queue/analytics/assets/boards/etc.)

### Calendar / queue / post detail

- [ ] Calendar month nav; click pill → post detail modal
- [ ] Queue filter by platform; list renders; row click → detail
- [ ] Post detail: edit caption/schedule, **Save**, **Delete**, **Post Now** (per platform)
- [ ] Carousel images in detail when applicable

### Auto-Queue (`features/autoQueue`)

- [ ] Settings load/save; scoring weights reset
- [ ] Preview / generate / confirm queue (staging)
- [ ] Repost preview/generate if used

### Analytics (`features/analytics`)

- [ ] Summary cards, charts, recent activity
- [ ] Top posts / grid; click → post analytics modal
- [ ] **Sync Instagram insights** button
- [ ] Scoring performance table + low-sample alert
- [ ] Learning + category research sections

### Platforms (`features/platforms`)

- [ ] Instagram / Pinterest connect buttons (redirect URLs unchanged)
- [ ] OAuth return with `?code=` (manual test when safe)
- [ ] Connection status icons/text after load
- [ ] `window.testInstagramPost` exists in console

### Boards / templates

- [ ] Boards tab: add, category link, delete, **Auto-Sync Boards**
- [ ] Board dropdowns in upload / post detail / carousel when Pinterest connected
- [ ] Templates: tone tabs, add/edit/delete (hidden tab OK)

### Indirect / legacy modules

- [ ] Image pool tab loads; open upload from asset
- [ ] Upload modal flow (uses `populateBoardDropdown` from boards)
- [ ] Carousel builder
- [ ] Settings modal (platformSettings)
- [ ] Autopilot toggle/run (still in `autopilot.js`)

---

## 9. Known risks

| Risk | Detail | Mitigation |
|------|--------|------------|
| **Unpushed commits** | Refactor stack may not be on remote | Smoke test then `git push` |
| **`postLearning.js` size** | Still ~1,400 lines; tight coupling to analytics | Defer split (Phase 4h); high regression risk |
| **Hardcoded edge URLs** | Some calls still use project URL string (boards sync, autopilot) | Centralize in `services/edgeClient` later |
| **Global `state` in index** | Upload/pool/carousel share one object | Future `state/` module or per-feature state |
| **Dynamic imports** | Templates/boards reload via `import()` | Watch for race if rapid CRUD |
| **Alert-based UX** | Failures use `alert()` | Harder to automate test |
| **Hidden Templates tab** | Still `hidden` in HTML | Verify via DOM if needed |
| **4b bundled with 4c** | One commit for utils + autoQueue | Revert granularity slightly coarser |

---

## 10. Recommended next phases

### Option A — **Preferred: smoke test + push**

1. Complete §8 checklist on staging.
2. `git push origin main` (or feature branch + PR if preferred).
3. Monitor admin social in production use before more splits.

### Option B — Continue local refactor (`index.js` loaders)

Extract remaining orchestrator chunks (low–medium risk):

- `loadProducts` / `loadCategories` / `loadStats` / `populateProductSelect`
- `setupCalendar` + `loadCalendarPosts` → `features/calendar/` or extend `calendar.js`
- `showToast` + `getClient` → small `core/` or `utils/`

Target: `index.js` under **~250 lines** as orchestrator-only.

### Option C — High-risk later work

| Target | Risk | Notes |
|--------|------|-------|
| `postLearning.js` split | Very high | Many analytics imports |
| `uploadModal.js` split | High | Scheduling + assets |
| `imagePool.js` split | Medium–high | Pool + tagging |
| `api.js` → `services/` | Medium | Broad call-site surface |
| `social.html` regions / partials | High | Optional 4g per plan |

**Do not start Option C until Option A is done and stable.**

---

## 11. Push recommendation

**Yes — push after smoke test**, assuming:

- No console errors on page load
- Calendar, queue, auto-queue, analytics, and platform connect behave as before refactor
- Team agrees to avoid mixing unrelated WIP (SMS, public social, CTA) in the same push

If smoke fails, revert the failing phase commit (`git revert <hash>`) per phase docs rather than pushing a broken stack.

---

## 12. Success criteria status (program-level)

From [000](./000_admin_social_refactor_index.md) §6:

| Criterion | Status |
|-----------|--------|
| No intentional behavior change | Pending full §8 smoke |
| Single `index.js` entry | Done |
| Feature areas editable in isolation | Mostly done (except api/postLearning/upload) |
| Edge/auth centralization | Partial (platforms context only) |
| Largest JS under ~600 lines except HTML | **Not met** — `postLearning`, `uploadModal`, `carouselBuilder`, `api` still large |

---

## 13. Related docs

- Index: [000_admin_social_refactor_index.md](./000_admin_social_refactor_index.md)
- Phase plan: [004_refactor_phase_plan.md](./004_refactor_phase_plan.md)
- Pre-refactor behavior: [../admin-social/002_admin_social_current_ui_behavior.md](../admin-social/002_admin_social_current_ui_behavior.md)
- Production wrap-up (Phase 3): [../admin-social/023_admin_social_milestone_wrapup.md](../admin-social/023_admin_social_milestone_wrapup.md)
