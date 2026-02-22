// /js/admin/tax/index.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter }   from "/js/shared/footer.js";
import { fetchTaxData }  from "./api.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ADMIN_ENTRY = "/pages/admin/index.html";

/* ── helpers ──────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const fmtMoney = (cents) => "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoneySigned = (cents) => (cents < 0 ? "−" : "") + fmtMoney(cents);
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ── Schedule C category mapping ─────────────────── */

const SCHEDULE_C = [
  { line: "8",   label: "Advertising",             cats: ["Advertising"] },
  { line: "—",   label: "Platform / Processing Fees", cats: ["Platform Fees"] },
  { line: "9",   label: "Car & Truck Expenses",    cats: ["Vehicle"] },
  { line: "—",   label: "Shipping & Postage",      cats: ["Shipping"], addLabelCosts: true },
  { line: "—",   label: "Software & Subscriptions", cats: ["Software"] },
  { line: "—",   label: "Website / Domain / Hosting", cats: ["Website / Hosting"] },
  { line: "18",  label: "Office Expenses",          cats: ["Office"] },
  { line: "25",  label: "Phone / Internet (biz %)", cats: ["Phone / Internet"] },
  { line: "24b", label: "Meals (50% deductible)",   cats: ["Travel / Meals"], halfDeductible: true },
  { line: "17",  label: "Professional Fees",        cats: ["Professional Fees"] },
  { line: "—",   label: "Bank / Merchant Fees",     cats: ["Bank Fees"] },
  { line: "27",  label: "Other Expenses",           cats: ["Other"] },
];

/* ── aggregate raw data ──────────────────────────── */

function aggregate(orders, expenses, shipments) {
  // ── Income by channel ──
  // Legacy Manual orders → source (from original CSV)
  const MANUAL_SOURCE = {
    Manual_0001:"Depop", Manual_0002:"Depop", Manual_0003:"Depop",
    Manual_0004:"Depop", Manual_0005:"Depop",
    Manual_0006:"Depop", Manual_0007:"Depop", Manual_0008:"Depop",
    Manual_0009:"Depop", Manual_0010:"Depop", Manual_0011:"Depop",
    Manual_0012:"Depop", Manual_0013:"Depop", Manual_0014:"Depop",
    Manual_0015:"Depop", Manual_0016:"Depop", Manual_0017:"Depop",
    Manual_0019:"Etsy",  Manual_0020:"Etsy",  Manual_0021:"Etsy",
    Manual_0024:"Etsy",  Manual_0025:"Etsy",  Manual_0026:"Etsy",
    Manual_0027:"Etsy",
  };
  function detectChannel(id) {
    if (!id) return "Stripe";
    if (id.startsWith("AMZ-"))  return "Amazon";
    if (id.startsWith("Etsy ")) return "Etsy";
    if (id.startsWith("KKO-"))  return "Stripe";
    if (MANUAL_SOURCE[id])      return MANUAL_SOURCE[id];
    if (/^\d{7,}$/.test(id))    return "Etsy";
    return "Stripe";
  }

  const channelTotals = {};  // source → { orders, subtotal, shipping }
  let totalTax = 0;

  for (const o of orders) {
    const src = detectChannel(o.kk_order_id || "");
    if (!channelTotals[src]) channelTotals[src] = { orders: 0, subtotal: 0, shipping: 0 };
    const ch = channelTotals[src];
    ch.orders++;
    ch.subtotal += o.subtotal_paid_cents || 0;
    ch.shipping += o.shipping_paid_cents || 0;
    totalTax += o.tax_cents || 0;
  }

  let totalRevenue = 0;
  for (const ch of Object.values(channelTotals)) totalRevenue += ch.subtotal + ch.shipping;

  // ── Label costs ──
  let totalLabelCents = 0;
  for (const s of shipments) totalLabelCents += s.label_cost_cents || 0;

  // ── Expenses by category ──
  const catMap = {};
  let inventoryExpCents = 0;
  let suppliesExpCents = 0;

  for (const e of expenses) {
    const cat = e.category || "Other";
    if (!catMap[cat]) catMap[cat] = { total: 0, items: [] };
    catMap[cat].total += e.amount_cents || 0;
    catMap[cat].items.push(e);
    if (cat === "Inventory") inventoryExpCents += e.amount_cents || 0;
    if (cat === "Supplies")  suppliesExpCents += e.amount_cents || 0;
  }

  // ── Map to Schedule C lines ──
  const scheduleRows = SCHEDULE_C.map(sc => {
    let rawTotal = sc.addLabelCosts ? totalLabelCents : 0;
    for (const cat of sc.cats) {
      if (catMap[cat]) rawTotal += catMap[cat].total;
    }
    const deductible = sc.halfDeductible ? Math.round(rawTotal / 2) : rawTotal;
    return { ...sc, rawTotal, deductible };
  });

  const totalExpDeductible = scheduleRows.reduce((s, r) => s + r.deductible, 0);

  // ── COGS (Inventory purchases + packaging supplies) ──
  const totalCOGS = inventoryExpCents + suppliesExpCents;

  // ── Profit ──
  const grossProfit = totalRevenue - totalCOGS;
  const netProfit = grossProfit - totalExpDeductible;
  const seTax = netProfit > 0 ? Math.round(netProfit * 0.9235 * 0.153) : 0; // 92.35% of net × 15.3%

  return {
    income: { channelTotals, totalRevenue, totalTax },
    cogs: { purchases: inventoryExpCents, materials: suppliesExpCents, total: totalCOGS },
    grossProfit,
    scheduleRows,
    totalExpDeductible,
    labelCosts: totalLabelCents,
    netProfit,
    seTax,
    catMap,
  };
}

/* ── render helpers ──────────────────────────────── */

function renderKpis(d) {
  $("kpiRevenue").textContent  = fmtMoney(d.income.totalRevenue);
  $("kpiCogs").textContent     = fmtMoney(d.cogs.total);
  $("kpiExpenses").textContent = fmtMoney(d.totalExpDeductible);
  $("kpiNet").textContent      = fmtMoneySigned(d.netProfit);
  $("kpiNet").classList.toggle("text-red-600", d.netProfit < 0);
  $("kpiNet").classList.toggle("text-green-700", d.netProfit >= 0);
}

function renderIncome(d) {
  const LABELS = { Stripe: "Website (Stripe)", Amazon: "Amazon", Etsy: "Etsy", Depop: "Depop" };
  const SOURCE_ORDER = ["Stripe", "Amazon", "Etsy", "Depop"];
  const rows = [];
  let totOrders = 0, totSub = 0, totShip = 0;

  for (const src of SOURCE_ORDER) {
    const ch = d.income.channelTotals[src];
    if (!ch || !ch.orders) continue;
    rows.push(incomeRow(LABELS[src] || src, ch.orders, ch.subtotal, ch.shipping));
    totOrders += ch.orders;
    totSub    += ch.subtotal;
    totShip   += ch.shipping;
  }
  // Any other sources not in SOURCE_ORDER
  for (const [src, ch] of Object.entries(d.income.channelTotals)) {
    if (SOURCE_ORDER.includes(src) || !ch.orders) continue;
    rows.push(incomeRow(src, ch.orders, ch.subtotal, ch.shipping));
    totOrders += ch.orders;
    totSub    += ch.subtotal;
    totShip   += ch.shipping;
  }

  if (!rows.length) rows.push(`<tr><td colspan="4" class="px-4 py-3 text-gray-400 text-center">No orders this year</td></tr>`);

  // Totals
  rows.push(`
    <tr class="bg-gray-50 font-black border-t-2 border-black">
      <td class="px-4 py-3">Total</td>
      <td class="px-4 py-3 text-right">${totOrders}</td>
      <td class="px-4 py-3 text-right">${fmtMoney(totSub)}</td>
      <td class="px-4 py-3 text-right">${fmtMoney(totShip)}</td>
    </tr>
  `);

  $("incomeBody").innerHTML = rows.join("");
  $("incomeTotal").textContent = fmtMoney(d.income.totalRevenue);
  $("taxCollected").textContent = fmtMoney(d.income.totalTax);
}

function incomeRow(source, orders, subtotal, shipping) {
  return `<tr class="border-b border-gray-100">
    <td class="px-4 py-3 font-medium">${esc(source)}</td>
    <td class="px-4 py-3 text-right">${orders}</td>
    <td class="px-4 py-3 text-right">${fmtMoney(subtotal)}</td>
    <td class="px-4 py-3 text-right">${fmtMoney(shipping)}</td>
  </tr>`;
}

function renderCogs(d) {
  $("cogsPurchases").textContent  = fmtMoney(d.cogs.purchases);
  $("cogsMaterials").textContent  = fmtMoney(d.cogs.materials);
  $("cogsTotal").textContent      = fmtMoney(d.cogs.total);
  // Hide materials row if zero
  $("cogsMaterialsRow").classList.toggle("hidden", d.cogs.materials === 0);
}

function renderExpenses(d) {
  const rows = d.scheduleRows
    .filter(r => r.rawTotal > 0)
    .map(r => {
      const deductNote = r.halfDeductible ? ` <span class="text-xs text-gray-400">(50%→${fmtMoney(r.deductible)})</span>` : "";
      const labelNote  = r.addLabelCosts && d.labelCosts > 0
        ? ` <span class="text-xs text-gray-400">(incl. ${fmtMoney(d.labelCosts)} labels)</span>` : "";
      return `<tr class="border-b border-gray-100">
        <td class="px-4 py-3 text-xs text-gray-400 font-mono">${esc(r.line)}</td>
        <td class="px-4 py-3 font-medium">${esc(r.label)}${labelNote}</td>
        <td class="px-4 py-3 text-sm text-gray-500">${r.cats.join(", ")}</td>
        <td class="px-4 py-3 text-right font-bold">${fmtMoney(r.rawTotal)}${deductNote}</td>
      </tr>`;
    });

  if (!rows.length) rows.push(`<tr><td colspan="4" class="px-4 py-3 text-gray-400 text-center">No expenses this year</td></tr>`);

  rows.push(`
    <tr class="bg-gray-50 font-black border-t-2 border-black">
      <td class="px-4 py-3"></td>
      <td class="px-4 py-3">Total Deductible Expenses</td>
      <td class="px-4 py-3"></td>
      <td class="px-4 py-3 text-right">${fmtMoney(d.totalExpDeductible)}</td>
    </tr>
  `);

  $("expenseBody").innerHTML = rows.join("");
}

function renderPL(d) {
  $("plRevenue").textContent    = fmtMoney(d.income.totalRevenue);
  $("plCogs").textContent       = fmtMoney(d.cogs.total);
  $("plGross").textContent      = fmtMoneySigned(d.grossProfit);
  $("plExpenses").textContent   = fmtMoney(d.totalExpDeductible);
  $("plNet").textContent        = fmtMoneySigned(d.netProfit);
  $("plSETax").textContent      = d.netProfit > 0 ? fmtMoney(d.seTax) : "$0.00";

  // Color the net line
  const netEl = $("plNetRow");
  netEl.classList.toggle("text-red-600", d.netProfit < 0);
  netEl.classList.toggle("text-green-700", d.netProfit >= 0);
}

function renderChecklist(year) {
  // Just set the year in any year-dependent text
  document.querySelectorAll(".tax-year-label").forEach(el => el.textContent = year);
}

/* ── main ────────────────────────────────────────── */

async function boot() {
  initAdminNav("Tax Summary");
  initFooter();

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    $("taxLoading").textContent = "Admin session required. Redirecting…";
    return window.location.replace(ADMIN_ENTRY);
  }

  // Year picker
  const now = new Date();
  const defaultYear = (now.getMonth() < 4) ? now.getFullYear() - 1 : now.getFullYear();
  const sel = $("yearSelect");

  // Populate years (current year back to 2024)
  for (let y = now.getFullYear(); y >= 2024; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === defaultYear) opt.selected = true;
    sel.appendChild(opt);
  }

  // Print header date
  $("printDate").textContent = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Load handler
  async function loadYear(year) {
    $("taxLoading").classList.remove("hidden");
    $("taxContent").classList.add("hidden");
    $("printYear").textContent = year;

    try {
      const raw = await fetchTaxData(year);
      const d = aggregate(raw.orders, raw.expenses, raw.shipments);

      renderKpis(d);
      renderIncome(d);
      renderCogs(d);
      renderExpenses(d);
      renderPL(d);
      renderChecklist(year);

      $("taxLoading").classList.add("hidden");
      $("taxContent").classList.remove("hidden");
    } catch (err) {
      console.error(err);
      $("taxLoading").textContent = "Error loading data: " + (err?.message || "Unknown error");
    }
  }

  sel.addEventListener("change", () => loadYear(sel.value));

  // Print button
  $("btnPrint").addEventListener("click", () => window.print());

  // Initial load
  await loadYear(defaultYear);
}

boot();
