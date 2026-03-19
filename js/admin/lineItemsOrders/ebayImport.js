// /js/admin/lineItemsOrders/ebayImport.js
// Browser-side eBay "Orders Report" CSV importer.
// Parses eBay's CSV export format and inserts via the same
// rpc_import_amazon_orders RPC (identical order/line-item shape).

import { getSupabaseClient } from "/js/shared/supabaseClient.js";

// ── helpers ─────────────────────────────────────────────────────

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Normalize a string for fuzzy matching —
 * lowercase, strip punctuation, collapse whitespace.
 */
function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Crude stemmer: strip common English suffixes so "bunnies" ≈ "bunny", etc.
 */
function stem(w) {
  return w
    .replace(/ies$/, "y")   // bunnies → bunny
    .replace(/es$/, "")     // plushies → plushi (close enough for overlap)
    .replace(/s$/, "");     // charms → charm
}

/**
 * Try to match an eBay item title to a product in the DB.
 * Returns the product `code` or null.
 *
 * Strategy (in order):
 *  1. Exact normalised match  (norm(ebayTitle) === norm(productName))
 *  2. Strip bracket text (e.g. "[Pink]") from eBay title and re-check exact
 *  3. Product name is a substring of the eBay title (or vice-versa)
 *  4. Token-overlap score with stemming: pick the product with the most shared
 *     root words (at least 2 shared tokens required)
 */
function matchProduct(ebayTitle, products) {
  const t = norm(ebayTitle);
  if (!t) return null;

  // Also build a version with eBay bracket notation stripped:
  // "Mini Tote - Heart Embossed[Pink]" → "mini tote heart embossed"
  const tNoBrackets = norm((ebayTitle || "").replace(/\[[^\]]*\]/g, ""));

  // Pass 1 — exact
  for (const p of products) {
    const n = norm(p.name);
    if (n === t || n === tNoBrackets) return p.code;
  }

  // Pass 2 — substring matches (try both with and without bracket text)
  for (const p of products) {
    const n = norm(p.name);
    if (t.includes(n) || n.includes(t)) return p.code;
    if (tNoBrackets && (tNoBrackets.includes(n) || n.includes(tNoBrackets))) return p.code;
  }

  // Pass 3 — token overlap with stemming (at least 2+ meaningful shared tokens)
  const tTokens = new Set(t.split(" ").filter(w => w.length > 2).map(stem));
  let bestCode = null;
  let bestScore = 1; // need at least 2 shared tokens
  for (const p of products) {
    const pTokens = norm(p.name).split(" ").filter(w => w.length > 2).map(stem);
    let score = 0;
    for (const w of pTokens) if (tTokens.has(w)) score++;
    if (score > bestScore) { bestScore = score; bestCode = p.code; }
  }
  return bestCode;
}

/** Parse RFC 4180 CSV (handles quoted fields with embedded commas/newlines). */
function parseCSV(text) {
  const raw = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let i = 0;

  function readField() {
    if (i >= raw.length) return "";
    if (raw[i] === '"') {
      // quoted field
      i++; // skip opening quote
      let val = "";
      while (i < raw.length) {
        if (raw[i] === '"') {
          if (raw[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += raw[i];
          i++;
        }
      }
      return val;
    } else {
      // unquoted
      let val = "";
      while (i < raw.length && raw[i] !== "," && raw[i] !== "\n") {
        val += raw[i];
        i++;
      }
      return val;
    }
  }

  while (i < raw.length) {
    const row = [];
    while (true) {
      row.push(readField());
      if (i < raw.length && raw[i] === ",") { i++; continue; }
      if (i < raw.length && raw[i] === "\n") { i++; break; }
      break; // EOF
    }
    rows.push(row);
  }

  return rows;
}

function cents(dollarStr) {
  if (!dollarStr) return 0;
  const n = parseFloat(dollarStr.replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/**
 * Parse eBay date string like "Dec-30-25" → ISO "2025-12-30T00:00:00Z"
 * or "Mar 15, 2026, 2:14 PM" → proper date.
 */
function parseEbayDate(str) {
  if (!str) return null;
  str = str.trim();

  // Format: "Dec-30-25"
  const m1 = str.match(/^([A-Za-z]{3})-(\d{1,2})-(\d{2})$/);
  if (m1) {
    const months = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
    };
    const mon = months[m1[1].toLowerCase()] || "01";
    const day = m1[2].padStart(2, "0");
    const yr = parseInt(m1[3]) + 2000;
    return `${yr}-${mon}-${day}T00:00:00Z`;
  }

  // Fallback: try native parsing
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ── parseEbayCSV (exported for preview) ─────────────────────────

export function parseEbayCSV(text) {
  const csvRows = parseCSV(text);
  const errors = [];
  const valid = [];

  if (csvRows.length < 2) {
    errors.push("CSV has no data rows.");
    return { total: 0, valid: [], errors };
  }

  // First row may be all commas (eBay puts a blank row before headers)
  // Find the header row (contains "Order Number" or "Sales Record Number")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(csvRows.length, 5); i++) {
    const joined = csvRows[i].join(",").toLowerCase();
    if (joined.includes("order number") || joined.includes("sales record number")) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    errors.push('Could not find header row — is this an eBay Orders CSV?');
    return { total: 0, valid: [], errors };
  }

  const headers = csvRows[headerIdx].map(h => h.trim());
  const col = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 && idx < row.length ? row[idx].trim() : "";
  };

  // Parse data rows
  for (let i = headerIdx + 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (!row || row.length < 5) continue;

    const orderNumber = col(row, "Order Number");
    const salesRecordNumber = col(row, "Sales Record Number");

    // Skip empty rows, summary rows, footer rows
    if (!orderNumber && !salesRecordNumber) continue;
    if (/^\d+,record/.test(row.join(",").toLowerCase())) continue;
    if (/^seller id/i.test(row.join(",").toLowerCase())) continue;

    // Skip the blank data row eBay puts after headers
    if (!orderNumber && !col(row, "Item Title")) continue;

    const itemTitle = col(row, "Item Title");
    const soldFor = col(row, "Sold For");
    const shippingAndHandling = col(row, "Shipping And Handling");
    const saleDate = col(row, "Sale Date");
    const paidOnDate = col(row, "Paid On Date");
    const quantity = parseInt(col(row, "Quantity")) || 1;
    const totalPrice = col(row, "Total Price");
    const trackingNumber = col(row, "Tracking Number");
    const shippingService = col(row, "Shipping Service");
    const itemNumber = col(row, "Item Number");
    const transactionId = col(row, "Transaction ID");
    const variationDetails = col(row, "Variation Details");
    const buyerUsername = col(row, "Buyer Username");

    // Ship-to info
    const shipToName = col(row, "Ship To Name");
    const shipToCity = col(row, "Ship To City") || col(row, "Buyer City");
    const shipToState = col(row, "Ship To State") || col(row, "Buyer State");
    const shipToZip = col(row, "Ship To Zip") || col(row, "Buyer Zip");
    const shipToCountry = col(row, "Ship To Country") || col(row, "Buyer Country");

    // Tax & fees
    const ebayCollectedTax = col(row, "eBay Collected Tax");
    const sellerCollectedTax = col(row, "Seller Collected Tax");

    // Parse the sale/paid date
    const orderDate = parseEbayDate(paidOnDate) || parseEbayDate(saleDate) || null;

    if (!orderDate) continue; // Skip rows without a valid date

    const soldForCents = cents(soldFor);
    const shippingCents = cents(shippingAndHandling);
    const taxCents = cents(ebayCollectedTax) + cents(sellerCollectedTax);
    const totalCents = cents(totalPrice) || (soldForCents + shippingCents + taxCents);

    valid.push({
      orderNumber,
      salesRecordNumber,
      itemNumber,
      transactionId,
      itemTitle,
      variationDetails,
      quantity,
      soldForCents,
      shippingCents,
      taxCents,
      totalCents,
      orderDate,
      trackingNumber,
      shippingService,
      buyerUsername,
      shipToName,
      shipToCity,
      shipToState,
      shipToZip,
      shipToCountry,
    });
  }

  return { total: csvRows.length - headerIdx - 1, valid, errors };
}

// ── importEbayOrders (actual DB insert) ─────────────────────────

export async function importEbayOrders(validRows) {
  const supabase = getSupabaseClient();

  // 1. Fetch all products for title → code matching
  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("code, name, weight_g, unit_cost");

  if (prodErr) console.error("[eBay import] Failed to fetch products:", prodErr.message);
  if (!products?.length) console.warn("[eBay import] Products list is empty — product matching will be skipped.");

  const prodMap = {};
  for (const p of (products || [])) prodMap[p.code] = p;
  const unmappedTitles = new Set();

  // 2. Group by order number (one eBay order can have multiple items)
  const orderMap = {};
  for (const r of validRows) {
    const id = r.orderNumber || `sr_${r.salesRecordNumber}`;
    if (!orderMap[id]) {
      orderMap[id] = {
        orderNumber: r.orderNumber,
        salesRecordNumber: r.salesRecordNumber,
        orderDate: r.orderDate,
        buyerUsername: r.buyerUsername,
        shipToName: r.shipToName,
        shipToCity: r.shipToCity,
        shipToState: r.shipToState,
        shipToZip: r.shipToZip,
        shipToCountry: r.shipToCountry,
        trackingNumber: r.trackingNumber,
        shippingService: r.shippingService,
        items: [],
      };
    }
    orderMap[id].items.push(r);
  }

  // 3. Build order + line-item rows
  const orderDbRows = [];
  const lineItemDbRows = [];
  let totalRevenueCents = 0;
  const breakdown = {};

  for (const order of Object.values(orderMap)) {
    const sessionId = `ebay_${order.orderNumber || order.salesRecordNumber}`;
    const shortId = order.salesRecordNumber || order.orderNumber.split("-").pop();
    const kkOrderId = `EBAY-${shortId}`;

    let orderSubtotalCents = 0;
    let orderTaxCents = 0;
    let orderShipCents = 0;
    let totalQty = 0;
    let totalWeightG = 0;
    let orderCostCents = 0;

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      const qty = item.quantity;
      const unitPriceCents = qty > 0 ? Math.round(item.soldForCents / qty) : item.soldForCents;

      // Match eBay title → product code
      const kkCode = matchProduct(item.itemTitle, products || []);
      const product = kkCode ? prodMap[kkCode] : null;

      if (!kkCode) unmappedTitles.add(item.itemTitle);

      const weightG = product?.weight_g || 0;
      totalWeightG += weightG * qty;
      if (product?.unit_cost) orderCostCents += Math.round(product.unit_cost * 100) * qty;

      orderSubtotalCents += item.soldForCents;
      orderTaxCents += item.taxCents;
      orderShipCents += item.shippingCents;
      totalQty += qty;

      // Parse variant from "[Set:Ghost Face]" or "Set:Ghost Face" style
      let variant = null;
      if (item.variationDetails) {
        const vm = item.variationDetails.match(/\[([^\]]+)\]/);
        if (vm) {
          variant = vm[1];
        } else {
          // Try "Key:Value" format
          const kv = item.variationDetails.match(/:\s*(.+)/);
          if (kv) variant = kv[1].trim();
        }
      }

      // product_id MUST be a KK product code — never store eBay item numbers
      // (they'd break the product lookup in order details).
      const pid = kkCode || null;
      const breakdownKey = kkCode || item.itemNumber || `ebay_item_${i}`;
      if (!breakdown[breakdownKey]) breakdown[breakdownKey] = { name: product?.name || item.itemTitle || breakdownKey, qty: 0, cents: 0 };
      breakdown[breakdownKey].qty += qty;
      breakdown[breakdownKey].cents += item.soldForCents;

      lineItemDbRows.push({
        stripe_checkout_session_id: sessionId,
        stripe_line_item_id: `ebay_${order.orderNumber || order.salesRecordNumber}_li_${item.transactionId || i}`,
        order_date: item.orderDate,
        product_id: pid,
        product_name: product?.name || item.itemTitle || "",
        variant,
        quantity: qty,
        unit_price_cents: unitPriceCents,
        post_discount_unit_price_cents: unitPriceCents,
        item_weight_g: weightG,
      });
    }

    const totalPaidCents = orderSubtotalCents + orderTaxCents + orderShipCents;
    totalRevenueCents += orderSubtotalCents;

    orderDbRows.push({
      stripe_checkout_session_id: sessionId,
      kk_order_id: kkOrderId,
      order_date: order.orderDate,
      total_items: totalQty,
      subtotal_original_cents: orderSubtotalCents,
      subtotal_paid_cents: orderSubtotalCents,
      tax_cents: orderTaxCents,
      shipping_paid_cents: orderShipCents,
      total_paid_cents: totalPaidCents,
      total_weight_g: totalWeightG,
      order_savings_total_cents: 0,
      order_savings_code_cents: 0,
      order_savings_auto_cents: 0,
      coupon_code_used: null,
      first_name: order.shipToName || null,
      last_name: null,
      email: null,
      phone_number: null,
      street_address: null,
      city: order.shipToCity || null,
      state: order.shipToState || null,
      zip: order.shipToZip || null,
      country: order.shipToCountry || null,
      stripe_customer_id: null,
      order_cost_total_cents: orderCostCents || null,
      // Fulfillment fields (read by the generic RPC)
      shipped_at: order.orderDate,
      label_cost_cents: 0,
      carrier: "eBay",
      shipping_service: order.shippingService || "eBay Standard",
      tracking_number: order.trackingNumber || null,
      import_notes: "Imported from eBay Orders CSV",
    });
  }

  // 4. Insert via RPC (SECURITY DEFINER, handles dedup via upsert)
  const { data: rpcResult, error: rpcErr } = await supabase.rpc("rpc_import_amazon_orders", {
    p_orders: orderDbRows,
    p_items: lineItemDbRows,
  });

  if (rpcErr) throw new Error(`eBay import RPC failed: ${rpcErr.message}`);

  const r = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  return {
    ordersInserted: r?.orders_count || orderDbRows.length,
    lineItemsInserted: r?.items_count || lineItemDbRows.length,
    skippedDuplicates: 0,
    revenue: totalRevenueCents,
    breakdown,
    unmappedTitles: [...unmappedTitles],
  };
}

// ── rematchEbayProducts ─────────────────────────────────────────
/**
 * Re-run product matching on existing eBay line items that have
 * a null or numeric (eBay item number) product_id.
 * Fetches all products, re-matches titles, and updates line_items_raw.
 * Returns { matched, unmatched, errors }.
 */
export async function rematchEbayProducts() {
  const supabase = getSupabaseClient();

  // 1. Fetch all products
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("code, name, weight_g, unit_cost");

  if (pErr) throw new Error(`Failed to fetch products: ${pErr.message}`);
  if (!products?.length) throw new Error("No products in database — add products first.");

  // 2. Fetch eBay line items that need re-matching
  //    (product_id is null OR doesn't start with "KK")
  const { data: lines, error: lErr } = await supabase
    .from("v_order_lines")
    .select("line_item_row_id, product_id, product_name, stripe_checkout_session_id")
    .like("stripe_checkout_session_id", "ebay_%");

  if (lErr) throw new Error(`Failed to fetch eBay line items: ${lErr.message}`);

  const needsRematch = (lines || []).filter(li =>
    !li.product_id || !/^KK[-_]/.test(li.product_id)
  );

  if (!needsRematch.length) return { matched: 0, unmatched: 0, errors: [], total: (lines || []).length };

  // 3. Re-match each line item and collect updates
  let matched = 0;
  let unmatched = 0;
  const errors = [];
  const unmappedTitles = [];
  const batchUpdates = [];

  // Build product lookup map
  const prodMap = {};
  for (const p of products) prodMap[p.code] = p;

  for (const li of needsRematch) {
    const title = li.product_name || "";
    const code = matchProduct(title, products);

    if (!code) {
      unmatched++;
      unmappedTitles.push(title);
      continue;
    }

    const product = prodMap[code];
    batchUpdates.push({
      line_item_id: li.line_item_row_id,
      product_id: code,
      product_name: product?.name || title,
      item_weight_g: product?.weight_g || 0,
    });
    matched++;
    console.log(`[rematch] "${title}" → ${code}`);
  }

  // 4. Batch-update via SECURITY DEFINER RPC (bypasses RLS)
  if (batchUpdates.length) {
    const { data: rpcResult, error: rpcErr } = await supabase.rpc(
      "rpc_batch_update_line_item_products",
      { p_updates: batchUpdates }
    );
    if (rpcErr) {
      errors.push(`Batch update RPC failed: ${rpcErr.message}`);
      matched = 0; // none actually updated
    } else {
      const r = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
      console.log("[rematch] RPC result:", r);
    }
  }

  if (unmappedTitles.length) {
    console.warn("[rematch] Unmapped titles:", unmappedTitles);
  }

  return { matched, unmatched, errors, total: (lines || []).length, unmappedTitles };
}

// ── wireEbayImport (click + drag-drop UI) ───────────────────────

export function wireEbayImport({
  buttonEl,
  setStatus,
  showPreview,
  onImported,
} = {}) {
  if (!buttonEl) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,text/csv";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  const isValidFile = (f) => f?.name?.toLowerCase().endsWith(".csv");

  async function handleFile(file) {
    if (!file) return;
    if (!isValidFile(file)) {
      setStatus?.("Please drop an eBay Orders CSV file.", true);
      return;
    }
    try {
      setStatus?.(`Reading ${file.name}…`);
      const text = await file.text();
      const parsed = parseEbayCSV(text);

      if (parsed.errors.length) throw new Error(parsed.errors.join(" | "));
      if (!parsed.valid.length) throw new Error("No importable rows found in the CSV.");

      if (showPreview) {
        showPreview({ fileName: file.name, parsed, onConfirm: () => doImport(parsed) });
        setStatus?.(`${parsed.valid.length} eBay orders ready to import.`);
      } else {
        await doImport(parsed);
      }
    } catch (e) {
      console.error(e);
      setStatus?.(`eBay import failed: ${e?.message || e}`, true);
    }
  }

  async function doImport(parsed) {
    try {
      setStatus?.("Importing eBay orders…");
      const result = await importEbayOrders(parsed.valid);
      setStatus?.(`Done! ${result.ordersInserted} orders, ${result.lineItemsInserted} line items imported.`);
      onImported?.(result);
    } catch (e) {
      console.error(e);
      setStatus?.(`eBay import failed: ${e?.message || e}`, true);
    }
  }

  // click to pick file
  buttonEl.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    await handleFile(file);
  });

  // drag & drop
  const DROP_CLASS = "is-drop-active";
  buttonEl.addEventListener("dragenter", e => { e.preventDefault(); buttonEl.classList.add(DROP_CLASS); });
  buttonEl.addEventListener("dragover", e => { e.preventDefault(); buttonEl.classList.add(DROP_CLASS); });
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
