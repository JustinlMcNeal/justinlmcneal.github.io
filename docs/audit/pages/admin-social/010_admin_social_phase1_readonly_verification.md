# Admin Social — Phase 1 Read-Only Verification

**Date:** 2026-05-19  
**Type:** Repo-only verification (no DB queries, no deploys, no code changes)  
**Source audits:** `docs/audit/pages/admin-social/000`–`009`

---

## 1. Purpose

Confirm audit findings about **status drift**, **CHECK constraints**, **analytics filters**, **cron/OAuth setup**, and **backup file** safety—using static repo search only. Production state (actual `cron.job` rows, live `social_posts.status` distribution) **cannot** be verified from the repo alone.

---

## 2. What was checked

| Area | Method |
|------|--------|
| Status strings in admin JS + edge functions | `grep` across `js/admin/social/**`, `supabase/functions/**` |
| `social_posts` CHECK constraints | All `supabase/migrations/*social*` + status-related migrations |
| Analytics / learning queries | `analytics.js`, `postLearning.js`, `instagram-insights` |
| Cron / scheduled jobs | `supabase/config.toml`, `SETUP_*.sql`, `migrations/*cron*` |
| OAuth / env vars | OAuth + post + insights edge function headers |
| `index.js.bak` references | Repo-wide search for `index.js.bak` |

---

## 3. Status vocabulary — code matrix

### Writers (sets `social_posts.status`)

| Status | Files / functions |
|--------|-------------------|
| **queued** | `uploadModal.js` (auto-approve), `carouselBuilder.js`, `auto-queue/index.ts` (`postStatus = "queued"`), `auto-repost/index.ts` (resurface), `process-scheduled-posts` (reset helper) |
| **draft** | `uploadModal.js` (when auto-approve off) |
| **processing** | **`process-scheduled-posts/index.ts` only** (before publish attempt) |
| **posted** | `instagram-post`, `instagram-carousel`, `pinterest-post`, `facebook-post` (on success) |
| **failed** | All three posters + `process-scheduled-posts` catch block |
| **deleted** | `instagram-insights` (when IG media gone) |
| **published** | **No edge function writes `published`** in repo; only migration `20260111_fix_social_tables.sql` UPDATE |

### Readers / filters

| Status | Files / functions |
|--------|-------------------|
| **queued** | `api.fetchQueuedPosts`, `index.js` queue loader, `process-scheduled-posts` (due posts), `autopilot-fill` (count draft+queued), `analytics.js` (scheduled count uses `queued` + future `scheduled_for`) |
| **posted** | `analytics.js` (engagement load **`.eq("status","posted")`**), `postLearning.js` (5 queries), `api.fetchStats` (posted today, IG/Pinterest totals), `instagram-insights`, `auto-queue` (learning + resurface), `auto-repost` (with published) |
| **published** | `analytics.js` (summary counts: `published \|\| posted`), `postDetail.js` (hide Post Now, permalinks), `auto-repost` (with posted) |
| **draft** | `uploadModal.js` writer; `analytics.js` status breakdown bucket |
| **failed** | `api.recalculateProductPostDate` (`.not("status","eq","failed")`); analytics status bucket |
| **approved** | `api.fetchStats` queued count `.in(["queued","approved"])` — **no writer found** in admin social JS |
| **scheduled** | CHECK allows it (`add_deleted_status`); **no grep hits** as assigned status in social JS/edge functions |
| **processing** | **No readers** — only writer |

### UI modules expecting statuses

| Module | Expectation |
|--------|-------------|
| `postDetail.js` | Published = `posted` **or** `published` |
| `analytics.js` | Mixed: strict `posted` for metrics; lenient for headline counts |
| `api.fetchStats` | **`posted` only** for “posted today” and platform totals |
| `calendar.js` | Displays raw `post.status` (any value) |

---

## 4. DB CHECK constraints (migrations)

| Migration | `social_posts_status_check` allows |
|-----------|--------------------------------------|
| `20260109_create_social_media_tables.sql` | `draft`, `queued`, `approved`, `posting`, `posted`, `failed` |
| `20260111_fix_social_tables.sql` | Adds **`published`**; data UPDATE `posted` → `published` |
| `20260111_add_deleted_status.sql` | **`draft`, `pending`, `scheduled`, `queued`, `posting`, `posted`, `failed`, `deleted`** — drops `approved`, `published`, `processing` |

**If migrations applied in filename order:** the **last** social status CHECK is likely `add_deleted_status` (no `published`, no `processing`, no `approved`).

### Runtime values vs CHECK (repo inference)

| Value | Written by code? | In last migration CHECK? | Risk |
|-------|------------------|--------------------------|------|
| `processing` | Yes (`process-scheduled-posts`) | **No** | **P0** — UPDATE may fail; post stuck `queued` or error path |
| `posted` | Yes (all posters) | Yes | OK if CHECK is `add_deleted_status` |
| `published` | Data-only via older migration | **No** (if `add_deleted_status` applied) | Rows may exist from `fix_social_tables` UPDATE; new writes use `posted` |
| `approved` | Not written; read in `fetchStats` | **No** | Queued stat may include zero rows with `approved` |
| `scheduled` | Not written in app code | Yes | Unused status slot |
| `pending` | Not on `social_posts` | Yes | — |

**Uncertainty:** Production may have diverged (manual SQL, partial migrations). **Requires live query:**  
`SELECT status, COUNT(*) FROM social_posts GROUP BY status` and  
`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_posts_status_check'`.

---

## 5. Analytics filters vs publish writers

| Layer | Uses |
|-------|------|
| **Publish success** | Always sets **`posted`** (`instagram-post`, `pinterest-post`, `facebook-post`, `instagram-carousel`) |
| **Engagement sync** | `instagram-insights` selects `.eq("status", "posted")` only |
| **Learning** | `postLearning.js` — **`posted` only** |
| **Analytics tab metrics** | `loadEngagementMetrics` — **`posted` only** |
| **Analytics summary cards** | Accepts **`published` OR `posted`** |
| **fetchStats header** | **`posted` only** (misses `published` rows) |

### Metrics likely missed (if DB has `published` rows)

- Engagement charts, learning aggregation, insights sync (if filtered to `posted` only)
- “Posted today” / platform total counts in stats row

### Defensive code (good)

- `analytics.js` summary: `published || posted`
- `postDetail.js`, `auto-repost`: both statuses

**Historical note:** `fix_social_tables` migrated all `posted` → `published`, but **publishers still write `posted`**, reintroducing dual vocabulary.

---

## 6. Cron / scheduled functions (repo)

### Required jobs (from `SETUP_CRON_JOB.sql` + docs)

| Job name (SQL file) | Schedule | Edge function | In `config.toml`? |
|---------------------|----------|---------------|-------------------|
| `process-scheduled-social-posts` | `* * * * *` | `process-scheduled-posts` | Yes |
| `autopilot-fill-daily` | `0 2 * * *` (SETUP) or `0 6 * * *` (migration) | `autopilot-fill` | Yes |
| `refresh-social-tokens-daily` | `0 3 * * *` | `refresh-tokens` | **No** |
| `sync-instagram-insights` | `0 */6 * * *` | `instagram-insights` | **No** |
| `instagram-insights-sync` | `0 */6 * * *` | `instagram-insights` | **No** (migration duplicate naming) |

### Repo artifacts

| File | Role |
|------|------|
| `supabase/SETUP_CRON_JOB.sql` | Operator runbook (3 jobs); placeholder `YOUR_SERVICE_ROLE_KEY` |
| `supabase/SETUP_INSIGHTS_CRON.sql` | Insights job; placeholder bearer |
| `supabase/migrations/20260111_create_social_post_cron.sql` | pg_cron template; notes dashboard manual setup |
| `supabase/migrations/20260111_autopilot_cron.sql` | Autopilot cron template |
| `supabase/migrations/20260111_instagram_insights_cron.sql` | Insights cron template |
| `docs/pSocial/pSocial_001.md` | Claims jobs created (jobid 7, 12) — **not verifiable from repo** |

### Cannot verify from repo

- Whether `cron.job` rows exist in production
- Last run times / failures (`cron.job_run_details`)
- Whether `app.settings.supabase_url` / service role settings used in older migrations are set
- Deploy of functions **not** in `config.toml` (`instagram-insights`, `refresh-tokens`, `ai-generate`, oauth functions)

---

## 7. OAuth / platform requirements (repo)

### Instagram posting

| Item | Source |
|------|--------|
| OAuth | FB dialog in `index.js`; callback → `instagram-oauth` |
| Env | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Stored settings | `instagram_access_token`, `instagram_connected`, `instagram_token_expires_at`, `instagram_user_id` |
| API | Meta Graph v18 (`instagram-post`, `instagram-insights`) |
| Redirect | `https://karrykraze.com/pages/admin/social.html` |

### Facebook posting

| Item | Source |
|------|--------|
| Token | `facebook_page_id`, `facebook_page_token`, or fallback from IG token `/me/accounts` |
| Function | `facebook-post` |
| UI | “Via Instagram” on status card |

### Pinterest posting

| Item | Source |
|------|--------|
| OAuth | `pinterest-oauth`; client id hardcoded in UI `1542566` |
| Env | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` |
| Stored | `pinterest_connected`, tokens in `social_settings` |
| Function | `pinterest-post`, `sync-pinterest-boards` |

### Instagram insights

| Item | Source |
|------|--------|
| Function | `instagram-insights` |
| Trigger | UI button; cron SQL files |
| Needs | Valid `instagram_access_token`; posts with `instagram_media_id` / `external_id` |

**Not verified from repo:** Token validity, app review status, webhook endpoints (none required for basic publish), secret rotation dates.

---

## 8. Backup file: `js/admin/social/index.js.bak`

| Check | Result |
|-------|--------|
| Loaded by `pages/admin/social.html`? | **No** — HTML loads `/js/admin/social/index.js` |
| Referenced in repo? | Only audit/cleanup docs (`docs/audit/cleanup/*`) |
| Safe to delete? | **Appears yes** — stale backup |
| Delete in this pass? | **No** — per instructions; recommend **separate cleanup commit** |

---

## 9. What should be fixed next (implementation)

1. **Query production** — status distribution + live CHECK constraint definition.
2. **Normalize status vocabulary** — pick canonical published state (`posted` recommended to match publishers).
3. **Single migration** — CHECK includes: `draft`, `queued`, `processing`, `posting`, `posted`, `failed`, `deleted` (+ deprecate unused `scheduled`/`pending` or map them).
4. **Align all readers** — `analytics.js`, `postLearning.js`, `instagram-insights`, `api.fetchStats` use same predicate (`posted` or unified helper).
5. **Document cron** — consolidate `SETUP_CRON_JOB.sql` + insights + token refresh; verify dashboard jobs.
6. **Delete `index.js.bak`** — isolated chore commit.

---

## 10. What should NOT be touched yet

| Area | Why |
|------|-----|
| `auto-queue/index.ts` caption/selection logic | High business impact |
| `autopilot-fill` deficit math | Until status + cron verified |
| Monolithic `social.html` refactor | Out of scope |
| `post_learning_patterns` seed data | Can reset learning behavior |
| Public `/pages/social.html` | Separate system |
| Pinterest production API switch | OAuth/API approval dependency |

---

## 11. Recommended fix order (safest)

1. Production read-only SQL (status counts + constraint def + `cron.job`)
2. Status normalization design doc + migration draft
3. Analytics/insights/stats query alignment (small JS diff)
4. `process-scheduled-posts` — ensure `processing` allowed OR stop using it
5. Cron/OAuth runbook + dashboard verification
6. Remove `index.js.bak`
7. **Then** auto-queue/autopilot behavior changes

---

## 12. Key findings summary

| Finding | Severity |
|---------|----------|
| **`processing` written but likely not in CHECK** | **Highest risk** — can break scheduled publish |
| **Publishers write `posted`; migration once moved data to `published`** | **High** — analytics/insights may under-count |
| **`fetchStats` / engagement queries ignore `published`** | **High** — header stats wrong if published rows exist |
| **Conflicting migrations on CHECK** | **High** — live DB unknown without query |
| **Cron jobs only in SQL templates** | **Medium** — ops dependency |
| **`approved` in stats filter but not in CHECK or writers** | **Low** |
| **`index.js.bak` unused** | **Low** — safe cleanup |

---

## 13. Highest-risk issue

**`process-scheduled-posts` sets `status: "processing"` while `20260111_add_deleted_status.sql` does not include `processing` in `social_posts_status_check`.** If that migration is active, the publish cron may fail at the first UPDATE, leaving posts unpublished or in an inconsistent state.

---

## 14. Recommended next implementation phase

**Phase 2a — Status + constraint alignment** (read production first, then one migration + query fixes). Do **not** start auto-queue/autopilot changes until publish + insights paths are consistent.

---

## 15. Verification command

```text
git status --short
→ ?? docs/audit/pages/admin-social/010_admin_social_phase1_readonly_verification.md
```

**App code changed:** No.
