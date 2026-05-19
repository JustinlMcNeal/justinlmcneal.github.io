# Admin Social — Documentation Structure Convention

**Date:** 2026-05-19  
**Status:** Active convention for new docs

---

## Canonical path

Future **Admin Social** documentation lives under:

**`docs/pages/admin/social/`**

Subfolders:

| Path | Use for |
|------|---------|
| `docs/pages/admin/social/audit/` | As-is behavior audits, file maps, pipeline notes, verification checklists |
| `docs/pages/admin/social/implementation/` | Shipped or in-progress feature specs: before/after, files touched, manual QA |
| `docs/pages/admin/social/refactor/` | Modularization phases, module splits, migration notes |
| `docs/pages/admin/social/planning/` | Conventions, roadmaps, OpenClaw/data strategy, cross-cutting plans |

Use zero-padded numeric prefixes (`000`, `001`, …) within each folder.

---

## Why this structure exists

Admin Social work spans audits, phased refactors, and shipped UI/behavior changes. Historically, docs lived under `docs/audit/pages/admin-social/` and `docs/audit/pages/admin-social-refactor/`, which mixed **discovery** with **delivery** and made it harder to find “what we decided” vs “what we built.”

This layout separates concerns without rewriting history in one noisy commit.

---

## Where to put new docs

- **New UI/UX behavior** (e.g. calendar hub) → `docs/pages/admin/social/implementation/NNN_short_name.md`
- **Pre-change discovery** → `docs/pages/admin/social/audit/NNN_short_name.md`
- **Code-only modularization** → `docs/pages/admin/social/refactor/NNN_short_name.md` or continue legacy refactor audit until a docs-only migration
- **Process / conventions** → `docs/pages/admin/social/planning/NNN_short_name.md`

---

## Legacy locations (unchanged in this phase)

These remain the source of truth for completed work until a future **docs-only** move:

- `docs/audit/pages/admin-social/` — Phase 1–3 audits, production verification
- `docs/audit/pages/admin-social-refactor/` — Phase 4 refactor index and phase completion docs

**This phase does not move or rename old files** to avoid large diffs and broken links in chat/PR history.

---

## Recommended later migration (optional)

1. Copy or move `docs/audit/pages/admin-social-refactor/*` → `docs/pages/admin/social/refactor/` with redirect notes in index files.
2. Copy stable audits from `docs/audit/pages/admin-social/` → `docs/pages/admin/social/audit/` as needed.
3. Update `docs/audit/pages/admin-social-refactor/000_admin_social_refactor_index.md` with pointers to new paths.

Do that in a dedicated PR with no application code changes.

---

## Related

- Refactor milestone: `docs/audit/pages/admin-social-refactor/015_phase4_refactor_milestone_wrapup.md`
- Calendar/queue hub: `docs/pages/admin/social/implementation/001_calendar_queue_unification.md`
