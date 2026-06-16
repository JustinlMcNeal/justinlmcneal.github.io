#!/usr/bin/env node
/**
 * Browser verification for Products CPI / margin display polish.
 * Run: node scripts/verify-products-cpi-browser.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";
import {
  computeProductMarginDisplay,
  formatVariantMarginRange,
} from "../js/admin/products/productMargin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9891;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
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
      if (urlPath === "/") urlPath = "/pages/admin/products.html";
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
  const redirectTo = `http://127.0.0.1:${PORT}/pages/admin/products.html`;
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

function staticOverrideRangeCheck(errors) {
  const mock = computeProductMarginDisplay({
    price: 2.5,
    weight_g: 80,
    unit_cost: 0.47,
    product_variants: [
      { is_active: true, unit_cost_override_cents: 70 },
      { is_active: true, unit_cost_override_cents: null },
    ],
  });
  const range = formatVariantMarginRange(mock.variantMin, mock.variantMax);
  if (!mock.hasVariantOverrides || !range) {
    errors.push("Static variant margin range utility check failed");
  } else {
    console.log(`Static variant range utility: Var ${range}`);
  }
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const consoleErrors = [];

  staticOverrideRangeCheck(errors);

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await signInWithMagicLink(page, env);

    await page.evaluate(() => {
      localStorage.setItem("adminProductsView", "table");
      const table = document.getElementById("desktopTableView");
      const cards = document.getElementById("desktopCardView");
      table?.classList.remove("hidden");
      cards?.classList.add("hidden");
    });

    await page.waitForFunction(
      () => document.querySelectorAll("#productRows tr").length > 0,
      { timeout: 30000 },
    );

    const headers = await page.evaluate(() => ({
      cpi: Array.from(document.querySelectorAll("th")).some((th) =>
        /CPI/i.test(th.textContent || ""),
      ),
      marginTitle: document.querySelector('[data-sort="margin"]')?.getAttribute("title") || "",
    }));
    if (!headers.cpi) errors.push("CPI column/header missing");
    if (!headers.marginTitle.includes("variant")) {
      errors.push(`Margin tooltip missing variant hint: ${headers.marginTitle}`);
    }
    console.log("Headers:", headers);

    const rowUi = await page.evaluate(() => {
      const tableMargin = document.querySelector("#productRows td")?.innerHTML || "";
      const hasDefault =
        /default/i.test(document.body.innerHTML) ||
        document.querySelector("#productRows .rounded-full") != null;
      const hasVarRange = /Var\s+\d+/i.test(document.body.innerHTML);
      return { hasDefault, hasVarRange, tableHasContent: tableMargin.length > 0 };
    });
    if (!rowUi.hasDefault && !rowUi.tableHasContent) {
      errors.push("No default margin badge or table margin content found");
    }
    console.log("Row UI:", rowUi);

    const hasEdit = await page.evaluate(() => {
      const btn = document.querySelector("#productRows [data-edit]");
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!hasEdit) {
      errors.push("No Edit button found in product table");
    } else {
      await page.waitForSelector("#profitProjectionsPanel:not(.hidden)", {
        timeout: 15000,
      });

      const modalUi = await page.evaluate(() => {
        const panel = document.getElementById("profitProjectionsPanel");
        const panelText = panel?.textContent || "";
        const hasDefaultLabel = /Default product estimate/i.test(panelText);
        const hasProfitPanelAttr =
          panel?.querySelector('[data-product-profit-panel="default-estimate"]') != null;
        const variantRows = document.querySelectorAll('#variantList [data-row="variant"]');
        const cpiSources = Array.from(
          document.querySelectorAll("#variantList [data-cpi-source]"),
        ).map((el) => el.getAttribute("data-cpi-source"));
        const cpiLabels = Array.from(variantRows).map((row) => row.textContent || "");
        const hasCpiLabel = cpiLabels.some((t) =>
          /Variant CPI|Product CPI|Missing CPI/i.test(t),
        );
        const hasMarginBadge = Array.from(variantRows).some((row) =>
          /%/.test(row.textContent || ""),
        );
        return {
          hasDefaultLabel,
          hasProfitPanelAttr,
          variantCount: variantRows.length,
          cpiSources,
          hasCpiLabel,
          hasMarginBadge,
        };
      });

      if (!modalUi.hasDefaultLabel) {
        errors.push("Modal profit panel missing 'Default product estimate' label");
      }
      if (!modalUi.hasProfitPanelAttr) {
        errors.push("Modal profit panel missing data-product-profit-panel attribute");
      }
      if (modalUi.variantCount > 0 && !modalUi.hasCpiLabel) {
        errors.push("Variant rows missing CPI source labels");
      }
      console.log("Modal UI:", modalUi);
    }

    const ignoredConsole = consoleErrors.filter(
      (e) =>
        !/favicon/i.test(e) &&
        !/Failed to load resource.*404/i.test(e) &&
        !/net::ERR_/i.test(e),
    );
    if (ignoredConsole.length) {
      errors.push(`Console errors: ${ignoredConsole.join(" | ")}`);
    } else {
      console.log("Console: no errors");
    }
  } catch (e) {
    errors.push(String(e.message || e));
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length) {
    console.error("\nFAILED:");
    errors.forEach((e) => console.error(" -", e));
    process.exitCode = 1;
    return;
  }
  console.log("\nProducts CPI browser verification passed.");
}

main();
