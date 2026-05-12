/**
 * scripts/openclaw/run-sms-report.mjs
 *
 * OpenClaw SMS Analyst V1 — entry point.
 *
 * V1 architecture note:
 *   This script makes a direct call to the OpenAI Chat Completions API.
 *   It is not a full OpenClaw runtime orchestration. The prompt file at
 *   prompts/openclaw/sms-analyst-v1.md defines the analyst persona.
 *
 * Orchestration:
 *   1. Validate required environment variables
 *   2. Fetch aggregate SMS data from Supabase (anon key, 6 views only)
 *   3. Normalize into PII-safe JSON payload (includes phone safety abort)
 *   4. Call OpenAI Chat Completions API with the analyst prompt
 *   5. Write markdown report to docs/reports/sms/daily/YYYY-MM-DD.md
 *
 * Guarantees:
 *   - Zero writes to any Supabase table
 *   - No Twilio API calls
 *   - No SMS sends triggered
 *   - No raw PII in the LLM prompt
 *   - Report is saved as a local markdown file only
 *
 * Usage:
 *   node --env-file=.env scripts/openclaw/run-sms-report.mjs
 *
 * Required env vars (.env):
 *   SUPABASE_URL       — Supabase project URL
 *   SUPABASE_ANON_KEY  — Supabase anon/public key (read-only aggregate views)
 *   OPENAI_API_KEY     — OpenAI API key
 *
 * Optional env vars:
 *   OPENAI_BASE_URL    — defaults to https://api.openai.com/v1
 *   OPENAI_MODEL       — defaults to gpt-4o
 *                        For reasoning models (o1, o3, gpt-5*) see note below.
 *
 * Reasoning model note:
 *   If OPENAI_MODEL is a reasoning model (o1, o1-mini, o3, gpt-5*),
 *   this script automatically switches to max_completion_tokens and omits
 *   temperature, per OpenAI reasoning model requirements.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchSmsData, normalizePayload, buildDateWindows } from './fetch-sms-data.mjs';

// ─── Path setup ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ─── Environment ───────────────────────────────────────────────────────────────

function checkEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('');
    console.error('ERROR: Missing required environment variables:');
    for (const k of missing) {
      console.error(`  ${k}`);
    }
    console.error('');
    console.error('Add them to your .env file:');
    console.error('  SUPABASE_URL=https://your-project.supabase.co');
    console.error('  SUPABASE_ANON_KEY=your-anon-key');
    console.error('  OPENAI_API_KEY=sk-...');
    console.error('');
    console.error('Usage: node --env-file=.env scripts/openclaw/run-sms-report.mjs');
    process.exit(1);
  }
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL =
  (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Detect reasoning models: o1, o1-mini, o3, o3-mini, gpt-5 family
// These require max_completion_tokens (not max_tokens) and no custom temperature.
const IS_REASONING_MODEL = /^(o[1-9]|gpt-5)/i.test(OPENAI_MODEL);

// ─── LLM client ───────────────────────────────────────────────────────────────

/**
 * Calls the OpenAI Chat Completions API (or any compatible endpoint).
 *
 * @param {{ systemPrompt: string, userMessage: string }} params
 * @returns {Promise<string>} Markdown report text from the model
 */
async function callLlm({ systemPrompt, userMessage }) {
  const url = `${OPENAI_BASE_URL}/chat/completions`;

  const requestBody = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    ...(IS_REASONING_MODEL
      ? { max_completion_tokens: 8000 }       // reasoning models: max_completion_tokens only
      : { temperature: 0.3, max_tokens: 4000 } // standard models
    ),
  };

  console.log(`  → Model      : ${OPENAI_MODEL}${IS_REASONING_MODEL ? ' (reasoning)' : ''}`);
  console.log(`  → Endpoint   : ${OPENAI_BASE_URL}`);
  console.log(`  → Payload    : ${(JSON.stringify(requestBody).length / 1024).toFixed(1)} KB`);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(
      `Network error calling LLM API: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    let body = '(no body)';
    try {
      body = await response.text();
    } catch (_) { /* ignore */ }
    throw new Error(`LLM API returned HTTP ${response.status}: ${body}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(`LLM API returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`);
  }

  const content = json.choices?.[0]?.message?.content;
  if (!content || content.trim() === '') {
    const finishReason = json.choices?.[0]?.finish_reason ?? 'unknown';
    throw new Error(
      `LLM returned an empty response (finish_reason: ${finishReason}). ` +
      (IS_REASONING_MODEL
        ? 'Reasoning model token budget may be too low — increase max_completion_tokens or switch model.'
        : 'Check model name and API key.')
    );
  }

  const usage = json.usage;
  if (usage) {
    console.log(
      `  → Tokens used: prompt=${usage.prompt_tokens ?? '?'}, ` +
      `completion=${usage.completion_tokens ?? '?'}, ` +
      `total=${usage.total_tokens ?? '?'}`
    );
  }

  return content;
}

// ─── Report helpers ────────────────────────────────────────────────────────────

function getReportDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD in America/New_York
}

function getReportPath(reportDate) {
  return path.join(REPO_ROOT, 'docs', 'reports', 'sms', 'daily', `${reportDate}.md`);
}

/**
 * Report header prepended by the script (not written by OpenClaw).
 * This ensures the no-send metadata is structurally true, not AI-asserted.
 */
function buildScriptHeader(reportDate, payload) {
  return [
    `# Karry Kraze SMS Daily Report — ${reportDate}`,
    '',
    `> **Generated by:** OpenClaw SMS Analyst V1`,
    `> **Run mode:** Manual read-only`,
    `> **Report date:** ${reportDate}`,
    `> **Generated at:** ${payload.generated_at}`,
    `> **Writes to Supabase:** NONE`,
    `> **Twilio API calls:** NONE`,
    `> **SMS sends created:** NONE`,
    `> **Data source:** sms_v_flow_performance, sms_v_coupon_cohorts, sms_v_abandoned_cart,`,
    `>   sms_v_click_to_purchase, sms_v_subscriber_funnel, sms_v_fatigue_monitor`,
    '',
    '---',
    '',
  ].join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OpenClaw SMS Analyst V1 — Karry Kraze');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Mode   : Manual read-only');
  console.log('  Writes : NONE (no Supabase, no Twilio, no sends)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // ── Step 0: Validate env ──────────────────────────────────────────────────
  checkEnv();

  const reportDate = getReportDate();
  console.log(`[1/5] Date       : ${reportDate}`);

  // ── Step 1: Build date windows ────────────────────────────────────────────
  const windows = buildDateWindows();
  console.log(`      Yesterday  : ${windows.yesterday.start} → ${windows.yesterday.end}`);
  console.log(`      Last 7d    : ${windows.last7days.start} → ${windows.last7days.end}`);
  console.log(`      ET dates   : yesterday=${windows.sentDateYesterday}  7d-start=${windows.sentDateLast7Start}  today=${windows.sentDateToday}`);
  console.log('');

  // ── Step 2: Fetch Supabase views ──────────────────────────────────────────
  console.log('[2/5] Fetching SMS aggregate views from Supabase (anon key)...');
  let views, fetchWarnings;
  try {
    const result = await fetchSmsData({
      yesterday: windows.yesterday,
      last7days: windows.last7days,
      sentDateYesterday: windows.sentDateYesterday,
      sentDateLast7Start: windows.sentDateLast7Start,
      sentDateToday: windows.sentDateToday,
    });
    views = result.views;
    fetchWarnings = result.warnings;
  } catch (err) {
    console.error('ERROR: Failed to fetch SMS data from Supabase:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`      sms_v_flow_performance   : ${views.flowPerformanceLast7.length} rows (7d)`);
  console.log(`      sms_v_coupon_cohorts      : ${views.couponCohorts.length} rows`);
  console.log(`      sms_v_abandoned_cart      : ${views.abandonedCart.length} rows`);
  console.log(`      sms_v_click_to_purchase   : ${views.clickToPurchase.length} rows`);
  console.log(`      sms_v_subscriber_funnel   : ${views.subscriberFunnel.length} rows`);
  console.log(`      sms_v_fatigue_monitor     : ${views.fatigueMonitor.length} rows`);
  console.log('');

  // Abort if all views empty
  const totalRows =
    views.flowPerformanceLast7.length +
    views.couponCohorts.length +
    views.abandonedCart.length +
    views.clickToPurchase.length +
    views.subscriberFunnel.length +
    views.fatigueMonitor.length;

  if (totalRows === 0) {
    console.error('ERROR: All 6 views returned zero rows.');
    console.error('  Possible causes:');
    console.error('  1. Views do not exist in the database yet.');
    console.error('  2. Anon key lacks SELECT permission on these views.');
    console.error('  3. Run the GRANT statements from §7 of openclawSmsBuildV1.md:');
    console.error('       GRANT SELECT ON sms_v_flow_performance TO anon;');
    console.error('       GRANT SELECT ON sms_v_coupon_cohorts TO anon;');
    console.error('       GRANT SELECT ON sms_v_abandoned_cart TO anon;');
    console.error('       GRANT SELECT ON sms_v_click_to_purchase TO anon;');
    console.error('       GRANT SELECT ON sms_v_subscriber_funnel TO anon;');
    console.error('       GRANT SELECT ON sms_v_fatigue_monitor TO anon;');
    process.exit(1);
  }

  // Abort if subscriber_funnel or fatigue_monitor empty (required for meaningful report)
  if (views.subscriberFunnel.length === 0) {
    console.error('ERROR: sms_v_subscriber_funnel returned zero rows.');
    console.error('  Cannot generate a meaningful report without subscriber funnel data.');
    console.error('  Check view exists and anon key has SELECT permission.');
    process.exit(1);
  }

  if (views.fatigueMonitor.length === 0) {
    console.error('ERROR: sms_v_fatigue_monitor returned zero rows.');
    console.error('  Cannot generate a meaningful report without fatigue/compliance data.');
    console.error('  Check view exists and anon key has SELECT permission.');
    process.exit(1);
  }

  // ── Step 3: Normalize payload ─────────────────────────────────────────────
  console.log('[3/5] Normalizing payload and running safety checks...');
  let payload;
  try {
    payload = normalizePayload({
      rawViews: views,
      reportDate,
      windows,
      warnings: fetchWarnings,
    });
  } catch (err) {
    // Phone pattern abort or other normalization error
    console.error('');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`      Data quality warnings: ${payload.data_quality_warnings.length}`);
  if (payload.data_quality_warnings.length > 0) {
    for (const w of payload.data_quality_warnings) {
      console.log(`        ⚠  ${w}`);
    }
  }
  console.log('');

  // ── Step 4: Load prompt and call LLM ────────────────────────────────────
  const promptPath = path.join(REPO_ROOT, 'prompts', 'openclaw', 'sms-analyst-v1.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`ERROR: Prompt file not found at ${promptPath}`);
    console.error('  Expected location: prompts/openclaw/sms-analyst-v1.md');
    process.exit(1);
  }
  const systemPrompt = fs.readFileSync(promptPath, 'utf8');

  const userMessage = [
    `Here is today's Karry Kraze SMS data:`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    `Please write the Daily SMS Analyst Report for ${reportDate}.`,
    'Include all 12 required sections in order.',
    'Do not skip any section.',
    'If data is unavailable for a section, state that explicitly.',
    'For the No-Send Confirmation section, include the exact verbatim text from the prompt.',
  ].join('\n');

  console.log('[4/5] Calling OpenAI Chat Completions API (direct LLM call)...');
  let reportBody;
  try {
    reportBody = await callLlm({ systemPrompt, userMessage });
  } catch (err) {
    console.error('');
    console.error('ERROR: LLM API call failed:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  console.log('      Response received.');
  console.log('');

  // ── Step 5: Save report ───────────────────────────────────────────────────
  console.log('[5/5] Saving report...');

  const reportPath = getReportPath(reportDate);
  const reportDir = path.dirname(reportPath);
  fs.mkdirSync(reportDir, { recursive: true });

  // Script-generated header (structurally true metadata) + LLM report body
  const fullReport = buildScriptHeader(reportDate, payload) + reportBody.trim() + '\n';

  fs.writeFileSync(reportPath, fullReport, 'utf8');

  const relPath = path.relative(REPO_ROOT, reportPath);
  console.log(`      Saved: ${relPath}`);
  console.log(`      Size : ${(fullReport.length / 1024).toFixed(1)} KB`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Done.');
  console.log('  No SMS messages were sent.');
  console.log('  No rows were written to any Supabase table.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Next: Review the report and act on the recommended actions.');
  console.log(`  Report: ${reportPath}`);
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('Unhandled error:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
