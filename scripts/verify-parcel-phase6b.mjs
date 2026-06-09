/**
 * Phase 6B Save Draft + History + Open Draft verification.
 * Run: node scripts/verify-parcel-phase6b.mjs
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
const PORT = 9883;

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
    if (rows?.[0]?.email) return rows[0].email;
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error("Could not resolve admin email");
}

async function signInWithMagicLink(page, env) {
  const url = env.SUPABASE_URL || "https://yxdzvzscufkvewecvagq.supabase.co";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

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
  if (error) throw new Error(error.message);
  await page.goto(data.properties.action_link, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await signInWithMagicLink(page, env);
    await page.waitForFunction(
      () => document.getElementById("parcelActionStatus")?.textContent?.length > 0,
      { timeout: 15000 },
    );

    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );

    const saveBtn = page.locator('[data-parcel-action="save-draft"]').first();
    await page.waitForFunction(
      () => !document.querySelector('[data-parcel-action="save-draft"]')?.disabled,
      { timeout: 10000 },
    );

    await saveBtn.click();
    await page.waitForFunction(
      () => /Draft saved/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterCreate = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const apiMod = await import("/js/admin/parcelImports/api/parcelImportsApi.js");
      const s = stateMod.getState();
      const counts = await apiMod.fetchImportSmokeCounts(s.currentImportId);
      return {
        currentImportId: s.currentImportId,
        saveMessage: s.saveMessage,
        counts,
      };
    });

    if (!afterCreate.currentImportId) errors.push("currentImportId not set after save");
    if (afterCreate.counts.itemCount !== 11) {
      errors.push(`After create: expected 11 items, got ${afterCreate.counts.itemCount}`);
    }

    await saveBtn.click();
    await page.waitForFunction(
      () => /Draft updated/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterUpdate = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const apiMod = await import("/js/admin/parcelImports/api/parcelImportsApi.js");
      const s = stateMod.getState();
      const counts = await apiMod.fetchImportSmokeCounts(s.currentImportId);
      return { currentImportId: s.currentImportId, counts };
    });

    if (afterUpdate.counts.itemCount !== 11) {
      errors.push(`After update: item count duplicated to ${afterUpdate.counts.itemCount}`);
    }
    if (afterUpdate.counts.allocationCount !== 11) {
      errors.push(`After update: allocation count ${afterUpdate.counts.allocationCount}`);
    }

    await page.waitForFunction(
      () => document.querySelectorAll("#parcelHistoryTbody [data-open-draft]").length > 0,
      { timeout: 15000 },
    );

    const historyCount = await page.locator("#parcelHistoryTbody [data-open-draft]").count();
    if (historyCount < 1) errors.push("History table empty after save");

    const importId = afterUpdate.currentImportId;

    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => !document.getElementById("parcelDuplicateWarning")?.classList.contains("hidden"),
      { timeout: 10000 },
    );

    const dupVisible = await page.locator("#parcelDuplicateWarning").isVisible();
    if (!dupVisible) {
      errors.push("Duplicate warning not shown after re-uploading same parcel/file");
    }

    const openDraftBtn = page.locator(`[data-open-draft="${importId}"]`);
    if (await openDraftBtn.count()) {
      await openDraftBtn.click();
    } else {
      await page.evaluate(async (id) => {
        const { openDraft } = await import("/js/admin/parcelImports/ui/historyTable.js");
        await openDraft(id);
      }, importId);
    }
    await page.waitForFunction(
      () => /Opened parcel/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterLoad = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const s = stateMod.getState();
      return {
        currentImportId: s.currentImportId,
        itemCount: s.items?.length ?? 0,
        parcelId: s.parcel?.parcelId,
        mappingCount: s.rowMappings?.length ?? 0,
      };
    });

    if (afterLoad.itemCount !== 11) {
      errors.push(`Open draft: expected 11 items, got ${afterLoad.itemCount}`);
    }
    if (afterLoad.mappingCount !== 11) {
      errors.push(`Open draft: expected 11 mappings, got ${afterLoad.mappingCount}`);
    }
    if (afterLoad.currentImportId !== importId) {
      errors.push("Open draft did not restore currentImportId");
    }

    console.log("\n=== Phase 6B verification ===\n");
    console.log("Create:", afterCreate);
    console.log("Update:", afterUpdate);
    console.log("Open draft:", afterLoad);
    console.log("History rows:", historyCount);
    console.log("Duplicate warning visible:", dupVisible);

    if (errors.length) {
      console.log("\nFAILED:");
      errors.forEach((e) => console.log(" -", e));
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
