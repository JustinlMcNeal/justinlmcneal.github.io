/**
 * Phase 060C.2 — Adjust preview/toggle read-only variation integration verification.
 *
 * Run: node scripts/verify-inventory-phase060c2-adjust-preview-toggle.mjs
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PORT = 9896;
const PAGE = "/pages/admin/inventory.html";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const PREVIEW_FILES = [
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/renderers/renderAdjustChannelPreview.js",
];

const ORCHESTRATOR_FILES = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

const ORCHESTRATOR_ALLOWED_EDGE = new Set([
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
]);

const ACTIVE_LABELS = [
  "eBay variation quantity can update.",
  "eBay variation cache will refresh before sync.",
  "eBay variation already matches.",
  "eBay variation requires manual mapping review.",
];

const GROUP_LABELS = [
  "eBay variation group can be relisted.",
  "eBay variation group relist can be previewed.",
  "eBay variation group relist requires manual review.",
  "No in-stock eBay variation children to relist.",
];

const FORBIDDEN_EDGE = [
  "sync-ebay-inventory-quantity",
  "relist-ebay-variation-group",
  "variation_child_update_qty",
  "syncEbayVariationChildQuantity",
  "relistEbayVariationGroup",
];

const FAST_ENV = { VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1", VERIFY_SKIP_NESTED_REGRESSION: "1" };

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  const modal = readText("js/admin/inventory/ui/adjustModalChannelPreview.js");
  if (!modal.includes("fetchEbayVariationChildCandidate")) {
    errors.push("Preview modal must load variation child candidate");
  }
  if (!modal.includes("fetchEbayVariationRelistCandidate")) {
    errors.push("Preview modal must load variation group relist candidate");
  }
  if (!modal.includes("syncToggleUserSet")) {
    errors.push("Manual toggle override (syncToggleUserSet) must be preserved");
  }
  if (modal.includes("fetchChannelSyncPreview")) {
    errors.push("Preview must not use fetchChannelSyncPreview");
  }
  if (/refreshIssueSnapshot|issueSnapshot/.test(modal)) {
    errors.push("Preview must not refresh issue snapshot");
  }
  for (const token of FORBIDDEN_EDGE) {
    if (modal.includes(token)) errors.push(`Preview modal must not call edge: ${token}`);
  }
  notes.push("Preview modal uses read-only variation candidate APIs");

  const variationPreview = readText("js/admin/inventory/services/adjustChannelVariationPreview.js");
  if (!variationPreview.includes("resolveEbayPreviewPath")) {
    errors.push("Missing resolveEbayPreviewPath priority resolver");
  }
  if (!variationPreview.includes("isSingleSkuEbayActionable")) {
    errors.push("Missing single-SKU priority guard");
  }
  for (const label of [...ACTIVE_LABELS, ...GROUP_LABELS]) {
    if (!variationPreview.includes(label)) errors.push(`Missing label: ${label}`);
  }
  notes.push("Variation preview labels + priority resolver present");

  for (const rel of ORCHESTRATOR_FILES) {
    const t = readText(rel);
    for (const token of FORBIDDEN_EDGE) {
      if (t.includes(token)) errors.push(`${rel} must not wire variation edges yet`);
    }
    if (/fetchEbayVariationChildCandidate|fetchEbayVariationRelistCandidate/.test(t)) {
      errors.push(`${rel} must not load variation candidates (orchestrator scope)`);
    }
  }
  const variationBranch = "js/admin/inventory/services/adjustChannelEbayVariationBranch.js";
  if (existsSync(join(ROOT, variationBranch))) {
    const vb = readText(variationBranch);
    if (!vb.includes("syncEbayVariationChildQuantity") && !vb.includes("relistEbayVariationGroup")) {
      errors.push("Variation branch must wire API wrappers when present");
    }
  }
  notes.push("Orchestrator scope: edges in variation branch only after 060C.3");

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_child_update_qty|relist-ebay-variation-group|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(amazon)) {
    errors.push("Amazon module unchanged");
  }
  notes.push("No Amazon changes");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory must remain sole stock writer");
  }

  for (const rel of PREVIEW_FILES) {
    if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("Preview files under line limit");

  return { notes, errors };
}

async function verifyMockedScenarios() {
  const notes = [];
  const errors = [];
  const previewUrl = pathToFileURL(join(ROOT, "js/admin/inventory/services/adjustChannelPreview.js")).href;
  const { buildAdjustChannelPreviewState } = await import(previewUrl);

  const base = {
    candidate: {
      product_id: "p1",
      variant_id: "v1",
      on_hand_qty: 0,
      reserved_qty: 0,
      amazon_sync_action: "missing_mapping",
      ebay_sync_action: "unsupported_variation",
    },
    relist: null,
    adjustment: { valid: true, newStock: 3 },
    fallbackOnHand: 0,
    fallbackReserved: 0,
  };

  const scenarios = [
    {
      label: "variation_update_qty",
      variationChild: {
        candidate_state: "variation_update_qty",
        cache_ebay_sku: "KK-1-BLK",
        ebay_child_qty: 0,
      },
      expectLabel: "eBay variation quantity can update.",
      expectToggle: true,
    },
    {
      label: "variation_qty_cache_missing",
      variationChild: {
        candidate_state: "variation_qty_cache_missing",
        expected_ebay_sku: "KK-1-BLK",
        requires_cache_refresh: true,
      },
      expectLabel: "eBay variation cache will refresh before sync.",
      expectToggle: true,
    },
    {
      label: "variation_manual",
      variationChild: { candidate_state: "variation_mapping_ambiguous", candidate_reason: "ambiguous_child" },
      expectLabel: "eBay variation requires manual mapping review.",
      expectToggle: false,
    },
    {
      label: "variation_group_ready_to_relist",
      candidate: {
        product_id: "p1",
        on_hand_qty: 0,
        reserved_qty: 0,
        amazon_sync_action: "missing_mapping",
        ebay_sync_action: "ended_needs_relist",
      },
      relist: { relist_action: "unsupported_variation" },
      variationRelist: {
        candidate_state: "variation_group_ready_to_relist",
        ebay_item_group_key: "grp-1",
        variant_count: 3,
        in_stock_child_count: 2,
      },
      expectLabel: "eBay variation group can be relisted.",
      expectToggle: true,
    },
    {
      label: "variation_group_dry_run_ready",
      candidate: {
        product_id: "p1",
        on_hand_qty: 0,
        reserved_qty: 0,
        amazon_sync_action: "missing_mapping",
        ebay_sync_action: "ended_needs_relist",
      },
      relist: { relist_action: "unsupported_variation" },
      variationRelist: { candidate_state: "variation_group_relist_dry_run_ready", in_stock_child_count: 1 },
      expectLabel: "eBay variation group relist can be previewed.",
      expectToggle: true,
    },
    {
      label: "variation_group_manual",
      candidate: {
        product_id: "p1",
        on_hand_qty: 0,
        reserved_qty: 0,
        amazon_sync_action: "missing_mapping",
        ebay_sync_action: "ended_needs_relist",
      },
      relist: { relist_action: "unsupported_variation" },
      variationRelist: {
        candidate_state: "variation_group_mapping_ambiguous",
        candidate_reason: "ambiguous_child",
      },
      expectLabel: "eBay variation group relist requires manual review.",
      expectToggle: false,
    },
    {
      label: "single_sku_wins_over_variation",
      candidate: {
        product_id: "p1",
        on_hand_qty: 0,
        reserved_qty: 0,
        amazon_sync_action: "missing_mapping",
        ebay_sync_action: "update_qty",
      },
      variationChild: { candidate_state: "variation_update_qty", child_offer_id: "o1" },
      expectLabel: "eBay quantity will update",
      expectToggle: true,
    },
    {
      label: "unsupported_replaced_by_clean_child",
      variationChild: {
        candidate_state: "variation_update_qty",
        cache_ebay_sku: "KK-2",
        child_offer_id: "o2",
      },
      expectLabel: "eBay variation quantity can update.",
      expectToggle: true,
    },
  ];

  for (const sc of scenarios) {
    const state = buildAdjustChannelPreviewState({
      ...base,
      ...sc,
      candidate: { ...base.candidate, ...(sc.candidate || {}) },
    });
    if (state.ebay.label !== sc.expectLabel) {
      errors.push(`Scenario ${sc.label}: expected label "${sc.expectLabel}", got "${state.ebay.label}"`);
      continue;
    }
    if (state.syncToggleDefault !== sc.expectToggle) {
      errors.push(`Scenario ${sc.label}: toggle default ${sc.expectToggle}, got ${state.syncToggleDefault}`);
      continue;
    }
    notes.push(`Mock PASS: ${sc.label}`);
  }

  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  if (!plan.includes("060C.2")) errors.push("Plan missing 060C.2 section");
  if (!/060C\.2[^]*✅|060C\.2 complete/i.test(plan)) {
    errors.push("Plan must mark 060C.2 complete");
  }
  if (!plan.includes("verify-inventory-phase060c2-adjust-preview-toggle.mjs")) {
    errors.push("Plan missing 060C.2 verify script ref");
  }
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("060C")) errors.push("Roadmap missing Phase 060C");
  notes.push("Docs/roadmap updated for 060C.2");
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  for (const { script, label, args = [] } of [
    { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
    { script: "verify-inventory-phase060b-final-freeze.mjs", label: "060B freeze" },
    { script: "verify-inventory-phase059-final.mjs", label: "059 static", args: ["--static"] },
  ]) {
    const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 90_000,
      env: { ...process.env, ...FAST_ENV },
    });
    if (r.status === 0) notes.push(`Regression PASS: ${label}`);
    else errors.push(`Regression FAIL: ${label}`);
  }
  return { notes, errors };
}

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    // optional
  }
  return env;
}

function startServer() {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[filePath.slice(filePath.lastIndexOf("."))] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT email FROM auth.users
       WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
       ORDER BY created_at LIMIT 1`,
    );
    if (rows?.[0]?.email) return rows[0].email;
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error("Could not resolve admin email");
}

async function verifyBrowser(env) {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    const email = await resolveAdminEmail(env);
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const redirectTo = `http://127.0.0.1:${PORT}${PAGE}`;
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) throw new Error(error.message);
    await page.goto(data.properties.action_link, { waitUntil: "networkidle", timeout: 60000 });
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });

    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    await page.waitForFunction(
      () => !document.querySelector("[data-adjust-channel-loading]"),
      { timeout: 20000 },
    );
    notes.push("Adjust modal preview loaded (no submit)");

    const toggle = page.locator("[data-adjust-sync-toggle]");
    if (!(await toggle.count())) errors.push("Sync toggle missing");
    else notes.push("Sync toggle present after variation preview load");

    const benign = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource"),
    );
    if (benign.length) errors.push(`Console errors: ${benign.slice(0, 2).join(" | ")}`);
    else notes.push("No significant console errors");
  } catch (err) {
    errors.push(`Browser smoke: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("\n=== Phase 060C.2 — Adjust Preview/Toggle Variation Integration ===\n");

  const parts = [verifyStatic(), verifyDocs(), verifyRegressions()];
  let mocked = { notes: [], errors: [] };
  try {
    mocked = await verifyMockedScenarios();
  } catch (err) {
    mocked.errors.push(`Mocked scenarios failed: ${err.message}`);
  }
  parts.push(mocked);

  const env = loadEnv();
  let browser = { notes: [], errors: [] };
  if (process.env.VERIFY_SKIP_BROWSER !== "1") {
    try {
      browser = await verifyBrowser(env);
    } catch (err) {
      browser.errors.push(`Browser skipped: ${err.message}`);
    }
  } else {
    browser.notes.push("Browser smoke skipped (VERIFY_SKIP_BROWSER=1)");
  }
  parts.push(browser);

  const notes = parts.flatMap((p) => p.notes);
  const errors = parts.flatMap((p) => p.errors);

  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060C.2 read-only preview/toggle integration complete\n");
  console.log("Next subphase: 060C.3 — orchestrator + result panel wiring\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
