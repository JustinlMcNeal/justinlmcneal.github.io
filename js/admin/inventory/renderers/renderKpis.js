/**

 * Render inventory KPI cards from passed data (live or mock fallback).

 */



import { KPI_DATA } from "../mockData.js";

import { esc } from "../utils/formatters.js";



const KPI_ICONS = {

  totalSkus: `<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>`,

  onHand: `<path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>`,

  reserved: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>`,

  available: `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`,

  lowStock: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`,

  unmapped: `<path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>`,

  issues: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,

  sync: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>`,

};



/**

 * @param {typeof KPI_DATA} kpis

 */

function buildKpiItems(kpis) {

  return [

    { key: "totalSkus", label: "Total SKUs", hint: "Active tracked variants", value: () => kpis.totalSkus, tone: "text-gray-900", bg: "bg-gray-100 text-gray-700", icon: KPI_ICONS.totalSkus },

    { key: "onHand", label: "On Hand Units", hint: "Physical stock in inventory", value: () => kpis.onHandUnits, tone: "text-gray-900", bg: "bg-slate-50 text-slate-700", icon: KPI_ICONS.onHand },

    { key: "reserved", label: "Reserved Units", hint: "Active reservations (status=reserved)", value: () => kpis.reservedUnits, tone: "text-violet-700", bg: "bg-violet-50 text-violet-700", icon: KPI_ICONS.reserved },

    { key: "available", label: "Available Units", hint: "On hand minus reserved", value: () => kpis.availableUnits, tone: "text-green-700", bg: "bg-green-50 text-green-700", icon: KPI_ICONS.available },

    { key: "lowStock", label: "Low Stock", hint: "Active variants with 1–3 units", value: () => kpis.lowStock, tone: "text-amber-600", bg: "bg-amber-50 text-amber-700", icon: KPI_ICONS.lowStock },

    { key: "unmapped", label: "Unmapped Lines", hint: "Parcel rows awaiting mapping", value: () => kpis.unmappedLines, tone: "text-violet-700", bg: "bg-violet-50 text-violet-700", icon: KPI_ICONS.unmapped },

    { key: "issues", label: "Inventory Issues", hint: "Negative stock, parcel + order mapping gaps", value: () => kpis.inventoryIssues, tone: "text-red-600", bg: "bg-red-50 text-red-700", icon: KPI_ICONS.issues },

    { key: "sync", label: "Last Channel Sync", hint: "Channel sync not wired yet", value: () => kpis.lastChannelSync, tone: "text-gray-900 text-xl sm:text-2xl", bg: "bg-blue-50 text-blue-700", icon: KPI_ICONS.sync, isText: true },

  ];

}



/** @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} opts */

function kpiStatusBanner(opts) {

  const { loading, error, isLive } = opts;

  if (loading) {

    return `<p class="col-span-full text-xs text-gray-500 mb-1" role="status" aria-live="polite">Loading KPIs…</p>`;

  }

  if (error && !isLive) {

    return `<p class="col-span-full text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-1" role="alert">Live KPIs unavailable (${esc(error)}). Showing placeholder data.</p>`;

  }

  return "";

}



function kpiCard(item) {

  const display = item.isText

    ? `<p class="text-xl sm:text-2xl font-black mt-3 ${item.tone}">${esc(item.value())}</p>`

    : `<p class="text-2xl sm:text-3xl font-black mt-3 ${item.tone}">${esc(item.value())}</p>`;



  return `

    <article class="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm" data-kpi="${item.key}">

      <div class="w-9 h-9 rounded-lg ${item.bg} flex items-center justify-center" aria-hidden="true">

        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${item.icon}</svg>

      </div>

      ${display}

      <p class="text-[10px] sm:text-xs font-black uppercase tracking-[.14em] text-gray-500 mt-1">${item.label}</p>

      <p class="text-[11px] text-gray-400 mt-1.5 hidden sm:block leading-snug">${item.hint}</p>

    </article>

  `;

}



function kpiSkeletonCard() {

  return `

    <article class="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm animate-pulse" aria-hidden="true">

      <div class="w-9 h-9 rounded-lg bg-gray-100"></div>

      <div class="h-8 bg-gray-100 rounded mt-3 w-16"></div>

      <div class="h-3 bg-gray-100 rounded mt-2 w-24"></div>

    </article>

  `;

}



/**

 * @param {HTMLElement|null} mount

 * @param {typeof KPI_DATA} [data]

 * @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} [opts]

 */

export function renderKpis(mount, data, opts = {}) {

  if (!mount) return;



  const { loading = false, error = null, isLive = false } = opts;

  const kpis = data ?? KPI_DATA;

  const items = buildKpiItems(kpis);



  mount.innerHTML = `
    ${kpiStatusBanner({ loading, error, isLive })}
    ${loading ? Array.from({ length: 8 }, kpiSkeletonCard).join("") : items.map(kpiCard).join("")}
  `;
  if (loading) mount.setAttribute("aria-busy", "true");
  else mount.removeAttribute("aria-busy");
}


