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

### Round 3 (GPT-4o) — Score: 9.6 / 10
**Verdict**: "Ready to execute. Low risk. High upside."

**What improved**: Phase 1 sub-phasing reduces failure risk ~70%. Validation-before-build on Reels is "elite thinking." Engagement is now actionable. Distractions correctly killed.

**Final tightening applied**:
- Added **Phase 1 success criteria** — concrete metrics to trigger Phase 2
- Added **observation rule** — no logic changes for 7 days after ship (protect data quality)
- Reels test tightened — same product, Day 1 image vs Day 2 reel (removes noise)
- AI caption `angle` parameter added — future A/B leverage without rebuilding

**Revised priority tiers**:
- 🥇 **Phase 1A (DAY 1-2)**: Hashtags + posting times (wire the learning loop)
- 🥇 **Phase 1B (DAY 3-4)**: AI captions + learning trigger
- 🥇 **Phase 1C (DAY 5)**: UTM tracking + Meta Pixel + fix "Comment KK"
- 🥈 **Phase 2 (NEXT)**: Simple Reels, light engagement, growth tracking
- 🥉 **Phase 3 (LATER)**: A/B testing, content pillars, TikTok
- 🚫 **Phase 4 (NOT YET)**: Full engagement automation, paid ads, competitor scraping

### Phase 1 Success Criteria (gate to Phase 2)
After shipping Phase 1, let autopilot run **7-14 days untouched**, then check:
- ✅ Engagement rate ↑ 20%+ (vs. pre-learning-loop baseline)
- ✅ Reach per post ↑ 30%+
- ✅ Top-performing hashtags begin repeating in new posts
- Hit **any one** of these → greenlight Phase 2

### Shipped Status
| Phase | Status | Commit | Notes |
|-------|--------|--------|-------|
| 1A — Hashtags + Timing | ✅ SHIPPED | `82ed931` | Smart hashtag merge + timing threshold + learned fallback |
| 1B — AI Captions + Learning Trigger | ✅ SHIPPED | `838cb72` | AI captions via ai-generate, template fallback, caption_source tracking, insights triggers learning aggregation |
| 1C — UTM + Comment KK + Meta Pixel | ✅ SHIPPED | `bbea7f2`, `995db2c` | UTM params on all link_urls, "Comment KK" removed, Meta Pixel installed on all 14 public pages with ViewContent/AddToCart/InitiateCheckout/Purchase events |

### Infrastructure Fixes Applied (April 18, 2026)

**Image Pool Duplicates**: Found 30 duplicate entries across 6 groups in `social_assets`. Soft-deleted via `is_active=false`. Added unique partial index `uq_social_assets_active_path ON social_assets(original_image_path) WHERE is_active = true`. `createAsset()` in admin API now catches constraint violation error 23505 with user-friendly message.

**Carousel Not Using Image Pool**: `shouldUseCarousel()` only checked AI images — now checks pool images first (priority 1, needs 3+ images) then AI images (priority 2). Added `resolveStorageUrl()` helper to convert relative `originals/...` paths to full public URLs.

**Instagram Post Failures (Relative URLs)**: Posts with `image_url` = `originals/2026/01/...` (relative storage path) failed with `"Only photo or video can be accepted as media type."` because Instagram Graph API can't fetch relative paths. Fixed in both `process-scheduled-posts` (single image + carousel array) and `auto-queue` (resolveImage + diversity guard).

**Calendar UI**: Added 🎠 carousel badge icon to post pills and `[CAROUSEL]` prefix in tooltip.

**Over-Posting Bug**: Auto-queue deficit calculation checks total posts across `days_ahead` window, not per-day limits. This caused 4 posts on one Sunday instead of 2. Manually rebalanced queue.

### Known Issue: Category Labels in hashtag_performance
**Discovered during Phase 1A testing.** All hashtags in `hashtag_performance` have `category = "general"` — none have product-category labels (e.g., "bags", "headwear"). This means `topHashtagsByCategory` is always empty and category-biased hashtag selection is a no-op. The merge still works (general tags fill correctly), but category relevance will improve once `runLearningAggregation` writes proper category labels. **Fix after observation window.**

**⚠️ Observation Rule**: Do NOT change hashtag logic, caption logic, or posting times for **at least 7 days** after shipping Phase 1. Tweaking too early kills data quality and makes it impossible to measure impact.

### Infrastructure Fix: Cloudflare 503 Caching
**Discovered during Phase 1C deployment.** GitHub Pages returns transient 503s during deploy propagation. Cloudflare was caching these error responses and serving them to all visitors until manually purged.

**Fixes applied:**
1. **Cloudflare cache rule**: Status codes 500-503 → Duration "No cache" (never cache server errors)
2. **SW v4** (`3040847`): Pre-caches `manifest.json`, `navbar.html`, `footer.html`, home page_inserts so they survive brief outages
3. **SW retry** (`3040847`): Retries once after 1s on 503 before falling back to cache
4. **SW resilient install** (`8d96e5d`): Pre-cache skips files that 503 instead of failing the entire install

### Infrastructure Fix: Autopilot Pipeline
**Discovered 2026-04-18.** After Phase 1 deployments, autopilot stopped generating new posts. Calendar showed nothing beyond April 19. Two root causes found and fixed in commit `b55c93c`:

1. **verify_jwt 401**: Redeploying `auto-queue` during Phase 1 reset its JWT verification to `true` (Supabase default). `autopilot-fill` calls `auto-queue` with the service role key, but edge runtime rejected it. **Fix**: Added `[functions.auto-queue]` and `[functions.autopilot-fill]` to `config.toml` with `verify_jwt = false`.
2. **image_source CHECK constraint**: `social_posts.image_source` only allowed `('catalog','gallery','ai_generated','manual')`. Auto-queue now produces `'ai_carousel'`, `'resurface'`, and `'image_pool'` — posts using these values were silently skipped. **Fix**: Migration `20260418_fix_image_source_constraint.sql` updated constraint to include all 7 values.
3. **Error diagnostics**: Added `skippedErrors` array and `generatedCount` to auto-queue response so future failures are visible instead of silent.
4. **Stale post cleanup**: Deleted 2 pre-Phase1 posts that still had "Comment KK" text and no UTM params.

**Result**: Autopilot restored — 7 posts queued for April 18-20, all with AI captions, UTM params, and smart hashtags.

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

**Code Audit (auto-queue/index.ts)**:
- **Line 736-744**: Queries `social_category_hashtags`, builds `hashtagMap[category] = hashtags[]`
- **Line 789-793**: Per product: `categoryHashtags = hashtagMap[name]`, ensures `#karrykraze` is present → stored as `hashtags` variable
- **Line 416-431**: Learning aggregation WRITES to `hashtag_performance` (avg_engagement_rate, is_recommended, times_used)
- **NEVER reads** `hashtag_performance` for selection → **this is the gap**

**Exact Changes**:

**Change 1** — After line 744 (`const globalHashtags = hashtagMap["_global"] || ["#karrykraze"];`), add:
```ts
// ── PHASE 1A: SMART HASHTAG INJECTION ──
const { data: topHashtags } = await supabase
  .from("hashtag_performance")
  .select("hashtag, avg_engagement_rate, times_used, category, is_recommended")
  .eq("is_recommended", true)   // avg >= 2.0 AND times_used >= 3
  .order("avg_engagement_rate", { ascending: false })
  .limit(15);

const topHashtagsByCategory: Record<string, string[]> = {};
const topHashtagsGeneral: string[] = [];
(topHashtags || []).forEach((h: any) => {
  const tag = `#${h.hashtag}`;
  if (h.category && h.category !== "branded" && h.category !== "general") {
    if (!topHashtagsByCategory[h.category]) topHashtagsByCategory[h.category] = [];
    topHashtagsByCategory[h.category].push(tag);
  } else {
    topHashtagsGeneral.push(tag);
  }
});
console.log(`[auto-queue] Learned hashtags: ${(topHashtags||[]).length} recommended`);
```

**Change 2** — Replace lines 789-793 (hashtag selection per product):
```ts
// Old:
const categoryHashtags = hashtagMap[categoryName.toLowerCase()] || globalHashtags;
const hashtags = categoryHashtags.includes("#karrykraze") ? categoryHashtags : ["#karrykraze", ...categoryHashtags];

// New:
const categoryHashtags = hashtagMap[categoryName.toLowerCase()] || globalHashtags;
const learnedForCat = topHashtagsByCategory[categoryName.toLowerCase()] || [];
const learnedGeneral = topHashtagsGeneral.filter(t => !categoryHashtags.includes(t));
const merged: string[] = ["#karrykraze"];
for (const tag of [...learnedForCat, ...learnedGeneral]) {
  if (merged.length >= 3) break;
  if (!merged.includes(tag)) merged.push(tag);
}
for (const tag of categoryHashtags) {
  if (merged.length >= 5) break;
  if (!merged.includes(tag)) merged.push(tag);
}
const hashtags = merged;
```

**Change 3** — Apply same merge logic for resurfaced posts (line ~975-977).

**Result**:
- Before: `["#karrykraze", "#bags", "#style", "#fashion", "#accessories"]` (static)
- After: `["#karrykraze", "#bunnybeanie", "#sanrio", "#bags", "#style"]` (learned winners first)

**Test**: `auto-queue` with `count=1&preview=true`, verify hashtags include `hashtag_performance` entries.
**Deploy**: `echo y | npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq`

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

**Problem**: Data-driven time selection requires 20+ total samples. With 43 posts, we have enough data but the threshold blocks it.

**Code Audit (auto-queue/index.ts)**:
- **Line 431-436**: Queries `posting_time_performance` → all slots, ordered by `avg_engagement_rate DESC`
- **Line 437**: `totalTimeSamples = sum of total_posts` across all time slots (currently = 43)
- **Line 438**: Gate: `const useDataDrivenTimes = totalTimeSamples >= 20;` → **TRUE with 43 samples**
- **Line 439-441**: If data-driven, takes top 6 unique hours; else falls back to `[10, 14, 18]`
- **Line 632-646**: `post_learning_patterns` queried for `category_performance` but **NOT** for timing patterns
- **Line 748**: `getNextPostingTimes(peakHours, ...)` uses the selected hours

**Exact Changes**:

**Change 1** — Line 438, lower the threshold:
```ts
// WAS:  const useDataDrivenTimes = totalTimeSamples >= 20;
const useDataDrivenTimes = totalTimeSamples >= 10;
```
(With 43 posts this already passes at 20, but lowering to 10 ensures it stays data-driven as the system grows and slots spread thinner.)

**Change 2** — After line 441 (the `peakHours` ternary), add learned pattern fallback for when data IS sparse:
```ts
// ── PHASE 1A: USE LEARNED TIMING PRIORS WHEN DATA SPARSE ──
let peakHoursFinal = peakHours;
if (!useDataDrivenTimes) {
  const { data: timingPatterns } = await supabase
    .from("post_learning_patterns")
    .select("pattern_key, pattern_value")
    .eq("pattern_type", "timing")
    .in("pattern_key", ["best_general_time", "best_day"]);

  const bestHourPattern = (timingPatterns || []).find(
    (p: any) => p.pattern_key === "best_general_time"
  );
  if (bestHourPattern?.pattern_value?.hour !== undefined) {
    const bestHour = bestHourPattern.pattern_value.hour;
    peakHoursFinal = [bestHour, bestHour + 5 > 23 ? bestHour - 5 : bestHour + 5];
    console.log(`[auto-queue] Using learned timing priors: ${peakHoursFinal.join(",")} ET`);
  }
}
```

**Change 3** — Line 748, update `getNextPostingTimes` call:
```ts
// WAS:  peakHours,
peakHoursFinal,
```

**Result**:
- With 43 posts → `totalTimeSamples = 43 >= 10` → data-driven activates
- Top hours from `posting_time_performance` used instead of hardcoded 10am/2pm/6pm
- If data ever drops below 10, learned `best_general_time` (confidence 85%) is the fallback

**Test**: Run auto-queue preview, verify log says `"data-driven"` and scheduled times match top `posting_time_performance` entries.
**Deploy**: Same deploy as 4.1 (single deploy covers both changes).

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
| 1 | ✅ Smart hashtag injection | 4.1 | 1-2 hours | +30-50% reach (using proven hashtags) |
| 2 | ✅ Posting time optimization | 4.3 | 30 min | Posts at proven peak times |

**Phase 1B (Day 3-4): Smart Content**
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 3 | ✅ AI captions in auto-queue | 4.2 | 2-3 hours | Higher quality, varied captions |
| 4 | ✅ Auto-refine after insights | 4.4 | 1 hour | Continuous learning every 6h |

**Phase 1C (Day 5): Tracking + Trust**
| # | Item | Sprint | Effort | Expected Impact |
|---|------|--------|--------|----------------|
| 5 | ✅ UTM tracking | 4.5.1 | 30 min | Revenue attribution unlocked |
| 6 | ✅ Meta Pixel install | 4.5.2 | 30 min | Audience data collection starts |
| 7 | ✅ Remove "Comment KK" CTA | 6.2 | 5 min | Stop breaking trust |

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

- [x] Wire top-performing hashtags into auto-queue (Sprint 4.1) — `82ed931`
- [x] Lower data-driven time threshold 20 → 10 samples (Sprint 4.3) — `82ed931`
- [x] Add UTM parameters to social post links (Sprint 4.5.1) — `bbea7f2`
- [x] Remove "Comment KK for a discount" from captions (Sprint 6.2) — `bbea7f2`
- [ ] Hide Pinterest "Boards" tab (Sprint 12.3)
- [ ] Add `content_type` column to `social_posts` (prep for Reels) (Sprint 5.3)
- [x] Add Meta Pixel to karrykraze.com (Sprint 4.5.2) — `995db2c` (Pixel ID: 2162145877936737)

---

## Part 5: Execution Timeline

```
DAY 1-2:  Phase 1A — Hashtag injection + posting time optimization          ✅ DONE (82ed931)
DAY 3-4:  Phase 1B — AI captions in auto-queue + learning trigger            ✅ DONE (838cb72)
DAY 5:    Phase 1C — UTM tracking + Meta Pixel + fix "Comment KK"            ✅ DONE (bbea7f2, 995db2c)
---------- SHIPPED 2026-04-18. Observation window: 7-14 days. ----------
WEEK 3:   Sprint 5.0 — Test: 1 image → Ken Burns loop → post as Reel (validate reach)
WEEK 3-4: Sprint 5.1 — If Reels validated, build simple slideshow builder
          Sprint 5.3 — Instagram Reels API + process-scheduled-posts update
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