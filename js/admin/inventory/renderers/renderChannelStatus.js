/**
 * Render channel connection strip (read-only Phase 3C).
 */

import { CHANNEL_STATUS } from "../mockData.js";
import { esc } from "../utils/formatters.js";

const CHANNEL_ICONS = {
  kk: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>`,
  ebay: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`,
  amazon: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`,
};

const STATE_STYLES = {
  connected: { iconBg: "bg-green-100 text-green-700", title: "text-green-800" },
  attention: { iconBg: "bg-amber-100 text-amber-800", title: "text-amber-800" },
  unknown: { iconBg: "bg-gray-100 text-gray-600", title: "text-gray-700" },
  offline: { iconBg: "bg-gray-100 text-gray-500", title: "text-gray-600" },
};

/** @param {string} key @param {{ label: string, subtitle: string, statusLabel: string, state?: string }} channel */
function channelBlock(key, channel) {
  const style = STATE_STYLES[channel.state || "unknown"] || STATE_STYLES.unknown;
  const icon = CHANNEL_ICONS[key] || CHANNEL_ICONS.kk;
  return `
    <div class="flex items-center gap-2.5 min-w-0" data-channel="${key}" title="${esc(channel.statusLabel)}">
      <div class="w-8 h-8 rounded-lg ${style.iconBg} flex items-center justify-center shrink-0" aria-hidden="true">${icon}</div>
      <div class="min-w-0">
        <p class="text-[10px] font-black uppercase tracking-[.1em] ${style.title}">${esc(channel.label)} · ${esc(channel.statusLabel)}</p>
        <p class="text-[11px] text-gray-500 truncate">${esc(channel.subtitle)}</p>
      </div>
    </div>
  `;
}

/** @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} opts */
function channelBanner(opts) {
  const { loading, error, isLive } = opts;
  if (loading) {
    return `<p class="text-xs text-gray-500 mb-2 col-span-full" role="status">Loading channel status…</p>`;
  }
  if (error && !isLive) {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2 col-span-full" role="alert">Live channel status unavailable (${esc(error)}). Showing fallback.</p>`;
  }
  return "";
}

/**
 * @param {HTMLElement|null} mount
 * @param {import('../api/channelStatusApi.js').ChannelStatusData} [data]
 * @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} [opts]
 */
export function renderChannelStatus(mount, data, opts = {}) {
  if (!mount) return;

  const { loading = false, error = null, isLive = false } = opts;
  const status = data ?? {
    kk: { ...CHANNEL_STATUS.kk, subtitle: CHANNEL_STATUS.kk.url, state: "connected", statusLabel: "Online" },
    ebay: { ...CHANNEL_STATUS.ebay, subtitle: CHANNEL_STATUS.ebay.url, state: "unknown", statusLabel: "Fallback" },
    amazon: { ...CHANNEL_STATUS.amazon, subtitle: CHANNEL_STATUS.amazon.url, state: "unknown", statusLabel: "Fallback" },
    lastGlobalSync: CHANNEL_STATUS.lastGlobalSync,
    live: CHANNEL_STATUS.live,
    needsAttention: false,
  };

  const liveBadge = loading
    ? `<span class="text-[10px] font-black uppercase tracking-[.12em] text-gray-400">Loading…</span>`
    : status.live && isLive
      ? `<span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.12em] text-green-700">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true"></span>
          Live
        </span>`
      : status.needsAttention
        ? `<span class="text-[10px] font-black uppercase tracking-[.12em] text-amber-700">Needs Attention</span>`
        : `<span class="text-[10px] font-black uppercase tracking-[.12em] text-gray-500">Read-only</span>`;

  mount.innerHTML = `
    <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 pt-4 border-t border-gray-100">
      ${channelBanner({ loading, error, isLive })}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 xl:gap-8 flex-1">
        ${channelBlock("kk", status.kk)}
        ${channelBlock("ebay", status.ebay)}
        ${channelBlock("amazon", status.amazon)}
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 xl:justify-end shrink-0">
        <div class="text-left xl:text-right">
          <p class="text-[9px] font-black uppercase tracking-[.14em] text-gray-400">Last Global Sync</p>
          <p class="text-xs sm:text-sm font-bold text-gray-900">${esc(status.lastGlobalSync)}</p>
        </div>
        ${liveBadge}
      </div>
    </div>
  `;
}
