# Social Media Page Revamp — pSocial_001

> **Created**: 2026-04-16  
> **Status**: Planning  
> **Scope**: Full audit & revamp of `/pages/admin/social.html` and all supporting JS/edge functions

---

## Executive Summary

The social media page has a solid foundation — Instagram/Facebook posting, a learning engine, analytics, edge functions, and a cron-driven autopilot. But it's grown organically and has redundant sections, broken features, and manual steps that should be automated. The core vision is:

**A fully data-driven, self-improving auto-posting system** where the admin only needs to:
1. Upload curated images (generated externally via GPT chat)
2. Optionally tag images with metadata (close-up, model shot, lifestyle, etc.)
3. Everything else — scheduling, captions, hashtags, carousel assembly, reposting — is automated and learns from past performance.

---

## Current State vs Target State

| Area | Current | Target |
|------|---------|--------|
| **Image source** | AI generates on-site (inconsistent) + product photos | Admin uploads curated images from GPT chat into an image pool |
| **Posting schedule** | Autopilot broken (last run 2026-01-11) | Autopilot reliably runs daily via cron, fills queue based on data |
| **Caption generation** | Template-based + AI, but manual tone selection | Fully AI-driven using learned patterns — no manual tone picking |
| **Posting times** | Manual selection from dropdown | Data-driven from `posting_time_performance` table |
| **Queue tab** | Separate redundant page | Merged into Calendar as a list-view toggle |
| **Assets tab** | Shows used images, allows re-posting | Becomes the **Image Pool** — the primary place to manage uploadable content |
| **Templates tab** | Manual template CRUD | Removed — AI generates from learned patterns directly |
| **AI Images tab** | On-site generation pipeline | Removed — replaced by manual upload workflow |
| **Carousel building** | Manual image selection | AI auto-assembles carousels using image tags (close-up + model + wide, etc.) |
| **Analytics on posts** | All showing 0 | Fixed — insights sync actually pulls data |
| **Resurface Old Hits** | Manual trigger | Automated as part of autopilot cycle |
| **Image tagging** | None | New: tag images with shot type, mood, etc. for smart carousel assembly |

---

## Tab Structure (After Revamp)

| # | Tab | Status | Notes |
|---|-----|--------|-------|
| 1 | 📅 **Calendar** | **Keep + Enhance** | Add list/queue view toggle; fix post analytics showing 0 |
| 2 | 📋 Queue | **Remove** | Merge into Calendar as a view mode |
| 3 | 🖼️ **Image Pool** (was Assets) | **Revamp** | Primary upload destination; add image tagging; show unused images first |
| 4 | ✏️ Templates | **Remove** | AI generates from learned data, templates are limiting |
| 5 | 📌 Boards | **Keep** | Leave as-is until Pinterest goes production |
| 6 | ⚡ **Autopilot** (was Auto-Queue) | **Revamp** | Fix autopilot, make everything data-driven, automate resurface |
| 7 | 📊 **Analytics** | **Keep + Fix** | Fix insights sync, fix 0-value analytics |
| 8 | 🎠 **Carousel** | **Revamp** | AI auto-assembles from tagged image pool |
| 9 | 🎨 AI Images | **Remove** | User generates externally, uploads to Image Pool |

**Final tab order**: Calendar → Image Pool → Boards → Autopilot → Analytics → Carousel (6 tabs, down from 9)

---

## Phase 1: Fix What's Broken

### 1A. Fix Post Analytics Showing 0

**Problem**: Clicking on a past post in the calendar shows all analytics (likes, comments, saves, reach, impressions) as 0. Either the insights sync isn't running, the edge function isn't writing data back, or the UI isn't reading the stored values.

**Investigation steps**:
1. Check `social_posts` table — do any rows have non-zero `likes`/`comments`/`reach` values?
2. Check `instagram-insights` edge function — verify it's correctly parsing the Graph API response and updating the DB
3. Check if `instagram_media_id` is populated on posted rows (needed to fetch insights)
4. Check the calendar post-detail modal — verify it reads from the correct columns
5. Check if `Sync Insights` button triggers correctly and the function returns success

**Files to audit**:
- `supabase/functions/instagram-insights/index.ts` — does it actually write back to `social_posts`?
- `js/admin/social/index.js` — calendar post detail rendering, check which columns it reads
- `js/admin/social/api.js` — `getPostById()` or similar, ensure it selects engagement columns

**Fix**: Likely one of:
- The edge function writes to different column names than the UI reads
- `instagram_media_id` isn't being saved when a post is published (so insights can't look it up)
- The insights edge function has a permissions/scope issue with the Graph API
- The cron job for insights sync was never set up

### 1B. Fix Autopilot Not Running

**Problem**: Autopilot toggle is ON but last run was 2026-01-11 (3 months ago). The `autopilot-fill` edge function is supposed to run via pg_cron daily.

**Investigation steps**:
1. Check if the pg_cron job exists: `SELECT * FROM cron.job WHERE jobname LIKE '%autopilot%' OR jobname LIKE '%social%';`
2. Check cron job history: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`
3. Check if `autopilot-fill` edge function is deployed and functional
4. Check if the function errors out (token expired? product selection fails? variation_id NOT NULL constraint?)
5. Test the function manually via curl

**Root cause suspects**:
- Instagram token expired and wasn't refreshed → `process-scheduled-posts` fails → queue builds up but never clears → autopilot stops filling because it thinks the queue is full
- `variation_id NOT NULL` constraint — autopilot creates posts without uploading images, so it may fail on insert
- The cron job was deleted or never created after a DB migration

**Fix**:
- Verify/recreate the cron job
- Fix the `autopilot-fill` function to handle the `variation_id` constraint (allow NULL or create a placeholder variation)
- Ensure `refresh-tokens` cron is active so tokens don't expire
- Add error logging/alerting so we know when autopilot fails

---

## Phase 2: Remove Redundant Sections

### 2A. Remove Queue Tab
- Delete the Queue tab HTML from `social.html`
- Remove queue-related JS from `index.js` (the `renderQueue()` function, queue filters, etc.)
- Add a **view toggle** to the Calendar tab header: 📅 Grid | 📋 List
  - Grid = current monthly calendar
  - List = chronological list of upcoming scheduled posts (basically what Queue was, but inside Calendar)

### 2B. Remove Templates Tab
- Delete Templates tab HTML
- Remove template CRUD JS (`renderTemplates()`, save/delete template handlers)
- Keep the `social_caption_templates` DB table for now — AI caption generation already uses past data + patterns from `post_learning_patterns`, not static templates
- The `auto-queue` edge function has 50+ hardcoded fallback templates — leave those as a safety net but prioritize AI-generated captions

### 2C. Remove AI Images Tab
- Delete AI Images tab HTML (review queue, approved grid, blacklist, generation settings)
- Remove `imagePipeline.js` entirely (800+ lines)
- Remove `generate-social-image` edge function (or leave deployed but unused)
- Remove related UI handlers from `index.js`
- Keep `social_generated_images` table — previously generated images should still be usable from the Image Pool

---

## Phase 3: Revamp Image Pool (was Assets)

### 3A. New Upload Workflow

The Image Pool becomes the **primary way to add content**. The admin generates images in GPT chat, downloads them, and uploads here.

**UI changes to Assets tab**:
- Rename tab label from "🖼️ Assets" to "🖼️ Image Pool"
- Add a prominent **Upload Images** button (drag & drop zone, multi-file)
- On upload:
  1. Image is stored in `social-media` Supabase storage bucket
  2. A `social_assets` row is created
  3. Auto-crop `social_variations` are generated for each aspect ratio (1:1, 4:5, etc.)
  4. **Tagging modal** opens (see 3B)

**Display changes**:
- Show **unused images first** (images that haven't been posted yet) — these are the pool for autopilot to draw from
- Show post count badge on each image (0 = fresh, 1+ = already used)
- Filter: All | Unused | Used
- Search by product name or tag

### 3B. Image Tagging System

When an image is uploaded (or retroactively), the admin can tag it with metadata that helps AI make smart decisions about when/how to use it.

**Tag categories**:

| Tag Type | Options | Purpose |
|----------|---------|---------|
| **Shot type** | close-up, model, lifestyle, flat-lay, wide, detail, packaging | Carousel assembly — AI picks diverse shot types |
| **Mood** | casual, luxury, playful, bold, minimal, cozy | Caption tone matching |
| **Product** | Link to product ID | Which product this image represents |
| **Platform preference** | any, instagram-only, pinterest-only | Some images work better on specific platforms |

**DB changes**:
- Add columns to `social_assets`: `tags JSONB DEFAULT '[]'`, `product_id UUID REFERENCES products(id)`, `used_count INT DEFAULT 0`
- Or create a lightweight `social_asset_tags` junction table

**AI auto-tagging** (optional enhancement):
- On upload, send the image to GPT-4o vision via edge function
- AI returns suggested tags (shot type, mood, dominant colors)
- Admin confirms or adjusts — saves time vs manual tagging

### 3C. Integration with Autopilot

The autopilot system should draw from the Image Pool:
1. Query `social_assets` WHERE `used_count = 0` (prefer unused) ORDER BY `created_at ASC`
2. If no unused images, fall back to least-recently-used
3. For carousels, select 3-5 images of the same product with diverse `shot_type` tags

---

## Phase 4: Revamp Autopilot (was Auto-Queue)

### 4A. Make Everything Data-Driven

**Current problem**: Manual queue generation asks the user to pick posting times and caption tones. But the system already has `posting_time_performance` and `caption_element_performance` tables with engagement data. Let the data decide.

**Changes to Auto-Queue tab**:

#### Autopilot Section (keep, fix, enhance)
- Fix the cron job so it actually runs
- Display: last run time, next scheduled run, posts in queue, error log
- Settings: posts per day, days to fill ahead, platforms (keep these as user controls)
- **Remove**: manual posting time selection — autopilot reads from `posting_time_performance.is_peak_time`
- **Remove**: manual caption tone selection — AI picks based on `caption_element_performance` data

#### Manual Queue Generation (simplify)
- Keep as a "Generate Now" button for when you want to force-fill the queue
- Remove the manual posting time / caption style dropdowns
- Instead show a preview: "AI will schedule 5 posts over the next 3 days at peak times with data-optimized captions"
- One-click confirm

#### Resurface Old Hits (automate)
- Move from manual trigger to automated:
  - Autopilot checks: any posts older than 30 days with engagement_rate > median?
  - If yes, auto-generates a repost with a fresh AI caption at a ratio of ~1 repost per 4 new posts
- Add a toggle: "Auto-resurface top content" (on/off) with configurable days threshold and frequency
- Keep the manual "Resurface Now" button as an override

### 4B. Autopilot Decision Flow

```
Daily cron triggers autopilot-fill:
  1. Check how many posts are queued for the next N days
  2. Calculate deficit (target - current)
  3. If deficit > 0:
     a. Select products to post (least recently posted first)
     b. For each product:
        - Pick best unused image from Image Pool (matching product_id)
        - If no unused images, use least-recently-used
        - AI generates caption using learned patterns from post_learning_patterns
        - Schedule at peak time from posting_time_performance
     c. Every 4th post: check for resurfaceable old hits
        - If found, insert a repost instead of a new post
  4. Log run result to social_settings or a runs table
```

---

## Phase 5: Smart Carousel Assembly

### 5A. AI-Driven Carousel Building

**Current**: Manual image selection from product gallery. 
**Target**: AI picks images for carousels based on tags.

**Carousel assembly logic**:
1. AI (or rule-based) selects 3-5 images of the same product
2. Diversity rules:
   - Must include at least 2 different `shot_type` tags
   - Prefer: close-up + model/lifestyle + wide/flat-lay
   - Never: 3 of the same shot type
3. Image ordering:
   - First image = highest visual impact (model or lifestyle shot — this is the cover)
   - Last image = close-up/detail (call-to-action position)
   - Middle = variety

**Integration with autopilot**:
- Autopilot decides when to post a carousel vs single image
- Rule: if a product has 3+ unused images with diverse tags → schedule as carousel
- Frequency: ~1 carousel per 4 single posts (carousels perform ~1.2x but require more content)

### 5B. Carousel Tab Changes
- Keep the manual builder for one-off carousels
- Add: "AI Suggest" button that auto-selects images for a product based on tags
- Show the diversity score: "3 shot types represented ✅" or "⚠️ All close-ups — add variety"

---

## Phase 6: Analytics Improvements

### 6A. Fix Insights Sync
- Debug and fix the `instagram-insights` edge function
- Ensure `instagram_media_id` is saved when a post is published
- Set up or verify the insights sync cron job
- Make the analytics dashboard populate with real data

### 6B. Better AI Learning Loop
- Currently `postLearning.js` hardcodes `visual_score: 70` and `engagement_velocity_score: 70`
- Fix: calculate engagement velocity from time-series data (engagement at 1h, 6h, 24h)
- Feed the image tags into the learning system so AI can learn which shot types perform best
- Add a "What's Working" summary card at the top of Analytics:
  - Best posting day/time
  - Best caption tone
  - Best shot type
  - Top hashtags this month

---

## Implementation Order

| Step | Task | Effort | Priority |
|------|------|--------|----------|
| 1 | Fix post analytics showing 0 (insights sync) | Medium | 🔴 High |
| 2 | Fix autopilot cron not running | Medium | 🔴 High |
| 3 | Remove Templates tab | Small | 🟢 Quick win |
| 4 | Remove AI Images tab + `imagePipeline.js` | Small | 🟢 Quick win |
| 5 | Remove Queue tab, add list view to Calendar | Medium | 🟡 Medium |
| 6 | Revamp Assets → Image Pool (upload + new UI) | Medium | 🟡 Medium |
| 7 | Add image tagging system | Medium | 🟡 Medium |
| 8 | Make autopilot data-driven (remove manual picks) | Large | 🟡 Medium |
| 9 | Automate resurface old hits | Medium | 🟡 Medium |
| 10 | Smart carousel assembly from tags | Large | 🟠 Lower |
| 11 | Analytics improvements + learning loop fixes | Medium | 🟠 Lower |

**Suggested sprint grouping**:
- **Sprint 1** (Steps 1-4): Fix broken things + remove dead code — gets the page functional and clean
- **Sprint 2** (Steps 5-7): UI restructure + Image Pool — new upload workflow
- **Sprint 3** (Steps 8-9): Autopilot revamp — fully automated posting
- **Sprint 4** (Steps 10-11): Smart carousels + analytics polish

---

## Files Affected Summary

### Remove
| File | Reason |
|------|--------|
| `js/admin/social/imagePipeline.js` | AI Images tab removed |

### Modify Heavily
| File | Changes |
|------|---------|
| `pages/admin/social.html` | Remove 3 tabs (Queue, Templates, AI Images), revamp Assets/Auto-Queue tabs, add calendar list toggle |
| `js/admin/social/index.js` | Remove queue/template/AI image handlers, add image upload/tagging, revamp autopilot UI |
| `js/admin/social/api.js` | Add image pool queries, tagging CRUD, unused image queries |

### Modify Lightly
| File | Changes |
|------|---------|
| `js/admin/social/calendar.js` | Add list/queue view mode |
| `js/admin/social/captions.js` | Remove template dependency, lean fully on learned patterns |
| `js/admin/social/postLearning.js` | Fix hardcoded scores, add image tag analysis |
| `css/pages/admin/social.css` | New styles for Image Pool grid, upload zone, tag badges |

### Edge Functions
| Function | Change |
|----------|--------|
| `instagram-insights` | Debug & fix data write-back |
| `autopilot-fill` | Fix variation_id constraint, add image pool selection, add auto-resurface logic |
| `process-scheduled-posts` | Remove excessive debug logging |
| `auto-queue` | Use data-driven times/tones instead of manual params |
| `generate-social-image` | Leave deployed but unused (can delete later) |

### Database
| Change | Details |
|--------|---------|
| Add columns to `social_assets` | `tags JSONB DEFAULT '[]'`, `used_count INT DEFAULT 0` |
| Optional: add `product_id` to `social_assets` | If not already linked via `social_variations` |
| Social settings | Update autopilot config schema for auto-resurface toggle |

---

## Open Questions

1. **Pinterest production**: When do we want to move Pinterest from sandbox to production? Requires app review from Pinterest.
2. **Facebook posting**: Is Facebook posting working or also broken? Same token refresh chain as Instagram.
3. **Reels/Video**: Any interest in video content (Reels) in the future? Would need a different pipeline.
4. **Cross-posting strategy**: Should AI vary captions per platform (IG caption vs Pinterest description vs FB post) or use the same?
5. **Image pool storage**: Keep using Supabase Storage `social-media` bucket, or consider a CDN for faster delivery?
