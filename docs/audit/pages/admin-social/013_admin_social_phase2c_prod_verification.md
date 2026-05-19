# Admin Social — Phase 2c Production Verification

**Date:** 2026-05-19  
**Project:** Karry Kraze Website (`yxdzvzscufkvewecvagq`) — linked via Supabase CLI  
**Method:** `npx supabase db query --linked` (read-only + one-time migration apply)  
**Sources:** `011` (status alignment), `012` (cron/OAuth runbook)

---

## 1. Purpose

Verify **real production state** after Phase 2a migration design: status CHECK, data cleanup, cron jobs, deployed functions, and OAuth settings—before Phase 2d (remove legacy `published` fallback in client code).

**No app code changes in this phase.**

---

## 2. Migration verification

### Before apply

| Check | Result |
|-------|--------|
| `schema_migrations` version `20260720` | **Not present** (empty query) |
| `social_posts_status_check` | Old constraint — **no** `processing`, **no** `approved` |

**Pre-apply CHECK (exact):**

```text
CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'scheduled'::text, 'queued'::text, 'posting'::text, 'posted'::text, 'failed'::text, 'deleted'::text])))
```

### Apply action

Applied via project-normal remote SQL workflow:

```bash
npx supabase db query --linked -f supabase/migrations/20260720_social_posts_status_alignment.sql
```

**Exit code:** 0 (success)

### After apply

| Check | Result |
|-------|--------|
| CHECK includes `processing`, `posted`, `approved` | **Yes** |
| `schema_migrations` row `20260720` | **Still absent** — direct `-f` apply does not register migration history; track manually or run `db push` later if desired |

**Post-apply CHECK (exact):**

```text
CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'scheduled'::text, 'queued'::text, 'approved'::text, 'processing'::text, 'posting'::text, 'posted'::text, 'failed'::text, 'deleted'::text])))
```

**Migration applied?** **Yes** (SQL executed on linked production project).

---

## 3. Status distribution

**Query:** `SELECT status, COUNT(*) AS n FROM social_posts GROUP BY status ORDER BY n DESC;`

| status | n |
|--------|---|
| posted | 105 |
| failed | 25 |
| deleted | 10 |

**Key counts (post-migration):**

| status | count |
|--------|-------|
| posted | 105 |
| processing | 0 |
| published | 0 |

No rows in `queued`, `draft`, `failed` from distribution query beyond listed totals (140 rows total).

---

## 4. Published cleanup status

**Query:** `SELECT COUNT(*) FROM social_posts WHERE status = 'published';`

| published_count |
|-----------------|
| 0 |

**Before migration:** Already 0 (no `published` rows to UPDATE).

**Phase 2d:** Safe to remove `POST_SUCCESS_STATUSES` legacy `published` entry **in a separate code commit** — data and CHECK no longer use `published`.

---

## 5. Cron verification

**Query:** `SELECT jobid, jobname, schedule, active FROM cron.job WHERE ...`

| jobid | jobname | schedule | active |
|-------|---------|----------|--------|
| 6 | `process-scheduled-social-posts` | `* * * * *` | true |
| 12 | `sync-instagram-insights` | `0 */6 * * *` | true |
| 8 | `refresh-social-tokens-daily` | `0 3 * * *` | true |
| 7 | `autopilot-fill-daily` | `0 2 * * *` | true |
| 5 | `instagram-insights-weekly-sync` | `0 3 * * 0` | true |

**Not found (no duplicate):** `process-scheduled-posts`, `instagram-insights-sync` (migration template names only).

### Recent runs (sample)

| jobname | last seen (UTC) | status |
|---------|-----------------|--------|
| `process-scheduled-social-posts` | 2026-05-19 14:46:00 | succeeded (every minute) |
| `sync-instagram-insights` | 2026-05-19 12:00:00 | succeeded |
| `refresh-social-tokens-daily` | 2026-05-19 03:00:00 | succeeded |
| `autopilot-fill-daily` | 2026-05-19 02:00:00 | succeeded |

**Assessment:** Critical crons **active and succeeding**. No schedule changes made in this phase.

---

## 6. Edge function deployment verification

**Command:** `npx supabase functions list --project-ref yxdzvzscufkvewecvagq`

All focus functions **ACTIVE** on production:

| Function | config.toml | Repo | Deployed | Required |
|----------|-------------|------|----------|----------|
| `process-scheduled-posts` | Yes | Yes | **ACTIVE** v48 | Yes |
| `instagram-post` | Yes | Yes | **ACTIVE** v42 | Yes |
| `instagram-carousel` | No | Yes | **ACTIVE** v28 | Yes (cron chain) |
| `pinterest-post` | Yes | Yes | **ACTIVE** v42 | Yes |
| `facebook-post` | No | Yes | **ACTIVE** v29 | Yes |
| `instagram-insights` | No | Yes | **ACTIVE** v38 | Yes |
| `refresh-tokens` | No | Yes | **ACTIVE** v25 | Yes |
| `auto-queue` | Yes | Yes | **ACTIVE** v50 | Yes |
| `autopilot-fill` | Yes | Yes | **ACTIVE** v31 | Yes |
| `auto-repost` | No | Yes | **ACTIVE** v29 | UI/manual |
| `ai-generate` | No | Yes | **ACTIVE** v38 | Yes |
| `ai-tag-assets` | No | Yes | **ACTIVE** v15 | Yes |
| `generate-social-image` | No | Yes | **ACTIVE** v32 | auto-queue path |
| `instagram-oauth` | No | Yes | **ACTIVE** v38 | OAuth |
| `pinterest-oauth` | No | Yes | **ACTIVE** v50 | OAuth |
| `sync-pinterest-boards` | No | Yes | **ACTIVE** v15 | UI |
| `pinterest-boards` | No | Yes | **ACTIVE** v41 | UI |

**Repo tracking gap:** 11 social functions deployed but not listed in `config.toml` — operational risk for local JWT defaults only; production deploy confirmed.

**Edge secrets:** Not queried via CLI (would expose values). Assume configured while crons succeed and posts exist.

---

## 7. OAuth / settings verification (read-only, no secrets)

### Connection flags

| setting_key | connected / username |
|-------------|----------------------|
| `instagram_connected` | true |
| `instagram_username` | karrykraze |
| `pinterest_connected` | true |
| `facebook_connected` | true |

### Token presence (boolean only)

| setting_key | has_token |
|-------------|-----------|
| `instagram_access_token` | true |
| `instagram_user_id` | (user_id present, not token field) |
| `pinterest_access_token` | true |
| `pinterest_refresh_token` | true |
| `facebook_page_token` | true |

### Expiry metadata

| setting_key | expires_at (UTC) |
|-------------|------------------|
| `instagram_token_expires_at` | 2026-05-14T18:48:27.530Z |
| `pinterest_token_expires_at` | 2026-05-19T02:06:08.148Z |

**Risk:** Instagram expiry date is **before** verification date (2026-05-19). `refresh-social-tokens-daily` **succeeded** today at 03:00 UTC — verify whether `instagram_token_expires_at` was updated after refresh (metadata may be stale). Monitor before next publish failure.

---

## 8. Findings summary

| Area | Status |
|------|--------|
| Migration SQL | **Applied** — CHECK now allows `processing` / `approved` |
| `published` rows | **0** — safe for Phase 2d client cleanup |
| Publish cron | **Healthy** (minute cadence, succeeded) |
| Insights / refresh / autopilot crons | **Healthy** |
| Functions | **All required functions deployed** |
| config.toml parity | **Gap** — document only; not blocking prod |
| `schema_migrations` registry | **Gap** — `20260720` not recorded |
| IG token expiry metadata | **Possibly stale / past** — ops follow-up |

---

## 9. Recommendation

### **A. Safe to proceed to Phase 2d** — remove legacy `published` from `POST_SUCCESS_STATUSES` / `isPostedSuccessStatus()`

**Conditions met:**

- Migration applied; CHECK includes `processing` and `posted`
- Zero `published` rows in production
- Crons and deploys verified

**Phase 2d scope (separate commit):**

- `js/admin/social/postStatus.js` — drop `published` from success arrays
- Grep `auto-repost` `.in(["posted", "published"])` — narrow to `posted` only
- Do **not** change auto-queue/autopilot logic in same pass unless requested

**Optional ops (not Phase 2d):**

- Insert `20260720` into `supabase_migrations.schema_migrations` for history parity
- Add unlisted functions to `config.toml`
- Re-connect Instagram if publish tests fail despite refresh cron
- Delete `index.js.bak` — separate chore

### Not blocking Phase 2d

- Instagram expiry metadata concern (monitor; refresh cron ran successfully today)

---

## 10. Intentionally not touched

- Admin UI, auto-queue, autopilot, AI prompts
- Public social page
- `published` client fallback (removal deferred to Phase 2d)
- `index.js.bak`
- Cron schedule edits

---

## 11. Verification commands used

```bash
npx supabase db query --linked -f supabase/migrations/20260720_social_posts_status_alignment.sql
npx supabase db query --linked "<read-only SQL>"
npx supabase functions list --project-ref yxdzvzscufkvewecvagq
```

**App code changed:** No.
