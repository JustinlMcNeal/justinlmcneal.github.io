// /js/admin/lineItemsOrders/listShipmentSync.js
// Patch in-memory list row shipment + re-render after workspace close.
import { renderOrdersRows } from "./renderTable.js";

/**
 * @param {object[]} rows
 * @param {string} sessionId
 * @param {object | null | undefined} shipment
 * @returns {boolean} true if a row was patched
 */
export function patchRowShipment(rows, sessionId, shipment) {
  if (!sessionId || !Array.isArray(rows)) return false;
  const row = rows.find((r) => r.stripe_checkout_session_id === sessionId);
  if (!row) return false;
  row.shipment = shipment || null;
  return true;
}

/**
 * @param {{
 *   tbodyEl: HTMLElement | null,
 *   rows: object[],
 *   onEdit: (row: object) => void,
 *   onView: (row: object) => void,
 * }} opts
 */
export function rerenderOrdersList({ tbodyEl, rows, onEdit, onView }) {
  renderOrdersRows({ tbodyEl, rows, onEdit, onView });
}
