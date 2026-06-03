# OpenClaw SMS Build V1 Spec

Spec date: May 7, 2026  
Source of truth: `docs/audit/system/smsAudit.md` and `docs/audit/system/openclawSmsPlan.md`  
Scope: specification only. No production code has been modified.

---

## 1. Objective

V1 is a **manual, read-only Daily SMS Analyst Report** for Karry Kraze.

OpenClaw's role in V1 is a passive analyst. It receives pre-fetched aggregate SMS metrics, reasons about what the data means, and writes a plain-English markdown report. It touches no send paths, no raw customer data, no Twilio, and no production tables.

The output of V1 is a local markdown file — a human-readable report that shows how the SMS system is performing. A human reads it, decides what to act on, and carries out any changes manually.

V1 exists to answer:

- How is the SMS system performing today vs last 7 days?
- Which flows are profitable and which are underperforming?
- Are there compliance, fatigue, or data quality risks I should know about?
- What three things should I do next?
- What SMS ideas is the AI seeing that I can evaluate and use or discard?

V1 must not automate, schedule, or trigger any SMS sends. It must not write anything to Supabase production tables.

---

## 2. V1 Scope

### In scope

| Item | Notes |
|---|---|
| Query the 6 approved aggregate views from Supabase | Read-only via `@supabase/supabase-js` with anon key |
| Normalize and structure the fetched rows into a single JSON payload | Local script work, no AI |
| Pass the structured JSON payload to OpenClaw | No raw PII in payload |
| OpenClaw reasons over the payload and writes a markdown report | Report only — no writes to production |
| Save the report to `docs/reports/sms/daily/YYYY-MM-DD.md` | Local file, not in Supabase |
| Report sections listed in §4 of this spec | All 12 required sections |
| Data quality warnings if views return empty or unexpected data | Required in every report |
| "No sends were created" confirmation in every report | Required in every report |
| Run manually from the command line | Required; not scheduled or automated |

### Out of scope for V1

| Item | Why excluded |
|---|---|
| Autonomous or scheduled SMS sending | Not safe yet per `openclawSmsPlan.md` §7 |
| Calling Twilio API | No Twilio credentials in V1 |
| Calling `send-sms` Edge Function | Not allowed until Phase 4 prerequisites met |
| Creating or writing to `sms_drafts` table | Table does not exist yet; Phase 2 |
| Admin approval UI | Phase 3 |
| Raw customer targeting or phone list generation | PII restriction per `openclawSmsPlan.md` §9 |
| Reading raw `customer_contacts` | Use aggregate views only |
| Reading raw `sms_messages`, `sms_events`, `sms_consent_logs`, `saved_carts`, `orders_raw` | Use aggregate views only |
| Changing coupons, promotions, or settings | Human-only actions |
| Segment creation or management | Phase 2 and later |
| Saving report to Supabase | Local file only |
| Any write to any Supabase table | Zero writes in V1 |
| Automated cron or background trigger | Manual run only |

---

## 3. Inputs

V1 reads exactly these six aggregate views. Nothing else.

### `sms_v_flow_performance`

Purpose: Per-flow/campaign profitability summary.

| Field to read | Type | Notes |
|---|---|---|
| `flow` | TEXT | Flow name: `signup`, `coupon_reminder`, `coupon_escalation`, `abandoned_cart`, `welcome_series`, `upgrade`, etc. |
| `campaign` | TEXT | Campaign label if present |
| `total_sends` | INTEGER | Total sends in period |
| `delivered` | INTEGER | Delivered count |
| `unique_clicks` | INTEGER | Distinct click events |
| `conversions` | INTEGER | Orders attributed to this flow |
| `conversion_rate_pct` | NUMERIC | Conversion percentage |
| `sms_cost` | NUMERIC | Estimated total cost in dollars |
| `attributed_revenue` | NUMERIC | Revenue from attributed orders |
| `discounts_issued` | NUMERIC | Discount / coupon value given |
| `estimated_profit` | NUMERIC | Revenue minus cost minus discounts |
| `profit_per_sms` | NUMERIC | Estimated profit divided by sends |

If any of these columns are not present on the live view, the script must log a warning and skip that field rather than failing.

### `sms_v_coupon_cohorts`

Purpose: Initial coupon vs escalation coupon performance comparison.

| Field to read | Type | Notes |
|---|---|---|
| `cohort` | TEXT | Cohort label, e.g. `initial`, `escalation`, `upgrade` |
| `total_coupons_issued` | INTEGER | Total coupons created |
| `redeemed` | INTEGER | Coupons redeemed |
| `redemption_rate_pct` | NUMERIC | Percentage redeemed |
| `attributed_orders` | INTEGER | Orders linked to this cohort |
| `avg_order_value` | NUMERIC | Average order total |
| `avg_profit_per_order` | NUMERIC | Average estimated profit per order |
| `total_discounts` | NUMERIC | Total discount dollars issued |
| `total_sms_cost` | NUMERIC | SMS cost associated with cohort |

### `sms_v_abandoned_cart`

Purpose: Cart recovery funnel health.

| Field to read | Type | Notes |
|---|---|---|
| `total_carts` | INTEGER | All tracked carts |
| `active_carts` | INTEGER | Currently active (not purchased, not expired) |
| `purchased_carts` | INTEGER | Recovered/purchased |
| `expired_carts` | INTEGER | Abandoned and expired without purchase |
| `step1_sends` | INTEGER | Step 1 (30-minute) sends |
| `step2_sends` | INTEGER | Step 2 (6-hour) sends |
| `step3_sends` | INTEGER | Step 3 (24-hour) sends |
| `total_recovered_value` | NUMERIC | Dollar value of recovered carts |
| `recovery_rate_pct` | NUMERIC | Purchased/total percentage |
| `serial_abandoners` | INTEGER | Contacts with abandon_count >= 3 |
| `avg_hours_to_purchase` | NUMERIC | Average hours from cart creation to order |

### `sms_v_click_to_purchase`

Purpose: Understand lag between SMS click and actual purchase — used to validate 48-hour attribution window.

The view returns per-order rows. The script should aggregate before passing to OpenClaw.  
Aggregate these fields:

| Aggregated field | How to compute | Notes |
|---|---|---|
| `total_attributed_orders` | COUNT(*) | All orders linked by click |
| `avg_hours_to_purchase` | AVG(hours_lag) | Average click-to-order time |
| `median_hours_to_purchase` | Approximate median | Use percentile if available |
| `within_24h_pct` | Percentage where hours_lag <= 24 | Attribution window fit |
| `within_48h_pct` | Percentage where hours_lag <= 48 | Attribution window fit |
| `by_flow` | Grouped by flow | Per-flow averages |
| `by_attribution_method` | Grouped by attribution_method | Coupon vs click-window split |

If the view returns aggregate rows rather than per-order rows, read as-is and pass all columns.

### `sms_v_subscriber_funnel`

Purpose: End-to-end subscriber lifecycle summary.

| Field to read | Type | Notes |
|---|---|---|
| `total_subscribers` | INTEGER | All contacts ever signed up |
| `active_subscribers` | INTEGER | Currently active and opted-in |
| `unsubscribed` | INTEGER | Opted out |
| `clicked_at_least_once` | INTEGER | Subscribers who have clicked |
| `redeemed_coupon` | INTEGER | Subscribers who used a coupon |
| `purchased` | INTEGER | Subscribers with attributed purchase |
| `click_rate_pct` | NUMERIC | click/active percentage |
| `redeem_rate_pct` | NUMERIC | redeem/active percentage |
| `purchase_rate_pct` | NUMERIC | purchase/active percentage |

### `sms_v_fatigue_monitor`

Purpose: Monitor STOP rate, bounce rate, and contact fatigue.

| Field to read | Type | Notes |
|---|---|---|
| `total_contacts` | INTEGER | All contacts |
| `active_contacts` | INTEGER | Active opted-in |
| `stopped_contacts` | INTEGER | Unsubscribed |
| `bounced_contacts` | INTEGER | Bounced/failed delivery |
| `stop_rate_pct` | NUMERIC | stopped/total percentage |
| `bounce_rate_pct` | NUMERIC | bounced/total percentage |
| `fatigue_low` | INTEGER | Contacts in low-fatigue bucket |
| `fatigue_medium` | INTEGER | Contacts in medium-fatigue bucket |
| `fatigue_high` | INTEGER | Contacts in high-fatigue bucket |
| `avg_sends_per_contact` | NUMERIC | Average lifetime sends per contact |
| `avg_clicks_per_contact` | NUMERIC | Average lifetime clicks per contact |

### Date window convention

The script should pass two date windows to each view query when possible:
- **Yesterday**: `now() - interval '1 day'` to `now()` UTC
- **Last 7 days**: `now() - interval '7 days'` to `now()` UTC

If a view does not accept date parameters, read the entire view and note in the data quality section of the report that the data is unfiltered.

---

## 4. Output

V1 produces a single markdown file per run.

**File name pattern:** `docs/reports/sms/daily/YYYY-MM-DD.md`  
**Example:** `docs/reports/sms/daily/2026-05-07.md`

The report must contain all twelve sections below, in this order. OpenClaw writes every section based on the structured JSON input it receives. Sections with no data must say so explicitly rather than being silently omitted.

---

### Report section structure

```
# Karry Kraze SMS Daily Report — YYYY-MM-DD

> Generated by: OpenClaw SMS Analyst V1
> Run mode: Manual read-only
> No SMS sends were created by this report.
> Data sourced from aggregate views only. No raw customer data accessed.

---

## 1. Executive Summary

(2-4 sentence plain-English overview of SMS system health. State whether the system is performing well, flat, or declining. Flag the single biggest win and single biggest risk in one sentence each.)

---

## 2. Yesterday's Performance

(Summarize yesterday's send/click/conversion data by flow from sms_v_flow_performance. Use a table if more than two flows had sends. Include total sends, total attributed revenue, and estimated profit. If yesterday had no sends, say so explicitly.)

---

## 3. Last 7 Days Summary

(Summarize 7-day aggregate performance: total sends, clicks, conversions, attributed revenue, estimated profit, STOP rate, bounce rate. Compare key flows. Identify any trend that is improving or declining.)

---

## 4. Top 3 Wins

(List three things the data shows are working well. Ground each win in a specific metric from the views. Label each as: WIN 1, WIN 2, WIN 3.)

---

## 5. Top 3 Risks

(List three things the data shows as potential problems: low conversion, high fatigue, poor cart recovery, rising STOP rate, etc. Ground each risk in a specific metric. Label each as: RISK 1, RISK 2, RISK 3.)

---

## 6. Coupon Notes

(Summarize coupon cohort performance from sms_v_coupon_cohorts. Note redemption rates, whether escalation coupons are outperforming initial coupons, and whether discount spending appears profitable. Flag if data is too sparse to conclude.)

---

## 7. Abandoned Cart Notes

(Summarize cart recovery from sms_v_abandoned_cart. Note recovery rate, which step recovers the most value, and whether serial abandoners are accumulating. Note avg_hours_to_purchase if available.)

---

## 8. Fatigue and Compliance Notes

(Summarize sms_v_fatigue_monitor. State current STOP rate and bounce rate. Note which fatigue bucket is largest. Flag if stop_rate_pct > 3% or bounce_rate_pct > 2% as warning thresholds. Note average sends per contact and whether high-fatigue contacts are growing.)

---

## 9. Three Recommended Actions

(List exactly three specific actions a human admin should consider based on the data. Each must be grounded in a metric from the views. Do not recommend sends or automation changes. Do recommend things like: adjust timing, pause a flow, check a coupon setting, investigate a gap.)

> Recommended actions are advisory only. No action should be taken without human review.

---

## 10. Three Draft SMS Ideas

(List exactly three draft message ideas based on what the data suggests. These are concept sketches — not final copy, not approved, not sent. Each must be labeled clearly.)

For each draft idea:
- Label: DRAFT IDEA [N] — DRAFT ONLY — NOT SENT — REQUIRES HUMAN APPROVAL — REQUIRES BACKEND VALIDATION
- Suggested flow
- Rough message concept (1-2 sentences)
- Why the data suggests this idea
- What would need to be validated before it could be used

---

## 11. Data Quality Warnings

(List any warnings about the data itself. Examples: a view returned zero rows, a field was missing or null, date filtering was not possible, a known audit gap may affect this data. Cite specific audit findings from smsAudit.md where relevant.)

Known audit gaps that must always be mentioned if applicable:
- sms_v_click_to_purchase may be affected by the sms-redirect updating last_sms_sent_at instead of a click field.
- Admin click delta counts may undercount clicks because the dashboard checks event_type='click' but events use 'sms_clicked'.
- If any view returns empty for yesterday but non-empty for 7 days, note that no sends ran yesterday.

---

## 12. No-Send Confirmation

> This report was generated by OpenClaw SMS Analyst V1 in read-only mode.
> No SMS messages were created, queued, or sent during this run.
> No rows were written to any Supabase table.
> No Twilio API calls were made.
> All data sourced from: sms_v_flow_performance, sms_v_coupon_cohorts, sms_v_abandoned_cart,
> sms_v_click_to_purchase, sms_v_subscriber_funnel, sms_v_fatigue_monitor.
```

---

## 5. Recommended File Structure

This is the proposed folder and file layout for V1. It fits inside the existing vanilla JS / Supabase / GitHub Pages project with no build step.

```
scripts/
  openclaw/
    fetch-sms-data.mjs       ← Node script: queries Supabase views, outputs structured JSON
    run-sms-report.mjs       ← Entry point: orchestrates fetch → prompt → OpenClaw → save report

prompts/
  openclaw/
    sms-analyst-v1.md        ← The OpenClaw prompt template (§9 of this spec)

docs/
  reports/
    sms/
      daily/
        .gitkeep             ← Keep folder in repo; actual report files are optionally gitignored
  audit/
    system/
      smsAudit.md            ← Existing audit (source of truth)
      openclawSmsPlan.md     ← Existing plan (source of truth)
      openclawSmsBuildV1.md  ← This file
```

### Notes on this structure

- `scripts/openclaw/` matches the existing pattern of root-level `.mjs` utility scripts in the project.
- `prompts/openclaw/` keeps the prompt file version-controlled alongside code, so changes are tracked in git.
- `docs/reports/sms/daily/` keeps reports out of the root and away from production HTML/JS.
- Report files can be gitignored if they should stay local, or committed if you want a git history of daily reports.
- No new `package.json` or build config needed. The existing project has Node available and `@supabase/supabase-js` can be used as-needed.

### `.gitignore` suggestion

Add to `.gitignore` if you do not want to commit report files:

```
docs/reports/sms/daily/
```

Or commit them to keep a historical log in the repo.

---

## 6. Execution Model

### Recommended approach: local Node.js CLI script, run manually

**Recommended command:**

```bash
node scripts/openclaw/run-sms-report.mjs
```

This is preferred over alternatives for these reasons:

| Consideration | Recommendation |
|---|---|
| Project already uses `.mjs` Node scripts at root level | Consistent with `import-legacy-orders.mjs`, `cleanup-stale-shipments.mjs`, etc. |
| No build step in the project | A plain `.mjs` script with no bundler needed |
| Works on both desktop and laptop | As long as `.env` or environment variables are set on each machine |
| Supabase JS client is already used project-wide | Reuse same client pattern from `js/config/env.js` equivalent |
| Manual trigger = human in the loop at the right time | You run it when you want a report; it does not run without you |
| Easy to understand and audit | Single file, sequential steps, clear output |

### Why not use a Supabase Edge Function

An Edge Function for V1 would require:
- Deploying a new function with the OpenClaw API key as a secret
- Creating a trigger or manual HTTP call
- Logging results somewhere in Supabase or returning via HTTP

This adds unnecessary complexity for a manual analyst step. Keep V1 local.

### Why not use an automated cron

Automating V1 before it has been run manually several times adds risk. The validation rules (§11) require a human check on every report. Manual-only is correct for V1.

### Workflow on desktop + laptop

Create a `.env` file at the project root on each machine. The script should load `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `OPENCLAW_API_KEY` from environment variables only.

Add `.env` to `.gitignore` (it likely already is).

On each machine where you want to run V1:
1. Clone or pull the repo as normal.
2. Ensure `.env` exists with the required keys.
3. Run `node scripts/openclaw/run-sms-report.mjs`.
4. Report saves to `docs/reports/sms/daily/YYYY-MM-DD.md`.

### Step-by-step script flow

```
1. Load env variables (SUPABASE_URL, SUPABASE_ANON_KEY, OPENCLAW_API_KEY).
2. Validate required env vars are present before querying anything.
3. Call fetch-sms-data.mjs to query all 6 views via anon key.
4. Normalize rows into the structured payload defined in §10.
5. Validate payload: check for empty views, missing fields, data quality.
6. Append data quality warnings to payload.
7. Load prompts/openclaw/sms-analyst-v1.md as the system prompt.
8. Serialize payload to JSON and include in user message.
9. Call OpenClaw API with system prompt + user message.
10. Receive markdown report from OpenClaw.
11. Prepend header with run date, source views, no-send confirmation.
12. Write report to docs/reports/sms/daily/YYYY-MM-DD.md.
13. Print "Report saved to docs/reports/sms/daily/YYYY-MM-DD.md" in terminal.
14. Exit cleanly.
```

---

## 7. Data Access Design

### Access method

Use the **Supabase anon key** to query the six aggregate views.

The anon key is already exposed in `js/config/env.js` for frontend use. The Node script can read it from the same `.env` file used by other project scripts.

### Why anon key and not service role

The `openclawSmsPlan.md` §9 explicitly requires:
- No Supabase service-role key in OpenClaw v1.
- No raw PII in OpenClaw prompts.
- No access to raw `customer_contacts`, `sms_messages`, `sms_consent_logs`, `sms_events`, `saved_carts`, or `orders_raw`.

If the aggregate views are accessible via anon key in Supabase (i.e., their underlying tables have RLS that allows the aggregate read, or the views have explicit grants), then anon key is sufficient.

### Required Supabase access grants for V1

A brief verification step before building: confirm each of these 6 views can be queried with the anon key. If a view returns `permission denied`, add a grant:

```sql
GRANT SELECT ON sms_v_flow_performance TO anon;
GRANT SELECT ON sms_v_coupon_cohorts TO anon;
GRANT SELECT ON sms_v_abandoned_cart TO anon;
GRANT SELECT ON sms_v_click_to_purchase TO anon;
GRANT SELECT ON sms_v_subscriber_funnel TO anon;
GRANT SELECT ON sms_v_fatigue_monitor TO anon;
```

These are aggregate views. They expose no raw phone, email, IP, or message body. Granting anon read on these views is safer than using service role in a script that also calls an external AI API.

**Important:** Do not grant anon SELECT on `sms_v_contact_fatigue`. That view contains per-contact data including phone.

### What the Node script must not touch

| Resource | Why forbidden in V1 |
|---|---|
| Supabase service-role key | Grants full DB access; not needed for read-only aggregate views |
| `customer_contacts` table | Contains phone, email, IP, consent PII |
| `sms_consent_logs` table | Contains consent evidence, IP, user-agent |
| `sms_messages` table | Contains message bodies and phone numbers |
| `sms_events` table | Contains click metadata and phone |
| `saved_carts` table | Contains cart contents linked to contacts |
| `orders_raw` table | Contains order and customer PII |
| `sms_v_contact_fatigue` view | Per-contact data with phone |
| Any Edge Function that sends SMS | Not called in V1 |
| Twilio API | No Twilio credentials in V1 |
| Any OpenClaw agent that can write or send | Read and report only |

### Credentials in V1

`.env` for V1:

```
SUPABASE_URL=https://yxdzvzscufkvewecvagq.supabase.co
SUPABASE_ANON_KEY=<anon key from config>
OPENCLAW_API_KEY=<openclaw key>
```

The OpenClaw API key is the only new credential V1 needs beyond what already exists. It must not be committed to git.

---

## 8. OpenClaw Role in V1

V1 has a clean separation between what code does deterministically and what OpenClaw reasons about.

### What the Node script does (deterministic)

| Task | Why code, not AI |
|---|---|
| Authenticate to Supabase | Fixed credentials, no reasoning needed |
| Query the 6 aggregate views | Deterministic SQL, not ambiguous |
| Receive rows and normalize into structured JSON | Data transformation, not language task |
| Validate that views returned expected fields | Rules-based check |
| Generate data quality warning messages | Rule-based: empty = warn |
| Prepend date, run mode, source list to report | Boilerplate, not reasoning |
| Write the markdown file to disk | File system operation |
| Exit with error if Supabase or OpenClaw calls fail | Error handling |

### What OpenClaw does (reasoning)

| Task | Why AI, not code |
|---|---|
| Interpret what aggregate metrics mean for the business | Requires business context and language fluency |
| Identify the top 3 wins from across all 6 views | Cross-view pattern recognition |
| Identify the top 3 risks from across all 6 views | Weighted judgment across heterogeneous metrics |
| Summarize coupon cohort behavior in plain English | Synthesize numbers into business insight |
| Identify what the abandoned cart funnel suggests | Interpret multi-step recovery data |
| Evaluate fatigue and compliance signals against thresholds | Apply domain knowledge about what thresholds matter |
| Write 3 recommended actions grounded in data | Non-obvious translation of data to next steps |
| Write 3 draft SMS ideas clearly labeled | Creative task with compliance constraints |
| Phrase every section in a way a human can act on | Natural language synthesis |

### What must remain deterministic and never be delegated to AI

| Task | Why it must stay in code |
|---|---|
| Deciding what data to query | AI must not add new data sources at runtime |
| Filtering out PII before the prompt | Privacy boundary must be enforced in code |
| Appending the no-send confirmation | Must be verifiably true, not AI-asserted |
| Writing the report file to disk | AI should not have file system access |
| Confirming no production writes occurred | Cannot be AI-asserted; must be structural |

---

## 9. Prompt Design

This is the first draft of the OpenClaw system prompt for V1.

**File:** `prompts/openclaw/sms-analyst-v1.md`

---

```
You are OpenClaw, an SMS marketing analyst for Karry Kraze, an e-commerce brand.

Your role in Version 1 is to read aggregate SMS performance data and write a plain-English analyst report. You are read-only. You do not send SMS messages. You do not modify database records. You do not create campaigns.

## Your constraints

- You are receiving pre-aggregated, PII-safe metrics only. You will not see raw phone numbers, email addresses, IP addresses, message bodies, or individual customer records.
- You cannot call Twilio.
- You cannot call Supabase Edge Functions.
- You cannot create coupons, promotions, or campaigns.
- Every draft SMS idea you write must be labeled: "DRAFT ONLY — NOT SENT — REQUIRES HUMAN APPROVAL — REQUIRES BACKEND VALIDATION"
- Every recommended action must be labeled as advisory only.
- If the data is too sparse to draw a conclusion, say so clearly rather than guessing.

## The Karry Kraze SMS system

Karry Kraze runs a Supabase + Twilio SMS marketing system with these active flows:
- signup: Immediate coupon SMS when a new subscriber opts in.
- coupon_reminder: Automated 24-hour reminder for unused coupons.
- coupon_escalation: Upgraded 20% coupon after original expires unused.
- abandoned_cart: 3-step sequence (30 min, 6 hours, 24 hours) for carts with value >= $15.
- welcome_series: Day 2 discovery and Day 5 coupon for new non-purchasing subscribers.
- upgrade: Coupon upgrade enrollment from landing pages.

Known data quality issues you should mention if they seem relevant:
- The admin click delta may undercount clicks because the dashboard checks event_type='click' but actual click events use event_type='sms_clicked'.
- The sms-redirect function updates last_sms_sent_at on click instead of a dedicated click field, which may affect frequency cap timing.
- sms_v_click_to_purchase data quality may be affected by the above click tracking issue.

## Input format

You will receive a JSON object called `sms_report_data` with this structure:
- report_date: ISO date string
- yesterday_window: start and end ISO timestamps
- last_7_days_window: start and end ISO timestamps
- flow_performance: rows from sms_v_flow_performance, period='yesterday' and period='last_7_days'
- coupon_cohorts: rows from sms_v_coupon_cohorts
- abandoned_cart: rows from sms_v_abandoned_cart
- click_to_purchase: aggregated rows from sms_v_click_to_purchase
- subscriber_funnel: row from sms_v_subscriber_funnel
- fatigue_monitor: row from sms_v_fatigue_monitor
- data_quality_warnings: list of warnings generated by the fetch script

## Output format

Write a markdown report with exactly these 12 sections in order:

1. Executive Summary
2. Yesterday's Performance
3. Last 7 Days Summary
4. Top 3 Wins
5. Top 3 Risks
6. Coupon Notes
7. Abandoned Cart Notes
8. Fatigue and Compliance Notes
9. Three Recommended Actions
10. Three Draft SMS Ideas
11. Data Quality Warnings
12. No-Send Confirmation

Use the section headers and format defined in the build spec. Do not add extra sections.

For the No-Send Confirmation section, always include this exact text verbatim:

> This report was generated by OpenClaw SMS Analyst V1 in read-only mode.
> No SMS messages were created, queued, or sent during this run.
> No rows were written to any Supabase table.
> No Twilio API calls were made.
> All data sourced from: sms_v_flow_performance, sms_v_coupon_cohorts, sms_v_abandoned_cart,
> sms_v_click_to_purchase, sms_v_subscriber_funnel, sms_v_fatigue_monitor.

## Tone

Write for a solo e-commerce operator who understands their business but is not a data engineer. Be direct and specific. Use numbers from the data. Do not hedge unnecessarily, but do flag genuine data gaps clearly. Prefer short sentences over long ones.
```

---

### How to invoke the prompt

In `run-sms-report.mjs`, the call structure is:

```javascript
const systemPrompt = fs.readFileSync('prompts/openclaw/sms-analyst-v1.md', 'utf8');
const userMessage = `Here is today's SMS data:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\nPlease write the Daily SMS Analyst Report for ${reportDate}.`;
```

Pass `systemPrompt` as the system message and `userMessage` as the user message. Request markdown-formatted output.

---

## 10. Suggested Report JSON / Intermediate Data Shape

This is the normalized JSON object the script builds from the 6 view queries and passes to OpenClaw. No raw PII is present at any field.

```jsonc
{
  "report_date": "2026-05-07",
  "generated_at": "2026-05-07T14:32:00Z",
  "yesterday_window": {
    "start": "2026-05-06T00:00:00Z",
    "end": "2026-05-06T23:59:59Z"
  },
  "last_7_days_window": {
    "start": "2026-04-30T00:00:00Z",
    "end": "2026-05-06T23:59:59Z"
  },

  "flow_performance": {
    "yesterday": [
      {
        "flow": "signup",
        "campaign": null,
        "total_sends": 12,
        "delivered": 11,
        "unique_clicks": 4,
        "conversions": 1,
        "conversion_rate_pct": 8.33,
        "sms_cost": 0.11,
        "attributed_revenue": 34.99,
        "discounts_issued": 5.00,
        "estimated_profit": 18.20,
        "profit_per_sms": 1.52
      }
      // ... one row per flow
    ],
    "last_7_days": [
      // ... same shape, 7-day totals per flow
    ]
  },

  "coupon_cohorts": [
    {
      "cohort": "initial",
      "total_coupons_issued": 142,
      "redeemed": 28,
      "redemption_rate_pct": 19.72,
      "attributed_orders": 28,
      "avg_order_value": 42.10,
      "avg_profit_per_order": 14.30,
      "total_discounts": 284.00,
      "total_sms_cost": 1.42
    },
    {
      "cohort": "escalation",
      "total_coupons_issued": 38,
      "redeemed": 9,
      "redemption_rate_pct": 23.68,
      "attributed_orders": 9,
      "avg_order_value": 51.40,
      "avg_profit_per_order": 9.80,
      "total_discounts": 228.00,
      "total_sms_cost": 0.38
    }
  ],

  "abandoned_cart": {
    "total_carts": 64,
    "active_carts": 7,
    "purchased_carts": 18,
    "expired_carts": 39,
    "step1_sends": 42,
    "step2_sends": 21,
    "step3_sends": 14,
    "total_recovered_value": 912.40,
    "recovery_rate_pct": 28.13,
    "serial_abandoners": 4,
    "avg_hours_to_purchase": 9.7
  },

  "click_to_purchase": {
    "total_attributed_orders": 47,
    "avg_hours_to_purchase": 11.4,
    "within_24h_pct": 78.7,
    "within_48h_pct": 93.6,
    "by_flow": [
      { "flow": "coupon_reminder", "avg_hours": 8.2, "order_count": 14 },
      { "flow": "abandoned_cart", "avg_hours": 13.1, "order_count": 18 }
    ],
    "by_attribution_method": [
      { "method": "coupon_direct", "order_count": 28 },
      { "method": "click_window", "order_count": 19 }
    ]
  },

  "subscriber_funnel": {
    "total_subscribers": 312,
    "active_subscribers": 271,
    "unsubscribed": 34,
    "clicked_at_least_once": 89,
    "redeemed_coupon": 61,
    "purchased": 47,
    "click_rate_pct": 32.8,
    "redeem_rate_pct": 22.5,
    "purchase_rate_pct": 17.3
  },

  "fatigue_monitor": {
    "total_contacts": 312,
    "active_contacts": 271,
    "stopped_contacts": 34,
    "bounced_contacts": 7,
    "stop_rate_pct": 10.9,
    "bounce_rate_pct": 2.2,
    "fatigue_low": 198,
    "fatigue_medium": 54,
    "fatigue_high": 19,
    "avg_sends_per_contact": 4.1,
    "avg_clicks_per_contact": 0.9
  },

  "data_quality_warnings": [
    "sms_v_click_to_purchase returned no date-filtered rows. Full view data used.",
    "Known issue: click count may be underreported due to sms_clicked vs click event_type mismatch in admin analytics.",
    "Known issue: sms-redirect updates last_sms_sent_at on click; click timing data may not be fully reliable."
  ]
}
```

### Notes on the data shape

- All fields are aggregates. No phone numbers, emails, IPs, user-agents, or message bodies appear anywhere.
- `flow_performance` is split into `yesterday` and `last_7_days` arrays. If a date window could not be applied, the script should include a warning note and still pass the available data.
- `click_to_purchase` is pre-aggregated by the script before it reaches OpenClaw. The raw view may return per-order rows; the script collapses them.
- `data_quality_warnings` is always an array; if there are no warnings, it is an empty array `[]`.
- The JSON values shown above are illustrative examples only. Real values come from actual Supabase view queries.

---

## 11. Validation Rules

These rules apply to every V1 run. The script enforces structural rules. OpenClaw enforces content rules.

### Script-enforced rules (non-negotiable)

| Rule | How enforced |
|---|---|
| No sends during V1 run | Script never calls any Edge Function or Twilio API |
| No writes to Supabase tables | Script uses only SELECT queries via anon key |
| No raw PII in JSON payload | Script reads only aggregate views; no per-row contact queries |
| No service-role key | Script uses only anon key |
| No Twilio credentials in script | No Twilio SDK or credential loaded |
| Report is saved to local file only | `fs.writeFileSync` to `docs/reports/sms/daily/YYYY-MM-DD.md` |
| Data quality warnings always included | Script generates warning array; OpenClaw must include it verbatim |

### Script validation before calling OpenClaw

Before passing data to OpenClaw, the script must check:

```
1. SUPABASE_URL is set.
2. SUPABASE_ANON_KEY is set.
3. OPENCLAW_API_KEY is set.
4. At least one view returned rows. If all views are empty, abort and print an error.
5. sms_v_subscriber_funnel returned at least one row.
6. sms_v_fatigue_monitor returned at least one row.
7. Payload JSON does not contain raw phone patterns (basic regex check: /\+1\d{10}/ in JSON string → abort).
```

If check 7 fails, the script must abort immediately with an error message:
```
ERROR: Phone number pattern detected in payload. Aborting. Do not send this data to OpenClaw.
```

This is a safety backstop for the case where a view unexpectedly returns raw phone data.

### OpenClaw content rules (enforced by prompt design)

| Rule | Where enforced |
|---|---|
| Every draft SMS idea labeled clearly | Prompt instruction §9 |
| Recommended actions labeled advisory | Prompt instruction §9 |
| Data gaps stated explicitly, not glossed over | Prompt instruction §9 |
| No-send confirmation text is exact and verbatim | Prompt instruction §9 |
| Known audit gaps mentioned if relevant | Prompt instruction §9 — known issues section |

### Report review checklist for human reader

After each run, the human reading the report should confirm:

- [ ] The no-send confirmation section is present and complete.
- [ ] The report cites actual numbers (not "the data suggests" without figures).
- [ ] Draft ideas are clearly labeled draft-only.
- [ ] Data quality warnings section is present (even if empty).
- [ ] Report date matches the run date.

---

## 12. Implementation Steps

Build V1 in this order. Each step is small enough to test independently.

### Step 1 — Verify view access (30 min)

Run manual Supabase SQL editor queries to confirm all 6 views exist and return rows:

```sql
SELECT * FROM sms_v_flow_performance LIMIT 5;
SELECT * FROM sms_v_coupon_cohorts LIMIT 5;
SELECT * FROM sms_v_abandoned_cart LIMIT 5;
SELECT * FROM sms_v_click_to_purchase LIMIT 5;
SELECT * FROM sms_v_subscriber_funnel LIMIT 5;
SELECT * FROM sms_v_fatigue_monitor LIMIT 5;
```

If any query returns `permission denied` with the anon key, add the GRANT from §7 in a new migration file.

### Step 2 — Create folder structure

```
mkdir scripts/openclaw
mkdir prompts/openclaw
mkdir -p docs/reports/sms/daily
```

Add `docs/reports/sms/daily/.gitkeep` to keep the folder in git (or add to `.gitignore` if reports should stay local).

### Step 3 — Write `scripts/openclaw/fetch-sms-data.mjs`

This module:
- Accepts an optional date range argument.
- Imports `createClient` from `@supabase/supabase-js`.
- Reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `process.env`.
- Queries each of the 6 views.
- Returns the raw rows as named properties.
- Does not call OpenClaw; data fetch is separate from AI call.

Export a single async function:

```javascript
export async function fetchSmsData({ yesterday, last7days }) { ... }
```

Returns an object with keys: `flowPerformance`, `couponCohorts`, `abandonedCart`, `clickToPurchase`, `subscriberFunnel`, `fatigueMonitor`.

### Step 4 — Write the payload normalizer inside `fetch-sms-data.mjs`

A pure function:

```javascript
export function normalizePayload({ rawViews, reportDate, warnings }) { ... }
```

- Accepts raw view rows.
- Applies the data shape from §10.
- Runs the phone pattern safety check (Step 7 in §11 validation rules).
- Adds `data_quality_warnings` array.
- Returns the final JSON object.

### Step 5 — Create `prompts/openclaw/sms-analyst-v1.md`

Copy the exact prompt text from §9 of this spec into that file. No modifications yet.

### Step 6 — Write `scripts/openclaw/run-sms-report.mjs`

This is the entry point. It:

1. Loads `dotenv` or reads `process.env` directly.
2. Validates required env vars (abort if missing).
3. Calls `fetchSmsData`.
4. Calls `normalizePayload`.
5. Reads `prompts/openclaw/sms-analyst-v1.md`.
6. Builds the API request to OpenClaw.
7. Calls the OpenClaw API.
8. Prepends the report header (date, source views, no-send confirmation).
9. Writes markdown to `docs/reports/sms/daily/YYYY-MM-DD.md`.
10. Prints success message to terminal.

Use `import { createClient } from '@supabase/supabase-js'` — same client already used project-wide.

### Step 7 — Install dependencies if needed

The project already has `package.json`. Check:

```bash
node -e "import('@supabase/supabase-js').then(() => console.log('ok'))"
```

If `supabase-js` is not installed:

```bash
npm install @supabase/supabase-js
```

For `.env` reading in Node:

```bash
npm install dotenv
```

Or use `--env-file .env` flag if using Node >= 20:

```bash
node --env-file=.env scripts/openclaw/run-sms-report.mjs
```

### Step 8 — Create `.env` with required keys

Add to `.env` at project root (confirm `.gitignore` already excludes it):

```
SUPABASE_URL=https://yxdzvzscufkvewecvagq.supabase.co
SUPABASE_ANON_KEY=<from js/config/env.js or Supabase dashboard>
OPENCLAW_API_KEY=<openclaw key>
```

### Step 9 — First test run

```bash
node --env-file=.env scripts/openclaw/run-sms-report.mjs
```

Expected results:
- Terminal prints the report file path.
- `docs/reports/sms/daily/YYYY-MM-DD.md` exists.
- Report has all 12 sections.
- No-send confirmation is present.
- Data quality warnings section is present.

### Step 10 — Validate the report manually

Use the human review checklist from §11. If any section is missing or the numbers look wrong, check the view queries in step 3 first.

### Step 11 — Commit the scripts and prompt (not the report)

```bash
git add scripts/openclaw/ prompts/openclaw/ docs/reports/sms/daily/.gitkeep
git commit -m "feat: add OpenClaw SMS Analyst V1 scripts and prompt"
```

Do not commit `.env` or report files.

---

## 13. Definition of Done

V1 is finished when all of the following are true:

**Structural:**
- [ ] `scripts/openclaw/fetch-sms-data.mjs` exists and queries all 6 views via anon key.
- [ ] `scripts/openclaw/run-sms-report.mjs` exists and orchestrates the full pipeline.
- [ ] `prompts/openclaw/sms-analyst-v1.md` exists and matches §9 of this spec.
- [ ] `docs/reports/sms/daily/` folder exists in the repo.

**Functional:**
- [ ] Running `node --env-file=.env scripts/openclaw/run-sms-report.mjs` produces a report without errors.
- [ ] Report file is saved to `docs/reports/sms/daily/YYYY-MM-DD.md`.
- [ ] Report contains all 12 required sections from §4.
- [ ] No-send confirmation section is present and verbatim.
- [ ] Data quality warnings section is present.
- [ ] At least one flow appears in Yesterday's Performance or a clear note explains why not.

**Safety:**
- [ ] Script makes no writes to any Supabase table.
- [ ] Script does not call any Edge Function.
- [ ] Script does not call Twilio.
- [ ] No raw phone numbers appear in the JSON payload (safety check passes).
- [ ] No service-role key is used.

**Process:**
- [ ] Report has been read by a human and the three recommended actions have been reviewed.
- [ ] At least two reports have been generated on separate days without errors.
- [ ] Scripts and prompt are committed to git on the `main` branch.
- [ ] `.env` and report files are excluded from git.

---

## 14. Recommended Next Step After V1

After V1 is running and has produced at least two clean reports, the next step is **V2: Draft Storage**.

V2 does not change the report format. V2 adds the ability to save the three draft SMS ideas from every report into a new `sms_drafts` Supabase table, so they accumulate over time and can be reviewed by a human before any are used.

### What V2 requires

1. A new Supabase migration that creates the `sms_drafts` table using the schema defined in `openclawSmsPlan.md` §5.
2. RLS policy: OpenClaw can `INSERT` into `sms_drafts`. OpenClaw cannot `UPDATE` or `DELETE`. Admins can read, edit, update `approval_status`, and delete.
3. The `run-sms-report.mjs` script gains a flag: `--save-drafts`. When this flag is set, the script extracts the three draft ideas from the OpenClaw report and writes them to `sms_drafts` with `approval_status='draft'` and `created_by='openclaw_v1'`.
4. A simple admin page (or additions to the existing `pages/admin/sms-analytics.html`) shows pending drafts and allows approve/reject actions.

### What V2 does not change

- V2 does not send any SMS.
- V2 does not change the report format or prompt.
- V2 does not add new data sources.
- V2 does not move toward automation.

### Why V2 before V3

Draft storage creates an audit trail of AI ideas over time. This helps evaluate whether OpenClaw's suggestions are useful before building a full approval UI. It also establishes the schema early, which makes Phase 3 (approval workflow) a smaller build.

### After V2

V3 is the admin approval UI. V3 lets a human see all pending drafts, edit copy, and mark a draft `approved` or `rejected`. V3 is Phase 3 from `openclawSmsPlan.md`. It requires the fixes listed in §11 of that plan before any approved draft is ever used in an actual send.

The rule remains: **OpenClaw recommends. Supabase validates. Human approves. `send-sms` executes.**
