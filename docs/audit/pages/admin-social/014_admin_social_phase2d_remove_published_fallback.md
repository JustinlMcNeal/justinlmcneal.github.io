# Admin Social — Phase 2d Remove Legacy `published` Fallback

**Date:** 2026-05-19  
**Scope:** Client + `auto-repost` status predicates only (no schema, UI layout, cron, or automation logic changes).

---

## Why fallback removal is now safe

Production verification ([`013_admin_social_phase2c_prod_verification.md`](013_admin_social_phase2c_prod_verification.md)) confirmed on project `yxdzvzscufkvewecvagq`:

- `SELECT COUNT(*) FROM social_posts WHERE status = 'published'` → **0**
- `social_posts_status_check` includes `processing` and `posted` (migration `20260720` applied)
- Publish crons active; required edge functions deployed
- All live success rows use **`posted`**

Legacy `published` was a data/migration artifact, not written by current publishers.

---

## Files changed

| File | Change |
|------|--------|
| `js/admin/social/postStatus.js` | Removed `POST_STATUS_PUBLISHED_LEGACY`; `POST_SUCCESS_STATUSES` = `["posted"]`; `isPostedSuccessStatus()` → `posted` only |
| `js/admin/social/api.js` | Comment only (queries already use `POST_SUCCESS_STATUSES`) |
| `js/admin/social/analytics.js` | Removed `published` badge color key (status display) |
| `js/admin/social/carouselBuilder.js` | Removed `published` from `statusColors` map |
| `js/admin/social/postDetail.js` | No code change — uses `isPostedSuccessStatus()` |
| `js/admin/social/postLearning.js` | No code change — already `.eq(POST_STATUS_POSTED)` |
| `supabase/functions/auto-repost/index.ts` | `.eq("status", "posted")` instead of `.in(["posted", "published"])` |

**Not changed:** `postDetail.js`, `postLearning.js` (inherit posted-only via helper / constant).

---

## Remaining `published` references (classification)

| Location | Classification |
|----------|----------------|
| `js/admin/social/analytics.js` — `published` variable, `statuses.published`, `analyticsPublished` | **UI label** for “live post” counts (not DB status) |
| `js/admin/social/analytics.js` — `published_at` | **`published_at` column** (timestamp), not status |
| `supabase/functions/auto-repost/index.ts` — `published_at` comment | **Timestamp** backwards compat |
| `supabase/functions/instagram-insights/index.ts` — comments | **Historical** migration note |
| `supabase/migrations/*` | **Migration history** |
| `docs/audit/pages/admin-social/*` | **Docs only** |
| eBay/Amazon/other modules | **Unrelated domain** |

**Still needs cleanup:** None for social post **status** fallback.

**Deploy note:** `auto-repost` change requires edge function redeploy when ready; production DB already has zero `published` rows.

---

## App behavior after change

| Area | Before | After |
|------|--------|-------|
| Stats / analytics queries | `.in(["posted", "published"])` via helper | `.in(["posted"])` only |
| Post detail gates | `posted` or `published` | **`posted` only** |
| Carousel status badges | Green for `posted` or `published` | **`posted` only** |
| Auto-repost candidate query | `posted` or `published` | **`posted` only** |

Rows with impossible status `published` (CHECK disallows new writes) are no longer counted anywhere in admin code.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Staging DB still has `published` rows | Re-run migration UPDATE or keep fallback until verified |
| `auto-repost` not redeployed | Old function still queries `published` — harmless if count is 0 |
| Manual SQL inserted `published` rows | Would be excluded from admin metrics until normalized |

---

## Migration created?

**No** — schema already aligned in Phase 2c.

---

## Recommended next phase

1. **Deploy** `auto-repost` edge function (status filter only).
2. **Optional:** Register `20260720` in `schema_migrations` if history parity desired.
3. **Optional:** Add unlisted social functions to `supabase/config.toml`.
4. **Phase 3:** Auto-queue / autopilot behavior review (only after ops confirms token refresh + publish path).
5. **Separate chore:** Delete `js/admin/social/index.js.bak`.

---

## Verification (repo)

```bash
# No legacy status constant
rg POST_STATUS_PUBLISHED js/

# No dual-status filters in app code
rg '\["posted", "published"\]' js/ supabase/functions/

# Helper is posted-only
rg POST_SUCCESS_STATUSES js/admin/social/postStatus.js
```

**App code changed:** Yes (narrow).  
**UI redesign:** No.  
**Autopilot / auto-queue logic:** No.
