# Admin Social — Current UI Behavior

**Entry:** `/pages/admin/social.html` → `js/admin/social/index.js` (module). Requires Supabase admin session; redirects to `/pages/admin/login.html` if missing.

**No site footer** on this page (`#kkFooterMount` absent). Admin nav via `#kkAdminNavMount`.

---

## Header actions

| Control | Appears to do |
|---------|----------------|
| **Connect Instagram** | Redirect to Facebook OAuth dialog; callback handled in `index.js` → `instagram-oauth` edge function |
| **Connect Pinterest** | Pinterest OAuth redirect; `pinterest-oauth` |
| **Settings** | Opens settings modal (`platformSettings.js`) |
| **Auto Queue** | Opens auto-queue flow / tab focus (`autoQueue.js`) |
| **New Post** | Opens upload modal (`uploadModal.js`) |

---

## Stats row

| Card | Behavior |
|------|----------|
| Queued / Posted Today | Loaded via `api.js` `fetchStats()` |
| Instagram / Facebook / Pinterest status | Connection flags from `social_settings`; Instagram card click runs `window.testInstagramPost()` (test post prompt) |

---

## Tabs (visible)

| Tab | UI | Primary module |
|-----|-----|----------------|
| **Calendar** | Month grid, post pills, prev/next | `calendar.js` |
| **Queue** | Filterable list of scheduled posts | `index.js` + `api.fetchPosts` (duplicate of calendar list per revamp plan) |
| **Image Pool** | Grid, filters (all/unused/used), upload, browse catalog, tag modal | `imagePool.js` |
| **Templates** | **Hidden** (`hidden` class) — CRUD still in HTML/JS | `index.js` `setupTemplates` |
| **Boards** | Pinterest boards list, sync, add | `index.js` + `sync-pinterest-boards` |
| **Auto-Queue** | Product stats, preview/generate/confirm queue, repost section, autopilot panel | `autoQueue.js`, `autopilot.js` |
| **Analytics** | Engagement summary, sync insights, charts, learning insights, category research | `analytics.js`, `postLearning.js` |
| **Carousel** | Build multi-image carousels, AI caption/hashtags, schedule | `carouselBuilder.js` |

Default tab on load: **Calendar**.

---

## Modals

### Upload modal (New Post) — 3 steps

1. **Image** — file pick, product link, optional gallery
2. **Formats** — variant crops (square, portrait, vertical, etc.)
3. **Caption & schedule** — tone, AI regenerate caption/hashtags, engagement score UI, platforms (IG/FB/Pinterest), board, date/time

**Actions:** Next/Back, **Schedule Post** → creates `social_assets`, `social_variations`, `social_posts` via `api.js`; may call `ai-generate` for caption/hashtags.

### Settings modal

- Auto-approve, default tone, posting schedule windows
- Instagram profile load/save (`btnLoadInstagramInfo`)
- Facebook page info load/save (linked to IG business account)
- **Save Settings** → `social_settings` JSON blobs

### Post detail modal

- View/edit caption, hashtags, schedule, platform
- **Post Now** → `postToInstagram` / `postToFacebook` / `postToPinterest` in `index.js`
- **Delete**, **Save**, **View on platform** (permalink; fallback URL risk in `postDetail.js`)
- Carousel image navigation when `image_urls` length > 1

### Post analytics modal (from calendar/analytics)

- Metrics display, deep analysis, refresh, view on Instagram
- Wired in `analytics.js` + `postLearning.js`

### Other

- Tag edit modal (Image Pool)
- Carousel image preview modal
- Auto-queue preview / repost preview panels (in Auto-Queue tab)

---

## Notable UI issues (observed in code/HTML)

| Issue | Notes |
|-------|-------|
| **Queue tab still present** | `pSocial_001` planned merge into Calendar — may be redundant |
| **Templates tab hidden but present** | Intentional fallback; still wired in JS |
| **Instagram test post on status card** | `onclick` + `prompt()` — dev-style UX on production card |
| **Alerts for success/errors** | Many flows use `alert()` not toast |
| **Hardcoded Pinterest App ID** | `1542566` in `index.js` connect handler |
| **Hardcoded Supabase project URL** | Some fetches use literal `yxdzvzscufkvewecvagq.supabase.co` instead of `env.js` |
| **AI Images tab removed** | Per `docs/todo.md`; `generate-social-image` still exists server-side for auto-queue |

---

## Platforms supported in UI

| Platform | Connect | Schedule | Post now |
|----------|---------|----------|----------|
| Instagram | Yes | Yes | Yes |
| Facebook | Via IG (status card) | Yes | Yes |
| Pinterest | Yes | Yes | Yes |
| TikTok / YouTube | **Not in admin social UI** | — | — |

---

## Manual workflow (typical)

1. Connect Instagram (+ optional Pinterest).
2. Upload images to **Image Pool**; tag `shot_type` + `product_id`.
3. **New Post** or **Carousel** or **Auto-Queue** / **Autopilot** to fill queue.
4. Review **Calendar** / **Queue**.
5. Cron or **Post Now** publishes; **Analytics** → **Sync Instagram Insights** refreshes metrics.
