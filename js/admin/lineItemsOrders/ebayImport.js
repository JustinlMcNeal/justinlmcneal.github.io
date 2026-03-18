// /js/admin/lineItemsOrders/ebayImport.js
// Browser-side eBay "Orders Report" CSV importer.
// Parses eBay's CSV export format and inserts via the same
// rpc_import_amazon_orders RPC (identical order/line-item shape).

import { getSupabaseClient } from "/js/shared/supabaseClient.js";

// ── helpers ─────────────────────────────────────────────────────

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
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

// ── USPS label cost estimator (same as Amazon importer) ─────────
function estimateLabelCostCents() {
  // eBay orders are typically small items; use 4oz rate
  return 400;
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

  // Group by order number (one eBay order can have multiple items)
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

  // Build order + line-item rows (same shape as Amazon importer)
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

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      const qty = item.quantity;
      const unitPriceCents = qty > 0 ? Math.round(item.soldForCents / qty) : item.soldForCents;

      orderSubtotalCents += item.soldForCents;
      orderTaxCents += item.taxCents;
      orderShipCents += item.shippingCents;
      totalQty += qty;

      // Parse variant from "[Set:Ghost Face]" style
      let variant = null;
      if (item.variationDetails) {
        const vm = item.variationDetails.match(/\[([^\]]+)\]/);
        if (vm) variant = vm[1];
      }

      const pid = item.itemNumber || `ebay_item_${i}`;
      if (!breakdown[pid]) breakdown[pid] = { name: item.itemTitle || pid, qty: 0, cents: 0 };
      breakdown[pid].qty += qty;
      breakdown[pid].cents += item.soldForCents;

      lineItemDbRows.push({
        stripe_checkout_session_id: sessionId,
        stripe_line_item_id: `ebay_${order.orderNumber || order.salesRecordNumber}_li_${item.transactionId || i}`,
        order_date: item.orderDate,
        product_id: pid,
        product_name: item.itemTitle || "",
        variant,
        quantity: qty,
        unit_price_cents: unitPriceCents,
        post_discount_unit_price_cents: unitPriceCents,
        item_weight_g: 0,
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
      total_weight_g: 0,
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
      order_cost_total_cents: null,
      // Fulfillment fields
      shipped_at: order.orderDate,
      label_cost_cents: estimateLabelCostCents(),
      tracking_number: order.trackingNumber || null,
      shipping_service: order.shippingService || null,
    });
  }

  // Insert via the same RPC (SECURITY DEFINER, handles dedup via upsert)
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
  };
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
