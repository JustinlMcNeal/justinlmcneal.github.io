# Social Page System — File Map

Legend: **Direct** = core to behavior; **Indirect** = shared infra or duplicate links; **Potential** = planning, backup, or loosely related.

---

## HTML

| File | Role | Involvement |
|------|------|-------------|
| `page_inserts/footer.html` | Shared footer: Connect icons → Pinterest, Instagram, TikTok; admin-only Help link → `/pages/admin/social.html` | **Direct** (customer social links) |
| `pages/admin/social.html` | Admin Social Media Manager UI (~2.4k lines); loads `js/admin/social/index.js` | **Direct** (admin only) |
| `page_inserts/admin-nav.html` | Admin nav links to Social Media page | **Indirect** |
| `pages/contact.html` | “DM Us” card with same three platform icon links | **Indirect** |
| `pages/faq.html` | Inline text links to Instagram, TikTok, Pinterest in FAQ answers | **Indirect** |
| `pages/privacy.html` | Mentions Pinterest/Instagram in privacy copy | **Potential** |
| `pages/data-deletion.html` | Facebook/Instagram data-deletion instructions | **Potential** |
| `pages/admin/index.html` | Admin dashboard card linking to social admin | **Indirect** |

**Not found:** `pages/social.html`, `pages/socials.html`, `social.html` (root).

---

## JavaScript

| File | Role | Involvement |
|------|------|-------------|
| `js/shared/footer.js` | Fetches `footer.html` into `#kkFooterMount`; admin-only link reveal; logo secret-tap | **Direct** (footer injection) |
| `js/shared/adminNav.js` | Loads admin nav insert for admin pages | **Indirect** |
| `js/admin/social/index.js` | Admin page orchestrator: tabs, OAuth, modules | **Direct** (admin) |
| `js/admin/social/api.js` | Supabase CRUD for posts, assets, settings, stats | **Direct** (admin) |
| `js/admin/social/calendar.js` | Calendar / queue views | **Direct** (admin) |
| `js/admin/social/uploadModal.js` | New post upload flow | **Direct** (admin) |
| `js/admin/social/carouselBuilder.js` | Carousel assembly | **Direct** (admin) |
| `js/admin/social/autoQueue.js` | Auto-queue UI | **Direct** (admin) |
| `js/admin/social/autopilot.js` | Autopilot settings UI | **Direct** (admin) |
| `js/admin/social/imagePool.js` | Image pool management | **Direct** (admin) |
| `js/admin/social/platformSettings.js` | Instagram/Pinterest settings modals | **Direct** (admin) |
| `js/admin/social/postDetail.js` | Post detail modal; “View on Instagram” link | **Direct** (admin) |
| `js/admin/social/analytics.js` | Analytics and learning insights UI | **Direct** (admin) |
| `js/admin/social/captions.js` | Caption/hashtag generation | **Direct** (admin) |
| `js/admin/social/postLearning.js` | Learning engine client logic | **Direct** (admin) |
| `js/admin/social/imageProcessor.js` | Client-side image processing helpers | **Direct** (admin) |
| `js/admin/social/index.js.bak` | Backup of index; not loaded by HTML | **Potential** (cleanup candidate) |
| `js/home/index.js`, `js/catalog/index.js`, `js/product/index.js`, etc. | Call `initFooter()` on customer pages | **Indirect** |
| `js/shared/pwa.js` | PWA registration; loaded on admin social page | **Indirect** |

**Not found:** `js/pages/social/` (customer page modules).

---

## CSS

| File | Role | Involvement |
|------|------|-------------|
| `css/pages/admin/social.css` | Admin social page animations, modals, pool UI | **Direct** (admin only) |
| `css/theme/base.css`, `css/theme/components.css` | Linked by admin social HTML | **Indirect** (admin) |

Footer social icons use **Tailwind utility classes inside `footer.html`**, not a dedicated `css/pages/social.css`.

---

## Shared layout / inserts

| File | Role | Involvement |
|------|------|-------------|
| `page_inserts/footer.html` | Social icon markup and URLs | **Direct** |
| `page_inserts/navbar.html` | No social links | **Indirect** (confirmed absent) |
| `sw.js` | Precaches `footer.html` and `navbar.html` | **Indirect** |

---

## Assets

| Path | Role | Involvement |
|------|------|-------------|
| `imgs/brand/logo-bwp.png` | Footer logo (secret admin tap target) | **Indirect** |
| Supabase Storage bucket `social-media` | Admin-uploaded post images (migrations) | **Direct** (admin pipeline) |

---

## Data / config / backend

| File | Role | Involvement |
|------|------|-------------|
| `supabase/migrations/20260109_create_social_media_tables.sql` | `social_posts`, `social_assets`, `social_settings`, etc. | **Direct** (admin) |
| `supabase/migrations/20260111_fix_social_tables.sql` | Table fixes, default settings | **Direct** (admin) |
| `supabase/migrations/20260111_add_instagram_permalink.sql` | `instagram_permalink` on posts | **Direct** (admin) |
| `supabase/migrations/20260417_social_assets_image_pool.sql` | Image pool columns | **Direct** (admin) |
| Other `supabase/migrations/*social*` | Indexes, learning engine, image URL backfill | **Direct** (admin) |
| `supabase/functions/instagram-oauth/index.ts` | OAuth; redirect URI = production admin social URL | **Direct** (admin) |
| `supabase/functions/pinterest-oauth/index.ts` | Pinterest OAuth | **Direct** (admin) |
| `supabase/functions/instagram-post/index.ts` | Publish to Instagram | **Direct** (admin) |
| `supabase/functions/instagram-carousel/index.ts` | Carousel publish | **Direct** (admin) |
| `supabase/functions/instagram-insights/index.ts` | Insights sync | **Direct** (admin) |
| `supabase/functions/pinterest-post/index.ts` | Pinterest publish | **Direct** (admin) |
| `supabase/functions/process-scheduled-posts/index.ts` | Cron: scheduled posts | **Direct** (admin) |
| `supabase/functions/auto-queue/index.ts` | Auto-queue generation | **Direct** (admin) |
| `supabase/functions/autopilot-fill/index.ts` | Autopilot fill | **Direct** (admin) |
| `supabase/functions/generate-social-image/index.ts` | AI image generation | **Direct** (admin) |
| `supabase/functions/facebook-post/index.ts` | Facebook cross-post | **Potential** (admin) |
| `supabase/functions/auto-repost/index.ts` | Repost automation | **Potential** (admin) |
| `supabase/functions/refresh-tokens/index.ts` | Token refresh for IG/Pinterest | **Potential** (admin) |
| `supabase/config.toml` | Deployed function entries (subset of above) | **Indirect** |

---

## Planning / audit (reference only)

| File | Role | Involvement |
|------|------|-------------|
| `docs/todoPersonal.md` | Todo: create customer social page; footer → Instagram | **Potential** |
| `docs/pSocial/pSocial_001.md`, `pSocial_002.md` | Admin social revamp plans | **Potential** (admin scope) |
| `docs/todo.md` | Social Media — Full Revamp checklist | **Potential** (admin scope) |
