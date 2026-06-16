#!/usr/bin/env node
/** One-off: unmap KK-1050 for repush after absent listing left mapping active. */
import pg from "pg";

const PROJECT_REF = "yxdzvzscufkvewecvagq";
const PRODUCT_ID = "e8513dfa-fd6b-4b45-a861-fa2b441b86a7";
const LISTING_ID = "1d2b5d26-31c5-4038-b634-2449a644f601";

function getConnectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("Set SUPABASE_DB_PASSWORD");
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

const client = new pg.Client({
  connectionString: getConnectionString(),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const now = new Date().toISOString();

await client.query(`
  UPDATE public.amazon_listing_mappings
  SET mapping_status = 'legacy', updated_at = $1, notes = COALESCE(notes, 'Unmapped for repush')
  WHERE kk_product_id = $2 AND mapping_status = 'mapped'
`, [now, PRODUCT_ID]);

await client.query(`
  INSERT INTO public.amazon_listing_mappings (
    amazon_listing_id, kk_product_id, kk_sku, mapping_status, notes, updated_at
  )
  SELECT $1, NULL, NULL, 'ignored', 'Hidden for repush', $2
  WHERE NOT EXISTS (
    SELECT 1 FROM public.amazon_listing_mappings
    WHERE amazon_listing_id = $1 AND mapping_status = 'ignored'
  )
`, [LISTING_ID, now]);

const { rows } = await client.query(`
  SELECT kk_sku, eligibility_status
  FROM public.v_amazon_ready_to_push_products
  WHERE kk_product_id = $1
`, [PRODUCT_ID]);

console.log("Ready to push row:", rows[0] || "STILL MISSING");
await client.end();
