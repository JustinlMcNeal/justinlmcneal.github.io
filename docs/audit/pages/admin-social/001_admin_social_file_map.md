# Admin Social — File Map

Legend: **Direct** | **Indirect** | **Maybe-related**

---

## HTML

| File | Role | |
|------|------|--|
| `pages/admin/social.html` | Monolithic admin UI: header, stats, 8 tabs, upload/settings/post-detail/analytics modals (~2400 lines) | **Direct** |
| `page_inserts/admin-nav.html` | Link to Social Media page | **Indirect** |
| `pages/admin/index.html` | Dashboard card → social admin | **Indirect** |

---

## Page JS (`js/admin/social/`)

| File | Role | |
|------|------|--|
| `index.js` | Orchestrator: auth, OAuth handlers, tab switching, stats, platform posting wrappers, module init | **Direct** |
| `api.js` | Supabase CRUD: products, assets, posts, templates, boards, settings, stats, storage upload helpers | **Direct** |
| `calendar.js` | Calendar grid, post pills, date navigation | **Direct** |
| `uploadModal.js` | 3-step New Post: upload, crop variants, caption/hashtags, schedule | **Direct** |
| `imagePool.js` | Image Pool tab: filters, upload, tagging modal, AI tag batch | **Direct** |
| `imageProcessor.js` | Client-side crop/resize previews for variations | **Direct** |
| `captions.js` | Template + AI caption/hashtag generation via `ai-generate` | **Direct** |
| `carouselBuilder.js` | Carousel tab: multi-image, AI caption/hashtags, schedule | **Direct** |
| `autoQueue.js` | Auto-Queue tab: preview/confirm queue via `auto-queue` edge function | **Direct** |
| `autopilot.js` | Autopilot settings UI, run `autopilot-fill` | **Direct** |
| `platformSettings.js` | Settings modal: auto-approve, tones, schedule, IG/FB page info | **Direct** |
| `postDetail.js` | Post modal: edit, post now, delete, view on platform | **Direct** |
| `analytics.js` | Analytics tab, insights sync, learning UI, post analytics modal | **Direct** |
| `postLearning.js` | Learning aggregation, patterns, recommendations, DB updates | **Direct** |
| `index.js.bak` | Stale backup of index; **not loaded** | **Maybe-related** (cleanup) |

---

## Shared JS

| File | Role | |
|------|------|--|
| `js/shared/adminNav.js` | Loads admin nav insert | **Indirect** |
| `js/shared/supabaseClient.js` | Auth + Supabase client | **Direct** |
| `js/config/env.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` for OAuth/post calls | **Direct** |
| `js/shared/pwa.js` | PWA on admin page | **Indirect** |

---

## CSS

| File | Role | |
|------|------|--|
| `css/pages/admin/social.css` | Modals, pool grid, animations, calendar pills | **Direct** |
| `css/theme/base.css`, `components.css` | Shared theme | **Indirect** |
| Tailwind CDN + inline `tailwind.config` in HTML | Layout/utilities | **Direct** |

---

## Supabase migrations (social-specific)

| File | Role | |
|------|------|--|
| `20260109_create_social_media_tables.sql` | Core tables: assets, variations, posts, settings, boards, templates, hashtags | **Direct** |
| `20260109_create_social_storage_bucket.sql` | `social-media` public bucket | **Direct** |
| `20260110_add_external_id_to_social_posts.sql` | External IDs | **Direct** |
| `20260111_fix_social_tables.sql` | `published_at`, settings, status `published` | **Direct** |
| `20260111_create_social_post_cron.sql` | pg_cron / `process_scheduled_posts_trigger` | **Direct** |
| `20260111_add_engagement_tracking.sql` | Engagement columns, `social_hashtag_analytics`, views | **Direct** |
| `20260111_add_instagram_permalink.sql` | Permalink fields | **Direct** |
| `20260111_add_carousel_support.sql` | `image_urls`, `media_type` | **Direct** |
| `20260111_add_deleted_status.sql` | Extended status enum incl. `deleted` | **Direct** |
| `20260111_add_product_post_tracking.sql` | Product post dates, auto_queue settings seed | **Direct** |
| `20260111_create_category_hashtags.sql` | Category hashtags | **Direct** |
| `20260113_add_image_url_to_social_posts.sql` | `image_url`, `product_id` on posts | **Direct** |
| `20260120_post_learning_engine.sql` | Learning tables: patterns, timing, hashtag perf | **Direct** |
| `20260315_image_pipeline.sql` | `social_generated_images`, `image_source` on posts | **Direct** |
| `20260315_carousel_and_import.sql` | Carousel set on generated images | **Direct** |
| `20260417_social_assets_image_pool.sql` | Pool columns: shot_type, used_count, source_asset_id | **Direct** |
| `20260418_social_assets_unique_path.sql` | Unique active path index | **Direct** |

---

## Edge Functions (see 005 for detail)

**In `supabase/config.toml`:** `process-scheduled-posts`, `instagram-post`, `pinterest-post`, `auto-queue`, `autopilot-fill`

**Present in repo, not all in config.toml:** `instagram-oauth`, `pinterest-oauth`, `instagram-insights`, `instagram-carousel`, `facebook-post`, `generate-social-image`, `ai-generate`, `ai-tag-assets`, `sync-pinterest-boards`, `auto-repost`, `refresh-tokens`, `pinterest-boards`, `share-product`

---

## Scripts / automation

| Path | Role | |
|------|------|--|
| `supabase/migrations/20260111_create_social_post_cron.sql` | Cron setup SQL (may need manual dashboard job) | **Direct** |
| No dedicated `scripts/` for social found | — | — |

---

## Existing planning docs

| Path | |
|------|--|
| `docs/pSocial/pSocial_001.md` | Revamp master plan |
| `docs/pSocial/pSocial_002.md` | Learning loop phases |
| `docs/pSocial/aiLearning_001.md` | AI learning notes |
| `docs/todo.md` | Social Media — Full Revamp section |

---

## Public social (out of scope)

| Path | Note |
|------|------|
| `docs/audit/pages/social/*` | Customer `/pages/social.html` — separate audit |
