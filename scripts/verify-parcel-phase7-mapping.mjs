/**
 * Phase 7 product/variant mapping + memory verification.
 * Run: node scripts/verify-parcel-phase7-mapping.mjs
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
const PORT = 9884;
const TEST_PRODUCT_ID = "a53c9740-63d6-4a18-a4b2-636dcfe36624";
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

  try {
    await signInWithMagicLink(page, env);
    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );

    const search = page.locator('[data-product-search][data-mapping-row="1"]');
    await search.fill("8-Ball");
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
    await page.waitForTimeout(300);

    const mappingState = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const row = stateMod.getState().rowMappings.find((r) => r.rowNumber === 1);
      return {
        productId: row?.productId,
        productVariantId: row?.productVariantId,
        mappingStatus: row?.mappingStatus,
        mappedProductLabel: row?.mappedProductLabel,
      };
    });

    if (!mappingState.productId) {
      errors.push("Row 1 productId not set after product search");
    }
    if (!mappingState.productVariantId) {
      errors.push("Row 1 productVariantId not set after variant select");
    }
    if (mappingState.mappingStatus !== "Matched") {
      errors.push(`Expected Matched, got ${mappingState.mappingStatus}`);
    }

    const searchResult = await page.evaluate(async () => {
      const api = await import("/js/admin/parcelImports/api/productsApi.js");
      const rows = await api.searchProducts("8-Ball");
      return rows.slice(0, 3).map((r) => ({ id: r.id, name: r.name, code: r.code }));
    });

    if (!searchResult.length) errors.push("searchProducts returned no rows");

    const saveBtn = page.locator('[data-parcel-action="save-draft"]').first();
    await saveBtn.click();
    await page.waitForFunction(
      () => /Draft saved/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterSave = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const apiMod = await import("/js/admin/parcelImports/api/parcelImportsApi.js");
      const s = stateMod.getState();
      const importId = s.currentImportId;
      const { data } = await (await import("https://esm.sh/@supabase/supabase-js@2"))
        .createClient(
          (await import("/js/config/env.js")).SUPABASE_URL,
          (await import("/js/config/env.js")).SUPABASE_ANON_KEY,
        )
        .from("parcel_import_item_mappings")
        .select("product_id, product_variant_id, mapped_product_label")
        .eq("parcel_import_id", importId)
        .limit(20);
      const counts = await apiMod.fetchImportSmokeCounts(importId);
      return { importId, mappings: data, counts, row1: s.rowMappings.find((r) => r.rowNumber === 1) };
    });

    const savedMapping = afterSave.mappings?.find((m) => m.product_id);
    if (!savedMapping?.product_id) {
      errors.push("DB mapping missing product_id after save");
    }
    if (!savedMapping?.product_variant_id) {
      errors.push("DB mapping missing product_variant_id after save");
    }
    if (afterSave.counts.itemCount !== 11) {
      errors.push(`Save item count ${afterSave.counts.itemCount}`);
    }

    await saveBtn.click();
    await page.waitForFunction(
      () => /Draft updated/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 20000 },
    );

    const afterUpdate = await page.evaluate(async (importId) => {
      const apiMod = await import("/js/admin/parcelImports/api/parcelImportsApi.js");
      return apiMod.fetchImportSmokeCounts(importId);
    }, afterSave.importId);

    if (afterUpdate.itemCount !== 11) {
      errors.push(`Update duplicated items to ${afterUpdate.itemCount}`);
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

    const afterLoad = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const row = stateMod.getState().rowMappings.find((r) => r.rowNumber === 1);
      const input = document.querySelector('[data-product-search][data-mapping-row="1"]');
      const variant = document.querySelector('[data-variant-select][data-mapping-row="1"]');
      return {
        productId: row?.productId,
        productVariantId: row?.productVariantId,
        productInput: input?.value,
        variantValue: variant?.value,
      };
    });

    if (afterLoad.productId !== mappingState.productId) {
      errors.push("Open draft did not restore productId");
    }
    if (afterLoad.productVariantId !== mappingState.productVariantId) {
      errors.push("Open draft did not restore productVariantId");
    }

    process.env.SUPABASE_DB_PASSWORD =
      env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
    const pgClient = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    let memoryCount = 0;
    try {
      await pgClient.connect();
      const { rows } = await pgClient.query(
        `SELECT COUNT(*)::int AS c FROM parcel_mapping_memory WHERE product_id = $1`,
        [TEST_PRODUCT_ID],
      );
      memoryCount = rows?.[0]?.c ?? 0;
    } finally {
      await pgClient.end().catch(() => {});
    }

    console.log("\n=== Phase 7 mapping verification ===\n");
    console.log("Product search:", searchResult);
    console.log("Mapping state:", mappingState);
    console.log("After save DB:", afterSave);
    console.log("After update counts:", afterUpdate);
    console.log("After open draft:", afterLoad);
    console.log("Mapping memory rows for product:", memoryCount);

    if (memoryCount < 1) {
      errors.push("Mapping memory row not created after save");
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
