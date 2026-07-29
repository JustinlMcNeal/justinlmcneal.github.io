/** Phase 061B — Sale channel sync shared types and helpers. */

export type SaleSourceChannel = "kk" | "amazon" | "ebay";
export type SaleTargetChannel = "amazon" | "ebay";

export type SaleSyncQueueStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "dry_run"
  | "skipped"
  | "partial"
  | "failed"
  | "dead";

export type SaleChannelTargetResult = {
  channel: SaleTargetChannel;
  path: string;
  status: "success" | "dry_run" | "skipped" | "manual" | "failed";
  message: string;
  runId?: string;
  errors?: string[];
  warnings?: string[];
};

export type SaleChannelSyncInput = {
  sourceChannel: SaleSourceChannel;
  productId: string;
  variantId: string;
  availableQty: number;
  externalOrderId: string;
  externalLineId: string;
  holdActionId?: string;
  reservationId?: string;
  idempotencyKey: string;
  preview?: boolean;
  syncContext?: {
    trigger_source: "sale" | "sale_release";
    trigger_reference_type: "order_line";
    trigger_reference_id: string;
    stock_reservation_id?: string;
    orchestration_id?: string;
  };
};

export type SaleChannelSyncOutput = {
  status: "success" | "dry_run" | "partial" | "skipped" | "failed";
  sourceChannel: SaleSourceChannel;
  variantId: string;
  availableQty: number;
  results: SaleChannelTargetResult[];
  idempotencyKey: string;
  issueHints?: string[];
};

export function buildSalePushIdempotencyKey(
  sourceChannel: string,
  externalOrderId: string,
  externalLineId: string,
): string {
  return `sale:${sourceChannel}:${externalOrderId}:${externalLineId}:push`;
}

/** Idempotency key for channel re-push after cancel/refund release (061C.2). */
export function buildSaleReleasePushIdempotencyKey(
  sourceChannel: string,
  externalOrderId: string,
  externalLineId: string,
): string {
  return `sale:${sourceChannel}:${externalOrderId}:${externalLineId}:release_push`;
}

export function buildSalePushTargetIdempotencyKey(
  baseKey: string,
  targetChannel: SaleTargetChannel,
): string {
  return `${baseKey}:${targetChannel}`;
}

export function resolveSaleTargetChannels(
  sourceChannel: SaleSourceChannel,
): SaleTargetChannel[] {
  if (sourceChannel === "kk") return ["amazon", "ebay"];
  if (sourceChannel === "amazon") return ["ebay"];
  if (sourceChannel === "ebay") return ["amazon"];
  return [];
}

export function aggregateSaleSyncStatus(
  results: SaleChannelTargetResult[],
): SaleChannelSyncOutput["status"] {
  if (!results.length) return "skipped";
  const statuses = results.map((r) => r.status);
  if (statuses.every((s) => s === "skipped" || s === "manual")) return "skipped";
  if (statuses.every((s) => s === "dry_run")) return "dry_run";
  if (statuses.every((s) => s === "success")) return "success";
  if (statuses.some((s) => s === "success" || s === "dry_run") && statuses.some((s) => s === "failed")) {
    return "partial";
  }
  if (statuses.some((s) => s === "success")) return "partial";
  if (statuses.some((s) => s === "dry_run")) return "dry_run";
  if (statuses.every((s) => s === "failed")) return "failed";
  return "partial";
}

export function mapOrchestratorStatusToQueueStatus(
  status: SaleChannelSyncOutput["status"],
): SaleSyncQueueStatus {
  if (status === "success") return "succeeded";
  if (status === "dry_run") return "dry_run";
  if (status === "partial") return "partial";
  if (status === "skipped") return "skipped";
  return "failed";
}
