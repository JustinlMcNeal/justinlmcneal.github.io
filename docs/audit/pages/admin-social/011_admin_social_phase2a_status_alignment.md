# Admin Social — Phase 2a Status Alignment

**Date:** 2026-05-19  
**Scope:** Status vocabulary only (no UI redesign, auto-queue, AI, or public social page).

---

## Problem fixed

- `process-scheduled-posts` wrote **`processing`** but CHECK constraint did not allow it.
- **`published`** vs **`posted`** split from old migrations; analytics/insights often filtered only `posted`.
- Publishers already wrote **`posted`**; data could still contain **`published`** rows.

---

## Chosen canonical statuses

| Role | Status |
|------|--------|
| Success (live on platform) | **`posted`** |
| In-flight publish | **`processing`** |
| Awaiting schedule | **`queued`**, **`draft`**, **`approved`**, etc. (unchanged) |
| Failure | **`failed`** |
| Removed from IG | **`deleted`** |
| Legacy (data only until migration) | **`published`** → migrated to **`posted`** |

---

## Migration created

**File:** `supabase/migrations/20260720_social_posts_status_alignment.sql`

- `UPDATE social_posts SET status = 'posted' WHERE status = 'published'`
- Replaces `social_posts_status_check` to allow:  
  `draft`, `pending`, `scheduled`, `queued`, `approved`, `processing`, `posting`, `posted`, `failed`, `deleted`
- Idempotent: safe to re-run UPDATE + DROP/ADD constraint

**Deploy:** Apply via normal Supabase migration workflow when ready (not run in this change set).

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260720_social_posts_status_alignment.sql` | **Created** |
| `js/admin/social/postStatus.js` | **Created** — shared constants + `isPostedSuccessStatus()` |
| `js/admin/social/api.js` | Stats counts use `POST_SUCCESS_STATUSES` |
| `js/admin/social/analytics.js` | Engagement/summary/learning batch use shared helpers |
| `js/admin/social/postLearning.js` | `.eq("status", POST_STATUS_POSTED)` |
| `js/admin/social/postDetail.js` | `isPostedSuccessStatus()` for UI gates |
| `supabase/functions/process-scheduled-posts/index.ts` | Comment only |
| `supabase/functions/instagram-insights/index.ts` | Comments on `posted` filters |
| `supabase/functions/auto-repost/index.ts` | Order of status array only (still includes legacy `published` for pre-migration rows) |

**Unchanged (already correct):** `instagram-post`, `instagram-carousel`, `pinterest-post`, `facebook-post` (write `posted` on success).

---

## `"published"` fallback decision

| Layer | Behavior |
|-------|----------|
| **DB (after migration)** | No `published` rows; CHECK does not allow new `published` |
| **Learning / insights** | Filter **`posted` only** (canonical) |
| **Header stats (`api.fetchStats`)** | `.in(["posted", "published"])` — safe if migration not applied yet |
| **Analytics summary cards** | `isPostedSuccessStatus()` — counts both until migration runs |
| **Post detail UI** | Same helper — backwards compatible |

After migration is applied everywhere, `published` in `POST_SUCCESS_STATUSES` is harmless dead weight and can be removed in a later cleanup commit.

---

## Analytics / query behavior after change

- Engagement metrics and learning aggregation target **`posted`** (plus legacy `published` in client-side filters where `.in()` is used).
- Status breakdown chart buckets **`posted`** and **`published`** into the “published” count.
- Insights sync still queries **`posted`** only; relies on migration to normalize legacy rows first.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Migration not applied in prod | Client queries still accept legacy `published` in stats/summary |
| Rows stuck in `processing` after crash | Out of scope; separate ops/repair task |
| `approved` status rare/legacy | Still allowed in CHECK for `fetchStats` queued count |

---

## Manual verification steps

1. Apply migration on staging/production.
2. `SELECT status, COUNT(*) FROM social_posts GROUP BY status` — expect no `published`.
3. `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'social_posts_status_check'`.
4. Queue a test post; confirm cron sets `processing` then child sets `posted` without DB error.
5. Admin → Analytics → Sync Insights; confirm metrics populate for `posted` posts.
6. Header stats “Posted today” matches calendar posted pills.

---

## Intentionally not touched

- `auto-queue` / `autopilot-fill` selection logic
- `ai-generate` prompts
- Admin HTML / tabs / modals layout
- Public `/pages/social.html`
- `js/admin/social/index.js.bak`
- Cron job setup SQL

---

## Recommended next phase

**Phase 2b:** Cron/OAuth runbook verification (`SETUP_CRON_JOB.sql`, insights cron).  
**Phase 2c:** Remove `published` from `POST_SUCCESS_STATUSES` after migration confirmed in prod.  
**Phase 3:** Auto-queue/autopilot only after publish + insights paths are stable.
