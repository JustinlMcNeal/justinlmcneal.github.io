// Phase 10P — Post-sync observation refresh (read-only backfill RPC wrapper).

export type MarketplaceObservationRefreshResult = {
  ok: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
  confidence_counts?: Record<string, number>;
  amazon_canceled_retained?: number;
  ebay_canceled_updated?: number;
  total_observations?: number;
  channel?: string;
  error?: string;
};

// deno-lint-ignore no-explicit-any
type DbClient = any;

function parseRefreshPayload(data: unknown): Omit<MarketplaceObservationRefreshResult, "ok" | "error"> {
  const row = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  return {
    inserted: Number(row.inserted ?? 0),
    updated: Number(row.updated ?? 0),
    skipped: Number(row.skipped ?? 0),
    confidence_counts: (row.confidence_counts as Record<string, number>) ?? {},
    amazon_canceled_retained: Number(row.amazon_canceled_retained ?? 0),
    ebay_canceled_updated: Number(row.ebay_canceled_updated ?? 0),
    total_observations: Number(row.total_observations ?? 0),
    channel: String(row.channel ?? ""),
  };
}

/**
 * Idempotent observation backfill after sync jobs. Non-throwing — logs and returns ok:false on failure.
 */
export async function refreshMarketplaceObservationsAfterSync(
  client: DbClient,
  opts: {
    channel: "all" | "ebay" | "amazon";
    daysBack?: number;
    sourceOrderId?: string | null;
    logPrefix?: string;
  },
): Promise<MarketplaceObservationRefreshResult> {
  const logPrefix = opts.logPrefix ?? "[marketplace-obs-refresh]";
  const since = opts.daysBack != null
    ? new Date(Date.now() - opts.daysBack * 24 * 60 * 60 * 1000).toISOString()
    : null;

  try {
    const { data, error } = await client.rpc("backfill_marketplace_refund_observations", {
      p_channel: opts.channel,
      p_since: since,
      p_limit: null,
      p_source_order_id: opts.sourceOrderId ?? null,
    });

    if (error) {
      console.warn(`${logPrefix} observation refresh failed:`, error.message);
      return { ok: false, error: error.message };
    }

    const parsed = parseRefreshPayload(data);
    const conf = parsed.confidence_counts ?? {};
    console.log(
      `${logPrefix} channel=${opts.channel} inserted=${parsed.inserted} updated=${parsed.updated} ` +
        `line_confirmed=${conf.line_confirmed ?? 0} sku_inferred=${conf.sku_inferred ?? 0} ` +
        `order_level=${conf.order_level ?? 0} manual_review=${conf.manual_review ?? 0} ` +
        `amazon_canceled=${parsed.amazon_canceled_retained} ebay_canceled=${parsed.ebay_canceled_updated}`,
    );

    return { ok: true, ...parsed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} observation refresh error:`, msg);
    return { ok: false, error: msg };
  }
}
