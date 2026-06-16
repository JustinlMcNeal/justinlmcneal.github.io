#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const cache = await client.query(`
  SELECT schema_snapshot
  FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER'
    AND product_type = 'TOY_FIGURE'
  LIMIT 1
`);
const snap = cache.rows[0]?.schema_snapshot || {};
const snapText = JSON.stringify(snap);
const idx = snapText.indexOf("toy_figure_type");
console.log("toy_figure_type index:", idx);
if (idx >= 0) console.log(snapText.slice(Math.max(0, idx - 200), idx + 2500));

function walkEnums(obj, path = "") {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkEnums(v, `${path}[${i}]`));
    return;
  }
  if (obj.enum && Array.isArray(obj.enum) && path.includes("toy_figure_type")) {
    console.log("ENUM at", path, obj.enum);
  }
  for (const [k, v] of Object.entries(obj)) {
    walkEnums(v, path ? `${path}.${k}` : k);
  }
}
walkEnums(snap);

const listing = await client.query(`
  SELECT asin, seller_sku, product_type, raw_listing
  FROM amazon_listings
  WHERE asin = 'B0GVC2K467'
     OR product_type = 'TOY_FIGURE'
  ORDER BY CASE WHEN asin = 'B0GVC2K467' THEN 0 ELSE 1 END, updated_at DESC
  LIMIT 10
`);

for (const row of listing.rows) {
  const attrs = row.raw_listing?.attributes || row.raw_listing?.Attributes || {};
  const tft = attrs.toy_figure_type || attrs.ToyFigureType;
  if (tft) {
    console.log("\nListing", row.asin, row.seller_sku, "toy_figure_type:", JSON.stringify(tft));
  }
}

const draft = await client.query(`
  SELECT draft_payload->>'toy_figure_type' AS tft
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC
  LIMIT 1
`);
console.log("\nKK-1050 draft toy_figure_type:", draft.rows[0]?.tft);

await client.end();
