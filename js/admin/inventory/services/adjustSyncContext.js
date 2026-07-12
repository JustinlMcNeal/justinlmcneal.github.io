/**
 * Sync run correlation payload for adjust-triggered channel pushes (Phase 059A.4).
 * Supports sync-only runs (KK unchanged) when ledgerId is empty.
 */

/**
 * @param {string} orchestrationId
 * @param {string} [ledgerId]
 * @returns {Record<string, string>|null}
 */
export function buildAdjustSyncContext(orchestrationId, ledgerId) {
  const ledger = String(ledgerId || "").trim();
  const orch = String(orchestrationId || "").trim();
  if (!orch) return null;

  if (!ledger) {
    return {
      trigger_source: "manual_marketplace_resync",
      trigger_reference_type: "orchestration",
      trigger_reference_id: orch,
      orchestration_id: orch,
    };
  }

  return {
    trigger_source: "manual_adjust",
    trigger_reference_type: "stock_ledger",
    trigger_reference_id: ledger,
    stock_ledger_id: ledger,
    orchestration_id: orch,
  };
}
