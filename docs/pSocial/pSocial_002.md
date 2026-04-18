# Social Media System Audit & Growth Roadmap

> **Created**: 2026-04-17  
> **Revised**: 2026-04-17 (GPT peer review applied — priority sequencing tightened)  
> **Scope**: Full audit of current social system + actionable improvement roadmap  
> **Goal**: Maximize growth, sales, and social media presence for Karry Kraze

---

## Peer Review Notes

### Round 1 (GPT-4o) — Score: 8.5 / 10
**Strengths**: Accurate diagnosis, good ideas, strong awareness of modern social algorithms  
**Weakness**: Original roadmap mixed immediate fixes with late-stage scaling systems, over-engineered 13-sprint plan

**Key corrections applied**:
- Separated "do now" vs "nice later" more clearly
- Engagement automation (auto-reply, DM bots) flagged as **too early** — start manual/semi-assisted first
- Paid ads (Meta Ads API, Google Ads, auto-boost) flagged as **premature** — need proven creatives + baseline engagement first
- Competitor scraping and complex dashboards are **not revenue-moving** right now
- Meta Pixel is NOT "ads" — it's passive audience data collection (keep as quick win)
- Core insight: **"You don't need more tools. You need better wiring between what you already have."**

### Round 2 (GPT-4o) — Score: 9.3 / 10
**Verdict**: "Ready to execute. This turns your system into a compounding engine."

**What improved**: Priority tiers clean, Phase 1 is strongest section, overengineering eliminated, Reels strategy correct, "Comment KK" trust fix good.

**Remaining tightening applied**:
- Phase 1 broken into **1A → 1B → 1C** sub-phases to reduce execution friction (was too much for "Week 1")
- Reels MVP simplified further — start with **1 image → 3-5 sec loop**, not a full slideshow pipeline
- Engagement section upgraded — add directional guidance ("go interact with X"), not just tools
- Phase 3 low-ROI items flagged: seasonal calendar, YouTube Shorts, X/Twitter are **distractions at this stage**

**Revised priority tiers**:
- 🥇 **Phase 1A (DAY 1-2)**: Hashtags + posting times (wire the learning loop)
- 🥇 **Phase 1B (DAY 3-4)**: AI captions + learning trigger
- 🥇 **Phase 1C (DAY 5)**: UTM tracking + Meta Pixel + fix "Comment KK"
- 🥈 **Phase 2 (NEXT)**: Simple Reels, light engagement, growth tracking
- 🥉 **Phase 3 (LATER)**: A/B testing, content pillars, TikTok
- 🚫 **Phase 4 (NOT YET)**: Full engagement automation, paid ads, competitor scraping

---

## Part 1: Current System Audit

### What We Have (the good)

| System | Status | Assessment |
|--------|--------|------------|
| Instagram posting (single + carousel) | ✅ Live | Working. 43 posts published. 2x/day autopilot. |
| Facebook posting (via Instagram OAuth) | ✅ Live | Auto-mirrors Instagram posts. |
| Pinterest posting | ⚠️ Sandbox | Not publicly visible. Needs prod API approval. |
| Autopilot (daily queue fill) | ✅ Live | Runs 2 AM UTC. Fills queue for next 3 days. |
| Auto-queue (50+ caption templates) | ✅ Live | 8 tones, confidence scoring, product priority. |
| AI learning engine | ✅ Live | Tracks hashtag/time/caption performance. Feeds into product priority scoring. |
| AI image generation (GPT img2img) | ✅ Deployed | 18.9M scene combos, quality scoring. |
| Image pool (asset tagging) | ✅ Live | Shot types, quality, usage tracking. |
| Instagram insights sync | ✅ Live | Every 6 hours via cron. |
| Token auto-refresh | ✅ Live | Daily 3 AM UTC for IG/FB/Pinterest. |
| SMS marketing (Twilio) | ✅ Live | Subscribe, welcome series, abandoned cart, coupon reminders. |
| Carousel builder | ✅ Live | Multi-image posts, engagement scoring. |

### What's Broken or Underperforming

| # | Issue | Impact | Detail |
|---|-------|--------|--------|
| 1 | **Learning data doesn't feed into hashtags** | 🔴 High | Auto-queue uses static `social_category_hashtags` table. Top-performing hashtags from `hashtag_performance` are tracked but never injected into new posts. System knows `#bunnybeanie` gets 60% engagement but keeps using generic `#fashion #style` instead. |
| 2 | **Learning data doesn't feed into posting times** | 🔴 High | Needs 20+ samples per time slot before data-driven times kick in. With 43 posts spread across 18 slots, most slots have 1-2 samples. Autopilot is using hardcoded `["09:00", "17:00"]` instead of learned peak times (Tuesday 5pm = 50% engagement). |
| 3 | **Captions are template-only** | 🟠 Medium | Auto-queue picks from 50+ templates and does `{product_name}` replacement. The `ai-generate` edge function CAN write AI captions with learning context, but auto-queue never calls it. AI captions are only used in manual post creation. |
| 4 | **No engagement / interaction** | 🔴 High | System posts but never engages. No comment replies, no DM automation, no story engagement. Instagram algorithm heavily punishes accounts that post but don't interact. |
| 5 | **Pinterest is dead** | 🟡 Medium | Still on sandbox API. Pins aren't publicly visible. Wasted effort generating Pinterest posts. |
| 6 | **No video/Reels support** | 🔴 High | Instagram's algorithm in 2026 heavily favors Reels (3-10x more reach than images). System only posts images. |
| 7 | **No story support** | 🟠 Medium | Instagram stories get 5-10x the views of feed posts. No story scheduling or templates. |
| 8 | **Facebook posts have 0 engagement** | 🟡 Low | Every FB post shows 0 likes, 0 comments, 0 reach. Likely not reaching anyone. FB organic reach is near-zero without paid boost. |
| 9 | **No cross-platform analytics** | 🟡 Medium | Only Instagram insights are tracked. Facebook engagement and Pinterest analytics are blind spots. |
| 10 | **Templates tab is hidden** | ⚪ None | Wastes DB space. If keeping it as fallback, fine. But the UI button is hidden. |

### Admin UI Tab Assessment

| Tab | Verdict | Notes |
|-----|---------|-------|
| 📅 Calendar | ✅ Keep | Core feature. Good visual overview. |
| 📋 Queue | ✅ Keep | Essential for reviewing upcoming posts. |
| 🖼️ Image Pool | ✅ Keep | Core workflow for asset management. |
| ✏️ Templates | ❓ Remove or repurpose | Hidden, not actively used. Templates are hardcoded in auto-queue anyway. Either expose it to edit templates or remove. |
| 📌 Boards | ⚠️ Dormant | Pinterest is sandbox-only. Useless until Pinterest goes live. |
| ⚡ Auto-Queue | ✅ Keep | But needs AI caption integration. |
| 📊 Analytics | ✅ Keep + expand | Needs cross-platform data, trend graphs, competitor insights. |
| 🎠 Carousel | ✅ Keep | Working well. |

---

## Part 2: Improvement Roadmap

---

## 🥇 PHASE 1 — DO NOW (Wire What We Already Built)

---

### Phase 1A (Day 1-2): Hashtags + Posting Times
> **Priority**: 🔴 CRITICAL — this is the #1 thing holding the system back  
> **Effort**: Half a day  
> **Why**: The AI brain exists, the memory exists, but they aren't connected. Every post is equally dumb right now.  
> **Scope**: Just the data wiring — hashtags and times. No AI generation, no tracking, no UI.

#### 4.1 — Smart Hashtag Injection

**Problem**: Auto-queue uses static `social_category_hashtags` table. The `hashtag_performance` table knows `#bunnybeanie` gets 60% engagement but auto-queue keeps using generic `#fashion #style #accessories`.

**Implementation**:

File: `supabase/functions/auto-queue/index.ts`

```
Current flow:
  product → lookup social_category_hashtags → use those hashtags

New flow:
  product → lookup social_category_hashtags (base set)
          → query hashtag_performance WHERE category matches AND avg_engagement_rate > overall_avg
          → merge: 1 branded (#karrykraze) + 2-3 top-performing + 1-2 category defaults
          → cap at 5 total (learned optimal count, confidence 90%)
```

Steps:
1. In `auto-queue/index.ts`, after fetching `hashtagRows` from `social_category_hashtags`, add a query:
   ```sql
   SELECT hashtag, avg_engagement_rate
   FROM hashtag_performance
   WHERE avg_engagement_rate > 15
     AND times_used >= 2
   ORDER BY avg_engagement_rate DESC
   LIMIT 10
   ```
2. Build a merge function: `mergeHashtags(categoryHashtags, topPerformers, branded)`
   - Always include `#karrykraze`
   - Pick 2-3 from `topPerformers` that relate to the product category
   - Fill remaining slots from `categoryHashtags`
   - Cap at 5 total
3. Add `social_settings` key `hashtag_strategy`:
   ```json
   {
     "use_learning": true,
     "max_count": 5,
     "branded_count": 1,
     "top_performer_count": 2,
     "category_fill_count": 2
   }
   ```
4. Redeploy: `echo y | npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq`

**Test**: Generate a post via auto-queue, verify hashtags include top performers from `hashtag_performance` instead of only generic category tags.

---

### Phase 1B (Day 3-4): AI Captions + Learning Trigger
> **Priority**: 🔴 CRITICAL  
> **Effort**: Half a day  
> **Why**: With hashtags and times wired (1A), now make the captions smarter and keep the brain learning continuously.

#### 4.2 — AI-Powered Captions in Auto-Queue

**Problem**: Auto-queue picks from 50+ hardcoded templates and does `{product_name}` replacement. The `ai-generate` edge function CAN write AI captions with full learning context, but auto-queue never calls it.

**Implementation**:

File: `supabase/functions/auto-queue/index.ts`

```
Current flow:
  pick random tone → pick random template → replace {product_name}, {category}, {link}

New flow:
  try: call ai-generate with type=caption, pass product + learning context
  catch: fallback to template (rate limit, failure, etc.)
```

Steps:
1. After product selection in auto-queue, before post creation, add AI caption generation:
   ```ts
   // Try AI caption first
   let caption = "";
   let captionSource = "template";
   try {
     const aiUrl = `${supabaseUrl}/functions/v1/ai-generate`;
     const aiResp = await fetch(aiUrl, {
       method: "POST",
       headers: { "Authorization": `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
       body: JSON.stringify({
         type: "caption",
         product_name: product.name,
         category: categoryName,
         platform: platform,
         tone: pickRandom(tones),
         hashtags: mergedHashtags, // from 4.1
       })
     });
     const aiResult = await aiResp.json();
     if (aiResult.caption && aiResult.caption.length > 30) {
       caption = aiResult.caption;
       captionSource = "ai_generated";
     }
   } catch (e) {
     console.log("[auto-queue] AI caption failed, using template fallback");
   }
   
   // Fallback to template
   if (!caption) {
     caption = generateCaption(pickRandom(CAPTION_TEMPLATES[tone]), product, platform);
     captionSource = "template";
   }
   ```
2. Store `caption_source` in post metadata (`selection_metadata` JSONB field) for A/B tracking:
   ```ts
   selection_metadata: {
     ...existingMetadata,
     caption_source: captionSource, // "ai_generated" or "template"
   }
   ```
3. Redeploy auto-queue

**A/B tracking** (future Sprint 12, but prep data now):
- Every post records `caption_source` in `selection_metadata`
- In analytics, compare avg engagement for `ai_generated` vs `template` posts
- After 50+ posts of each type, auto-weight toward the winner

**Test**: Run auto-queue, check that some posts get AI-written captions. Verify `selection_metadata.caption_source` is set.

---

#### 4.3 — Posting Time Optimization

**Problem**: Data-driven time selection requires 20+ total samples across all time slots. With 43 posts across 18 slots, most individual slots have 1-2 posts — but the *aggregate* pattern is clear (Tuesday 5pm = 50% engagement). The system ignores this and uses hardcoded `["09:00", "17:00"]`.

**Implementation**:

File: `supabase/functions/auto-queue/index.ts`

Two changes:

**Change 1: Lower the threshold**
```ts
// Current:
const useDataDrivenTimes = totalTimeSamples >= 20;

// New:
const useDataDrivenTimes = totalTimeSamples >= 10;
```

**Change 2: Use learned patterns as fallback priors**

When `totalTimeSamples < 10`, instead of using hardcoded `[10, 14, 18]`, query `post_learning_patterns` for the `best_general_time` and `best_day` patterns (both have confidence 80-85%):

```ts
// If not enough raw samples, use learned priors
if (!useDataDrivenTimes) {
  const { data: timingPatterns } = await supabase
    .from("post_learning_patterns")
    .select("pattern_key, pattern_value")
    .eq("pattern_type", "timing")
    .in("pattern_key", ["best_general_time", "best_day"]);

  const bestHour = timingPatterns?.find(p => p.pattern_key === "best_general_time")
    ?.pattern_value?.hour;
  const bestDay = timingPatterns?.find(p => p.pattern_key === "best_day")
    ?.pattern_value?.day;

  if (bestHour !== undefined) {
    peakHours = [bestHour, bestHour + 5 > 23 ? bestHour - 5 : bestHour + 5]; // two slots
  }
}
```

**Test**: With current 43 posts, data-driven times should now activate. Verify queued posts schedule at learned peak times instead of 9am/5pm.

---

#### 4.4 — Auto-Refine After Insights Sync

**Problem**: `instagram-insights` runs every 6h but only updates engagement numbers. It doesn't trigger any re-learning.

**Implementation**:

File: `supabase/functions/instagram-insights/index.ts`

At the end of the insights sync (after all posts are updated), add a call to the learning aggregation:

```ts
// After updating all post metrics...
// Trigger mini-learning update
try {
  const autoQueueUrl = `${supabaseUrl}/functions/v1/auto-queue`;
  // auto-queue already has runLearningAggregation() built in
  // We can call it with count=0, preview=true to trigger learning only
  await fetch(autoQueueUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ count: 0, preview: true, learning_only: true })
  });
  console.log("[insights] Triggered learning aggregation after sync");
} catch (e) {
  console.warn("[insights] Learning aggregation trigger failed:", e);
}
```

Then in `auto-queue/index.ts`, add early return for `learning_only`:
```ts
const { learning_only = false } = body;
if (learning_only) {
  await runLearningAggregation(supabase);
  return new Response(JSON.stringify({ success: true, message: "Learning aggregation complete" }), ...);
}
```

**Redeploy**: Both `instagram-insights` and `auto-queue`.

**Test**: Manually call instagram-insights, verify `hashtag_performance` and `posting_time_performance` tables update afterward.

---

---

### Phase 1C (Day 5): Tracking + Trust Fix
> **Priority**: 🟢 Quick wins  
> **Effort**: 1-2 hours total  
> **Why**: Low effort, high signal. UTM unlocks revenue attribution. Pixel starts collecting audience data. Fixing "Comment KK" stops actively damaging trust.

### Sprint 4.5: UTM Tracking + Meta Pixel (Quick Wins)
> **Priority**: 🟢 Easy wins, do alongside Sprint 4  
> **Effort**: 30 minutes each

#### 4.5.1 — UTM Parameters on All Social Links

**Problem**: No way to know which social posts drive actual website visits or sales.

**Implementation**:

File: `supabase/functions/auto-queue/index.ts`

In the `generateCaption()` function, modify the link replacement:

```ts
// Current:
caption = caption.replace(
  /{link}/g,
  `https://karrykraze.com/pages/product.html?slug=${product.slug}`
);

// New:
const utmLink = `https://karrykraze.com/pages/product.html?slug=${product.slug}`
  + `&utm_source=${platform}`
  + `&utm_medium=social`
  + `&utm_campaign=autopilot`
  + `&utm_content=${product.slug}`;
caption = caption.replace(/{link}/g, utmLink);
```

Also for Instagram (link in bio), store the UTM link in `social_posts.link_url` so when you update the bio link, it has tracking:
```ts
link_url: `https://karrykraze.com/pages/product.html?slug=${product.slug}&utm_source=${platform}&utm_medium=social&utm_campaign=autopilot`
```

**Revenue attribution** (future enhancement):
- In `stripe-webhook`, check if the order's referring URL has `utm_source=instagram`
- Store `social_post_id` in order metadata
- Dashboard query: `SELECT SUM(order_total) FROM orders WHERE utm_source = 'instagram' GROUP BY utm_content`

**Redeploy**: auto-queue.

---

#### 4.5.2 — Meta Pixel Installation

**Not ads** — this just passively collects data about who visits the site, which products they view, what they add to cart. This audience data becomes valuable later when you're ready for retargeting.

**Implementation**:

File: Create `page_inserts/meta-pixel.html` (partial):
```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
```

Steps:
1. Go to Meta Business Suite → Events Manager → Create Pixel → get Pixel ID
2. Add pixel snippet to all public pages (index.html, catalog.html, product.html, etc.)
3. Add event tracking on key actions:
   - `fbq('track', 'ViewContent')` on product page load
   - `fbq('track', 'AddToCart')` on add-to-cart click
   - `fbq('track', 'InitiateCheckout')` on checkout start
   - `fbq('track', 'Purchase', {value: X, currency: 'USD'})` on success page

**Note**: This requires a Meta Business account and pixel creation — 10-minute setup on Meta's side.

---

## 🥈 PHASE 2 — NEXT (After Learning Loop is Live)

---

### Sprint 5: Simple Reels (Image → Slideshow Video)
> **Priority**: 🟠 HIGH — biggest reach multiplier  
> **Effort**: 3-4 sessions  
> **When**: After Sprint 4 is live and generating smarter posts  
> **GPT note**: "Do NOT overbuild. Start with image → slideshow → post."

#### 5.1 — Slideshow Reels from Image Pool (MVP Approach)

**Problem**: Instagram's algorithm in 2026 gives Reels 3-10x more organic reach than static images. We only post images.

**MVP Implementation** (start dead simple — expand later):

**Step 0 — Absolute minimum viable Reel (do this FIRST):**

Before building any pipeline, test the concept manually:
1. Take 1 product image
2. Use browser Canvas to add a slow Ken Burns zoom (3-5 second loop)
3. Export as video via MediaRecorder
4. Post as Reel via API
5. Compare reach to a static image post of the same product

This validates the premise ("do Reels actually get more reach for us?") before investing in a full slideshow builder.

**Step 1 — Simple Reel Builder (after Step 0 validates):**

File: New `js/admin/social/reelBuilder.js`

Use the browser's Canvas + MediaRecorder API:
```
1. Load 3-5 product images onto an HTML canvas (1080x1920, 9:16)
2. For each image:
   - Draw image to canvas (cover-fit to 1080x1920)
   - Apply slow Ken Burns zoom (scale 1.0 → 1.1 over 3 seconds)
   - Add text overlay: product name + price (white text, drop shadow)
3. Final frame: "Link in Bio 🔗" + "@karrykraze" branded
4. Record canvas as WebM/MP4 using MediaRecorder
5. Upload to Supabase Storage `social-media/reels/`
6. Total duration: 15-20 seconds (3-5 images × 3-4 sec each)
```

**Option B: Edge function with FFmpeg (more reliable)**

File: New `supabase/functions/generate-reel/index.ts`

```
1. Accept: product_id, image_urls[], text_overlays[]
2. Download images to temp dir
3. FFmpeg command:
   ffmpeg -loop 1 -i img1.jpg -loop 1 -i img2.jpg ... \
     -filter_complex "
       [0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,
            zoompan=z='min(zoom+0.001,1.1)':d=90:s=1080x1920[v0];
       [1:v]scale=1080:1920:...,zoompan=...[v1];
       [v0][v1]concat=n=2:v=1:a=0[out]
     " -map "[out]" -t 15 -c:v libx264 -pix_fmt yuv420p output.mp4
4. Upload output.mp4 to Supabase Storage
5. Return public URL
```

**Recommendation**: Start with **Step 0** (single image loop). If it gets 2x+ the reach of static posts, build **Step 1** (slideshow). Skip Option B (FFmpeg edge function) entirely unless client-side quality is unacceptable.

**New UI element**:
- Add "Create Reel" button next to "New Post" in social admin
- Opens Reel Builder: select product → select 3-5 images from pool → preview → generate → schedule

---

#### 5.2 — Product Showcase Reel Template

Trending Instagram Reel format — text on screen, no voiceover:

```
Frame 1 (0-3s):  Hook text — "This [category] is going viral 🔥" (Ken Burns zoom on hero image)
Frame 2 (3-6s):  Product name + price overlay on product image
Frame 3 (6-9s):  Feature bullets (2-3 key selling points, auto from product description)
Frame 4 (9-12s): Customer quote or review snippet (if available from reviews table)
Frame 5 (12-15s): CTA — "Link in bio! 🔗 @karrykraze"
```

GPT writes the hook and feature bullets:
```ts
const hookPrompt = `Write a 5-word attention hook for an Instagram Reel about ${product.name} (${category}). 
Format: "[Hook] 🔥". Examples: "This bag is going viral 🔥", "POV: your new obsession 👀"`;
```

---

#### 5.3 — Instagram Reels API Posting

File: New `supabase/functions/instagram-reel/index.ts`

Instagram Content Publishing API for Reels:
```ts
// Step 1: Create media container
const createResp = await fetch(
  `https://graph.facebook.com/v18.0/${igUserId}/media`,
  {
    method: "POST",
    body: JSON.stringify({
      media_type: "REELS",
      video_url: publicVideoUrl,  // Must be public HTTPS URL
      caption: caption,
      share_to_feed: true,
    })
  }
);
const { id: containerId } = await createResp.json();

// Step 2: Wait for processing (poll status)
// Instagram processes the video — can take 30-60 seconds
let status = "IN_PROGRESS";
while (status === "IN_PROGRESS") {
  await new Promise(r => setTimeout(r, 5000));
  const statusResp = await fetch(`https://graph.facebook.com/v18.0/${containerId}?fields=status_code`);
  status = (await statusResp.json()).status_code;
}

// Step 3: Publish
await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
  method: "POST",
  body: JSON.stringify({ creation_id: containerId })
});
```

**Database prep** — add `content_type` to `social_posts`:
```sql
ALTER TABLE social_posts ADD COLUMN content_type TEXT DEFAULT 'image'
  CHECK (content_type IN ('image', 'carousel', 'reel', 'story'));
```

Update `process-scheduled-posts` to dispatch Reels to `instagram-reel` instead of `instagram-post`.

**Deploy**: New `instagram-reel` function + update `process-scheduled-posts`.

---

#### 5.4 — TikTok Cross-Post (Phase 3, but prep-ready)

Same 9:16 video from Reels → post to TikTok. Defer OAuth and edge function until Phase 3 (Sprint 11.1). But the video generation pipeline from 5.1 already produces TikTok-compatible format.

---

### Sprint 6: Light Engagement Layer
> **Priority**: 🟠 HIGH — but start MANUAL, not automated  
> **Effort**: 1-2 sessions  
> **GPT note**: "Not automation — just reply to comments, occasional DM responses, maybe simple reminders in admin."

#### 6.1 — Engagement Dashboard (Admin UI)

**What**: New section in Analytics (or new tab) showing recent Instagram comments that need replies, PLUS directional guidance on who to engage with.

File: Add to `js/admin/social/analytics.js`

```
1. When analytics tab loads, fetch recent comments via Instagram Graph API:
   GET /{media-id}/comments?fields=id,text,username,timestamp

2. Display in a simple list:
   - Comment text
   - Username
   - Post it was on (thumbnail + caption preview)
   - "Reply" button → opens text input → calls POST /{comment-id}/replies
   - "Like" button → calls POST /{comment-id}/likes

3. Show unreplied count in header: "💬 3 unreplied comments"

4. 🆕 "Go Engage" section:
   - Show your top 3 recent posts by engagement rate → "These are getting traction — go reply to every comment"
   - Show 5 accounts that recently engaged with you (commenters, likers) → "Go interact with these people's content"
   - Show 5 suggested niche accounts (saved list of similar fashion/accessory accounts) → "Spend 10 min engaging with these feeds"
   - Simple timer: "Engagement session: 15 min" → starts when you click "Start Engaging"
```

The "Go Engage" section turns the dashboard from passive ("here are your comments") into active ("here's what to do right now").

**Note**: This requires `instagram_manage_comments` permission. Check if current token scope includes it. If not, need to re-OAuth with expanded scopes.

**Manual engagement reminders**:
- After a post is published, show a notification: "Your post just went live! Spend 10 min engaging with similar accounts"
- Can be a simple browser notification via PWA push system (already built)

---

#### 6.2 — Comment KK → Coupon (Fix the Broken Promise)

**Problem**: Every Instagram caption says "Comment KK for a discount! 💕" but nothing happens when someone comments KK. This is worse than not having the CTA at all — it actively damages trust.

**Two options**:

**Option A: Remove the CTA (5 minutes)**
- Delete the line from all caption templates in `auto-queue/index.ts`
- Change Instagram CTA to just: `🔗 Link in bio!`
- This is the honest option if we're not going to build the DM system yet

**Option B: Build the DM coupon flow (requires Meta App Review)**

File: New `supabase/functions/instagram-comment-monitor/index.ts`

```
Cron: every 15 minutes (or piggyback on instagram-insights every 6h)

1. Fetch recent comments on posts from last 7 days:
   GET /{media-id}/comments?fields=id,text,username,timestamp

2. For each comment containing "KK" (case-insensitive):
   a. Check if we already processed this comment (store in social_comment_actions table)
   b. Generate unique coupon code (reuse sms-subscribe coupon logic)
   c. Create promotion in DB (reuse existing promotions system)
   d. Send DM via Instagram Messenger API:
      POST /{ig-user-id}/messages
      body: { recipient: { id: commenter_ig_id }, message: { text: "Thanks for commenting! 🎉 Here's your exclusive 10% off code: KK-XXXXX. Shop at karrykraze.com and use it at checkout! 💕" }}

3. Log action in social_comment_actions table:
   comment_id, action (coupon_sent), coupon_code, created_at
```

**Requirements**:
- Instagram Messenger API access → needs Meta App Review
- `instagram_manage_messages` permission
- This is a 2-4 week approval process from Meta

**Recommendation**: Do Option A now (remove the false promise), plan Option B for Phase 3 after Meta App Review.

---

#### 6.3 — Instagram Stories (Simple Version)

File: New `supabase/functions/instagram-story/index.ts`

Instagram Graph API supports stories:
```ts
// Create story container
const resp = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media`, {
  method: "POST",
  body: JSON.stringify({
    media_type: "STORIES",
    image_url: publicImageUrl,  // or video_url for video stories
  })
});
// Publish
await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
  method: "POST",
  body: JSON.stringify({ creation_id: containerId })
});
```

**Story autopilot** — add to `autopilot-fill`:
- Schedule 2-3 stories per day (separate from feed posts)
- Pull from image pool assets that have `quality_score >= 3` but aren't "hero shot" quality
- Add text overlay: product name + price (client-side canvas before upload)
- Stories are casual — lower quality bar than feed posts

**No stickers/polls/countdowns** via API — Instagram API doesn't support interactive story elements. Those remain manual.

---

### Sprint 7: Growth Tracking + Simple Analytics
> **Priority**: 🟡 MEDIUM — can't improve what you can't measure  
> **Effort**: 1-2 sessions

#### 7.1 — Daily Follower Count Tracking

File: Modify `supabase/functions/instagram-insights/index.ts`

Add to the existing insights sync cron:
```ts
// Fetch account-level metrics
const accountResp = await fetch(
  `https://graph.facebook.com/v18.0/${igUserId}?fields=followers_count,media_count`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const accountData = await accountResp.json();

// Upsert daily metric
await supabase.from("social_metrics_daily").upsert({
  date: new Date().toISOString().split("T")[0],
  platform: "instagram",
  followers: accountData.followers_count,
  total_posts: accountData.media_count,
}, { onConflict: "date,platform" });
```

**New table**:
```sql
CREATE TABLE social_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  platform TEXT NOT NULL DEFAULT 'instagram',
  followers INTEGER,
  total_posts INTEGER,
  total_reach INTEGER,
  total_engagement INTEGER,
  avg_engagement_rate DECIMAL(5,2),
  UNIQUE(date, platform)
);
```

**UI**: Simple line chart in Analytics tab showing followers over time. Use a lightweight chart library (Chart.js via CDN).

---

#### 7.2 — Best Time to Post Heat Map

**Data already exists** in `posting_time_performance`. Just needs visualization.

File: Add to `js/admin/social/analytics.js`

```
1. Fetch all rows from posting_time_performance
2. Build a 7×24 grid (days × hours)
3. Color each cell by avg_engagement_rate:
   - Green (#22c55e): > 30% engagement
   - Yellow (#eab308): 15-30%
   - Gray (#6b7280): < 15%
   - Empty (#1f2937): no data
4. Render as a simple HTML table with colored cells
5. Show in Analytics tab → "Best Times" section
```

This is a pure frontend component — no new edge functions needed.

---

## 🥉 PHASE 3 — LATER (After Organic System is Validated)

> **When**: After 100+ posts with learning loop active, engagement trending up, Reels producing reach  
> **GPT note**: "Only after data grows"

---

### Sprint 8: Content Strategy Expansion

#### 8.1 — Content Pillars System

**Problem**: Feed is 100% product shots. Monotonous. Instagram algorithm rewards content variety.

**Pillars**:
| Pillar | % of Posts | Content Type | Implementation |
|--------|-----------|-------------|---------------|
| Product Showcase | 40% | Hero shots, new arrivals | Current system (already doing this) |
| Lifestyle/OOTD | 20% | AI-generated lifestyle images | Already have `generate-social-image` |
| Educational/Tips | 15% | "How to style", "Care guide" | GPT generates from product data |
| Social Proof | 15% | Customer reviews, UGC, testimonials | Pull from `reviews` table |
| Behind-the-Scenes | 10% | Shipping day, packaging, warehouse | Manual uploads to image pool |

**Implementation**:

Add `content_pillar` to `social_posts`:
```sql
ALTER TABLE social_posts ADD COLUMN content_pillar TEXT
  CHECK (content_pillar IN ('product', 'lifestyle', 'educational', 'social_proof', 'bts'));
```

In `auto-queue/index.ts`, track pillar distribution for last 7 days:
```ts
const { data: recentPillars } = await supabase
  .from("social_posts")
  .select("content_pillar")
  .in("status", ["queued", "posted"])
  .gte("scheduled_for", sevenDaysAgo);

const pillarCounts = { product: 0, lifestyle: 0, educational: 0, social_proof: 0, bts: 0 };
recentPillars?.forEach(p => { if (p.content_pillar) pillarCounts[p.content_pillar]++; });

// Pick the most underrepresented pillar
const targetRatios = { product: 0.40, lifestyle: 0.20, educational: 0.15, social_proof: 0.15, bts: 0.10 };
// ... select pillar with largest deficit
```

For `educational` pillar, call `ai-generate` with new type:
```json
{
  "type": "educational",
  "product_name": "Hello Kitty Jean Shoulder Bag",
  "category": "bags",
  "prompt": "Write a short educational Instagram post about how to style a jean shoulder bag for different occasions. Include 3 outfit ideas."
}
```

For `social_proof` pillar, pull recent 5-star reviews:
```ts
const { data: topReviews } = await supabase
  .from("reviews")
  .select("content, rating, reviewer_name, product_id")
  .eq("status", "approved")
  .eq("rating", 5)
  .order("created_at", { ascending: false })
  .limit(10);
```

---

#### 8.2 — Seasonal Content Calendar

> ⚠️ **Low-ROI at current stage** — nice structure but won't move the needle until posting volume + engagement are up. Don't let this distract from Phase 1-2.

**Implementation**: Add a `seasonal_events` table or settings key:
```json
{
  "seasonal_calendar": {
    "2026-02-14": { "event": "Valentine's Day", "themes": ["gift guide", "love", "couples"], "boost_categories": ["jewelry", "accessories"] },
    "2026-05-11": { "event": "Mother's Day", "themes": ["gift for mom", "treat yourself"], "boost_categories": ["bags", "jewelry"] },
    "2026-10-31": { "event": "Halloween", "themes": ["spooky", "costume"], "boost_categories": ["accessories", "plushies"] },
    "2026-11-29": { "event": "Black Friday", "themes": ["sale", "deals", "limited"], "boost_categories": ["all"] },
    "2026-12-25": { "event": "Christmas", "themes": ["gift guide", "holiday"], "boost_categories": ["all"] }
  }
}
```

In auto-queue, 7 days before an event:
- Switch caption tone to event-themed
- Boost products in matching categories
- Generate themed captions: "Valentine's Day Gift Guide 💝 [product_name]"

---

### Sprint 9: A/B Testing Framework

#### 9.1 — Automatic A/B Testing

**When to build**: After 100+ posts, when you have enough data volume to detect meaningful differences.

**Implementation**:

New table:
```sql
CREATE TABLE ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_a_post_id UUID REFERENCES social_posts(id),
  variant_b_post_id UUID REFERENCES social_posts(id),
  test_variable TEXT NOT NULL, -- 'caption_source', 'hashtag_strategy', 'posting_time', 'content_pillar'
  variant_a_value TEXT,
  variant_b_value TEXT,
  winner TEXT, -- 'a', 'b', 'tie', NULL (pending)
  metric TEXT DEFAULT 'engagement_rate',
  started_at TIMESTAMPTZ DEFAULT now(),
  evaluated_at TIMESTAMPTZ,
  UNIQUE(variant_a_post_id, variant_b_post_id)
);
```

In auto-queue, every 5th post pair gets A/B tested:
```ts
// Every 5th pair: same product, different caption source
if (postIndex % 5 === 0) {
  // Generate variant A with AI caption
  // Generate variant B with template caption
  // Schedule both at similar times on different days
  // Record in ab_tests table
}
```

After 48h, `instagram-insights` checks the test:
```ts
const { data: pendingTests } = await supabase
  .from("ab_tests")
  .select("*")
  .is("winner", null)
  .lt("started_at", fortyEightHoursAgo);

for (const test of pendingTests) {
  const engA = postEngagement(test.variant_a_post_id);
  const engB = postEngagement(test.variant_b_post_id);
  const winner = engA > engB * 1.1 ? 'a' : engB > engA * 1.1 ? 'b' : 'tie';
  await supabase.from("ab_tests").update({ winner, evaluated_at: now }).eq("id", test.id);
}
```

---

### Sprint 10: Platform Expansion

#### 10.1 — TikTok Integration

**Why**: TikTok's organic reach for small accounts is still massive in 2026. Same 9:16 content from Reels works.

**Implementation**:

1. **TikTok Developer Account**: Register at developers.tiktok.com
2. **OAuth flow**: New `supabase/functions/tiktok-oauth/index.ts`
   ```ts
   // TikTok OAuth 2.0
   // Scopes: video.publish, video.upload
   // Redirect: https://karrykraze.com/pages/admin/social.html
   ```
3. **Video posting**: New `supabase/functions/tiktok-post/index.ts`
   ```ts
   // TikTok Content Posting API
   // Step 1: Initialize upload
   POST https://open.tiktokapis.com/v2/post/publish/video/init/
   // Step 2: Upload video to upload_url
   // Step 3: Publish
   ```
4. **Auto-queue update**: Add `"tiktok"` to supported platforms
5. **Admin UI**: Add TikTok connection button + analytics section

**TikTok Shop** (bonus): If approved for TikTok Shop, link products directly in videos.

---

#### 10.2 — Pinterest Production API

**Status**: Currently sandbox. Pins aren't publicly visible.

**Steps**:
1. Apply for Pinterest production access (pinterest.com/developer)
2. Once approved, change API base URL from `api-sandbox.pinterest.com` to `api.pinterest.com`
3. Update `pinterest-oauth/index.ts` and `pinterest-post/index.ts`
4. Enable Rich Pins: add product metadata to karrykraze.com pages (`<meta>` tags)
5. Unhide the Boards tab in social admin

---

#### 10.3 — YouTube Shorts

> ⚠️ **Low-ROI at current stage** — another platform to maintain with minimal audience crossover. Only pursue after Instagram + TikTok are producing consistent results.

Same 9:16 video from Reels/TikTok → post to YouTube Shorts.

**Implementation**:
1. YouTube Data API v3 OAuth
2. New `supabase/functions/youtube-short/index.ts`:
   ```ts
   // Upload video with snippet:
   // title: product name + hook
   // description: product link + hashtags
   // categoryId: 26 (Howto & Style)
   // Set as "Short" by having video < 60 seconds + 9:16 aspect ratio
   ```
3. YouTube is a search engine — product names in title = long-tail organic discovery

---

### Sprint 11: Advanced Automation

#### 11.1 — Dynamic Posting Frequency

**Implementation**: In `autopilot-fill/index.ts`:

```ts
// Calculate 7-day engagement trend
const { data: recentPosts } = await supabase
  .from("social_posts")
  .select("engagement_rate, posted_at")
  .eq("status", "posted")
  .gte("posted_at", sevenDaysAgo)
  .order("posted_at", { ascending: true });

const avgEngagement = average(recentPosts.map(p => p.engagement_rate));
const prevWeekAvg = // ... previous 7 days

const trend = (avgEngagement - prevWeekAvg) / prevWeekAvg;

// Adjust posting frequency
if (trend > 0.2) {
  // Engagement climbing 20%+ → increase to 3 posts/day (momentum)
  settings.posts_per_day = Math.min(settings.posts_per_day + 1, 4);
} else if (trend < -0.2) {
  // Engagement dropping 20%+ → reduce to 1 post/day (quality focus)
  settings.posts_per_day = Math.max(settings.posts_per_day - 1, 1);
}
```

---

#### 11.2 — Inventory-Aware Posting

File: `supabase/functions/auto-queue/index.ts`

```ts
// In product scoring, add inventory awareness
const product = allProducts[i];
const stock = product.stock_quantity || 999;

if (stock === 0) {
  // Skip out-of-stock products entirely
  continue;
}

if (stock <= 3) {
  // Force urgency tone for low-stock items
  tone = "urgency";
  // Boost priority score by 20 points
  product._priority += 20;
}

if (stock > 0 && product.last_stock_zero_at) {
  // Back in stock! Generate restock announcement
  // ... use specific "Back in stock!" templates
}
```

---

#### 11.3 — Smart Repost Enhancement

Current `auto-repost` edge function exists but is basic.

**Enhancements**:
```ts
// Only repost above-average performers
const { data: topPosts } = await supabase
  .from("social_posts")
  .select("*")
  .eq("status", "posted")
  .gt("engagement_rate", overallAvgRate * 1.2) // 20% above average
  .lt("posted_at", thirtyDaysAgo) // At least 30 days old
  .order("engagement_rate", { ascending: false })
  .limit(5);

// Seasonal filter: only repost products relevant to current season
const currentMonth = new Date().getMonth();
const season = currentMonth >= 2 && currentMonth <= 4 ? "spring"
  : currentMonth >= 5 && currentMonth <= 7 ? "summer"
  : currentMonth >= 8 && currentMonth <= 10 ? "fall" : "winter";

// Fresh caption via AI
const freshCaption = await aiGenerate({
  type: "caption",
  product_name: post.product_name,
  angle: "repost", // "Back by popular demand", "You loved this one", "Still obsessed?"
});
```

---

### Sprint 12: Social Admin UI Polish

#### 12.1 — Dashboard Home Tab

Replace header stat cards with a proper dashboard:

```
┌─────────────────────────────────────────────┐
│  📊 DASHBOARD                               │
├──────────┬──────────┬──────────┬────────────┤
│ Today    │ This Week│ Growth   │ Revenue    │
│ 2 posted │ 14 posts │ +12 flwr │ $45 social │
│ 3 queued │ 89 reach │ +2.3%eng │ 3 orders   │
├──────────┼──────────┼──────────┼────────────┤
│ 💬 3 unreplied comments        │ Reply →    │
│ ⚡ 8 posts scheduled today     │ View →     │
│ 🏆 Top post: +356% engagement │ Boost →    │
└────────────────────────────────────────────┘
```

---

#### 12.2 — Calendar Improvements

- Color-code by platform: IG purple, FB blue, Pinterest red, TikTok black
- Color-code by content type: image white, carousel blue, reel green, story yellow
- Post preview on hover (thumbnail + first line of caption)
- Click to open full post detail (already built)

---

#### 12.3 — Tab Cleanup

| Current Tab | Action | Reason |
|-------------|--------|--------|
| Templates | **Remove** | Not used. Templates are hardcoded in auto-queue. Removes dead code. |
| Boards | **Hide** | Show "Pinterest Coming Soon" placeholder until production API. |
| Analytics | **Split** into "Analytics" + "Engagement" | Engagement dashboard (comments, DMs) deserves own tab. |
| Dashboard | **Add** | New first tab — overview of key metrics. |

---

## 🚫 PHASE 4 — NOT YET (Blocked / Premature)

These ideas are valid but premature. Revisit when monthly:
- Instagram followers > 1,000
- Engagement rate consistently > 5%
- Social posts driving measurable sales (UTM tracking live)

| Item | Why Not Now |
|------|-----------|
| Meta Ads API / auto-boost | No proven creatives yet. Need organic baseline first. Ad spend wasted without good content. |
| Google Ads / Shopping | Need product feed + merchant center setup. Do when organic traffic exists. |
| TikTok Ads (Spark Ads) | Need organic TikTok presence first. |
| Full engagement automation (auto-reply bots) | Meta API restrictions + spam risk + brand voice issues. Manual engagement is better early on. |
| Competitor scraping / analysis | Doesn't move revenue. Nice-to-know, not need-to-know. |
| Complex analytics dashboards | Simple metrics (followers, engagement, revenue) are enough for now. |

---

## Part 3: Revised Priority Matrix

### Phase 1 (DO NOW) — Wire Existing Systems

**Phase 1A (Day 1-2): Data Wiring**
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 1 | Smart hashtag injection | 4.1 | 1-2 hours | +30-50% reach (using proven hashtags) |
| 2 | Posting time optimization | 4.3 | 30 min | Posts at proven peak times |

**Phase 1B (Day 3-4): Smart Content**
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 3 | AI captions in auto-queue | 4.2 | 2-3 hours | Higher quality, varied captions |
| 4 | Auto-refine after insights | 4.4 | 1 hour | Continuous learning every 6h |

**Phase 1C (Day 5): Tracking + Trust**
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 5 | UTM tracking | 4.5.1 | 30 min | Revenue attribution unlocked |
| 6 | Meta Pixel install | 4.5.2 | 30 min | Audience data collection starts |
| 7 | Remove or fix "Comment KK" CTA | 6.2 | 5 min | Stop breaking trust |

### Phase 2 (NEXT) — Reach Multiplier
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 8 | Simple slideshow Reels | 5.1 | 3-4 sessions | 3-10x reach per post |
| 9 | Reels API posting | 5.3 | 1 session | Automated Reel scheduling |
| 10 | Light engagement (comment dashboard) | 6.1 | 1-2 sessions | Algorithm boost from interaction |
| 11 | Follower tracking + heat map | 7.1-7.2 | 1 session | Growth visibility |
| 12 | Instagram Stories | 6.3 | 1 session | Daily "activity" signal to algorithm |

### Phase 3 (LATER) — Scale & Diversify
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 13 | Content pillars + variety | 8.1 | 2 sessions | Break product-only monotony |
| 14 | A/B testing | 9.1 | 2 sessions | Data-driven content optimization |
| 15 | TikTok integration | 10.1 | 3-4 sessions | Second growth channel |
| 16 | Dynamic posting frequency | 11.1 | 1 session | Momentum riding |
| 17 | Admin UI overhaul | 12 | 2-3 sessions | Better workflow efficiency |
| | ~~Seasonal calendar~~ | ~~8.2~~ | | ⚠️ Low-ROI at this stage — defer |
| | ~~YouTube Shorts~~ | ~~10.3~~ | | ⚠️ Low-ROI at this stage — defer |

---

## Part 4: Quick Wins Checklist (Can Do TODAY)

- [ ] Wire top-performing hashtags into auto-queue (Sprint 4.1)
- [ ] Lower data-driven time threshold 20 → 10 samples (Sprint 4.3)
- [ ] Add UTM parameters to social post links (Sprint 4.5.1)
- [ ] Remove "Comment KK for a discount" from captions OR plan DM flow (Sprint 6.2)
- [ ] Hide Pinterest "Boards" tab (Sprint 12.3)
- [ ] Add `content_type` column to `social_posts` (prep for Reels) (Sprint 5.3)
- [ ] Add Meta Pixel to karrykraze.com (Sprint 4.5.2 — requires Meta Business setup first)

---

## Part 5: Execution Timeline

```
DAY 1-2:  Phase 1A — Hashtag injection + posting time optimization
DAY 3-4:  Phase 1B — AI captions in auto-queue + learning trigger after insights
DAY 5:    Phase 1C — UTM tracking + Meta Pixel + fix "Comment KK"
---------- SHIP IT. Let autopilot run with smart wiring for 1-2 weeks. ----------
WEEK 3:   Sprint 5.0 — Test: 1 image → Ken Burns loop → post as Reel (validate reach)
WEEK 3-4: Sprint 5.1 — If Reels validated, build simple slideshow builder
          Sprint 5.3 — Instagram Reels API + process-scheduled-posts update
          Sprint 6.2 — Fix "Comment KK" if not done (remove CTA or build DM flow)
WEEK 4-5: Sprint 6.1 — Engagement dashboard + "Go Engage" guidance
          Sprint 6.3 — Story scheduling
WEEK 6:   Sprint 7 — Follower tracking + heat map + growth charts
---------- CHECKPOINT: Review metrics, decide Phase 3 priorities ----------
WEEK 7+:  Sprint 8.1 — Content pillars (if engagement plateaus)
          Sprint 9 — A/B testing (once at 100+ posts)
          Sprint 10.1 — TikTok (when ready for second platform)
          Sprint 11 — Advanced automation (dynamic frequency, smart repost)
          Sprint 12 — Admin UI polish
```

---

> **Bottom line (revised)**: The system has a powerful brain that isn't fully connected. Phase 1A-1B-1C is a 5-day sprint that wires the learning loop, making every future post smarter. Then validate Reels with one simple test before building a pipeline. Then add engagement *direction*, not automation. Everything else comes after the compounding engine is running. **Don't overbuild — ship the wiring, let data accumulate, then iterate.**