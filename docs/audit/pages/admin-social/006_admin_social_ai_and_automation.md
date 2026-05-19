# Admin Social — AI & Automation

---

## OpenAI usage

| Entry point | Model (per code comments) | Types |
|-------------|----------------------------|-------|
| `ai-generate` | GPT-family (`gpt-5-mini` in comment) | `caption`, `hashtags`, `score`, `insights`, `analyze_post`, `recommendations`, `category_research` |
| `generate-social-image` | `gpt-image-1` / DALL-E 3 fallback | Product scene images |
| `ai-tag-assets` | Assumed LLM | Shot type / metadata for pool |

**No OpenClaw** references found under `js/admin/social/`.

---

## Caption generation (`captions.js`)

| Mode | Behavior |
|------|----------|
| **Template** | `social_caption_templates` + product placeholders |
| **AI** | POST `ai-generate` with product, tone, platform, optional `topPosts` + `learningPatterns` from `post_learning_patterns` |
| **Hashtags** | Category defaults + AI merge; ensures brand tag |
| **Gating** | Length/tone constraints in prompts (edge function); template fallback on failure |

Used by: upload modal, carousel, auto-queue (server-side).

---

## Engagement scoring

- Client-side score UI in upload/carousel (`calculateEngagementScore` in `carouselBuilder.js`, wired to upload modal).
- Server `ai-generate` type `score` for caption quality.
- `postLearning.js` deep analysis after posts have metrics.

---

## Auto-queue rules (`auto-queue` edge function)

Large in-repo logic includes:

- 50+ caption templates by tone (casual, urgency, professional, …)
- Product selection using recency, category performance, image pool availability
- **UTM parameters** on product links (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) per `docs/todo.md`
- Hashtag merge: `hashtag_performance` winners + category tags
- Scheduling slots from `posting_time_performance` with fallbacks (`10:00`, `18:00`)
- Optional `generate-social-image` when no pool images
- Carousel/resurface modes per revamp commits

**Manual steps:** Admin preview → confirm queue in UI.

---

## Autopilot (`autopilot-fill` + `social_settings.autopilot`)

| Setting (typical) | Role |
|-------------------|------|
| `enabled` | Master switch |
| `days_ahead` | Horizon for queue fill |
| `posts_per_day` | Target volume |
| `platforms` | e.g. `["instagram"]` |
| `tones` | Caption tone rotation |
| `posting_times` | Slot list |

**Automated:** Cron calls `autopilot-fill` → deficit → `auto-queue`.  
**Manual:** **Run Autopilot** button in UI (`autopilot.js`).

**Documented past issue:** Autopilot “broken” until 2026-01 cron fix (`pSocial_001`); `docs/todo.md` marks fixed — **verify last_run in production**.

**Safety:** Revamp plan mentions fail-stop after N errors — confirm in `autopilot-fill` / settings.

---

## Learning loop (`postLearning.js` + insights)

| Step | Manual vs auto |
|------|----------------|
| Insights sync | Manual button; edge function may auto-aggregate every 6h |
| `updateHashtagPerformance`, `updateTimingPerformance`, `updateCaptionPerformance` | Client/edge triggered |
| `post_learning_patterns` upsert | After enough samples |
| Recommendations UI | Manual refresh |

Feeds **auto-queue** and **ai-generate** prompts via `learningPatterns`.

---

## Image pool automation

| Feature | Automation |
|---------|------------|
| `ai-tag-assets` | Semi-auto batch from Image Pool UI |
| Shot type + product_id | Manual tag modal v1 |
| used_count / last_used_at | Updated when assets used in posts |

---

## Repost / resurface

- UI: **Generate Repost** / confirm in Auto-Queue tab.
- Server: `auto-repost` function; autopilot may call resurface at ~1:4 ratio (`docs/todo.md`).
- Picks posts 30+ days old with strong engagement; new AI captions.

---

## Retry behavior

- `social_posts.retry_count` column exists.
- **Unclear** automatic retry policy in `process-scheduled-posts` — inspect before changing.
- Failed posts: `error_message`, status `failed`.

---

## Manual vs automated summary

| Task | Mostly |
|------|--------|
| Connect OAuth | Manual |
| Upload/tag images | Manual |
| New single post | Manual |
| Carousel | Manual |
| Fill queue | Automated (with preview) |
| Daily queue top-up | Automated (autopilot) |
| Publish at time | Automated (cron) |
| Sync metrics | Manual button + partial auto |
| Apply learnings to captions | Automated when data exists |
