/**
 * Map v_inventory_parcel_receive_summary row to UI shape.
 */

/**
 * @param {Record<string, unknown>} row
 */
export function mapParcelSummaryRow(row) {
  const lastAt = row.last_parcel_receive_at;
  let lastParcelReceive = "Never";
  if (lastAt) {
    const d = new Date(String(lastAt));
    if (!Number.isNaN(d.getTime())) {
      lastParcelReceive = d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  return {
    awaitingMapping: Number(row.awaiting_mapping ?? 0),
    readyToReceive: Number(row.ready_to_receive ?? 0),
    recentlyReceived: Number(row.recently_received ?? 0),
    lastParcelReceive,
    lastParcelReceiveAt: lastAt ? String(lastAt) : null,
    parcelLedgerEntries: Number(row.parcel_ledger_entries ?? 0),
  };
}

/** @typedef {ReturnType<typeof mapParcelSummaryRow>} ParcelReceiveSummary */

export const MOCK_PARCEL_SUMMARY = {
  awaitingMapping: 0,
  readyToReceive: 0,
  recentlyReceived: 0,
  lastParcelReceive: "Not wired",
  lastParcelReceiveAt: null,
  parcelLedgerEntries: 0,
};
