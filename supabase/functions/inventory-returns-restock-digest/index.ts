// inventory-returns-restock-digest — Admin/cron returns/restock digest (read-only; optional email).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { requireCronSecret } from "../_shared/amazonSyncCronUtils.ts";
import {
  buildDigestPresetLinks,
  digestEmailConfigured,
  fetchDigestData,
  formatDigestHtml,
  formatDigestText,
  scheduleWindowForRunType,
  sendDigestEmail,
  summaryCountsPayload,
} from "../_shared/returnsRestockDigestUtils.ts";

const LOG_PREFIX = "[returns-restock-digest]";

type RunType = "daily" | "weekly" | "manual";
type DigestMode = "preview" | "send";

type RequestBody = {
  mode?: DigestMode;
  run_type?: RunType;
  confirm?: boolean;
};

function parseBody(raw: RequestBody) {
  const mode: DigestMode = raw.mode === "send" ? "send" : "preview";
  const runType: RunType =
    raw.run_type === "weekly" ? "weekly" : raw.run_type === "manual" ? "manual" : "daily";
  return { mode, runType, confirm: Boolean(raw.confirm) };
}

async function hasSentForWindow(
  // deno-lint-ignore no-explicit-any
  client: any,
  runType: RunType,
  scheduleWindow: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("inventory_returns_restock_digest_runs")
    .select("id")
    .eq("run_type", runType)
    .eq("schedule_window", scheduleWindow)
    .eq("status", "sent")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const isCron = Boolean(cronSecret && requireCronSecret(req));
  let actorUserId: string | null = null;

  if (!isCron) {
    const authHeader = req.headers.get("authorization") || "";
    const admin = await requireAdminJson(createClient, supabaseUrl, supabaseAnonKey, authHeader, LOG_PREFIX);
    if (!admin.ok) return admin.response;
    actorUserId = admin.userId;
  }

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { mode, runType, confirm } = parseBody(body);

  if (mode === "send" && !isCron && !confirm) {
    return json({ ok: false, error: "confirm_required", message: "Send requires confirm: true" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const scheduleWindow = scheduleWindowForRunType(runType);

  try {
    if (mode === "send" && runType !== "manual") {
      const alreadySent = await hasSentForWindow(serviceClient, runType, scheduleWindow);
      if (alreadySent) {
        await serviceClient.from("inventory_returns_restock_digest_runs").insert({
          run_type: runType,
          schedule_window: scheduleWindow,
          delivery_channel: "none",
          recipient: null,
          status: "skipped_duplicate",
          summary_counts: null,
          error: null,
        });
        return json({
          ok: true,
          skipped_duplicate: true,
          run_type: runType,
          schedule_window: scheduleWindow,
          message: "Digest already sent for this schedule window",
        });
      }
    }

    const { summary, items } = await fetchDigestData(serviceClient);
    const links = buildDigestPresetLinks();
    const text = formatDigestText(summary, items, links, runType);
    const html = formatDigestHtml(summary, items, links, runType);
    const counts = summaryCountsPayload(summary);

    if (mode === "preview") {
      return json({
        ok: true,
        mode: "preview",
        run_type: runType,
        schedule_window: scheduleWindow,
        summary: counts,
        item_count: items.length,
        text,
        html,
        links,
        email_configured: digestEmailConfigured(),
      });
    }

    const recipient = Deno.env.get("RETURNS_RESTOCK_DIGEST_EMAIL_TO")?.trim() || null;
    let deliveryChannel = "none";
    let sentAt: string | null = null;
    let status: "sent" | "failed" = "sent";
    let error: string | null = null;

    if (digestEmailConfigured() && recipient) {
      try {
        const subjectPrefix = runType === "weekly" ? "Weekly" : runType === "manual" ? "Manual" : "Daily";
        await sendDigestEmail(
          recipient,
          `${subjectPrefix} Returns & Restock Digest — ${scheduleWindow}`,
          text,
          html,
        );
        deliveryChannel = "email";
        sentAt = new Date().toISOString();
      } catch (err: unknown) {
        status = "failed";
        error = err instanceof Error ? err.message : String(err);
      }
    } else if (isCron) {
      deliveryChannel = "none";
      error = "email_not_configured";
      status = "failed";
    } else {
      deliveryChannel = "none";
      sentAt = new Date().toISOString();
    }

    await serviceClient.from("inventory_returns_restock_digest_runs").insert({
      run_type: runType,
      schedule_window: scheduleWindow,
      delivery_channel: deliveryChannel,
      recipient,
      status,
      summary_counts: counts,
      error,
      sent_at: sentAt,
    });

    console.log(`${LOG_PREFIX} send run_type=${runType} status=${status} actor=${actorUserId || "cron"}`);

    return json({
      ok: status === "sent",
      mode: "send",
      run_type: runType,
      schedule_window: scheduleWindow,
      delivery_channel: deliveryChannel,
      recipient,
      email_configured: digestEmailConfigured(),
      summary: counts,
      item_count: items.length,
      text,
      html,
      links,
      error,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} error`, message);
    return json({ ok: false, error: message }, 500);
  }
});
