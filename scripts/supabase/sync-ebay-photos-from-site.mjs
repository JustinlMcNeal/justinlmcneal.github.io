#!/usr/bin/env node
/**
 * Copy website product photos onto live eBay listings (Inventory API items / item groups).
 *
 *   node scripts/supabase/sync-ebay-photos-from-site.mjs KK_0066 KK-0023            dry run
 *   node scripts/supabase/sync-ebay-photos-from-site.mjs KK_0066 KK-0023 --apply
 *
 * Listing gallery order matches the admin eBay page: catalog -> primary -> hover -> shared gallery,
 * then variant previews. Each variation keeps its own picture set: its preview first, then any of
 * its current eBay pictures that still resolve. Broken URLs are dropped (eBay rejects the whole PUT),
 * and a listing or variation is only rewritten when its photo count grows (or, at the same count, its
 * main photo changed) — eBay still shows photos
 * whose source files were purged from Storage, so a rewrite must never shrink what buyers see.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient } from "./dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CODES = args.filter((a) => !a.startsWith("--"));
if (!CODES.length) throw new Error("Pass product codes, e.g. KK_0066 KK-0023");

/** eBay-only lead photo (first in search results) when the website catalog image isn't the best thumbnail. */
const LEAD_IMAGE_MATCH = { "KK-0016": "-all-colors." };

const LISTING_MAX = 24;
const VARIATION_MAX = 12;
const INV = "https://api.ebay.com/sell/inventory/v1";

const db = await connectPgClient();
const { rows: [tok] } = await db.query(`SELECT access_token, token_expires_at FROM marketplace_tokens WHERE platform = 'ebay'`);
if (new Date(tok.token_expires_at).getTime() < Date.now() + 10 * 60_000) {
  throw new Error("eBay access token expires within 10 minutes — run any eBay admin action to refresh it first.");
}
const H = {
  Authorization: `Bearer ${tok.access_token}`,
  "Content-Type": "application/json",
  "Content-Language": "en-US",
  "Accept-Language": "en-US",
};

const { rows: products } = await db.query(
  `SELECT p.id, p.code, p.weight_g, p.ebay_sku, p.ebay_item_group_key, p.catalog_image_url, p.primary_image_url, p.catalog_hover_url,
     (SELECT json_agg(g ORDER BY g.position) FROM (
        SELECT url, position, variant_id FROM product_gallery_images WHERE product_id = p.id AND is_active) g) AS gallery,
     (SELECT json_agg(v ORDER BY v.sort_order) FROM (
        SELECT id, option_value, preview_image_url, sort_order FROM product_variants WHERE product_id = p.id AND is_active) v) AS variants
   FROM products p WHERE p.code = ANY($1) AND p.ebay_status = 'active'`,
  [CODES],
);
await db.end();

const liveCache = new Map();
async function isLive(url) {
  if (!liveCache.has(url)) {
    liveCache.set(url, fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(() => false));
  }
  return liveCache.get(url);
}

async function liveUnique(urls, max) {
  const out = [];
  for (const url of urls) {
    if (!url || out.includes(url)) continue;
    if (await isLive(url)) out.push(url);
    else console.log(`    drop broken: ${url.split("/").pop()}`);
    if (out.length >= max) break;
  }
  return out;
}

async function ebay(method, path, body) {
  const r = await fetch(`${INV}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 400)}`);
  return data;
}

/** eBay rejects a PUT that echoes back a stored 0 weight; fall back to the product weight. */
function fixZeroWeight(body, weightG) {
  const w = body.packageWeightAndSize?.weight;
  if (!w || Number(w.value) > 0) return;
  const oz = Math.max(1, Math.round((Number(weightG) || 28.35) / 28.35 * 10) / 10);
  body.packageWeightAndSize.weight = { value: oz, unit: "OUNCE" };
  console.log(`    package weight was 0 -> ${oz} oz`);
}

/** Out-of-stock listings can't be revised (eBay error 25004); log and move on. */
async function tryPut(path, body) {
  try {
    await ebay("PUT", path, body);
    return true;
  } catch (err) {
    console.log(`    SKIPPED: ${err.message.includes("25004") ? "out of stock — eBay won't revise a 0-qty listing" : err.message}`);
    failures.push(path);
    return false;
  }
}
const failures = [];

/** Rewrite when photos are added, or when the main photo changed without losing any. */
function shouldRewrite(current = [], next) {
  return next.length > current.length || (next.length === current.length && next[0] !== current[0]);
}

const skuForOption = (code, option) => `${code}-${option.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6)}`;

for (const p of products) {
  const gallery = p.gallery || [];
  const variants = p.variants || [];
  const shared = [
    p.catalog_image_url,
    p.primary_image_url,
    p.catalog_hover_url,
    ...gallery.filter((g) => !g.variant_id).map((g) => g.url),
  ];
  const previews = variants.map((v) => v.preview_image_url);
  const leadKey = LEAD_IMAGE_MATCH[p.code];
  const lead = leadKey ? gallery.find((g) => g.url.includes(leadKey))?.url : null;
  const listingUrls = await liveUnique([lead, ...shared, ...previews], LISTING_MAX);

  if (!p.ebay_item_group_key) {
    const sku = p.ebay_sku || p.code;
    const item = await ebay("GET", `/inventory_item/${encodeURIComponent(sku)}`);
    const before = item.product?.imageUrls?.length || 0;
    console.log(`${p.code} (single ${sku}): ${before} -> ${listingUrls.length} photos`);
    if (APPLY && shouldRewrite(item.product?.imageUrls, listingUrls)) {
      const { sku: _s, locale: _l, groupIds: _g, inventoryItemGroupKeys: _k, ...body } = item;
      body.product = { ...body.product, imageUrls: listingUrls };
      fixZeroWeight(body, p.weight_g);
      if (await tryPut(`/inventory_item/${encodeURIComponent(sku)}`, body)) console.log("  updated");
    }
    continue;
  }

  const group = await ebay("GET", `/inventory_item_group/${encodeURIComponent(p.ebay_item_group_key)}`);
  const groupBefore = group.imageUrls?.length || 0;
  console.log(`${p.code} (group ${p.ebay_item_group_key}): listing gallery ${groupBefore} -> ${listingUrls.length}`);
  if (APPLY && shouldRewrite(group.imageUrls, listingUrls)) {
    const { inventoryItemGroupKey: _k, ...body } = group;
    body.imageUrls = listingUrls;
    if (await tryPut(`/inventory_item_group/${encodeURIComponent(p.ebay_item_group_key)}`, body)) console.log("  group updated");
  }

  for (const sku of group.variantSKUs || []) {
    const variant = variants.find((v) => skuForOption(p.code, v.option_value) === sku);
    const item = await ebay("GET", `/inventory_item/${encodeURIComponent(sku)}`);
    const current = item.product?.imageUrls || [];
    const own = gallery.filter((g) => variant && g.variant_id === variant.id).map((g) => g.url);
    const urls = await liveUnique([variant?.preview_image_url, ...own, ...current], VARIATION_MAX);
    const grows = urls.length > current.length;
    console.log(`  ${sku}: ${current.length} -> ${urls.length}${grows ? "" : " (keep current)"}${variant ? "" : " [no matching website variant]"}`);
    if (APPLY && grows) {
      const { sku: _s, locale: _l, groupIds: _g, inventoryItemGroupKeys: _k, ...body } = item;
      body.product = { ...body.product, imageUrls: urls };
      fixZeroWeight(body, p.weight_g);
      await tryPut(`/inventory_item/${encodeURIComponent(sku)}`, body);
    }
  }
}
if (failures.length) console.log(`\n${failures.length} update(s) skipped.`);
if (!APPLY) console.log("\nDry run. Re-run with --apply.");
