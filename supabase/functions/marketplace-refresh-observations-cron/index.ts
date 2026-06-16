// marketplace-refresh-observations-cron — Scheduled observation backfill (read-only, no marketplace API).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json } from "../_shared/amazonAuthUtils.ts";
import { requireCronSecret } from "../_shared/amazonSyncCronUtils.ts";
import { refreshMarketplaceObservationsAfterSync } from "../_shared/marketplaceObservationRefresh.ts";

const LOG_PREFIX = "[marketplace-obs-cron]";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!supabaseUrl || !supabaseServiceKey || !cronSecret) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }
  if (!requireCronSecret(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let daysBack = 14;
  try {
    const body = await req.json();
    if (typeof body?.days_back === "number" && Number.isFinite(body.days_back)) {
      daysBack = Math.min(90, Math.max(1, Math.floor(body.days_back)));
    }
  } catch {
    /* default window */
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const obsRefresh = await refreshMarketplaceObservationsAfterSync(serviceClient, {
      channel: "all",
      daysBack,
      logPrefix: LOG_PREFIX,
    });

    console.log(`${LOG_PREFIX} done days_back=${daysBack} ok=${obsRefresh.ok}`);

    return json({
      ok: obsRefresh.ok,
      success: obsRefresh.ok,
      days_back: daysBack,
      observation_refresh: obsRefresh,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} error`, message);
    return json({ ok: false, error: message }, 500);
  }
});
