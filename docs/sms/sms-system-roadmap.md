# Karry Kraze SMS System Roadmap

## 🎯 Goal
Build a fully custom SMS marketing and automation system using:
- Supabase (database + edge functions)
- Twilio (SMS delivery)
- Website frontend (HTML + JS)

The system should:
- Collect phone numbers with proper SMS consent
- Store and manage SMS subscribers
- Send automated and campaign-based SMS messages
- Support segmentation (repeat buyers, product viewers, etc.)
- Handle opt-in and opt-out states properly

---

## 🧱 Current Stack
- Frontend: HTML + Tailwind + JS (no build step)
- Backend: Supabase (Postgres, Auth, Edge Functions)
- Payments: Stripe
- SMS Provider: Twilio (toll-free +18883925295, A2P 10DLC registered)
- Hosting: GitHub Pages

---

## ✅ Phase 1: SMS Opt-In + Coupon System — COMPLETE (Apr 13, 2026)

### What Was Built

#### Landing Page (`pages/sms-signup.html` + `js/sms-signup/index.js`)
- Coupon-focused landing page: "Get 15% Off Your Next Order"
- Phone input with live formatting `(XXX) XXX-XXXX`, US-only validation
- Optional email field for future email marketing
- Required consent checkbox with legal language
- Success state reveals coupon code with fade-up animation
- Duplicate prevention: returns existing coupon for returning visitors
- localStorage flag `kk_sms_subscribed` prevents re-showing forms

#### Database (migration: `supabase/migrations/20260413_sms_tables.sql`)
- **`customer_contacts`** — Multi-channel contact hub
  - phone (E.164, UNIQUE, CHECK constraint for US numbers)
  - email, status (active/unsubscribed/bounced), sms_consent, email_consent, push_consent
  - coupon_code, source, campaign columns for attribution
- **`sms_consent_logs`** — Immutable audit trail
  - phone, consent_type (opt_in/opt_out), consent_text, ip_address, user_agent, page_url
- **`sms_messages`** — Delivery log
  - phone, body, direction (outbound/inbound), status, provider_message_sid, campaign
- **RLS**: service_role full access, authenticated read-only, no anon access
- **`site_settings`** row: `sms_coupon` config (type, value, min_order_amount, expiry_days, prefix)

#### Edge Functions
- **`sms-subscribe`** — Public signup endpoint
  - Validates US phone, normalizes to E.164
  - Rate limits 3/IP/hour via consent_logs
  - Generates unique `SMS-XXXXXX` coupon code
  - Creates promotion in `promotions` table (15% off $40+, single-use, requires_code)
  - Inserts/updates customer_contacts + consent log
  - Sends SMS via Twilio REST API inline
  - Logs to sms_messages with campaign tracking
  - Handles duplicates: returns existing coupon with `already_subscribed: true`
- **`send-sms`** — Reusable Twilio wrapper for future campaigns/automations
- **`twilio-webhook`** — Inbound message + delivery status handler
  - Validates X-Twilio-Signature
  - Handles STOP/UNSUBSCRIBE/CANCEL/END/QUIT keywords → opt-out
  - Marks contacts as bounced on error codes 30005/30006/21610
  - Updates sms_messages delivery status
  - Returns TwiML responses

#### Coupon Strategy (data-driven)
- AOV analysis: $36.73 average, $23.99 median, 86.3% margin
- 57.7% of orders under $25 → $40 minimum drives AOV up ~9%
- 15% discount at 86% margin preserves profitability
- Coupon: 15% off orders $40+, single-use, 2-day expiry

#### Compliance
- Consent text recorded with every opt-in
- Every SMS includes "Reply STOP to unsubscribe"
- STOP keyword handling via Twilio webhook
- IP-based rate limiting
- Immutable consent audit trail

### Twilio Config
- Account SID: stored in Supabase secrets (`TWILIO_ACCOUNT_SID`)
- From number: `+18883925295` (toll-free, A2P registered)
- Webhook URL configured: `https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/twilio-webhook`
- Secrets set via `npx supabase secrets set`

---

## 🔜 Phase 2: Automation Flows + Event Tracking — NEXT

### Architecture Upgrades (Before Building Flows)

#### 1. `sms_sends` Table (Separation of Concerns)
Split send orchestration from delivery logging:

| Column | Purpose |
|--------|---------|
| `id` | Primary key |
| `phone` | Recipient |
| `campaign` | Campaign name |
| `flow` | `abandoned_cart`, `welcome`, `coupon_reminder`, etc. |
| `send_reason` | What triggered this send |
| `intent` | `marketing` \| `transactional` \| `system` |
| `cost` | Twilio cost per segment ($0.0079/SMS, estimated at send, updated via webhook) |
| `outcome` | `pending` \| `converted` \| `not_converted` — updated by attribution logic/webhook |
| `expected_value` | Estimated revenue at send time (based on segment conversion rate) |
| `expected_conversion_rate` | Predicted conversion % at send time (for benchmarking) |
| `product_context` | jsonb: `{product_id, category, price, margin}` — enables margin-aware messaging |
| `user_state_snapshot` | jsonb: `{cart_value, order_count, segment, last_activity, ltv}` |
| `sms_message_id` | FK → sms_messages (delivery details) |
| `created_at` | Timestamp |

- `sms_messages` stays as the delivery log (status, provider_message_sid)
- `sms_sends` is the analytics/orchestration layer
- Cleaner aggregation: group by flow, campaign, intent
- `user_state_snapshot` captures context at send time so you can later answer "what worked and WHY" without losing historical context
- `outcome` field updated async: `converted` when purchase attributed, `not_converted` after attribution window expires, enables instant query of winning strategies and future AI training
- `expected_value` vs actual revenue = performance benchmarking per campaign/flow/segment
- `product_context` enables margin-aware messaging: don't push low-margin items, prioritize high-margin cross-sells

#### 2. Message Intent Classification
Every SMS is tagged with intent:

| Intent | Examples | Caps? | Quiet Hours? |
|--------|----------|-------|--------------|
| `marketing` | Campaigns, coupons, promos | Yes | Yes |
| `transactional` | Order confirm, shipping update | No | No |
| `system` | OTP, password reset | No | No |

- Intent drives frequency cap enforcement and quiet hours logic
- All send functions check intent before applying rules

#### 3. Quiet Hours (Hard Enforcement)
- **No marketing SMS before 9:00 AM or after 9:00 PM** (recipient local time)
- Enforced in ALL send functions, not just campaign sends
- Transactional/system messages bypass quiet hours
- Future: timezone-aware per subscriber (store timezone on `customer_contacts`)
- Without this → carrier filtering, complaints, Twilio trust score damage

#### 4. `sms_queue` Table (Hold Queue for Quiet Hours + Deferrals)
Instead of silently skipping sends, queue them deterministically:

| Column | Purpose |
|--------|---------|
| `id` | Primary key |
| `phone` | Recipient |
| `payload` | jsonb: full message body, redirect_url, campaign, flow, product_context |
| `intent` | `marketing` \| `transactional` \| `system` |
| `scheduled_at` | When to send (next valid window) |
| `status` | `queued` \| `sent` \| `cancelled` |
| `created_at` | When originally attempted |

**Flow:**
- Send function checks quiet hours + frequency caps
- If blocked → insert into `sms_queue` with `scheduled_at` = next valid window
- pg_cron runs every 5 min, processes queued sends where `scheduled_at <= now()`
- If user purchases or unsubscribes before send → mark `cancelled`
- Makes the system **reliable + deterministic** — no lost messages, no silent failures

#### 5. Fatigue Score (Smarter Than Caps)
Frequency caps are binary. Fatigue scoring is continuous:

```
fatigue_score = (SMS sent in last 7 days) - (time decay factor)
```

- Stored on `customer_contacts.fatigue_score`, recalculated on each send
- **+1** per SMS sent
- **-0.15/day** natural decay
- **-1** per click or purchase (engagement resets fatigue)
- Thresholds:
  - Score < 3: send freely
  - Score 3–5: reduce to high-priority messages only
  - Score > 5: pause marketing, transactional only
- This prevents burnout while prioritizing engaged users
- Replaces hard caps at scale (caps remain as safety net)

### Priority #1: Abandoned Cart SMS Flow (TOP REVENUE DRIVER)
Cart persistence required — save cart state to Supabase for logged-in users or via phone lookup.

**Flow (3-touch escalation):**
1. **30 min** → "You left something behind 👀" (no discount, just reminder)
2. **6 hours** → Social proof / urgency ("Only 2 left!" or "X people bought this today")
3. **24 hours** → Discount offer (this is where the 15% coupon lives, not upfront)

- Edge function: `sms-abandoned-cart` triggered by pg_cron
- Track `abandoned_cart_id` in sms_messages for attribution
- Stop sequence immediately if user completes purchase

### Priority #2: Click Tracking + Event System
Without this, we're blind on ROI.

#### Click Infrastructure (Unique Link Per Message)
Every SMS gets a trackable short link:
```
karrykraze.com/r/{sms_message_id}
```
- Edge function `sms-redirect`: logs click to `sms_events`, then 302 redirects to product/page URL
- Link stored in `sms_messages.redirect_url` (target) and `sms_messages.short_code` (unique ID)
- Without unique links per message, attribution breaks completely

#### Event Tracking (sms_events table)
| Event | Source | How |
|-------|--------|-----|
| `sms_clicked` | `/r/{id}` redirect | `sms-redirect` edge function logs + redirects |
| `coupon_redeemed` | Checkout | Stripe webhook / checkout edge function |
| `order_attributed_to_sms` | Post-purchase | Match order phone → customer_contacts |
| `sms_opened` | N/A | SMS has no open tracking (unlike email) |

- New table: `sms_events` (event_type, phone, metadata jsonb, sms_message_id, created_at)
- Hook into existing `create-checkout-session` to tag SMS-attributed orders

#### Attribution Window
Don't over-credit SMS. An order is SMS-attributed only if:
- Purchase happens **within 24–72 hours** of last SMS click
- Or coupon code from SMS is used (direct attribution, no window needed)
- Without a window, organic purchases get falsely credited to SMS

### Priority #3: Dynamic Coupon Logic
Replace static `site_settings.sms_coupon` with context-aware offers:

| Scenario | Offer | Why |
|----------|-------|-----|
| New subscriber, no history | 15% off $40+ | Standard acquisition offer |
| Low cart (< $25) | 15% off (no minimum) | Get them to convert |
| Mid cart ($25–$39) | 10% off $35+ | Nudge AOV up |
| High cart ($40+) | $5 off | Fixed savings, higher margin preserved |
| Returning subscriber | Smaller discount or free shipping | Don't over-discount loyal users |
| Abandoned cart (24h) | 15% off $40+ | Last resort, highest intent |

- `sms-subscribe` reads customer history before generating coupon
- Use order count + lifetime value from orders table

#### "Do Not Discount" Segment (High-Value Customers)
Customers with 2+ purchases or top 20% LTV should **NEVER get big discounts.**

Instead, offer:
- Early access to new drops
- Exclusive products / bundles
- Free shipping
- Loyalty rewards

👉 Big discounts devalue the brand for your best customers and train them to wait for deals

### Priority #4: Coupon Reminder SMS
- pg_cron job: find unused coupons after 24h
- Edge function sends reminder via `send-sms`
- Max 1 reminder per subscriber
- Track as campaign `coupon_reminder`

### Priority #5: Welcome Series (Upgraded)
Delay the discount, escalate over time:
1. **Day 0** → "Welcome to Karry Kraze! Here's what's trending 🔥" (no discount)
2. **Day 2** → "Our best sellers this week" + product link
3. **Day 5** → "Still thinking about it? Here's 10% off" (earned discount)

### Priority #6: Frequency Caps (Enforced at DB Level)
Prevent spam complaints, unsubscribes, and Twilio risk flags.

- Add `last_sms_sent_at` column on `customer_contacts`
- **Rules enforced in every send function (marketing intent only):**
  - Max **1 marketing SMS per day**
  - Max **4 marketing SMS per week**
  - Minimum **6 hours** between marketing messages
  - **Quiet hours: no marketing SMS before 9 AM / after 9 PM**
- Edge functions check `last_sms_sent_at` + `intent` before sending, skip/queue if restricted
- Transactional + system messages bypass all caps and quiet hours
- `sms_sends.intent` column is the enforcement key

### Also Planned
- **Order confirmation SMS** — Triggered by Stripe webhook on successful payment
- **Shipping update SMS** — When shipping_status changes

---

## 📊 Phase 3: Campaign System

### Campaign Builder (Admin UI)
- Compose + preview SMS messages
- **Campaign templates** — Save and reuse winning messages
- Character count + segment count preview
- Schedule send or send immediately

### Audience Targeting
- Filter by: repeat buyers, high spenders, inactive, product category
- **"Send to non-buyers only"** — Subscribed but never purchased after SMS
- **"Resend to non-openers"** — (track via link clicks since SMS has no open tracking)
- Exclude recently messaged (frequency cap)

### Scheduling
- Send at optimal times, timezone-aware
- Respect quiet hours (no SMS before 9am or after 9pm)

### A/B Testing
- Test message variants (body, offer, CTA)
- Auto-select winner after N sends
- Track conversion rate per variant
- **"Send Winner Automatically"** — After statistical significance reached, auto-route 80% of remaining traffic to winner → self-optimizing campaigns

### Campaign Analytics
- Delivery rate, click-through, revenue attribution via `campaign` column
- Cost per conversion
- Compare campaign performance over time

---

## 🧠 Phase 4: Analytics Dashboard — THE EDGE

This is where data turns into decisions.

### KPIs to Track
| Metric | What It Tells You |
|--------|-------------------|
| **Profit per SMS** | Not just revenue — actual profit after discount + Twilio cost |
| **SMS vs non-SMS AOV** | Do SMS customers spend more? |
| **Time-to-purchase after SMS** | How fast do SMS subscribers convert? |
| **Coupon redemption rate** | Are offers compelling enough? |
| **Revenue per subscriber** | Lifetime value of SMS channel |
| **Cost per acquisition** | Twilio cost / new customers from SMS |
| **Subscriber growth** | Net new subscribers over time |
| **Churn rate** | STOP rate and bounce rate |

### Segments to Build
- Repeat buyers (2+ orders)
- High spenders (top 20% by lifetime value)
- Product category affinity (headwear fans, jewelry fans, etc.)
- Inactive subscribers (no purchase in 30+ days)
- Coupon redeemers vs non-redeemers
- SMS-acquired vs organic customers

### Admin Dashboard
- Real-time subscriber count + growth chart
- Campaign performance table
- Revenue attribution breakdown (which SMS drove which sales)
- Funnel: SMS sent → clicked → purchased → profit

---

## 🔮 Phase 5: Behavior-Based Trigger System

### Strategic Shift
Move from "send campaigns to everyone" to "use SMS as a behavior-based trigger system."

### Behavioral Triggers
| Trigger | Action |
|---------|--------|
| User viewed product 3+ times | "Still thinking about {product}? It's selling fast" |
| User inactive 14 days | Re-engagement SMS with personalized offer |
| User bought jewelry | Cross-sell headwear or accessories |
| User's birthday/anniversary | Special offer |
| Price drop on viewed item | "Good news! {product} just dropped to ${price}" |

### AI-Powered Features
- **AI-generated campaigns** — Use past performance data to write messages
- **Predictive send times** — Optimal send time per individual user
- **Personalized offers** — Dynamic discount based on user's price sensitivity
- **Product recommendations** — Based on purchase history + browsing

### Multi-Channel Expansion
- Email marketing (customer_contacts already has email_consent)
- Push notifications (customer_contacts already has push_consent)
- Coordinated messaging across channels (don't SMS + email the same offer)

### Advanced
- Loyalty program integration
- Referral codes via SMS
- Conversational SMS (customer service)

---

## 🧩 Philosophy

We are not building "SMS marketing." We are building:

> **A first-party data monetization engine.**

Because we control the data, logic, and messaging — we outperform any SaaS tool long-term.

### Principles
- **Behavior-driven, not blast-driven** — Trigger messages based on actions, not schedules
- **Data-informed offers** — Every discount is backed by AOV/margin analysis
- **Attribution-first** — Every SMS maps to revenue (or lack thereof)
- **Compliance by default** — Consent, opt-out, and audit trails are foundational, not afterthoughts
- **Full ownership** — No vendor lock-in, no per-message SaaS markup, no black-box algorithms