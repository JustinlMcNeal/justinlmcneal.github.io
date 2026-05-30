// amazon-verify-submitted-drafts-cron — Scheduled read-only verification retry for submitted drafts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json } from "../_shared/amazonAuthUtils.ts";
import {
  asDraftRowForVerify,
  verifySubmittedDraftOnce,
} from "../_shared/amazonDraftVerifyUtils.ts";
import {
  getMaxVerifyAttempts,
  getVerifyBatchSize,
  markVerifyAttemptStart,
  markVerifyFailed,
  markVerifyNotFound,
  requireCronSecret,
} from "../_shared/amazonDraftVerifyQueueUtils.ts";
import { maybeSendMaxAttemptsOperatorAlert } from "../_shared/amazonDraftVerifyAlertUtils.ts";

const LOG_PREFIX = "[amazon-verify-submitted-drafts-cron]";

function buildSyncEnv() {
  return {
    lwaClientId: Deno.env.get("AMAZON_LWA_CLIENT_ID") || "",
    lwaClientSecret: Deno.env.get("AMAZON_LWA_CLIENT_SECRET") || "",
    spApiEndpointOverride: Deno.env.get("AMAZON_SP_API_ENDPOINT") || null,
    awsAccessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID") || null,
    awsSecretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY") || null,
    awsSessionToken: Deno.env.get("AWS_SESSION_TOKEN") || null,
    awsRegionOverride: Deno.env.get("AWS_REGION") || null,
    allowUnsignedSpApi: Deno.env.get("AMAZON_ALLOW_UNSIGNED_SP_API") === "true",
  };
}

function isDueForVerify(row: Record<string, unknown>, nowMs: number): boolean {
  const next = row.next_verify_after;
  if (next == null || next === "") return true;
  const nextMs = new Date(String(next)).getTime();
  return !Number.isNaN(nextMs) && nextMs <= nowMs;
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
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const syncEnv = buildSyncEnv();

  if (!supabaseUrl || !supabaseServiceKey || !cronSecret ||
    !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  if (!requireCronSecret(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const maxAttempts = getMaxVerifyAttempts();
  const batchSize = getVerifyBatchSize();
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();
  const nowMs = Date.now();

  let processed = 0;
  let verified = 0;
  let notFound = 0;
  let failed = 0;
  let maxAttemptsCount = 0;
  let alertsSent = 0;

  try {
    const { data: candidates, error: selectErr } = await serviceClient
      .from("amazon_listing_drafts")
      .select("*")
      .eq("draft_status", "submitted")
      .lt("verify_attempts", maxAttempts)
      .neq("verify_status", "max_attempts")
      .order("next_verify_after", { ascending: true, nullsFirst: true })
      .limit(batchSize * 3);

    if (selectErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }

    const due = (candidates || [])
      .filter((row) => isDueForVerify(row as Record<string, unknown>, nowMs))
      .slice(0, batchSize);

    for (const draftRaw of due) {
      const row = draftRaw as Record<string, unknown>;
      const draftId = String(row.id || "");
      const currentAttempts = Number(row.verify_attempts || 0);
      const nextAttempt = currentAttempts + 1;

      if (!draftId || nextAttempt > maxAttempts) {
        maxAttemptsCount += 1;
        continue;
      }

      processed += 1;

      try {
        await markVerifyAttemptStart(serviceClient, draftId, nextAttempt, now);

        const draft = asDraftRowForVerify(row);
        const result = await verifySubmittedDraftOnce(
          serviceClient,
          draft,
          null,
          syncEnv,
          { runSingleSkuSync: true },
        );

        if (result.status === "verified") {
          verified += 1;
          console.log(`${LOG_PREFIX} verified draftId=${draftId}`);
          continue;
        }

        if (result.status === "not_found") {
          const reachedMax = await markVerifyNotFound(
            serviceClient,
            draftId,
            nextAttempt,
            now,
            maxAttempts,
          );
          if (reachedMax) {
            maxAttemptsCount += 1;
            try {
              const alert = await maybeSendMaxAttemptsOperatorAlert(serviceClient, draftId, now);
              if (alert.sent) alertsSent += 1;
            } catch {
              console.log(`${LOG_PREFIX} alert_failed draftId=${draftId}`);
            }
          } else {
            notFound += 1;
          }
          continue;
        }

        const reachedMax = await markVerifyFailed(
          serviceClient,
          draftId,
          nextAttempt,
          result.error,
          now,
          maxAttempts,
        );
        if (reachedMax) {
          maxAttemptsCount += 1;
          try {
            const alert = await maybeSendMaxAttemptsOperatorAlert(serviceClient, draftId, now);
            if (alert.sent) alertsSent += 1;
          } catch {
            console.log(`${LOG_PREFIX} alert_failed draftId=${draftId}`);
          }
        } else {
          failed += 1;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "database_error";
        try {
          const reachedMax = await markVerifyFailed(
            serviceClient,
            draftId,
            nextAttempt,
            message,
            now,
            maxAttempts,
          );
          if (reachedMax) {
            maxAttemptsCount += 1;
            try {
              const alert = await maybeSendMaxAttemptsOperatorAlert(serviceClient, draftId, now);
              if (alert.sent) alertsSent += 1;
            } catch {
              console.log(`${LOG_PREFIX} alert_failed draftId=${draftId}`);
            }
          } else {
            failed += 1;
          }
        } catch {
          // swallow secondary DB error
        }
      }
    }

    console.log(
      `${LOG_PREFIX} done processed=${processed} verified=${verified} notFound=${notFound} failed=${failed} alerts=${alertsSent}`,
    );

    return json({
      ok: true,
      processed,
      verified,
      notFound,
      failed,
      maxAttempts: maxAttemptsCount,
      alertsSent,
    });
  } catch {
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
