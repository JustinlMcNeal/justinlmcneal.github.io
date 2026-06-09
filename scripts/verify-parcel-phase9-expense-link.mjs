/**
 * Phase 9 expense linkage verification.
 * Run: node scripts/verify-parcel-phase9-expense-link.mjs
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
const PORT = 9886;
const TEST_VARIANT_ID = "a76174c5-698c-402a-9d82-6f40c69c04bb";

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

async function prepareApprovedImport(page) {
  await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
  await page.waitForFunction(
    () => /Parsed 11 row/i.test(
      document.getElementById("parcelUploadStatus")?.textContent || "",
    ),
    { timeout: 15000 },
  );

  await page.locator('[data-product-search][data-mapping-row="1"]').fill("8-Ball");
  await page.waitForSelector('[data-pick-product][data-mapping-row="1"]', {
    timeout: 15000,
  });
  await page.locator('[data-pick-product][data-mapping-row="1"]').first().click();
  await page.waitForFunction(
    () => {
      const sel = document.querySelector('[data-variant-select][data-mapping-row="1"]');
      return sel && !sel.disabled && sel.options.length > 2;
    },
    { timeout: 15000 },
  );
  await page.locator('[data-variant-select][data-mapping-row="1"]').selectOption(
    TEST_VARIANT_ID,
  );

  await page.evaluate(async () => {
    const stateMod = await import("/js/admin/parcelImports/state.js");
    const { ROW_TYPE } = await import("/js/admin/parcelImports/constants.js");
    stateMod.updateOverrideField("effectiveFxRate", 7.21);
    for (let row = 2; row <= 11; row++) {
      stateMod.updateRowMappingField(row, "rowType", ROW_TYPE.PERSONAL);
    }
  });

  const saveBtn = page.locator('[data-parcel-action="save-draft"]').first();
  await saveBtn.click();
  await page.waitForFunction(
    () => /Draft saved/i.test(
      document.getElementById("parcelActionStatus")?.textContent || "",
    ),
    { timeout: 20000 },
  );

  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-parcel-action="approve-cpi"]');
      return btn && !btn.disabled;
    },
    { timeout: 20000 },
  );

  await page.locator('[data-parcel-action="approve-cpi"]').first().click();
  await page.waitForFunction(
    () => /Approved/i.test(
      document.getElementById("parcelActionStatus")?.textContent || "",
    ),
    { timeout: 30000 },
  );

  return page.evaluate(async () => {
    const stateMod = await import("/js/admin/parcelImports/state.js");
    return stateMod.getState().currentImportId;
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
    const importId = await prepareApprovedImport(page);

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-parcel-action="create-expense"]');
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );

    await page.locator('[data-parcel-action="create-expense"]').first().click();
    await page.waitForFunction(
      () => /Expense (created|linked)/i.test(
        document.getElementById("parcelExpenseStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    await page.waitForFunction(
      () => [...document.querySelectorAll("#parcelHistoryTbody tr")].some((tr) =>
        /Expense linked/i.test(tr.textContent || ""),
      ),
      { timeout: 20000 },
    );

    const afterCreate = await page.evaluate(async (id) => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const header = await sb
        .from("parcel_imports")
        .select("expense_id, actual_total_charge_cny, effective_fx_rate, usd_equivalent, parcel_id, xls_total_items")
        .eq("id", id)
        .single();
      const events = await sb
        .from("parcel_import_events")
        .select("event_type, event_payload")
        .eq("parcel_import_id", id)
        .order("created_at", { ascending: true });
      let expense = null;
      if (header.data?.expense_id) {
        const exp = await sb
          .from("expenses")
          .select("id, amount_cents, category, vendor, description, notes")
          .eq("id", header.data.expense_id)
          .single();
        expense = exp.data;
      }
      const historyRow = [...document.querySelectorAll("#parcelHistoryTbody tr")]
        .find((tr) => /Expense linked/i.test(tr.textContent || ""));
      return {
        header: header.data,
        expense,
        events: events.data ?? [],
        historyShowsLinked: !!historyRow,
        expenseStatus: document.getElementById("parcelExpenseStatus")?.textContent,
      };
    }, importId);

    if (!afterCreate.header?.expense_id) {
      errors.push("parcel_imports.expense_id not set");
    }
    if (!afterCreate.expense) {
      errors.push("expenses row not found");
    }
    if (afterCreate.expense?.category !== "Inventory") {
      errors.push(`Expected Inventory category, got ${afterCreate.expense?.category}`);
    }
    if (afterCreate.expense?.vendor !== "Baestao") {
      errors.push(`Expected Baestao vendor, got ${afterCreate.expense?.vendor}`);
    }
    if (!afterCreate.events.some((e) => e.event_type === "expense_linked")) {
      errors.push("Missing expense_linked event");
    }
    if (!afterCreate.historyShowsLinked) {
      errors.push("History table does not show Linked expense");
    }

    const duplicate = await page.evaluate(async (id) => {
      const api = await import("/js/admin/parcelImports/api/expenseLinkApi.js");
      try {
        await api.createExpenseFromParcelImport(id);
        return { blocked: false };
      } catch (err) {
        return { blocked: true, message: err?.message || "" };
      }
    }, importId);

    if (!duplicate.blocked) {
      errors.push("Second create expense should have been blocked");
    } else if (!/already linked/i.test(duplicate.message)) {
      errors.push(`Unexpected duplicate message: ${duplicate.message}`);
    }

    console.log("\n=== Phase 9 expense linkage verification ===\n");
    console.log("Import ID:", importId);
    console.log("Header:", afterCreate.header);
    console.log("Expense:", afterCreate.expense);
    console.log("Amount calculation:", {
      usd_equivalent: afterCreate.header?.usd_equivalent,
      cny: afterCreate.header?.actual_total_charge_cny,
      fx: afterCreate.header?.effective_fx_rate,
      amount_cents: afterCreate.expense?.amount_cents,
    });
    console.log("Events:", afterCreate.events.map((e) => e.event_type));
    console.log("UI status:", afterCreate.expenseStatus);
    console.log("Duplicate block:", duplicate);

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
