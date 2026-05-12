# OpenClaw SMS Integration Plan

Plan date: May 7, 2026  
Source of truth: `docs/audit/system/sms/003_smsAudit.md`  
Scope: planning only. Do not modify production SMS logic yet.

## 1. Goal

OpenClaw should be integrated into the Karry Kraze SMS system gradually and defensively.

The first goal is **not** autonomous SMS sending. The first goal is to make OpenClaw a **read-only SMS analyst** that can summarize performance, identify risk, and recommend next actions from aggregate analytics.

The second goal is to make OpenClaw a **draft-mode SMS strategist** that can propose message ideas, coupon strategies, and customer segment recommendations for human review.

OpenClaw must follow this operating model:

| Responsibility | Owner |
|---|---|
| Analyze SMS performance | OpenClaw |
| Recommend opportunities | OpenClaw |
| Draft SMS copy | OpenClaw |
| Validate eligibility, consent, quiet hours, caps, and schema constraints | Supabase / backend |
| Approve, edit, reject, or schedule drafts | Human admin |
| Execute approved SMS sends | Existing `send-sms` function or future approved queue worker |

OpenClaw should never receive direct Twilio credentials, never bypass consent checks, never send directly to customers, and never alter STOP/unsubscribe behavior.

## 2. Source Audit Summary

The SMS audit found that Karry Kraze already has a substantial SMS marketing foundation:

- Public SMS signup with coupon delivery through `sms-subscribe`.
- Coupon upgrade enrollment through `coupon-upgrade`.
- STOP/unsubscribe handling through `twilio-webhook`.
- Delivery status logging through Twilio callbacks into `sms_messages`.
- Coupon reminder and escalation automation through `sms-coupon-reminder`.
- Abandoned cart tracking through `cartStore.js`, `cart-sync`, `saved_carts`, and `sms-abandoned-cart`.
- Welcome series automation through `sms-welcome-series`.
- Click tracking through `r/index.html`, `sms-redirect`, `sms_messages.short_code`, and `sms_events`.
- Purchase attribution through `stripe-webhook`, `orders_raw.sms_attributed`, `orders_raw.sms_send_id`, and `orders_raw.sms_click_at`.
- Admin analytics through `pages/admin/sms-analytics.html` and `js/admin/smsAnalytics/index.js`.
- Aggregate SMS views including flow performance, coupon cohorts, abandoned cart recovery, click-to-purchase, subscriber funnel, and fatigue monitoring.

The audit also found that the system is **not ready for autonomous AI sending** yet.

Key blockers:

| Area | Finding | OpenClaw implication |
|---|---|---|
| Central guardrails | Several flows send Twilio messages directly instead of routing through `send-sms`. | OpenClaw must not trigger sends until all sends share global guardrails. |
| Queueing | `sms_queue` exists but no active queue processor was found. | OpenClaw cannot safely schedule or defer sends yet. |
| Compliance | Coupon upgrade flow appears to lack an explicit checkbox; consent copy differs by entry point. | OpenClaw should not edit consent text or create live signup flows. |
| STOP handling | STOP words are handled, but START/resubscribe handling was not found. | OpenClaw must not automate reactivation or resubscribe logic. |
| Attribution | `stripe-webhook` directly attributes `SMS-` coupons; other coupon prefixes mostly depend on click-window attribution. | Reports should distinguish direct coupon attribution from click-window attribution. |
| Click logging | `sms-redirect` updates `last_sms_sent_at` on click; no `last_click_at` column was found. | Reports should flag click tracking field misuse until fixed. |
| PII | Several SMS tables allow authenticated reads and contain phone numbers, message bodies, IP, user-agent, and cart data. | OpenClaw v1 should read aggregate views only. |
| Security | Some cron setup SQL files contain hardcoded bearer tokens. | OpenClaw must not read, store, summarize, or reuse tokens. |
| Observability | Review request SMS does not write `sms_messages`; admin click delta checks the wrong event name. | OpenClaw should flag reporting gaps and avoid overconfidence. |

Readiness from the audit:

| Capability | Audit score | Practical meaning |
|---|---:|---|
| Read-only analytics access | 8/10 | Good starting point if PII-safe views are used. |
| SMS draft generation | 6/10 | Useful, but drafts need storage and approval. |
| Customer segmentation | 6/10 | Possible from aggregates; raw customer targeting is not safe yet. |
| Personalized recommendations | 5/10 | Possible later after privacy and segment guardrails. |
| Automatic message sending | 2/10 | Not safe. |
| Compliance safety | 5/10 | Good base, but not ready for AI sending. |
| Observability/logging | 7/10 | Good for core flows; several gaps remain. |

## 3. Recommended Architecture

### High-level architecture

OpenClaw should sit outside the live SMS send path at first.

```text
Supabase aggregate views
	↓ read-only
OpenClaw SMS Analyst
	↓ recommendations / draft ideas
Future sms_drafts table
	↓ admin review
Admin approval UI
	↓ approved draft only
Supabase validation layer
	↓ eligible, compliant, capped send request
send-sms
	↓
Twilio
```

### Required rule

**OpenClaw recommends. Supabase validates. Human approves. `send-sms` executes.**

### Connection map

| Component | OpenClaw access | Purpose | Write access in v1? |
|---|---|---|---:|
| `sms_v_flow_performance` | Read-only | Understand flow/campaign profit, revenue, sends, clicks, conversions. | No |
| `sms_v_coupon_cohorts` | Read-only | Compare initial and escalation coupon performance. | No |
| `sms_v_abandoned_cart` | Read-only | Review cart recovery performance and serial abandoner suppression. | No |
| `sms_v_click_to_purchase` | Read-only | Understand lag between SMS click and order. | No |
| `sms_v_subscriber_funnel` | Read-only | Summarize subscriber journey and conversion funnel. | No |
| `sms_v_fatigue_monitor` | Read-only | Monitor STOP rate, bounce rate, fatigue buckets, send density. | No |
| `sms_sends` | No direct raw access in Phase 1 | Underlying analytics source. | No |
| `sms_messages` | No direct raw access in Phase 1 | Contains message bodies and phone numbers. | No |
| `sms_events` | No direct raw access in Phase 1 | Contains click metadata and possible IP/user-agent. | No |
| Future `sms_drafts` | No in Phase 1; create-only in Phase 2 after table exists | Store AI draft ideas for admin approval. | Later, draft-only |
| Admin approval UI | No direct browser control required | Human reviews, edits, rejects, approves. | Human only |
| `send-sms` | No direct access until Phase 4 and only through approved backend | Execute approved sends. | Not in v1 |

### Recommended data boundary

OpenClaw should receive aggregated metrics, not raw customer records.

Allowed Phase 1 data shape:

| Metric type | Example fields |
|---|---|
| Flow performance | `flow`, `campaign`, `total_sends`, `unique_clicks`, `conversions`, `conversion_rate_pct`, `attributed_revenue`, `estimated_profit`, `profit_per_sms` |
| Coupon cohorts | `cohort`, `total_coupons_issued`, `redeemed`, `redemption_rate_pct`, `avg_order_value`, `avg_profit_per_order` |
| Abandoned cart | `total_carts`, `step1_sends`, `step2_sends`, `step3_sends`, `total_recovered`, `recovery_rate_pct`, `serial_abandoners` |
| Click-to-purchase | `flow`, `campaign`, aggregate average/median hours, within 24h, within 48h |
| Subscriber funnel | `total_subscribers`, `active_subscribers`, `unsubscribed`, `clicked`, `redeemed_coupon`, `purchased`, rates |
| Fatigue | `stop_rate_pct`, `bounce_rate_pct`, `fatigue_low`, `fatigue_medium`, `fatigue_high`, `avg_sends_per_contact` |

Forbidden Phase 1 data shape:

- Raw `phone`.
- Raw `email`.
- Raw `ip_address`.
- Raw `user_agent`.
- Raw `message_body` tied to a customer.
- Raw cart line items tied to a customer.
- Twilio SIDs or credentials unless strictly required for internal debugging by a human.

## 4. Phase 1: Read-Only SMS Analyst

### Objective

Build OpenClaw as a reporting and analysis assistant that reads only PII-safe aggregate SMS views and produces human-readable reports.

Phase 1 must write nothing to production tables.

### Allowed reads

Use only these aggregate views at first:

| View | Allowed use |
|---|---|
| `sms_v_flow_performance` | Rank SMS flows by sends, clicks, conversions, revenue, estimated profit, profit per SMS. |
| `sms_v_coupon_cohorts` | Compare coupon cohort redemption and profitability. |
| `sms_v_abandoned_cart` | Track cart recovery and serial abandoner signals. |
| `sms_v_click_to_purchase` | Understand how quickly SMS clickers buy. |
| `sms_v_subscriber_funnel` | Summarize opt-in-to-purchase funnel. |
| `sms_v_fatigue_monitor` | Monitor STOP rate, bounce rate, and fatigue risk. |

Do not read these directly in Phase 1:

- `customer_contacts`
- `sms_consent_logs`
- `sms_messages`
- `sms_sends`
- `sms_events`
- `saved_carts`
- `orders_raw`
- `coupon_upgrades`
- Twilio logs or credentials

### Reports OpenClaw can generate

#### Daily SMS performance report

Purpose:

- Summarize yesterday’s sends, clicks, conversions, attributed revenue, estimated profit, STOP risk, and bounce risk.

Inputs:

- Aggregate view rows.
- Optional date window generated by the reporting wrapper.

Outputs:

- Plain-English summary.
- Top 3 wins.
- Top 3 risks.
- 3 recommended actions.
- “Do not automate sending yet” reminder.

#### Weekly flow review

Purpose:

- Compare signup, coupon reminder, coupon escalation, abandoned cart, welcome series, upgrade, and other flows.

Outputs:

- Best-performing flow.
- Worst-performing flow.
- Most expensive flow.
- Flow with highest STOP/fatigue concern if available.
- Recommendation to test, pause, monitor, or leave unchanged.

#### Coupon strategy summary

Purpose:

- Compare initial coupon vs escalation coupons and identify whether discounts appear profitable.

Outputs:

- Cohort performance table.
- Discount profitability notes.
- Recommended coupon experiments for human review.
- Warning if data is too sparse.

#### Abandoned cart recovery review

Purpose:

- Review cart recovery funnel health.

Outputs:

- Step-level send counts.
- Recovery rate.
- Recovered value.
- Serial abandoner risk.
- Recommendation on timing/coupon changes for human review only.

#### Fatigue/compliance warning report

Purpose:

- Detect rising STOP rate, bounce rate, fatigue buckets, or send density.

Outputs:

- Current STOP and bounce rates.
- Fatigue bucket summary.
- Warnings if rates exceed chosen thresholds.
- Recommendation to reduce sends, pause a flow, review consent copy, or inspect deliverability.

### Phase 1 acceptance criteria

- OpenClaw can run a report without service-role credentials.
- OpenClaw sees no raw phone numbers.
- OpenClaw sees no IP addresses or user-agent strings.
- OpenClaw cannot call Twilio.
- OpenClaw cannot call `send-sms`.
- OpenClaw writes no database rows.
- Reports clearly label recommendations as advisory only.

## 5. Phase 2: Draft-Mode SMS Strategist

### Objective

Add a safe place for OpenClaw to store SMS draft ideas without sending anything.

OpenClaw can propose:

- SMS body drafts.
- Coupon strategy ideas.
- Target segment descriptions.
- Segment rules in JSON form for later backend validation.
- Compliance linting notes.
- Expected reasoning and performance hypothesis.

OpenClaw still cannot send messages in Phase 2.

### Future `sms_drafts` table design

Recommended table name: `sms_drafts`

| Column | Suggested type | Purpose |
|---|---|---|
| `id` | UUID primary key | Unique draft ID. |
| `created_at` | TIMESTAMPTZ default now | When OpenClaw or an admin created the draft. |
| `created_by` | TEXT | `openclaw`, admin email, or service name. |
| `flow` | TEXT | Suggested flow: `signup`, `coupon_reminder`, `coupon_escalation`, `abandoned_cart`, `welcome_series`, `upgrade`, `review_request`, or future flow. |
| `campaign` | TEXT | Campaign label, e.g. `spring_drop`, `abandoned_cart_test_a`. |
| `target_segment` | TEXT | Human-readable segment name. |
| `segment_rules_json` | JSONB | Proposed rules, not executable until backend validates. |
| `proposed_body` | TEXT | Draft SMS copy. Must include Karry Kraze and STOP language unless transactional policy says otherwise. |
| `proposed_coupon_strategy` | JSONB or TEXT | Suggested coupon type, value, minimum, expiry, and reasoning. |
| `compliance_score` | NUMERIC or INTEGER | Lint score, e.g. 0-100. |
| `compliance_notes` | TEXT | Missing STOP, too long, unclear brand, consent risk, discount risk, etc. |
| `expected_reasoning` | TEXT | Why the draft was suggested, based on aggregate metrics. |
| `approval_status` | TEXT | `draft`, `needs_review`, `approved`, `rejected`, `archived`, `sent`. |
| `approved_by` | TEXT | Admin who approved. Null until approved. |
| `approved_at` | TIMESTAMPTZ | Approval timestamp. Null until approved. |
| `rejected_reason` | TEXT | Admin rejection reason. |

Additional recommended columns before production use:

| Column | Purpose |
|---|---|
| `edited_body` | Human-edited final copy separate from AI draft. |
| `admin_notes` | Admin review notes. |
| `risk_level` | `low`, `medium`, `high`; high-risk drafts cannot be approved without extra review. |
| `max_recipients` | Hard recipient cap for approved draft. |
| `expires_at` | Draft expiration date. |
| `approved_segment_count` | Count generated by backend after validating segment rules. |
| `variant_key` | Copy/experiment identifier for later analytics. |
| `send_after` | Earliest allowed send time. |
| `created_from_report_id` | Optional reference to report that generated the draft. |

### Recommended `approval_status` values

| Status | Meaning | Can send? |
|---|---|---:|
| `draft` | Created but not submitted for review. | No |
| `needs_review` | Ready for admin review. | No |
| `approved` | Admin approved, but backend still must validate before send. | Not directly |
| `rejected` | Admin rejected. | No |
| `archived` | Old or unused draft. | No |
| `sent` | Draft was used for an executed send. | Already sent |

### Draft compliance lint rules

OpenClaw should mark a draft as non-compliant if:

- It does not identify Karry Kraze.
- It does not include STOP/opt-out language for marketing SMS.
- It implies purchase is required for opt-in.
- It references unsupported discount terms.
- It exceeds a reasonable SMS length target without warning.
- It includes sensitive personal data.
- It targets unsubscribed, bounced, or unknown-consent customers.
- It suggests bypassing quiet hours or frequency caps.

### Phase 2 acceptance criteria

- OpenClaw can create draft records only in `sms_drafts`.
- Draft records cannot trigger sends.
- Admins can see the draft, reasoning, risk, and compliance lint.
- Drafts use segment descriptions, not raw phone lists.
- No production functions read from `sms_drafts` for sending yet.

## 6. Phase 3: Approval-Based Campaign Assistant

### Objective

Build an admin workflow where OpenClaw-created SMS drafts can be reviewed, edited, approved, rejected, or archived before anything sends.

### Admin UI requirements

The admin UI should show:

| UI element | Purpose |
|---|---|
| Draft list | Show pending drafts by flow, campaign, risk level, created date, and compliance score. |
| Draft detail panel | Show original AI body, admin-edited body, segment description, coupon strategy, reasoning, and compliance notes. |
| Aggregate evidence panel | Show source metrics from aggregate views that led to the draft. |
| Segment preview | Show only counts and aggregate traits, not raw phone numbers. |
| Compliance checklist | Brand present, STOP present, quiet hours safe, cap-safe route, no raw PII, no prohibited claims. |
| Admin actions | Approve, edit, reject, archive, request rewrite. |
| Audit trail | Store who approved, when, what changed, and why. |

### Approval workflow

1. OpenClaw creates `sms_drafts` row with `approval_status='needs_review'`.
2. Admin opens draft in SMS admin UI.
3. Admin reviews:
   - Copy.
   - Segment.
   - Coupon strategy.
   - Expected reasoning.
   - Compliance notes.
   - Estimated audience size.
4. Admin edits the copy if needed.
5. Admin approves or rejects.
6. If approved, backend validates again before any send request is created.
7. Backend routes approved sends only through `send-sms` or a validated future queue worker.

### Backend validation after approval

Even after human approval, Supabase must validate:

- Segment query is allowed.
- Contacts are active.
- `sms_consent=true` for marketing.
- Contact is not bounced or unsubscribed.
- Global daily/weekly/monthly caps are not exceeded.
- Quiet hours are respected.
- STOP language exists in marketing copy.
- Brand identification exists.
- Coupon exists and is valid if a coupon is referenced.
- Message type is accepted by `sms_messages.message_type` constraint.
- Campaign/flow labels are valid.

### What Phase 3 should still not allow

- No OpenClaw direct send button.
- No raw phone list export to OpenClaw.
- No AI edits to consent text.
- No AI edits to STOP handling.
- No AI-created cron schedules.
- No AI-created Twilio callbacks.
- No automatic promotion setting changes.

## 7. Phase 4: Limited Controlled Automation

### Objective

Allow narrow, controlled automation only after the system has strong guardrails, approval history, monitoring, and kill switches.

### Required prerequisites

Do not begin Phase 4 until all of these are true:

- All sends route through `send-sms` or a replacement with equal or stronger guardrails.
- `sms_queue` works or is replaced with a clear queue/scheduling system.
- Frequency caps are global across every marketing send path.
- Quiet hours are enforced centrally.
- STOP copy is required centrally for marketing sends.
- Approval system exists and logs approvals.
- Anomaly kill switches exist.
- Raw PII is protected from OpenClaw prompts.
- Segment generation is backend-validated.
- Draft and send variants are tracked for learning.

### Allowed controlled automation examples

| Automation | Conditions |
|---|---|
| Auto-generate daily report | Safe after Phase 1. No writes to production SMS tables. |
| Auto-create drafts for review | Safe after Phase 2. Draft table only. |
| Auto-suggest pausing a flow | Safe after Phase 2/3. Human must approve pause. |
| Auto-schedule already-approved template | Only after Phase 4 prerequisites and hard recipient caps. |
| Auto-select best approved copy variant | Only for pre-approved variants, capped segments, and kill switches. |

### Required anomaly kill switches

| Kill switch | Example trigger |
|---|---|
| STOP rate spike | STOP rate above configured threshold or sudden increase vs baseline. |
| Bounce/failure spike | Failed/undelivered status above threshold. |
| Send volume spike | Sends exceed expected daily or hourly limit. |
| Revenue drop | Flow conversion/profit drops sharply after a copy/coupon change. |
| Complaint signal | Manual complaint flag or Twilio warning. |
| Quiet-hour violation | Any attempted send during blocked hours. |
| Consent anomaly | Any target segment includes unsubscribed/bounced/no-consent contacts. |

### Phase 4 operating rule

OpenClaw may automate only inside pre-approved boxes. Anything outside those boxes must revert to draft + human approval.

## 8. OpenClaw Skills / Tools Needed

### `read_sms_analytics`

| Field | Details |
|---|---|
| Purpose | Read PII-safe aggregate SMS performance data. |
| Allowed inputs | Date range, flow filter, campaign filter, report type. |
| Allowed outputs | Aggregated metrics from approved views; no raw phone/email/IP/user-agent. |
| Forbidden actions | Reading raw `customer_contacts`, raw `sms_messages`, raw `sms_consent_logs`, Twilio credentials, cron tokens, or production secrets. |

### `generate_sms_report`

| Field | Details |
|---|---|
| Purpose | Turn aggregate metrics into a plain-English daily/weekly report. |
| Allowed inputs | Output from `read_sms_analytics`; selected reporting window; optional business context. |
| Allowed outputs | Markdown report with summary, metrics, risks, recommended actions, and warnings. |
| Forbidden actions | Creating sends, editing database records, changing coupons, calling Twilio, or listing raw recipients. |

### `create_sms_draft`

| Field | Details |
|---|---|
| Purpose | Create draft-mode SMS campaign ideas for admin review. |
| Allowed inputs | Aggregate metrics, target segment description, desired flow, coupon constraints, compliance rules. |
| Allowed outputs | Draft copy, target segment summary, proposed coupon strategy, expected reasoning, compliance lint result. In Phase 2+, may write only to `sms_drafts`. |
| Forbidden actions | Sending SMS, selecting raw phone numbers, creating live promotions, editing production flows, bypassing approval. |

### `compliance_lint_sms`

| Field | Details |
|---|---|
| Purpose | Check proposed SMS copy and strategy against Karry Kraze rules before admin review. |
| Allowed inputs | Proposed SMS body, flow, intent, coupon strategy, segment summary. |
| Allowed outputs | Compliance score, pass/fail checks, required edits, risk level. |
| Forbidden actions | Editing legal consent text, changing STOP handling, declaring legal compliance guaranteed, sending messages. |

### `recommend_coupon_strategy`

| Field | Details |
|---|---|
| Purpose | Recommend coupon values, minimums, expirations, or tests based on aggregate performance. |
| Allowed inputs | `sms_v_coupon_cohorts`, `sms_v_flow_performance`, aggregate order profitability from approved views or summaries. |
| Allowed outputs | Human-review recommendations, hypotheses, expected tradeoffs, “do not use if data is sparse” warnings. |
| Forbidden actions | Editing `promotions`, creating coupons, changing `site_settings`, changing coupon upgrade settings. |

### `recommend_customer_segments`

| Field | Details |
|---|---|
| Purpose | Recommend PII-safe segment definitions for future campaigns. |
| Allowed inputs | Aggregate funnel, fatigue, abandoned cart, and flow metrics. |
| Allowed outputs | Segment names, non-PII rules, expected segment size if backend provides count, suggested flow/copy angle. |
| Forbidden actions | Returning raw phone lists, targeting unsubscribed/bounced contacts, using IP/user-agent for marketing targeting, querying raw contacts in Phase 1. |

## 9. Security and Privacy Rules

OpenClaw must follow these rules in every phase.

### Data privacy rules

- No raw phone numbers in OpenClaw prompts.
- No raw email addresses in OpenClaw prompts.
- No raw IP addresses unless a human explicitly requests a security/compliance investigation.
- No raw user-agent strings unless a human explicitly requests a security/compliance investigation.
- No raw Twilio message SIDs unless needed for human debugging.
- No raw cart data tied to a specific customer in OpenClaw prompts.
- No export of customer-level SMS lists.

### Credential rules

- No direct Twilio access in v1.
- No Twilio credentials in OpenClaw environment.
- No Supabase service-role key in OpenClaw v1.
- No cron bearer tokens in prompts or logs.
- No copying tokens from SQL files into reports.

### Compliance rules

- No editing consent text in v1.
- No changing STOP handling.
- No changing Twilio webhook logic.
- No sending without human approval.
- No sending without backend consent validation.
- No marketing SMS without brand identification.
- No marketing SMS without STOP/opt-out language.
- No suggestions to bypass quiet hours, frequency caps, or suppression rules.

### Operational rules

- OpenClaw recommendations must be labeled as recommendations.
- OpenClaw drafts must be labeled as drafts.
- OpenClaw must not create cron jobs.
- OpenClaw must not deploy Supabase Edge Functions.
- OpenClaw must not change production send functions until a human explicitly starts an implementation task.

## 10. Data OpenClaw Should Not Touch Yet

OpenClaw should not touch these in Phase 1 and should not touch them later without a specific approved design.

| Data / system | Why it is restricted |
|---|---|
| Raw `customer_contacts` | Contains phone, email, status, consent, and possible campaign fields. Use aggregate views only. |
| Raw `sms_consent_logs` with IP/user-agent | Contains compliance evidence and PII. Only humans or compliance tools should inspect directly. |
| Raw `sms_messages` | Contains phone numbers, bodies, provider SIDs, errors, and tracking codes. Use aggregate delivery data first. |
| Raw `sms_events` | Contains phone and click metadata. Use aggregate click-to-purchase views first. |
| Raw `saved_carts` | Contains customer-linked cart contents. Use `sms_v_abandoned_cart` first. |
| Raw `orders_raw` | Contains customer and purchase PII. Use aggregate attribution views first. |
| Twilio credentials | Direct provider access would bypass Supabase guardrails. |
| Cron bearer tokens | Security risk; audit found hardcoded tokens in cron setup SQL files. |
| Production send functions | OpenClaw should not edit or invoke send functions until approved implementation phases. |
| Promotion settings | Coupon and consent settings affect money and compliance. Human approval required. |
| Consent text fields | Legal/compliance sensitive. AI can lint, not edit. |
| STOP/unsubscribe handling | Legal/compliance sensitive. AI can report, not change. |

## 11. Fixes Required Before Sending Automation

The audit identified several fixes that should be completed before OpenClaw can participate in any send path.

### Required fixes for automation safety

| Priority | Fix | Reason |
|---:|---|---|
| 1 | Route all marketing sends through `send-sms` or a stronger central send service. | Current direct Twilio flows bypass daily/weekly caps. |
| 2 | Implement or replace `sms_queue`. | Needed for quiet-hour deferral, scheduled sends, retries, and auditability. |
| 3 | Enforce global caps across every marketing flow. | Avoid fatigue and compliance risk. |
| 4 | Centralize quiet-hour logic with timezone/DST handling. | Current fixed UTC-4 logic can drift. |
| 5 | Add a hard requirement for brand + STOP language in all marketing sends. | Required before AI-generated copy can be used. |
| 6 | Build `sms_drafts` and admin approval workflow. | AI drafts need human review before sending. |
| 7 | Add anomaly kill switches. | Needed to stop runaway sends, bounce spikes, STOP spikes, or revenue harm. |

### Required fixes from audit gaps

| Fix | Affected area | Why it matters |
|---|---|---|
| Fix coupon upgrade consent UX with an explicit checkbox. | `pages/coupon.html`, `js/coupon/index.js`, `coupon-upgrade`. | Current inspected flow appears weaker than other opt-ins. |
| Decide and implement START/resubscribe handling or document Twilio-only behavior. | `twilio-webhook`. | Prevents confusing re-subscribe states. |
| Standardize consent copy across entry points. | Signup page, success page, coupon upgrade. | Reduces compliance drift. |
| Fix `sms-redirect` click update to use a click-specific field or remove contact update. | `sms-redirect`, possible `customer_contacts.last_click_at`. | Avoids corrupting frequency cap timing. |
| Fix admin dashboard click delta event name. | `js/admin/smsAnalytics/index.js`. | Current code checks `click`; events are `sms_clicked`. |
| Normalize phone matching for attribution and saved cart purchase detection. | `stripe-webhook`, `sms-abandoned-cart`, `sms-welcome-series`, `orders_raw`. | Reduces missed conversions and incorrect cart status. |
| Add `sms_messages` logging for review request SMS or clearly separate review delivery tracking. | `send-review-request`. | Needed for Twilio callback visibility and analytics completeness. |
| Resolve `shipping_notification` message type constraint. | `shippo-webhook`, `sms_messages` schema. | Prevents transactional send logging failures. |
| Rotate/remove hardcoded cron bearer tokens. | `SETUP_ABANDONED_CART_CRON.sql`, `SETUP_WELCOME_SERIES_CRON.sql`. | Security risk. |
| Restrict PII table reads or create OpenClaw-safe views/RPCs. | SMS migrations and policies. | Prevents raw PII exposure to AI. |
| Add structured copy variant IDs. | `sms_sends` or `sms_messages`. | Enables learning which drafts work. |
| Add fatigue score recalculation or remove unused fields. | `customer_contacts.fatigue_score`, `sms_count_7d`. | Current fields are read but updates were not found. |

### Required fixes before OpenClaw can recommend individual segments

- Create backend-owned segment preview functions that return counts, not phone lists.
- Define allowed segment rules.
- Validate segment rules server-side.
- Block segments that include unsubscribed, bounced, or no-consent contacts.
- Add maximum recipient caps per campaign.
- Add suppression windows for recent sends, recent STOPs, recent bounces, and serial abandoners.

## 12. First Build Recommendation

The first real OpenClaw build should be:

> **Daily SMS Analyst Report**

### Why this should be first

It is useful immediately, low risk, and does not require production send changes. It uses the strongest existing asset from the audit: aggregate analytics views.

### Operating mode

- Run manually at first.
- Read aggregate views only.
- Summarize yesterday and last 7 days.
- Recommend 3 actions.
- Generate 3 draft SMS ideas.
- Include compliance warnings.
- Write nothing to production.

### Inputs

| Input | Source |
|---|---|
| Flow performance | `sms_v_flow_performance` |
| Coupon cohort performance | `sms_v_coupon_cohorts` |
| Abandoned cart recovery | `sms_v_abandoned_cart` |
| Click-to-purchase timing | `sms_v_click_to_purchase` |
| Subscriber funnel | `sms_v_subscriber_funnel` |
| Fatigue/compliance risk | `sms_v_fatigue_monitor` |

### Output format

Recommended report sections:

1. Executive summary.
2. Yesterday’s performance.
3. Last 7 days trend.
4. Best-performing flow.
5. Weakest flow or biggest risk.
6. Coupon strategy notes.
7. Abandoned cart recovery notes.
8. Fatigue and compliance warnings.
9. 3 recommended human actions.
10. 3 draft SMS ideas for review only.
11. Data quality warnings.
12. “No sends were created” confirmation.

### Example draft idea policy

Daily report draft ideas must be clearly labeled:

- “Draft only — not sent.”
- “Requires human approval.”
- “Requires backend validation before send.”
- “Must route through `send-sms` or approved queue.”

### What the first build must not do

- Must not write to `sms_drafts` yet unless Phase 2 is explicitly started.
- Must not call `send-sms`.
- Must not call Twilio.
- Must not query raw `customer_contacts`.
- Must not query raw `sms_consent_logs`.
- Must not change coupons.
- Must not schedule a campaign.

## 13. Implementation Checklist

### Phase 1: Daily SMS Analyst Report

- [ ] Confirm aggregate views exist in production:
  - [ ] `sms_v_flow_performance`
  - [ ] `sms_v_coupon_cohorts`
  - [ ] `sms_v_abandoned_cart`
  - [ ] `sms_v_click_to_purchase`
  - [ ] `sms_v_subscriber_funnel`
  - [ ] `sms_v_fatigue_monitor`
- [ ] Create or confirm a read-only Supabase access path for OpenClaw.
- [ ] Ensure OpenClaw access cannot read raw PII tables.
- [ ] Ensure OpenClaw access cannot call Edge Functions that send SMS.
- [ ] Ensure OpenClaw has no Twilio credentials.
- [ ] Ensure OpenClaw has no Supabase service-role key.
- [ ] Define a manual run command or admin-only manual trigger.
- [ ] Build the report prompt using only aggregate metrics.
- [ ] Include mandatory sections:
  - [ ] Yesterday summary.
  - [ ] Last 7 days summary.
  - [ ] Top 3 wins.
  - [ ] Top 3 risks.
  - [ ] 3 recommended actions.
  - [ ] 3 draft SMS ideas.
  - [ ] Compliance warnings.
  - [ ] Data quality warnings.
  - [ ] Confirmation that nothing was sent.
- [ ] Save output to a markdown/log file, not production SMS tables.
- [ ] Add a human review step for every recommendation.

### Phase 1 permissions checklist

- [ ] OpenClaw can read `sms_v_flow_performance`.
- [ ] OpenClaw can read `sms_v_coupon_cohorts`.
- [ ] OpenClaw can read `sms_v_abandoned_cart`.
- [ ] OpenClaw can read `sms_v_click_to_purchase`.
- [ ] OpenClaw can read `sms_v_subscriber_funnel`.
- [ ] OpenClaw can read `sms_v_fatigue_monitor`.
- [ ] OpenClaw cannot read raw `customer_contacts`.
- [ ] OpenClaw cannot read raw `sms_consent_logs`.
- [ ] OpenClaw cannot read raw `sms_messages`.
- [ ] OpenClaw cannot read raw `sms_events`.
- [ ] OpenClaw cannot read raw `saved_carts`.
- [ ] OpenClaw cannot read raw `orders_raw`.
- [ ] OpenClaw cannot write any SMS table.

### Phase 2: Future `sms_drafts` table

- [ ] Design `sms_drafts` migration.
- [ ] Add columns listed in this plan.
- [ ] Add RLS policies:
  - [ ] OpenClaw can insert drafts only.
  - [ ] OpenClaw cannot approve drafts.
  - [ ] OpenClaw cannot mark drafts sent.
  - [ ] Admins can read, edit, approve, reject, and archive drafts.
- [ ] Add compliance lint function or prompt.
- [ ] Add draft risk levels.
- [ ] Add copy variant tracking field.
- [ ] Ensure draft creation does not trigger any send.

### Phase 3: Admin approval flow

- [ ] Build SMS draft review page or add to SMS Analytics admin area.
- [ ] Show AI draft body and editable admin body.
- [ ] Show segment summary without raw phone numbers.
- [ ] Show expected reasoning.
- [ ] Show compliance lint score and notes.
- [ ] Add approve/reject/archive controls.
- [ ] Store `approved_by`, `approved_at`, and `rejected_reason`.
- [ ] Add immutable approval audit trail.
- [ ] Add backend validation before any approved draft can become a send request.

### Phase 4: Controlled automation readiness

- [ ] Route all marketing sends through `send-sms` or a replacement central sender.
- [ ] Implement or replace `sms_queue`.
- [ ] Enforce global daily cap.
- [ ] Enforce global weekly cap.
- [ ] Define and enforce monthly cap if desired.
- [ ] Centralize quiet hours.
- [ ] Add timezone/DST handling.
- [ ] Require STOP copy in marketing sends.
- [ ] Add anomaly kill switches.
- [ ] Add send-volume caps.
- [ ] Add segment validation.
- [ ] Add holdout/A-B testing support.
- [ ] Add copy variant attribution.
- [ ] Add automated rollback/pause path.

### Audit-derived fixes checklist

- [ ] Fix coupon upgrade explicit consent checkbox.
- [ ] Standardize consent copy across signup, success, and coupon upgrade entry points.
- [ ] Decide START/resubscribe handling.
- [ ] Fix `sms-redirect` click timestamp field misuse.
- [ ] Fix admin dashboard `sms_clicked` delta issue.
- [ ] Normalize phone matching for attribution and cart recovery.
- [ ] Add review request SMS delivery logging or separate delivery tracking.
- [ ] Resolve `shipping_notification` message type mismatch.
- [ ] Rotate/remove hardcoded cron bearer tokens.
- [ ] Restrict PII table access before AI gets database access.
- [ ] Implement fatigue score updates or remove unused fatigue automation assumptions.

## Final Recommendation

Start with a manual, read-only **Daily SMS Analyst Report**. Do not build AI sending yet.

The safest immediate value is better visibility: identify profitable flows, weak coupon cohorts, cart recovery opportunities, and fatigue/compliance risks. After that, add draft-only strategy support with a future `sms_drafts` table and admin approval UI.

Only after central guardrails, queueing, approval, privacy controls, and kill switches exist should OpenClaw be allowed anywhere near controlled SMS automation.
