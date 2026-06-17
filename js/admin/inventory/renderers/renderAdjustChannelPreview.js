/**
 * Adjust modal channel preview markup (Phase 059A.2 — render only; 059E.3 UX polish).
 */

import { esc } from "../utils/formatters.js";

export const ADJUST_CHANNEL_PREVIEW_NOTE =
  "Estimated marketplace actions after you confirm. KK stock updates first.";

export const ADJUST_SYNC_TOGGLE_LABEL = "Sync marketplaces after stock adjustment";

export const ADJUST_SYNC_TOGGLE_HELPER_BASE =
  "Runs after KK stock is updated. Marketplace failures do not undo the stock adjustment.";

const TONE_CLASS = {
  success: "border-green-200 bg-green-50 text-green-900",
  warn: "border-amber-200 bg-amber-50 text-amber-950",
  muted: "border-gray-200 bg-gray-50 text-gray-700",
  danger: "border-red-200 bg-red-50 text-red-900",
};

/** Channel preview section shell (loading until data arrives). */
export function renderAdjustChannelPreviewShell() {
  return `
    <section class="rounded-xl border-2 border-dashed border-gray-300 p-3 space-y-3" data-adjust-channel-section aria-live="polite">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Marketplace preview</p>
          <p class="text-[11px] text-gray-500 mt-0.5">${esc(ADJUST_CHANNEL_PREVIEW_NOTE)}</p>
        </div>
      </div>
      <div data-adjust-channel-body>
        <p class="text-xs text-gray-500 animate-pulse" data-adjust-channel-loading aria-busy="true">Loading marketplace status…</p>
      </div>
      <label class="flex items-start gap-2 border border-gray-200 rounded-lg p-2.5 cursor-pointer min-h-[44px] opacity-60" data-adjust-sync-toggle-wrap>
        <input
          type="checkbox"
          name="syncChannelsAfterAdjust"
          data-adjust-sync-toggle
          class="mt-1 accent-black"
          disabled
          aria-describedby="adjustSyncToggleHint"
        />
        <span class="text-xs">
          <span class="font-bold block text-gray-900">${esc(ADJUST_SYNC_TOGGLE_LABEL)}</span>
          <span class="text-gray-500" id="adjustSyncToggleHint" data-adjust-sync-toggle-hint>Available after preview loads.</span>
        </span>
      </label>
    </section>
  `;
}

/**
 * @param {import('../services/adjustChannelPreview.js').AdjustChannelPreviewState} state
 */
export function renderAdjustChannelPreviewCards(state) {
  return [state.kk, state.amazon, state.ebay]
    .map((c) => {
      const tone = TONE_CLASS[c.tone] || TONE_CLASS.muted;
      return `
        <div class="rounded-lg border px-2.5 py-2 ${tone}" data-adjust-channel-card="${esc(c.channel.toLowerCase())}">
          <p class="text-[10px] font-black uppercase tracking-wide opacity-70">${esc(c.channel)}</p>
          <p class="text-xs font-bold leading-snug mt-0.5">${esc(c.label)}</p>
          <p class="text-[11px] mt-0.5 opacity-90">${esc(c.description)}</p>
        </div>
      `;
    })
    .join("");
}

/** @param {{ checked: boolean, enabled: boolean }} toggle */
export function syncToggleHintText(toggle) {
  if (!toggle.enabled) {
    return "Enable when a safe Amazon or eBay path exists and projected available qty is positive.";
  }
  if (toggle.checked) {
    return `${ADJUST_SYNC_TOGGLE_HELPER_BASE} Safe paths will run after save.`;
  }
  return "KK adjust only — marketplaces will not sync.";
}

/** @param {string} message */
export function renderAdjustChannelPreviewError(message) {
  return `
    <p class="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2" data-adjust-channel-error role="alert">
      ${esc(message)}
    </p>
    <p class="text-[11px] text-gray-500 mt-2">Marketplace preview unavailable. You can still confirm a KK-only adjustment.</p>
  `;
}
