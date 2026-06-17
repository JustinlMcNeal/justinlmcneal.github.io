/**
 * Phase 060C.3 — Adjust variation orchestrator + result panel verification.
 *
 * Run: node scripts/verify-inventory-phase060c3-adjust-variation-orchestrator.mjs
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PORT = 9897;
const PAGE = "/pages/admin/inventory.html";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const PHASE_FILES = [
  "js/admin/inventory/api/ebayVariationQtySyncApi.js",
  "js/admin/inventory/api/ebayVariationGroupRelistApi.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
];

const VARIATION_QTY_COPY = [
  "eBay variation quantity updated.",
  "eBay variation quantity sync was previewed only. Live eBay quantity patching is disabled.",
  "eBay variation requires manual mapping review.",
  "eBay variation quantity sync skipped.",
  "eBay variation quantity sync failed. KK stock remains adjusted.",
];

const VARIATION_GROUP_COPY = [
  "eBay variation group relisted successfully.",
  "eBay variation group relist was previewed only. Live variation relist is disabled.",
  "eBay variation group relist requires manual review.",
  "eBay variation group relist skipped.",
  "eBay variation group relist failed. KK stock remains adjusted.",
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

  for (const rel of PHASE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }

  const qtyApi = readText("js/admin/inventory/api/ebayVariationQtySyncApi.js");
  if (!qtyApi.includes("syncEbayVariationChildQuantity")) errors.push("Qty API missing export");
  if (!qtyApi.includes("sync-ebay-inventory-quantity")) errors.push("Qty API must call sync edge");
  if (!qtyApi.includes('mode: "variation_child_update_qty"')) {
    errors.push("Qty API must pass variation_child_update_qty mode");
  }
  if (!qtyApi.includes("syncContext")) errors.push("Qty API must pass syncContext");
  if (qtyApi.includes("adjust_inventory")) errors.push("Qty API must not write stock");
  notes.push("ebayVariationQtySyncApi.js contract");

  const relistApi = readText("js/admin/inventory/api/ebayVariationGroupRelistApi.js");
  if (!relistApi.includes("relistEbayVariationGroup")) errors.push("Relist API missing export");
  if (!relistApi.includes("relist-ebay-variation-group")) errors.push("Relist API must call relist edge");
  if (!relistApi.includes("syncContext")) errors.push("Relist API must pass syncContext");
  if (relistApi.includes("adjust_inventory")) errors.push("Relist API must not write stock");
  notes.push("ebayVariationGroupRelistApi.js contract");

  const varBranch = readText("js/admin/inventory/services/adjustChannelEbayVariationBranch.js");
  if (!varBranch.includes("runEbayVariationQtySync")) errors.push("Missing runEbayVariationQtySync");
  if (!varBranch.includes("runEbayVariationGroupRelist")) errors.push("Missing runEbayVariationGroupRelist");
  if (!varBranch.includes("resolveEbayVariationBranch")) errors.push("Missing resolveEbayVariationBranch");
  if (!varBranch.includes('candidate_state !== "variation_update_qty"') && !varBranch.includes('candidate_state === "variation_update_qty"')) {
    errors.push("Qty sync must require variation_update_qty state");
  }
  if (!varBranch.includes("availableQty <= 0")) errors.push("Variation branch must gate on available qty");
  if (/updateSibling|siblingVariants|relistEbayFromProduct/.test(varBranch)) {
    errors.push("Variation branch must not update siblings or single-SKU relist");
  }
  if (!varBranch.includes("variation_group_ready_to_relist")) {
    errors.push("Group relist must allow ready states");
  }
  notes.push("adjustChannelEbayVariationBranch.js guards");

  const ebayBranch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (!ebayBranch.includes("resolveEbayVariationBranch")) {
    errors.push("eBay branch must call variation resolver");
  }
  if (!ebayBranch.includes('action === "update_qty"')) errors.push("Single-SKU update_qty preserved");
  if (!ebayBranch.includes("unsupported_variation")) errors.push("unsupported_variation relist guard required");
  if (!ebayBranch.includes("runEbayEndedRelist")) errors.push("Single-SKU relist preserved");
  notes.push("adjustChannelEbayBranch.js order + guards");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const orchBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const adjustIdx = orchBody.indexOf("await adjustInventory(");
  const ebayIdx = orchBody.indexOf("await resolveEbayBranch(");
  if (adjustIdx < 0 || ebayIdx < 0 || ebayIdx < adjustIdx) {
    errors.push("Variation sync must run only after successful adjust_inventory");
  }
  if ((orchBody.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  if (!orchBody.includes("syncChannelsEnabled")) {
    errors.push("Orchestrator must respect sync toggle");
  }
  if (!orchBody.includes("availableQty: projectedAvailable")) {
    errors.push("Orchestrator must pass post-adjust available qty to eBay branch");
  }
  if (/fetchChannelSyncPreview|refreshIssueSnapshot|issueSnapshot/.test(orch)) {
    errors.push("No heavy reads in orchestrator");
  }
  notes.push("Orchestrator ordering + toggle + qty gate");

  const summary = readText("js/admin/inventory/services/adjustOrchestratorSummary.js");
  for (const copy of [...VARIATION_QTY_COPY, ...VARIATION_GROUP_COPY]) {
    if (!summary.includes(copy)) errors.push(`Missing summary copy: ${copy}`);
  }
  if (!summary.includes("ADJUST_NO_ROLLBACK_COPY")) errors.push("No-rollback copy missing");
  notes.push("Result copy constants present");

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  if (!panel.includes("variation_update_qty")) errors.push("Result panel missing variation_update_qty links");
  if (!panel.includes("variation_group_relist")) errors.push("Result panel missing variation_group_relist links");
  if (!panel.includes("ADJUST_PARTIAL_BANNER_TITLE")) errors.push("Partial success banner missing");
  if (!panel.includes("dry_run:")) errors.push("dry_run tone preserved");
  notes.push("Result panel variation handling");

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_child_update_qty|relist-ebay-variation-group|ebayVariationQtySyncApi/.test(amazon)) {
    errors.push("Amazon module unchanged");
  }
  notes.push("No Amazon changes");

  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  if (!plan.includes("060C.3")) errors.push("Plan missing 060C.3 section");
  if (!/060C\.3[^]*✅|060C\.3 complete/i.test(plan)) errors.push("Plan must mark 060C.3 complete");
  if (!plan.includes("verify-inventory-phase060c3-adjust-variation-orchestrator.mjs")) {
    errors.push("Plan missing 060C.3 verify script ref");
  }
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("060C")) errors.push("Roadmap missing Phase 060C");
  notes.push("Docs/roadmap updated for 060C.3");
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  for (const { script, label, args = [] } of [
    { script: "verify-inventory-phase060c2-adjust-preview-toggle.mjs", label: "060C.2" },
    { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
    { script: "verify-inventory-phase060b-final-freeze.mjs", label: "060B freeze" },
    { script: "verify-inventory-phase059-final.mjs", label: "059 static", args: ["--static"] },
  ]) {
    const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, ...FAST_ENV, VERIFY_SKIP_BROWSER: "1" },
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

async function verifyBrowserSmoke(env) {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  let variationQtyCalled = false;
  let variationRelistCalled = false;

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.route("**/functions/v1/sync-ebay-inventory-quantity", async (route) => {
    variationQtyCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        status: "dry_run",
        mode: "variation_child_update_qty",
        message: "eBay variation quantity sync was previewed only. Live eBay quantity patching is disabled.",
        runId: "mock-run-qty",
      }),
    });
  });

  await page.route("**/functions/v1/relist-ebay-variation-group", async (route) => {
    variationRelistCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        status: "dry_run",
        mode: "variation_group_relist",
        message: "eBay variation group relist was previewed only. Live variation relist is disabled.",
        runId: "mock-run-relist",
        groupKey: "mock-group",
      }),
    });
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
    notes.push("Adjust modal opened (orchestrator modules loaded)");

    const qtyApiLoaded = await page.evaluate(async () => {
      try {
        const mod = await import("/js/admin/inventory/api/ebayVariationQtySyncApi.js");
        return typeof mod.syncEbayVariationChildQuantity === "function";
      } catch {
        return false;
      }
    });
    if (!qtyApiLoaded) errors.push("Browser: variation qty API module not loadable");
    else notes.push("Browser: variation qty API module loadable");

    const relistApiLoaded = await page.evaluate(async () => {
      try {
        const mod = await import("/js/admin/inventory/api/ebayVariationGroupRelistApi.js");
        return typeof mod.relistEbayVariationGroup === "function";
      } catch {
        return false;
      }
    });
    if (!relistApiLoaded) errors.push("Browser: variation relist API module not loadable");
    else notes.push("Browser: variation relist API module loadable");

    notes.push(
      variationQtyCalled || variationRelistCalled
        ? "Mock edge intercept ready (no live calls — submit not exercised without fixture)"
        : "Mock edge routes registered; no live marketplace calls during smoke",
    );

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
  console.log("\n=== Phase 060C.3 — Adjust Variation Orchestrator ===\n");

  const parts = [verifyStatic(), verifyDocs(), verifyRegressions()];
  const env = loadEnv();
  if (process.env.VERIFY_SKIP_BROWSER !== "1") {
    parts.push(await verifyBrowserSmoke(env));
  } else {
    parts.push({ notes: ["Browser smoke skipped (VERIFY_SKIP_BROWSER=1)"], errors: [] });
  }

  const notes = parts.flatMap((p) => p.notes);
  const errors = parts.flatMap((p) => p.errors);

  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060C.3 variation orchestrator + result panel complete\n");
  console.log("Next subphase: 060C.4 — full integration verification matrix\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
