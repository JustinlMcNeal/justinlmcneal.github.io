// /js/admin/itemStats/index.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";

import { initItemStatsState } from "./state.js";
import { fetchItemStats } from "./api.js";
import { getEls, bindUI } from "./dom.js";
import {
  renderStatsTable,
  renderMobileCards,
  renderVariantRows,
  wireRowClicks,
  wireMobileClicks
} from "./renderTable.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ADMIN_ENTRY_PAGE = "/pages/admin/index.html";

/* ── helpers ─────────────────────────────────────── */

function fmtMoney(cents) {
  return "$" + ((cents || 0) / 100).toFixed(2);
}

async function requireAdminSession(els) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.warn(error);
  if (!session) {
    if (els?.status) els.status.textContent = "Admin session required. Redirecting…";
    window.location.replace(ADMIN_ENTRY_PAGE);
    return null;
  }
  return session;
}

/* ── sorting ─────────────────────────────────────── */

function sortRows(rows, sortBy) {
  const copy = [...rows];
  switch (sortBy) {
    case "revenue_asc":  return copy.sort((a, b) => a.revenue_cents - b.revenue_cents);
    case "units_desc":   return copy.sort((a, b) => b.units_sold - a.units_sold);
    case "units_asc":    return copy.sort((a, b) => a.units_sold - b.units_sold);
    case "profit_desc":  return copy.sort((a, b) => b.profit_cents - a.profit_cents);
    case "profit_asc":   return copy.sort((a, b) => a.profit_cents - b.profit_cents);
    case "orders_desc":  return copy.sort((a, b) => b.order_count - a.order_count);
    case "margin_desc":  return copy.sort((a, b) => b.margin_pct - a.margin_pct);
    case "name_asc":     return copy.sort((a, b) => (a.product_name || "").localeCompare(b.product_name || ""));
    case "revenue_desc":
    default:             return copy.sort((a, b) => b.revenue_cents - a.revenue_cents);
  }
}

/* ── filtering ───────────────────────────────────── */

function filterRows(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(r =>
    (r.product_name || "").toLowerCase().includes(lq) ||
    (r.product_code || "").toLowerCase().includes(lq)
  );
}

/* ── render pipeline ─────────────────────────────── */

function renderAll() {
  const { els, state } = window.__kkItemStats;

  let visible = filterRows(state.rows, state.q);
  visible = sortRows(visible, state.sortBy);

  const maxRev = Math.max(...visible.map(r => r.revenue_cents), 1);

  // Desktop
  renderStatsTable(els.statsRows, visible, maxRev);
  wireRowClicks(els.statsRows, (code) => showVariants(code));

  // Mobile
  renderMobileCards(els.mobileCards, visible);
  wireMobileClicks(els.mobileCards, (code) => showVariants(code));

  // Empty state
  if (els.emptyState) {
    els.emptyState.classList.toggle("hidden", visible.length > 0);
  }

  // Count
  els.itemCount.textContent = `${visible.length} product${visible.length === 1 ? "" : "s"}`;

  // KPIs
  updateKpis(visible);
}

function updateKpis(rows) {
  const { els } = window.__kkItemStats;

  const totalRev = rows.reduce((s, r) => s + r.revenue_cents, 0);
  const totalUnits = rows.reduce((s, r) => s + r.units_sold, 0);
  const totalOrders = new Set();
  // We can't get unique orders from aggregated rows perfectly, so use sum of order_count as approximation
  const orderCount = rows.reduce((s, r) => s + r.order_count, 0);

  els.kpiRevenue.textContent = fmtMoney(totalRev);
  els.kpiUnitsSold.textContent = totalUnits.toLocaleString();

  // Top seller by units
  const top = rows.reduce((best, r) => (!best || r.units_sold > best.units_sold) ? r : best, null);
  els.kpiTopSeller.textContent = top ? top.product_name : "—";

  // Avg revenue per "order" (totalRev / unique sessions, approximated)
  const uniqueOrderEst = orderCount || 1;
  els.kpiAvgOrder.textContent = fmtMoney(Math.round(totalRev / uniqueOrderEst));
}

/* ── variant breakdown ───────────────────────────── */

function showVariants(code) {
  const { els, state } = window.__kkItemStats;
  state.selectedCode = code;

  const product = state.rows.find(r => r.product_code === code);
  els.variantTitle.textContent = product ? product.product_name : code;

  // Aggregate variants from raw line items
  const variantMap = {};
  for (const li of state.rawLineItems) {
    if (li.product_id !== code) continue;
    const v = li.variant || "(no variant)";
    if (!variantMap[v]) variantMap[v] = { variant: v, units: 0, revenue_cents: 0 };
    const qty = li.quantity || 1;
    variantMap[v].units += qty;
    variantMap[v].revenue_cents += (li.post_discount_unit_price_cents || 0) * qty;
  }

  const variants = Object.values(variantMap).sort((a, b) => b.units - a.units);
  const maxUnits = Math.max(...variants.map(v => v.units), 1);

  renderVariantRows(els.variantRows, variants, maxUnits);

  els.variantSection.classList.remove("hidden");
  els.variantSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideVariants() {
  const { els, state } = window.__kkItemStats;
  state.selectedCode = null;
  els.variantSection.classList.add("hidden");
}

/* ── data loading ────────────────────────────────── */

async function loadStats() {
  const { els, state } = window.__kkItemStats;
  if (state.loading) return;

  try {
    state.loading = true;
    els.status.textContent = "Loading product stats…";

    const result = await fetchItemStats({ range: state.range });
    state.rows = result.rows;
    state.rawLineItems = result.lineItems;

    els.status.textContent = "";
    renderAll();
  } catch (err) {
    console.error(err);
    els.status.textContent = err?.message || "Failed to load stats.";
  } finally {
    state.loading = false;
  }
}

/* ── wiring ──────────────────────────────────────── */

function attachHandlers() {
  const { els, state } = window.__kkItemStats;

  bindUI(els, {
    onSearch: (q) => {
      state.q = q;
      renderAll();
    },
    onRange: async (range) => {
      state.range = range;
      hideVariants();
      await loadStats();
    },
    onSort: (sortBy) => {
      state.sortBy = sortBy;
      renderAll();
    },
    onCloseVariant: () => hideVariants()
  });
}

/* ── boot ────────────────────────────────────────── */

async function boot() {
  await initAdminNav("Item Stats");
  initFooter();

  const els = getEls();
  const session = await requireAdminSession(els);
  if (!session) return;

  const state = initItemStatsState();
  window.__kkItemStats = { els, state, session };

  attachHandlers();
  await loadStats();
}

boot();
