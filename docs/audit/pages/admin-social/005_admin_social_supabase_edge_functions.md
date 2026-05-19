# Admin Social — Supabase Edge Functions

**Note:** `supabase/config.toml` lists only a subset; other functions exist in `supabase/functions/` and may still be deployed manually.

---

## Publishing & scheduling

| Function | Purpose | Inputs (typical) | Effects | External API | Called by |
|----------|---------|------------------|---------|--------------|-----------|
| `process-scheduled-posts` | Publish due queued posts | `{}`, optional `resetPostId` | Updates `social_posts`; invokes child posters | — (orchestrator) | **Cron** (pg_cron / dashboard), HTTP |
| `instagram-post` | Publish single image/video to IG | `postId`, `imageUrl`, `caption` | IG media container + publish; updates post | Meta Graph | UI Post Now, processor |
| `instagram-carousel` | Publish carousel | Post/carousel payload | IG carousel publish | Meta Graph | Processor (when carousel) — **verify call chain** |
| `pinterest-post` | Create pin | `postId`, image, title, description, link, `boardId` | Pin ID on post | Pinterest API | UI, processor |
| `facebook-post` | Page photo post | `postId`, `imageUrl`, `caption`, `linkUrl` | FB post | Meta Graph | UI, processor |

---

## OAuth & tokens

| Function | Purpose | Called by |
|----------|---------|-----------|
| `instagram-oauth` | Exchange code; store page token in `social_settings` | OAuth redirect on `social.html` |
| `pinterest-oauth` | Pinterest token exchange | OAuth redirect |
| `refresh-tokens` | Refresh IG/FB and Pinterest tokens before expiry | **Cron** (expected), not wired in admin UI |

---

## Queue & automation

| Function | Purpose | Tables touched | Called by |
|----------|---------|----------------|-----------|
| `auto-queue` | Generate scheduled posts from catalog/pool/AI images | `social_posts`, `social_assets`, products, patterns, `social_generated_images` | UI preview/confirm; `autopilot-fill` |
| `autopilot-fill` | Fill queue to target depth per settings | Reads/writes `social_settings`, invokes `auto-queue` | **Cron**, UI Run Autopilot |
| `auto-repost` | Resurface old high performers | `social_posts`, settings | **Unknown** — may be cron or called from auto-queue |

---

## AI & tagging

| Function | Purpose | External API | Called by |
|----------|---------|--------------|-----------|
| `ai-generate` | Captions, hashtags, scores, insights, recommendations, category research | OpenAI (`gpt` per file header) | `captions.js`, `uploadModal.js`, `carouselBuilder.js`, `postLearning.js`, `auto-queue` |
| `generate-social-image` | Product-based AI images → `social_generated_images` | OpenAI image models | `auto-queue` (optional), not main UI tab |
| `ai-tag-assets` | Batch tag pool assets | OpenAI (assumed) | `imagePool.js` |

---

## Analytics & boards

| Function | Purpose | Called by |
|----------|---------|-----------|
| `instagram-insights` | Sync likes/reach/etc. from Graph API; refresh timing perf; learning trigger | UI **Sync Instagram Insights** (`analytics.js` invoke) |
| `sync-pinterest-boards` | Sync board list | UI **Auto-Sync Boards** |
| `pinterest-boards` | Board helpers | **Unknown** — related to Pinterest setup |

---

## Maybe-related (not core admin UI)

| Function | Notes |
|----------|-------|
| `share-product` | Product sharing; may overlap UTM links |
| `analytics-aggregate` | General analytics — **unclear** social tie-in |

---

## config.toml registered (social-relevant)

- `process-scheduled-posts`
- `instagram-post`
- `pinterest-post`
- `auto-queue`
- `autopilot-fill`

**Not in config.toml but present in repo:** `instagram-insights`, `instagram-oauth`, `facebook-post`, `ai-generate`, `generate-social-image`, `ai-tag-assets`, `sync-pinterest-boards`, `instagram-carousel`, `auto-repost`, `refresh-tokens`

**Unknown:** Whether all are deployed to production project; JWT verify flags per `docs/todo.md` (`verify_jwt=false` for some automation).

---

## Invocation patterns

| Pattern | Example |
|---------|---------|
| `fetch(SUPABASE_URL/functions/v1/...)` | `index.js`, `autoQueue.js`, `captions.js` |
| `client.functions.invoke("instagram-insights")` | `analytics.js` |
| Hardcoded project URL | `imagePool.js`, `index.js` sync boards — **inconsistency risk** |

---

## Open questions

1. Is `instagram-carousel` invoked from `instagram-post` or only directly?
2. Cron jobs actually configured in Supabase dashboard vs SQL-only comments?
3. Service role vs anon key on automated functions.
