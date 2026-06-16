/**
 * Phase 8 approve + CPI verification.
 * Run: node scripts/verify-parcel-phase8-approve-cpi.mjs
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
const PORT = 9885;
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

function computeExpectedVariantCents({ costBefore, landedUsd, importedQty }) {
  if (landedUsd == null || !Number.isFinite(landedUsd)) return null;
  const stock = costBefore?.stock ?? 0;
  const qty = importedQty ?? 0;
  let oldCost = null;
  if (costBefore?.unit_cost_override_cents != null) {
    oldCost = costBefore.unit_cost_override_cents / 100;
  }
  let newAvg = landedUsd;
  if (oldCost != null && stock > 0 && qty > 0) {
    newAvg = (oldCost * stock + landedUsd * qty) / (stock + qty);
  }
  return Math.round(newAvg * 100);
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

  let costBefore = null;
  let costAfter = null;
  let importId = null;

  try {
    await signInWithMagicLink(page, env);

    process.env.SUPABASE_DB_PASSWORD =
      env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
    const pgClient = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();
    const { rows: costRows } = await pgClient.query(
      `SELECT unit_cost_override_cents, stock FROM product_variants WHERE id = $1`,
      [TEST_VARIANT_ID],
    );
    costBefore = costRows[0] ?? null;
    await pgClient.end();

    await goToParcelTab(page, "parcelTabUpload");
    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(
      () => /Parsed 11 row/i.test(
        document.getElementById("parcelUploadStatus")?.textContent || "",
      ),
      { timeout: 15000 },
    );

    await goToParcelTab(page, "parcelTabMap");
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

    const preApprove = await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const s = stateMod.getState();
      return { importId: s.currentImportId, importStatus: s.importStatus };
    });

    importId = preApprove.importId;
    if (preApprove.importStatus !== "ready_to_approve") {
      errors.push(`Expected ready_to_approve after save, got ${preApprove.importStatus}`);
    }

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-parcel-action="approve-cpi"]');
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );

    const approveBtn = page.locator('[data-parcel-action="approve-cpi"]').first();
    await approveBtn.click();
    await page.waitForFunction(
      () => /Approved/i.test(
        document.getElementById("parcelActionStatus")?.textContent || "",
      ),
      { timeout: 30000 },
    );

    const postApprove = await page.evaluate(async (id) => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const envMod = await import("/js/config/env.js");
      const sb = createClient(envMod.SUPABASE_URL, envMod.SUPABASE_ANON_KEY);
      const header = await sb
        .from("parcel_imports")
        .select("status, approved_at, cpi_update_applied_at")
        .eq("id", id)
        .single();
      const preview = await sb
        .from("parcel_import_cost_allocations")
        .select("id", { count: "exact", head: true })
        .eq("parcel_import_id", id)
        .eq("allocation_run_type", "preview");
      const final = await sb
        .from("parcel_import_cost_allocations")
        .select("id", { count: "exact", head: true })
        .eq("parcel_import_id", id)
        .eq("allocation_run_type", "final");
      const events = await sb
        .from("parcel_import_events")
        .select("event_type")
        .eq("parcel_import_id", id)
        .order("created_at", { ascending: true });
      const variant = await sb
        .from("product_variants")
        .select("unit_cost_override_cents")
        .eq("id", "a76174c5-698c-402a-9d82-6f40c69c04bb")
        .single();
      const item = await sb
        .from("parcel_import_items")
        .select("id, quantity")
        .eq("parcel_import_id", id)
        .eq("row_number", 1)
        .single();
      const finalAlloc = item.data?.id
        ? await sb
            .from("parcel_import_cost_allocations")
            .select("landed_cpi_usd, landed_cpi_cny, effective_fx_rate")
            .eq("parcel_import_item_id", item.data.id)
            .eq("allocation_run_type", "final")
            .maybeSingle()
        : { data: null };
      let landedUsd = finalAlloc.data?.landed_cpi_usd ?? null;
      if (
        landedUsd == null &&
        finalAlloc.data?.landed_cpi_cny != null &&
        finalAlloc.data?.effective_fx_rate > 0
      ) {
        landedUsd =
          finalAlloc.data.landed_cpi_cny / finalAlloc.data.effective_fx_rate;
      }
      const saveDisabled = document
        .querySelector('[data-parcel-action="save-draft"]')
        ?.hasAttribute("disabled");
      return {
        header: header.data,
        previewCount: preview.count,
        finalCount: final.count,
        events: (events.data ?? []).map((e) => e.event_type),
        variantCost: variant.data?.unit_cost_override_cents,
        landedUsd,
        importedQty: item.data?.quantity ?? 0,
        saveDisabled,
      };
    }, importId);

    costAfter = { unit_cost_override_cents: postApprove.variantCost };

    if (postApprove.header?.status !== "approved") {
      errors.push(`Import status ${postApprove.header?.status}`);
    }
    if (!postApprove.header?.approved_at) {
      errors.push("approved_at not set");
    }
    if (!postApprove.header?.cpi_update_applied_at) {
      errors.push("cpi_update_applied_at not set");
    }
    if (postApprove.previewCount !== 11) {
      errors.push(`Preview allocations ${postApprove.previewCount}`);
    }
    if (postApprove.finalCount !== 11) {
      errors.push(`Final allocations ${postApprove.finalCount}`);
    }
    if (!postApprove.events.includes("approved")) {
      errors.push("Missing approved event");
    }
    if (!postApprove.events.includes("cpi_update_applied")) {
      errors.push("Missing cpi_update_applied event");
    }
    if (!postApprove.saveDisabled) {
      errors.push("Save Draft not disabled after approval");
    }
    if (postApprove.variantCost == null) {
      errors.push("Variant unit_cost_override_cents not set after approval");
    } else {
      const expectedCents = computeExpectedVariantCents({
        costBefore,
        landedUsd: postApprove.landedUsd,
        importedQty: postApprove.importedQty,
      });
      const changed =
        costBefore?.unit_cost_override_cents == null ||
        postApprove.variantCost !== costBefore.unit_cost_override_cents;
      const matchesTarget =
        expectedCents != null && postApprove.variantCost === expectedCents;
      if (!changed && !matchesTarget) {
        errors.push(
          `Variant cost ${postApprove.variantCost} unchanged and does not match expected ${expectedCents}`,
        );
      }
      if (expectedCents == null) {
        errors.push("Could not derive expected variant cost from final allocation");
      }
    }

    const saveBlocked =
      postApprove.saveDisabled &&
      (await page.evaluate(() => {
        const status = document.getElementById("parcelActionStatus")?.textContent || "";
        return /approved|cannot be edited|CPI applied|disabled/i.test(status);
      }));
    if (!saveBlocked) {
      errors.push("Save Draft should fail on approved import");
    }

    const pg2 = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    await pg2.connect();
    const { rows: itemRows } = await pg2.query(
      `SELECT COUNT(*)::int AS c FROM parcel_import_items WHERE parcel_import_id = $1`,
      [importId],
    );
    await pg2.end();
    if (itemRows[0]?.c !== 11) {
      errors.push(`Item count after approve ${itemRows[0]?.c}`);
    }

    console.log("\n=== Phase 8 approve CPI verification ===\n");
    console.log("Import ID:", importId);
    console.log("Cost before:", costBefore);
    console.log("Cost after:", costAfter);
    console.log("Post approve:", postApprove);

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
