/**
 * Phase 11 receive inventory verification.
 * Run: node scripts/verify-parcel-phase11-receive-inventory.mjs
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
const PORT = 9888;
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

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let stockBefore = null;
  let stockAfterFirst = null;
  let stockAfterSecond = null;
  let importId = null;
  let receivableQty = null;
  let ledgerRow = null;

  try {
    await signInWithMagicLink(page, env);

    process.env.SUPABASE_DB_PASSWORD =
      env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
    const pgClient = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();
    const { rows: stockRows } = await pgClient.query(
      `SELECT stock FROM product_variants WHERE id = $1`,
      [TEST_VARIANT_ID],
    );
    stockBefore = stockRows[0]?.stock ?? 0;
    await pgClient.end();

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

    await page.locator('[data-parcel-action="save-draft"]').first().click();
    await page.waitForFunction(
      () => /Draft saved/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    importId = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      return stateMod.getState().currentImportId;
    });

    receivableQty = await page.evaluate(async (id) => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const { data } = await sb
        .from("parcel_import_items")
        .select("quantity")
        .eq("parcel_import_id", id)
        .eq("row_number", 1)
        .single();
      return data?.quantity ?? 0;
    }, importId);

    if (!receivableQty || receivableQty <= 0) {
      errors.push(`Expected receivable qty on row 1, got ${receivableQty}`);
    }

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

    await page.waitForFunction(
      () => {
        const btn = document.getElementById("parcelReceiveInventoryBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );

    await page.locator("#parcelReceiveInventoryBtn").click();
    await page.waitForFunction(
      () => /Inventory received/i.test(
        document.getElementById("parcelInventoryReceiveStatus")?.textContent || "",
      ),
      { timeout: 30000 },
    );

    const afterFirst = await page.evaluate(async (id) => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const header = await sb
        .from("parcel_imports")
        .select("inventory_received_at, inventory_received_by")
        .eq("id", id)
        .single();
      const events = await sb
        .from("parcel_import_events")
        .select("event_type")
        .eq("parcel_import_id", id)
        .order("created_at", { ascending: true });
      const variant = await sb
        .from("product_variants")
        .select("stock")
        .eq("id", "a76174c5-698c-402a-9d82-6f40c69c04bb")
        .single();
      const ledger = await sb
        .from("stock_ledger")
        .select("variant_id, change, reason, reference_id, stock_before, stock_after")
        .eq("reference_id", id)
        .order("created_at", { ascending: false })
        .limit(1);
      return {
        header: header.data,
        events: (events.data ?? []).map((e) => e.event_type),
        stock: variant.data?.stock,
        ledger: ledger.data?.[0] ?? null,
        receiveDisabled: document.getElementById("parcelReceiveInventoryBtn")?.disabled,
        receiveLabel: document.getElementById("parcelReceiveInventoryBtn")?.textContent,
      };
    }, importId);

    stockAfterFirst = afterFirst.stock;

    if (!afterFirst.header?.inventory_received_at) {
      errors.push("inventory_received_at not set");
    }
    if (!afterFirst.events.includes("inventory_received")) {
      errors.push("Missing inventory_received event");
    }
    if (!afterFirst.ledger) {
      errors.push("No stock_ledger row for import");
    } else {
      ledgerRow = afterFirst.ledger;
      if (afterFirst.ledger.reason !== "parcel_receive") {
        errors.push(`Ledger reason ${afterFirst.ledger.reason}`);
      }
      if (afterFirst.ledger.change !== receivableQty) {
        errors.push(`Ledger change ${afterFirst.ledger.change} != qty ${receivableQty}`);
      }
    }
    if (stockAfterFirst !== stockBefore + receivableQty) {
      errors.push(
        `Stock ${stockAfterFirst} expected ${stockBefore + receivableQty} (before ${stockBefore})`,
      );
    }
    if (!afterFirst.receiveDisabled) {
      errors.push("Receive button should be disabled after receive");
    }

    await page.locator("#parcelReceiveInventoryBtn").click({ force: true });
    await page.waitForTimeout(500);

    const afterSecond = await page.evaluate(async (id) => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const variant = await sb
        .from("product_variants")
        .select("stock")
        .eq("id", "a76174c5-698c-402a-9d82-6f40c69c04bb")
        .single();
      const ledgerCount = await sb
        .from("stock_ledger")
        .select("id", { count: "exact", head: true })
        .eq("reference_id", id)
        .eq("reason", "parcel_receive");
      const api = await import("/js/admin/parcelImports/api/inventoryReceiveApi.js");
      let rpcResult = null;
      try {
        rpcResult = await api.receiveParcelImportInventory(id, {
          idempotencyKey: `receive-idem-${id}`,
        });
      } catch (err) {
        rpcResult = { error: err?.message };
      }
      return {
        stock: variant.data?.stock,
        ledgerCount: ledgerCount.count,
        rpcResult,
        statusText: document.getElementById("parcelInventoryReceiveStatus")?.textContent,
      };
    }, importId);

    stockAfterSecond = afterSecond.stock;

    if (stockAfterSecond !== stockAfterFirst) {
      errors.push(`Stock changed on second receive: ${stockAfterFirst} -> ${stockAfterSecond}`);
    }
    if (afterSecond.ledgerCount !== 1) {
      errors.push(`Expected 1 ledger row, got ${afterSecond.ledgerCount}`);
    }
    if (!afterSecond.rpcResult?.already_received) {
      errors.push("Second RPC should return already_received");
    }

    console.log("\n=== Phase 11 receive inventory verification ===\n");
    console.log("Import ID:", importId);
    console.log("Stock before:", stockBefore);
    console.log("Receivable qty:", receivableQty);
    console.log("Stock after first receive:", stockAfterFirst);
    console.log("Stock after idempotent retry:", stockAfterSecond);
    console.log("Ledger row:", ledgerRow);
    console.log("Idempotent RPC:", afterSecond.rpcResult);
    console.log("UI status:", afterSecond.statusText);

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

void main();
