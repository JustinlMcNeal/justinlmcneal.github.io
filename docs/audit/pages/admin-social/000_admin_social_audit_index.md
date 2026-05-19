# Admin Social Media Manager — Audit Index

**Audit date:** 2026-05-19  
**Primary page:** `/pages/admin/social.html`  
**Scope:** Admin posting pipeline only (not public `/pages/social.html`).

---

## Executive summary

The Admin Social Media Manager is a **large, Supabase-backed content engine** (~2.4k lines HTML + 15 JS modules + 15+ edge functions). It supports Instagram, Facebook (via Graph), and Pinterest; manual upload/scheduling; image pool tagging; auto-queue; autopilot; carousels; AI captions/hashtags/scoring; and a learning/analytics layer.

**Current status:** **Partial / operational with risks** — core flows exist and `docs/todo.md` marks many revamp items complete, but the codebase shows **organic growth**: duplicate tabs (Queue vs Calendar), hidden Templates tab, status-value inconsistencies across migrations vs runtime, hardcoded Supabase URLs in places, and backup file `index.js.bak`. Production behavior depends on cron/OAuth/dashboard setup not fully verifiable from repo alone.

**Separate system:** Public customer social links live under `docs/audit/pages/social/` — do not conflate.

---

## Documents in this folder

| # | File | Purpose |
|---|------|---------|
| 000 | This file | Index and next steps |
| 001 | [001_admin_social_file_map.md](./001_admin_social_file_map.md) | File inventory |
| 002 | [002_admin_social_current_ui_behavior.md](./002_admin_social_current_ui_behavior.md) | UI sections and actions |
| 003 | [003_admin_social_data_model.md](./003_admin_social_data_model.md) | Tables, storage, relationships |
| 004 | [004_admin_social_pipeline.md](./004_admin_social_pipeline.md) | End-to-end flows |
| 005 | [005_admin_social_supabase_edge_functions.md](./005_admin_social_supabase_edge_functions.md) | Edge function reference |
| 006 | [006_admin_social_ai_and_automation.md](./006_admin_social_ai_and_automation.md) | AI + autopilot/automation |
| 007 | [007_admin_social_analytics_and_tracking.md](./007_admin_social_analytics_and_tracking.md) | Metrics and learning |
| 008 | [008_admin_social_gaps_risks_recommendations.md](./008_admin_social_gaps_risks_recommendations.md) | Prioritized gaps |
| 009 | [009_admin_social_commit_plan.md](./009_admin_social_commit_plan.md) | Phased commit plan |

---

## Related existing docs

| Path | Notes |
|------|-------|
| `docs/pSocial/pSocial_001.md` | Revamp vision, tab plan, broken-area investigation |
| `docs/pSocial/pSocial_002.md` | Learning loop wiring |
| `docs/todo.md` | Social Media — Full Revamp checklist (many items marked done) |

---

## Recommended next step

1. **Verify production:** OAuth tokens, `pg_cron` / dashboard cron for `process-scheduled-posts` and `autopilot-fill`, and whether `social_posts.status` values in DB match what UI/edge functions query (`posted` vs `published` vs `processing`).
2. **Phase 1 (docs + cleanup only):** Remove `index.js.bak`, align status enum in one migration, document cron jobs in Supabase dashboard.
3. **Phase 2:** UI reliability (post detail analytics, permalink fallback, reduce duplicate Queue tab if revamp incomplete).

See [009_admin_social_commit_plan.md](./009_admin_social_commit_plan.md).
