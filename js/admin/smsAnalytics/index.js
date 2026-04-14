// js/admin/smsAnalytics/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter }   from "/js/shared/footer.js";
import { requireAdmin } from "/js/shared/guard.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

const sb = getSupabaseClient();

// ── Helpers ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
const pct   = (n)     => Number(n || 0).toFixed(1) + "%";
const num   = (n)     => Number(n || 0).toLocaleString();
const dec   = (n, d = 2) => Number(n || 0).toFixed(d);

function kpiCard(value, label, color = "text-gray-900") {
  return `<div class="kpi-card"><div class="kpi-value ${color}">${value}</div><div class="kpi-label">${label}</div></div>`;
}

function statRow(label, value, cls = "") {
  return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span></div>`;
}

// ── Data Fetchers ────────────────────────────────────────────
async function fetchView(viewName) {
  const { data, error } = await sb.from(viewName).select("*");
  if (error) { console.error(`[smsAnalytics] ${viewName}:`, error.message); return []; }
  return data || [];
}

// ── Renderers ────────────────────────────────────────────────
function renderKPIs(flows, abandoned, funnel) {
  const totalSends = flows.reduce((s, f) => s + Number(f.total_sends || 0), 0);
  const totalRevenue = flows.reduce((s, f) => s + Number(f.attributed_revenue || 0), 0);
  const totalConversions = flows.reduce((s, f) => s + Number(f.conversions || 0), 0);
  const totalClicks = flows.reduce((s, f) => s + Number(f.unique_clicks || 0), 0);
  const totalProfit = flows.reduce((s, f) => s + Number(f.estimated_profit || 0), 0);

  const subscriberCount = funnel.length > 0 ? Number(funnel[0].total_subscribers || 0) : 0;

  $("kpiStrip").innerHTML = [
    kpiCard(num(totalSends), "Total Sends"),
    kpiCard(num(subscriberCount), "Subscribers", "text-blue-600"),
    kpiCard(num(totalClicks), "Clicks", "text-purple-600"),
    kpiCard(num(totalConversions), "Conversions", "green"),
    kpiCard("$" + dec(totalRevenue), "Revenue", "green"),
    kpiCard("$" + dec(totalProfit), "Est. Profit", totalProfit >= 0 ? "green" : "red"),
  ].join("");
}

function renderFlowTable(flows) {
  const tbody = $("flowTable").querySelector("tbody");
  if (!flows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-gray-400 py-4">No data yet</td></tr>`;
    return;
  }

  tbody.innerHTML = flows.map(f => {
    const rev = Number(f.attributed_revenue || 0);
    const cost = Number(f.total_sms_cost || 0);
    const profit = Number(f.estimated_profit || 0);
    const profitPerSms = Number(f.profit_per_sms || 0);

    return `<tr>
      <td class="font-bold">${f.flow || "—"}</td>
      <td>${num(f.total_sends)}</td>
      <td>${num(f.unique_clicks)}</td>
      <td>${num(f.conversions)}</td>
      <td class="green">$${dec(rev)}</td>
      <td>$${dec(cost, 4)}</td>
      <td class="${profit >= 0 ? 'green' : 'red'}">$${dec(profit)}</td>
      <td class="${profitPerSms >= 0 ? 'green' : 'red'}">$${dec(profitPerSms, 4)}</td>
    </tr>`;
  }).join("");
}

function renderAbandonedCart(rows) {
  const el = $("abandonedCartStats");
  if (!rows.length) { el.innerHTML = '<div class="text-sm text-gray-400">No data yet</div>'; return; }
  const d = rows[0];

  el.innerHTML = [
    statRow("Total Carts Synced", num(d.total_carts)),
    statRow("Active", num(d.active_carts), "blue"),
    statRow("Purchased (Recovered)", num(d.purchased_carts), "green"),
    statRow("Expired", num(d.expired_carts)),
    '<div class="my-2 border-t border-gray-100"></div>',
    statRow("Step 1 Sends (30min)", num(d.step1_sends)),
    statRow("Step 2 Sends (6hr)", num(d.step2_sends)),
    statRow("Step 3 Sends (24hr)", num(d.step3_sends)),
    '<div class="my-2 border-t border-gray-100"></div>',
    statRow("Converted at Step 1", num(d.converted_at_step1), "green"),
    statRow("Converted at Step 2", num(d.converted_at_step2), "green"),
    statRow("Converted at Step 3", num(d.converted_at_step3), "green"),
    statRow("Recovery Rate", pct(d.recovery_rate_pct), "pink"),
    statRow("Avg Hours to Purchase", dec(d.avg_hours_to_purchase, 1)),
    statRow("Recovered Value", money(d.recovered_value_cents), "green"),
    '<div class="my-2 border-t border-gray-100"></div>',
    statRow("First-time Abandoners", num(d.first_time_abandoners)),
    statRow("Repeat (2nd)", num(d.second_time_abandoners)),
    statRow("Repeat (3rd)", num(d.third_time_abandoners)),
    statRow("Serial (3+, suppressed)", num(d.serial_abandoners), "red"),
  ].join("");
}

function renderCouponTable(rows) {
  const tbody = $("couponTable").querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-gray-400 py-4">No data yet</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `<tr>
      <td class="font-bold">${r.cohort || "—"}</td>
      <td>${num(r.total_coupons_issued)}</td>
      <td>${num(r.redeemed)}</td>
      <td>${pct(r.redemption_rate_pct)}</td>
      <td>$${dec(r.avg_order_value)}</td>
      <td class="green">$${dec(r.avg_profit_per_order)}</td>
    </tr>`).join("");
}

function renderFunnel(rows) {
  const el = $("funnelStats");
  if (!rows.length) { el.innerHTML = '<div class="text-sm text-gray-400">No data yet</div>'; return; }
  const d = rows[0];

  el.innerHTML = [
    statRow("Total Subscribers", num(d.total_subscribers), "blue"),
    statRow("Active", num(d.active_subscribers)),
    statRow("Unsubscribed", num(d.unsubscribed)),
    statRow("Clicked (any link)", num(d.clicked), "purple"),
    statRow("Click Rate", pct(d.click_rate_pct)),
    statRow("Redeemed Coupon", num(d.redeemed_coupon), "green"),
    statRow("Click → Redeem", pct(d.click_to_redeem_pct)),
    statRow("Purchased", num(d.purchased), "green"),
    statRow("Redeem → Purchase", pct(d.redeem_to_purchase_pct)),
    statRow("Overall Conversion", pct(d.overall_conversion_pct), "pink"),
  ].join("");
}

function renderFatigue(rows) {
  const el = $("fatigueStats");
  if (!rows.length) { el.innerHTML = '<div class="text-sm text-gray-400">No data yet</div>'; return; }
  const d = rows[0];

  el.innerHTML = [
    statRow("Total Contacts", num(d.total_contacts)),
    statRow("Active", num(d.active), "green"),
    statRow("Stopped", num(d.stopped), Number(d.stopped) > 0 ? "red" : ""),
    statRow("Bounced", num(d.bounced)),
    statRow("STOP Rate", pct(d.stop_rate_pct), Number(d.stop_rate_pct) > 5 ? "red" : "green"),
    statRow("Bounce Rate", pct(d.bounce_rate_pct)),
    '<div class="my-2 border-t border-gray-100"></div>',
    statRow("Avg Sends / Contact", dec(d.avg_sends_per_contact, 1)),
    statRow("Avg Sends (7d)", dec(d.avg_sends_7d, 1)),
    statRow("Avg Clicks / Contact", dec(d.avg_clicks_per_contact, 1)),
    '<div class="my-2 border-t border-gray-100"></div>',
    statRow("Low Fatigue", num(d.fatigue_low)),
    statRow("Medium Fatigue", num(d.fatigue_medium)),
    statRow("High Fatigue", num(d.fatigue_high), Number(d.fatigue_high) > 0 ? "red" : "green"),
  ].join("");
}

function renderClickTiming(rows) {
  const tbody = $("clickTable").querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400 py-4">No data yet</td></tr>`;
    return;
  }

  // click_to_purchase is per-order, aggregate by flow
  const byFlow = {};
  for (const r of rows) {
    const f = r.flow || "unknown";
    if (!byFlow[f]) byFlow[f] = { orders: 0, totalHours: 0, w24: 0, w48: 0 };
    byFlow[f].orders++;
    byFlow[f].totalHours += Number(r.hours_click_to_purchase || 0);
    if (Number(r.hours_click_to_purchase || 999) <= 24) byFlow[f].w24++;
    if (Number(r.hours_click_to_purchase || 999) <= 48) byFlow[f].w48++;
  }

  tbody.innerHTML = Object.entries(byFlow).map(([flow, d]) => `<tr>
    <td class="font-bold">${flow}</td>
    <td>${num(d.orders)}</td>
    <td>${dec(d.totalHours / d.orders, 1)}h</td>
    <td>${num(d.w24)}</td>
    <td>${num(d.w48)}</td>
  </tr>`).join("");
}

// ── Main ─────────────────────────────────────────────────────
async function loadDashboard() {
  $("loading").classList.remove("hidden");
  $("dashboard").classList.add("hidden");

  const [flows, abandoned, cohorts, funnel, fatigue, clicks] = await Promise.all([
    fetchView("sms_v_flow_performance"),
    fetchView("sms_v_abandoned_cart"),
    fetchView("sms_v_coupon_cohorts"),
    fetchView("sms_v_subscriber_funnel"),
    fetchView("sms_v_fatigue_monitor"),
    fetchView("sms_v_click_to_purchase"),
  ]);

  renderKPIs(flows, abandoned, funnel);
  renderFlowTable(flows);
  renderAbandonedCart(abandoned);
  renderCouponTable(cohorts);
  renderFunnel(funnel);
  renderFatigue(fatigue);
  renderClickTiming(clicks);

  $("loading").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("lastRefresh").textContent = "Updated " + new Date().toLocaleTimeString();
}

async function init() {
  initAdminNav("SMS Analytics");
  initFooter();

  const auth = await requireAdmin();
  if (!auth.ok) {
    $("loading").innerHTML = `<div class="text-sm text-red-500 font-bold">${auth.reason}</div>`;
    document.body.classList.remove("hidden");
    return;
  }

  document.body.classList.remove("hidden");
  $("btnRefresh").addEventListener("click", loadDashboard);
  await loadDashboard();
}

init();
