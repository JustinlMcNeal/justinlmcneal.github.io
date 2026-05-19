# Admin Social — Suggested Commit / Phase Plan

**Documentation only** — do not implement as part of this audit.

---

## Phase 1: Documentation + cleanup only

**Goal:** Reduce confusion without changing behavior.

| Commit theme | Tasks |
|--------------|-------|
| `docs: admin social audit` | This folder (done) |
| `chore: remove social index.js.bak` | Delete backup file |
| `docs: cron + OAuth runbook` | Dashboard steps for `process-scheduled-posts`, `autopilot-fill`, `refresh-tokens` |
| `docs: status enum truth table` | Document allowed `social_posts.status` values after DB check |

**No:** auto-queue logic changes, schema drops, OAuth app ID changes.

---

## Phase 2: UI reliability fixes

| Commit theme | Tasks |
|--------------|-------|
| `fix: social post status queries` | Use one status for “live posts” in analytics/insights |
| `fix: permalink + view on platform` | Use `instagram_permalink` / `permalink` consistently |
| `fix: env URL usage` | Replace hardcoded Supabase host in `imagePool.js`, `index.js` |
| `ui: remove IG test from stat card` | Move test post behind settings debug flag |
| `ui: toast instead of alert` | Optional; match other admin pages |

**Optional:** Hide Queue tab or add calendar list toggle only (per `pSocial_001`).

---

## Phase 3: Pipeline hardening

| Commit theme | Tasks |
|--------------|-------|
| `fix: processing status in DB` | Migration + processor alignment |
| `deploy: sync config.toml` | Register missing edge functions |
| `fix: verify_jwt` for automation | Match `docs/todo.md` service invocations |
| `test: scheduled post e2e` | Staging post → cron → IG |
| `monitor: autopilot daily cap` | Assert posts_per_day enforced in `auto-queue` |

---

## Phase 4: Analytics & learning improvements

| Commit theme | Tasks |
|--------------|-------|
| `feat: insights cron` | Scheduled `instagram-insights` if not already |
| `feat: pinterest metrics` | If Pinterest posting is production-critical |
| `feat: learning dashboard v2` | Follower growth, heat map (`docs/todo.md` Phase 2) |
| `feat: engagement comment UI` | Sprint 6.1 todo |

---

## Suggested PR grouping

| PR | Phases |
|----|--------|
| PR-A | Phase 1 only |
| PR-B | Phase 2 (status + UI fixes) |
| PR-C | Phase 3 (infra/cron/deploy) |
| PR-D | Phase 4 (analytics features) |

Keep **public social page** (`docs/audit/pages/social/`) in separate PRs from admin work.

---

## Verification checklist (before Phase 3)

- [ ] Admin can OAuth Instagram + Pinterest
- [ ] Manual Post Now succeeds
- [ ] Scheduled post publishes within 2 minutes of `scheduled_for`
- [ ] Autopilot-fill runs and increases queue count
- [ ] Sync Insights updates non-zero metrics on recent posts
- [ ] Auto-queue preview → confirm creates expected row count
