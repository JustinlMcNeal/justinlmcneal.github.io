# Phase 4b — First Refactor Implementation Prompt

Copy the block below into Cursor for the **first safe code refactor** (utilities only).

---

## Cursor prompt (copy from here)

```
Goal: Admin Social Phase 4b — extract pure utilities with zero behavior change.

Source of truth:
- docs/audit/pages/admin-social-refactor/000_admin_social_refactor_index.md
- docs/audit/pages/admin-social-refactor/001_current_file_size_and_responsibility_map.md
- docs/audit/pages/admin-social-refactor/003_target_module_structure.md
- docs/audit/pages/admin-social-refactor/004_refactor_phase_plan.md

Scope:
1. Create js/admin/social/utils/ with:
   - html.js — escapeHtml (consolidate duplicates from scoringPerformance.js, autoQueue.js, analytics.js, etc.)
   - formatters.js — shared number/percent formatters used in analytics + scoringPerformance (only if identical logic; do not change output formatting)
   - dates.js — only if there are duplicate pure date helpers (no behavior change)

2. Optional (same PR only if trivial):
   - services/edgeClient.js with getFunctionsBaseUrl() reading SUPABASE_URL from js/config/env.js only
   - Do NOT migrate all call sites yet — at most wire one non-critical internal use to prove pattern

3. Update imports in files you touch; keep all existing public exports at original module paths unchanged.

Constraints:
- NO behavior changes
- NO file moves of feature modules (autoQueue.js, analytics.js, postLearning.js stay in place)
- NO changes to pages/admin/social.html
- NO edge function or Supabase changes
- NO public Socials page
- NO renaming exported functions used by index.js or other modules
- Do not delete code paths; only extract duplicates

Compatibility:
- If two "duplicate" formatters differ slightly, leave them inline and document in a short comment — do not unify

Verification:
1. Grep for escapeHtml — all call sites use utils/html.js
2. Load /pages/admin/social.html — no console errors
3. Switch tabs: calendar, auto-queue, analytics
4. Auto-queue: open preview (no need to write DB)
5. Analytics: section loads including scoring performance readout
6. git diff — only js/admin/social/utils/*, services/edgeClient.js (if added), and import lines in touched files

Deliverable summary:
- Files created
- Files modified (list)
- Functions extracted (list)
- Anything intentionally NOT merged (near-duplicates)
- Manual verification done
```

---

## Expected files created (4b)

| File | Contents |
|------|----------|
| `js/admin/social/utils/html.js` | `export function escapeHtml(str)` |
| `js/admin/social/utils/formatters.js` | `formatNum`, `fmtPct`, etc. **only if identical** |
| `js/admin/social/utils/dates.js` | Optional schedule/date helpers |

## Expected files modified (minimal)

| File | Change |
|------|--------|
| `scoringPerformance.js` | Import `escapeHtml` from utils |
| `autoQueue.js` | Import shared html/formatters if duplicated |
| `analytics.js` | Import shared formatters if duplicated |
| `postDetail.js` | Only if duplicate html helpers |

## Out of scope for 4b

- Splitting `autoQueue.js` (Phase 4c)
- `postLearning.js` / `api.js` service split
- Fixing hardcoded `yxdzvzscufkvewecvagq.supabase.co` URLs (separate infra task)
- `index.js` slim-down

---

## Commit message suggestion

```
refactor(admin-social): extract shared utils (phase 4b)

No behavior change. Consolidate escapeHtml and shared formatters.
```

---

## Rollback

```bash
git revert <commit-hash>
```

Single revert should restore prior import paths.
