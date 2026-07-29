// process-sale-channel-sync-queue — Worker for sale-triggered channel sync queue (Phase 061B.2).
// Service role + CRON_SECRET or admin auth. No sale trigger wiring in 061B.2.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { requireCronSecret } from "../_shared/amazonSyncCronUtils.ts";
import {
  runSaleChannelSync,
  saleSyncInputFromQueueJob,
} from "../_shared/saleChannelSyncOrchestrator.ts";
import {
  claimSaleSyncJobs,
  markSaleSyncJobResult,
} from "../_shared/saleSyncQueue.ts";
import { mapOrchestratorStatusToQueueStatus } from "../_shared/saleChannelSyncTypes.ts";

const LOG_PREFIX = "[process-sale-channel-sync-queue]";

type Payload = {
  limit?: unknown;
  preview?: unknown;
  workerId?: unknown;
};

function parseLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(Math.trunc(n), 50);
}

function defaultPreview(body: Payload): boolean {
  if (body.preview === false) return false;
  return true;
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const cronOk = requireCronSecret(req);
  const authHeader = req.headers.get("authorization");
  let adminOk = false;
  if (!cronOk && authHeader && supabaseAnonKey) {
    const admin = await requireAdminJson(
      createClient,
      supabaseUrl,
      supabaseAnonKey,
      authHeader,
      LOG_PREFIX,
    );
    adminOk = admin.ok;
  }
  if (!cronOk && !adminOk) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: Payload = {};
  try {
    body = (await req.json()) as Payload;
  } catch {
    body = {};
  }

  const limit = parseLimit(body.limit);
  const preview = defaultPreview(body);
  const workerId = typeof body.workerId === "string" && body.workerId.trim()
    ? body.workerId.trim()
    : "process-sale-channel-sync-queue";

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const jobs = await claimSaleSyncJobs({
      supabase: serviceClient,
      limit,
      workerId,
    });

    const summary = {
      processed: 0,
      succeeded: 0,
      dryRun: 0,
      skipped: 0,
      partial: 0,
      failed: 0,
      dead: 0,
      results: [] as Record<string, unknown>[],
    };

    for (const job of jobs) {
      summary.processed++;
      try {
        const input = saleSyncInputFromQueueJob(job);
        const result = await runSaleChannelSync(serviceClient, input, { preview });
        const queueStatus = mapOrchestratorStatusToQueueStatus(result.status);

        await markSaleSyncJobResult({
          supabase: serviceClient,
          jobId: job.id,
          status: queueStatus === "failed" ? "failed" : queueStatus,
          result: result as unknown as Record<string, unknown>,
          error: result.status === "failed"
            ? result.results.map((r) => r.message).join("; ")
            : null,
        });

        if (queueStatus === "succeeded") summary.succeeded++;
        else if (queueStatus === "dry_run") summary.dryRun++;
        else if (queueStatus === "skipped") summary.skipped++;
        else if (queueStatus === "partial") summary.partial++;
        else if (queueStatus === "dead") summary.dead++;
        else if (queueStatus === "failed") summary.failed++;

        summary.results.push({
          jobId: job.id,
          variantId: job.variant_id,
          sourceChannel: job.source_channel,
          status: result.status,
          queueStatus,
          results: result.results,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_PREFIX} job ${job.id} error:`, message);
        await markSaleSyncJobResult({
          supabase: serviceClient,
          jobId: job.id,
          status: "failed",
          result: null,
          error: message,
        });
        summary.failed++;
        summary.results.push({ jobId: job.id, status: "failed", error: message });
      }
    }

    console.log(
      `${LOG_PREFIX} done processed=${summary.processed} succeeded=${summary.succeeded} dryRun=${summary.dryRun}`,
    );

    return json({ ok: true, preview, ...summary });
  } catch (err) {
    console.error(`${LOG_PREFIX} fatal`, err);
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
