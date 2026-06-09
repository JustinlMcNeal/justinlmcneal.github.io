/**
 * Phase 6A save_parcel_import_draft RPC smoke test (browser).
 * Run: node scripts/verify-parcel-phase6a-smoke.mjs
 *
 * Requires .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: KK_ADMIN_EMAIL (defaults to first is_admin user from DB query)
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE = join(
  ROOT,
  "docs/pages/admin/parcelImport/fixtures/sample_baestao_waybill_227461.xls",
);
const PORT = 9882;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".xls": "text/html",
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
      if (urlPath === "/") urlPath = "/pages/admin/parcelImports.html";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
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
    const email = rows?.[0]?.email;
    if (email) return email;
  } finally {
    await client.end().catch(() => {});
  }

  throw new Error("Could not resolve admin email (set KK_ADMIN_EMAIL in .env)");
}

async function signInWithMagicLink(page, env) {
  const url = env.SUPABASE_URL || "https://yxdzvzscufkvewecvagq.supabase.co";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const email = await resolveAdminEmail(env);
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const redirectTo = `http://127.0.0.1:${PORT}/pages/admin/parcelImports.html`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const actionLink = data?.properties?.action_link;
  if (!actionLink) throw new Error("generateLink returned no action_link");

  console.log(`[phase6a] signing in as ${email} via magic link…`);
  await page.goto(actionLink, { waitUntil: "networkidle", timeout: 60000 });

  const hasSession = await page.evaluate(async () => {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("/js/config/env.js");
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    return !!data?.session?.access_token;
  });

  if (!hasSession) {
    throw new Error("Magic link login did not establish a browser session");
  }
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[parcelImports smoke]")) logs.push(text);
  });

  try {
    const base = `http://127.0.0.1:${PORT}`;
    await signInWithMagicLink(page, env);

    if (!page.url().includes("parcelImports")) {
      await page.goto(`${base}/pages/admin/parcelImports.html`, {
        waitUntil: "networkidle",
      });
    }

    await page.waitForFunction(
      () => window.ParcelImports?.runSaveDraftSmokeTest,
      { timeout: 15000 },
    );

    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );

    const summary = await page.evaluate(async () => {
      return window.ParcelImports.runSaveDraftSmokeTest();
    });

    console.log("\n=== Phase 6A RPC smoke summary ===\n");
    console.log(JSON.stringify(summary, null, 2));

    const checks = summary?.checks || {};
    const pass =
      checks.createTrue &&
      checks.updateFalse &&
      checks.itemCount11 &&
      checks.allocCount11 &&
      checks.dbItemsStable &&
      checks.dbAllocsStable &&
      checks.eventsOk;

    if (logs.length) {
      console.log("\nSmoke console logs:");
      logs.forEach((l) => console.log(" ", l));
    }

    if (!pass) {
      console.log("\nFAILED — one or more checks did not pass");
      process.exitCode = 1;
    } else {
      console.log("\nALL CHECKS PASSED");
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
