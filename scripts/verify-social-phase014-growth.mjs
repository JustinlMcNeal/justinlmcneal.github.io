#!/usr/bin/env node
/**
 * Phase 014 — Growth tab static verification (read-only, no browser).
 * Run: node scripts/verify-social-phase014-growth.mjs
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;

const GROWTH_JS = [
  "js/admin/social/growth.js",
  "js/admin/social/features/growth/index.js",
  "js/admin/social/features/growth/growthContext.js",
  "js/admin/social/features/growth/growthState.js",
  "js/admin/social/features/growth/growthRender.js",
  "js/admin/social/features/growth/growthData.js",
  "js/admin/social/features/growth/growthFilters.js",
  "js/admin/social/features/growth/growthMetrics.js",
  "js/admin/social/features/growth/growthCharts.js",
];

const DOCS = [
  "docs/pages/admin/social/implementation/014a_growth_tab_static_shell.md",
  "docs/pages/admin/social/implementation/014b_growth_tab_data_filters_charts.md",
  "docs/pages/admin/social/implementation/014c_growth_score_insights_polish.md",
];

/** @type {string[]} */
const errors = [];

function checkFile(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    errors.push(`Missing file: ${relPath}`);
    return;
  }
  const lines = readFileSync(abs, "utf8").split("\n").length;
  if (lines > MAX_LINES) {
    errors.push(`${relPath} exceeds ${MAX_LINES} lines (${lines})`);
  }
}

for (const f of GROWTH_JS) checkFile(f);
for (const d of DOCS) checkFile(d);

const socialHtml = readFileSync(join(ROOT, "pages/admin/social.html"), "utf8");
if (!socialHtml.includes('id="tab-growth"')) errors.push("pages/admin/social.html missing #tab-growth");
if (!socialHtml.includes('data-tab="growth"')) errors.push("pages/admin/social.html missing growth tab button");
if (!socialHtml.includes("growthScoreValue")) errors.push("pages/admin/social.html missing Growth Score UI");
if (!socialHtml.includes("growthInsightsStrip")) errors.push("pages/admin/social.html missing insights strip");
if (!socialHtml.includes("growthCompareMetrics")) errors.push("pages/admin/social.html missing compare toggle");

const tabRouter = readFileSync(join(ROOT, "js/admin/social/boot/tabRouter.js"), "utf8");
if (!tabRouter.includes('case "growth"')) errors.push("tabRouter.js missing growth case");

const indexJs = readFileSync(join(ROOT, "js/admin/social/index.js"), "utf8");
if (!indexJs.includes("loadGrowth")) errors.push("index.js missing loadGrowth wiring");

const metricsJs = readFileSync(join(ROOT, "js/admin/social/features/growth/growthMetrics.js"), "utf8");
if (!metricsJs.includes("computeGrowthScore")) errors.push("growthMetrics.js missing computeGrowthScore");

if (errors.length) {
  console.error("verify-social-phase014-growth FAILED:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}

console.log("verify-social-phase014-growth OK");
console.log(`  ${GROWTH_JS.length} growth JS modules checked (≤${MAX_LINES} lines each)`);
console.log(`  ${DOCS.length} implementation docs present`);
console.log("  HTML + tab router + score module checks passed");
