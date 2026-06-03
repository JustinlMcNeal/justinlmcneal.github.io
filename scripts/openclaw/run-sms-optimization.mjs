/**
 * scripts/openclaw/run-sms-optimization.mjs
 *
 * OpenClaw SMS read-only optimization report.
 *
 * Guarantees:
 *   - Reads local daily SMS reports from docs/reports/sms/daily
 *   - Reads approved aggregate Supabase views with anon key only
 *   - Writes one local markdown report only
 *   - Does not call Twilio
 *   - Does not call SMS Edge Functions
 *   - Does not write to Supabase
 *   - Does not create, queue, or send SMS
 *
 * Usage:
 *   node --env-file=.env scripts/openclaw/run-sms-optimization.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDateWindows, fetchSmsData, normalizePayload } from './fetch-sms-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const IS_REASONING_MODEL = /^(o[1-9]|gpt-5)/i.test(OPENAI_MODEL);

function checkEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('');
    console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Usage: node --env-file=.env scripts/openclaw/run-sms-optimization.mjs');
    process.exit(1);
  }
}

function getReportDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getOptimizationReportPath(reportDate) {
  return path.join(REPO_ROOT, 'docs', 'reports', 'sms', 'optimization', `${reportDate}.md`);
}

function assertNoPhoneNumbers(label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/\+1\d{10}/.test(text)) {
    throw new Error(`ERROR: Phone number pattern detected in ${label}. Aborting.`);
  }
}

function loadRecentDailyReports(maxReports = 14) {
  const dailyDir = path.join(REPO_ROOT, 'docs', 'reports', 'sms', 'daily');
  if (!fs.existsSync(dailyDir)) return [];

  return fs.readdirSync(dailyDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .slice(-maxReports)
    .map((filename) => {
      const fullPath = path.join(dailyDir, filename);
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        date: filename.replace(/\.md$/, ''),
        filename,
        content,
      };
    });
}

function buildSystemPrompt() {
  return [
    'You are OpenClaw, a read-only SMS optimization analyst for Karry Kraze.',
    '',
    'You receive only PII-safe aggregate SMS data and local historical markdown reports.',
    'You must not suggest or imply that you sent, queued, scheduled, or wrote anything.',
    'You cannot call Twilio, call Supabase Edge Functions, create coupons, update cron, or write to Supabase.',
    'Your output is advisory only. Every experiment requires human approval and backend validation.',
    'Do not mention model training cutoffs, external knowledge dates, or facts outside the provided input.',
    'Treat the latest aggregate payload and explicit safety context as more current than older daily report language.',
    'If older daily reports say there were no sends but latest_aggregate_summary shows sends, state that the no-send condition was historical and appears repaired.',
    '',
    'Every draft SMS copy idea heading must be labeled exactly in this format:',
    '**DRAFT IDEA [N] — DRAFT ONLY — NOT SENT — REQUIRES HUMAN APPROVAL — REQUIRES BACKEND VALIDATION**',
    '',
    'Use only numbers present in the input. If evidence is sparse, say so.',
    'Respect mixed scopes: flow performance may be date-bounded; coupon cohorts, abandoned cart, subscriber funnel, and fatigue monitor are lifetime aggregates.',
    '',
    'Write a markdown report with exactly these sections:',
    '# Karry Kraze SMS Read-Only Optimization Report',
    '## 1. System Health Summary',
    '## 2. Trend Summary',
    '## 3. Opportunities',
    '## 4. Risks / Watch Items',
    '## 5. Recommended Experiments',
    '## 6. Draft Copy Ideas',
    '## 7. Human Approval Checklist',
    '## 8. No-Send / No-Write Confirmation',
    '',
    'Section 2 must compare recent daily reports and the latest aggregate payload across sends, conversions, revenue, stop rate, bounce rate, clicks, signup, welcome series, abandoned cart, coupon reminders, and VIP upgrades. If a metric is unavailable, say unavailable.',
    '',
    'Section 5 must include 3-5 experiments. For each experiment, include exactly these fields:',
    '- Hypothesis',
    '- Flow affected',
    '- Expected impact',
    '- Risk level',
    '- Backend validation needed',
    '- Success metric',
    '- Do not implement automatically',
    'The exact phrase "Do not implement automatically" must appear inside every experiment.',
    '',
    'Section 7 must include this full checklist: consent, caps, quiet hours, coupon existence, discount budget, compliance copy, deliverability, rollback plan.',
    'Section 6 must repeat the full required DRAFT IDEA heading label for each idea, not once above the list.',
    '',
    'For section 8, explicitly state:',
    '- No SMS messages were sent',
    '- No SMS messages were queued',
    '- No rows were written to Supabase',
    '- No Twilio API calls were made',
    '- This is advisory only',
  ].join('\n');
}

async function callLlm({ systemPrompt, userMessage }) {
  const url = `${OPENAI_BASE_URL}/chat/completions`;
  const requestBody = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    ...(IS_REASONING_MODEL
      ? { max_completion_tokens: 9000 }
      : { temperature: 0.25, max_tokens: 5000 }
    ),
  };

  console.log(`  -> Model      : ${OPENAI_MODEL}${IS_REASONING_MODEL ? ' (reasoning)' : ''}`);
  console.log(`  -> Endpoint   : ${OPENAI_BASE_URL}`);
  console.log(`  -> Payload    : ${(JSON.stringify(requestBody).length / 1024).toFixed(1)} KB`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`LLM API returned HTTP ${response.status}: ${body}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content || content.trim() === '') {
    throw new Error(`LLM returned an empty response (finish_reason: ${json.choices?.[0]?.finish_reason ?? 'unknown'}).`);
  }

  if (json.usage) {
    console.log(
      `  -> Tokens used: prompt=${json.usage.prompt_tokens ?? '?'}, ` +
      `completion=${json.usage.completion_tokens ?? '?'}, total=${json.usage.total_tokens ?? '?'}`
    );
  }

  return content;
}

function buildScriptHeader(reportDate, generatedAt, dailyReports, latestPayload) {
  return [
    `# Karry Kraze SMS Read-Only Optimization Report — ${reportDate}`,
    '',
    `> **Generated by:** OpenClaw SMS Read-Only Optimization`,
    `> **Run mode:** Manual read-only`,
    `> **Report date:** ${reportDate}`,
    `> **Generated at:** ${generatedAt}`,
    `> **Historical reports loaded:** ${dailyReports.length}`,
    `> **Supabase key used:** anon only`,
    `> **Writes to Supabase:** NONE`,
    `> **Twilio API calls:** NONE`,
    `> **SMS sends created or queued:** NONE`,
    `> **Latest aggregate report date:** ${latestPayload.report_date}`,
    '',
    '---',
    '',
  ].join('\n');
}

function summarizeLatestAggregates(payload) {
  const flowRows = payload.flow_performance?.last_7_days ?? [];
  const flowTotals = flowRows.reduce((totals, row) => {
    totals.total_sends += Number(row.total_sends ?? 0);
    totals.delivered += Number(row.delivered ?? 0);
    totals.unique_clicks += Number(row.unique_clicks ?? 0);
    totals.conversions += Number(row.conversions ?? 0);
    totals.attributed_revenue += Number(row.attributed_revenue ?? 0);
    totals.estimated_profit += Number(row.estimated_profit ?? 0);
    return totals;
  }, {
    total_sends: 0,
    delivered: 0,
    unique_clicks: 0,
    conversions: 0,
    attributed_revenue: 0,
    estimated_profit: 0,
  });

  return {
    flow_performance_date_filtered: payload.flow_performance?.date_filtered === true,
    flow_rows_last_7_days: flowRows.length,
    ...flowTotals,
    stop_rate_pct: payload.fatigue_monitor?.stop_rate_pct ?? null,
    bounce_rate_pct: payload.fatigue_monitor?.bounce_rate_pct ?? null,
    click_to_purchase_orders: payload.click_to_purchase?.total_attributed_orders ?? 0,
    click_to_purchase_avg_hours: payload.click_to_purchase?.avg_hours_to_purchase ?? null,
  };
}

async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OpenClaw SMS Read-Only Optimization');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Mode   : Manual read-only');
  console.log('  Writes : NONE (no Supabase writes, no Twilio, no sends)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  checkEnv();

  const reportDate = getReportDate();
  const generatedAt = new Date().toISOString();
  console.log(`[1/6] Date       : ${reportDate}`);

  console.log('[2/6] Loading recent local daily reports...');
  const dailyReports = loadRecentDailyReports(14);
  for (const report of dailyReports) {
    assertNoPhoneNumbers(`daily report ${report.filename}`, report.content);
  }
  console.log(`      Loaded: ${dailyReports.length} reports`);
  if (dailyReports.length > 0) {
    console.log(`      Range : ${dailyReports[0].date} -> ${dailyReports[dailyReports.length - 1].date}`);
  }
  console.log('');

  console.log('[3/6] Fetching latest aggregate SMS views from Supabase (anon key only)...');
  const windows = buildDateWindows();
  const { views, warnings } = await fetchSmsData({
    yesterday: windows.yesterday,
    last7days: windows.last7days,
    sentDateYesterday: windows.sentDateYesterday,
    sentDateLast7Start: windows.sentDateLast7Start,
    sentDateToday: windows.sentDateToday,
  });

  const latestPayload = normalizePayload({
    rawViews: views,
    reportDate,
    windows,
    warnings,
  });
  const latestAggregateSummary = summarizeLatestAggregates(latestPayload);
  assertNoPhoneNumbers('latest aggregate payload', latestPayload);
  console.log(`      Flow rows (7d): ${views.flowPerformanceLast7.length}`);
  console.log(`      Sends (7d)    : ${latestAggregateSummary.total_sends}`);
  console.log(`      Warnings      : ${latestPayload.data_quality_warnings.length}`);
  console.log('');

  console.log('[4/6] Calling configured model for advisory optimization analysis...');
  const systemPrompt = buildSystemPrompt();
  const userPayload = {
    report_date: reportDate,
    generated_at: generatedAt,
    latest_aggregate_summary: latestAggregateSummary,
    latest_aggregate_payload: latestPayload,
    recent_daily_reports: dailyReports,
    explicit_safety_context: {
      repaired_sms_system: [
        'send-sms auth outage fixed',
        'live sms-subscribe sends are logging again',
        'sms-abandoned-cart sent successfully after fix',
        'sms-welcome-series Day 2 sent successfully after fix',
        'sms-welcome-series Day 5 orphan WS coupon loop patched',
      ],
      allowed_actions: ['read existing report data', 'read aggregate views', 'write local markdown report'],
      forbidden_actions: ['send SMS', 'queue SMS', 'write to Supabase', 'call Twilio', 'call send-sms', 'call SMS Edge Functions', 'edit cron jobs', 'change coupons'],
    },
  };
  assertNoPhoneNumbers('LLM user payload', userPayload);

  const reportBody = await callLlm({
    systemPrompt,
    userMessage: [
      'Analyze the following Karry Kraze SMS historical reports and latest aggregate data.',
      'Produce the required read-only optimization report.',
      '',
      '```json',
      JSON.stringify(userPayload, null, 2),
      '```',
    ].join('\n'),
  });
  console.log('      Response received.');
  console.log('');

  console.log('[5/6] Saving local optimization report...');
  assertNoPhoneNumbers('optimization report body', reportBody);
  const reportPath = getOptimizationReportPath(reportDate);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const fullReport = buildScriptHeader(reportDate, generatedAt, dailyReports, latestPayload)
    + reportBody.trim()
    + '\n';
  fs.writeFileSync(reportPath, fullReport, 'utf8');
  console.log(`      Saved: ${path.relative(REPO_ROOT, reportPath)}`);
  console.log(`      Size : ${(fullReport.length / 1024).toFixed(1)} KB`);
  console.log('');

  console.log('[6/6] No-send / no-write confirmation');
  console.log('      No SMS messages were sent.');
  console.log('      No SMS messages were queued.');
  console.log('      No rows were written to Supabase.');
  console.log('      No Twilio API calls were made.');
  console.log('      This report is advisory only.');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Done.');
  console.log(`  Report: ${reportPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('ERROR: SMS optimization report failed:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
