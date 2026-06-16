#!/usr/bin/env node
/**
 * Diagnose why a KK product is missing from Ready to Push.
 * Usage: node scripts/supabase/diagnose-ready-to-push.mjs KK-1050
 */

import pg from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF = "yxdzvzscufkvewecvagq";
const __dirname = dirname(fileURLToPath(import.meta.url));

function getConnectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error("Set SUPABASE_DB_PASSWORD or SUPABASE_DB_URL");
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

const needle = process.argv[2] || "KK-1050";

const client = new pg.Client({
  connectionString: getConnectionString(),
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows: products } = await client.query(`
  SELECT id, code, name, is_active, price, category_id,
         primary_image_url IS NOT NULL OR catalog_image_url IS NOT NULL AS has_image
  FROM public.products
  WHERE code ILIKE $1 OR name ILIKE $2
  ORDER BY is_active DESC, code
  LIMIT 10
`, [needle, `%${needle.replace(/-/g, " ")}%`]);

console.log("\n=== Products ===");
console.log(JSON.stringify(products, null, 2));

for (const product of products) {
  const pid = product.id;

  const { rows: mappings } = await client.query(`
    SELECT id, amazon_listing_id, mapping_status, kk_sku, mapped_at, notes
    FROM public.amazon_listing_mappings
    WHERE kk_product_id = $1
    ORDER BY updated_at DESC
    LIMIT 10
  `, [pid]);

  const { rows: drafts } = await client.query(`
    SELECT id, draft_status, seller_sku, asin, updated_at
    FROM public.amazon_listing_drafts
    WHERE kk_product_id = $1
    ORDER BY updated_at DESC
    LIMIT 10
  `, [pid]);

  const { rows: inView } = await client.query(`
    SELECT kk_product_id, kk_sku, eligibility_status, eligibility_warnings, draft_status, has_active_draft
    FROM public.v_amazon_ready_to_push_products
    WHERE kk_product_id = $1
  `, [pid]);

  const { rows: stock } = await client.query(`
    SELECT COALESCE(SUM(stock) FILTER (WHERE is_active), 0) AS kk_stock
    FROM public.product_variants WHERE product_id = $1
  `, [pid]);

  const { rows: rank } = await client.query(`
    WITH ranked AS (
      SELECT kk_product_id, kk_sku,
        ROW_NUMBER() OVER (ORDER BY updated_at DESC NULLS LAST) AS rn
      FROM public.v_amazon_ready_to_push_products
    )
    SELECT rn FROM ranked WHERE kk_product_id = $1
  `, [pid]);

  console.log(`\n=== Diagnostics for ${product.code} (${product.name}) ===`);
  console.log("active:", product.is_active, "price:", product.price, "stock:", stock[0]?.kk_stock);
  console.log("mappings:", mappings.length ? mappings : "none");
  if (mappings.length) console.log(JSON.stringify(mappings, null, 2));
  console.log("drafts:", drafts.length ? drafts : "none");
  if (drafts.length) console.log(JSON.stringify(drafts, null, 2));
  console.log("in ready_to_push view:", inView.length ? inView[0] : "NO");
  if (inView[0]) console.log(JSON.stringify(inView[0], null, 2));
  console.log("rank in view (by updated_at):", rank[0]?.rn ?? "not in view");

  const { rows: listings } = await client.query(`
    SELECT al.id, al.seller_sku, al.asin, al.listing_status, al.amazon_sku_absent_at,
           m.mapping_status, m.notes, m.updated_at AS mapping_updated_at
    FROM public.amazon_listings al
    JOIN public.amazon_listing_mappings m ON m.amazon_listing_id = al.id
    WHERE m.kk_product_id = $1
    ORDER BY m.updated_at DESC
  `, [pid]);
  console.log("amazon listings linked:", listings.length ? listings : "none");
  if (listings.length) console.log(JSON.stringify(listings, null, 2));
  const submittedDraft = drafts.filter((d) => d.draft_status === "submitted");
  const mappedActive = mappings.filter((m) => m.mapping_status === "mapped");
  const submittedDraft = drafts.filter((d) => d.draft_status === "submitted");
  console.log("blockers:");
  if (!product.is_active) console.log("  - product inactive");
  if (mappedActive.length) console.log("  - still mapped:", mappedActive.map((m) => m.id).join(", "));
  if (submittedDraft.length) console.log("  - submitted draft:", submittedDraft.map((d) => d.id).join(", "));
  if (Number(stock[0]?.kk_stock || 0) <= 0) console.log("  - no stock (shows as blocked, not hidden)");
  if (!inView.length && !mappedActive.length && !submittedDraft.length && product.is_active) {
    console.log("  - unknown exclusion (check view SQL manually)");
  }
}

const { rows: viewCount } = await client.query(`SELECT COUNT(*)::int AS n FROM public.v_amazon_ready_to_push_products`);
console.log("\nTotal in ready_to_push view:", viewCount[0]?.n);

await client.end();
