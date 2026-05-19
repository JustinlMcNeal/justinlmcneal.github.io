# Admin Social — Refactor / Modularization Index

**Date:** 2026-05-19  
**Type:** Planning audit + Phase 4 implementation (4b–4f-5)  
**Prerequisites:** [`docs/audit/pages/admin-social/`](../admin-social/) — especially [`023`](../admin-social/023_admin_social_milestone_wrapup.md), [`001`](../admin-social/001_admin_social_file_map.md), [`002`](../admin-social/002_admin_social_current_ui_behavior.md), [`004`](../admin-social/004_admin_social_pipeline.md), [`016`](../admin-social/016_admin_social_phase3_autoqueue_autopilot_audit.md)  
**Out of scope:** Public `/pages/social.html`, edge function logic changes, DB migrations, deployments

---

## 1. Purpose

The Admin Social Media Manager works, but **maintainability was degrading**: several JS modules exceeded 500–1,400 lines, and `pages/admin/social.html` is ~2,400 lines of markup. That makes AI-assisted edits and human review **slow and error-prone**.

This refactor audit defined a **behavior-preserving** path to smaller, feature-based ES modules under `js/admin/social/` so features can be added, removed, or changed with less cross-file risk.

---

## 2. Current pain points (original audit)

| Pain | Impact |
|------|--------|
| **Monolithic HTML** (~2,389 lines) | Hard to find tab/modal markup; high merge conflict risk |
| **`postLearning.js` (~1,385 lines)** | Learning + AI + DB writes in one file; analytics depends on it |
| **`analytics.js` (~972 lines)** | Resolved → `features/analytics/*` |
| **`index.js` (~954 lines)** | Reduced → ~483 lines; more extractions possible |
| **`autoQueue.js` (~753 lines)** | Resolved → `features/autoQueue/*` |
| **Duplicated fetch patterns** | Partially addressed; full centralization deferred |
| **Implicit coupling via `init(deps)`** | Addressed via `*Context.js` per feature |
| **Global `state` in index** | Still shared for upload/pool/carousel |
| **Alert-based UX** | Not a refactor blocker, but obscures failure paths during testing |

---

## 3. High-level recommended direction

1. **Feature folders** under `js/admin/social/features/<name>/` with thin controllers + focused helpers.  
2. **Shared `services/`** for Supabase table access (gradually split from `api.js`) and **edge function wrappers** (single place for URLs/headers).  
3. **Shared `utils/`** for pure formatters, DOM helpers, dates — **done** (Phase 4b).  
4. **Keep `index.js` as orchestrator** — shrinking continues (calendar, loaders, toast).  
5. **Defer HTML split** until JS boundaries are stable (optional Phase 4g: partials or tab fragments).  
6. **No build step** — remain native ES modules loaded from `social.html`.  
7. **Target file size:** ~300–600 lines per module where practical.

**Non-goals for refactor:** Change auto-queue scoring, autopilot volume, publishing behavior, or public social page.

---

## 4. Documents in this folder

| # | File | Purpose |
|---|------|---------|
| 000 | This file | Index and direction |
| 001 | [001_current_file_size_and_responsibility_map.md](./001_current_file_size_and_responsibility_map.md) | Line counts, responsibilities, risk flags |
| 002 | [002_feature_responsibility_map.md](./002_feature_responsibility_map.md) | Feature areas → current vs future modules |
| 003 | [003_target_module_structure.md](./003_target_module_structure.md) | Proposed folder layout |
| 004 | [004_refactor_phase_plan.md](./004_refactor_phase_plan.md) | Phased implementation, verification, rollback |
| 005 | [005_phase4b_first_refactor_prompt.md](./005_phase4b_first_refactor_prompt.md) | Copy-paste Cursor prompt for first code phase |
| 006 | [006_phase4b_utilities_extraction.md](./006_phase4b_utilities_extraction.md) | Phase 4b completion |
| 007 | [007_phase4c_autoqueue_split.md](./007_phase4c_autoqueue_split.md) | Phase 4c auto-queue split |
| 008 | [008_phase4d_analytics_split.md](./008_phase4d_analytics_split.md) | Phase 4d analytics split |
| 009 | [009_phase4e_posts_queue_split.md](./009_phase4e_posts_queue_split.md) | Phase 4e posts / queue split |
| 010 | [010_phase4f1_tab_router_boot_split.md](./010_phase4f1_tab_router_boot_split.md) | Phase 4f-1 tab router / boot |
| 011 | [011_phase4f2_platforms_oauth_split.md](./011_phase4f2_platforms_oauth_split.md) | Phase 4f-2 platforms / OAuth |
| 012 | [012_phase4f3_platform_posting_split.md](./012_phase4f3_platform_posting_split.md) | Phase 4f-3 platform posting |
| 013 | [013_phase4f4_templates_split.md](./013_phase4f4_templates_split.md) | Phase 4f-4 templates |
| 014 | [014_phase4f5_boards_split.md](./014_phase4f5_boards_split.md) | Phase 4f-5 boards |
| 015 | [015_phase4_refactor_milestone_wrapup.md](./015_phase4_refactor_milestone_wrapup.md) | **Phase 4 milestone wrap-up** |

---

## 5. Milestone status (Phase 4 code)

| Phase | Status |
|-------|--------|
| 4a | Done (docs only) |
| 4b | Done — `006` |
| 4c | Done — `007` (committed with 4b in `3ec2eab`) |
| 4d | Done — `008` |
| 4e | Done — `009` |
| 4f-1 … 4f-5 | Done — `010`–`014` |
| 4g+ (HTML, postLearning, upload) | **Not started** |

**Next recommended step:** [015 §10](./015_phase4_refactor_milestone_wrapup.md) — **smoke test, then push**; optional further `index.js` loader extraction.

---

## 6. Current modular layout (`js/admin/social/`)

```
utils/                    # Phase 4b
boot/                     # Phase 4f-1
features/
  autoQueue/              # Phase 4c
  analytics/              # Phase 4d
  posts/                  # Phase 4e
  platforms/              # Phase 4f-2, 4f-3
  templates/              # Phase 4f-4
  boards/                 # Phase 4f-5
```

**Compatibility barrels (legacy paths):** `analytics.js`, `autoQueue.js`, `postDetail.js`, `scoringPerformance.js`

**Legacy / root modules still at `js/admin/social/`:**

| Module | ~Lines | Role |
|--------|--------|------|
| `index.js` | 483 | Entry orchestrator, state, calendar, data loaders |
| `api.js` | 621 | Supabase CRUD monolith |
| `postLearning.js` | 1,425 | Learning engine (analytics dependency) |
| `uploadModal.js` | 954 | New post wizard |
| `carouselBuilder.js` | 829 | Carousel composer |
| `imagePool.js` | 548 | Asset pool tab |
| `captions.js` | 890 | Caption/hashtag AI + templates cache |
| `calendar.js` | 280 | Calendar grid (used by index) |
| `platformSettings.js` | 278 | Settings modal |
| `autopilot.js` | 181 | Autopilot UI |
| `postStatus.js` | small | Status constants |
| `imageProcessor.js` | 180 | Client crop helpers |

---

## 7. Success criteria (whole refactor program)

- [x] Feature folders for auto-queue, analytics, posts, platforms, templates, boards  
- [x] `pages/admin/social.html` still loads `index.js` only as entry module  
- [ ] No intentional behavior change — **verify via [015 §8](./015_phase4_refactor_milestone_wrapup.md)**  
- [ ] Edge/auth call patterns centralized enough for one follow-up  
- [ ] Largest files under ~600 lines except HTML — **postLearning, uploadModal, api still exceed**

---

*See [015_phase4_refactor_milestone_wrapup.md](./015_phase4_refactor_milestone_wrapup.md) for commits, smoke checklist, risks, and push recommendation.*
