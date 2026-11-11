#!/usr/bin/env node
/**
 * Upload the new KK-0016 white-background color photos and wire them into the website.
 *   node scripts/supabase/apply-kk0016-new-photos.mjs           dry run
 *   node scripts/supabase/apply-kk0016-new-photos.mjs --apply
 *
 * Reads tmp/new-listings-images/KK-0016/<Color>/01-main.jpg (folder "Black-White" = option "Black/White")
 * and 00-all-colors.jpg. Each color photo becomes that variant's preview image; the all-colors
 * shot goes first in the website gallery. Catalog/primary/hover images are left alone.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
const APPLY = process.argv.includes("--apply");
const CODE = "KK-0016";
const DIR = join(ROOT, "tmp/new-listings-images", CODE);

const db = await connectPgClient();
const { rows: [product] } = await db.query(`SELECT id FROM products WHERE code = $1`, [CODE]);
const { rows: variants } = await db.query(
  `SELECT id, option_value, preview_image_url FROM product_variants WHERE product_id = $1 AND is_active`,
  [product.id],
);

const plan = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(DIR, d.name, "01-main.jpg")))
  .map((d) => {
    const option = d.name.replace(/-/g, "/");
    const variant = variants.find((v) => v.option_value.toLowerCase() === option.toLowerCase());
    if (!variant) throw new Error(`No ${CODE} variant for folder ${d.name}`);
    return { file: join(DIR, d.name, "01-main.jpg"), variant };
  });
const collage = join(DIR, "00-all-colors.jpg");
console.log(`${CODE}: ${plan.length} color photos -> ${plan.map((p) => p.variant.option_value).join(", ")}; all-colors: ${existsSync(collage)}`);
if (!APPLY) {
  console.log("Dry run. Re-run with --apply.");
  await db.end();
  process.exit(0);
}

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function upload(file, slug) {
  const buf = await sharp(readFileSync(file))
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 86 })
    .toBuffer();
  const path = `gallery/${Date.now()}-${CODE.toLowerCase()}-${slug}.webp`;
  const { error } = await sb.storage.from("products").upload(path, buf, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`upload ${file}: ${error.message}`);
  return sb.storage.from("products").getPublicUrl(path).data.publicUrl;
}

const galleryUrls = [];
if (existsSync(collage)) galleryUrls.push(await upload(collage, "all-colors"));
for (const { file, variant } of plan) {
  const url = await upload(file, variant.option_value.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  await db.query(`UPDATE product_variants SET preview_image_url = $2, updated_at = now() WHERE id = $1`, [variant.id, url]);
  galleryUrls.push(url);
  console.log(`  ${variant.option_value}: ${url.split("/").pop()} (was ${variant.preview_image_url?.split("/").pop()})`);
}

const { rows: [{ max }] } = await db.query(
  `SELECT COALESCE(MAX(position), -1) AS max FROM product_gallery_images WHERE product_id = $1`,
  [product.id],
);
await db.query(`UPDATE product_gallery_images SET position = position + $2 WHERE product_id = $1`, [product.id, galleryUrls.length]);
for (const [i, url] of galleryUrls.entries()) {
  await db.query(
    `INSERT INTO product_gallery_images (product_id, url, position, is_active) VALUES ($1, $2, $3, true)`,
    [product.id, url, i],
  );
}
console.log(`${CODE}: added ${galleryUrls.length} gallery images (existing gallery max position was ${max}).`);
await db.end();
