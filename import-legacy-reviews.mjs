#!/usr/bin/env node
/**
 * import-legacy-reviews.mjs
 *
 * Imports legacy review CSV data into the Supabase `reviews` table.
 * Matches reviews to orders using email + product_id lookups against orders_raw + line_items_raw.
 * Falls back to synthetic session IDs for reviews that can't be matched to an order.
 *
 * Usage:
 *   node import-legacy-reviews.mjs <SUPABASE_SERVICE_ROLE_KEY>
 *
 *   Or set env variable:
 *   $env:SUPABASE_SERVICE_KEY="eyJ..."
 *   node import-legacy-reviews.mjs
 *
 *   Dry-run (preview without writing):
 *   node import-legacy-reviews.mjs --dry-run
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ─── Config ─────────────────────────────────────────────────────────
const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const DRY_RUN = flags.includes("--dry-run");

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || args[0] || "";

if (!SUPABASE_KEY) {
  console.error("❌ Missing Supabase service_role key.\n");
  console.error("Usage:");
  console.error("  node import-legacy-reviews.mjs <SERVICE_ROLE_KEY>");
  console.error("  node import-legacy-reviews.mjs <SERVICE_ROLE_KEY> --dry-run\n");
  console.error("Get it from: Supabase Dashboard → Settings → API → service_role key");
  process.exit(1);
}

const CSV_PATH = "D:/Downloaded Games Libary/Karry Kraze - Review_Log.csv";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CSV Parser (handles quoted fields with commas) ─────────────────
function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  const len = line.length;

  while (i <= len) {
    if (i === len) break;

    if (line[i] === '"') {
      // Quoted field
      let j = i + 1;
      let value = "";
      while (j < len) {
        if (line[j] === '"') {
          if (j + 1 < len && line[j + 1] === '"') {
            value += '"';
            j += 2;
          } else {
            j++;
            break;
          }
        } else {
          value += line[j];
          j++;
        }
      }
      fields.push(value);
      // skip comma
      if (j < len && line[j] === ",") j++;
      i = j;
    } else {
      // Unquoted field
      const nextComma = line.indexOf(",", i);
      if (nextComma === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, nextComma));
        i = nextComma + 1;
      }
    }
  }
  return fields;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] || "").trim();
    });
    rows.push(row);
  }
  return rows;
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("📋 Reading CSV...");
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const rawRows = parseCSV(csvText);
  console.log(`   Found ${rawRows.length} rows in CSV.\n`);

  // ── Step 1: Pre-fetch all orders + line items for matching ────────
  console.log("🔍 Fetching orders from database for matching...");

  // Collect all unique emails from CSV
  const csvEmails = [...new Set(rawRows.map((r) => (r.Email || "").toLowerCase()).filter(Boolean))];
  console.log(`   ${csvEmails.length} unique emails in CSV.`);

  // Fetch orders by email (batch in chunks to avoid URL-length issues)
  const allOrders = [];
  for (let i = 0; i < csvEmails.length; i += 20) {
    const chunk = csvEmails.slice(i, i + 20);
    const { data, error } = await supabase
      .from("orders_raw")
      .select("stripe_checkout_session_id, kk_order_id, email, first_name, last_name")
      .in("email", chunk);
    if (error) {
      console.error("   ⚠️ Error fetching orders:", error.message);
    } else {
      allOrders.push(...(data || []));
    }
  }
  console.log(`   ${allOrders.length} orders found for those emails.`);

  // Fetch line items for those orders
  const sessionIds = [...new Set(allOrders.map((o) => o.stripe_checkout_session_id).filter(Boolean))];
  const allLineItems = [];
  for (let i = 0; i < sessionIds.length; i += 50) {
    const chunk = sessionIds.slice(i, i + 50);
    const { data, error } = await supabase
      .from("line_items_raw")
      .select("stripe_checkout_session_id, product_id")
      .in("stripe_checkout_session_id", chunk);
    if (error) {
      console.error("   ⚠️ Error fetching line items:", error.message);
    } else {
      allLineItems.push(...(data || []));
    }
  }
  console.log(`   ${allLineItems.length} line items found.\n`);

  // Build lookup structures
  // email -> [{ session_id, kk_order_id, first_name, last_name }]
  const ordersByEmail = new Map();
  for (const o of allOrders) {
    const email = (o.email || "").toLowerCase();
    if (!ordersByEmail.has(email)) ordersByEmail.set(email, []);
    ordersByEmail.get(email).push(o);
  }

  // session_id -> Set<product_id>
  const productsBySession = new Map();
  for (const li of allLineItems) {
    const sid = li.stripe_checkout_session_id;
    if (!productsBySession.has(sid)) productsBySession.set(sid, new Set());
    productsBySession.get(sid).add(li.product_id);
  }

  // ── Step 2: Build review records ─────────────────────────────────
  console.log("🔗 Matching reviews to orders...");

  // Deduplicate: key = order_session_id + product_id
  const seen = new Set();
  const reviews = [];
  let matchedCount = 0;
  let unmatchedCount = 0;
  let skippedDupes = 0;

  for (let idx = 0; idx < rawRows.length; idx++) {
    const r = rawRows[idx];
    const email = (r.Email || "").toLowerCase();
    const productId = (r.ProductId || "").trim();
    const firstName = (r["First Name"] || "").trim();
    const lastName = (r["Last Name"] || "").trim();
    const csvOrderNum = (r["Order Number"] || "").trim();

    if (!email || !productId) {
      console.log(`   ⏭  Row ${idx + 1}: skipping — missing email or productId`);
      continue;
    }

    // Try to find matching order
    let matchedSessionId = null;

    // Strategy 1: If CSV order number is a stripe session ID (cs_live_*)
    if (csvOrderNum.startsWith("cs_live_")) {
      matchedSessionId = csvOrderNum;
    }

    // Strategy 2: Try to match by kk_order_id
    if (!matchedSessionId && csvOrderNum) {
      const orders = ordersByEmail.get(email) || [];
      for (const o of orders) {
        if (o.kk_order_id === csvOrderNum || o.kk_order_id === `KKO-${csvOrderNum}`) {
          matchedSessionId = o.stripe_checkout_session_id;
          break;
        }
      }
    }

    // Strategy 3: Match by email + product_id on any order
    if (!matchedSessionId) {
      const orders = ordersByEmail.get(email) || [];
      for (const o of orders) {
        const products = productsBySession.get(o.stripe_checkout_session_id);
        if (products?.has(productId)) {
          matchedSessionId = o.stripe_checkout_session_id;
          break;
        }
      }
    }

    // Strategy 4: Match by email only (take the first order)
    if (!matchedSessionId) {
      const orders = ordersByEmail.get(email) || [];
      if (orders.length > 0) {
        matchedSessionId = orders[0].stripe_checkout_session_id;
      }
    }

    // Fallback: Generate a synthetic session ID
    if (!matchedSessionId) {
      matchedSessionId = `legacy_review_${csvOrderNum || idx}`;
      unmatchedCount++;
    } else {
      matchedCount++;
    }

    // Deduplicate by session + product
    const dedupeKey = `${matchedSessionId}|${productId}`;
    if (seen.has(dedupeKey)) {
      skippedDupes++;
      continue;
    }
    seen.add(dedupeKey);

    // Parse the rating
    const rating = Math.min(5, Math.max(1, parseInt(r.Rating) || 5));

    // Build reviewer name
    const reviewerName = [firstName, lastName].filter(Boolean).join(" ") || "Anonymous";

    // Photo URL
    const photoUrl = (r.imageURL || "").trim() || null;

    // Parse date
    let createdAt = null;
    if (r.Timestamp) {
      const parts = r.Timestamp.split("/");
      if (parts.length === 3) {
        const [month, day, year] = parts;
        createdAt = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T12:00:00Z`).toISOString();
      }
    }

    // Platform as admin note
    const platform = (r.Platform || "").trim();

    reviews.push({
      order_session_id: matchedSessionId,
      product_id: productId,
      product_name: null, // Will be set if we can look up
      reviewer_email: email,
      reviewer_name: reviewerName,
      rating,
      title: (r.HeaderText || "").trim() || null,
      body: (r.ReviewText || "").trim() || null,
      photo_url: photoUrl,
      status: "approved", // All legacy reviews are pre-approved
      admin_notes: platform ? `Imported from ${platform}` : "Imported from CSV",
      created_at: createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`   ✅ ${matchedCount} matched to real orders`);
  console.log(`   ⚠️  ${unmatchedCount} unmatched (using synthetic session IDs)`);
  console.log(`   ⏭  ${skippedDupes} duplicate rows skipped`);
  console.log(`   📝 ${reviews.length} reviews ready to import\n`);

  // ── Step 3: Look up product names ────────────────────────────────
  console.log("📦 Looking up product names...");
  const uniqueProductIds = [...new Set(reviews.map((r) => r.product_id))];
  const productNames = new Map();

  if (uniqueProductIds.length > 0) {
    const { data: products, error } = await supabase
      .from("products")
      .select("code, name")
      .in("code", uniqueProductIds);

    if (!error && products) {
      for (const p of products) {
        productNames.set(p.code, p.name);
      }
    }
  }

  // Apply product names
  for (const rev of reviews) {
    rev.product_name = productNames.get(rev.product_id) || rev.product_id;
  }

  console.log(`   Found names for ${productNames.size}/${uniqueProductIds.length} products.\n`);

  // ── Step 4: Insert reviews ───────────────────────────────────────
  if (DRY_RUN) {
    console.log("🧪 DRY RUN — No data will be written.\n");
    console.log("Sample reviews:");
    for (const rev of reviews.slice(0, 5)) {
      console.log(`   ${rev.reviewer_name} → ${rev.product_name} (${rev.product_id}) ⭐${rev.rating}`);
      console.log(`     Session: ${rev.order_session_id}`);
      console.log(`     Title: ${rev.title}`);
      console.log(`     ${rev.admin_notes}`);
      console.log();
    }
    console.log(`... and ${Math.max(0, reviews.length - 5)} more.`);
    return;
  }

  console.log("💾 Inserting reviews into database...");

  // Use upsert with the unique constraint (order_session_id, product_id)
  // Insert in batches of 20
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < reviews.length; i += 20) {
    const batch = reviews.slice(i, i + 20);

    const { data, error } = await supabase
      .from("reviews")
      .upsert(batch, {
        onConflict: "order_session_id,product_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      console.error(`   ❌ Batch ${Math.floor(i / 20) + 1} error:`, error.message);
      errors += batch.length;
    } else {
      const count = data?.length || 0;
      inserted += count;
      // Skipped = batch.length - count (duplicates ignored)
      skipped += batch.length - count;
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   ${inserted} reviews inserted`);
  console.log(`   ${skipped} duplicates skipped`);
  if (errors) console.log(`   ${errors} errors`);
  console.log(`   Total in DB now — run: SELECT count(*) FROM reviews;`);
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
