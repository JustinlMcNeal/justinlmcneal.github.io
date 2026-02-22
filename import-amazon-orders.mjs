// import-amazon-orders.mjs
// Usage: node import-amazon-orders.mjs <SERVICE_ROLE_KEY> <TSV_FILE_PATH>
//
// Imports Amazon Seller Central "All Orders" report (TSV) into
// orders_raw + line_items_raw alongside Stripe and legacy orders.
//
// Safe to re-run — skips already-imported order IDs.

import { readFileSync } from "fs";

const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";
const SERVICE_KEY  = process.argv[2];
const TSV_PATH     = process.argv[3];

if (!SERVICE_KEY || !TSV_PATH) {
  console.error("Usage: node import-amazon-orders.mjs <SERVICE_ROLE_KEY> <TSV_FILE>");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation"
};

// ── Amazon SKU → KK product code mapping ────────────────────────
// Add new SKUs here when you list new products on Amazon.
const SKU_MAP = {
  "B4-322V-67TS": "KK-0013",   // Pearl Heart Cherry Bag Charm
  "WJ-8PFO-2XHO": "KK-0059",  // Kawaii Pudding Cup Keychain (Yellow variant)
  "39-SL7O-N5GV": "KK-0059",  // Kawaii Pudding Cup Keychain (Pink variant)
};

// Variant extraction from Amazon product name (parenthetical at end)
function extractVariant(productName, sku) {
  // Try to extract variant from product name like "...Set of 2 (Yellow)"
  const match = productName?.match(/\(([^)]+)\)\s*$/);
  if (match) return match[1];

  // Fallback: use SKU difference if both map to same product
  return null;
}

// ── Parse TSV ───────────────────────────────────────────────────
function parseTSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error("TSV file has no data rows.");

  // Header row — trim whitespace from column names
  const hdr = lines[0].split("\t").map(h => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t").map(c => c.trim());
    const obj = {};
    hdr.forEach((h, j) => { obj[h] = cols[j] || ""; });
    rows.push(obj);
  }
  return rows;
}

function cents(dollarStr) {
  const n = parseFloat(dollarStr);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

// ── Supabase helpers ────────────────────────────────────────────
async function upsert(table, rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(rows)
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Upsert ${table} failed: ${JSON.stringify(body)}`);
  return body;
}

async function query(table, params = "") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  return r.json();
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log("=== Amazon Orders Import ===\n");

  // 1. Read & parse TSV
  const raw = readFileSync(TSV_PATH, "utf-8");
  const amazonRows = parseTSV(raw);
  console.log(`1. Parsed ${amazonRows.length} rows from TSV.\n`);

  // 2. Filter: skip cancelled, keep only Shipped/Unshipped
  const validRows = amazonRows.filter(r => {
    const status = r["order-status"] || "";
    if (status === "Cancelled") {
      console.log(`   SKIP (Cancelled): ${r["amazon-order-id"]}`);
      return false;
    }
    return true;
  });
  console.log(`   ${validRows.length} valid orders (${amazonRows.length - validRows.length} cancelled).\n`);

  // 3. Check for already-imported orders
  const amazonOrderIds = [...new Set(validRows.map(r => r["amazon-order-id"]))];
  const sessionIds = amazonOrderIds.map(id => `amazon_${id}`);

  const existing = await query(
    "orders_raw",
    `select=stripe_checkout_session_id&stripe_checkout_session_id=in.(${sessionIds.map(s => `"${s}"`).join(",")})`
  );
  const existingSet = new Set((existing || []).map(r => r.stripe_checkout_session_id));
  
  const newRows = validRows.filter(r => !existingSet.has(`amazon_${r["amazon-order-id"]}`));
  console.log(`2. ${existingSet.size} orders already imported, ${newRows.length} new to import.\n`);

  if (newRows.length === 0) {
    console.log("   Nothing new to import. Done!");
    return;
  }

  // 4. Fetch products for weight lookup
  const products = await query("products", "select=code,name,weight_g,unit_cost");
  const prodMap = {};
  for (const p of (products || [])) {
    prodMap[p.code] = p;
  }

  // 5. Group by order (Amazon can have multi-item orders on separate rows)
  const orderMap = {};
  for (const r of newRows) {
    const orderId = r["amazon-order-id"];
    if (!orderMap[orderId]) {
      orderMap[orderId] = {
        amazonOrderId: orderId,
        purchaseDate: r["purchase-date"],
        status: r["order-status"],
        shipCity: r["ship-city"],
        shipState: r["ship-state"],
        shipZip: r["ship-postal-code"],
        shipCountry: r["ship-country"],
        items: []
      };
    }
    orderMap[orderId].items.push(r);
  }

  const orders = Object.values(orderMap);
  console.log(`3. Grouped into ${orders.length} unique orders.\n`);

  // 6. Build rows
  const orderRows = [];
  const lineItemRows = [];
  const unmappedSkus = new Set();
  let totalItemsCents = 0;
  let totalShipCents = 0;

  for (const order of orders) {
    const sessionId = `amazon_${order.amazonOrderId}`;
    const shortId = order.amazonOrderId.split("-").pop();
    const kkOrderId = `AMZ-${shortId}`;

    let orderSubtotalCents = 0;
    let orderTaxCents = 0;
    let orderShipCents = 0;
    let orderShipTaxCents = 0;
    let totalQty = 0;
    let totalWeightG = 0;
    let orderCostCents = 0;

    // Process each line item
    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      const sku = item["sku"] || "";
      const kkCode = SKU_MAP[sku] || null;
      const product = kkCode ? prodMap[kkCode] : null;

      if (!kkCode) unmappedSkus.add(sku);

      const qty = parseInt(item["quantity"]) || 1;
      const itemPriceCents = cents(item["item-price"]);
      const itemTaxCents = cents(item["item-tax"]);
      const shipPriceCents = cents(item["shipping-price"]);
      const shipTaxCents = cents(item["shipping-tax"]);
      const unitPriceCents = qty > 0 ? Math.round(itemPriceCents / qty) : itemPriceCents;

      const weightG = product?.weight_g || null;
      const variant = extractVariant(item["product-name"], sku);

      orderSubtotalCents += itemPriceCents;
      orderTaxCents += itemTaxCents;
      orderShipCents += shipPriceCents;
      orderShipTaxCents += shipTaxCents;
      totalQty += qty;
      if (weightG) totalWeightG += weightG * qty;

      // Cost calculation for order_cost_total_cents
      if (product?.unit_cost) {
        orderCostCents += Math.round(product.unit_cost * 100) * qty;
      }

      lineItemRows.push({
        stripe_checkout_session_id: sessionId,
        stripe_line_item_id: `amazon_${order.amazonOrderId}_li_${i}`,
        order_date: order.purchaseDate,
        product_id: kkCode || sku,
        product_name: item["product-name"] || "",
        variant: variant,
        quantity: qty,
        unit_price_cents: unitPriceCents,
        post_discount_unit_price_cents: unitPriceCents,  // Amazon doesn't show pre-discount
        item_weight_g: weightG
      });
    }

    const totalPaidCents = orderSubtotalCents + orderTaxCents + orderShipCents + orderShipTaxCents;
    totalItemsCents += orderSubtotalCents;
    totalShipCents += orderShipCents;

    orderRows.push({
      stripe_checkout_session_id: sessionId,
      kk_order_id: kkOrderId,
      order_date: order.purchaseDate,
      total_items: totalQty,
      subtotal_original_cents: orderSubtotalCents,
      subtotal_paid_cents: orderSubtotalCents,
      tax_cents: orderTaxCents,
      shipping_paid_cents: orderShipCents + orderShipTaxCents,
      total_paid_cents: totalPaidCents,
      total_weight_g: totalWeightG || null,
      order_savings_total_cents: 0,
      order_savings_code_cents: 0,
      order_savings_auto_cents: 0,
      coupon_code_used: null,
      first_name: null,
      last_name: null,
      email: null,
      phone_number: null,
      street_address: null,
      city: order.shipCity || null,
      state: order.shipState || null,
      zip: order.shipZip || null,
      country: order.shipCountry || null,
      stripe_customer_id: null,
      order_cost_total_cents: orderCostCents || null
    });
  }

  // 7. Insert
  console.log("4. Inserting into database...\n");

  // Insert orders
  const insertedOrders = await upsert("orders_raw", orderRows);
  console.log(`   ✅ Orders inserted: ${insertedOrders.length}`);

  // Insert line items
  const insertedLI = await upsert("line_items_raw", lineItemRows);
  console.log(`   ✅ Line items inserted: ${insertedLI.length}`);

  // 8. Summary
  console.log(`\n=== Summary ===`);
  console.log(`   Orders imported:    ${insertedOrders.length}`);
  console.log(`   Line items:         ${insertedLI.length}`);
  console.log(`   Item revenue:       $${(totalItemsCents / 100).toFixed(2)}`);
  console.log(`   Shipping collected: $${(totalShipCents / 100).toFixed(2)}`);

  if (unmappedSkus.size > 0) {
    console.log(`\n   ⚠️  Unmapped Amazon SKUs (add to SKU_MAP in the script):`);
    for (const s of unmappedSkus) {
      console.log(`      "${s}"`);
    }
  }

  // 9. Product breakdown
  const prodBreakdown = {};
  for (const li of lineItemRows) {
    const key = li.product_id;
    if (!prodBreakdown[key]) prodBreakdown[key] = { name: li.product_name, qty: 0, cents: 0 };
    prodBreakdown[key].qty += li.quantity;
    prodBreakdown[key].cents += li.post_discount_unit_price_cents * li.quantity;
  }
  console.log(`\n   Product breakdown:`);
  for (const [code, p] of Object.entries(prodBreakdown).sort((a, b) => b[1].cents - a[1].cents)) {
    const name = p.name.length > 40 ? p.name.slice(0, 37) + "…" : p.name;
    console.log(`     ${code.padEnd(14)} ${String(p.qty).padEnd(3)} units  $${(p.cents / 100).toFixed(2).padStart(7)}  ${name}`);
  }

  console.log("\n✅ Done!");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
