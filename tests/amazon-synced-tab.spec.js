import { test, expect } from "@playwright/test";

const MOCK_LISTING = {
  amazon_listing_id: "11111111-1111-4111-8111-111111111111",
  seller_account_id: "22222222-2222-4222-8222-222222222222",
  marketplace_id: "ATVPDKIKX0DER",
  seller_sku: "REAL-SKU-001",
  asin: "B0REALTEST1",
  amazon_title: "Live Test Listing",
  kk_product_title: "Live KK Product",
  kk_sku: "KK-001",
  kk_stock: 5,
  listing_status: "active",
  mapping_status: "mapped",
  price: 19.99,
  fbm_quantity: 3,
  last_synced_at: "2026-05-30T18:00:00.000Z",
  open_issue_count: 0,
  is_stale: false,
};

test.describe("Amazon admin synced tab counts", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/js/shared/guard.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: 'export async function requireAdmin() { return { ok: true, reason: "" }; }',
      }),
    );

    await page.route("**/js/shared/adminNav.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "export async function initAdminNav() {}",
      }),
    );

    await page.route("**/rest/v1/rpc/is_admin", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "true" }),
    );

    await page.route("**/rest/v1/v_amazon_listing_workspace**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_LISTING]),
      }),
    );

    await page.route("**/rest/v1/v_amazon_unmapped_listings**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    await page.route("**/rest/v1/amazon_sync_runs**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    await page.route("**/functions/v1/amazon-auth-status**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          connected: true,
          tokenStatus: "active",
          sellerIdMasked: "A********CLW6",
        }),
      }),
    );
  });

  test("clears mock data and updates synced tab count from live fetch", async ({ page }) => {
    await page.goto("/pages/admin/amazon.html", { waitUntil: "networkidle" });

    await expect(page.locator("#amazonTabSynced [data-count]")).toHaveText("1", {
      timeout: 15000,
    });
    await expect(page.locator('#amazonStats [data-stat="total"] [data-value]')).toHaveText("1");
    await expect(page.locator("#amazonListingsBody tr")).toHaveCount(1);
    await expect(page.locator("#amazonListingsBody")).toContainText("Live Test Listing");
    await expect(page.locator("#amazonListingsBody")).not.toContainText("KK-TOTE-BLSH");
    await expect(page.locator("#amazonPaginationSummary")).toContainText("1");
  });
});
