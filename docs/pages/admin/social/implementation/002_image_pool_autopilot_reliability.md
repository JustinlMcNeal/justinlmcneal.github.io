# Image Pool + Autopilot Reliability

**Date:** 2026-05-19  
**Status:** Implemented (client + edge; migration pending deploy)

---

## Purpose

Improve Admin Social auto-posting reliability by:

1. Diagnosing why autopilot / auto-queue may produce no posts
2. Enforcing **Image Pool only** for standard auto-posting (no catalog/gallery fallback)
3. Adding Image Pool **content type** foundation (including testimonial)
4. Documenting future testimonial workflow without full automation

OpenClaw integration is **out of scope** for this phase.

---

## Current problem

- Autopilot can appear “stuck” when the queue is full, autopilot is disabled, or auto-queue skips all candidates.
- `auto-queue` previously fell back to AI-approved images, product gallery, and catalog photos when no tagged pool asset existed — producing posts that bypass curated Image Pool assets.
- Operators lacked a single place to see automation health (enabled state, last run, pool readiness, skip reasons).
- No structured `content_type` on pool assets blocked future testimonial / mix learning.

---

## Files inspected

| Area | Path |
|------|------|
| Admin page | `pages/admin/social.html` |
| Image Pool UI | `js/admin/social/imagePool.js`, `js/admin/social/api.js` |
| Auto-queue UI | `js/admin/social/features/autoQueue/*` |
| Autopilot UI | `js/admin/social/autopilot.js` |
| Edge | `supabase/functions/auto-queue/index.ts`, `supabase/functions/autopilot-fill/index.ts` |
| Migrations | `20260109_create_social_media_tables.sql`, `20260417_social_assets_image_pool.sql` |
| Settings | `social_settings` (`auto_queue`, `autopilot`, `autopilot_last_run`) |
| Legacy audits | `docs/audit/pages/admin-social/`, `docs/audit/pages/admin-social-refactor/` |

---

## Why autopilot may have stopped

| Cause | Where |
|-------|--------|
| Autopilot disabled | `social_settings.autopilot.enabled` — `autopilot-fill` exits early |
| Queue already “full” | `autopilot-fill`: `deficit <= 0` vs `days_ahead × posts_per_day` |
| No eligible products | Scoring/cooldown/eligibility in `auto-queue` |
| **No Image Pool asset** | Product lacks active asset with `product_id` + `shot_type` (autopilot-ready) |
| Pending queue duplicate guard | Product already in `queued` / `scheduled` |
| Token / platform settings | Separate from this change; can block publish in `process-scheduled-posts` |
| Edge not deployed | Local repo changes require Supabase function deploy to take effect |

**Visibility:** `autopilot_last_run` is written by `autopilot-fill` and partially by `auto-queue` (now `auto_queue_last_run` for manual runs). There is no dedicated `autopilot_run_log` table yet — see recommendations below.

---

## Where image fallback happened (before)

In `auto-queue` `resolveImage()` priority was:

1. Image Pool (`social_assets`, tagged)
2. Approved AI (`social_generated_images`)
3. Pipeline trigger + catalog/gallery temp
4. Gallery (`product_gallery_images`)
5. Catalog (`catalog_image_url`)

Standard auto-posting now uses **pool only** unless `image_asset_policy === "legacy_pipeline"` or `allow_catalog_fallback === true` in `social_settings.auto_queue`.

---

## Standard auto-posting image policy

- **Default:** `image_asset_policy: "image_pool_only"` (also default in edge when unset).
- Eligible pool asset: `is_active`, `product_id` NOT NULL, `shot_type` NOT NULL.
- If no eligible asset for a scored product: **skip** with `skipped_reason: "no_approved_image_pool_asset"`.
- `selection_metadata` includes: `asset_policy`, `image_source`, `image_pool_asset_id`, `asset_content_type`, `skipped_reason` (when skipped).
- Carousels in auto-queue: **pool assets only** under `image_pool_only` (no AI carousel branch).

---

## Resurface / carousel exception policy

| Workflow | Image source | Changed? |
|----------|--------------|----------|
| Standard auto-queue | Image Pool only | Yes — enforced |
| Auto-resurface old hits | Prior post `image_url` (`image_source: "resurface"`) | No — exception |
| Manual carousel builder | Admin UI | No — not in `auto-queue` |
| Legacy pipeline (explicit setting) | Full fallback chain | Opt-in only |

---

## Proposed Image Pool content type model

Column: `social_assets.content_type` (migration `20260519_social_assets_content_type.sql`).

| Value | Use |
|-------|-----|
| `product` | Default; catalog imports, product shots |
| `testimonial` | Review graphic assets (manual upload first) |
| `promo` | Sales / graphic promos |
| `lifestyle` | Lifestyle shots |
| `brand` | Brand-level creative |
| `educational` | Tips / how-to graphics |
| `ugc` | Customer content |
| `other` | Uncategorized |

Autopilot-ready still requires `product_id` + `shot_type` for product-linked posts; testimonial assets can be tagged when product is linked.

Future: learnable weights by `content_type` from performance — **not** hardcoded ratios (see planning doc).

---

## Testimonial content strategy

See `docs/pages/admin/social/planning/001_testimonial_content_strategy.md`.

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260519_social_assets_content_type.sql` | `content_type` column |
| `supabase/functions/auto-queue/index.ts` | Pool-only policy, skips, metadata |
| `supabase/functions/autopilot-fill/index.ts` | Richer last-run payload |
| `js/admin/social/api.js` | `content_type` on fetch/update/create |
| `js/admin/social/imagePool.js` | Filter + tag modal content type |
| `js/admin/social/features/autoQueue/autoQueuePreview.js` | Skip labels, policy banner |
| `js/admin/social/features/autoQueue/autoQueueSettings.js` | Persist `image_asset_policy` |
| `js/admin/social/features/autoQueue/autoQueueStats.js` | Calls automation health |
| `js/admin/social/features/autoQueue/autoQueueAutomationHealth.js` | **New** health panel loader |
| `js/admin/social/features/autoQueue/autoQueueController.js` | Export health loader |
| `js/admin/social/features/autoQueue/autoQueueActions.js` | Refresh health after preview |
| `pages/admin/social.html` | Health card, pool content type UI |
| `js/admin/social/index.js` | New element refs |
| `docs/pages/admin/social/planning/001_testimonial_content_strategy.md` | Future workflow |
| This file | Implementation record |

---

## Risks

- **Migration required** before UI `content_type` writes succeed in production DB.
- **Edge deploy required** for pool-only enforcement server-side.
- Fewer auto-queue posts until pool is tagged for top-scored products.
- `autopilot_last_run` from manual `auto-queue` was conflated historically; now uses `auto_queue_last_run` for manual runs.

---

## Manual verification checklist

- [ ] Admin Social page loads
- [ ] Image Pool tab: filter by content type; tag modal saves content type
- [ ] Auto-Queue → Automation Health shows autopilot on/off, queue counts, pool ready count
- [ ] Preview: products without pool assets appear in skipped list (`no approved image pool asset`)
- [ ] Preview: selected posts show `image_source: image_pool` and metadata `asset_policy: image_pool_only`
- [ ] No catalog/gallery image in standard preview (unless legacy policy set in DB)
- [ ] Resurface slot still uses prior post image (4+ post preview with enough history)
- [ ] Manual carousel workflow unchanged
- [ ] `node --check` on touched JS files

---

## Follow-ups (not this phase)

- `autopilot_run_log` or extend `social_settings` with structured last preview (skipped breakdown)
- Learnable `content_type` weights from analytics
- Testimonial graphic generator + OpenClaw recommendations
- Deploy edge functions when ready
