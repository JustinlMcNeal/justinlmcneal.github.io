/**
 * Phase 10 polish verification.
 * Run: node scripts/verify-parcel-phase10-polish.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";
import { goToParcelTab } from "./verify-parcel-tabHelpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE = join(
  ROOT,
  "docs/pages/admin/parcelImport/fixtures/sample_baestao_waybill_227461.xls",
);
const PORT = 9887;

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

    const kpisIdle = await page.evaluate(() => ({
      total: document.querySelector('#parcelImportStats [data-field="kpiTotalImports"]')
        ?.textContent,
      parcelId: document.querySelector('[data-field="parcelId"]')?.textContent,
    }));
    if (kpisIdle.total !== "—") errors.push(`KPI should be idle on load, got ${kpisIdle.total}`);
    if (kpisIdle.parcelId !== "—") errors.push("Parcel summary should be blank on load");

    await goToParcelTab(page, "parcelTabUpload");
    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );

    const kpisAfterParse = await page.evaluate(() => ({
      total: document.querySelector('[data-field="kpiTotalImports"]')?.textContent,
      unmapped: document.querySelector('[data-field="kpiUnmappedRows"]')?.textContent,
    }));
    if (kpisAfterParse.total !== "11") {
      errors.push(`KPI rows after parse expected 11, got ${kpisAfterParse.total}`);
    }

    await page.locator('[data-parcel-action="save-draft"]').first().click();
    await page.waitForFunction(
      () => /Draft saved/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterSave = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      return { importId: stateMod.getState().currentImportId };
    });

    await page.locator('[data-parcel-action="new-import"]').first().click();
    await page.waitForFunction(
      () =>
        document.querySelector('#parcelImportStats [data-field="kpiTotalImports"]')
          ?.textContent === "—",
      { timeout: 10000 },
    );

    const afterNew = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const s = stateMod.getState();
      const mappingRows = document.querySelectorAll("#parcelMappingTbody tr").length;
      return {
        importId: s.currentImportId,
        itemCount: s.items.length,
        mappingRows,
        uploadMessage: document.getElementById("parcelUploadStatus")?.textContent,
        kpiTotal: document.querySelector('#parcelImportStats [data-field="kpiTotalImports"]')
          ?.textContent,
      };
    });

    if (afterNew.importId) errors.push("New Import did not clear currentImportId");
    if (afterNew.itemCount > 0) errors.push("New Import did not clear items");
    if (afterNew.kpiTotal !== "—") errors.push(`New Import KPI not cleared: ${afterNew.kpiTotal}`);
    if (!/Upload a Baestao/i.test(afterNew.uploadMessage || "")) {
      errors.push("New Import upload state not reset");
    }

    await page.evaluate(async (importId) => {
      const { openDraft } = await import("/js/admin/parcelImports/ui/historyTable.js");
      await openDraft(importId);
    }, afterSave.importId);
    await page.waitForFunction(
      () => /Opened parcel/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterOpen = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const s = stateMod.getState();
      return {
        importId: s.currentImportId,
        itemCount: s.items.length,
        importStatus: s.importStatus,
        saveDisabled: document
          .querySelector('[data-parcel-action="save-draft"]')
          ?.hasAttribute("disabled"),
      };
    });

    if (!afterOpen.importId) errors.push("Open draft did not restore importId");
    if (afterOpen.itemCount !== 11) errors.push(`Open draft item count ${afterOpen.itemCount}`);

    const receiveDisabledOnDraft = await page.evaluate(
      () => document.getElementById("parcelReceiveInventoryBtn")?.disabled === true,
    );
    if (!receiveDisabledOnDraft && afterOpen.importStatus !== "approved") {
      errors.push("Receive Inventory should be disabled for non-approved import");
    }

    const approvedImportId = await page.evaluate(async () => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const { data } = await sb
        .from("parcel_imports")
        .select("id")
        .eq("status", "approved")
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.id ?? null;
    });
    if (approvedImportId) {
      await page.evaluate(async (id) => {
        const { openDraft } = await import("/js/admin/parcelImports/ui/historyTable.js");
        await openDraft(id);
      }, approvedImportId);
      await page.waitForTimeout(800);
      const approvedState = await page.evaluate(() => ({
        saveDisabled: document
          .querySelector('[data-parcel-action="save-draft"]')
          ?.hasAttribute("disabled"),
      }));
      if (!approvedState.saveDisabled) {
        errors.push("Save Draft not disabled on approved import");
      }
    }

    await goToParcelTab(page, "parcelTabHistory");
    const expenseLinked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#parcelHistoryTbody tr")];
      return rows.some((tr) => /Expense linked/i.test(tr.textContent || ""));
    });

    console.log("\n=== Phase 10 polish verification ===\n");
    const kpis = await page.evaluate(() => ({
      total: document.querySelector('[data-field="kpiTotalImports"]')?.textContent,
      approved: document.querySelector('[data-field="kpiApproved"]')?.textContent,
      needsReview: document.querySelector('[data-field="kpiUnmappedRows"]')?.textContent,
    }));

    console.log("KPIs idle:", kpisIdle);
    console.log("KPIs after parse:", kpis);
    console.log("After save importId:", afterSave.importId);
    console.log("After New Import:", afterNew);
    console.log("After Open:", afterOpen);
    console.log("History has expense linked:", expenseLinked);
    console.log("Receive Inventory disabled on draft:", receiveDisabledOnDraft);

    if (!expenseLinked) {
      errors.push("History table missing expense linked row (may be empty DB)");
    }

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
