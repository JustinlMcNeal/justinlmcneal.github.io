#!/usr/bin/env node
/**
 * Upload a new main (catalog) photo for a product and make it the website's catalog image.
 *   node scripts/supabase/set-main-photo.mjs KK-0017 tmp/new-listings-images/KK-0017/01-main.jpg           dry run
 *   node scripts/supabase/set-main-photo.mjs KK-0017 tmp/new-listings-images/KK-0017/01-main.jpg --apply
 * Then push it to eBay: node scripts/supabase/sync-ebay-photos-from-site.mjs KK-0017 --apply
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { connectPgClient } from "./dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const env = process.env;
const [code, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!code || !file) throw new Error("Usage: set-main-photo.mjs <CODE> <image file> [--apply]");

const db = await connectPgClient();
const { rows: [product] } = await db.query(`SELECT id, catalog_image_url FROM products WHERE code = $1`, [code]);
if (!product) throw new Error(`No product ${code}`);
const meta = await sharp(resolve(ROOT, file)).metadata();
console.log(`${code}: ${file} (${meta.width}x${meta.height}) replaces catalog ${product.catalog_image_url?.split("/").pop()}`);
if (!APPLY) {
  console.log("Dry run. Re-run with --apply.");
  await db.end();
  process.exit(0);
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const buf = await sharp(resolve(ROOT, file))
  .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
  .flatten({ background: "#ffffff" })
  .webp({ quality: 88 })
  .toBuffer();
const path = `catalog/${Date.now()}-${code.toLowerCase()}-main.webp`;
const { error } = await sb.storage.from("products").upload(path, buf, { contentType: "image/webp", upsert: true });
if (error) throw new Error(`upload: ${error.message}`);
const url = sb.storage.from("products").getPublicUrl(path).data.publicUrl;
await db.query(`UPDATE products SET catalog_image_url = $2, updated_at = now() WHERE id = $1`, [product.id, url]);
console.log(`${code}: catalog image -> ${url}`);
await db.end();
