#!/usr/bin/env node
/** Validate KK-1050 draft payload against TOY_FIGURE schema enums (local pre-check). */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "tmp-toy-figure-full-schema.json"), "utf8"),
);

const THEME_ALIASES = { flowers: "Floral", flower: "Floral" };
const ITK_ALIASES = {
  "stuffed-animal-toys": "plush-animal-toys",
  "plush-pillows": "childrens-plush-toy-pillows",
  "plush-figure": "plush-figure-toys",
};

function normalize(name, value) {
  const text = String(value || "").trim();
  if (!text) return text;
  if (name === "theme") return THEME_ALIASES[text.toLowerCase()] || text;
  if (name === "item_type_keyword") return ITK_ALIASES[text.toLowerCase()] || text;
  return text;
}

function enumFor(name) {
  const prop = schema.properties?.[name];
  const anyOf = prop?.items?.properties?.value?.anyOf;
  const enumBlock = anyOf?.find((entry) => Array.isArray(entry.enum));
  return enumBlock?.enum || null;
}

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT draft_payload FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050' ORDER BY updated_at DESC LIMIT 1
`);
const payload = rows[0]?.draft_payload || {};

const checks = ["item_type_keyword", "theme", "toy_figure_type"];
for (const name of checks) {
  const raw = payload[name];
  const normalized = normalize(name, raw);
  const enumValues = enumFor(name);
  const ok = !enumValues || enumValues.includes(normalized);
  console.log(`${name}: raw=${JSON.stringify(raw)} normalized=${JSON.stringify(normalized)} enumOk=${ok}`);
  if (!ok) {
    console.log("  valid samples:", enumValues.slice(0, 8).join(", "));
  }
}

const itkShape = {
  value: normalize("item_type_keyword", payload.item_type_keyword),
  marketplace_id: "ATVPDKIKX0DER",
};
console.log("\nExpected item_type_keyword shape (no language_tag):", JSON.stringify([itkShape]));

await client.end();
