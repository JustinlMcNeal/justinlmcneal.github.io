# Karry Kraze SMS System Audit

Audit date: May 7, 2026  
Scope: read-only inspection of the current Karry Kraze SMS marketing and SMS-adjacent code paths. No production logic was modified.

## 1. Executive Summary

Karry Kraze has a live Supabase + Twilio SMS system that currently supports:

- Public SMS signup with coupon delivery.
- Coupon upgrade enrollment from coupon landing pages.
- STOP/unsubscribe processing through a Twilio webhook.
- Delivery status updates from Twilio into message logs.
- Coupon reminder and coupon escalation automation.
- Abandoned cart tracking and a 3-step abandoned-cart SMS sequence.
- A Day 2 / Day 5 welcome series.
- SMS click tracking through short redirect links.
- SMS-to-purchase attribution through direct coupon matching and 48-hour click windows.
- Admin analytics dashboard for SMS flow, coupon, funnel, fatigue, and click-to-purchase performance.

The system already has useful data for a future OpenClaw read-only analyst or draft-mode strategist. It is not yet safe for fully autonomous AI sending because copy, compliance, queueing, fatigue scoring, message approval, and some attribution/logging paths are incomplete or inconsistent.

Important findings:

- Marketing guardrails exist in `send-sms`, `sms-coupon-reminder`, `sms-abandoned-cart`, and `sms-welcome-series`, including quiet hours and frequency checks.
- Several automation functions send Twilio messages directly instead of using the central `send-sms` guardrail wrapper.
- `sms_queue` exists but no active processor was found in codebase.
- `sms-redirect` logs clicks but updates `customer_contacts.last_sms_sent_at` on click, which looks like a field misuse because no `last_click_at` column was found.
- `twilio-webhook` handles STOP words but START/resubscribe handling was not found in codebase.
- Some cron SQL files contain hardcoded bearer tokens; those should be rotated and moved to safer deployment/config practices before AI automation.

## 2. System Map

### End-to-end flow

| Stage | What happens | Files / tables involved |
|---|---|---|
| Visitor sees opt-in | SMS signup page, post-purchase success page, or coupon landing page asks for phone and consent. | `pages/sms-signup.html`, `js/sms-signup/index.js`, `pages/success.html`, `js/success/index.js`, `pages/coupon.html`, `js/coupon/index.js` |
| Frontend sends enrollment request | Frontend posts phone, optional email, consent text, page URL, and user agent to an Edge Function. | `sms-subscribe`, `coupon-upgrade` |
| Edge Function normalizes and validates | Phone is normalized to US E.164, consent text is required, IP rate limiting is checked. | `customer_contacts`, `sms_consent_logs` |
| Coupon is created | Signup, upgrade, escalation, abandoned-cart discount, and welcome Day 5 flows create single-use rows in `promotions`. | `promotions`, `site_settings`, `coupon_upgrades` |
| Contact record is created or updated | Phone and consent state are stored. | `customer_contacts` |
| Consent audit is logged | Exact consent text, source, page URL, IP, and user agent are logged for opt-ins; STOP opt-outs are logged too. | `sms_consent_logs` |
| SMS is sent | Twilio REST API sends message. Some flows call Twilio directly; `send-sms` is the reusable wrapper. | Twilio API, `sms_messages`, `sms_sends` |
| Twilio callback updates status | Twilio status callbacks update delivery state and bounce handling. Inbound STOP marks contact unsubscribed. | `twilio-webhook`, `sms_messages`, `customer_contacts`, `sms_consent_logs` |
| Click tracking | SMS copy includes `karrykraze.com/r/?c={short_code}`. The static `/r/` page forwards to `sms-redirect`, which logs the click and redirects to the target. | `r/index.html`, `sms-redirect`, `sms_messages.short_code`, `sms_events` |
| Purchase attribution | Stripe webhook marks orders as SMS-attributed by `SMS-` coupon or latest click in the previous 48 hours. | `stripe-webhook`, `orders_raw`, `sms_events`, `sms_sends` |
| Analytics | Views aggregate send, click, conversion, revenue, profit, coupon cohort, fatigue, and cart recovery metrics. | `sms_v_flow_performance`, `sms_v_coupon_cohorts`, `sms_v_click_to_purchase`, `sms_v_subscriber_funnel`, `sms_v_fatigue_monitor`, `sms_v_contact_fatigue`, `sms_v_abandoned_cart` |

### Abandoned cart flow map

1. SMS signup returns `contact_id`.
2. Frontend stores it in `localStorage` as `kk_sms_contact_id`.
3. `cartStore.js` listens for `kk-cart-updated` and sends debounced cart snapshots to `cart-sync`.
4. `cart-sync` upserts `saved_carts` rows for active SMS contacts.
5. `sms-abandoned-cart` cron checks active carts every 5 minutes.
6. Eligible carts receive Step 1, Step 2, and Step 3 SMS based on timing.
7. `stripe-webhook` marks active carts as `purchased` when matching phone orders complete.

## 3. File Inventory

| File path | Purpose | SMS-related responsibilities | Notes / risks |
|---|---|---|---|
| `supabase/functions/sms-subscribe/index.ts` | Public SMS signup endpoint | Validates phone, logs consent, creates or reuses signup coupon, upserts `customer_contacts`, sends Twilio SMS, logs `sms_messages` and `sms_sends`, returns `contact_id`. | Sends Twilio directly instead of central `send-sms`; first message bypasses central caps. |
| `supabase/functions/send-sms/index.ts` | Reusable Twilio wrapper | Sends SMS, logs delivery and analytics rows, enforces marketing quiet hours, consent, 6-hour gap, daily cap, weekly cap. | Not all flows use it; `message_type` callers must match DB constraint. |
| `supabase/functions/twilio-webhook/index.ts` | Twilio inbound/status webhook | Validates Twilio signature, handles STOP words, logs opt-out, updates delivery statuses, marks certain failures as bounced. | No START handling found; returns 405 for non-POST including OPTIONS. |
| `supabase/functions/sms-coupon-reminder/index.ts` | Scheduled coupon reminders and escalations | Sends 24h unused coupon reminder; creates 20% escalation coupon after expiry; logs sends/click codes. | Uses direct Twilio sending; duplicate helper logic; suspicious `hours_since_signup` calculation uses `new Date(contact.coupon_code)`. |
| `supabase/functions/sms-abandoned-cart/index.ts` | Scheduled abandoned cart flow | Processes `saved_carts`, sends 30m/6h/24h sequence, creates abandoned cart coupons, suppresses serial abandoners. | Uses direct Twilio sending; depends on exact phone match in `orders_raw.phone_number`; high-value coupon strategy is hardcoded. |
| `supabase/functions/sms-welcome-series/index.ts` | Scheduled welcome series | Sends Day 2 discovery message and Day 5 10% coupon if no purchase. | Uses direct Twilio sending; only targets contacts created 2-7 days ago. |
| `supabase/functions/sms-redirect/index.ts` | Click tracking redirect | Looks up `sms_messages.short_code`, inserts `sms_events.sms_clicked`, redirects to target URL. | Updates `last_sms_sent_at` on click; likely should be `last_click_at`, but no such column was found. |
| `supabase/functions/cart-sync/index.ts` | Public cart snapshot sync | Receives SMS subscriber cart snapshots and writes `saved_carts`. | Public endpoint trusts possession of `contact_id`; best-effort but PII/cart data exposure risk if IDs leak. |
| `supabase/functions/coupon-upgrade/index.ts` | Coupon landing page SMS upgrade endpoint | Creates personal upgrade coupon, enrolls phone in SMS marketing, logs consent, sends SMS, logs message/send. | Opt-in checkbox is not explicit in frontend; consent text is displayed but submission does not require a checkbox. |
| `supabase/functions/stripe-webhook/index.ts` | Stripe order ingestion and post-purchase actions | Attributes orders to SMS by coupon/click, updates `orders_raw`, logs `sms_events`, marks `sms_sends` converted, marks saved carts purchased. | Attribution only checks `SMS-` prefix directly; `AC-`, `ACV-`, `WS-`, and upgrade coupons mostly rely on click-window attribution. |
| `supabase/functions/send-review-request/index.ts` | Admin/batch review request SMS | Sends review request SMS through Twilio after consent check, inserts `review_requests`, logs `sms_sends`. | Logs no `sms_messages` row; comment mentions `sms_sends`; batch comments mention old `sms_subscribers`; direct `shippo-webhook` call appears incompatible with expected payload. |
| `supabase/functions/shippo-webhook/index.ts` | Shipping event webhook | Sends shipped/delivered transactional SMS through `send-sms`; triggers review request helper. | Uses `message_type: shipping_notification`, but DB constraint in inspected migration does not include that value. |
| `pages/sms-signup.html` | Public SMS signup landing page | Presents phone/email fields and consent text. | Consent copy is shorter than post-purchase copy and does not mention recurring automated marketing or consent-not-condition language. |
| `js/sms-signup/index.js` | SMS signup frontend logic | Formats/validates phone, requires consent checkbox, posts to `sms-subscribe`, stores `kk_sms_contact_id`. | Stores contact ID in localStorage for cart tracking. |
| `pages/success.html` | Post-purchase success page | Displays optional SMS opt-in card and legal consent checkbox. | Shows “~2×/month” expectation; backend caps can exceed 2/month over time. |
| `js/success/index.js` | Post-purchase opt-in frontend | Prefills order phone, hides card for active contacts, posts to `sms-subscribe`. | Queries `customer_contacts` from frontend through authenticated/anon client; RLS allows authenticated reads only, so behavior depends on auth state. |
| `js/shared/cartStore.js` | LocalStorage cart store | Stores cart, dispatches cart update events, sends debounced `cart-sync` for SMS contacts. | Cart sync is silent best-effort; no retry/error visibility. |
| `r/index.html` | Static tracking redirect page | Extracts `?c=` and forwards to `sms-redirect`. | Noindex page; safe static bridge for GitHub Pages. |
| `pages/coupon.html` | Public coupon landing page | Contains phone input for “text-to-unlock upgrade.” | No explicit checkbox in inspected HTML; consent text is displayed only. |
| `js/coupon/index.js` | Coupon landing page frontend | Formats phone, posts to `coupon-upgrade`, passes consent text/page/user agent. | Does not require explicit checkbox confirmation before enrollment. |
| `pages/admin/sms-analytics.html` | Admin SMS analytics page | UI shell for SMS performance dashboard. | Read-only dashboard. |
| `js/admin/smsAnalytics/index.js` | Admin SMS dashboard logic | Reads SMS analytics views and renders KPIs, flow table, abandoned cart, cohorts, funnel, fatigue, click timing. | Bug: day delta filters `event_type === "click"` but actual click event is `sms_clicked`; deltas may undercount clicks. |
| `pages/admin/promotions.html` | Admin promotion editor | Allows editing coupon upgrade consent text/settings. | Admin-defined consent copy can drift from compliance standards. |
| `js/admin/promotions/modalEditor.js` | Promotion modal logic | Saves coupon upgrade settings and consent text to `promotions`. | Requires compliance review before AI modifies this field. |
| `page_inserts/admin-nav.html` | Admin navigation | Links to SMS Analytics. | No issue found. |
| `supabase/migrations/20260413_sms_tables.sql` | Phase 1 SMS schema | Creates contacts, consent logs, messages, default SMS coupon config. | Authenticated users can read PII-heavy tables. |
| `supabase/migrations/20260414_sms_phase2.sql` | Phase 2 SMS schema | Creates sends/events/queue; adds frequency, fatigue, redirect, attribution fields. | `sms_queue` exists but no processor found. |
| `supabase/migrations/20260414_saved_carts.sql` | Saved cart schema | Creates `saved_carts`. | Service-role-only RLS. |
| `supabase/migrations/20260414_saved_carts_hardening.sql` | Saved cart hardening | Adds cart hash, abandoned timestamps, step timestamps, abandon count. | Supports duplicate and serial-abandoner controls. |
| `supabase/migrations/20260414_abandoned_cart_analytics.sql` | Abandoned cart analytics view | Creates `sms_v_abandoned_cart`. | View exposes aggregate cart metrics. |
| `supabase/migrations/20260414_sms_analytics_views.sql` | SMS analytics views | Creates six plus one detailed analytics views. | Views read from PII tables; read permissions depend on underlying grants. |
| `supabase/migrations/20260414_fix_message_type_constraint.sql` | Message type constraint update | Adds abandoned cart and welcome message types. | Does not include `shipping_notification`. |
| `supabase/migrations/20260506_coupon_upgrade.sql` | Coupon upgrade schema | Adds promotion upgrade columns and `coupon_upgrades`. | `coupon_upgrades` has authenticated read policy. |
| `supabase/SETUP_SMS_CRON.sql` | Coupon reminder cron setup | Schedules `sms-coupon-reminder` hourly at :30. | Uses `current_setting('app.settings.service_role_key')`; safer than hardcoded token if configured correctly. |
| `supabase/SETUP_ABANDONED_CART_CRON.sql` | Abandoned cart cron setup | Schedules `sms-abandoned-cart` every 5 minutes. | Contains hardcoded bearer token. |
| `supabase/SETUP_WELCOME_SERIES_CRON.sql` | Welcome series cron setup | Schedules `sms-welcome-series` hourly at :45. | Contains hardcoded bearer token. |
| `supabase/SMS_COUPON_ANALYSIS.sql` | Coupon strategy analysis SQL | Analyzes orders, margins, brackets, and coupon usage for SMS coupon selection. | Manual analysis; not automated. |
| `docs/sms/sms-system-roadmap.md` | Existing roadmap/status doc | Documents SMS phases, flows, and analytics goals. | Useful context but not source of truth unless code confirms it. |

## 4. Supabase Edge Functions

### `sms-subscribe`

| Field | Details |
|---|---|
| File path | `supabase/functions/sms-subscribe/index.ts` |
| Trigger/source | Public frontend calls from `js/sms-signup/index.js` and `js/success/index.js`. |
| Input payload | `phone`, optional `email`, required `consent_text`, optional `page_url`, optional `user_agent`. |
| Output/response | JSON with `success`, `contact_id`, `coupon_code`, `sms_sent`, `was_unsubscribed`, plus flags such as `already_subscribed` or `already_redeemed`. |
| Database tables touched | Reads/writes `customer_contacts`, `sms_consent_logs`, `site_settings`, `promotions`, `sms_messages`, `sms_sends`. |
| External APIs used | Twilio Messages API. |
| Business rules | US phone normalization; consent text required; 3 requests/IP/hour based on `sms_consent_logs`; active existing contacts receive existing coupon; unsubscribed users may be reactivated; signup coupon defaults from `site_settings.sms_coupon`; click tracking short code is generated; message includes “Karry Kraze” and STOP instruction. |
| Risks / TODOs | Direct Twilio send duplicates `send-sms`; no central daily/weekly caps on first signup send; re-subscribing a Twilio Advanced Opt-Out user may still need them to text START; active already subscribed response does not send SMS. |

### `send-sms`

| Field | Details |
|---|---|
| File path | `supabase/functions/send-sms/index.ts` |
| Trigger/source | Intended internal utility; used by `shippo-webhook`; not used by most marketing automations. |
| Input payload | `to`, `body`, `message_type`, optional `intent`, `campaign`, `contact_id`, `skip_caps`. |
| Output/response | Success JSON with Twilio SID/status, blocked JSON for guardrail blocks, or error JSON. |
| Database tables touched | Reads `customer_contacts`, `sms_sends`; writes `sms_messages`, `sms_sends`, updates `customer_contacts.last_sms_sent_at`. |
| External APIs used | Twilio Messages API. |
| Business rules | Marketing intent enforces quiet hours 9 PM-9 AM ET, opt-in status, 6-hour spacing by `last_sms_sent_at`, max 1 marketing SMS per UTC day, max 4 marketing SMS per 7 days. Transactional/system bypass marketing guardrails. |
| Risks / TODOs | Quiet hours use fixed UTC-4 and does not account for daylight saving or subscriber timezone. `sms_queue` is not used for deferred sends. Function does not verify caller auth beyond whatever Supabase gateway enforces. |

### `twilio-webhook`

| Field | Details |
|---|---|
| File path | `supabase/functions/twilio-webhook/index.ts` |
| Trigger/source | Twilio inbound message webhook and status callback URL. |
| Input payload | Twilio form-encoded fields such as `MessageSid`, `SmsSid`, `MessageStatus`, `SmsStatus`, `Body`, `From`, `ErrorCode`, `ErrorMessage`. |
| Output/response | TwiML empty `<Response></Response>` for handled POSTs; 403 on signature failure; 405 for non-POST. |
| Database tables touched | Updates `customer_contacts`, inserts `sms_consent_logs`, updates `sms_messages`. |
| External APIs used | None outbound; validates Twilio signature with auth token. |
| Business rules | STOP words: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`; STOP sets status `unsubscribed`, `sms_consent=false`, `opted_out_at=now`; delivery status updates `sms_messages.status`; error codes `30005`, `30006`, `21610` mark contact `bounced`. |
| Risks / TODOs | START/YES resubscribe handling not found; non-STOP inbound messages are not logged; status updates do not update `sms_sends` delivery fields because `sms_sends` has no delivery status column. |

### `sms-coupon-reminder`

| Field | Details |
|---|---|
| File path | `supabase/functions/sms-coupon-reminder/index.ts` |
| Trigger/source | pg_cron from `supabase/SETUP_SMS_CRON.sql`, hourly at minute 30. |
| Input payload | Usually `{}`. |
| Output/response | JSON counts for reminders and escalations sent/skipped. |
| Database tables touched | Reads `customer_contacts`, `promotions`, `sms_sends`; writes `promotions`, `sms_messages`, `sms_sends`; updates `customer_contacts.last_sms_sent_at` and coupon code; deactivates old promo during escalation. |
| External APIs used | Twilio Messages API. |
| Business rules | Quiet hours; reminder for active opted-in contacts with coupon, opted in 24-48 hours ago, no prior coupon reminder, coupon still valid and unused, passes 6-hour cap. Escalation for active opted-in contacts whose coupon expired unused, lifetime one escalation per contact, creates 20% coupon for 48h. |
| Risks / TODOs | Direct Twilio send; no daily/weekly cap check beyond 6-hour gap; escalation prefix still `SMS`; attribution for escalated `SMS-` coupons can be direct. |

### `sms-abandoned-cart`

| Field | Details |
|---|---|
| File path | `supabase/functions/sms-abandoned-cart/index.ts` |
| Trigger/source | pg_cron from `supabase/SETUP_ABANDONED_CART_CRON.sql`, every 5 minutes. |
| Input payload | Usually `{}`. |
| Output/response | JSON result counts for step1, step2, step3, skipped, purchased, expired. |
| Database tables touched | Reads `saved_carts`, `customer_contacts`, `orders_raw`, `promotions`; writes `promotions`, `sms_messages`, `sms_sends`; updates `saved_carts`, `customer_contacts.last_sms_sent_at`. |
| External APIs used | Twilio Messages API. |
| Business rules | Quiet hours; active carts only; minimum cart value $15; active opted-in contacts only; suppress repeat abandoners with `abandon_count >= 3`; mark purchased if order with same phone happened after cart update; expire carts after 3 days; 6-hour frequency cap; Step 1 after 30m, Step 2 after 6h, Step 3 after 24h; high-value carts $75+ get `$5 off` with `ACV-`, others get 15% off $40+ with `AC-`. |
| Risks / TODOs | Phone matching depends on exact format of `orders_raw.phone_number`; direct Twilio send; no central daily/weekly cap; hardcoded copy and coupon strategy. |

### `sms-welcome-series`

| Field | Details |
|---|---|
| File path | `supabase/functions/sms-welcome-series/index.ts` |
| Trigger/source | pg_cron from `supabase/SETUP_WELCOME_SERIES_CRON.sql`, hourly at minute 45. |
| Input payload | Usually `{}`. |
| Output/response | JSON result counts for `day2_sent`, `day5_sent`, `skipped`. |
| Database tables touched | Reads `customer_contacts`, `sms_sends`, `saved_carts`, `orders_raw`, `promotions`; writes `promotions`, `sms_messages`, `sms_sends`; updates `customer_contacts.last_sms_sent_at`. |
| External APIs used | Twilio Messages API. |
| Business rules | Quiet hours; contacts created 2-7 days ago; active + opted-in; skip fatigue score >= 8; 6-hour cap; skip if abandoned cart flow active; Day 2 discovery once; Day 5 only after Day 2 and no purchase since signup; creates `WS-` 10% coupon for 48h. |
| Risks / TODOs | Fatigue score is read but no recalculation logic was found; direct Twilio send; no daily/weekly cap. |

### `sms-redirect`

| Field | Details |
|---|---|
| File path | `supabase/functions/sms-redirect/index.ts` |
| Trigger/source | Static `/r/` redirect page forwards users to `sms-redirect?code={short_code}`. |
| Input payload | Short code in path or `code` query parameter. Static page sends `code`; SMS bodies use `karrykraze.com/r/?c={shortCode}`. |
| Output/response | 302 redirect to stored target URL; fallback 302 to `https://karrykraze.com`. |
| Database tables touched | Reads `sms_messages`, `sms_sends`; inserts `sms_events`; updates `customer_contacts.last_sms_sent_at`. |
| External APIs used | None. |
| Business rules | Logs `sms_clicked` event with phone, message, send ID, IP, user agent, redirect URL, timestamp. |
| Risks / TODOs | Updating `last_sms_sent_at` on click can interfere with frequency caps; `last_click_at` was referenced in roadmap/admin views but not found as an actual column. |

### `cart-sync`

| Field | Details |
|---|---|
| File path | `supabase/functions/cart-sync/index.ts` |
| Trigger/source | `js/shared/cartStore.js`, 5-second debounce after `kk-cart-updated`, only if `localStorage.kk_sms_contact_id` exists. |
| Input payload | `contact_id`, `cart` array. |
| Output/response | JSON action: `created`, `updated`, `unchanged`, `stale_skip`, or `cleared`. |
| Database tables touched | Reads `customer_contacts`, `saved_carts`; writes/updates `saved_carts`. |
| External APIs used | None. |
| Business rules | Valid contact required; cart data sanitized; empty cart expires active cart; cart hash prevents duplicate writes; cart updates reset abandonment step and step timestamps; new cart carries prior abandoned/expired count. |
| Risks / TODOs | Public endpoint trusts a client-stored contact UUID; does not check contact `sms_consent`; silent frontend failures reduce observability. |

### `coupon-upgrade`

| Field | Details |
|---|---|
| File path | `supabase/functions/coupon-upgrade/index.ts` |
| Trigger/source | Coupon landing page frontend `js/coupon/index.js`. |
| Input payload | `phone`, `promo_id`, `consent_text`, `page_url`, `user_agent`. |
| Output/response | JSON with `success`, `already_upgraded`, `coupon_code`, `sms_sent`, `message`. |
| Database tables touched | Reads `promotions`, `coupon_upgrades`, `customer_contacts`, `sms_consent_logs`; writes `promotions`, `coupon_upgrades`, `customer_contacts`, `sms_consent_logs`, `sms_messages`, `sms_sends`. |
| External APIs used | Twilio Messages API. |
| Business rules | Validates promo is active, landing enabled, and upgrade enabled; one upgrade per phone/promo; creates personal single-use upgrade promo; enrolls/re-enrolls phone into SMS; logs opt-in; sends tracking link. |
| Risks / TODOs | Enrollment UI appears to lack an explicit consent checkbox; direct Twilio send; no quiet-hours/frequency caps. |

### SMS-adjacent functions

| Function | File path | SMS relevance | Notes / risks |
|---|---|---|---|
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | Attributes purchases to SMS and marks carts purchased. | Direct coupon attribution only checks `SMS-`; click attribution covers any flow with a tracked click in the last 48h. |
| `send-review-request` | `supabase/functions/send-review-request/index.ts` | Sends review request SMS after opt-in check. | Does not insert `sms_messages`, so Twilio status callbacks cannot update review request delivery log through `sms_messages`. |
| `shippo-webhook` | `supabase/functions/shippo-webhook/index.ts` | Sends transactional shipping/delivery SMS through `send-sms`. | Uses `shipping_notification` message type not found in inspected `sms_messages` constraint. |
| `create-checkout-session` | `supabase/functions/create-checkout-session/index.ts` | Enables Stripe phone number collection. | Provides phone data later used by `orders_raw`, attribution, saved cart purchase matching, and post-purchase SMS opt-in. |

## 5. Database Tables and Views

### Tables

| Table / view name | Purpose | Important columns | Relationships | Security / RLS concerns | Safe OpenClaw read use |
|---|---|---|---|---|---|
| `customer_contacts` | Central contact and consent state. | `id`, `phone`, `email`, `status`, `sms_consent`, `source`, `coupon_code`, `opted_in_at`, `opted_out_at`, `last_sms_sent_at`, `fatigue_score`, `timezone`, `sms_count_7d`, `campaign`. | Referenced by `sms_messages`, `sms_sends`, `saved_carts`. `coupon_code` maps to `promotions.code`. | RLS enabled; service role full access; authenticated SELECT. Contains PII. | Read aggregated or masked fields only; do not expose raw phone/email to model unless necessary. |
| `sms_consent_logs` | Consent audit trail. | `phone`, `consent_type`, `consent_text`, `source`, `page_url`, `ip_address`, `user_agent`, `created_at`. | Phone links to `customer_contacts.phone` by convention, no FK found. | Authenticated SELECT; contains IP/user-agent/phone PII. | Useful for compliance audit summaries; redact IP/phone for AI prompts. |
| `sms_messages` | Twilio delivery log. | `contact_id`, `phone`, `message_body`, `message_type`, `campaign`, `status`, `provider`, `provider_message_sid`, `error_code`, `error_message`, `cost_cents`, `sent_at`, `delivered_at`, `redirect_url`, `short_code`. | `contact_id` FK to `customer_contacts`; referenced by `sms_sends` and `sms_events`. | Authenticated SELECT; message body and phone are PII/marketing content. | Safe for aggregate delivery/content pattern analysis if phone is masked. |
| `sms_sends` | Orchestration/analytics layer. | `phone`, `campaign`, `flow`, `send_reason`, `intent`, `cost`, `outcome`, `expected_value`, `expected_conversion_rate`, `product_context`, `user_state_snapshot`, `sms_message_id`, `contact_id`, `converted_at`, `created_at`. | FK to `sms_messages` and `customer_contacts`; linked to `orders_raw.sms_send_id`. | Authenticated SELECT; snapshots may contain customer/cart data. | Primary read source for OpenClaw flow recommendations. |
| `sms_events` | SMS click and conversion event log. | `event_type`, `phone`, `sms_message_id`, `sms_send_id`, `metadata`, `created_at`. | FK to `sms_messages` and `sms_sends`; used by `stripe-webhook`. | Authenticated SELECT; metadata contains IP/user agent and order IDs. | Read aggregate click/conversion timing; avoid raw metadata in model prompts. |
| `sms_queue` | Intended deferred send queue. | `phone`, `payload`, `intent`, `scheduled_at`, `status`, `contact_id`, `sent_message_id`, `created_at`. | FK to `customer_contacts` and `sms_messages`. | Service role full access only; no authenticated read grant in migration. | Not useful yet; queue processor not found in codebase. |
| `saved_carts` | Cart persistence for abandoned cart SMS. | `contact_id`, `phone`, `cart_data`, `cart_value_cents`, `item_count`, `status`, `abandoned_step`, `last_sms_at`, `purchased_at`, `cart_hash`, `abandoned_at`, `step_1_sent_at`, `step_2_sent_at`, `step_3_sent_at`, `abandon_count`. | FK to `customer_contacts`; purchase matching uses `orders_raw.phone_number`. | Service role only. Contains product/cart PII. | Safe for aggregate cart recovery and category/product signal analysis after redaction. |
| `promotions` | Coupon/promotion source. | SMS uses `code`, `type`, `value`, `min_order_amount`, `usage_limit`, `usage_count`, `start_date`, `end_date`, `coupon_upgrade_*`. | `customer_contacts.coupon_code` and `coupon_upgrades.upgrade_promo_id` point to promo codes/IDs. | Existing RLS not audited in detail here. | Read coupon performance, expiration, and strategy inputs. |
| `coupon_upgrades` | Tracks issued personal upgrade codes. | `promo_id`, `phone`, `upgrade_code`, `upgrade_promo_id`, `created_at`. | FK to `promotions`. | Authenticated SELECT; contains phone and coupon linkage. | Aggregate upgrade conversion; avoid raw phone. |
| `orders_raw` | Canonical order table. | SMS adds `sms_attributed`, `sms_send_id`, `sms_click_at`; other important fields include `phone_number`, `coupon_code_used`, `order_date`, `total_paid_cents`, `order_cost_total_cents`, `order_savings_total_cents`. | `sms_send_id` links to `sms_sends.id`; phone/coupon used for matching. | Contains customer/order PII. | Essential for revenue attribution; use aggregate or masked views. |
| `review_requests` | SMS-to-review funnel tracking. | `order_session_id`, `product_id`, `phone`, `token_hash`, `short_code`, `sent_at`, `clicked_at`, `reviewed_at`, `status`. | Links to `orders_raw` by session ID and products by `product_id`. | RLS enabled; comment says service-role only, but no explicit service-role policy was shown in inspected file. | Read aggregate review request performance only. |
| `site_settings` | Stores default SMS coupon config. | `key='sms_coupon'`, JSON value with type/value/min/expiry/prefix/scope. | Read by `sms-subscribe`. | Depends on broader table policies not audited here. | Safe for OpenClaw to read current offer rules, not write. |

### Views

| View name | Purpose | Important outputs | OpenClaw use |
|---|---|---|---|
| `sms_v_flow_performance` | Flow/campaign profitability. | Sends, delivered, clicks, conversions, conversion rate, SMS cost, attributed revenue, discounts, estimated profit, profit/SMS. | Best safe starting point for daily performance summaries and flow optimization ideas. |
| `sms_v_coupon_cohorts` | Initial vs escalation coupon comparison. | Issued, redeemed, redemption rate, attributed orders, AOV, profit/order, discounts, SMS cost. | Coupon strategy recommendations. |
| `sms_v_outcome_aging` | Aging of pending/converted/not-converted sends. | Send counts, avg hours to resolve, oldest/newest send, total cost. | Detect stale attribution windows or unresolved sends. |
| `sms_v_click_to_purchase` | Per-order click-to-purchase lag. | Order total/profit, click time, order date, hours lag, attribution method, flow/campaign. | Evaluate 24h/48h attribution windows and timing. |
| `sms_v_subscriber_funnel` | Subscriber funnel. | Total, active, unsubscribed, clicked, redeemed, purchased, click/redeem/purchase rates. | Executive summaries and funnel bottleneck analysis. |
| `sms_v_fatigue_monitor` | Aggregate contact fatigue. | Total contacts, active/stopped/bounced, stop rate, bounce rate, fatigue buckets, sends/clicks. | Compliance and fatigue monitoring. |
| `sms_v_contact_fatigue` | Per-contact fatigue detail. | Contact phone, status, fatigue, sends, clicks, conversions, last SMS/click. | Not safe to expose raw to AI by default; use for admin drill-down only. |
| `sms_v_abandoned_cart` | Abandoned cart funnel. | Total/active/purchased/expired carts, step sends, recovered value, recovery rate, serial abandoners. | Abandoned-cart optimization and suppression analysis. |

## 6. Customer Consent and Compliance

### Opt-in capture

| Source | How consent is captured | Stored where | Notes |
|---|---|---|---|
| SMS signup page | Required checkbox in `pages/sms-signup.html`; `js/sms-signup/index.js` blocks submit if unchecked. | `customer_contacts.sms_consent=true`; `sms_consent_logs` stores exact text. | Copy says marketing texts and STOP, but lacks “recurring automated” and “not condition of purchase.” |
| Post-purchase success page | Required checkbox in `pages/success.html`; button disabled until checked. | Same `sms-subscribe` path. | Stronger legal copy includes recurring automated texts, not condition of purchase, rates, STOP. |
| Coupon landing upgrade | Phone input plus visible consent text; no checkbox found. | `coupon-upgrade` upserts contact and logs consent. | Compliance risk: “By entering your number” may be weaker than explicit checkbox consent. |

### Consent storage

- Current state: `customer_contacts.status` and `customer_contacts.sms_consent`.
- Audit trail: `sms_consent_logs` with `opt_in` / `opt_out`, exact text, source, page URL, IP address, user agent.
- STOP opt-out: `twilio-webhook` writes `sms_consent_logs` with source `twilio_stop`.

### STOP / unsubscribe handling

- STOP words found: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`.
- On STOP: contact status becomes `unsubscribed`, `sms_consent=false`, `opted_out_at=now`.
- Twilio Advanced Opt-Out is expected to handle the auto-reply.
- START resubscribe handling: Not found in codebase.

### Frequency caps and quiet hours

Found:

- `send-sms`: quiet hours 9 PM-9 AM ET, consent check, 6-hour minimum gap, max 1 marketing SMS/day, max 4 marketing SMS/week.
- `sms-coupon-reminder`, `sms-abandoned-cart`, `sms-welcome-series`: quiet hours and 6-hour gap.
- `sms-subscribe`: IP signup rate limit, but no marketing frequency cap for first coupon send.

Not found / incomplete:

- No active `sms_queue` processor for deferring blocked quiet-hour sends.
- No real per-subscriber timezone use, even though `customer_contacts.timezone` exists.
- No automated fatigue score recalculation found.
- No global campaign approval workflow found.

### Message identification

All inspected marketing SMS bodies identify “Karry Kraze” and include STOP language. Transactional shipping messages also include Karry Kraze and STOP language.

### Risks before AI-generated SMS

- AI must not modify consent copy or opt-out handling without human/legal review.
- AI-generated bodies must always include brand identification and STOP instructions.
- AI should not bypass `send-sms` guardrails.
- AI should not send to contacts with `status != active` or `sms_consent != true` for marketing.
- AI should not use raw phone, IP, or user-agent data in external prompts without redaction.

## 7. Current SMS Flows

### Day 0 coupon / SMS signup

| Item | Details |
|---|---|
| Trigger | Public signup page or post-purchase SMS opt-in posts to `sms-subscribe`. |
| Timing | Immediate. |
| Message purpose | Deliver a single-use signup coupon and start the SMS relationship. |
| Eligibility rules | Valid US phone, consent text present, IP under 3/hour, not already active. Existing active contacts get existing coupon response but no new SMS. |
| Stop conditions | Invalid phone, missing consent, rate limit, already active, coupon already redeemed after unsubscribe/resubscribe. |
| Tables/functions used | `sms-subscribe`, `site_settings`, `customer_contacts`, `sms_consent_logs`, `promotions`, `sms_messages`, `sms_sends`, Twilio. |
| Metrics collected | Consent log, message delivery status, send cost estimate, click short code, send flow `signup`, eventual conversion through Stripe attribution. |

### Coupon reminder and escalation

| Item | Details |
|---|---|
| Trigger | pg_cron `sms-coupon-reminder`, hourly at :30. |
| Timing | Reminder: contacts opted in 24-48 hours ago. Escalation: after original coupon expired unused. |
| Message purpose | Remind about unused coupon; later upgrade expired unused coupon to 20% for 48 hours. |
| Eligibility rules | Active, opted-in, coupon exists, coupon unused, coupon valid for reminder or expired for escalation, no prior reminder/escalation as applicable, passes quiet hours and 6-hour cap. |
| Stop conditions | Unsubscribed/bounced, used coupon, expired for reminder, already reminded/escalated, frequency cap, quiet hours. |
| Tables/functions used | `sms-coupon-reminder`, `customer_contacts`, `promotions`, `sms_sends`, `sms_messages`, Twilio. |
| Metrics collected | `sms_sends.flow` values `coupon_reminder` and `coupon_escalation`; `sms_messages` delivery/click short codes; conversion through `orders_raw`. |

### Abandoned cart flow

| Item | Details |
|---|---|
| Trigger | `cartStore.js` sends cart snapshots to `cart-sync`; pg_cron `sms-abandoned-cart-check` runs every 5 minutes. |
| Timing | Step 1 after 30 minutes; Step 2 after 6 hours; Step 3 after 24 hours. |
| Message purpose | Recover active carts; Step 1 reminder, Step 2 urgency/social proof, Step 3 discount. |
| Eligibility rules | SMS subscriber with `kk_sms_contact_id`, active cart, cart value >= $15, active opted-in contact, no purchase since cart update, cart not older than 3 days, `abandon_count < 3`, passes quiet hours and 6-hour cap. |
| Stop conditions | Purchase detected, cart expired, unsubscribed/bounced, quiet hours, frequency cap, serial abandoner threshold. |
| Tables/functions used | `cart-sync`, `sms-abandoned-cart`, `saved_carts`, `customer_contacts`, `orders_raw`, `promotions`, `sms_messages`, `sms_sends`, Twilio. |
| Metrics collected | Cart status, cart value, item count, step timestamps, send snapshots, click events, recovery in `sms_v_abandoned_cart`. |

### Welcome series

| Item | Details |
|---|---|
| Trigger | pg_cron `sms-welcome-series`, hourly at :45. |
| Timing | Day 2 discovery message; Day 5 conversion/coupon message. |
| Message purpose | Move new subscribers toward browsing and first purchase. |
| Eligibility rules | Active opted-in contacts created 2-7 days ago, fatigue score < 8, passes 6-hour cap, no active abandoned cart flow. Day 5 requires Day 2 sent and no purchase since signup. |
| Stop conditions | Purchase before Day 5, active abandoned cart flow, fatigue, frequency cap, quiet hours, already sent step. |
| Tables/functions used | `sms-welcome-series`, `customer_contacts`, `sms_sends`, `saved_carts`, `orders_raw`, `promotions`, `sms_messages`, Twilio. |
| Metrics collected | `sms_sends.flow='welcome_series'`, send reasons `welcome_day_2` and `welcome_day_5`, click tracking, coupon conversion via click/coupon attribution. |

### Coupon upgrade flow

| Item | Details |
|---|---|
| Trigger | Visitor enters phone on a coupon landing page with upgrade enabled. |
| Timing | Immediate. |
| Message purpose | Trade SMS opt-in for a personal upgraded coupon. |
| Eligibility rules | Valid phone, active landing promotion, `coupon_upgrade_enabled=true`, upgrade value configured, one upgrade per phone/promotion. |
| Stop conditions | Invalid phone, missing promo/consent text, inactive promotion, already upgraded. |
| Tables/functions used | `coupon-upgrade`, `promotions`, `coupon_upgrades`, `customer_contacts`, `sms_consent_logs`, `sms_messages`, `sms_sends`, Twilio. |
| Metrics collected | `sms_sends.flow='upgrade'`, campaign `coupon_upgrade`, click short code, coupon usage in `promotions`. |

### Shipping and review-request SMS

These are SMS-adjacent and not core SMS marketing flows.

- `shippo-webhook` sends transactional shipped/delivered notifications through `send-sms` with `intent='transactional'` and `skip_caps=true`.
- `send-review-request` sends review request SMS only after checking `customer_contacts` active + opted-in.
- Review requests log `review_requests` and `sms_sends`, but not `sms_messages`.

Risks:

- `shipping_notification` was not found in the inspected `sms_messages.message_type` constraint.
- `shippo-webhook` calls `send-review-request` with only `order_session_id`, but the inspected `send-review-request` single path requires `order_session_id`, `product_id`, `phone`, and `email`; batch mode requires `batch: true`. This may be broken unless another code path exists outside inspected files.

## 8. Analytics and Learning Data

### Data available for learning

| Signal type | Available? | Source |
|---|---:|---|
| Delivery status | Yes | `sms_messages.status`, `delivered_at`, `error_code`, `error_message`, Twilio webhook. |
| Sends and cost | Yes | `sms_sends.cost`, `sms_messages`. |
| Clicks | Yes | `sms_events.event_type='sms_clicked'`, `sms_message_id`, `sms_send_id`, metadata. |
| Purchases | Yes | `orders_raw` with `sms_attributed`, `sms_send_id`, `sms_click_at`, order totals/costs/savings. |
| Coupons | Yes | `promotions`, `coupon_code_used`, `coupon_upgrades`, `sms_v_coupon_cohorts`. |
| Cart recovery | Yes | `saved_carts`, `sms_v_abandoned_cart`. |
| Customer segments | Partial | Status, source, fatigue score, sends/clicks/conversions exist; no robust LTV or preference segment table found in SMS code. |
| Flow performance | Yes | `sms_v_flow_performance`. |
| Time-to-buy | Yes | `sms_v_click_to_purchase`, `sms_v_abandoned_cart.avg_hours_to_purchase`. |
| Product/category signals | Partial | `saved_carts.cart_data` contains product/cart context; `sms_sends.product_context` exists but current senders mostly leave it null. |
| Consent/compliance data | Yes | `sms_consent_logs`, `customer_contacts.status`, STOP/bounce tracking. |
| Message copy performance | Partial | `sms_messages.message_body` and flow/campaign/send_reason exist, but no structured copy variant ID found. |

### Is there enough data for AI to make better decisions?

Yes for read-only analysis and draft recommendations. The system has enough sends, clicks, conversions, coupon, cart, and order-attribution structures for OpenClaw to identify which flows perform better, where customers drop off, and which coupon strategies appear more profitable.

Not enough for autonomous optimization yet. Missing or weak areas include:

- No approval workflow for AI-generated SMS.
- No structured experiment/variant framework.
- No central queue processor for scheduled/deferred AI suggestions.
- Incomplete fatigue score maintenance.
- Inconsistent use of `send-sms` guardrails.
- Raw PII is broadly readable to authenticated users in several SMS tables.

## 9. Risks and Gaps

| Category | Risk / gap | Evidence / affected area | Severity |
|---|---|---|---|
| Compliance | Coupon upgrade enrollment lacks explicit checkbox in inspected frontend. | `pages/coupon.html`, `js/coupon/index.js`, `coupon-upgrade`. | High |
| Compliance | START/resubscribe inbound handling not found. | `twilio-webhook` handles STOP only. | Medium |
| Compliance | Consent copy differs by entry point. | SMS signup page vs success page vs coupon upgrade. | Medium |
| Compliance | No AI approval layer. | Not found in codebase. | High for AI sending |
| Frequency | Central daily/weekly caps exist only in `send-sms`; core marketing automations send directly. | `sms-coupon-reminder`, `sms-abandoned-cart`, `sms-welcome-series`, `coupon-upgrade`. | High |
| Quiet hours | Quiet hours use hardcoded ET offset. | `isQuietHours()` fixed UTC-4. | Medium |
| Queueing | `sms_queue` exists but no worker found. | `20260414_sms_phase2.sql`; no processor found. | Medium |
| Attribution | Direct coupon attribution only checks `SMS-`. | `stripe-webhook`. | Medium |
| Attribution | Click tracking updates `last_sms_sent_at` instead of click field. | `sms-redirect`. | Medium |
| Analytics | Admin click delta checks `event_type === "click"`, but events use `sms_clicked`. | `js/admin/smsAnalytics/index.js`. | Low/Medium |
| Data quality | Phone format matching may fail between E.164 and raw `orders_raw.phone_number`. | `sms-abandoned-cart`, `sms-welcome-series`, `stripe-webhook`. | Medium |
| Logging | Review request SMS does not create `sms_messages`, so delivery callback cannot tie to review message. | `send-review-request`. | Medium |
| Schema | `shipping_notification` message type not present in inspected constraint. | `shippo-webhook`, `20260414_fix_message_type_constraint.sql`. | Medium |
| Security | Cron files contain hardcoded bearer tokens. | `SETUP_ABANDONED_CART_CRON.sql`, `SETUP_WELCOME_SERIES_CRON.sql`. | High |
| PII | Authenticated SELECT policies expose phone/message/consent logs. | SMS migrations. | High for AI/external tooling |
| Personalization | `product_context` exists but current sends mostly leave it null. | `sms_sends`. | Low/Medium |
| Experimentation | No copy variant IDs, A/B framework, or holdout groups found. | Not found in codebase. | Medium |
| Automation safety | No global per-contact monthly cap beyond `send-sms` weekly cap. | Direct sender functions. | Medium |

## 10. OpenClaw Readiness Assessment

Scale: 1 = not ready, 10 = ready for production use in that area.

| Area | Score | Explanation |
|---|---:|---|
| Read-only analytics access | 8/10 | Strong analytics views exist for flow, coupon, funnel, fatigue, click-to-purchase, and abandoned carts. Needs PII-safe access patterns. |
| SMS draft generation | 6/10 | Existing flows and performance data can guide drafts, but no variant framework or approval storage exists. Drafts should remain outside send path initially. |
| Customer segmentation | 6/10 | Contact status, source, fatigue, sends, clicks, conversions, and cart data exist. Missing robust LTV/preferences and standardized product/category context. |
| Personalized message recommendations | 5/10 | Cart snapshots and order/click data can power recommendations, but consent/privacy boundaries and product_context usage need hardening. |
| Automatic message sending | 2/10 | Not safe yet: direct senders bypass central caps, no approval layer, incomplete queueing, and compliance drift risks. |
| Compliance safety | 5/10 | Consent logging and STOP handling are solid foundations, but coupon upgrade consent, START handling, direct send bypasses, and AI approval are gaps. |
| Observability/logging | 7/10 | Logs/views are good for main marketing flows. Gaps: review SMS delivery logging, queue status, click field misuse, and admin delta bug. |

## 11. Recommended OpenClaw Integration Points

### Safe Now

- Daily read-only SMS analytics summary from:
	- `sms_v_flow_performance`
	- `sms_v_coupon_cohorts`
	- `sms_v_abandoned_cart`
	- `sms_v_click_to_purchase`
	- `sms_v_subscriber_funnel`
	- `sms_v_fatigue_monitor`
- Weekly “what changed?” report: sends, clicks, conversions, revenue, STOP/bounce rate.
- Flow performance review with no production writes.
- Coupon strategy analysis using aggregate `orders_raw`, `promotions`, and SMS cohort views.
- Draft-only SMS copy ideas saved outside production send functions.
- Compliance linting of draft copy for required brand + STOP language.

### Safe With Approval Layer

- Personalized campaign suggestions based on aggregate cohorts and saved-cart/product patterns.
- Customer segment recommendations such as “high cart value but no purchase,” “clicked but did not buy,” or “serial abandoners to suppress.”
- Coupon strategy recommendations such as changing min order, percent, or expiry.
- Suggested A/B copy variants with human approval before sending.
- Recommendations to pause flows if STOP/bounce rate rises.

### Not Safe Yet

- Fully autonomous SMS sending.
- AI changing consent text, STOP behavior, quiet hours, or frequency caps.
- AI texting customers directly from raw `customer_contacts` lists.
- AI selecting individual customers using raw phone/IP/user-agent data without redaction and access controls.
- AI modifying cron schedules or Twilio webhook configuration.
- AI changing promotion/coupon settings without human approval.

## 12. Recommended Next Steps

### Phase 1: Read-only SMS analyst

1. Create a PII-safe reporting role or RPC/view layer for OpenClaw.
2. Expose only aggregate views by default.
3. Add a daily/weekly OpenClaw summary that reads analytics and produces recommendations.
4. Add compliance checks for existing message bodies and consent copy.
5. Fix observability issues before using AI recommendations operationally:
	 - `sms_clicked` vs `click` admin delta mismatch.
	 - `sms-redirect` click timestamp field misuse.
	 - Review request delivery logging gap.

### Phase 2: Draft-mode SMS strategist

1. Add a `sms_drafts` or similar table for AI-generated suggestions, not sends.
2. Store draft metadata: target segment, flow, proposed copy, coupon idea, compliance lint result, created_by, approval status.
3. Require human approval before any copy is used.
4. Add a copy variant ID field to `sms_sends` or `sms_messages` for learning.

### Phase 3: Approval-based campaign assistant

1. Build admin UI for reviewing OpenClaw-generated campaign drafts.
2. Add segment preview counts with PII masked.
3. Route approved sends through the central `send-sms` guardrail path.
4. Implement `sms_queue` processing or remove/replace it with a clear scheduling model.
5. Add hard stop rules: no send without consent, quiet-hour safe scheduling, max caps, STOP copy required.

### Phase 4: Limited controlled automation

1. Allow OpenClaw to suggest timing/coupon adjustments within strict bounds.
2. Allow automated sends only for pre-approved templates and pre-approved segments.
3. Add anomaly kill switches: STOP rate, bounce rate, complaint rate, failed send rate, conversion drop.
4. Keep human approval required for new flows, new copy style, compliance text, or expanded send volume.

## 13. Questions / Unknowns

- Whether the cron SQL files with hardcoded bearer tokens are historical only or currently used.
- Whether Twilio Advanced Opt-Out is configured exactly as expected for STOP/START outside this codebase.
- Whether `customer_contacts` authenticated read access is intentionally available to all authenticated users or only admins through broader auth rules.
- Whether `sms_queue` has an external processor not present in this repository. Not found in codebase.
- Whether `shipping_notification` has been added to the live database constraint outside the inspected migrations. Not found in codebase.
- Whether `customer_contacts.last_click_at` exists in production despite not being found in migrations. Not found in codebase.
- Whether `fatigue_score` and `sms_count_7d` are updated by a database trigger or external job not present in this repository. Not found in codebase.
- Whether `send-review-request` is currently working from `shippo-webhook`; inspected payloads appear mismatched.
- Whether all phone numbers in `orders_raw.phone_number` are normalized to E.164 in production; code assumes different formats in different places.
- How many actual rows exist in SMS tables and whether data volume is sufficient for statistically meaningful AI optimization.
