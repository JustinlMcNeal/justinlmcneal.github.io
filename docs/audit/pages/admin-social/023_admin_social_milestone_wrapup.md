# Admin Social — Milestone Wrap-Up (Audit + Phases 2–3)

**Date:** 2026-05-19  
**Type:** Documentation + commit hygiene (no app changes in this doc)  
**Project ref:** `yxdzvzscufkvewecvagq`  
**Scope:** Admin Social Media Manager only — not public `/pages/social.html`

---

## 1. Executive summary

A full **read-only audit** (docs `000`–`010`) mapped the admin posting pipeline, data model, edge functions, AI/automation, analytics, and prioritized risks. **Phases 2a–2e** fixed production-critical **status vocabulary drift** (`posted` vs `published`, `processing` CHECK), documented **cron/OAuth** operations, verified production, removed legacy **`published`** client fallbacks, and deployed **`auto-repost`** posted-only filtering. **Phase 3** audited auto-queue/autopilot (`016`), then shipped **settings + preview transparency** (`3a`), **safety guards** (`3b`), **3c-v1 scoring** (`3c`), **dry-run legacy comparison** (`3d`), **admin scoring weight controls** (`3e`), and a **read-only quartile performance readout** (`3f`).

**Outcome:** Admin Social is **better aligned with production DB semantics**, **more observable** for auto-queue decisions, and **safer** against duplicate/weak queue rows — with remaining work in **config parity**, **URL centralization**, and **UI modularization** deferred to Phase 4.

---

## 2. What was audited (docs `000`–`010`)

| Doc | Focus |
|-----|--------|
| `000` | Index, executive summary, next steps |
| `001` | File map (~2.4k HTML, 15+ JS modules, 15+ edge functions) |
| `002` | Current UI tabs, actions, hidden Templates tab |
| `003` | Data model: `social_posts`, assets, variations, settings, learning tables |
| `004` | End-to-end pipeline: upload → schedule → publish → insights |
| `005` | Edge function reference |
| `006` | AI, auto-queue, autopilot-fill behavior |
| `007` | Analytics, learning loop, insights sync |
| `008` | Gaps P0–P2, “do not touch yet” list |
| `009` | Original phased commit plan (superseded in part by 2–3 execution) |
| `010` | Phase 1 repo-only verification (status matrix, cron grep, `.bak` check) |

**Separate:** Public customer social links — `docs/audit/pages/social/` — intentionally out of scope.

---

## 3. Production risks addressed (Phases 2a–2e)

| Risk (from `008`) | Phase | Mitigation |
|-------------------|-------|------------|
| P0-1 `processing` not in CHECK | **2a** | Migration allows `processing`; processor aligned |
| P0-2 `posted` vs `published` split | **2a, 2d** | Canonical **`posted`**; data migration; client/edge drop `published` queries |
| P0-3 Cron dependency undocumented | **2b, 2c** | Runbook + prod verification checklist |
| P0-4 OAuth/token expiry | **2b, 2c** | Documented `refresh-tokens` + OAuth functions; ops verification |
| P1-7 Edge functions not in `config.toml` | **2e** | Drift documented; no bulk config edit (intentional) |
| P2-1 `index.js.bak` | **2e** | Removed from repo |
| `auto-repost` querying `published` | **2d, 2e** | `.eq("status", "posted")` + **deployed** to prod |

**Still open (not fully closed):** P1-1 hardcoded Supabase URLs, P1-2 monolithic HTML, P1-3 Queue/Calendar overlap, P1-4 alert UX, cron/insights automation as ongoing ops.

---

## 4. Admin UX improvements

| Area | Phase | Change |
|------|-------|--------|
| Status consistency | 2a–2d | `postStatus.js`; analytics/learning/detail use `posted` only |
| Auto-queue settings | 3a | Platforms, tones, times from saved `social_settings`; save/load fix |
| Preview transparency | 3a | Run banner, `selection_metadata` details, queue selection on post detail |
| Safety visibility | 3b | Skipped products panel; eligibility warnings in preview |
| Scoring comparison | 3d | Preview-only legacy vs 3c comparison table |
| Scoring controls | 3e | Weight inputs, penalties toggle, reset, compare toggle (no formula change) |
| Scoring performance | 3f | Analytics quartile readout (read-only) |

**Not changed:** Full page redesign, Queue tab removal, toast vs alert, public Socials page.

---

## 5. Auto-queue / autopilot improvements (Phase 3)

| Phase | Edge (`auto-queue`) | Admin UI |
|-------|---------------------|----------|
| **3a** | Body aliases for tones/times; richer `selection_metadata`, `settings_used` | Settings save/load; preview metadata UI |
| **3b** | Eligibility, pending-queue skip, one-platform-per-product default, scarcity caption guard, image reuse preference | Skipped/warnings display |
| **3c** | `3c-v1` weights, penalties/boosts, inventory health, metadata | Priority breakdown in preview |
| **3d** | `compareScoring` preview path; legacy approximation | Comparison table + summary |
| **3e** | *(none — uses existing `resolveScoringWeights`)* | Weight form + compare toggle |
| **3f** | *(none)* | Quartile engagement readout |

**`autopilot-fill`:** Body field aliases for settings (`3a`); volume/cron logic unchanged per audit `016`.

**Volume / `posts_per_day`:** Not increased in this milestone.

---

## 6. Deployment status

| Artifact | Repo changed | Documented prod deploy | Notes |
|----------|--------------|------------------------|-------|
| Migration `20260720_social_posts_status_alignment.sql` | Yes | **Apply via Supabase migration workflow** when ready | Idempotent; not assumed applied from repo alone |
| `auto-repost` | Yes (2d) | **Yes** — v30, 2026-05-19 (`015`) | Posted-only filter live |
| `auto-queue` | Yes (3a–3d) | **Required after merge** (`017`–`020`) | Large diff; UI stale until deployed |
| `autopilot-fill` | Minor (3a aliases) | **Optional** (`017`) | Deploy if body aliases needed in prod |
| `process-scheduled-posts` | Minor (status) | **Recommended** with 2a migration | Aligns with CHECK |
| `instagram-insights` | Minor (status) | **Recommended** with 2a | Posted filter alignment |
| `3e`, `3f` | UI/JS only | **No** | |

**Not deployed in this milestone (by design):** bulk `config.toml` registration, public social page, SMS functions.

**Pre-commit deploy checklist (operator, not automated here):**

```bash
# After migration applied:
npx supabase functions deploy process-scheduled-posts --project-ref yxdzvzscufkvewecvagq
npx supabase functions deploy instagram-insights --project-ref yxdzvzscufkvewecvagq
npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq
# Optional:
npx supabase functions deploy autopilot-fill --project-ref yxdzvzscufkvewecvagq
```

---

## 7. Current known risks

| Risk | Severity | Notes |
|------|----------|-------|
| `auto-queue` repo ahead of prod | High until deploy | Preview/generate may differ from live edge |
| Migration not yet applied | High | CHECK/`processing` failures if code deploys before DB |
| `config.toml` missing 11+ social functions | Medium | Local serve JWT defaults; prod deploy confirmed in `013` |
| Hardcoded Supabase URLs (`imagePool.js`, etc.) | Medium | Project change breaks fetches |
| Monolithic `social.html` / `autoQueue.js` | Medium | Regression surface on future edits |
| Small sample for quartile readout (`3f`) | Low | Directional until ~20–30 scored posts |
| Legacy comparison is approximation (`3d`) | Low | Indicative ranks only |
| Unrelated dirty files in working tree | Process | See §10 — risk of accidental commit |

---

## 8. Recommended next phases (Phase 4+)

| ID | Focus | Rationale |
|----|--------|-----------|
| **4a** | `config.toml` parity for deployed social functions | Close `015` drift; safer local serve |
| **4b** | Hardcoded Supabase URL cleanup | `008` P1-1; use shared `env.js` |
| **4c** | Scoring drill-down (posts per quartile) | Extends `3f` readout |
| **4d** | Admin social modularization | Split HTML/JS **after** milestone commit |
| **4e** | Persist comparison snapshots (optional) | Audit trail from `021` |

**Defer:** Public Socials page, auto-queue volume changes, scoring formula changes.

---

## 9. Files changed by category (working tree snapshot)

### Documentation — `docs/audit/pages/admin-social/*`

| File | Role |
|------|------|
| `000`–`010` | Core audit |
| `011`–`015` | Phase 2a–2e |
| `016` | Phase 3 auto-queue/autopilot audit |
| `017`–`022` | Phase 3a–3f implementation docs |
| `023` | This milestone wrap-up |

### Admin UI

| File | Status | Phase association |
|------|--------|-------------------|
| `pages/admin/social.html` | Modified | 3a–3f UI sections (auto-queue, scoring, analytics card) |
| `js/admin/social/postStatus.js` | **New** | 2a–2d canonical status helpers |
| `js/admin/social/scoringPerformance.js` | **New** | 3f quartile readout |
| `js/admin/social/autoQueue.js` | Modified (+702 lines) | 3a–3e primary UI |
| `js/admin/social/analytics.js` | Modified | 2d status + 3f hook |
| `js/admin/social/api.js` | Modified | Status / API alignment |
| `js/admin/social/postDetail.js` | Modified | 2d + 3a metadata display |
| `js/admin/social/postLearning.js` | Modified | 2d posted-only queries |
| `js/admin/social/carouselBuilder.js` | Modified | Minor (2 lines) |
| `js/admin/social/index.js` | *Unchanged in status* | — |
| `js/admin/social/index.js.bak` | **Removed** (2e) | Do not commit |

**Not modified in tree (unchanged for this milestone):** `autopilot.js`, `calendar.js`, `captions.js`, `imagePool.js`, `uploadModal.js`, `platformSettings.js`, `imageProcessor.js`, `index.js`.

### Supabase Edge Functions

| Function | Changed | Notes |
|----------|---------|-------|
| `auto-queue/index.ts` | **Yes** (~+1059 lines) | 3a–3d scoring/guards/settings |
| `autopilot-fill/index.ts` | Yes | 3a body aliases |
| `auto-repost/index.ts` | Yes | 2d posted-only |
| `process-scheduled-posts/index.ts` | Yes | 2a status alignment |
| `instagram-insights/index.ts` | Yes | 2a posted filter |

**Not changed (admin-social milestone):** `send-sms`, `sms-welcome-series` — unrelated edits in working tree.

### Supabase migrations

| File | Status |
|------|--------|
| `supabase/migrations/20260720_social_posts_status_alignment.sql` | **New** — apply before/with status-related deploys |

### Config / deploy

| File | Status |
|------|--------|
| `supabase/config.toml` | **Unchanged** in working tree |
| Drift | Documented in `012`, `013`, `015` — `auto-queue`, `autopilot-fill`, `process-scheduled-posts` **are** in config; `instagram-insights`, OAuth, `ai-generate`, etc. **not** listed |

---

## 10. Recommended commit groups

> **Do not commit** until explicitly instructed. Use `git add -p` where one file spans multiple phases (especially `auto-queue/index.ts` and `autoQueue.js`).

### Commit 1 — Admin Social audit documentation

```
docs/audit/pages/admin-social/
```

**Message (suggested):** `docs(admin-social): audit index and phases 000-023`

Includes all audit, phase, and this wrap-up. Safe to land first (no runtime).

---

### Commit 2 — Status alignment + migration + posted-only cleanup

```
supabase/migrations/20260720_social_posts_status_alignment.sql
js/admin/social/postStatus.js
js/admin/social/analytics.js      # status-related hunks only if splitting
js/admin/social/api.js
js/admin/social/postDetail.js
js/admin/social/postLearning.js
js/admin/social/carouselBuilder.js
supabase/functions/process-scheduled-posts/index.ts
supabase/functions/instagram-insights/index.ts
supabase/functions/auto-repost/index.ts
```

**Message (suggested):** `fix(admin-social): align social_posts status to posted + processing`

**Post-commit:** Apply migration in Supabase; deploy the three edge functions above.

---

### Commit 3 — Cron/OAuth runbook + operational cleanup

**Content:** Documentation-only tranche already in Commit 1 (`012`, `013`, `015`). **No additional code** unless you want a separate commit message pointing operators to runbooks:

**Option A (recommended):** Fold `012`–`015` into Commit 1.

**Option B:** Empty commit / docs-only tag — **not recommended**.

**Operational note:** `auto-repost` deploy is **code** (Commit 2), not docs.

---

### Commit 4 — Auto-queue settings, preview, and safety guards

```
supabase/functions/auto-queue/index.ts    # 3a + 3b portions (or whole file if undivided)
supabase/functions/autopilot-fill/index.ts
js/admin/social/autoQueue.js              # 3a + 3b UI portions
pages/admin/social.html                   # auto-queue tab sections only if splitting
```

**Message (suggested):** `feat(admin-social): auto-queue settings, preview metadata, safety guards`

**Post-commit:** Deploy `auto-queue` (+ optional `autopilot-fill`).

**Practical note:** If not using `git add -p`, merge Commits 4 + 5 edge changes into one deploy.

---

### Commit 5 — Scoring engine, comparison, controls, and performance readout

```
supabase/functions/auto-queue/index.ts    # 3c + 3d (if split from Commit 4)
js/admin/social/autoQueue.js              # 3c–3e
js/admin/social/scoringPerformance.js
js/admin/social/analytics.js              # 3f loadScoringPerformance
pages/admin/social.html                   # scoring + analytics sections
```

**Message (suggested):** `feat(admin-social): 3c scoring, comparison, controls, quartile readout`

**Post-commit:** Deploy `auto-queue` if not already deployed from Commit 4. **No deploy** for 3e/3f UI-only if edge already current.

---

### Alternative: 3 commits (simpler)

| # | Contents |
|---|----------|
| 1 | All `docs/audit/pages/admin-social/` |
| 2 | Commit 2 file list (status + migration + minor edges) |
| 3 | All remaining admin-social code (`auto-queue`, `autopilot-fill`, `autoQueue.js`, `scoringPerformance.js`, `analytics.js`, `social.html`) + single deploy note |

Use **3-commit** model if `git add -p` is not worth the friction.

---

## 11. Staging recommendation

1. **Stash or exclude** all unrelated paths (§12) before any `git add`.
2. Land **Commit 1** (docs) — can merge independently for review.
3. Apply **migration** in staging/prod before or atomically with Commit 2 deploy.
4. Deploy **`auto-queue`** once after Commits 4+5 (or combined Commit 3 alt) are on the branch.
5. Run manual checks from `013`, `017`, `020`, `022` checklists on staging.
6. Do **not** include `pages/social.html`, `js/shared/socialLinks.js`, `css/pages/social.css` in Admin Social milestone commits.

---

## 12. Working tree verification (`git status --short`)

Captured **2026-05-19** (after wrap-up doc creation).

### Admin-social related (include in milestone)

| Path | State |
|------|-------|
| `docs/audit/pages/admin-social/` | Untracked (entire folder) |
| `pages/admin/social.html` | Modified |
| `js/admin/social/analytics.js` | Modified |
| `js/admin/social/api.js` | Modified |
| `js/admin/social/autoQueue.js` | Modified |
| `js/admin/social/carouselBuilder.js` | Modified |
| `js/admin/social/postDetail.js` | Modified |
| `js/admin/social/postLearning.js` | Modified |
| `js/admin/social/postStatus.js` | Untracked (new) |
| `js/admin/social/scoringPerformance.js` | Untracked (new) |
| `supabase/functions/auto-queue/index.ts` | Modified |
| `supabase/functions/autopilot-fill/index.ts` | Modified |
| `supabase/functions/auto-repost/index.ts` | Modified |
| `supabase/functions/instagram-insights/index.ts` | Modified |
| `supabase/functions/process-scheduled-posts/index.ts` | Modified |
| `supabase/migrations/20260720_social_posts_status_alignment.sql` | Untracked (new) |

**Diff scale (admin-social code only):** ~1,766 insertions / 217 deletions across 12 tracked code paths (per `git diff --stat`).

### Unrelated — do **not** include in Admin Social milestone

| Path | Reason |
|------|--------|
| `pages/social.html`, `css/pages/social.css`, `js/shared/socialLinks.js` | Public Socials page — out of scope |
| `docs/audit/pages/social/` | Separate audit |
| `supabase/functions/send-sms/`, `sms-welcome-series/` | SMS work |
| `js/sms-signup/`, `js/success/`, `js/pages/`, `pages/sms-signup.html`, etc. | Other page refactors |
| `js/reviews/browse.js`, `pages/reviews.html` | Reviews |
| `js/product/render.js`, `js/admin/lineItemsOrders/api.js` | Unrelated product/admin |
| `js/shared/footer.js`, `page_inserts/footer.html`, `pages/contact.html`, `pages/faq.html` | Site-wide |
| `pages/admin/reset.html`, `css/pages/admin/reset.css` | Admin reset page |
| `docs/audit/implementation/ctaLabel/*`, `docs/audit/cleanup/*`, lineItems, ebay, system/sms docs | Other initiatives |
| `docs/reports/sms/*`, `docs/todoPersonal.md` | Personal/ops notes |
| `scripts/openclaw/run-sms-optimization.mjs` | SMS automation |
| `deno.lock` | Lockfile — commit only if project standard; verify origin |

### Special handling before commit

| Item | Action |
|------|--------|
| `js/admin/social/index.js.bak` | Already removed — ensure it does not reappear |
| `deno.lock` | Decide per repo policy; not required for admin-social |
| `auto-queue/index.ts` | Single deploy unit; avoid partial deploy of half the file |
| Migration | Run in Supabase before relying on `processing` status in prod |
| Edge vs UI order | Prefer: migration → edge deploy → merge UI, or same release train |

---

## 13. Ready to commit?

| Question | Answer |
|----------|--------|
| Is admin-social work reviewable? | **Yes** — docs complete `000`–`023`; code grouped above |
| Is the tree clean enough? | **No** — many unrelated modified/untracked files |
| Recommended action | **Partial-ready:** stage only §12 admin-social paths after excluding unrelated work |
| Blockers | Unrelated dirty files; confirm migration applied; confirm `auto-queue` deploy plan |

**Verdict:** **Ready to commit the Admin Social milestone** once unrelated changes are excluded (stash or separate branches) and the operator accepts post-merge **migration + `auto-queue` deploy**.

---

## 14. Document index (this milestone)

| Phase | Doc |
|-------|-----|
| Audit | `000`–`010` |
| 2a | `011` |
| 2b | `012` |
| 2c | `013` |
| 2d | `014` |
| 2e | `015` |
| 3 audit | `016` |
| 3a | `017` |
| 3b | `018` |
| 3c | `019` |
| 3d | `020` |
| 3e | `021` |
| 3f | `022` |
| Wrap-up | `023` (this file) |

---

*This document is documentation-only. No application code, deployments, or git commits were performed as part of creating it.*
