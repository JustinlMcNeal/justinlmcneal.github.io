#!/usr/bin/env node
import pg from "pg";
const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const p = await client.query(`SELECT code, upc, ean, gtin, barcode FROM products WHERE code='KK-1050' LIMIT 1`);
console.log(p.rows[0]);
const d = await client.query(`SELECT draft_payload->>'upc' upc, draft_payload->>'ean' ean, draft_payload->>'supplier_declared_has_product_identifier_exemption' ex FROM amazon_listing_drafts WHERE kk_sku='KK-1050' ORDER BY updated_at DESC LIMIT 1`);
console.log(d.rows[0]);
await client.end();
