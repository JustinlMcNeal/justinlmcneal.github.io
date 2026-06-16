#!/usr/bin/env node
/**
 * Phase 10Y — Production pool-safety stabilization verification (no new features).
 * Composes issue-view safety, page load smoke, and Returns/Restock regression guard.
 *
 * Run: node scripts/verify-inventory-phase10y-final-stabilization.mjs
 */
import { chromium } from "@playwright/test";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runIssueViewSafetyChecks } from "./verify-inventory-issue-view-safety.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INVENTORY_PAGE = "/pages/admin/inventory.html";
const PORT = 9923;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;

const RECOVERY_SCRIPTS = [
  "scripts/supabase/emergency-recover-db.sql",
  "scripts/supabase/wait-and-recover-db.mjs",
  "scripts/supabase/restore-pg-cron-jobs.mjs",
  "scripts/verify-inventory-phase10aa-issues.mjs",
  "scripts/verify-inventory-page-load.mjs",
  "scripts/verify-inventory-issue-view-safety.mjs",
];

const POOL_SAFETY_DOC =
  "docs/pages/admin/inventory/implementation/056_phase_10y_final_stabilization_pool_safety.md";
const RUNBOOK_DOC = "docs/pages/admin/inventory/implementation/057_supabase_pool_exhaustion_runbook.md";

/** @type {{ phase: string; file: string; objects: { name: string; kind: "view"|"function"|"table" }[] }[]} */
const MIGRATION_CHECKLIST = [
  {
    phase: "10AA",
    file: "supabase/migrations/20261020_inventory_phase10aa_issues_snapshot.sql",
    objects: [
      { name: "v_inventory_issues_core", kind: "view" },
      { name: "inventory_issue_snapshots", kind: "table" },
      { name: "refresh_inventory_issue_snapshots", kind: "function" },
    ],
  },
  {
    phase: "10AB",
    file: "supabase/migrations/20261021_inventory_phase10ab_missing_sku_product_code.sql",
    objects: [{ name: "v_inventory_issues_core", kind: "view" }],
  },
  {
    phase: "10Q",
    file: "supabase/migrations/20261011_inventory_phase10q_marketplace_restock_assist.sql",
    objects: [
      { name: "v_inventory_marketplace_restock_assist_candidates", kind: "view" },
      { name: "update_inventory_return_workflow", kind: "function" },
    ],
  },
  {
    phase: "10R",
    file: "supabase/migrations/20261012_inventory_phase10r_marketplace_restock_assist_queue.sql",
    objects: [
      { name: "v_inventory_marketplace_restock_assist_queue", kind: "view" },
      { name: "marketplace_restock_assist_actions", kind: "table" },
    ],
  },
  {
    phase: "10S",
    file: "supabase/migrations/20261013_inventory_phase10s_restock_assist_audit_analytics.sql",
    objects: [
      { name: "v_inventory_marketplace_restock_assist_audit", kind: "view" },
      { name: "marketplace_restock_assist_queue_states", kind: "table" },
    ],
  },
  {
    phase: "10T",
    file: "supabase/migrations/20261014_inventory_phase10t_restock_channel_followup.sql",
    objects: [
      { name: "v_inventory_restock_followup_candidates", kind: "view" },
      { name: "inventory_restock_followup_states", kind: "table" },
    ],
  },
  {
    phase: "10U",
    file: "supabase/migrations/20261015_inventory_phase10u_returns_restock_dashboard.sql",
    objects: [
      { name: "v_inventory_returns_restock_dashboard_summary", kind: "view" },
      { name: "v_inventory_returns_restock_dashboard_worklist", kind: "view" },
    ],
  },
  {
    phase: "10V",
    file: "supabase/migrations/20261016_inventory_phase10v_dashboard_deeplinks_exports.sql",
    objects: [{ name: "v_inventory_returns_restock_dashboard_metrics", kind: "view" }],
  },
  {
    phase: "10W",
    file: "supabase/migrations/20261017_inventory_phase10w_returns_restock_digest.sql",
    objects: [
      { name: "v_inventory_returns_restock_digest_summary", kind: "view" },
      { name: "inventory_returns_restock_digest_runs", kind: "table" },
    ],
  },
  {
    phase: "10X",
    file: "supabase/migrations/20261018_inventory_phase10x_dashboard_pagination.sql",
    objects: [{ name: "get_returns_restock_dashboard_worklist_page", kind: "function" }],
  },
];

const DASHBOARD_READONLY_FILES = [
  "js/admin/inventory/ui/returnsRestockDashboardModal.js",
  "js/admin/inventory/ui/returnsRestockDashboardActions.js",
  "js/admin/inventory/api/returnsRestockDashboardApi.js",
  "js/admin/inventory/ui/returnsRestockDashboardExport.js",
  "js/admin/inventory/ui/returnsRestockDashboardPage.js",
  "js/admin/inventory/ui/returnsRestockDashboardPagination.js",
  "js/admin/inventory/ui/returnsRestockDashboardGrouping.js",
  "js/admin/inventory/ui/returnsRestockDashboardKpi.js",
  "js/admin/inventory/ui/returnsRestockDashboardPresets.js",
  "js/admin/inventory/ui/returnsRestockDashboardDeepLink.js",
  "js/admin/inventory/ui/returnsRestockDigestPreview.js",
  "js/admin/inventory/api/returnsRestockDigestApi.js",
];

const FORBIDDEN_MUTATION_TOKENS = [
  "restock_bundle_component_line",
  "pushAmazonFbmInventory",
  "pushEbayInventoryQuantity",
  "finalize_reservation",
  "release_reservation",
  "insert_stock_ledger",
  "stock_ledger_insert",
];

const LINE_LIMIT_FILES = [
  "js/admin/inventory/ui/returnsRestockDashboardModal.js",
  "js/admin/inventory/ui/returnsRestockDashboardActions.js",
  "js/admin/inventory/ui/returnsRestockDashboardGrouping.js",
  "js/admin/inventory/api/returnsRestockDashboardApi.js",
  "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
  "js/admin/inventory/ui/bundleReturnRestockPanel.js",
  "js/admin/inventory/ui/restockFollowupChecklist.js",
];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(relPath) {
  return read(relPath).split("\n").length;
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let urlPath = req.url?.split("?")[0] || "/";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function verifyRecoveryScripts() {
  const notes = [];
  const errors = [];
  for (const rel of RECOVERY_SCRIPTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing recovery/verify script: ${rel}`);
    else notes.push(`Recovery script present: ${rel}`);
  }
  if (!existsSync(join(ROOT, RUNBOOK_DOC))) errors.push(`Missing runbook: ${RUNBOOK_DOC}`);
  else notes.push("Pool exhaustion runbook present");
  return { notes, errors };
}

function verifyClientLoadPolicy() {
  const notes = [];
  const errors = [];
  const stateJs = read("js/admin/inventory/state.js");
  const refreshJs = read("js/admin/inventory/services/refreshInventoryData.js");

  if (!stateJs.includes("loadInventoryIssuesPanel")) {
    errors.push("state.js must define loadInventoryIssuesPanel");
  } else notes.push("Issues panel loader present");

  if (!stateJs.includes("ISSUES_TIMEOUT_MS") && !stateJs.includes("45000")) {
    errors.push("Issues load should have timeout/fallback");
  } else notes.push("Issues request timeout configured");

  if (!stateJs.includes("setTimeout(resolve, 400)") && !stateJs.includes("setTimeout(resolve, 300)")) {
    errors.push("Initial/post load should stagger issues after core panels");
  } else notes.push("Issues load staggered after core panels");

  if (refreshJs.includes("reloadInventoryAfterMappingChange()")) {
    errors.push("refreshInventoryAfterIssueStateChange must not call full reloadInventoryAfterMappingChange");
  } else notes.push("Post-mapping refresh is lightweight (not full workspace reload)");

  if (refreshJs.includes("scheduleIssueSnapshotRefresh")) {
    errors.push("refreshInventoryData must not schedule snapshot refresh");
  } else notes.push("Post-mapping refresh does not schedule snapshot RPC");

  if (stateJs.includes("scheduleIssueSnapshotRefresh")) {
    errors.push("state.js must not export scheduleIssueSnapshotRefresh");
  } else notes.push("No scheduleIssueSnapshotRefresh in state.js");

  return { notes, errors };
}

function verifyMigrationFiles() {
  const notes = [];
  const errors = [];

  const zPath = "supabase/migrations/20261019_inventory_phase10z_optimize_issues_view.sql";
  if (existsSync(join(ROOT, zPath))) {
    const z = read(zPath);
    if (!/DO NOT APPLY/i.test(z)) errors.push("10Z missing DO NOT APPLY guard");
    else notes.push("10Z superseded guard present");
  }

  for (const entry of MIGRATION_CHECKLIST) {
    if (!existsSync(join(ROOT, entry.file))) {
      errors.push(`Missing migration file: ${entry.file}`);
      continue;
    }
    notes.push(`${entry.phase} migration file present`);
    const sql = read(entry.file);
    for (const obj of entry.objects) {
      if (!sql.includes(obj.name)) errors.push(`${entry.phase}: ${obj.name} not in ${entry.file}`);
      else notes.push(`${entry.phase}: ${obj.name} in SQL`);
    }
  }

  return { notes, errors };
}

function verifyRegressionGuard() {
  const notes = [];
  const errors = [];

  for (const rel of DASHBOARD_READONLY_FILES) {
    if (!existsSync(join(ROOT, rel))) {
      errors.push(`Missing dashboard file: ${rel}`);
      continue;
    }
    const src = read(rel);
    for (const token of FORBIDDEN_MUTATION_TOKENS) {
      if (src.includes(token)) errors.push(`${rel} must not reference ${token}`);
    }
    notes.push(`${rel}: no stock/sync mutation tokens`);
  }

  const syncModal = read("js/admin/inventory/ui/syncDryRunModal.js");
  const openBlock = syncModal.slice(syncModal.indexOf("export async function openSyncDryRunModal"));
  if (openBlock.includes("pushAmazonFbmInventory(") || openBlock.includes("pushEbayInventoryQuantity(")) {
    errors.push("Sync Dry Run modal must not auto-push on open");
  } else notes.push("Sync Dry Run does not auto-push on open");

  return { notes, errors };
}

function verifyLineCounts() {
  const notes = [];
  const errors = [];
  for (const rel of LINE_LIMIT_FILES) {
    if (!existsSync(join(ROOT, rel))) {
      errors.push(`Missing: ${rel}`);
      continue;
    }
    const lines = lineCount(rel);
    if (lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
    else notes.push(`${rel}: ${lines} lines`);
  }
  return { notes, errors };
}

function verifyStaticWiring() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, POOL_SAFETY_DOC))) errors.push(`Missing ${POOL_SAFETY_DOC}`);
  else notes.push("10Y pool safety doc present");

  const html = read("pages/admin/inventory.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`Duplicate HTML ids: ${[...new Set(dupes)].join(", ")}`);
  else notes.push("No duplicate modal mount ids");

  for (const mount of [
    "inventoryReturnsRestockDashboardModalMount",
    "inventoryReturnsRestockDigestPreviewMount",
    "inventoryRestockAssistQueueModalMount",
    "inventoryBundlePreviewModalMount",
    "inventorySyncDryRunModalMount",
  ]) {
    if (!html.includes(mount)) errors.push(`Missing mount: ${mount}`);
    else notes.push(`Mount: ${mount}`);
  }

  return { notes, errors };
}

async function verifyBrowser() {
  const notes = [];
  const errors = [];
  const consoleErrors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded" });
    notes.push("Inventory page loads");

    const entries = [
      ["data-inventory-returns-restock-dashboard", "Returns & Restock Dashboard entry"],
      ["data-inventory-restock-queue", "Restock Assist Queue entry"],
      ["data-inventory-bundle-preview", "Bundle Return/Restock entry"],
      ["data-inventory-header-action=\"sync-channels\"", "Sync Channels header action"],
    ];
    for (const [sel, label] of entries) {
      if (!(await page.locator(`[${sel}]`).count())) errors.push(`${label} missing`);
      else notes.push(label);
    }

    const ignorable = consoleErrors.filter(
      (e) =>
        !/Missing SUPABASE|Failed to fetch|401|403|login|guard|requireAdmin|net::ERR/i.test(e),
    );
    if (ignorable.length) {
      for (const e of ignorable.slice(0, 5)) errors.push(`Console error: ${e.slice(0, 120)}`);
    } else notes.push("No unexpected console errors on page load");
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  console.log("Phase 10Y — Pool-safety production stabilization verification\n");

  const recovery = verifyRecoveryScripts();
  const clientPolicy = verifyClientLoadPolicy();
  const migFiles = verifyMigrationFiles();
  const guard = verifyRegressionGuard();
  const lines = verifyLineCounts();
  const wiring = verifyStaticWiring();

  console.log("--- Recovery scripts & docs ---");
  for (const n of recovery.notes) console.log(`  ✓ ${n}`);
  for (const e of recovery.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Client load / snapshot policy ---");
  for (const n of clientPolicy.notes) console.log(`  ✓ ${n}`);
  for (const e of clientPolicy.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Issue view safety (static + DB) ---");
  const issueSafety = await runIssueViewSafetyChecks();
  for (const n of issueSafety.notes.slice(0, 20)) console.log(`  ✓ ${n}`);
  if (issueSafety.notes.length > 20) console.log(`  … ${issueSafety.notes.length - 20} more checks passed`);
  for (const w of issueSafety.warnings) console.log(`  ⚠ ${w}`);
  for (const e of issueSafety.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Migration checklist (files) ---");
  for (const n of migFiles.notes.filter((x) => x.includes("10AA") || x.includes("10AB") || x.includes("10Z"))) {
    console.log(`  ✓ ${n}`);
  }

  console.log("\n--- Returns/Restock regression guard ---");
  for (const n of guard.notes.slice(0, 5)) console.log(`  ✓ ${n}`);
  if (guard.notes.length > 5) console.log(`  … ${guard.notes.length - 5} more dashboard files OK`);

  console.log("\n--- Static wiring ---");
  for (const n of wiring.notes) console.log(`  ✓ ${n}`);

  const browserResult = await verifyBrowser();
  console.log("\n--- Browser smoke ---");
  for (const n of browserResult.notes) console.log(`  ✓ ${n}`);
  for (const e of browserResult.errors) console.log(`  ✗ ${e}`);

  const allErrors = [
    ...recovery.errors,
    ...clientPolicy.errors,
    ...migFiles.errors,
    ...guard.errors,
    ...lines.errors,
    ...wiring.errors,
    ...issueSafety.errors,
    ...browserResult.errors,
  ];

  for (const e of lines.errors) console.log(`  ✗ ${e}`);
  for (const e of migFiles.errors) console.log(`  ✗ ${e}`);
  for (const e of guard.errors) console.log(`  ✗ ${e}`);

  console.log(
    allErrors.length
      ? `\nFAILED (${allErrors.length} error(s))`
      : "\nPASSED — Phase 10Y pool-safety stabilization ready",
  );
  process.exit(allErrors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
