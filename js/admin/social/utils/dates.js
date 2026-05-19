// /js/admin/social/utils/dates.js
// Pure date/time display helpers (no DOM side effects)

/**
 * Scheduled post date label (queue, auto-queue preview).
 * @param {Date | string | number} date
 * @returns {string}
 */
export function formatScheduleDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Scheduled post time label (queue, auto-queue preview).
 * @param {Date | string | number} date
 * @returns {string}
 */
export function formatScheduleTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
