// /js/admin/lineItemsOrders/workspaceUtils.js
// Shared workspace HTML helpers used by all tab renderer files.

/** Renders a bold section-header bar used at the top of each workspace section. */
export function sh(label) {
  return `<div class="flex items-center gap-3 mb-4 pl-3 border-l-[3px] border-kkpink">
    <span class="text-[11px] font-black uppercase tracking-[.25em]">${label}</span>
  </div>`;
}

/** Format an ISO/date value as a locale-aware date-time string for display. */
export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}
