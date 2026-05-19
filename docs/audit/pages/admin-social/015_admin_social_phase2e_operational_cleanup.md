# Admin Social — Phase 2e Operational Cleanup

**Date:** 2026-05-19  
**Scope:** Deploy `auto-repost` posted-only filter, backup file cleanup, config.toml drift documentation.  
**Sources:** `012`, `013`, `014`

---

## 1. Purpose

Close operational loose ends after status alignment (Phases 2a–2d):

1. Ship Phase 2d `auto-repost` change to production.
2. Remove unused `index.js.bak` if still present.
3. Document `config.toml` vs deployed functions (no risky bulk config edits).

**Out of scope:** autopilot/auto-queue logic, UI, AI, cron, migrations, public social page.

---

## 2. Auto-repost deploy status

### Change deployed

`supabase/functions/auto-repost/index.ts` — candidate query uses **`.eq("status", "posted")`** only (Phase 2d).

### Command run

```bash
npx supabase functions deploy auto-repost --project-ref yxdzvzscufkvewecvagq
```

### CLI result

| Item | Value |
|------|--------|
| Exit code | **0** (success) |
| Warning | Docker not running (upload still succeeded) |
| Message | `Deployed Functions on project yxdzvzscufkvewecvagq: auto-repost` |

### Post-deploy verification

```bash
npx supabase functions list --project-ref yxdzvzscufkvewecvagq
```

| slug | status | version | updated_at (UTC) |
|------|--------|---------|------------------|
| `auto-repost` | ACTIVE | **30** (was 29 in doc 013) | **2026-05-19 17:33:57** |

**Deploy status:** **Done** — production matches repo posted-only filter.

---

## 3. Backup file deletion status

### File

`js/admin/social/index.js.bak`

### Reference check

| Source | References `index.js.bak`? |
|--------|----------------------------|
| `pages/admin/social.html` | **No** — loads `/js/admin/social/index.js` |
| `js/**` (runtime imports) | **No** |
| Audit/cleanup docs only | Yes (documentation) |

### Deletion attempt

- Delete tool / PowerShell: file **not present** on disk at verification time (`Test-Path` → false).
- Workspace glob may still index a stale path; **no tracked runtime dependency**.

**Deletion status:** **Already absent** — nothing to delete in this workspace. If the file reappears locally (untracked), safe to remove with the same reference rules.

---

## 4. Config.toml deploy drift findings

### Social functions in `config.toml` today

| Function | `verify_jwt` |
|----------|----------------|
| `process-scheduled-posts` | false |
| `instagram-post` | false |
| `pinterest-post` | false |
| `auto-queue` | false |
| `autopilot-fill` | false |

(Plus non-social: `stripe-webhook`, `share-product`, `verify-review-token`, `sms-subscribe`, `send-review-request`, `shippo-webhook`, `cta-label-redirect`.)

### Active on production, missing from `config.toml` (doc 013)

| Function | Production | Likely required | Notes |
|----------|------------|-----------------|-------|
| `instagram-carousel` | ACTIVE v28 | **Yes** | Cron publish chain |
| `facebook-post` | ACTIVE v29 | **Yes** | Cron publish chain |
| `instagram-insights` | ACTIVE v38 | **Yes** | Insights cron + UI |
| `refresh-tokens` | ACTIVE v25 | **Yes** | Daily token cron |
| `auto-repost` | ACTIVE v30 | UI/manual | Just redeployed |
| `ai-generate` | ACTIVE v38 | **Yes** | Captions / learning |
| `ai-tag-assets` | ACTIVE v15 | **Yes** | Image pool |
| `generate-social-image` | ACTIVE v32 | auto-queue path | Optional images |
| `instagram-oauth` | ACTIVE v38 | OAuth | Infrequent deploy |
| `pinterest-oauth` | ACTIVE v50 | OAuth | Infrequent deploy |
| `sync-pinterest-boards` | ACTIVE v15 | UI | Board sync |
| `pinterest-boards` | ACTIVE v41 | UI | Board helpers |

### Decision: `config.toml` unchanged in Phase 2e

**Reason:** Repo convention is partial listing; production deploy uses CLI/dashboard per function. Bulk-adding blocks risks inconsistent `verify_jwt` defaults for local `supabase functions serve` without validating each function’s production JWT setting.

### Future phase recommendation

**Phase 2f (optional):** Add missing **cron-critical** functions to `config.toml` with explicit `verify_jwt = false` to match production automation:

- `instagram-carousel`, `facebook-post`, `instagram-insights`, `refresh-tokens`, `auto-repost`

Add OAuth/AI helpers in a second pass after confirming dashboard JWT flags.

---

## 5. Files changed (this phase)

| File | Action |
|------|--------|
| `docs/audit/pages/admin-social/015_admin_social_phase2e_operational_cleanup.md` | **Created** |
| `js/admin/social/index.js.bak` | **Not on disk** — no delete commit |
| `supabase/config.toml` | **Unchanged** |
| `supabase/functions/auto-repost/index.ts` | Unchanged in 2e (deploy only; code from 2d) |

---

## 6. Intentionally not touched

- Auto-queue / autopilot-fill logic
- Admin UI / HTML
- AI prompts / `ai-generate`
- Cron schedules / SQL
- Public `/pages/social.html`
- New migrations
- `schema_migrations` registration for `20260720`

---

## 7. Recommended next phase

**Phase 3 — Pipeline behavior (when ready):**

1. Optional `config.toml` parity for cron-critical functions (2f).
2. Register `20260720` in `schema_migrations` if migration history parity desired.
3. Auto-queue / autopilot review per `pSocial_001` and audit `008`/`009` — **only after** ops confirms publish + insights + tokens stable.
4. Hardcoded Supabase URL cleanup in admin social JS (`imagePool.js`, etc.) — separate small PR.

---

## 8. Verification

```bash
# Backup not referenced in runtime
rg index.js.bak pages/ js/ --glob '!docs/**'

# Deploy command (already run)
npx supabase functions deploy auto-repost --project-ref yxdzvzscufkvewecvagq

git status --short
```

**App code changed in 2e:** No (deploy + docs only).
