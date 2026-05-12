# SMS Flow Analytics Fix Plan
**Status**: Draft — awaiting review  
**Date**: 2026-05-09  
**Author**: Audit system  

---

## §1 Background

The V1 SMS report (`scripts/openclaw/fetch-sms-data.mjs` → `run-sms-report.mjs`) attempts to fetch 7-day rolling data from the `sms_v_flow_performance` view. As of the 2026-05-08 report run, every section that depends on that view shows "all-time data" with this logged error:

> `sms_v_flow_performance: date filter on 'sent_at' failed (column sms_v_flow_performance.sent_at does not exist); returning all-time data.`

The report header notes:
> "Flow send and conversion figures are not 7-day bounded. sms_v_flow_performance could not be date-filtered; those totals reflect all time."

This makes trends meaningless — two reports on different days return identical numbers.

---

## §2 Root Cause

### `sms_v_flow_performance` — current definition

```sql
SELECT
  s.flow,
  s.campaign,
  s.intent,
  COUNT(*)                  AS total_sends,
  ...
  MIN(s.created_at)         AS first_send,   -- aggregate, not filterable
  MAX(s.created_at)         AS last_send     -- aggregate, not filterable
FROM sms_sends s
...
GROUP BY s.flow, s.campaign, s.intent
ORDER BY total_sends DESC;
```

**The problem**: The GROUP BY collapses all rows into one summary row per `(flow, campaign, intent)` tuple. `created_at` from `sms_sends` becomes `first_send` / `last_send` aggregates — the date is gone at the output level. There is no `sent_at` column in the view's SELECT list that a caller could filter on.

When `fetch-sms-data.mjs` does:
```js
.from("sms_v_flow_performance").gte("sent_at", dateWindow)
```
Postgres returns:
```
column sms_v_flow_performance.sent_at does not exist
```

### Why other views work

Views like `sms_v_outcome_aging` expose a bucketed time column (`aging_bucket`) calculated from `sms_sends.created_at`, so they can be filtered. `sms_v_flow_performance` was designed as an all-time summary and never included a date dimension.

---

## §3 Relevant Tables & Timestamp Columns

| Table | Timestamp column | Purpose |
|---|---|---|
| `sms_sends` | `created_at` | When the send was orchestrated — primary date for flow performance |
| `sms_messages` | `sent_at` | When Twilio accepted the message (set by `send-sms` function) |
| `sms_messages` | `delivered_at` | When Twilio confirmed delivery (set by `twilio-webhook`) |
| `sms_events` | `created_at` | When a tracked link was clicked |
| `orders_raw` | `created_at` | Attributed order placement time |

For date-bounding flow performance (sends, conversions, revenue), `sms_sends.created_at` is the correct primary timestamp. It is always populated, indexed (`idx_sends_created`), and represents "when did we send this".

---

## §4 Options Considered

### Option A — Modify `sms_v_flow_performance` directly

Add a `sent_date DATE` column to the existing view's SELECT and GROUP BY.

**SQL change:**
```sql
CREATE OR REPLACE VIEW sms_v_flow_performance AS
SELECT
  DATE(s.created_at) AS sent_date,   -- new
  s.flow,
  s.campaign,
  s.intent,
  ...
FROM sms_sends s
...
GROUP BY DATE(s.created_at), s.flow, s.campaign, s.intent  -- changed
```

**Pros**: Single view, no new migration artifact.  
**Cons**:  
- Changes the GROUP BY key → multiplies rows by day. Existing callers that query the view for all-time summaries will now get one row per `(day, flow, campaign, intent)` instead of one row per `(flow, campaign, intent)`.  
- The **admin analytics page** (`pages/admin/analytics.html`) and any other direct queries against the view would break silently — they'd start double-counting.  
- Risk is high. **Not recommended.**

---

### Option B — New companion view `sms_v_flow_performance_dated` ✅ Recommended

Create a new view alongside the existing one. The new view adds `sent_date DATE` to the GROUP BY so it can be date-filtered. The existing `sms_v_flow_performance` is untouched.

**Pros**:  
- Zero backward-compat risk.  
- `fetch-sms-data.mjs` queries the new view for 7-day windows; existing admin code continues querying the original view.  
- Simple additive migration.  

**Cons**: Two views to maintain if the schema changes; the SQL is mostly duplicated.

---

### Option C — Supabase RPC function with start/end parameters

Create a Postgres function `sms_flow_performance_range(start_date timestamptz, end_date timestamptz)` that takes date bounds and returns the same columns.

**Pros**: No view proliferation, explicit params.  
**Cons**: Requires `rpc()` call instead of `.from()` in the script and admin code. Minor refactor. Adds a function that needs deployment.

---

### Option D — Client-side aggregation in `fetch-sms-data.mjs`

Skip the view. Query `sms_sends` directly with a `created_at` date filter and aggregate in JavaScript.

**Pros**: No migration needed.  
**Cons**: Re-implements the complex multi-join aggregation (orders, events, messages) in JS. Fragile. Slower. No reuse by admin. **Not recommended.**

---

## §5 Recommended Approach — Option B

Create a new Supabase migration that adds `sms_v_flow_performance_dated`.

**Key design decisions:**
1. Identical JOIN structure to `sms_v_flow_performance` so the numbers align.
2. Adds `sent_date DATE` via `DATE(s.created_at)` to SELECT and GROUP BY.
3. `first_send` / `last_send` aggregate columns are omitted — they are meaningless on a daily-bucket view.
4. New index hint: `idx_sends_created` already exists — no new index needed.

**Proposed view columns:**
| Column | Type | Source |
|---|---|---|
| `sent_date` | DATE | `DATE(s.created_at)` — filterable |
| `flow` | TEXT | `s.flow` |
| `campaign` | TEXT | `s.campaign` |
| `intent` | TEXT | `s.intent` |
| `total_sends` | BIGINT | `COUNT(*)` |
| `delivered` | BIGINT | `SUM(CASE WHEN m.status IN ('delivered','sent') THEN 1 ELSE 0 END)` |
| `unique_clicks` | BIGINT | `COUNT(DISTINCT e_click.phone)` |
| `conversions` | BIGINT | `SUM(CASE WHEN s.outcome = 'converted' THEN 1 ELSE 0 END)` |
| `conversion_rate_pct` | NUMERIC | computed |
| `total_sms_cost` | NUMERIC | `SUM(s.cost)` |
| `attributed_revenue` | NUMERIC | from orders_raw join |
| `total_discount_given` | NUMERIC | from orders_raw join |
| `estimated_profit` | NUMERIC | computed |
| `profit_per_sms` | NUMERIC | computed |

**Caller usage (new syntax in `fetch-sms-data.mjs`):**
```js
const { data, error } = await sb
  .from("sms_v_flow_performance_dated")
  .select("*")
  .gte("sent_date", yesterdayStr)   // e.g. '2026-05-07'
  .lte("sent_date", todayStr);      // e.g. '2026-05-08'
```

This returns only rows where sends occurred in the date window — exactly what the report needs.

---

## §6 Impact on Existing Systems

| System | Current query target | Impact of fix |
|---|---|---|
| Admin analytics page | `sms_v_flow_performance` | **None** — untouched |
| OpenClaw V1 script `fetch-sms-data.mjs` | `sms_v_flow_performance` (broken date filter) | Updated to query `sms_v_flow_performance_dated` for date-bounded sections |
| All-time totals (if ever needed) | `sms_v_flow_performance` | Still available unchanged |
| Any future tooling | Can choose either view based on need | No conflict |

---

## §7 Migration Plan

### Step 1 — Write migration file

File: `supabase/migrations/20260509_sms_flow_performance_dated.sql`

Content: `CREATE OR REPLACE VIEW sms_v_flow_performance_dated AS ...` with `sent_date` added to SELECT and GROUP BY, otherwise identical JOIN pattern to existing view.

### Step 2 — Update `fetch-sms-data.mjs`

- For the "Flow Performance" section: change `.from("sms_v_flow_performance")` to `.from("sms_v_flow_performance_dated")` and add `.gte("sent_date", start).lte("sent_date", end)`.
- Keep any all-time totals (if used) pointed at the original view.
- Update the error fallback message to match new column name.

### Step 3 — Push migration to Supabase

```
npx supabase db push --linked
```

### Step 4 — Validate with a manual query

```sql
SELECT * FROM sms_v_flow_performance_dated
WHERE sent_date >= '2026-05-01' AND sent_date <= '2026-05-08'
ORDER BY sent_date DESC, total_sends DESC;
```

Verify:
- Row count is reasonable (one row per day × flow × campaign).
- `total_sends` values match `sms_v_flow_performance` totals when date range is all-time.

### Step 5 — Run V1 report script

```
node scripts/openclaw/fetch-sms-data.mjs
```

Confirm no `sent_at` column errors in output. Confirm section headers no longer say "all-time data".

---

## §8 Backward Compatibility Checklist

- [ ] `sms_v_flow_performance` SELECT list unchanged
- [ ] `sms_v_flow_performance` GROUP BY unchanged
- [ ] Admin analytics JS queries unchanged
- [ ] No existing RLS policies reference the new view (service_role and authenticated grants need adding to the new view in the migration)
- [ ] `005_openclawSmsBuildV1.md` field table updated to note both views

---

## §9 Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| New view has different numbers than original | Medium | Step 4 cross-check: total across all dates should equal all-time summary |
| RLS blocks anonymous queries | Low | Explicitly GRANT SELECT on new view to `authenticated` and `service_role` in migration |
| `sent_date` timezone ambiguity | Low | Use `DATE(s.created_at AT TIME ZONE 'America/New_York')` if business wants local-day bucketing instead of UTC |
| `fetch-sms-data.mjs` date string format mismatch | Low | Use `YYYY-MM-DD` string format; Postgres accepts it for DATE comparisons |

---

## §10 Definition of Done

- [ ] Migration file written and pushed successfully (`supabase db push --linked` with no errors).
- [ ] `SELECT * FROM sms_v_flow_performance_dated WHERE sent_date = CURRENT_DATE - 1` returns data.
- [ ] V1 report (`node scripts/openclaw/fetch-sms-data.mjs`) logs no column-missing errors.
- [ ] Generated report markdown no longer contains "all-time totals" disclaimer for flow performance section.
- [ ] Admin analytics page still loads without errors (existing view untouched).
- [ ] `005_openclawSmsBuildV1.md` updated to reflect the new view name and its `sent_date` filter capability.

---

## §11 Out of Scope

- Fixing `sms_v_coupon_cohorts`, `sms_v_outcome_aging`, `sms_v_click_to_purchase`, or other views (those are either already date-filterable or not used by the daily report in a date-bounded context).
- Changing the OpenClaw prompt design.
- Adding new SMS analytics metrics not currently in the view.
- Modifying `send-sms`, `shippo-webhook`, or any send-path functions — those were addressed in a separate fix (`008_reviewRequestFixPlan.md`).
