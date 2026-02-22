#!/usr/bin/env node
/**
 * import-legacy-orders.mjs
 *
 * Imports legacy Google Sheets CSV data into Supabase tables:
 *   - orders_raw
 *   - line_items_raw
 *   - fulfillment_shipments
 *
 * Usage:
 *   node import-legacy-orders.mjs <SUPABASE_SERVICE_ROLE_KEY>
 *
 *   Or set env variable:
 *   $env:SUPABASE_SERVICE_KEY="eyJ..."
 *   node import-legacy-orders.mjs
 *
 *   Dry-run (preview without writing):
 *   node import-legacy-orders.mjs <KEY> --dry-run
 *
 * Get your service_role key from:
 *   Supabase Dashboard → Project Settings → API → service_role (secret)
 */

import { readFileSync } from "fs";

// ─── Config ─────────────────────────────────────────────────────────
const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const DRY_RUN = flags.includes("--dry-run");

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || args[0] || "";

if (!SUPABASE_KEY) {
  console.error("❌ Missing Supabase service_role key.\n");
  console.error("Usage:");
  console.error("  node import-legacy-orders.mjs <SERVICE_ROLE_KEY>");
  console.error("  node import-legacy-orders.mjs <SERVICE_ROLE_KEY> --dry-run\n");
  console.error("Get it from: Supabase Dashboard → Settings → API → service_role key");
  process.exit(1);
}

const RAW_CSV_PATH =
  "D:/Downloaded Games Libary/Karry Kraze - LineItems_Raw2.0.csv";
const ORDERS_CSV_PATH =
  "D:/Downloaded Games Libary/Karry Kraze - LineItems_Orders2.0.csv";

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
      let val = "";
      while (j < len) {
        if (line[j] === '"' && j + 1 < len && line[j + 1] === '"') {
          val += '"';
          j += 2;
        } else if (line[j] === '"') {
          j++;
          break;
        } else {
          val += line[j];
          j++;
        }
      }
      fields.push(val);
      if (j < len && line[j] === ",") j++;
      i = j;
    } else {
      // Unquoted field
      let j = line.indexOf(",", i);
      if (j === -1) j = len;
      fields.push(line.substring(i, j));
      i = j + 1;
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
    const line = lines[i];
    if (!line || !line.trim()) continue;

    const fields = parseCSVLine(line);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (fields[j] || "").trim();
    }
    rows.push(obj);
  }
  return rows;
}

// ─── Value Parsers ──────────────────────────────────────────────────
function parseDollars(s) {
  if (!s || typeof s !== "string") return 0;
  s = s.trim();
  if (!s || s === "$" || s === "$ -" || s === "-") return 0;

  // Handle negatives in parentheses: $ (2.27)
  const isNeg = s.includes("(") && s.includes(")");
  s = s.replace(/[$,\s()]/g, "");
  if (/^-*$/.test(s)) return 0;

  const val = parseFloat(s);
  if (isNaN(val) || !isFinite(val)) return 0;
  return isNeg ? -val : val;
}

function toCents(dollars) {
  return Math.round(Number(dollars || 0) * 100);
}

function parseDate(s) {
  if (!s || typeof s !== "string") return null;
  s = s.trim();
  if (!s) return null;

  // M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`;
  }
  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return `${s}T00:00:00Z`;

  return null;
}

function ozToGrams(oz) {
  const v = parseFloat(oz);
  if (isNaN(v) || !isFinite(v) || v <= 0) return 0;
  return Math.round(v * 28.3495);
}

/** Return trimmed string or null */
function clean(s) {
  const v = (s || "").trim();
  return v.length > 0 ? v : null;
}

// ─── Supabase REST helper ───────────────────────────────────────────
async function upsertBatch(table, rows, onConflict, batchSize = 50) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `${table} upsert batch ${i}-${i + batch.length} failed: ${res.status} — ${errText}`
      );
    }

    inserted += batch.length;
    process.stdout.write(`   ${table}: ${inserted}/${rows.length}\r`);
  }
  console.log(`   ✅ ${table}: ${inserted}/${rows.length}`);
  return inserted;
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  KK Legacy Import → Supabase");
  if (DRY_RUN) console.log("  🔍 DRY RUN — no data will be written");
  console.log("═══════════════════════════════════════════════════════\n");

  // ─── 1. Read CSVs ────────────────────────────────────
  console.log("📂 Reading CSV files...");
  const rawText = readFileSync(RAW_CSV_PATH, "utf-8");
  const ordersText = readFileSync(ORDERS_CSV_PATH, "utf-8");

  const rawRows = parseCSV(rawText);
  const ordersRows = parseCSV(ordersText);

  // Filter out empty trailing rows
  const validRaw = rawRows.filter((r) => r.OrderID && r.OrderID.length > 0);
  const validOrders = ordersRows.filter((r) => {
    const oid = r["Order ID"] || "";
    return oid.length > 0;
  });

  console.log(`   Raw CSV:    ${validRaw.length} line-item rows`);
  console.log(`   Orders CSV: ${validOrders.length} order rows\n`);

  // ─── 2. Orders CSV lookup (for authoritative totals & status) ────
  const ordersLookup = new Map();
  for (const row of validOrders) {
    ordersLookup.set(row["Order ID"], row);
  }

  // ─── 3. Group raw rows by OrderID ───────────────────────
  const orderGroups = new Map();
  for (const row of validRaw) {
    const oid = row.OrderID;
    if (!orderGroups.has(oid)) orderGroups.set(oid, []);
    orderGroups.get(oid).push(row);
  }
  console.log(`📦 Unique orders: ${orderGroups.size}\n`);

  // ─── 4. Build Supabase payloads ───────────────────────
  const ordersPayload = [];
  const lineItemsPayload = [];
  const shipmentPayload = [];

  for (const [orderId, lines] of orderGroups) {
    const orderDate = parseDate(lines[0].Date);
    if (!orderDate) {
      console.warn(`   ⚠ Skipping ${orderId}: unparsable date "${lines[0].Date}"`);
      continue;
    }

    const sessionId = orderId; // cs_live_* are real Stripe IDs; others are legacy
    const kkOrderId = orderId;

    // ── Customer info (first line that has data) ──
    let firstName = null,
      lastName = null,
      email = null,
      phone = null;
    let street = null,
      city = null,
      state = null,
      zip = null,
      country = null;
    let stripeCustomerId = null;

    for (const ln of lines) {
      if (!firstName) firstName = clean(ln["First Name"]);
      if (!lastName) lastName = clean(ln["Last Name"]);
      if (!email) email = clean(ln.Email);
      if (!phone) phone = clean(ln["Phone Number"]);
      if (!street) street = clean(ln["Street Address"]);
      if (!city) city = clean(ln.City);
      if (!state) state = clean(ln.State);
      if (!zip) zip = clean(ln.Zip);
      if (!country) country = clean(ln.Country);
      if (!stripeCustomerId) stripeCustomerId = clean(ln["Stripe Customer ID"]);
    }

    // ── Aggregate financials from line items ──
    let sumUnitPrice = 0; // line-level totals (before coupons)
    let sumSavings = 0;
    let sumTax = 0;
    let sumShipping = 0;
    let sumLineTotalPaid = 0;
    let totalItems = 0;
    let couponCode = null;

    for (const ln of lines) {
      const qty = Math.max(1, parseInt(ln.Quantity) || 1);
      totalItems += qty;
      sumUnitPrice += parseDollars(ln["Unit Price"]);
      sumSavings += parseDollars(ln["Code Savings"]);
      sumTax += parseDollars(ln.Tax);
      sumShipping += parseDollars(ln["Shipping Paid"]);
      sumLineTotalPaid += parseDollars(ln["Total Paid"]);
      if (!couponCode) couponCode = clean(ln["Coupon Code"]);
    }

    // Sum item-level costs from raw CSV as fallback
    let sumItemCost = 0;
    for (const ln of lines) {
      const qty = Math.max(1, parseInt(ln.Quantity) || 1);
      const itemCost = parseDollars(ln["Item Cost"]);
      sumItemCost += itemCost * qty;
    }

    // Use Orders CSV total_paid as ground truth when available
    const orderRow = ordersLookup.get(orderId);
    let totalPaidDollars = sumLineTotalPaid;
    let fulfilledStr = "yes"; // default legacy orders to delivered
    let estShipCost = 4.75; // default label cost

    if (orderRow) {
      const csvTotal = parseDollars(orderRow["Total Paid"]);
      if (csvTotal !== 0 || sumLineTotalPaid === 0) {
        totalPaidDollars = csvTotal;
      }
      const fRaw = (orderRow.Fulfilled || "").toLowerCase().trim();
      fulfilledStr = fRaw || ""; // empty = pending
      const csvShip = parseDollars(orderRow["Estimated Shipping Cost"]);
      if (csvShip > 0) estShipCost = csvShip;
    }

    const totalPaidCents = Math.max(0, toCents(totalPaidDollars));
    const taxCents = Math.max(0, toCents(sumTax));
    const shippingPaidCents = Math.max(0, toCents(sumShipping));
    const subtotalPaidCents = Math.max(
      0,
      totalPaidCents - taxCents - shippingPaidCents
    );
    const savingsCents = Math.max(0, toCents(sumSavings));
    const subtotalOriginalCents = Math.max(0, toCents(sumUnitPrice));

    // Weight
    let totalWeightG = 0;
    let orderCostDollars = 0;
    if (orderRow) {
      totalWeightG = ozToGrams(orderRow["Total Weight Ounces"] || "0");
      orderCostDollars = parseDollars(orderRow["Order Cost"]);
    }
    if (totalWeightG === 0) {
      for (const ln of lines) {
        totalWeightG += ozToGrams(ln["Item Weight"] || "0");
      }
    }

    // Order cost: prefer orders CSV "Order Cost", fallback to sum of line-level "Item Cost"
    const finalOrderCostDollars = orderCostDollars > 0 ? orderCostDollars : Math.max(0, sumItemCost);
    const orderCostCents = Math.max(0, toCents(finalOrderCostDollars));

    // ── orders_raw ──
    ordersPayload.push({
      stripe_checkout_session_id: sessionId,
      kk_order_id: kkOrderId,
      stripe_customer_id: stripeCustomerId,
      coupon_code_used: couponCode,
      order_savings_total_cents: savingsCents,
      order_savings_code_cents: savingsCents,
      order_savings_auto_cents: 0,
      subtotal_original_cents: subtotalOriginalCents,
      subtotal_paid_cents: subtotalPaidCents,
      tax_cents: taxCents,
      shipping_paid_cents: shippingPaidCents,
      total_paid_cents: totalPaidCents,
      total_items: totalItems,
      total_weight_g: totalWeightG,
      order_cost_total_cents: orderCostCents,
      first_name: firstName,
      last_name: lastName,
      email,
      phone_number: phone,
      street_address: street,
      city,
      state,
      zip,
      country,
      order_date: orderDate,
    });

    // ── line_items_raw (per line) ──
    for (let idx = 0; idx < lines.length; idx++) {
      const ln = lines[idx];
      const qty = Math.max(1, parseInt(ln.Quantity) || 1);

      const lineUnitDollars = parseDollars(ln["Unit Price"]);
      const linePostDollars = parseDollars(ln["Post Discount"]);

      // Convert line totals → per-unit cents (clamp negatives — refunds)
      const unitPriceCents = Math.max(0, qty > 0 ? Math.round((lineUnitDollars / qty) * 100) : 0);
      const postDiscountCents = Math.max(0, qty > 0 ? Math.round((linePostDollars / qty) * 100) : 0);

      const itemWeightG = ozToGrams(ln["Item Weight"] || "0");

      lineItemsPayload.push({
        order_date: orderDate,
        stripe_checkout_session_id: sessionId,
        stripe_line_item_id: `legacy_${orderId}_li_${idx + 1}`,
        product_id: clean(ln["Product ID"]),
        product_name: clean(ln["Product Name"]),
        variant: clean(ln["Varient"]), // CSV has typo "Varient"
        quantity: qty,
        item_weight_g: itemWeightG,
        unit_price_cents: unitPriceCents,
        post_discount_unit_price_cents: postDiscountCents,
      });
    }

    // ── fulfillment_shipments ──
    const labelStatus =
      fulfilledStr === "yes" ? "delivered" : "pending";

    const shipRow = {
      stripe_checkout_session_id: sessionId,
      kk_order_id: kkOrderId,
      label_status: labelStatus,
      label_cost_cents: toCents(estShipCost),
      shipped_at: labelStatus === "delivered" ? orderDate : null,
    };

    shipmentPayload.push(shipRow);
  }

  // ─── 5. Summary ──────────────────────────────────────
  console.log("┌─────────────────────────────────────┐");
  console.log(`│  orders_raw:           ${String(ordersPayload.length).padStart(4)} rows   │`);
  console.log(`│  line_items_raw:       ${String(lineItemsPayload.length).padStart(4)} rows   │`);
  console.log(`│  fulfillment_shipments:${String(shipmentPayload.length).padStart(4)} rows   │`);
  console.log("└─────────────────────────────────────┘\n");

  // Show a few sample orders
  console.log("── Sample orders (first 3) ──");
  for (const o of ordersPayload.slice(0, 3)) {
    const lineCount = lineItemsPayload.filter(
      (l) => l.stripe_checkout_session_id === o.stripe_checkout_session_id
    ).length;
    console.log(
      `   ${o.kk_order_id} | ${o.order_date.slice(0, 10)} | ` +
        `${o.first_name || "?"} ${o.last_name || ""} | ` +
        `$${(o.total_paid_cents / 100).toFixed(2)} | ${lineCount} item(s)`
    );
  }

  // Show last order
  const last = ordersPayload[ordersPayload.length - 1];
  if (last) {
    const lastLines = lineItemsPayload.filter(
      (l) => l.stripe_checkout_session_id === last.stripe_checkout_session_id
    ).length;
    console.log(
      `   ...\n   ${last.kk_order_id} | ${last.order_date.slice(0, 10)} | ` +
        `${last.first_name || "?"} ${last.last_name || ""} | ` +
        `$${(last.total_paid_cents / 100).toFixed(2)} | ${lastLines} item(s)`
    );
  }
  console.log();

  // ─── 6. Upsert to Supabase ──────────────────────────
  if (DRY_RUN) {
    console.log("🔍 DRY RUN complete — no data was written to Supabase.");
    console.log("   Remove --dry-run to perform the actual import.\n");

    // Optionally dump JSON for inspection
    // writeFileSync('debug-orders.json', JSON.stringify(ordersPayload, null, 2));
    // writeFileSync('debug-lineitems.json', JSON.stringify(lineItemsPayload, null, 2));
    // writeFileSync('debug-shipments.json', JSON.stringify(shipmentPayload, null, 2));
    return;
  }

  console.log("📤 Upserting to Supabase...\n");

  // 1) Orders (parent rows first)
  await upsertBatch(
    "orders_raw",
    ordersPayload,
    "stripe_checkout_session_id"
  );

  // 2) Line items
  await upsertBatch(
    "line_items_raw",
    lineItemsPayload,
    "stripe_checkout_session_id,stripe_line_item_id"
  );

  // 3) Fulfillment / shipments
  await upsertBatch(
    "fulfillment_shipments",
    shipmentPayload,
    "stripe_checkout_session_id"
  );

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  🎉 Import complete!");
  console.log(`     ${ordersPayload.length} orders`);
  console.log(`     ${lineItemsPayload.length} line items`);
  console.log(`     ${shipmentPayload.length} shipments`);
  console.log("══════════════════════════════════════════════════════\n");
  console.log("Go check your admin pages:");
  console.log("   → lineItemsRaw.html");
  console.log("   → lineItemsOrders.html");
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  if (err.message.includes("401") || err.message.includes("403")) {
    console.error("   → Likely a bad or expired key. Use the service_role key (not anon).");
  }
  process.exit(1);
});
