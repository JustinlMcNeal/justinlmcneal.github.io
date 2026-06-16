/**
 * Phase 13 final UI polish + export/reporting verification.
 * Run: node scripts/verify-parcel-phase13-finalize.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
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
const PORT = 9888;

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

/** @param {import('@playwright/test').Page} page @param {"history"|"allocations"} kind */
async function runCsvExport(page, kind) {
  return page.evaluate(async (exportKind) => {
    const exportMod = await import("/js/admin/parcelImports/ui/exportActions.js");
    if (exportKind === "history") {
      return exportMod.handleExportHistory();
    }
    return exportMod.handleExportAllocations();
  }, kind);
}

function runSafetyGrep() {
  const parcelDir = join(ROOT, "js/admin/parcelImports");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk(parcelDir);

  const read = (p) => readFileSync(p, "utf8");
  const hits = {
    productCostWrites: [],
    stockWrites: [],
    stockLedgerWrites: [],
    expenseAutoOnApprove: [],
    approveFormulaClient: [],
  };

  const patterns = [
    {
      key: "productCostWrites",
      re: /\.(update|upsert)\([\s\S]{0,200}(unit_cost|unit_cost_override)/i,
    },
    { key: "stockWrites", re: /\.(update|upsert)\([^)]*stock|variant_stock/i },
    {
      key: "stockLedgerWrites",
      re: /stock_ledger.*\.(insert|update|upsert)|from\(["']stock_ledger["']\)/i,
    },
    {
      key: "expenseAutoOnApprove",
      re: /approve.*createExpense|handleCreateExpense.*approve/i,
    },
    {
      key: "approveFormulaClient",
      re: /weighted.*average|landed_cpi.*products/i,
    },
  ];

  for (const file of files) {
    const text = read(file);
    const rel = file.replace(ROOT + "\\", "").replace(ROOT + "/", "");
    for (const { key, re } of patterns) {
      if (re.test(text)) hits[key].push(rel);
    }
  }

  const receiveOnly = hits.stockLedgerWrites.filter(
    (f) => !f.includes("inventoryReceiveActions") && !f.includes("receive"),
  );

  return {
    productCostWrites: hits.productCostWrites,
    stockWrites: hits.stockWrites,
    stockLedgerWrites: receiveOnly.length ? receiveOnly : [],
    stockLedgerNote:
      hits.stockLedgerWrites.length && !receiveOnly.length
        ? "stock_ledger references only in receive flow"
        : null,
    expenseAutoOnApprove: hits.expenseAutoOnApprove,
    approveFormulaClient: hits.approveFormulaClient.filter(
      (f) => !f.includes("cpiPreview"),
    ),
    pass:
      !hits.productCostWrites.length &&
      !hits.stockWrites.length &&
      !receiveOnly.length &&
      !hits.expenseAutoOnApprove.length &&
      !hits.approveFormulaClient.filter((f) => !f.includes("cpiPreview")).length,
  };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const results = {
    exportHistory: null,
    exportAllocations: null,
    unlink: null,
    details: null,
    receivedFilter: null,
    tabs: null,
  };

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await signInWithMagicLink(page, env);
    await page.waitForTimeout(1500);

    const sessionOk = await page.evaluate(async () => {
      const { getState } = await import("/js/admin/parcelImports/state.js");
      const s = getState();
      return s.sessionReady && s.adminOk;
    });
    if (!sessionOk) errors.push("Admin session not ready after login");

    await goToParcelTab(page, "parcelTabHistory");

    const historyRowsBefore = await page.evaluate(() => {
      return document.querySelectorAll("#parcelHistoryTbody [data-open-draft]").length;
    });

    await page.locator("#parcelHistorySearchBtn").click();
    await page.waitForTimeout(800);

    results.exportHistory = await runCsvExport(page, "history");
    if (typeof results.exportHistory?.rowCount !== "number") {
      errors.push("History export did not return rowCount");
    }
    if (results.exportHistory?.rowCount < 1 && historyRowsBefore > 0) {
      errors.push("History export returned 0 rows while table has data");
    }

    await goToParcelTab(page, "parcelTabUpload");
    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );

    await page.locator('[data-parcel-action="save-draft"]').first().click();
    await page.waitForFunction(
      () => /Draft saved/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterSave = await page.evaluate(async () => {
      const { getState } = await import("/js/admin/parcelImports/state.js");
      const s = getState();
      return {
        importId: s.currentImportId,
        exportDisabled: document.getElementById("parcelExportAllocationsBtnHeader")
          ?.disabled,
        detailsDisabled: document.getElementById("parcelImportDetailsBtn")?.disabled,
      };
    });

    if (!afterSave.importId) errors.push("Save draft did not set importId");
    if (afterSave.exportDisabled) errors.push("Export allocations still disabled after open draft");
    if (afterSave.detailsDisabled) errors.push("Details button still disabled after open draft");

    results.exportAllocations = await runCsvExport(page, "allocations");
    if (typeof results.exportAllocations?.rowCount !== "number") {
      errors.push("Allocation export did not return rowCount");
    }
    if (results.exportAllocations?.rowCount !== 11) {
      errors.push(
        `Allocation export expected 11 rows, got ${results.exportAllocations?.rowCount}`,
      );
    }

    await page.evaluate(async (importId) => {
      const { openImportDetailsModal } = await import(
        "/js/admin/parcelImports/ui/importDetailsModal.js"
      );
      await openImportDetailsModal(importId);
    }, afterSave.importId);
    await page.waitForFunction(
      () => {
        const body = document.getElementById("parcelImportDetailsBody");
        return body && !/Loading import details/i.test(body.textContent || "");
      },
      { timeout: 15000 },
    );
    results.details = await page.evaluate(() => {
      const modal = document.getElementById("parcelImportDetailsModal");
      const body = document.getElementById("parcelImportDetailsBody");
      return {
        open: !modal?.classList.contains("hidden"),
        hasParcelId: /Parcel ID/i.test(body?.textContent || ""),
        hasTimeline: /Timeline/i.test(body?.textContent || ""),
        bodySnippet: (body?.textContent || "").slice(0, 200),
      };
    });
    if (!results.details.open) errors.push("Details modal did not open");
    if (!results.details.hasParcelId) errors.push("Details modal missing parcel ID");
    if (!results.details.hasTimeline) errors.push("Details modal missing timeline");

    await page.locator("[data-parcel-details-close]").first().click();

    const linkedImport = await page.evaluate(async () => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const { data } = await sb
        .from("parcel_imports")
        .select("id, expense_id, parcel_id")
        .not("expense_id", "is", null)
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    });

    if (linkedImport?.id) {
      await page.evaluate(async (importId) => {
        const { openDraft } = await import("/js/admin/parcelImports/ui/historyTable.js");
        await openDraft(importId);
      }, linkedImport.id);
      await page.waitForTimeout(1200);

      const unlinkVisible = await page.evaluate(
        () => !document.getElementById("parcelUnlinkExpenseBtn")?.classList.contains("hidden"),
      );
      if (!unlinkVisible) {
        errors.push("Unlink button not visible for expense-linked import");
      } else {
        page.once("dialog", (dialog) => dialog.accept());
        await goToParcelTab(page, "parcelTabCpi");
        await page.locator("#parcelUnlinkExpenseBtn").click();
        await page.waitForFunction(
          () => /unlinked/i.test(
            document.getElementById("parcelExpenseStatus")?.textContent || "",
          ),
          { timeout: 15000 },
        );

        const afterUnlink = await page.evaluate(async (importId) => {
          const { getState } = await import("/js/admin/parcelImports/state.js");
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
          const envMod = await import("/js/config/env.js");
          const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
          const { data } = await sb
            .from("parcel_imports")
            .select("expense_id")
            .eq("id", importId)
            .maybeSingle();
          return {
            stateExpenseId: getState().expenseId,
            dbExpenseId: data?.expense_id ?? null,
          };
        }, linkedImport.id);

        results.unlink = afterUnlink;
        if (afterUnlink.stateExpenseId || afterUnlink.dbExpenseId) {
          errors.push("Unlink did not clear expense_id");
        }

        if (env.SUPABASE_SERVICE_ROLE_KEY && linkedImport.expense_id) {
          const admin = createClient(
            env.SUPABASE_URL || "https://yxdzvzscufkvewecvagq.supabase.co",
            env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          await admin
            .from("parcel_imports")
            .update({ expense_id: linkedImport.expense_id })
            .eq("id", linkedImport.id);
        }
      }
    } else {
      results.unlink = { skipped: "No expense-linked import in DB" };
    }

    await goToParcelTab(page, "parcelTabHistory");
    await page.selectOption("#parcelHistoryReceivedFilter", "received");
    await page.locator("#parcelHistorySearchBtn").click();
    await page.waitForTimeout(800);

    results.receivedFilter = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#parcelHistoryTbody tr")];
      const dataRows = rows.filter((tr) => tr.querySelector("[data-open-draft]"));
      const receivedLabels = dataRows.map((tr) => tr.textContent || "");
      return {
        rowCount: dataRows.length,
        allMentionReceived: dataRows.every((tr) =>
          /received|Received/i.test(tr.textContent || ""),
        ),
        emptyMessage: document.querySelector("#parcelHistoryTbody")?.textContent || "",
      };
    });

    if (
      results.receivedFilter.rowCount > 0 &&
      !results.receivedFilter.allMentionReceived
    ) {
      errors.push("Received filter returned rows without received indicator");
    }

    results.tabs = await page.evaluate(() => {
      const historySelected =
        document.getElementById("parcelTabHistory")?.getAttribute("aria-selected") ===
        "true";
      const historyVisible = !document
        .getElementById("parcelImportHistory")
        ?.classList.contains("hidden");
      const uploadHidden = document
        .getElementById("parcelImportUploadSummary")
        ?.classList.contains("hidden");
      return { historySelected, historyVisible, uploadHidden };
    });
    if (!results.tabs.historySelected) {
      errors.push("History tab did not activate on click");
    }
    if (!results.tabs.historyVisible) {
      errors.push("History panel not visible when History tab active");
    }
    if (!results.tabs.uploadHidden) {
      errors.push("Upload panel should be hidden when History tab active");
    }

    const safety = runSafetyGrep();

    console.log("\n=== Phase 13 finalize verification ===\n");
    console.log("Session OK:", sessionOk);
    console.log("Export history:", results.exportHistory);
    console.log("Export allocations:", results.exportAllocations);
    console.log("Details panel:", results.details);
    console.log("Unlink:", results.unlink);
    console.log("Received filter:", results.receivedFilter);
    console.log("Tabs:", results.tabs);
    console.log("Safety grep:", safety);

    if (!safety.pass) errors.push("Safety grep found forbidden client patterns");

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
