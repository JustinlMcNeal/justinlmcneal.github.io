#!/usr/bin/env node
/**
 * Playwright diagnostic — inventory page load, auth, and Supabase health.
 * Run: node scripts/verify-inventory-page-load.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9899;
const PAGE = "/pages/admin/inventory.html";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
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
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      });
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
  await page.goto(data.properties.action_link, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
}

async function probeSupabase(env) {
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, reason: "missing env" };

  const probes = [
    ["site_settings", `${url}/rest/v1/site_settings?select=key&limit=1`],
    ["v_inventory_kpis", `${url}/rest/v1/v_inventory_kpis?select=total_skus&limit=1`],
    ["v_inventory_issues", `${url}/rest/v1/v_inventory_issues?select=issue_type&limit=1`],
  ];

  const results = [];
  for (const [name, probeUrl] of probes) {
    const started = Date.now();
    try {
      const res = await fetch(probeUrl, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        signal: AbortSignal.timeout(25000),
      });
      results.push({
        name,
        status: res.status,
        ms: Date.now() - started,
        ok: res.ok,
      });
    } catch (err) {
      results.push({
        name,
        status: 0,
        ms: Date.now() - started,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

function fmtNetwork(rows) {
  return rows
    .slice(0, 40)
    .map((r) => `  ${r.status || "ERR"} ${r.ms}ms ${r.method} ${r.path}`)
    .join("\n");
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  console.log("\n=== Inventory page load diagnostic (Playwright) ===\n");

  console.log("Supabase REST probes (anon, no auth):");
  const probe = await probeSupabase(env);
  for (const r of probe.results ?? []) {
    const tag = r.ok ? "OK" : "FAIL";
    console.log(`  [${tag}] ${r.name}: HTTP ${r.status || r.error} (${r.ms}ms)`);
  }

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLines = [];
  const pageErrors = [];
  const networkLog = [];

  page.on("console", (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  page.on("response", (res) => {
    const u = res.url();
    if (!u.includes("supabase.co")) return;
    const req = res.request();
    let path = u;
    try {
      path = new URL(u).pathname + new URL(u).search.slice(0, 80);
    } catch {
      // keep full url
    }
    networkLog.push({
      status: res.status(),
      ms: 0,
      method: req.method(),
      path,
    });
  });

  const notes = [];
  const errors = [];

  try {
    console.log("\nSigning in admin via magic link…");
    await signInAdmin(page, env);
    notes.push(`After magic link: ${page.url()}`);

    // Let Supabase client hydrate session from hash before admin guard runs.
    await page.waitForTimeout(2500);
    if (page.url().includes("#access_token")) {
      await page.evaluate(async () => {
        const { getSupabaseClient } = await import("/js/shared/supabaseClient.js");
        const sb = getSupabaseClient();
        for (let i = 0; i < 30; i++) {
          const { data } = await sb.auth.getSession();
          if (data.session) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      });
    }

    const t0 = Date.now();
    console.log("Loading inventory page…");
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });

    // Poll until panels leave loading or 90s
    let panelState = null;
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(2000);
      panelState = await page.evaluate(async () => {
        try {
          const mod = await import("/js/admin/inventory/state.js");
          const s = mod.state;
          return {
            url: location.href,
            adminOk: s.adminOk,
            kpiLoading: s.kpiLoading,
            ledgerLoading: s.ledgerLoading,
            workspaceLoading: s.workspaceLoading,
            issuesLoading: s.issuesLoading,
            channelLoading: s.channelStatusLoading,
            parcelLoading: s.parcelSummaryLoading,
            kpiLive: s.kpiLive,
            ledgerLive: s.ledgerLive,
            workspaceLive: s.workspaceLive,
            issuesLive: s.issuesLive,
            kpiError: s.kpiError,
            workspaceError: s.workspaceError,
            issuesError: s.issuesError,
            issueCount: s.issueRows?.length ?? 0,
            rowCount: s.inventoryRows?.length ?? 0,
          };
        } catch (e) {
          return { evalError: String(e), url: location.href };
        }
      });

      const stillLoading =
        panelState.kpiLoading ||
        panelState.ledgerLoading ||
        panelState.workspaceLoading ||
        panelState.issuesLoading ||
        panelState.channelLoading ||
        panelState.parcelLoading;

      if (!stillLoading || panelState.evalError) break;
      if (Date.now() - t0 > 90000) break;
    }

    notes.push(`Final URL: ${panelState?.url ?? page.url()}`);
    notes.push(`adminOk: ${panelState?.adminOk}`);
    notes.push(
      `Loading flags — kpi:${panelState?.kpiLoading} ledger:${panelState?.ledgerLoading} workspace:${panelState?.workspaceLoading} issues:${panelState?.issuesLoading}`,
    );
    notes.push(
      `Live flags — kpi:${panelState?.kpiLive} ledger:${panelState?.ledgerLive} workspace:${panelState?.workspaceLive} issues:${panelState?.issuesLive}`,
    );
    notes.push(`Rows — inventory:${panelState?.rowCount} issues:${panelState?.issueCount}`);

    if (panelState?.kpiError) notes.push(`KPI error: ${panelState.kpiError}`);
    if (panelState?.workspaceError) notes.push(`Workspace error: ${panelState.workspaceError}`);
    if (panelState?.issuesError) notes.push(`Issues error: ${panelState.issuesError}`);

    const kpiCards = await page.locator("[data-kpi]").count();
    notes.push(`KPI cards in DOM: ${kpiCards}`);

    const loadingSpinners = await page.locator("[data-loading='true'], .animate-pulse").count();
    notes.push(`Loading indicators in DOM: ${loadingSpinners}`);

    if (page.url().includes("login.html")) {
      errors.push("Redirected to login — session expired or requireAdmin failed");
    }

    const anyStillLoading =
      panelState?.kpiLoading ||
      panelState?.ledgerLoading ||
      panelState?.workspaceLoading ||
      panelState?.issuesLoading;

    if (anyStillLoading) {
      errors.push("Page stuck in loading state after 90s — likely hung Supabase request");
    }

    const badResponses = networkLog.filter((r) => r.status >= 400);
    if (badResponses.length) {
      notes.push(`Supabase responses >=400: ${badResponses.length}`);
      console.log("\nSupabase network (failures first):");
      console.log(
        fmtNetwork([
          ...badResponses,
          ...networkLog.filter((r) => r.status < 400),
        ]),
      );
    } else if (networkLog.length) {
      console.log("\nSupabase network (sample):");
      console.log(fmtNetwork(networkLog));
    }

    const relevantConsole = consoleLines.filter(
      (line) =>
        !line.includes("cdn.tailwindcss.com") &&
        !line.includes("PWA") &&
        !line.includes("Banner not shown") &&
        !line.includes("CouponUI"),
    );
    if (relevantConsole.length) {
      console.log("\nBrowser console:");
      for (const line of relevantConsole.slice(-30)) console.log(" ", line);
    }

    if (pageErrors.length) {
      errors.push(`Page errors: ${pageErrors.join(" | ")}`);
    }

    const status503 = networkLog.filter((r) => r.status === 503);
    if (status503.length) {
      errors.push(
        `Supabase returned 503 Service Unavailable (${status503.length} requests) — project may be overloaded or in maintenance`,
      );
    }

    if (!panelState?.adminOk && !page.url().includes("login.html")) {
      errors.push("adminOk is false but page did not redirect to login");
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n--- Summary ---");
  for (const n of notes) console.log(`  • ${n}`);

  if (errors.length) {
    console.error("\nISSUES:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nPASS — inventory page loaded\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
