/**
 * Phase 4 CPI preview verification.
 * Run: node scripts/verify-parcel-phase4.mjs
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
const PORT = 9880;

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
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function getPreview(page) {
  return page.evaluate(async () => {
    const stateMod = await import("/js/admin/parcelImports/state.js");
    const cpiMod = await import("/js/admin/parcelImports/cpi/cpiPreview.js");
    const s = stateMod.getState();
    return cpiMod.buildCpiPreview({
      parcel: s.parcel,
      items: s.items,
      overrides: s.overrides,
      rowMappings: s.rowMappings,
    });
  });
}

async function main() {
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://127.0.0.1:${PORT}/pages/admin/parcelImports.html`);
    await page.locator("#parcelFileInput").setInputFiles(FIXTURE);
    await page.waitForFunction(() =>
      /Parsed 11 row/i.test(document.getElementById("parcelUploadStatus")?.textContent || ""),
    );

    let preview = await getPreview(page);
    if (preview.rows.length !== 11) {
      errors.push(`Expected 11 CPI rows, got ${preview.rows.length}`);
    }
    if (preview.summary.weightedAverageLandedCpiUsd != null) {
      errors.push("Before FX: USD should be null in preview");
    }
    const landedText = await page.locator('[data-field="cpiLandedPreview"]').textContent();
    if (landedText?.includes("$")) {
      errors.push(`Before FX: landed preview should not show USD: ${landedText}`);
    }
    const warnings = await page.locator("#parcelCpiWarnings").textContent();
    if (!/Missing FX rate/i.test(warnings || "")) {
      errors.push("Missing FX warning not shown");
    }
    if (preview.summary.productsAffected !== 0) {
      errors.push(`Before match: productsAffected should be 0, got ${preview.summary.productsAffected}`);
    }

    preview = await getPreview(page);
    const previewLowShip = preview.summary.weightedAverageLandedCpiCny;
    if (previewLowShip == null) {
      errors.push("Initial CPI CNY should be available for business rows");
    }

    await page.locator('[data-override-key="effectiveFxRate"]').fill("7.21");
    await page.locator('[data-override-key="effectiveFxRate"]').dispatchEvent("input");
    await page.waitForTimeout(150);

    preview = await getPreview(page);
    if (preview.summary.effectiveFxRate == null) {
      errors.push("FX rate not applied after override");
    }

    await page.locator('[data-override-key="shipmentFeeCny"]').fill("1180");
    await page.locator('[data-override-key="shipmentFeeCny"]').dispatchEvent("input");
    await page.waitForTimeout(150);

    preview = await getPreview(page);
    const previewHighShip = preview.summary.weightedAverageLandedCpiCny;
    if (previewHighShip == null || previewLowShip == null) {
      errors.push("CPI CNY null after shipment override");
    } else if (previewHighShip <= previewLowShip) {
      errors.push(`Shipment increase should raise CPI: ${previewLowShip} -> ${previewHighShip}`);
    }

    const personalType = page.locator('[data-mapping-field="rowType"]').first();
    await personalType.selectOption("Personal / Excluded");
    await page.waitForTimeout(100);
    preview = await getPreview(page);
    if (preview.summary.personalRows < 1) errors.push("Personal row not counted");
    if (preview.summary.rowsExcluded < 1) errors.push("Rows excluded not updated");
    const allocSum = preview.rows.reduce((s, r) => s + r.parcelShippingShareCny, 0);
    if (Math.abs(allocSum - 1180) > 0.05) {
      errors.push(`Shipment allocation sum ${allocSum} != 1180`);
    }

    await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const tableMod = await import("/js/admin/parcelImports/ui/itemMappingTable.js");
      stateMod.updateRowMappingField(2, "mappedProductLabel", "Cosmic Bear Charm Keychain");
      stateMod.updateRowMappingField(2, "mappedVariantLabel", "Blue / Purple");
      tableMod.renderItemMappingTable(stateMod.getState().items);
    });
    await page.waitForTimeout(100);
    preview = await getPreview(page);
    if (preview.summary.productsAffected < 1) {
      errors.push("Matched row should increase productsAffected");
    }
    if (preview.summary.readyToUpdate) {
      errors.push("Ready to update should be false with other unmapped rows");
    }

    await page.evaluate(async () => {
      const stateMod = await import("/js/admin/parcelImports/state.js");
      const tableMod = await import("/js/admin/parcelImports/ui/itemMappingTable.js");
      stateMod.updateRowMappingField(2, "mappedVariantLabel", "Unknown");
      tableMod.renderItemMappingTable(stateMod.getState().items);
    });
    await page.waitForTimeout(100);
    preview = await getPreview(page);
    if (preview.summary.variantUncertainRows < 1) {
      errors.push("Unknown variant should count as variant uncertain");
    }

    console.log("\n=== Phase 4 CPI verification ===\n");
    const initial = await page.evaluate(async () => {
      const cpiMod = await import("/js/admin/parcelImports/cpi/cpiPreview.js");
      const s = (await import("/js/admin/parcelImports/state.js")).getState();
      return cpiMod.buildCpiPreview({
        parcel: s.parcel,
        items: s.items,
        overrides: { ...s.overrides, shipmentFeeCny: 585, effectiveFxRate: null },
        rowMappings: s.rowMappings,
      }).summary;
    });

    console.log("Rows:", preview.rows.length);
    console.log("Sample before FX (shipment ¥585):", {
      weightedCpiCny: initial.weightedAverageLandedCpiCny?.toFixed(2),
      weightedCpiUsd: initial.weightedAverageLandedCpiUsd,
    });
    console.log("Before FX warnings include FX:", /Missing FX rate/i.test(warnings || ""));
    console.log("After FX rate:", preview.summary.effectiveFxRate);
    console.log("After shipment 1180 weighted CPI CNY:", previewHighShip);
    console.log("Personal rows:", preview.summary.personalRows, "Excluded:", preview.summary.rowsExcluded);
    console.log("Products affected:", preview.summary.productsAffected);
    console.log("Ready to update:", preview.summary.readyToUpdate);
    console.log("Variant uncertain:", preview.summary.variantUncertainRows);

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
