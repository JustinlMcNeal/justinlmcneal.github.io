import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { requireAdmin } from "/js/shared/guard.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { syncAmazonFinances } from "/js/admin/lineItemsOrders/amazonOrderSync.js";

const sb = getSupabaseClient();
const $ = (id) => document.getElementById(id);

let revenueChart = null;

function money(cents) {
  return "$" + (Number(cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function number(n) {
  return Number(n || 0).toLocaleString();
}

function pct(n) {
  return Number(n || 0).toFixed(2) + "%";
}

function deltaClass(v) {
  const n = Number(v || 0);
  if (n === 0) return "text-gray-500";
  return n > 0 ? "text-red-600" : "text-emerald-600";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productCell(row) {
  const code = row.product_code && row.product_code !== "__unmatched__"
    ? row.product_code
    : "";
  const name = row.product_name || code || "Unmatched item";
  const img = row.image_url || "";

  const thumb = img
    ? `<img src="${esc(img)}" alt="" loading="lazy" class="w-10 h-10 rounded-md object-cover border border-gray-200 bg-white shrink-0">`
    : `<div class="w-10 h-10 rounded-md border border-gray-200 bg-gray-100 shrink-0 flex items-center justify-center text-[9px] font-black uppercase text-gray-400">—</div>`;

  return `<div class="flex items-center gap-2.5 min-w-[180px]">
    ${thumb}
    <div class="min-w-0">
      <div class="font-semibold leading-snug truncate" title="${esc(name)}">${esc(name)}</div>
      ${code ? `<div class="text-[10px] text-gray-500 font-mono truncate" title="${esc(code)}">${esc(code)}</div>` : ""}
    </div>
  </div>`;
}

async function fetchAnalytics({ days = 30, refresh = false }) {
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/analytics-aggregate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ days, refresh }),
  });

  const payload = await resp.json();
  if (!resp.ok || payload.error) {
    throw new Error(payload.error || `analytics-aggregate failed (${resp.status})`);
  }
  return payload;
}

function kpiCard(label, value, tone = "text-gray-900") {
  return `<article class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${tone}">${value}</div></article>`;
}

function renderKpis(payload) {
  const channels = payload.channel_kpis || [];
  const totals = channels.reduce(
    (acc, row) => {
      acc.orders += Number(row.orders || 0);
      acc.units += Number(row.units || 0);
      acc.revenue += Number(row.revenue_cents || 0);
      return acc;
    },
    { orders: 0, units: 0, revenue: 0 }
  );

  const aov = totals.orders > 0 ? Math.round(totals.revenue / totals.orders) : 0;
  const website = payload.website_funnel || {};

  $("kpiGrid").innerHTML = [
    kpiCard("Total Revenue", money(totals.revenue), "text-emerald-700"),
    kpiCard("Total Orders", number(totals.orders), "text-blue-700"),
    kpiCard("Units Sold", number(totals.units), "text-orange-700"),
    kpiCard("Derived AOV", money(aov), "text-gray-900"),
    kpiCard("Website Abandoned", number(website.abandoned_carts || 0), "text-red-700"),
    kpiCard("Website Recovered", number(website.recovered_carts || 0), "text-emerald-700"),
    kpiCard("Recovery Rate", pct(website.recovery_rate_pct || 0), "text-pink-700"),
    kpiCard("Website Revenue", money(website.website_revenue_cents || 0), "text-indigo-700"),
  ].join("");
}

function renderChannelTable(payload) {
  const rows = payload.channel_kpis || [];
  const tbody = $("channelTable").querySelector("tbody");

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-4">No rows</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((r) => `<tr>
      <td class="font-bold uppercase">${r.channel}</td>
      <td>${number(r.orders)}</td>
      <td>${number(r.units)}</td>
      <td class="font-semibold">${money(r.revenue_cents)}</td>
      <td>${money(r.aov_cents)}</td>
    </tr>`)
    .join("");
}

function renderWebsiteFunnel(payload) {
  const f = payload.website_funnel || {};
  $("websiteFunnel").innerHTML = [
    kpiCard("Website Orders", number(f.website_orders || 0), "text-blue-700"),
    kpiCard("Website Revenue", money(f.website_revenue_cents || 0), "text-emerald-700"),
    kpiCard("Abandoned Carts", number(f.abandoned_carts || 0), "text-red-700"),
    kpiCard("Recovered Carts", number(f.recovered_carts || 0), "text-emerald-700"),
    kpiCard("Recovery Rate", pct(f.recovery_rate_pct || 0), "text-pink-700"),
  ].join("");
}

function renderReconciliation(payload) {
  const rows = payload.reconciliation || [];
  const tbody = $("reconTable").querySelector("tbody");

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-gray-400 py-4">No rows</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((r) => `<tr>
      <td class="font-bold uppercase">${r.channel}</td>
      <td class="${deltaClass(r.orders_diff)}">${number(r.orders_diff)}</td>
      <td class="${deltaClass(r.units_diff)}">${number(r.units_diff)}</td>
      <td class="${deltaClass(r.revenue_diff_cents)}">${money(r.revenue_diff_cents)}</td>
    </tr>`)
    .join("");
}

function renderProducts(payload) {
  const rows = payload.top_products || [];
  const tbody = $("productsTable").querySelector("tbody");

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-4">No rows</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((r) => `<tr>
      <td>${productCell(r)}</td>
      <td>${number(r.orders)}</td>
      <td>${number(r.units)}</td>
      <td>${money(r.revenue_cents)}</td>
      <td>${money(r.aov_cents)}</td>
    </tr>`)
    .join("");
}

function renderChart(payload) {
  const rows = payload.timeseries || [];
  const labels = rows.map((r) => r.metric_date);

  const ds = (key, label, color) => ({
    label,
    data: rows.map((r) => Number((Number(r[key] || 0) / 100).toFixed(2))),
    borderColor: color,
    backgroundColor: color + "22",
    fill: false,
    tension: 0.25,
    pointRadius: 2,
  });

  const ctx = $("revenueChart").getContext("2d");
  if (revenueChart) revenueChart.destroy();

  revenueChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        ds("website_revenue_cents", "Website", "#2563eb"),
        ds("ebay_revenue_cents", "eBay", "#ea580c"),
        ds("amazon_revenue_cents", "Amazon", "#059669"),
        ds("other_revenue_cents", "Other", "#6b7280"),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => "$" + Number(v).toLocaleString(),
          },
        },
      },
    },
  });
}

function renderMeta(payload) {
  $("metaRange").textContent = `Range: ${payload.meta.start_date} to ${payload.meta.end_date}`;
  const stamp = new Date().toLocaleString();
  $("metaUpdated").textContent = `Updated: ${stamp}${payload.meta.refreshed ? " (refreshed)" : ""}`;
}

async function loadDashboard(refresh = false) {
  $("loading").classList.remove("hidden");
  $("dashboard").classList.add("hidden");

  const days = Number($("rangeDays").value || 30);
  const data = await fetchAnalytics({ days, refresh });

  renderMeta(data);
  renderKpis(data);
  renderChannelTable(data);
  renderWebsiteFunnel(data);
  renderReconciliation(data);
  renderProducts(data);
  renderChart(data);

  $("loading").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
}

async function init() {
  if (!sb) {
    $("loading").innerHTML = "<div class=\"text-red-500 font-bold\">Supabase client failed to initialize.</div>";
    document.body.classList.remove("hidden");
    return;
  }

  initAdminNav("Analytics");
  initFooter();

  const auth = await requireAdmin();
  if (!auth.ok) {
    $("loading").innerHTML = `<div class="text-red-500 font-bold">${auth.reason}</div>`;
    document.body.classList.remove("hidden");
    return;
  }

  document.body.classList.remove("hidden");

  $("btnLoad").addEventListener("click", async () => {
    try {
      await loadDashboard(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $("loading").innerHTML = `<div class="text-red-500 font-bold">${msg}</div>`;
      $("loading").classList.remove("hidden");
      $("dashboard").classList.add("hidden");
    }
  });

  $("btnRefresh").addEventListener("click", async () => {
    $("btnRefresh").disabled = true;
    try {
      await loadDashboard(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $("loading").innerHTML = `<div class="text-red-500 font-bold">${msg}</div>`;
      $("loading").classList.remove("hidden");
      $("dashboard").classList.add("hidden");
    } finally {
      $("btnRefresh").disabled = false;
    }
  });

  $("btnSyncAmazonFinances").addEventListener("click", async () => {
    const btn = $("btnSyncAmazonFinances");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Syncing…";
    try {
      const result = await syncAmazonFinances({ daysBack: 90 });
      await loadDashboard(true);
      $("metaUpdated").textContent =
        `Updated: ${new Date().toLocaleString()} · Amazon finances synced (${result.upserted}/${result.fetched})`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $("loading").innerHTML = `<div class="text-red-500 font-bold">${msg}</div>`;
      $("loading").classList.remove("hidden");
      $("dashboard").classList.add("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  try {
    await loadDashboard(false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    $("loading").innerHTML = `<div class="text-red-500 font-bold">${msg}</div>`;
  }
}

init();
