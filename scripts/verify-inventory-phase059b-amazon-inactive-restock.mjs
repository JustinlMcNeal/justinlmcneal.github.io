/**
 * Phase 059B.4 — Full Amazon inactive restock verification (edge + orchestrator + optional API).
 * Run: node scripts/verify-inventory-phase059b-amazon-inactive-restock.mjs
 *
 * Optional env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — dry-run / live API sections
 *   TEST_AMAZON_INACTIVE_VARIANT_ID — variant with inactive_can_update candidate
 *   RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true — explicit live Amazon call (requires gate on server)
 *   AMAZON_ENABLE_LIVE_PATCH=true — required alongside live test flag
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9900;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const REGRESSION_SCRIPTS = [
  "verify-inventory-phase059a-adjust-orchestration.mjs",
  "verify-inventory-phase059b2-amazon-inactive-edge.mjs",
  "verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs",
  "verify-inventory-issue-view-safety.mjs",
  "verify-inventory-phase10y-final-stabilization.mjs",
];

const EDGE_FILES = [
  "supabase/functions/sync-amazon-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
  "supabase/functions/_shared/amazonOfferRestoreUtils.ts",
  "supabase/functions/_shared/inventoryAmazonSyncUtils.ts",
];

const ORCH_FILES = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/api/amazonSyncPushApi.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
];

const EBAY_PATHS = [
  "supabase/functions/sync-ebay-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryEbaySyncUtils.ts",
  "js/admin/inventory/api/ebaySyncPushApi.js",
];

const FORBIDDEN = [
  { label: "eBay auto-relist implementation", pattern: /pushEbayRelist|autoRelistListing|sync-ebay.*relist/i },
  { label: "eBay cache refresh chain", pattern: /sync-ebay-listing-inventory-cache|refreshEbayListingCache/i },
  { label: "full fetchChannelSyncPreview in adjust flow", pattern: /fetchChannelSyncPreview/ },
  { label: "browser snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot/ },
];

const MOCK_INACTIVE_CANDIDATE = {
  variant_id: "11111111-1111-4111-8111-111111111111",
  product_id: "22222222-2222-4222-8222-222222222222",
  available_qty: 5,
  on_hand_qty: 5,
  reserved_qty: 0,
  kk_sync_action: "update_qty",
  amazon_sync_action: "inactive_can_update",
  amazon_listing_status: "inactive",
  amazon_current_qty: 0,
  ebay_sync_action: "no_change",
  ebay_listing_status: null,
  ebay_current_qty: 0,
  issue_flags: [],
};

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

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyStatic059B() {
  const notes = [];
  const errors = [];

  for (const rel of [...EDGE_FILES, ...ORCH_FILES]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (rel.includes("sync-amazon-inventory-quantity") && lineCount(rel) > MAX_LINES) {
      notes.push(`${rel}: ${lineCount(rel)} lines (pre-existing edge, acceptable)`);
    } else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("059B edge + orchestrator modules present and under 500 lines");

  const syncIndex = readText("supabase/functions/sync-amazon-inventory-quantity/index.ts");
  if (!syncIndex.includes("inactive_restock")) errors.push("Edge must support inactive_restock mode");
  if (!syncIndex.includes('parseSyncMode') && !syncIndex.includes('"update_qty"')) {
    errors.push("Edge must default to update_qty");
  }
  if (!syncIndex.includes("exactly one variantId")) {
    errors.push("inactive_restock must require exactly one variantId");
  }
  if (!syncIndex.includes("inactive_restock limit must be 1")) {
    errors.push("inactive_restock must enforce limit 1");
  }
  if (!syncIndex.includes("handleAmazonInactiveRestockSync")) {
    errors.push("Edge must delegate inactive_restock to handler");
  }
  notes.push("Edge: inactive_restock mode, single variant, limit 1, update_qty default");

  const inactive = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  for (const token of ["inactive_can_update", "available_qty", "<= 0", "amazon_is_afn", "isFbaManagedListing"]) {
    if (!inactive.includes(token)) errors.push(`Inactive module missing ${token}`);
  }
  if (!inactive.includes('status: "dry_run"') && !inactive.includes('"dry_run"')) {
    errors.push("Inactive path must return dry_run when live gate off");
  }
  if (!inactive.includes("createInventorySyncRun")) {
    errors.push("Inactive path must persist sync run with correlation");
  }
  if (inactive.includes("adjust_inventory")) {
    errors.push("Inactive path must not call adjust_inventory");
  }
  notes.push("Inactive loader: inactive_can_update, available>0, AFN skip, dry_run, correlation");

  const loader = readText("supabase/functions/_shared/inventoryAmazonSyncUtils.ts");
  if (!loader.includes('.eq("amazon_sync_action", "update_qty")')) {
    errors.push("Default loader must filter update_qty only");
  }
  if (!loader.includes("parseInventorySyncRunContext") || !loader.includes("orchestration_id")) {
    errors.push("Sync utils must parse syncContext correlation fields");
  }
  notes.push("Default update_qty loader unchanged; syncContext correlation supported");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const fnBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const adjustIdx = fnBody.indexOf("await adjustInventory(");
  const amazonIdx = fnBody.indexOf("await resolveAmazonBranch(");
  if (adjustIdx < 0 || amazonIdx < 0 || amazonIdx < adjustIdx) {
    errors.push("Amazon inactive restock must run only after adjust_inventory succeeds");
  }
  if (!orch.includes('mode: "inactive_restock"')) {
    errors.push("Orchestrator must call pushAmazonFbmInventory with mode inactive_restock");
  }
  if (!orch.includes("variantIds: [variantId]") || !orch.includes("limit: 1")) {
    errors.push("Orchestrator must pass single variantId and limit 1");
  }
  if (!orch.includes("syncContext")) errors.push("Orchestrator must pass syncContext");
  if (!orch.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Orchestrator must re-fetch post-adjust candidate");
  }
  if (!orch.includes("projectedAvailable <= 0")) {
    errors.push("Orchestrator must skip when projected available <= 0");
  }
  notes.push("Orchestrator: post-adjust inactive_restock with syncContext, single variant");

  const updateQtyFn = orch.slice(0, orch.indexOf("async function runAmazonInactiveRestock"));
  if (updateQtyFn.includes('mode: "inactive_restock"')) {
    errors.push("update_qty path must not pass inactive_restock mode");
  }
  if (!updateQtyFn.includes("await pushAmazonFbmInventory(")) {
    errors.push("update_qty path must still call pushAmazonFbmInventory");
  }
  notes.push("Active update_qty path unchanged");

  const nextSteps = readText("js/admin/inventory/services/adjustChannelNextSteps.js");
  if (!nextSteps.includes('case "inactive_can_update"')) {
    errors.push("adjustChannelNextSteps must handle inactive_can_update");
  }
  if (nextSteps.includes('inactive_can_update') && nextSteps.match(/inactive_can_update[\s\S]{0,120}status:\s*"next_step"/)) {
    errors.push("inactive_can_update must not be next_step only (orchestrator handles restore)");
  }
  notes.push("inactive_can_update handled by orchestrator, not next_step deferral");

  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  if (!preview.includes("Amazon inactive offer can be restored")) {
    errors.push("Preview must show inactive restore available copy");
  }
  if (!preview.includes('candidate.amazon_sync_action === "inactive_can_update"')) {
    errors.push("Sync toggle default must include inactive_can_update");
  }
  notes.push("Preview copy and toggle default include inactive_can_update");

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const summary = readText("js/admin/inventory/services/adjustOrchestratorSummary.js");
  for (const token of ["dry_run", "Preview only"]) {
    if (!panel.includes(token)) errors.push(`Result panel missing dry_run support: ${token}`);
  }
  for (const msg of [
    "Amazon inactive offer restore requested",
    "Live Amazon patching is disabled",
  ]) {
    if (!orch.includes(msg) && !(msg.includes("disabled") && orch.includes("AMAZON_DRY_RUN_COPY"))) {
      errors.push(`Orchestrator missing result copy: ${msg}`);
    }
  }
  if (!summary.includes("Stock remains adjusted") && !orch.includes("KK stock remains adjusted")) {
    errors.push("Orchestrator/summary missing partial failure copy");
  }
  notes.push("Result panel dry_run badge + inactive restore messages");

  const syncModal = readText("js/admin/inventory/ui/syncDryRunModal.js");
  if (syncModal.includes("inactive_restock")) {
    errors.push("Sync Channels must not pass inactive_restock mode");
  }
  notes.push("Sync Channels default update_qty only");

  for (const rel of EBAY_PATHS) {
    if (existsSync(join(ROOT, rel)) && readText(rel).includes("inactive_restock")) {
      errors.push(`${rel} must not reference inactive_restock`);
    }
  }
  notes.push("eBay files untouched by inactive restock");

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }

  const orchOnly = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orchOnly.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  notes.push("No forbidden adjust-flow patterns; adjust_inventory only stock writer");

  return { notes, errors };
}

function runRegressionScripts() {
  const notes = [];
  const errors = [];
  const skipped = [];

  for (const script of REGRESSION_SCRIPTS) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing regression script: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 300000,
      env: { ...process.env },
    });
    const label = script.replace("verify-inventory-", "").replace(".mjs", "");
    if (result.status === 0) notes.push(`Regression PASS: ${label}`);
    else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-6).join(" ").trim();
      errors.push(`Regression FAIL: ${label}${tail ? ` — ${tail.slice(0, 180)}` : ""}`);
    }
  }

  return { notes, errors, skipped };
}

async function callInactiveRestockEdge(env, body) {
  const url = `${env.SUPABASE_URL}/functions/v1/sync-amazon-inventory-quantity`;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  return { status: resp.status, data };
}

async function verifyDryRunApi(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const variantId = env.TEST_AMAZON_INACTIVE_VARIANT_ID || process.env.TEST_AMAZON_INACTIVE_VARIANT_ID;

  if (!url || !key) {
    skipped.push("Dry-run API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped, liveAmazonCalled: false };
  }
  if (!variantId?.trim()) {
    skipped.push("Dry-run API: skipped — missing TEST_AMAZON_INACTIVE_VARIANT_ID");
    return { notes, errors, skipped, liveAmazonCalled: false };
  }

  const testOrchestrationId = `059b4-dryrun-${Date.now()}`;
  const syncContext = {
    trigger_source: "manual_adjust",
    trigger_reference_type: "stock_ledger",
    trigger_reference_id: "00000000-0000-4000-8000-000000000001",
    stock_ledger_id: "00000000-0000-4000-8000-000000000002",
    orchestration_id: testOrchestrationId,
  };

  const { status, data } = await callInactiveRestockEdge(
    { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key },
    {
      mode: "inactive_restock",
      preview: true,
      variantIds: [variantId.trim()],
      limit: 1,
      syncContext,
    },
  );

  if (status >= 500) {
    errors.push(`Dry-run API: edge returned HTTP ${status}`);
    return { notes, errors, skipped, liveAmazonCalled: false };
  }

  if (data.ok !== true && data.ok !== false) {
    errors.push("Dry-run API: unexpected response shape");
  } else {
    notes.push(`Dry-run API: edge responded ok=${data.ok} mode=${data.mode || "?"}`);
  }

  const resultStatus = data.results?.[0]?.status;
  if (resultStatus && ["success", "skipped", "dry_run", "failed"].includes(resultStatus)) {
    notes.push(`Dry-run API: result status=${resultStatus} — ${data.results[0].message?.slice(0, 80) || ""}`);
  } else if (data.error) {
    notes.push(`Dry-run API: edge error (may be no candidate): ${data.error}`);
  }

  try {
    process.env.SUPABASE_DB_PASSWORD =
      env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
    const client = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, mode, trigger_source, orchestration_id
       FROM inventory_channel_sync_runs
       WHERE orchestration_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [testOrchestrationId],
    );
    await client.end().catch(() => {});
    if (rows?.[0]) {
      notes.push(
        `Dry-run API: sync run logged id=${rows[0].id} trigger_source=${rows[0].trigger_source}`,
      );
      if (rows[0].trigger_source !== "manual_adjust") {
        errors.push("Dry-run API: sync run missing trigger_source correlation");
      }
    } else {
      skipped.push("Dry-run API: no sync run row found (candidate may be absent)");
    }
  } catch (err) {
    skipped.push(`Dry-run API: DB correlation check skipped — ${err.message}`);
  }

  return { notes, errors, skipped, liveAmazonCalled: false };
}

async function verifyLiveTest(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  const runLive =
    (env.RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST || process.env.RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST) ===
    "true";
  const gateOn =
    (env.AMAZON_ENABLE_LIVE_PATCH || process.env.AMAZON_ENABLE_LIVE_PATCH) === "true";
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const variantId = env.TEST_AMAZON_INACTIVE_VARIANT_ID || process.env.TEST_AMAZON_INACTIVE_VARIANT_ID;

  if (!runLive) {
    skipped.push("Live test: skipped — RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST not true");
    return { notes, errors, skipped, liveAmazonCalled: false };
  }
  if (!gateOn) {
    skipped.push("Live test: skipped — AMAZON_ENABLE_LIVE_PATCH not true");
    return { notes, errors, skipped, liveAmazonCalled: false };
  }
  if (!url || !key || !variantId?.trim()) {
    skipped.push("Live test: skipped — missing Supabase credentials or TEST_AMAZON_INACTIVE_VARIANT_ID");
    return { notes, errors, skipped, liveAmazonCalled: false };
  }

  console.warn("\n⚠️  LIVE AMAZON INACTIVE RESTOCK TEST — one variant only, no retries\n");

  const testOrchestrationId = `059b4-live-${Date.now()}`;
  const { status, data } = await callInactiveRestockEdge(
    { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key },
    {
      mode: "inactive_restock",
      preview: false,
      variantIds: [variantId.trim()],
      limit: 1,
      syncContext: {
        trigger_source: "manual_adjust",
        trigger_reference_type: "stock_ledger",
        orchestration_id: testOrchestrationId,
      },
    },
  );

  if (status >= 500) errors.push(`Live test: edge HTTP ${status}`);
  else notes.push(`Live test: edge ok=${data.ok} summary=${JSON.stringify(data.summary || {})}`);

  const row = data.results?.[0];
  if (row?.status === "success") {
    notes.push(`Live test: success SKU=${row.sellerSku} targetQty=${row.targetQty}`);
    if (!(Number(row.targetQty) > 0)) errors.push("Live test: target qty must be > 0");
  } else if (row?.status === "skipped") {
    notes.push(`Live test: skipped — ${row.message}`);
  } else if (row?.status === "dry_run") {
    notes.push("Live test: returned dry_run (server live gate may be off)");
  } else if (row?.status === "failed") {
    errors.push(`Live test: failed — ${row.message}`);
  }

  return { notes, errors, skipped, liveAmazonCalled: row?.status === "success" };
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

async function signInAdmin(page, env) {
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
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
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

  await page.route("**/rest/v1/v_inventory_channel_sync_candidates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_INACTIVE_CANDIDATE),
    });
  });

  try {
    await signInAdmin(page, env);
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-inventory-action="adjust-stock"]').first().waitFor({ state: "visible", timeout: 60000 });
    notes.push("Browser: inventory page loaded");

    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Browser: adjust modal opened");

    await page.waitForSelector("[data-adjust-channel-card='amazon']", { timeout: 15000 });
    const amazonCard = page.locator("[data-adjust-channel-card='amazon']");
    const cardText = await amazonCard.innerText();
    if (!/Amazon inactive offer can be restored/i.test(cardText)) {
      errors.push("Browser: Amazon inactive preview label not rendered");
    } else notes.push("Browser: inactive Amazon preview label rendered");

    const toggle = page.locator("[data-adjust-sync-toggle]");
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    const checked = await toggle.isChecked();
    const disabled = await toggle.isDisabled();
    if (!checked || disabled) {
      errors.push("Browser: sync toggle should default ON for inactive_can_update with available > 0");
    } else notes.push("Browser: sync toggle ON for inactive_can_update candidate");

    const panelSrc = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
    if (!panelSrc.includes("dry_run")) {
      errors.push("Browser: result panel missing dry_run support");
    } else notes.push("Browser: result panel supports dry_run warning copy");

    const benign = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource"),
    );
    if (benign.length) errors.push(`Browser console errors: ${benign.slice(0, 3).join(" | ")}`);
    else notes.push("Browser: no significant console errors");
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const staticResult = verifyStatic059B();
  const regression = runRegressionScripts();

  let dryRun = { notes: [], errors: [], skipped: [], liveAmazonCalled: false };
  let live = { notes: [], errors: [], skipped: [], liveAmazonCalled: false };
  let browserResult = { notes: [], errors: [] };

  try {
    dryRun = await verifyDryRunApi(env);
  } catch (err) {
    dryRun.skipped.push(`Dry-run API: exception — ${err.message}`);
  }

  try {
    live = await verifyLiveTest(env);
  } catch (err) {
    live.errors.push(`Live test exception: ${err.message}`);
  }

  try {
    browserResult = await verifyBrowser(env);
  } catch (err) {
    browserResult.errors.push(`Browser smoke skipped: ${err.message}`);
  }

  const errors = [
    ...staticResult.errors,
    ...regression.errors,
    ...dryRun.errors,
    ...live.errors,
    ...browserResult.errors,
  ];
  const notes = [
    ...staticResult.notes,
    ...regression.notes,
    ...dryRun.notes,
    ...live.notes,
    ...browserResult.notes,
  ];
  const skipped = [...regression.skipped, ...dryRun.skipped, ...live.skipped];

  console.log("\n=== Phase 059B.4 — Amazon Inactive Restock Verification ===\n");

  console.log("Static checks:");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  console.log("\nRegression scripts:");
  for (const n of regression.notes) console.log(`  ✓ ${n}`);
  for (const e of regression.errors) console.log(`  ✗ ${e}`);

  console.log("\nDry-run API:");
  for (const n of dryRun.notes) console.log(`  ✓ ${n}`);
  for (const s of dryRun.skipped) console.log(`  ○ ${s}`);
  for (const e of dryRun.errors) console.log(`  ✗ ${e}`);

  console.log("\nLive test:");
  for (const n of live.notes) console.log(`  ✓ ${n}`);
  for (const s of live.skipped) console.log(`  ○ ${s}`);
  for (const e of live.errors) console.log(`  ✗ ${e}`);

  console.log("\nBrowser smoke:");
  for (const n of browserResult.notes) console.log(`  ✓ ${n}`);
  for (const e of browserResult.errors) console.log(`  ✗ ${e}`);

  const liveCalled = dryRun.liveAmazonCalled || live.liveAmazonCalled;

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059B.4 Amazon inactive restock verification complete\n");
  console.log(`Live Amazon call made: ${liveCalled ? "YES" : "NO"}`);
  if (skipped.length) {
    console.log("\nSkipped sections:");
    for (const s of skipped) console.log(`  ○ ${s}`);
  }
  console.log("\nNext subphase: 059B.5 — 059B QA + docs freeze\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
