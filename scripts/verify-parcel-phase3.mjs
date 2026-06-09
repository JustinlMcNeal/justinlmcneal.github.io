/**
 * Browser verification for Parcel Imports Phase 3 mapping + Phase 2 overrides.
 * Run: node scripts/verify-parcel-phase3.mjs
 */
import { chromium } from "@playwright/test";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE = join(
  ROOT,
  "docs/pages/admin/parcelImport/fixtures/sample_baestao_waybill_227461.xls",
);
const PORT = 9876;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".xls": "text/html",
};

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
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, () => resolve(server));
  });
}

function chipText(page, field) {
  return page.locator(`[data-field="${field}"]`).textContent();
}

async function main() {
  const errors = [];
  const consoleErrors = [];

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/pages/admin/parcelImports.html`, {
      waitUntil: "networkidle",
    });

    const fileInput = page.locator("#parcelFileInput");
    await fileInput.setInputFiles(FIXTURE);
    await page.waitForSelector("#parcelUploadStatus", { timeout: 10000 });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("parcelUploadStatus");
        return el && /Parsed 11 row/i.test(el.textContent || "");
      },
      { timeout: 10000 },
    );

    const chips = {
      imported: await chipText(page, "mapChipRowsImported"),
      matched: await chipText(page, "mapChipMatched"),
      variant: await chipText(page, "mapChipVariantUncertain"),
      personal: await chipText(page, "mapChipPersonalExcluded"),
      needMapping: await chipText(page, "mapChipNeedMapping"),
    };
    const kpi = await chipText(page, "kpiUnmappedRows");

    const expect1 = [
      ["imported", chips.imported, "11 rows imported"],
      ["matched", chips.matched, "0 matched"],
      ["variant", chips.variant, "0 variant uncertain"],
      ["personal", chips.personal, "0 personal / excluded"],
      ["needMapping", chips.needMapping, "11 need mapping"],
      ["kpi", kpi?.trim(), "11"],
    ];
    for (const [name, actual, expected] of expect1) {
      if ((actual || "").trim() !== expected) {
        errors.push(`Step 2 ${name}: expected "${expected}", got "${actual}"`);
      }
    }

    const firstType = page.locator('[data-mapping-field="rowType"]').first();
    await firstType.selectOption("Personal / Excluded");
    await page.waitForTimeout(100);

    const chips2 = {
      personal: await chipText(page, "mapChipPersonalExcluded"),
      needMapping: await chipText(page, "mapChipNeedMapping"),
    };
    const kpi2 = await chipText(page, "kpiUnmappedRows");
    if ((chips2.personal || "").trim() !== "1 personal / excluded") {
      errors.push(`Step 4 personal: got "${chips2.personal}"`);
    }
    if ((chips2.needMapping || "").trim() !== "10 need mapping") {
      errors.push(`Step 4 need mapping: got "${chips2.needMapping}"`);
    }
    if ((kpi2 || "").trim() !== "10") {
      errors.push(`Step 4 KPI: expected "10", got "${kpi2}"`);
    }

    await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const tableMod = await import("/js/admin/parcelImports/ui/itemMappingTable.js");
      stateMod.updateRowMappingField(2, "mappedProductLabel", "Cosmic Bear Charm Keychain");
      stateMod.updateRowMappingField(2, "mappedVariantLabel", "Blue / Purple");
      tableMod.renderItemMappingTable(stateMod.getState().items);
    });
    await page.waitForTimeout(100);

    const matchedStatus = page
      .locator('tr[data-mapping-row]')
      .nth(1)
      .locator("[data-mapping-status]");
    const matchedText = (await matchedStatus.textContent())?.trim();
    if (matchedText !== "Matched") {
      errors.push(`Step 6: expected Matched, got "${matchedText}"`);
    }

    await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const tableMod = await import("/js/admin/parcelImports/ui/itemMappingTable.js");
      stateMod.updateRowMappingField(3, "mappedProductLabel", "Plush Mini Bag Charm");
      stateMod.updateRowMappingField(3, "mappedVariantLabel", "Unknown");
      tableMod.renderItemMappingTable(stateMod.getState().items);
    });
    await page.waitForTimeout(100);

    const variantStatus = page
      .locator('tr[data-mapping-row]')
      .nth(2)
      .locator("[data-mapping-status]");
    const variantText = (await variantStatus.textContent())?.trim();
    if (variantText !== "Variant Uncertain") {
      errors.push(`Step 8: expected Variant Uncertain, got "${variantText}"`);
    }

    await page.locator("#parcelTabReview").click();
    const chargedInput = page.locator('[data-override-key="chargedWeightGrams"]');
    await chargedInput.scrollIntoViewIfNeeded();
    await chargedInput.click();
    await chargedInput.fill("");
    await chargedInput.pressSequentially("11260", { delay: 30 });
    await page.waitForTimeout(200);

    const overrideUi = await page.evaluate(async () => {
      const pill = document.querySelector('[data-override-edited="chargedWeightGrams"]');
      const hint = document.getElementById("parcelChargedWeightHint");
      const input = document.querySelector('[data-override-key="chargedWeightGrams"]');
      let stateSnapshot = null;
      try {
        const m = await import("/js/admin/parcelImports/state.js");
        const s = m.getState();
        stateSnapshot = {
          charged: s.overrides?.chargedWeightGrams,
          baselineCharged: s.xlsBaseline?.chargedWeightGrams,
          dirtyFields: s.overrides?.dirtyFields,
        };
      } catch (_) {
        stateSnapshot = { error: "import failed" };
      }
      return {
        chargedValue: input?.value,
        pillHidden: pill?.classList.contains("hidden"),
        hintHidden: hint?.hidden,
        hintText: hint?.textContent?.trim(),
        stateSnapshot,
      };
    });

    if (overrideUi.chargedValue !== "11260") {
      errors.push(`Step 9: charged input value "${overrideUi.chargedValue}"`);
    }
    if (overrideUi.pillHidden) {
      errors.push("Step 9: charged weight Edited pill still hidden");
    }
    if (overrideUi.hintHidden) {
      errors.push("Step 9: volume-weight hint still hidden for 11260g");
    }

    const invalidErrors = consoleErrors.filter((e) =>
      /InvalidCharacterError|classList/i.test(e),
    );
    if (invalidErrors.length) {
      errors.push(`Step 9 console: ${invalidErrors.join("; ")}`);
    }

    console.log("\n=== Parcel Phase 3 verification ===\n");
    console.log("Step 1: Upload fixture — OK");
    console.log("Step 2 chips:", chips, "KPI:", kpi?.trim());
    console.log("Step 4 after Personal:", chips2, "KPI:", kpi2?.trim());
    console.log("Step 6 row 2 status:", matchedText);
    console.log("Step 8 row 3 status:", variantText);
    console.log("Step 9 override UI:", overrideUi);
    console.log("Console errors:", consoleErrors.length ? consoleErrors : "(none)");

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

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
