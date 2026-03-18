// /js/admin/lineItemsOrders/amazonImport.js
// Browser-side Amazon "All Orders" TSV importer.
// Mirrors the logic from import-amazon-orders.mjs but runs client-side.
// Uses the shared Supabase client (same session as admin guard) and
// calls the rpc_import_amazon_orders SECURITY DEFINER function.

import { getSupabaseClient } from "/js/shared/supabaseClient.js";

// ── Amazon SKU → KK product code mapping ────────────────────────
// Add new SKUs here when you list new products on Amazon.
const SKU_MAP = {
  "B4-322V-67TS": "KK-0013",   // Pearl Heart Cherry Bag Charm
  "WJ-8PFO-2XHO": "KK-0059",  // Kawaii Pudding Cup Keychain (Yellow variant)
  "39-SL7O-N5GV": "KK-0059",  // Kawaii Pudding Cup Keychain (Pink variant)
};

// ── USPS label cost estimator ───────────────────────────────────
// Estimates domestic USPS Ground Advantage label cost based on package weight.
// Derived from real Pirate Ship label data + published USPS rates.
// Adds ~30g for packaging (bubble mailer).
// Returns cents.
const PACKAGING_WEIGHT_G = 30; // bubble mailer

function estimateLabelCostCents(totalItemWeightG) {
  const packageOz = (totalItemWeightG + PACKAGING_WEIGHT_G) / 28.35;
  // USPS Ground Advantage 2026 approximate pricing tiers:
  //   ≤4 oz  → ~$4.00  (letters/flats)
  //   ≤8 oz  → ~$4.85
  //   ≤13 oz → ~$5.30
  //   ≤1 lb  → ~$5.80
  //   >1 lb  → ~$6.50 + $0.40/extra 4oz
  if (packageOz <= 4) return 400;
  if (packageOz <= 8) return 485;
  if (packageOz <= 13) return 530;
  if (packageOz <= 16) return 580;
  return 650 + Math.ceil((packageOz - 16) / 4) * 40;
}

// ── helpers ─────────────────────────────────────────────────────

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseTSV(text) {
  const raw = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter(l => l.trim());
  if (lines.length < 2) throw new Error("TSV file has no data rows.");
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

function extractVariant(productName) {
  const m = productName?.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : null;
}

// ── parseAmazonTSV (exported for preview) ───────────────────────

export function parseAmazonTSV(text) {
  const amazonRows = parseTSV(text);
  const errors = [];
  const cancelled = [];
  const valid = [];

  for (const r of amazonRows) {
    const status = r["order-status"] || "";
    if (status === "Cancelled") {
      cancelled.push(r["amazon-order-id"]);
    } else {
      valid.push(r);
    }
  }

  // Check we have expected columns
  if (valid.length && !valid[0]["amazon-order-id"]) {
    errors.push('Missing "amazon-order-id" column — is this an Amazon "All Orders" TSV report?');
  }

  return { total: amazonRows.length, valid, cancelled, errors };
}

// ── importAmazonOrders (actual DB insert) ───────────────────────

export async function importAmazonOrders(validRows) {
  const supabase = getSupabaseClient();

  // 1. Fetch products for weight & cost lookup
  const { data: products } = await supabase
    .from("products")
    .select("code, name, weight_g, unit_cost");

  const prodMap = {};
  for (const p of (products || [])) prodMap[p.code] = p;

  // 2. Group by order (process ALL valid rows; upsert handles dedup)
  const orderMap = {};
  for (const r of validRows) {
    const id = r["amazon-order-id"];
    if (!orderMap[id]) {
      orderMap[id] = {
        amazonOrderId: id,
        purchaseDate: r["purchase-date"],
        shipCity: r["ship-city"],
        shipState: r["ship-state"],
        shipZip: r["ship-postal-code"],
        shipCountry: r["ship-country"],
        items: [],
      };
    }
    orderMap[id].items.push(r);
  }

  // 3. Build order + line-item rows
  const orderDbRows = [];
  const lineItemDbRows = [];
  const unmappedSkus = new Set();
  let totalItemsCents = 0;
  let totalShipCents = 0;
  const breakdown = {}; // code -> { name, qty, cents }

  for (const order of Object.values(orderMap)) {
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
      const variant = extractVariant(item["product-name"]);

      orderSubtotalCents += itemPriceCents;
      orderTaxCents += itemTaxCents;
      orderShipCents += shipPriceCents;
      orderShipTaxCents += shipTaxCents;
      totalQty += qty;
      if (weightG) totalWeightG += weightG * qty;
      if (product?.unit_cost) orderCostCents += Math.round(product.unit_cost * 100) * qty;

      const pid = kkCode || sku;
      if (!breakdown[pid]) breakdown[pid] = { name: item["product-name"] || sku, qty: 0, cents: 0 };
      breakdown[pid].qty += qty;
      breakdown[pid].cents += unitPriceCents * qty;

      lineItemDbRows.push({
        stripe_checkout_session_id: sessionId,
        stripe_line_item_id: `amazon_${order.amazonOrderId}_li_${i}`,
        order_date: order.purchaseDate,
        product_id: pid,
        product_name: item["product-name"] || "",
        variant,
        quantity: qty,
        unit_price_cents: unitPriceCents,
        post_discount_unit_price_cents: unitPriceCents,
        item_weight_g: weightG,
      });
    }

    const totalPaidCents = orderSubtotalCents + orderTaxCents + orderShipCents + orderShipTaxCents;
    totalItemsCents += orderSubtotalCents;
    totalShipCents += orderShipCents;

    orderDbRows.push({
      stripe_checkout_session_id: sessionId,
      kk_order_id: kkOrderId,
      order_date: order.purchaseDate,
      total_items: totalQty,
      subtotal_original_cents: orderSubtotalCents,
      subtotal_paid_cents: orderSubtotalCents,
      tax_cents: orderTaxCents,
      shipping_paid_cents: orderShipCents + orderShipTaxCents,
      total_paid_cents: totalPaidCents,
      total_weight_g: totalWeightG || 0,
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
      order_cost_total_cents: orderCostCents || null,
      // Fields used by fulfillment_shipments (step 3 in RPC)
      shipped_at: order.purchaseDate,  // Amazon orders ship same/next day
      label_cost_cents: totalWeightG ? estimateLabelCostCents(totalWeightG) : 400,
      carrier: "Amazon",
      shipping_service: "Fulfilled by Amazon",
      tracking_number: null,
      import_notes: "Imported from Amazon Seller Central",
    });
  }

  // 4. Insert via RPC (SECURITY DEFINER — bypasses RLS)
  const { data: rpcResult, error: rpcErr } = await supabase.rpc("rpc_import_amazon_orders", {
    p_orders: orderDbRows,
    p_items: lineItemDbRows,
  });

  if (rpcErr) throw new Error(`Amazon import RPC failed: ${rpcErr.message}`);

  const r = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  return {
    ordersInserted: r?.orders_count || orderDbRows.length,
    lineItemsInserted: r?.items_count || lineItemDbRows.length,
    skippedDuplicates: 0,
    revenue: totalItemsCents,
    shipping: totalShipCents,
    unmappedSkus: [...unmappedSkus],
    breakdown,
  };
}

// ── wireAmazonImport (drag-drop + click UI) ────────────────────

export function wireAmazonImport({
  buttonEl,
  setStatus,
  showPreview,   // ({ fileName, parsed, onConfirm }) => void
  onImported,    // (result) => void
} = {}) {
  if (!buttonEl) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".txt,.tsv,.csv,text/tab-separated-values";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  const isValidFile = (f) => {
    if (!f) return false;
    const n = f.name.toLowerCase();
    return n.endsWith(".txt") || n.endsWith(".tsv") || n.endsWith(".csv");
  };

  async function handleFile(file) {
    if (!file) return;
    if (!isValidFile(file)) {
      setStatus?.("Please drop an Amazon TSV/TXT report file.", true);
      return;
    }
    try {
      setStatus?.(`Reading ${file.name}…`);
      const text = await file.text();
      const parsed = parseAmazonTSV(text);

      if (parsed.errors.length) throw new Error(parsed.errors.join(" | "));
      if (!parsed.valid.length) throw new Error("No importable rows found (all cancelled?).");

      if (showPreview) {
        showPreview({ fileName: file.name, parsed, onConfirm: () => doImport(parsed) });
        setStatus?.(`${parsed.valid.length} orders ready to import.`);
      } else {
        await doImport(parsed);
      }
    } catch (e) {
      console.error(e);
      setStatus?.(`Amazon import failed: ${e?.message || e}`, true);
    }
  }

  async function doImport(parsed) {
    try {
      setStatus?.("Importing Amazon orders…");
      const result = await importAmazonOrders(parsed.valid);
      setStatus?.(`Done! ${result.ordersInserted} orders, ${result.lineItemsInserted} line items imported.`);
      onImported?.(result);
    } catch (e) {
      console.error(e);
      setStatus?.(`Amazon import failed: ${e?.message || e}`, true);
    }
  }

  // click to pick
  buttonEl.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    await handleFile(file);
  });

  // drag & drop
  const DROP_CLASS = "is-drop-active";
  buttonEl.addEventListener("dragenter", e => { e.preventDefault(); buttonEl.classList.add(DROP_CLASS); });
  buttonEl.addEventListener("dragover",  e => { e.preventDefault(); buttonEl.classList.add(DROP_CLASS); });
  buttonEl.addEventListener("dragleave", e => {
    e.preventDefault();
    if (e.relatedTarget && buttonEl.contains(e.relatedTarget)) return;
    buttonEl.classList.remove(DROP_CLASS);
  });
  buttonEl.addEventListener("drop", async e => {
    e.preventDefault();
    buttonEl.classList.remove(DROP_CLASS);
    await handleFile(e.dataTransfer?.files?.[0]);
  });
}
