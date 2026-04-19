# Karry Kraze — Improvement Roadmap

> Created: March 15, 2026  
> Last updated: March 15, 2026  
> Status: Phase 3 complete ✅ — Phase 4 next  
> Goal: Consistent social media content → website traffic → sales

---

## Current State

### Platforms
- **Amazon** — products listed, some sales
- **eBay** — products listed, some sales
- **Website** ([karrykraze.com](https://karrykraze.com)) — live, fully functional, ~0 organic traffic

### Core Problem
Zero social media presence → zero website traffic → minimal sales. Content creation is the bottleneck — sourcing product images and creating social-ready visuals without photoshoots.

### What's Already Built
| System | Status | Notes |
|--------|--------|-------|
| AI caption/hashtag generation (GPT-4o-mini) | ✅ Working | 7 generation types, learning engine, brand voice |
| Auto-queue (product → scheduled post) | ✅ Working | 50+ caption templates, 8 tones, multi-platform |
| Autopilot (auto-fill content calendar) | ✅ Working | Designed for pg_cron daily trigger |
| Auto-repost (resurface top posts) | ✅ Working | Fresh "back by demand" captions |
| Instagram + Facebook OAuth | ✅ Working | Single OAuth flow covers both |
| Pinterest OAuth | ⚠️ Sandbox only | Pins not publicly visible |
| AI Product Fill (GPT-4o vision) | ✅ Working | Analyzes images → descriptions, tags |
| Post learning engine | ✅ Working | Continuous improvement from engagement data |
| Stripe checkout + webhooks | ✅ Working | — |
| Review system | ✅ Mostly done | Missing: email notifications, public replies |

---

## What's Broken / Blocking

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | ~~CRON jobs never activated~~ | ✅ Fixed | 3 CRON jobs live: `process-scheduled-social-posts` (every min), `autopilot-fill-daily` (2 AM UTC), `refresh-social-tokens-daily` (3 AM UTC) |
| 2 | ~~Instagram token expires (60 days)~~ | ✅ Fixed | `refresh-tokens` edge function deployed, runs daily at 3 AM UTC, auto-refreshes within 7 days of expiry |
| 3 | ~~Instagram needs reconnection~~ | ✅ Fixed | Reconnected March 15. Token valid 60 days. Auto-refresh CRON will maintain it. |
| 4 | **Pinterest stuck in sandbox** | 🟠 High | Both OAuth and posting use `api-sandbox.pinterest.com`. Token expired. Needs production API access from Pinterest. |
| 5 | ~~No image generation/enhancement~~ | ✅ Fixed | Full AI image pipeline: gpt-image-1 img2img, 18.9M scene combos, quality scoring, seasonal awareness, smart dedup |
| 6 | ~~No PWA~~ | ✅ Fixed | manifest.json, service worker, offline page, install prompt, push notifications all deployed |
| 7 | **Amazon SP-API** | 🟡 Blocked | Registration submitted Feb 24, 2026 — pending review. Nothing built. |
| 8 | **eBay API** | 🟡 Not started | Not even registered yet. |
| 9 | **Review email notifications** | 🟡 Low | Admin + customer coupon emails after approval — needs email provider. |
| 10 | ~~Hardcoded keys in social/index.js~~ | ✅ Fixed | Now imports from `config/env.js` |

---

## Phase 1: Get Content Actually Posting
> **Goal:** Posts going out automatically on Instagram + Facebook  
> **Priority:** 🔴 NOW  
> **Estimated effort:** 1-2 sessions

- [x] Configure `process-scheduled-posts` CRON job → live, running every minute
- [x] Configure `autopilot-fill` CRON job → live, daily at 2 AM UTC
- [x] Add Instagram/Facebook token auto-refresh → `refresh-tokens` edge function deployed + CRON at 3 AM UTC
- [x] Fix hardcoded Supabase keys in social/index.js → now imports from `config/env.js`
- [x] Deploy `refresh-tokens` edge function to Supabase
- [x] Run CRON setup SQL on remote DB (3 jobs active)
- [x] Enable autopilot in admin Social settings ← done March 15
- [x] Reconnect Instagram/Facebook — done March 15, 60-day token active
- [x] Test full loop — autopilot generated 28 posts, scheduled starting March 16
- [ ] Verify posts appear live on Instagram + Facebook (check March 16 @ 10 AM UTC)

---

## Phase 2: Solve the Image Problem
> **Goal:** Social-ready visuals from supplier images without photoshoots  
> **Priority:** 🟠 HIGH  
> **Estimated effort:** 3-5 sessions

- [x] AI image generation pipeline (`generate-social-image` edge function) — deployed + tested
  - gpt-image-1 `/v1/images/edits` (true image-to-image, product photo as reference)
  - DALL-E 3 text-to-image fallback when no catalog photo exists
- [x] 18.9M scene randomizer — 30 envs × 15 lighting × 12 comps × 14 moods × 25 props × 10 cameras
- [x] Seasonal awareness — spring/summer/fall/winter pools, 60/40 weighted selection
- [x] Smart scheduling dedup — SceneFingerprint (env/mood/camera), avoids last 5 scenes per product
- [x] Quality scoring — GPT-4o-mini Vision compares generated vs original, auto-approve 8+, review 5-7, reject <5
- [x] Image blacklist system (`image_blacklist` table + admin UI) — blacklist bad product images from autopilot
- [x] Image review queue (`social_generated_images` table with pending_review/approved/rejected workflow)
- [x] Admin UI: "AI Images" tab with review queue, approved gallery, blacklist manager, pipeline settings
- [x] Auto-queue integration: checks blacklist → uses approved AI images → generates new ones → pending_review
- [x] Pipeline settings: model, quality, max daily, style presets, require review toggle
- [x] Category-aware prompts for all 6 product categories (accessories, headwear, bags, jewelry, plushies, lego)
- [x] Carousel image sets — generates 3-5 images with shared `carousel_set_id`, locked camera style for visual coherence, narrative composition flow (wide → hero → angled → close-up → held)
- [x] Auto-queue carousel support — `shouldUseCarousel()` checks Image Pool first (3+ images → 50% chance), then AI images (3+ → 50% chance). `resolveStorageUrl()` converts relative storage paths to full public URLs for Instagram Graph API. Calendar shows 🎠 badge on carousel posts.
- [x] Supplier image auto-import (`import-product-images` edge function) — downloads external URLs to Supabase Storage, dedup, auto-updates product records. Auto-fires on product save.
- [x] DB migration: `carousel_set_id` on `social_generated_images`, `imported_product_images` table
- [~] Text/price overlay generator for promo posts — deferred (low priority)

---

## Phase 3: PWA + Push Notifications
> **Goal:** App-like experience on mobile, admin order alerts  
> **Priority:** 🟡 MEDIUM  
> **Estimated effort:** 1-2 sessions

- [x] Create `manifest.json` (app name, icons, 10 icon sizes + maskable variants, display: standalone)
- [x] Build service worker (network-first pages, cache-first images, stale-while-revalidate CSS/JS, offline fallback)
- [x] "Add to Home Screen" install banner (auto-shows on eligible devices, dismissible)
- [x] PWA icons generated: 72–512px + maskable + apple-touch-icon + favicons
- [x] Web push notifications (VAPID keys, subscription flow, soft permission prompt)
- [x] `send-push-notification` edge function — sends to all/admin/customers, auto-cleans stale subs
- [x] Admin push notification on new Stripe order via webhook (fire-and-forget)
- [x] Admin Settings: push notification composer panel (send to all/admin/customers)
- [x] Admin device registration (mark subscription as admin for order alerts)
- [x] Push subscription stored in `push_subscriptions` table, notification log in `push_notifications_log`
- [x] PWA tags + service worker registered in all 34 HTML pages
- [ ] Optional: customer push for order shipped / review reminder (future)

---

## Phase 4: Marketplace API Integrations
> **Goal:** Manage Amazon + eBay listings from admin panel  
> **Priority:** 🟡 MEDIUM (blocked on API approvals)  
> **Estimated effort:** 5+ sessions

### Amazon SP-API (registration pending)
- [ ] Auto-import orders → unified order dashboard
- [ ] Catalog sync (product data + images)
- [ ] Competitor pricing intelligence
- [ ] Settlement report import
- [ ] Price alerts

### eBay API (not started)
- [ ] Register for eBay Developer Program
- [ ] OAuth + listing management
- [ ] Order sync to admin panel
- [ ] Inventory sync across platforms

---

## Phase 5: Growth & Polish
> **Goal:** Optimize conversions, expand reach  
> **Priority:** 🔵 LATER

- [ ] Instagram comment → auto-DM coupon (needs Meta App Review for permissions)
- [ ] Pinterest production API access + token refresh
- [ ] Review email notifications (Resend.com or similar)
- [ ] Admin public replies to reviews
- [ ] Review helpfulness voting
- [ ] SEO blog / content pages for organic search traffic
- [ ] TikTok integration (product videos from images)
- [ ] Email marketing (abandoned cart, new arrivals, review requests)

---

## Architecture Notes

### Social Media Posting Flow
```
Product in DB
  → autopilot-fill (daily CRON) checks calendar gaps
    → auto-queue generates posts (AI captions + product images)
      → process-scheduled-posts (every-minute CRON) fires when scheduled_for <= now
        → dispatches to instagram-post / facebook-post / pinterest-post
          → post-learning engine analyzes engagement
            → feeds learnings back into next caption generation
```

### Key Supabase Edge Functions
| Function | Purpose |
|----------|---------|
| `ai-generate` | GPT-4o-mini captions, hashtags, scoring, insights |
| `ai-product-fill` | GPT-4o vision → product descriptions from images |
| `auto-queue` | Generate scheduled posts from product catalog |
| `autopilot-fill` | Auto-fill content calendar gaps (CRON trigger) |
| `auto-repost` | Resurface high-engagement posts |
| `process-scheduled-posts` | Publish queued posts when time arrives |
| `instagram-post` | Single image post to Instagram |
| `instagram-carousel` | Multi-image carousel to Instagram |
| `facebook-post` | Post to Facebook Page |
| `pinterest-post` | Create pin on Pinterest |
| `instagram-insights` | Pull engagement metrics |
| `create-checkout-session` | Stripe checkout |
| `stripe-webhook` | Handle Stripe events |
| `submit-review` | Customer review submission |
| `verify-order` | Verify order for review eligibility |
| `refresh-tokens` | Auto-refresh Instagram/Facebook/Pinterest tokens |
| `generate-social-image` | AI image generation (gpt-image-1 img2img + quality scoring + carousel sets) |
| `import-product-images` | Download external supplier images to Supabase Storage |
| `send-push-notification` | Send web push notifications to subscribed browsers |
| `shippo-create-label` | Buy shipping label for one order via Shippo |
| `shippo-void-label` | Void/refund unused shipping label |
| `shippo-webhook` | Receive Shippo tracking updates (PRE_TRANSIT/TRANSIT/DELIVERED) |
| `send-review-request` | Send SMS review request on delivery |
| `lookup-orders` | Customer order lookup (returns shipment tracking) |

### Active CRON Jobs (pg_cron)
| Job | Schedule | Function |
|-----|----------|----------|
| `process-scheduled-social-posts` | Every minute | `process-scheduled-posts` |
| `autopilot-fill-daily` | 2:00 AM UTC daily | `autopilot-fill` |
| `refresh-social-tokens-daily` | 3:00 AM UTC daily | `refresh-tokens` |
| `instagram-insights-sync` | Every 6 hours | `instagram-insights` |
| `instagram-insights-weekly-sync` | 3:00 AM UTC Sundays | `instagram-insights` |

---

*This is a living document. Update as phases are completed.*
