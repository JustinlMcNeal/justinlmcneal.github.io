#!/usr/bin/env node
/**
 * Title rewrites and missing item specifics from eBay's listing quality report (Nov 9, 2026).
 * Values come from the website product sections and photos; nothing here is guessed.
 *
 *   node scripts/supabase/apply-ebay-listing-fixes.mjs            dry run
 *   node scripts/supabase/apply-ebay-listing-fixes.mjs --apply
 *   node scripts/supabase/apply-ebay-listing-fixes.mjs KK-0032 --apply     one listing
 *
 * Aspects are merged into the existing ones (existing keys are overwritten only when listed here).
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
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const INV = "https://api.ebay.com/sell/inventory/v1";

const FIXES = {
  "KK-0032": {
    title: "Funny People 1 Star Review Enamel Pin Would Not Recommend Introvert Lapel Pin",
    aspects: { Type: ["Pin"], Material: ["Metal", "Enamel"], Color: ["Black"], Theme: ["Humor"], "Main Stone": ["No Stone"] },
  },
  "KK-0028": {
    title: "3 Pack Brass Screw Lock Key Ring Oval Carabiner Keychain Clip EDC Key Holder",
    aspects: { Color: ["Gold"], Features: ["Carabiner Clip"], Material: ["Brass"], "Number of Items": ["3"] },
  },
  "KK-0023": {
    title: "Starry Bear Keychain Cute Galaxy Resin Bear Keyring Kawaii Bag Charm Purse Charm",
    aspects: { Material: ["Resin", "Faux Leather"], Size: ["One Size"] },
  },
  "KK-0039": {
    title: "Red Cherry Pendant Necklace Gold Tone Rhinestone Kawaii Fruit Charm Y2K Women",
    aspects: { "Necklace Length": ["18 in"] },
  },
  "KK-0010": {
    title: "Mens Celtic Chain Bracelet Stainless Steel Antique Silver Dragon Clasp Biker",
    aspects: { "Base Metal": ["Stainless Steel"], Material: ["Stainless Steel"], "Main Stone": ["No Stone"] },
    variantAspects: { "KK-0010-18CM": { "Item Length": ["7.1 in"] }, "KK-0010-22CM": { "Item Length": ["8.7 in"] } },
  },
  "KK-0002": {
    aspects: { "Handle/Strap Material": ["Faux Leather"], "Bag Width": ["8 in"], "Bag Height": ["6 in"], "Bag Depth": ["3 in"] },
  },
};

for (const [code, fix] of Object.entries(FIXES)) {
  if (fix.title && fix.title.length > 80) throw new Error(`${code} title is ${fix.title.length} chars (max 80)`);
}

const db = await connectPgClient();
const { rows: [tok] } = await db.query(`SELECT access_token, token_expires_at FROM marketplace_tokens WHERE platform = 'ebay'`);
if (new Date(tok.token_expires_at).getTime() < Date.now() + 10 * 60_000) {
  throw new Error("eBay access token expires within 10 minutes — run any eBay admin action to refresh it first.");
}
const { rows: products } = await db.query(
  `SELECT code, ebay_sku, ebay_item_group_key FROM products WHERE code = ANY($1) AND ebay_status = 'active'`,
  [ONLY.length ? ONLY : Object.keys(FIXES)],
);
await db.end();

const H = {
  Authorization: `Bearer ${tok.access_token}`,
  "Content-Type": "application/json",
  "Content-Language": "en-US",
  "Accept-Language": "en-US",
};
async function ebay(method, path, body) {
  const r = await fetch(`${INV}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}
async function tryPut(path, body) {
  try {
    await ebay("PUT", path, body);
    console.log("  updated");
  } catch (err) {
    console.log(`  SKIPPED: ${err.message.includes("25004") ? "out of stock — eBay won't revise a 0-qty listing" : err.message}`);
  }
}
const diff = (before = {}, add) =>
  Object.entries(add).map(([k, v]) => `${k}: ${before[k] ? JSON.stringify(before[k]) : "—"} -> ${JSON.stringify(v)}`);

for (const p of products) {
  const fix = FIXES[p.code];
  if (p.ebay_item_group_key) {
    const path = `/inventory_item_group/${encodeURIComponent(p.ebay_item_group_key)}`;
    const group = await ebay("GET", path);
    console.log(`\n${p.code} (group)`);
    if (fix.title) console.log(`  title: "${group.title}" -> "${fix.title}"`);
    diff(group.aspects, fix.aspects || {}).forEach((l) => console.log(`  ${l}`));
    if (APPLY) {
      const { inventoryItemGroupKey: _k, ...body } = group;
      if (fix.title) body.title = fix.title;
      body.aspects = { ...group.aspects, ...fix.aspects };
      await tryPut(path, body);
    }
    for (const [sku, add] of Object.entries(fix.variantAspects || {})) {
      const vpath = `/inventory_item/${encodeURIComponent(sku)}`;
      const item = await ebay("GET", vpath);
      diff(item.product?.aspects, add).forEach((l) => console.log(`  ${sku} ${l}`));
      if (APPLY) {
        const { sku: _s, locale: _l, groupIds: _g, inventoryItemGroupKeys: _ks, ...body } = item;
        body.product = { ...body.product, aspects: { ...body.product?.aspects, ...add } };
        await tryPut(vpath, body);
      }
    }
    continue;
  }
  const sku = p.ebay_sku || p.code;
  const path = `/inventory_item/${encodeURIComponent(sku)}`;
  const item = await ebay("GET", path);
  console.log(`\n${p.code} (single ${sku})`);
  if (fix.title) console.log(`  title: "${item.product?.title}" -> "${fix.title}"`);
  diff(item.product?.aspects, fix.aspects || {}).forEach((l) => console.log(`  ${l}`));
  if (APPLY) {
    const { sku: _s, locale: _l, groupIds: _g, inventoryItemGroupKeys: _k, ...body } = item;
    body.product = { ...body.product, aspects: { ...body.product?.aspects, ...fix.aspects } };
    if (fix.title) body.product.title = fix.title;
    await tryPut(path, body);
  }
}
if (!APPLY) console.log("\nDry run. Re-run with --apply.");
