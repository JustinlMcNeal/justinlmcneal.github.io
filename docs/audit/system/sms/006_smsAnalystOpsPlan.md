# SMS Analyst Operations Plan
**System:** Karry Kraze SMS Analyst V1  
**Last updated:** 2026-05-09  

---

## 1. Objective

The daily SMS report exists to answer one question each morning:  
**Is the SMS system earning its cost, and does anything need my attention today?**

At Karry Kraze's current scale, most days will show no conversions — that is normal for a small list. The report is not primarily a wins board. It is an early-warning system. If something breaks (high bounce, rising stops, a flow going silent), this report should catch it within 24 hours.

Secondary use: building a paper trail. Over time, weekly and monthly reads reveal patterns that a single daily snapshot cannot — whether a flow is slowly degrading, whether coupon redemption tracking is drifting, whether spend is increasing without revenue following.

---

## 2. Recommended Run Cadence

**Daily** — run the report each morning before opening the admin panel.  
The full run takes under 60 seconds:
```
node --env-file=.env scripts/openclaw/run-sms-report.mjs
```
The report saves to `docs/reports/sms/daily/YYYY-MM-DD.md`. Open it, skim Sections 1–3 and 11, move on unless something flags.

**Weekly** — on Friday or Monday, spend 5–10 minutes comparing the current report to the report from 7 days prior. Look at trend direction across flows. See §5 below.

**Monthly** — spend 15–20 minutes on the first of the month reviewing the full month of daily reports. See §6 below.

You do not need to act on every report. Most reports are "nothing to flag, system healthy." The value is cumulative — you are building awareness before a problem becomes expensive.

---

## 3. What to Review First

Read in this order:

1. **Section 11: Data Quality Warnings** — check this first, every time. If a view failed or returned zero rows, the rest of the report may be misleading. Do not skip this.

2. **Section 1: Executive Summary** — two sentences. Is the system strong / flat / declining? Name the risk called out.

3. **Section 2: Yesterday's Performance** — did any flows send? Any conversions? If zero sends across all flows for a day, that is worth investigating (cron may have failed).

4. **Section 5: Top 3 Risks** — a quick scan for anything system-level (stops, bounces, tracking gaps).

5. **Sections 6 and 7 only if flagged** — coupon mismatch or abandoned cart anomaly. Otherwise these are background reads.

The remaining sections (4, 8, 9, 10) are worth reading but do not need daily decision-making.

---

## 4. Action Thresholds

These are the practical triggers to investigate immediately vs. monitor over time.

### Immediate investigation (act same day)

| Signal | Threshold | What to check |
|---|---|---|
| Stop rate spike | `stop_rate_pct` > 3% | Check what was sent in the last 48 hours. Was it outside quiet hours? Did a STOP text not unsubscribe correctly? |
| Bounce rate spike | `bounce_rate_pct` > 2% | Twilio error codes in `sms_messages`. Carrier filtering or invalid numbers. |
| Zero sends for 2+ consecutive days | All flows show 0 `total_sends` | Check pg_cron logs in Supabase. Check that `send-sms` edge function is deployed and healthy. |
| Flow was expected but missing from report | e.g. abandoned cart should be sending but flow absent | Check `sms_sends` directly for that flow. Check cron schedule. |

### Monitor over 3–5 days before acting

| Signal | Threshold | What to watch |
|---|---|---|
| No conversions | Conversion rate 0% for 5+ consecutive days | Normal on a small list. Flag if it persists for 2+ weeks. |
| Click rate declining | `unique_clicks` falling week over week | May indicate message fatigue or timing problems. |
| Abandoned cart step 1 not sending | `step1_sends` static or zero | Check the abandoned cart cron and minimum cart value threshold. |
| Escalation coupon shows no redemptions | 0 redemptions for escalation cohort | Could be a coupon code issue; check promotions table. |

### Background / monthly review

| Signal | What to assess |
|---|---|
| `avg_hours_to_purchase` drifting above 60 | Customers delaying — consider timing adjustments |
| `fatigue_high` growing as % of active list | Frequency is too high relative to list size |
| `discounts_issued` growing without `attributed_revenue` | Coupon spend is not recovering cost |

### Coupon tracking mismatch rule

If `attributed_orders > 0` but `redeemed = 0` (or `redemption_rate_pct = 0`) for any cohort: **do not count that revenue as confirmed**. Treat it as a data gap and log it. Investigate before using the number in any business decision.

---

## 5. Weekly Review Workflow

Take 5–10 minutes on Friday or Monday:

1. Open today's report and last Friday's report side by side.
2. For each active flow, note whether `total_sends` is up, down, or flat vs. last week.
3. Check: did any flow convert this week that had zero last week? Did any flow stop sending?
4. Check Section 11 across both reports — are the same warnings repeating? Repeating warnings are a backlog item, not just noise.
5. Write 1–3 bullet points in `docs/audit/system/sms/002_smsChangeLog.md` (see §8) summarizing what you observed and whether any action is needed.
6. If a draft SMS idea from Section 10 looked worth trying, copy it into a separate scratch note for follow-up.

---

## 6. Monthly Review Workflow

On the first of each month, spend 15–20 minutes:

1. Skim every daily report from the prior month. You are looking for patterns, not reading every word.
2. Answer these 5 questions:
   - Did any flow go silent for more than 3 days without a known reason?
   - Is the abandoned cart recovery rate trending up or down over the month?
   - Is fatigue_high growing as a percentage of the active list?
   - Did the coupon cohort mismatch (attributed orders with 0 redemptions) get resolved or is it still open?
   - Did stop_rate_pct spike at any point, even briefly?
3. If any answer is concerning, add it to `002_smsChangeLog.md` as a finding.
4. Decide whether any system config needs adjustment (timing, coupon value, flow thresholds). If yes, make the change and log it.
5. Note whether the list is growing. If `total_subscribers` in `sms_v_subscriber_funnel` is flat for 30 days, the signup flow may need attention.

---

## 7. How to Use Draft SMS Ideas

Draft ideas in Section 10 are **concept sketches only**. They are not instructions. The analyst V1 intentionally generates conservative ideas grounded in the current data, but it cannot:

- Verify that a coupon code exists and is active
- Check that quiet hours pass for the target segment
- Validate that a contact hasn't already received the same flow
- Write compliant TCPA/CTIA copy

**Safe process for a draft idea:**

1. Read it. Does it make sense given what you know about your customers?
2. If yes, find the specific metric it was based on. Confirm that metric in the report data.
3. Write the actual message copy yourself. Do not use the AI concept text verbatim.
4. Check: is there an existing flow for this? If yes, it may just need a timing or content tweak.
5. Manually validate: correct coupon exists, correct contact segment, quiet hours pass, no duplicate send risk.
6. Log the change in `002_smsChangeLog.md` before sending.

**Rule of thumb:** if an idea requires a new flow, a new table, or a new Edge Function, it is a technical task — add it to your dev backlog, not your same-day to-do list.

---

## 8. Change Log Recommendation

Keep a simple markdown file at:
```
docs/audit/system/sms/002_smsChangeLog.md
```

Suggested entry format:
```markdown
## YYYY-MM-DD — [one-line description]

**What changed:** [what you did, 1–2 sentences]
**Why:** [what metric or report finding prompted it]
**Result:** [what happened on the next 1–3 reports after the change]
**Status:** open | resolved | monitoring
```

Examples of log-worthy events:
- Adjusted a coupon value or expiry
- Changed timing on a pg_cron job
- Deployed a new edge function version
- Ran a test send
- Investigated a warning and found no issue
- Found a data gap and decided to leave it for now

This file does not need to be long. Even one entry per week is valuable. After 3 months it becomes the most important reference for understanding why the system is configured the way it is.

---

## 9. Recommended Companion Files

Keep these lightweight docs alongside the report system:

| File | Purpose |
|---|---|
| `docs/audit/system/sms/002_smsChangeLog.md` | Track every change you make and its outcome (see §8) |
| `docs/audit/system/smsFlowNotes.md` | One section per flow: intent, current config, last reviewed date, any known quirks |
| `docs/audit/system/smsCouponIndex.md` | List every active coupon code, its flow, its expiry, and whether it has been validated recently |
| `docs/audit/system/sms/001_smsKnownGaps.md` | Running list of known data quality issues and their status (open / investigating / resolved) |

None of these need to be long. A few bullets per flow or issue is enough. Their value is as a reference when something breaks and you need to reconstruct what was set up and when.

---

## 10. What Not to Automate Yet

Keep these manual for now:

| Task | Why manual is better right now |
|---|---|
| Acting on draft SMS ideas | List is too small; bad sends have outsized list health impact |
| Pushing migration SQL | Out-of-order migration history; `db push` is blocked — apply via `db query -f` and log it |
| Adjusting coupon values or timing | Too early to have enough data to auto-optimize; needs human judgment |
| Interpreting coupon mismatch / attribution gaps | Known data quality issues; auto-action on bad data causes cascading errors |
| Sending the daily report to anyone else | Until data quality warnings are consistently clean, the report is internal only |
| Scheduling cron for the report script itself | Manual runs during V1 phase make it easier to spot when the script itself has a bug |

---

## 11. Next Technical Priorities

In the right order for a solo operator:

**Priority 1 — Fix coupon tracking mismatch (high signal, low effort)**  
The recurring `attributed_orders > 0, redeemed = 0` gap in `sms_v_coupon_cohorts` means revenue attribution cannot be trusted. Investigate whether `orders_raw.sms_send_id` is being set correctly and whether `promotions.usage_count` is incrementing on checkout. This is a data correctness issue, not a feature.

**Priority 2 — Add `sms_v_click_to_purchase` data (currently always zero rows)**  
The click-to-purchase section returns zero rows on every report. Confirm that `sms_events` rows with `event_type = 'sms_clicked'` are actually being written. Check `sms-redirect` edge function is logging events correctly. This is a tracking gap, not an analytics gap.

**Priority 3 — Fix the event_type mismatch (low effort, improves all click metrics)**  
Admin dashboard queries `event_type = 'click'`; actual events use `event_type = 'sms_clicked'`. Align one to the other. This affects every click metric across all analytics views.

**Priority 4 — Route remaining flows through `send-sms` wrapper (medium effort)**  
`sms-abandoned-cart`, `sms-coupon-reminder`, `sms-welcome-series`, and `coupon-upgrade` bypass the daily/weekly cap enforcement. Routing them through `send-sms` closes the compliance gap. Do this flow by flow, not all at once.

**Priority 5 — Daily report cron (after V1 is stable)**  
Once the script runs cleanly for 2 weeks with no data errors, schedule it with pg_cron or a GitHub Action to run each morning. Until then, manual is safer.

**Priority 6 — V2 report additions (after data quality is clean)**  
Consider adding per-contact suppression visibility, cohort aging, or a revenue-per-subscriber metric. Do not add V2 features until V1 warnings are consistently clean.
