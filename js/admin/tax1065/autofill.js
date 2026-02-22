// js/admin/tax1065/autofill.js  –  Pull Supabase data → 1065 form shape
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── DB expense category → 1065 expense key ───────
   Categories now align 1:1 with IRS lines.
   COGS categories (Inventory, Supplies) are handled
   separately in Section D — not as expenses.
   ───────────────────────────────────────────────── */
const CATEGORY_MAP = {
  "Advertising":       "advertising",
  "Platform Fees":     "platformFees",
  "Shipping":          "shipping",
  "Software":          "software",
  "Website / Hosting": "website",
  "Office":            "office",
  "Phone / Internet":  "phoneInternet",
  "Travel / Meals":    "travelMeals",
  "Professional Fees": "professional",
  "Bank Fees":         "bankFees",
  "Vehicle":           "vehicle",    // IRS Line 9 (Car & Truck)
  "Other":             "other",
  // Inventory → Section D: Purchases  (not expenses)
  // Supplies  → Section D: Materials  (not expenses)
};

/**
 * Fetch orders, expenses & shipments for the tax year,
 * then return an object shaped for the 1065 form fields.
 *
 * @param {string} taxStart  "YYYY-MM-DD"
 * @param {string} taxEnd    "YYYY-MM-DD"
 */
export async function fetchAndAggregate(taxStart, taxEnd) {
  const [ordersRes, expensesRes, shipmentsRes] = await Promise.all([
    supabase
      .from("orders_raw")
      .select(
        "kk_order_id,order_date,total_paid_cents,subtotal_paid_cents," +
        "tax_cents,shipping_paid_cents,order_cost_total_cents"
      )
      .gte("order_date", taxStart)
      .lte("order_date", taxEnd + "T23:59:59.999Z"),

    supabase
      .from("expenses")
      .select("expense_date,category,description,amount_cents,vendor")
      .gte("expense_date", taxStart)
      .lte("expense_date", taxEnd + "T23:59:59.999Z")
      .order("expense_date", { ascending: true }),

    supabase
      .from("fulfillment_shipments")
      .select("label_cost_cents,carrier,shipped_at")
      .gte("shipped_at", taxStart)
      .lte("shipped_at", taxEnd + "T23:59:59.999Z"),
  ]);

  if (ordersRes.error)    throw ordersRes.error;
  if (expensesRes.error)  throw expensesRes.error;
  if (shipmentsRes.error) throw shipmentsRes.error;

  const orders    = ordersRes.data    ?? [];
  const expenses  = expensesRes.data  ?? [];
  const shipments = shipmentsRes.data ?? [];

  /* ── Income by channel ───────────────────────── */

  // Legacy Manual orders → source (from original CSV, hardcoded)
  const MANUAL_SOURCE = {
    Manual_0001:"Depop", Manual_0002:"Depop", Manual_0003:"Depop",
    Manual_0004:"Depop", Manual_0005:"Depop", // Mercari – only 1 order, lumped
    Manual_0006:"Depop", Manual_0007:"Depop", Manual_0008:"Depop",
    Manual_0009:"Depop", Manual_0010:"Depop", Manual_0011:"Depop",
    Manual_0012:"Depop", Manual_0013:"Depop", Manual_0014:"Depop",
    Manual_0015:"Depop", Manual_0016:"Depop", Manual_0017:"Depop",
    // Manual_0018 → Website (Stripe)
    Manual_0019:"Etsy",  Manual_0020:"Etsy",  Manual_0021:"Etsy",
    // Manual_0022, Manual_0023 → Website (Stripe)
    Manual_0024:"Etsy",  Manual_0025:"Etsy",  Manual_0026:"Etsy",
    Manual_0027:"Etsy",
  };

  /** Detect source from kk_order_id */
  function detectChannel(id) {
    if (!id) return "Stripe";
    // Explicit prefix matches
    if (id.startsWith("AMZ-"))  return "Amazon";
    if (id.startsWith("Etsy ")) return "Etsy";
    // KKO- = karrykraze.com website
    if (id.startsWith("KKO-"))  return "Stripe";
    // Legacy Manual orders
    if (MANUAL_SOURCE[id])      return MANUAL_SOURCE[id];
    // Numeric 7+ digit IDs are Etsy receipt numbers
    if (/^\d{7,}$/.test(id))    return "Etsy";
    // Everything else (cs_live_*, short alphanumeric) = Stripe / website
    return "Stripe";
  }

  const CHANNEL_NOTES = {
    Stripe: "karrykraze.com",
    Amazon: "Amazon Seller Central",
    Etsy:   "Etsy Marketplace",
    Depop:  "Depop Marketplace",
  };

  const channels = {};  // source → { source, gross, refunds, shipping, tax, notes }

  for (const o of orders) {
    const src   = detectChannel(o.kk_order_id || "");
    const notes = CHANNEL_NOTES[src] || src;

    if (!channels[src]) {
      channels[src] = { source: src, gross: 0, refunds: 0, shipping: 0, tax: 0, notes };
    }
    const ch = channels[src];
    ch.gross    += (o.subtotal_paid_cents || 0) / 100;
    ch.shipping += (o.shipping_paid_cents || 0) / 100;
    ch.tax      += (o.tax_cents || 0) / 100;
  }

  // Round all values
  for (const ch of Object.values(channels)) {
    ch.gross    = +ch.gross.toFixed(2);
    ch.shipping = +ch.shipping.toFixed(2);
    ch.tax      = +ch.tax.toFixed(2);
  }

  // Build income array in a stable order
  const SOURCE_ORDER = ["Stripe", "Amazon", "Etsy", "Depop"];
  const income = SOURCE_ORDER
    .filter(s => channels[s])
    .map(s => channels[s]);
  if (!income.length) {
    income.push({ source: "Stripe", gross: 0, refunds: 0, shipping: 0, tax: 0, notes: "karrykraze.com" });
  }

  /* ── Section D: Cost of Goods Sold ─────────────── */
  // Purchases = Inventory category expenses (actual $ spent buying products for resale)
  let cogsPurchases = 0;
  // Materials & Supplies = Supplies category expenses (packaging, poly bags, labels)
  let cogsMaterials = 0;

  for (const e of expenses) {
    const amt = (e.amount_cents || 0) / 100;
    if (e.category === "Inventory") cogsPurchases += amt;
    else if (e.category === "Supplies") cogsMaterials += amt;
  }
  cogsPurchases = +cogsPurchases.toFixed(2);
  cogsMaterials = +cogsMaterials.toFixed(2);

  /* ── Expenses (Section E) ────────────────────── */
  const expenseMap = {};
  const vendorSets = {};

  for (const e of expenses) {
    if (e.category === "Inventory" || e.category === "Supplies") continue; // COGS, not expenses
    const key = CATEGORY_MAP[e.category] || "other";
    expenseMap[key] = (expenseMap[key] || 0) + (e.amount_cents || 0) / 100;
    if (e.vendor) {
      (vendorSets[key] ??= new Set()).add(e.vendor);
    }
  }

  // Add shipping-label costs to shipping expense
  let totalLabelCost = 0;
  for (const s of shipments) {
    totalLabelCost += (s.label_cost_cents || 0) / 100;
  }
  if (totalLabelCost) {
    expenseMap.shipping = (expenseMap.shipping || 0) + totalLabelCost;
    (vendorSets.shipping ??= new Set()).add("Shipping labels");
  }

  // Auto-estimate Stripe processing fees (2.9% + $0.30 per transaction)
  // Only for Stripe/website orders — Amazon/Etsy/Depop handle fees on their end
  let estimatedStripeFees = 0;
  let stripeOrderCount = 0;
  for (const o of orders) {
    const src = detectChannel(o.kk_order_id || "");
    if (src === "Stripe") {
      const totalDollars = (o.total_paid_cents || 0) / 100;
      estimatedStripeFees += totalDollars * 0.029 + 0.30;
      stripeOrderCount++;
    }
  }
  if (estimatedStripeFees > 0) {
    estimatedStripeFees = +estimatedStripeFees.toFixed(2);
    expenseMap.platformFees = (expenseMap.platformFees || 0) + estimatedStripeFees;
    (vendorSets.platformFees ??= new Set()).add(`Stripe est. (${stripeOrderCount} orders)`);
  }

  // Round
  for (const k of Object.keys(expenseMap)) {
    expenseMap[k] = +expenseMap[k].toFixed(2);
  }

  // Convert vendor sets to note strings
  const expNotes = {};
  for (const [k, s] of Object.entries(vendorSets)) {
    expNotes[k] = [...s].join(", ");
  }

  /* ── Section F: Capital Contributions ────────── */
  // Total $ spent on the business = what was contributed from personal funds
  // (Inventory + Supplies + all operating expenses + label costs)
  let totalSpent = 0;
  for (const e of expenses) {
    totalSpent += (e.amount_cents || 0) / 100;
  }
  totalSpent += totalLabelCost;        // shipping labels
  totalSpent += estimatedStripeFees;   // platform fees (estimated)
  totalSpent = +totalSpent.toFixed(2);

  // Net profit = total revenue − COGS − expenses (used for end-capital calc)
  const totalGross = income.reduce((s, ch) => s + ch.gross + ch.shipping, 0);
  const totalCOGS  = cogsPurchases + cogsMaterials;
  const totalExp   = Object.values(expenseMap).reduce((s, v) => s + v, 0);
  const netProfit  = +(totalGross - totalCOGS - totalExp).toFixed(2);

  return {
    income,
    cogsPurchases,
    cogsMaterials,
    cogsStart: 0,    // First year / not tracked
    cogsLabor: 0,    // No employees
    expenses: expenseMap,
    expNotes,
    capital: {
      totalContributions: totalSpent,
      netProfit,
    },
    _meta: {
      orderCount:    orders.length,
      expenseCount:  expenses.length,
      shipmentCount: shipments.length,
      labelCostTotal: +totalLabelCost.toFixed(2),
      estimatedStripeFees,
      stripeOrderCount,
    },
  };
}
