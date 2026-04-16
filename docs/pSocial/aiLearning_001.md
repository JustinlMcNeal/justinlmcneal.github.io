# AI Learning Pipeline — Full Audit

> **Created**: 2026-04-16  
> **Reviewed**: 2026-04-16 (Advisor feedback applied)  
> **Scope**: Every component of the AI learning, analytics, and performance tracking system for the social media module  
> **Audit Quality**: 9.5/10 — accurate, actionable, properly prioritized

---

## How It All Connects (High-Level Flow)

```
Instagram Posts (published)
    │
    ├──→ instagram-insights edge function (cron every 6h)
    │     └── Fetches likes, comments, saves, reach, shares from IG Graph API
    │     └── Writes to: social_posts (engagement columns) + social_hashtag_analytics
    │
    ├──→ "Update Learnings" button (manual trigger)
    │     └── processAllPostsForLearning()
    │         ├── updateHashtagPerformance()  → hashtag_performance table
    │         ├── updateTimingPerformance()   → posting_time_performance table
    │         ├── updateCaptionPerformance()  → caption_element_performance table
    │         └── generateRecommendations()   → content_recommendations table
    │                                          + post_learning_patterns (ai_insight, ai_calendar)
    │
    ├──→ "Research Categories" button (manual trigger)
    │     └── checkAndResearchCategories()
    │         └── For each category with 3+ posts:
    │             └── Calls ai-generate (type: category_research) via OpenAI GPT-4o-mini
    │             └── Writes to: post_learning_patterns (pattern_type = 'category_insight')
    │
    └──→ "Run Deep Analysis" button (per-post, manual trigger)
          └── analyzePost(postId)
              ├── Rule-based scoring (timing, caption, hashtag) → 0-100 scores
              ├── Calls ai-generate (type: analyze_post) via OpenAI GPT-4o-mini
              └── Writes AI learnings to: post_learning_patterns (ai_learning)
              └── NOTE: Does NOT write to post_performance_analysis table (see Issues)

All of this data feeds INTO:
    │
    ├──→ auto-queue (Sprint 3): priority scoring uses category_performance from post_learning_patterns
    ├──→ auto-queue (Sprint 3): posting times from posting_time_performance
    ├──→ ai-generate edge function: builds learning context from all pattern tables for caption/hashtag generation
    └──→ Analytics dashboard: displays everything in the UI
```

---

## Data Flow: Step by Step

### Step 1: Raw Engagement Data Collection

**Source**: Instagram Graph API v22.0  
**Trigger**: Cron job every 6 hours (jobid 4 + jobid 12 — see Issues)  
**Edge function**: `instagram-insights`

The function:
1. Reads `instagram_access_token` from `social_settings`
2. Queries `social_posts` where `platform = 'instagram'`, `status = 'posted'`, has `external_id` (the IG media ID)
3. For each post, calls `graph.facebook.com/v22.0/{mediaId}?fields=like_count,comments_count,permalink,media_type`
4. Calls `/{mediaId}/insights` for: `reach`, `saved`, `shares`, `total_interactions`
5. If standard insights fail, falls back to Reels metrics (`plays`)
6. Calculates `engagement_rate = (likes + comments + saves) / reach * 100`
7. Updates `social_posts` with: `likes`, `comments`, `saves`, `shares`, `impressions`, `reach`, `engagement_rate`, `last_insights_sync`, `permalink`
8. Upserts per-hashtag metrics into `social_hashtag_analytics` (tracks which hashtags appeared on which posts and their engagement)
9. Detects deleted IG posts → marks `status = 'deleted'`, zeroes engagement

**Tables written**: `social_posts`, `social_hashtag_analytics`

### Step 2: Learning Aggregation ("Update Learnings")

**Trigger**: Manual — user clicks "Update Learnings" button in Analytics tab  
**JS function**: `processAllPostsForLearning()` in `index.js`, which calls functions from `postLearning.js`

This runs 4 sub-processes:

#### 2A. Hashtag Performance Aggregation
**Function**: `updateHashtagPerformance()`  
**Reads from**: `social_posts` (posted IG posts with engagement data)  
**Writes to**: `hashtag_performance` table  
**Logic**: 
- Parses hashtags from each post's `hashtags` array
- Aggregates: `times_used`, `total_reach`, `total_likes`, `total_comments`, `total_saves`, `avg_engagement_rate`
- Identifies `best_performing_post_id` and `worst_performing_post_id`
- Categorizes as `branded` (contains "karrykraze"), `generic`, or `general`
- Marks `is_recommended` based on engagement rate threshold

**Current data**: 28 hashtags tracked

#### 2B. Timing Performance Aggregation
**Function**: `updateTimingPerformance()`  
**Reads from**: `social_posts` (posted posts with `scheduled_for` timestamps)  
**Writes to**: `posting_time_performance` table  
**Logic**:
- Groups posts by `hour_of_day` (0-23) and `day_of_week` (0-6, 0=Sunday)
- Aggregates: `total_posts`, `total_reach`, `total_engagement`, `avg_engagement_rate`
- Sets `is_peak_time = true` when `avg_engagement_rate > overall_avg * 1.2`
- Unique constraint on `(hour_of_day, day_of_week)` — upserts on update

**Current data**: 27 time slots populated. Peak slots: hour 12 on days 1, 2, 5 (engagement 20-50%)

**Used by auto-queue (Sprint 3)**: When ≥20 total post samples exist, autopilot uses peak hours from this table instead of default schedule.

#### 2C. Caption Element Performance
**Function**: `updateCaptionPerformance(caption, engRate, reach)`  
**Reads from**: Individual post captions (called per-post in the loop)  
**Writes to**: `caption_element_performance` table  
**Logic**:
- Analyzes each caption for:
  - `length_range`: short (<100 chars), medium (100-250), long (>250)
  - `cta`: detects CTAs like "shop now", "link in bio", "tap to shop"
  - `question`: detects questions (? character)
  - `emoji`: detects emoji usage
- Upserts `times_used`, `avg_engagement_rate`, `avg_comments`, `avg_saves`
- Unique constraint on `(element_type, element_value)`

**Current data**: 15 elements tracked. Notable: `has_question` has 50% engagement rate (1 sample), `has_cta` at 20%.

**⚠️ Issue**: Most elements have `times_used = 0` or 1 — not enough data for meaningful recommendations yet. The `is_recommended` flags are set based on defaults, not actual performance.

#### 2D. Recommendation Generation
**Function**: `generateRecommendations()`  
**Reads from**: All pattern tables above  
**Writes to**: `content_recommendations` table + `post_learning_patterns` (ai_insight, ai_calendar types)  
**Logic**:
1. Generates rule-based recommendations from timing/hashtag/caption data
2. Calls `ai-generate` edge function (type: `recommendations`) with all performance data
3. AI returns: `recommendations[]`, `quick_wins[]`, `patterns_identified[]`, `content_calendar_suggestions`
4. Stores AI insights as `post_learning_patterns` with `pattern_type = 'ai_insight'`
5. Stores calendar suggestions as `pattern_type = 'ai_calendar'`
6. Inserts `content_recommendations` rows with priority, description, action items, expiration (30 days)

**Current data**: 6 active recommendations (5 AI-generated, 1 weekly rule-based)

### Step 3: Category Research ("Research Categories")

**Trigger**: Manual — user clicks "Research Categories" button  
**JS function**: `checkAndResearchCategories()` in `postLearning.js`

**Logic**:
1. Groups all posted IG posts by product category
2. For each category with 3+ posted items:
   - Sends post data (captions, hashtags, engagement metrics) to `ai-generate` (type: `category_research`)
   - AI analyzes: what's working, what's not, caption strategy, hashtag strategy, timing, key insights
   - Returns a structured JSON with: `category_name`, `total_posts`, `avg_engagement`, `top_performer`, `caption_strategy`, `hashtag_strategy`, `timing_strategy`, `key_insights[]`, `recommendations[]`
3. Stores in `post_learning_patterns` with `pattern_type = 'category_insight'`, `pattern_key = category_name`

**Current data**: 1 category insight stored

**How it helps**: Category insights feed into:
- The `ai-generate` edge function's `buildLearningContext()` — when generating captions/hashtags, AI sees what has worked for that category
- The autopilot's priority scoring — `pattern_type = 'category_performance'` affects product selection weights (Sprint 3)
- The "What AI Learned" section in the dashboard

### Step 4: Deep Post Analysis ("Run Deep Analysis")

**Trigger**: Manual — user clicks "Run Deep Analysis" on a specific post in the post analytics modal  
**JS function**: `analyzePost(postId)` in `postLearning.js`

**Logic**:
1. Fetches the post with all metrics
2. **Rule-based scoring** (0-100 each):
   - `timing_score`: based on hour of day vs peak times, weekend bonus/penalty
   - `caption_score`: based on length, emoji, CTA, question presence, hashtag count
   - `hashtag_score`: based on count (optimal 3-15), branded hashtag presence, category relevance
   - `visual_score`: **hardcoded to 70** ⚠️ (see Issues)
   - `engagement_velocity_score`: **hardcoded to 70** ⚠️ (see Issues)
3. **AI analysis**: Calls `ai-generate` (type: `analyze_post`) with post data + all engagement metrics
4. AI returns: `overall_score`, `sub_scores{}`, `learnings[]`, `recommendations[]`, strengths/weaknesses
5. Stores AI learnings in `post_learning_patterns` with `pattern_type = 'ai_learning'`
6. Displays everything in the post analytics modal

**Current data**: 10 AI learnings stored from past deep analyses

**How it helps**: AI learnings become part of the learning context for future caption/hashtag generation, creating a feedback loop.

---

## Edge Functions

### `instagram-insights` (deployed, active)
- **Purpose**: Fetches real engagement data from IG
- **Cron**: Every 6 hours (jobid 4 + 12)
- **Model**: No AI — direct Graph API calls
- **Status**: ✅ Working — last sync pulled real data for 6+ posts

### `ai-generate` (deployed, active)
- **Purpose**: All AI-powered generation and analysis
- **Model**: `gpt-4o-mini` (OpenAI)
- **Max tokens**: 1000-2500 depending on type
- **Types supported**: `caption`, `hashtags`, `score`, `insights`, `analyze_post`, `recommendations`, `category_research`
- **Learning context**: `buildLearningContext()` injects learned patterns, category insights, AI learnings, content calendar, brand voice templates, and top-performing captions into every AI call
- **Status**: ✅ Working — generates real AI analysis

### `auto-queue` (deployed, active)
- **Purpose**: Autopilot post generation (Sprint 3)
- **Uses learning data**: 
  - `posting_time_performance` → data-driven scheduling
  - `post_learning_patterns` (category_performance) → product priority scoring
- **Status**: ✅ Working

---

## Database Tables

### Tables with Real Data

| Table | Rows | Purpose | Written By |
|-------|------|---------|-----------|
| `social_posts` | 36+ posted | Core post records with engagement metrics | Process/insights |
| `social_hashtag_analytics` | 130 | Per-post per-hashtag engagement tracking | instagram-insights |
| `hashtag_performance` | 28 | Aggregated hashtag performance | Update Learnings |
| `posting_time_performance` | 27 | Hour×day engagement grid | Update Learnings |
| `caption_element_performance` | 15 | Caption feature analysis | Update Learnings |
| `post_learning_patterns` | 34 | All AI learnings, insights, category research | Deep Analysis / Research |
| `content_recommendations` | 6 active | AI + rule-based recommendations | Update Learnings |
| `social_caption_templates` | 87 | Caption templates by tone | Admin CRUD |
| `social_category_hashtags` | 47 | Default hashtags per category | Admin CRUD |

### Table with NO Data (Issue)

| Table | Rows | Purpose | Problem |
|-------|------|---------|---------|
| `post_performance_analysis` | **0** | Detailed per-post analysis storage | `analyzePost()` returns data but **never writes to this table** |

---

## UI Components (Analytics Tab)

### Dashboard Metrics (top)
- 4 summary cards: Total Posts, Published, This Week, Scheduled
- 6 engagement tiles: Likes, Comments, Saves, Impressions, Reach, Engagement Rate
- **Sync Insights** button: calls `instagram-insights` edge function with `{syncAll: true, daysBack: 30}`

### Top Performing Posts
- Shows top 5 posts sorted by engagement rate
- Clickable → opens Post Analytics Modal

### Browse All Posts
- Thumbnail grid with color-coded engagement (green >5%, blue >2%, gray)
- Time filter: All Time / This Week / This Month / Last 3 Months
- Clickable → opens Post Analytics Modal

### Hashtag Performance Cloud
- Tag cloud where size + color = engagement rate
- Generated from `hashtag_performance` table

### Platform Performance Circles
- Instagram / Facebook / Pinterest post counts with visual bars
- Facebook + Pinterest show 0 (not actively posting)

### Posting Activity & Best Times
- Recent 10 posts list
- Time-of-day bar chart (Morning/Afternoon/Evening/Night)

### Caption Tone Usage
- 8 tones detected by keyword matching in captions
- Shows distribution of tone usage

### Post Status Overview
- Queued / Published / Failed / Draft / Cancelled counts

### AI Learning Insights Section
- **Smart Recommendations**: Cards from `content_recommendations` table
- **Best Practices Grid**: Best Time, Best Day, Hashtag Count, Top Signal
- **Top Hashtags**: From `hashtag_performance`, sorted by engagement
- **Timing Heatmap**: 7×6 grid (days × hours), color-coded by engagement
- **Caption Best Practices**: Static list of dos and don'ts
- **Instagram Algorithm Tips (2026)**: 6 static tip cards
- **What AI Learned**: Category insight cards from `post_learning_patterns`
- **All AI Learnings**: Collapsible list of all learnings

### Post Analytics Modal (per-post)
- Engagement metrics display
- Rule-based performance insights
- Hashtag list
- Timeline (Created → Scheduled → Posted → Last Sync)
- **Run Deep Analysis** button → full AI scoring + comparison + strengths/weaknesses/recommendations
- AI analysis results: score breakdown, sub-scores, vs-averages comparison

---

## What Each Button Does

### "Sync Insights" (purple button, analytics header)
- **Calls**: `instagram-insights` edge function with `{syncAll: true, daysBack: 30}`
- **What it does**: Goes to Instagram, pulls real engagement data (likes, comments, saves, reach, shares) for all posted Instagram posts from the last 30 days
- **Updates**: `social_posts` engagement columns + `social_hashtag_analytics`
- **When to use**: Anytime you want fresh engagement metrics. Also runs automatically every 6 hours via cron.

### "Update Learnings" (green button, AI Learning section)
- **Calls**: `processAllPostsForLearning()` → runs 4 sub-processes
- **What it does**: Analyzes ALL posted content to learn patterns:
  1. Which hashtags perform best → `hashtag_performance`
  2. Which posting times get most engagement → `posting_time_performance`
  3. Which caption elements (CTAs, emojis, length) work best → `caption_element_performance`
  4. Generates AI-powered recommendations → `content_recommendations` + `post_learning_patterns`
- **When to use**: After getting fresh insights data. This processes the raw engagement numbers into actionable patterns. Run it periodically (weekly) to keep patterns up to date.
- **Impact**: This directly affects autopilot scheduling (Sprint 3 uses timing data for peak hours).

### "Research Categories" (purple button, "What AI Learned" section)
- **Calls**: `checkAndResearchCategories()`
- **What it does**: For each product category that has 3+ posted items, sends all post data to GPT-4o-mini for analysis. AI returns category-specific strategy: what captions work, which hashtags, best timing, key insights.
- **Stores in**: `post_learning_patterns` with `pattern_type = 'category_insight'`
- **When to use**: After accumulating enough posts per category (3+ minimum). Re-run after significant new data.
- **Impact**: Category insights feed into AI caption generation and autopilot product priority scoring.

### "Run Deep Analysis" (per-post button in Post Analytics Modal)
- **Calls**: `analyzePost(postId)` → rule-based scoring + GPT-4o-mini analysis
- **What it does**: Full analysis of one specific post:
  1. Scores timing, caption quality, hashtag effectiveness (rule-based, 0-100 each)
  2. Sends to AI for deeper analysis: overall score, learnings, recommendations
  3. Compares against your averages (engagement, likes, comments, saves)
  4. Lists strengths, weaknesses, and specific improvement suggestions
- **Stores in**: `post_learning_patterns` with `pattern_type = 'ai_learning'`
- **When to use**: On your best and worst performing posts to understand what worked and what didn't.
- **Impact**: AI learnings feed into future caption/hashtag generation context.

### "Refresh" (bottom of analytics)
- **Calls**: `loadAnalytics()`
- **What it does**: Reloads the dashboard UI from existing DB data. Does NOT fetch new data from Instagram or run analysis.
- **When to use**: After running other operations, or to refresh the view.

---

## Known Issues

> **Advisor Review Note**: The core truth is — the system is end-to-end working, but learning is not automated yet. The autopilot is already smarter than the learning pipeline. The brain is good; the memory is weak. Fix memory → system levels up.

### 🔴 Critical — Fix Immediately

**1. `post_performance_analysis` table is never written to** ⭐ HIGHEST PRIORITY
- The table has 30+ columns designed for detailed per-post analysis storage
- `analyzePost()` computes all this data but only returns it to the UI — never persists it
- **Impact**: Deep analysis results are lost when you close the modal. Can't query historical analysis. No trend tracking. No ability to compare posts over time.
- **Fix**: Add a Supabase insert at the end of `analyzePost()` to persist the analysis
- **Effort**: Low — one insert call, table schema already matches the data
- **Advisor**: "This is the most important real bug in the entire audit. Must-fix immediately (Sprint 3.5 level). Low effort, high value."

**2. No automated learning pipeline** ⭐ SECOND PRIORITY
- Learning only runs when user manually clicks "Update Learnings"
- **Impact**: If the admin forgets, autopilot uses stale timing/category data. This is the biggest architectural gap.
- **Fix**: Hook learning into the existing `autopilot-fill` flow — after filling the queue, run hashtag/timing/caption aggregation
- **Why this approach** (not a separate cron): Keeps system simple, no extra infrastructure, learning is always fresh right before next autopilot run
- **Advisor**: "This is your next real system upgrade — not UI, not features. Do NOT build a new edge function for this. Just add learning to autopilot flow."

**Current gap**:
```
Insights → (wait for human) → Learning → Autopilot improves
```
**Target**:
```
Insights → Learning → Autopilot improves (automatically)
```

### 🟡 Medium — Clean Up

**3. Duplicate cron jobs for insights sync**
- Job 4 (`instagram-insights-sync`) and Job 12 (`sync-instagram-insights`) both run `instagram-insights` every 6 hours
- Job 5 (`instagram-insights-weekly-sync`) also runs it weekly
- **Impact**: Wasted compute, potential rate limit issues later. Not harmful but wasteful.
- **Fix**: Delete job 4 (keep 12 which was intentionally created). Keep 5 for the weekly deep sync.
- **Advisor**: "Fix it, but it's not urgent-urgent."

**4. `autopilot_last_run` is stale**
- Shows `ran_at: 2026-01-11` — but autopilot has actually been running since Sprint 1 fixed it
- **Impact**: Dashboard may show misleading "last run" info
- **Fix**: `autopilot-fill` should update this setting on each successful run
- **Advisor**: "Good for visibility, not critical."

**5. Pinterest token expired**
- `pinterest_token_expires_at = 2026-02-19` (2 months ago)
- Token refresh failing: "Authentication failed"
- **Impact**: Pinterest posting is fully broken. Low priority since Pinterest isn't in active use.
- **Fix**: Re-authenticate Pinterest OAuth flow, or defer until Pinterest goes production

### 🟢 Low — Will Resolve Over Time

**6. Caption element data is too sparse**
- Most `caption_element_performance` rows have `times_used = 0` or 1
- The `is_recommended` flags are set by code defaults, not actual performance
- **Impact**: Caption recommendations aren't data-driven yet
- **Advisor**: "Correct, but expected. You just don't have enough volume yet. Do nothing here — this solves itself over time."

**7. Visual score and engagement velocity score are hardcoded**
- In `analyzePost()`: `visual_score: 70` and `engagement_velocity_score: 70`
- These never change regardless of the actual post
- **Impact**: Overall score is partially fake — 2 of 5 sub-scores are meaningless
- **Advisor**: "True but less important than it sounds. Don't fix this now. You already have better signals (engagement, category, recency). This is a later maturity problem."

**8. "Top Signal" is hardcoded to "Shares"**
- `learningBestTime` shows defaults that only update after "Update Learnings" runs
- `learningTopSignal` is hardcoded text: "Shares"
- **Impact**: Cosmetic — may mislead new users
- **Fix**: Calculate actual top signal from engagement data

**9. Category insight count is low**
- Only 1 category insight exists (needs 3+ posts per category to trigger AI research)
- **Impact**: Autopilot category scoring defaults to mid-range for most categories
- **Fix**: Will improve as more posts accumulate. Can also lower threshold from 3 to 2 posts.

---

## Action Plan (Advisor-Prioritized)

> **Do NOT**: Build new features, add more AI layers, expand platforms.  
> **DO**: Fix memory, automate learning, clean up, let system run.

### 🥇 Fix Immediately — Sprint 3.5

**1. Persist Deep Analysis**
- Add `insert into post_performance_analysis` at end of `analyzePost()`
- Table schema already matches the computed data
- One insert call. Unlocks: historical analysis, trend tracking, post-over-time comparison.
- **Success**: `post_performance_analysis` has rows after running deep analysis on any post

### 🥈 Fix Next — Core System Upgrade

**2. Automate Learning (inside autopilot flow)**
- Hook learning into `auto-queue` edge function (autopilot-fill cron)
- **Exact flow**:
  ```
  autopilot-fill →
    queue posts →
    THEN run learning aggregation (hashtag/timing/caption) →
    THEN exit
  ```
- **Frequency**: Runs every autopilot cycle (daily at 2AM UTC). Not weekly. Not manual.
- **Why**: Keeps system simple, no extra cron, learning is always fresh before next run
- **Do NOT** build a separate weekly learning edge function — overkill for current scale
- **Success**: Learning runs automatically without button press. Autopilot uses updated timing/category data without manual trigger.

### 🥉 Clean Up

**3. Remove duplicate cron**
- Delete job 4 (`instagram-insights-sync`), keep job 12 (`sync-instagram-insights`)
- Keep job 5 for weekly deep sync

### 🟡 Nice to Have

**4. Track `autopilot_last_run`**
- Add a settings write at end of `autopilot-fill` to track actual last run time
- Good for visibility, not critical

### ⏸️ Deferred — Not Now

These are good ideas but premature for current data volume and system maturity:

| Suggestion | Why Defer |
|-----------|-----------|
| Engagement velocity tracking (1h vs 24h) | Not enough volume yet for this to matter |
| Full visual scoring system | `quality_score` on assets is enough for v1 |
| Weekly learning cron (separate edge function) | Overkill — just hook into autopilot flow |
| Caption A/B tracking | Data too sparse, solves itself over time |
| Cross-platform learning | Facebook/Pinterest not active |
| Anomaly detection | Needs more baseline data first |
| Learning decay (time-weighted) | System maturity problem, not a current gap |

---

## The Real Insight

> **Your autopilot is already smarter than your learning pipeline.**

You built: priority scoring, image pool, selection logic, caption confidence.  
But your learning system: updates too infrequently, requires manual trigger, doesn't persist everything.

**Translation**: Your brain is good. Your memory is weak.

Fix memory → system levels up.

Once learning is automated + stored:

```
Post → Data → Learning → Better Post → Repeat
```

That's the closed-loop milestone. You are VERY close.

### Sprint 3.5 Success Criteria

```
✅ post_performance_analysis has rows after deep analysis
✅ Learning runs automatically every autopilot cycle (no button press)
✅ Autopilot uses updated timing/category data without manual trigger
✅ Duplicate cron job 4 removed
```

When all 4 pass → system is a true closed loop.

---

## Pipeline Health Summary

| Component | Status | Health | Priority |
|-----------|--------|--------|----------|
| Instagram insights sync | ✅ Running every 6h | **Healthy** — real data flowing | — |
| Hashtag tracking | ✅ 28 hashtags, 130 per-post records | **Healthy** — good data | — |
| Timing analysis | ✅ 27 time slots | **Healthy** — peak times identified | — |
| Caption analysis | ⚠️ 15 elements, mostly sparse | **Sparse** — solves itself over time | Do nothing |
| AI category research | ⚠️ 1 category researched | **Sparse** — needs manual trigger | Do nothing |
| AI deep analysis | ✅ 10 learnings from past analyses | **Working** — but manual only | — |
| Recommendations | ✅ 6 active | **Working** — mix of AI + rules | — |
| Autopilot integration | ✅ Sprint 3: uses timing + category data | **Healthy** — data-driven when enough samples | — |
| Post performance storage | 🔴 0 rows, never written | **Broken** — code gap | 🥇 Fix immediately |
| Learning automation | 🔴 No cron, manual only | **Missing** — biggest architectural gap | 🥈 Fix next |
| Duplicate cron jobs | ⚠️ Job 4 + 12 overlap | **Wasteful** — not harmful | 🥉 Clean up |

**Overall**: The system works end-to-end. Data collection is automated and healthy. The autopilot is already smarter than the learning pipeline feeding it. Fix the two 🔴 items to close the loop and achieve a fully self-improving system:

```
semi-learning system (manual assist required)  →  fully self-improving system
```
