// /js/admin/expenses/charts.js

const CATEGORY_COLORS = [
  "#f58f86", "#f6dcc6", "#000000", "#ff69b4", "#6366f1",
  "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#64748b", "#84cc16"
];

let categoryChart = null;
let monthlyChart = null;

/**
 * Build or update both charts from expense rows.
 * @param {{ chartCategory: HTMLCanvasElement, chartMonthly: HTMLCanvasElement }} canvasEls
 * @param {Array} rows — all loaded expense rows
 */
export function updateCharts(canvasEls, rows) {
  if (!window.Chart) return;

  updateCategoryChart(canvasEls.chartCategory, rows);
  updateMonthlyChart(canvasEls.chartMonthly, rows);
}

function updateCategoryChart(canvas, rows) {
  if (!canvas) return;

  const catTotals = {};
  for (const r of rows) {
    const cat = r.category || "Other";
    catTotals[cat] = (catTotals[cat] || 0) + (r.amount_cents || 0);
  }

  const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([cat]) => cat);
  const data = sorted.map(([, cents]) => cents / 100);

  if (categoryChart) {
    categoryChart.data.labels = labels;
    categoryChart.data.datasets[0].data = data;
    categoryChart.data.datasets[0].backgroundColor = labels.map((_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
    categoryChart.update();
    return;
  }

  categoryChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]),
        borderWidth: 2,
        borderColor: "#fff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            padding: 12,
            font: { size: 11, weight: "bold" }
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: $${ctx.parsed.toFixed(2)}`
          }
        }
      }
    }
  });
}

function updateMonthlyChart(canvas, rows) {
  if (!canvas) return;

  const monthTotals = {};
  for (const r of rows) {
    if (!r.expense_date) continue;
    const month = r.expense_date.slice(0, 7); // YYYY-MM
    monthTotals[month] = (monthTotals[month] || 0) + (r.amount_cents || 0);
  }

  const sorted = Object.keys(monthTotals).sort();
  const labels = sorted.map(m => {
    const [y, mo] = m.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[parseInt(mo, 10) - 1]} ${y}`;
  });
  const data = sorted.map(m => monthTotals[m] / 100);

  if (monthlyChart) {
    monthlyChart.data.labels = labels;
    monthlyChart.data.datasets[0].data = data;
    monthlyChart.update();
    return;
  }

  monthlyChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Spending ($)",
        data,
        backgroundColor: "#000",
        hoverBackgroundColor: "#f58f86",
        borderRadius: 4,
        barPercentage: 0.7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => `$${v}`,
            font: { size: 11, weight: "bold" }
          },
          grid: { color: "#f1f1f1" }
        },
        x: {
          ticks: {
            font: { size: 10, weight: "bold" },
            maxRotation: 45,
            minRotation: 0
          },
          grid: { display: false }
        }
      }
    }
  });
}

/**
 * Render platform-breakdown KPI cards into a container.
 * @param {HTMLElement} container — the #platformKpis element
 * @param {Array} rows
 */
export function updatePlatformKpis(container, rows) {
  if (!container) return;

  const platforms = {};
  for (const r of rows) {
    const v = (r.vendor || "Other").trim();
    if (!platforms[v]) platforms[v] = { cents: 0, count: 0 };
    platforms[v].cents += r.amount_cents || 0;
    platforms[v].count++;
  }

  const sorted = Object.entries(platforms).sort((a, b) => b[1].cents - a[1].cents);

  container.innerHTML = sorted.map(([name, { cents, count }]) => `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-3 sm:p-4">
      <div class="text-[9px] sm:text-[10px] font-black uppercase tracking-[.18em] text-gray-500 mb-1 truncate">${esc(name)}</div>
      <div class="text-lg sm:text-2xl font-black">$${(cents / 100).toFixed(2)}</div>
      <div class="text-[10px] text-gray-400 font-bold mt-0.5">${count} expense${count === 1 ? "" : "s"}</div>
    </div>
  `).join("");
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
