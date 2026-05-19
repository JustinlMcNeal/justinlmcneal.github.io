# Admin Social — Refactor / Modularization Index

**Date:** 2026-05-19  
**Type:** Planning audit only (no code moves)  
**Prerequisites:** [`docs/audit/pages/admin-social/`](../admin-social/) — especially [`023`](../admin-social/023_admin_social_milestone_wrapup.md), [`001`](../admin-social/001_admin_social_file_map.md), [`002`](../admin-social/002_admin_social_current_ui_behavior.md), [`004`](../admin-social/004_admin_social_pipeline.md), [`016`](../admin-social/016_admin_social_phase3_autoqueue_autopilot_audit.md)  
**Out of scope:** Public `/pages/social.html`, edge function logic changes, DB migrations, deployments

---

## 1. Purpose

The Admin Social Media Manager works, but **maintainability is degrading**: several JS modules exceed 500–1,400 lines, and `pages/admin/social.html` is ~2,400 lines of markup. That makes AI-assisted edits and human review **slow and error-prone**.

This refactor audit defines a **behavior-preserving** path to smaller, feature-based ES modules under `js/admin/social/` so features can be added, removed, or changed with less cross-file risk.

---

## 2. Current pain points

| Pain | Impact |
|------|--------|
| **Monolithic HTML** (~2,389 lines) | Hard to find tab/modal markup; high merge conflict risk |
| **`postLearning.js` (~1,385 lines)** | Learning + AI + DB writes in one file; analytics depends on it |
| **`analytics.js` (~972 lines)** | Tab load, insights sync, modals, learning UI, category research |
| **`index.js` (~954 lines)** | Boot, OAuth, posting, templates, boards, queue, tabs, global state |
| **`autoQueue.js` (~753 lines)** | Settings, preview, scoring UI, repost, edge calls |
| **Duplicated fetch patterns** | `fetch(\`${SUPABASE_URL}/functions/v1/...\`)` vs `client.functions.invoke` vs hardcoded project URL |
| **Implicit coupling via `init(deps)`** | Modules need `_getClient`, URLs, callbacks injected from `index.js` |
| **Global `state` in index** | Upload, pool, carousel, templates share one object |
| **Alert-based UX** | Not a refactor blocker, but obscures failure paths during testing |

---

## 3. High-level recommended direction

1. **Feature folders** under `js/admin/social/features/<name>/` with thin controllers + focused helpers.  
2. **Shared `services/`** for Supabase table access (gradually split from `api.js`) and **edge function wrappers** (single place for URLs/headers).  
3. **Shared `utils/`** for pure formatters, DOM helpers, dates — extracted first (lowest risk).  
4. **Keep `index.js` as orchestrator** until Phase 4f; shrink it by moving OAuth, templates, boards, queue into feature modules.  
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

---

## 5. Recommended first implementation phase

**Phase 4b** — Extract **pure utilities** (done — see `006`)

**Phase 4c** — Split `autoQueue.js` (done — see `007`)

**Phase 4d** — Split `analytics.js` (done — see `008`)

**Phase 4e** — Split `postDetail.js` / queue from `index.js` (done — see `009`)

**Phase 4f-1** — Tab router + page boot (done — see `010`)

**Phase 4f-2** — OAuth + platform connect (done — see `011`)

**Phase 4f-3** — Platform posting helpers (done — see `012`)

**Phase 4f-4** — Templates extraction (done — see `013`)

**Next:** Boards extraction from `index.js`.

Do **not** start with `postLearning.js` or `social.html` until analytics and index slim-down are stable.

---

## 6. Success criteria (whole refactor program)

- [ ] No intentional behavior change (verify via manual smoke checklist per phase)  
- [ ] `pages/admin/social.html` still loads `index.js` only as entry module  
- [ ] Each feature area editable in isolation (~1–3 files)  
- [ ] Edge/auth call patterns centralized enough to fix hardcoded URLs in one follow-up (Phase 4b+ / infra doc 023 § Phase 4b)  
- [ ] Largest files under ~600 lines except HTML (until HTML phase)

---

*Planning only — no files moved in this audit.*
