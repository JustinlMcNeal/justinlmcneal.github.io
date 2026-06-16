#!/usr/bin/env node
import pg from "pg";

const PROJECT_REF = "yxdzvzscufkvewecvagq";
const SKU = process.argv[2] || "KK-1050";

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

const { rows } = await client.query(
  `SELECT id, seller_sku, product_type, draft_status, submission_status,
          seller_id, seller_account_id, validation_errors, draft_payload
   FROM public.amazon_listing_drafts
   WHERE kk_sku = $1
   ORDER BY updated_at DESC
   LIMIT 1`,
  [SKU],
);

console.log("Draft:", rows[0] ? {
  id: rows[0].id,
  seller_sku: rows[0].seller_sku,
  product_type: rows[0].product_type,
  draft_status: rows[0].draft_status,
  submission_status: rows[0].submission_status,
  seller_id: rows[0].seller_id,
  seller_account_id: rows[0].seller_account_id,
  validation_error_count: Array.isArray(rows[0].validation_errors) ? rows[0].validation_errors.length : 0,
  draft_payload_keys: rows[0].draft_payload ? Object.keys(rows[0].draft_payload) : [],
} : "NOT FOUND");

await client.end();
