/**
 * scripts/openclaw/run-sms-experiment-backlog.mjs
 *
 * OpenClaw SMS human-approved experiment backlog (read-only planning).
 *
 * Guarantees:
 *   - Reads local daily SMS reports from docs/reports/sms/daily
 *   - Reads local optimization reports from docs/reports/sms/optimization
 *   - Writes one local markdown experiment backlog only
 *   - Does not call Twilio
 *   - Does not call SMS Edge Functions
 *   - Does not read or write Supabase
 *   - Does not create, queue, or send SMS
 *
 * Usage:
 *   node --env-file=.env scripts/openclaw/run-sms-experiment-backlog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const IS_REASONING_MODEL = /^(o[1-9]|gpt-5)/i.test(OPENAI_MODEL);

function checkEnv() {
  const missing = [];
  if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY');

  if (missing.length > 0) {
    console.error('');
    console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Usage: node --env-file=.env scripts/openclaw/run-sms-experiment-backlog.mjs');
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

function getExperimentReportPath(reportDate) {
  return path.join(REPO_ROOT, 'docs', 'reports', 'sms', 'experiments', `${reportDate}.md`);
}

function assertNoPhoneNumbers(label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/\+1\d{10}/.test(text)) {
    throw new Error(`ERROR: Phone number pattern detected in ${label}. Aborting.`);
  }
}

function loadRecentReports(relativeDir, maxReports = 14) {
  const dir = path.join(REPO_ROOT, relativeDir);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .slice(-maxReports)
    .map((filename) => {
      const fullPath = path.join(dir, filename);
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
    'You are OpenClaw, a read-only SMS experiment planner for Karry Kraze.',
    '',
    'You receive only local markdown daily SMS reports and optimization reports.',
    'You must not suggest or imply that you sent, queued, scheduled, or wrote anything.',
    'You cannot call Twilio, call Supabase, call Edge Functions, create coupons, update cron, or modify live SMS copy.',
    'Your output is a human-approved experiment backlog only. Every experiment requires explicit human approval before any implementation.',
    'Do not mention model training cutoffs or facts outside the provided input.',
    'Use only evidence from the supplied reports. If evidence is sparse, say so.',
    '',
    'Write a markdown report with exactly these sections:',
    '# Karry Kraze SMS Experiment Backlog',
    '## 1. Current System Readiness',
    '## 2. Experiment Candidates',
    '## 3. Recommended First Experiment',
    '## 4. Experiments Not Recommended Yet',
    '## 5. Approval Checklist',
    '## 6. No-Send / No-Write Confirmation',
    '',
    'Section 1 must summarize whether it is safe to experiment based on recent daily and optimization reports (sends working, stop rate, conversions, data gaps, compliance posture).',
    '',
    'Section 2 must list 3-6 experiment candidates. For EACH experiment use this exact sub-structure:',
    '### Experiment [N]: [title]',
    '- **Flow affected:**',
    '- **Current issue:**',
    '- **Proposed change:**',
    '- **Expected impact:**',
    '- **Risk level:** low / medium / high (pick one)',
    '- **Exact success metric:**',
    '- **Minimum test window:**',
    '- **Rollback plan:**',
    '- **Files likely affected:**',
    '- **Backend validation required:**',
    '- **Human approval status:** NOT APPROVED',
    '',
    'Every experiment in section 2 MUST end with "Human approval status: NOT APPROVED".',
    'Do not propose live copy changes as implemented — only describe proposed experiments.',
    '',
    'Section 3 must choose exactly ONE low-risk first experiment from section 2 and explain why it should run first.',
    '',
    'Section 4 must list experiments or areas that should NOT be touched yet and why (e.g. high stop rate unresolved, missing rollback, compliance unknown).',
    '',
    'Section 5 must include this approval checklist with pass/fail/unknown for each item based on report evidence:',
    '- consent preserved',
    '- STOP copy preserved',
    '- caps preserved',
    '- quiet hours preserved',
    '- coupon exists',
    '- no duplicate sends',
    '- rollback plan ready',
    '- human approved',
    '',
    'For section 6, explicitly state:',
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
      : { temperature: 0.25, max_tokens: 6000 }
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

function buildScriptHeader(reportDate, generatedAt, dailyReports, optimizationReports) {
  const dailyRange = dailyReports.length > 0
    ? `${dailyReports[0].date} -> ${dailyReports[dailyReports.length - 1].date}`
    : 'none';
  const optRange = optimizationReports.length > 0
    ? `${optimizationReports[0].date} -> ${optimizationReports[optimizationReports.length - 1].date}`
    : 'none';

  return [
    `# Karry Kraze SMS Experiment Backlog — ${reportDate}`,
    '',
    `> **Generated by:** OpenClaw SMS Experiment Backlog (read-only)`,
    `> **Run mode:** Manual read-only planning`,
    `> **Report date:** ${reportDate}`,
    `> **Generated at:** ${generatedAt}`,
    `> **Daily reports loaded:** ${dailyReports.length} (${dailyRange})`,
    `> **Optimization reports loaded:** ${optimizationReports.length} (${optRange})`,
    `> **Supabase reads:** NONE`,
    `> **Supabase writes:** NONE`,
    `> **Twilio API calls:** NONE`,
    `> **SMS sends created or queued:** NONE`,
  ].join('\n');
}

async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OpenClaw SMS Experiment Backlog');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Mode   : Manual read-only planning');
  console.log('  Writes : Local markdown only (no Supabase, no Twilio, no sends)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  checkEnv();

  const reportDate = getReportDate();
  const generatedAt = new Date().toISOString();
  console.log(`[1/5] Date       : ${reportDate}`);

  console.log('[2/5] Loading recent local daily reports...');
  const dailyReports = loadRecentReports('docs/reports/sms/daily', 14);
  for (const report of dailyReports) {
    assertNoPhoneNumbers(`daily report ${report.filename}`, report.content);
  }
  console.log(`      Loaded: ${dailyReports.length} reports`);
  if (dailyReports.length > 0) {
    console.log(`      Range : ${dailyReports[0].date} -> ${dailyReports[dailyReports.length - 1].date}`);
  }
  console.log('');

  console.log('[3/5] Loading recent optimization reports...');
  const optimizationReports = loadRecentReports('docs/reports/sms/optimization', 14);
  for (const report of optimizationReports) {
    assertNoPhoneNumbers(`optimization report ${report.filename}`, report.content);
  }
  console.log(`      Loaded: ${optimizationReports.length} reports`);
  if (optimizationReports.length > 0) {
    console.log(`      Range : ${optimizationReports[0].date} -> ${optimizationReports[optimizationReports.length - 1].date}`);
  }
  console.log('');

  if (dailyReports.length === 0 && optimizationReports.length === 0) {
    console.error('ERROR: No daily or optimization reports found. Run run-sms-report.mjs and run-sms-optimization.mjs first.');
    process.exit(1);
  }

  console.log('[4/5] Calling configured model for experiment backlog planning...');
  const systemPrompt = buildSystemPrompt();
  const userPayload = {
    report_date: reportDate,
    generated_at: generatedAt,
    recent_daily_reports: dailyReports,
    recent_optimization_reports: optimizationReports,
    explicit_safety_context: {
      allowed_actions: ['read local markdown reports', 'write local experiment backlog markdown'],
      forbidden_actions: [
        'send SMS',
        'queue SMS',
        'write to Supabase',
        'read Supabase',
        'call Twilio',
        'call send-sms',
        'call SMS Edge Functions',
        'edit cron jobs',
        'change live SMS copy',
        'create coupons',
      ],
      note: 'All experiments require human approval before implementation. This backlog is advisory only.',
    },
  };
  assertNoPhoneNumbers('LLM user payload', userPayload);

  const reportBody = await callLlm({
    systemPrompt,
    userMessage: [
      'Analyze the following Karry Kraze SMS daily reports and optimization reports.',
      'Produce the required human-approved experiment backlog.',
      'Do not implement anything — planning only.',
      '',
      '```json',
      JSON.stringify(userPayload, null, 2),
      '```',
    ].join('\n'),
  });
  console.log('      Response received.');
  console.log('');

  console.log('[5/5] Saving local experiment backlog...');
  assertNoPhoneNumbers('experiment backlog body', reportBody);
  const reportPath = getExperimentReportPath(reportDate);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const fullReport = [
    buildScriptHeader(reportDate, generatedAt, dailyReports, optimizationReports),
    '',
    '---',
    '',
    reportBody.trim(),
    '',
  ].join('\n');

  fs.writeFileSync(reportPath, fullReport, 'utf8');
  console.log(`      Saved: ${path.relative(REPO_ROOT, reportPath)}`);
  console.log(`      Size : ${(fullReport.length / 1024).toFixed(1)} KB`);
  console.log('');

  console.log('No-send / no-write confirmation');
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
  console.error('ERROR: SMS experiment backlog failed:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
