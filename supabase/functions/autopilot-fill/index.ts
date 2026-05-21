// Autopilot Fill - Automatically fills the queue with posts daily
// This runs via pg_cron to ensure there are always posts scheduled ahead
//
// Logic:
// 1. Check how many posts are scheduled for the next X days
// 2. If below threshold, auto-generate more using auto-queue logic
// 3. Respects autopilot settings (enabled, days_ahead, posts_per_day, platforms, tones)
//
// Volume math is unchanged here. Product selection/scoring (Phase 3c) lives in auto-queue,
// including selection_metadata.score_breakdown, penalties_applied, and scoring_weights from
// social_settings.auto_queue when configured.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FILL_STATUSES = ["queued", "draft"];

/** Tomorrow 00:00 UTC through tomorrow + daysAhead (exclusive end). */
function getAutopilotFillWindow(daysAhead: number) {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() + 1);
  windowStart.setUTCHours(0, 0, 0, 0);

  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + daysAhead);

  return { windowStart, windowEnd, now };
}

function sanitizeError(message: string): string {
  return String(message || "Unknown error")
    .slice(0, 300)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

async function writeAutopilotLastRun(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
) {
  await supabase.from("social_settings").upsert(
    {
      setting_key: "autopilot_last_run",
      setting_value: {
        ...payload,
        ran_at: new Date().toISOString(),
      },
    },
    { onConflict: "setting_key" }
  );
}

async function countPostsInFillWindow(
  supabase: ReturnType<typeof createClient>,
  windowStart: Date,
  windowEnd: Date
): Promise<number> {
  const { count, error } = await supabase
    .from("social_posts")
    .select("*", { count: "exact", head: true })
    .in("status", FILL_STATUSES)
    .gte("scheduled_for", windowStart.toISOString())
    .lt("scheduled_for", windowEnd.toISOString());

  if (error) {
    console.error("[autopilot] Count query error:", error);
    throw error;
  }

  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const source = body.source === "manual" ? "manual" : "cron";

  let settings: Record<string, unknown> = {};
  let targetCount = 0;
  let currentCount = 0;
  let deficit = 0;
  let platforms: string[] = [];

  try {
    const { data: settingsRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "autopilot")
      .single();

    settings = (settingsRow?.setting_value as Record<string, unknown>) || {
      enabled: false,
      days_ahead: 7,
      posts_per_day: 2,
      platforms: ["instagram"],
      tones: ["casual", "urgency"],
      posting_times: ["10:00", "18:00"],
      resurface_in_autopilot: true,
      resurface_min_age_days: 30,
      resurface_max_per_run: 1,
    };

    const enabled = settings.enabled === true;
    const daysAhead = Number(settings.days_ahead) || 7;
    const postsPerDay = Number(settings.posts_per_day) || 2;
    platforms = Array.isArray(settings.platforms) ? (settings.platforms as string[]) : ["instagram"];

    if (!platforms.length) {
      await writeAutopilotLastRun(supabase, {
        source,
        enabled,
        status: "no_op",
        reason: "no_platforms",
        message: "No platforms selected in autopilot settings",
        target_count: 0,
        current_count: 0,
        deficit: 0,
        posts_created: 0,
        generated: 0,
        platforms: [],
      });
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          status: "no_op",
          reason: "no_platforms",
          message: "No platforms selected in autopilot settings",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { windowStart, windowEnd } = getAutopilotFillWindow(daysAhead);
    targetCount = daysAhead * postsPerDay * platforms.length;

    if (!enabled) {
      console.log("[autopilot] Autopilot is disabled, skipping");
      await writeAutopilotLastRun(supabase, {
        source,
        enabled: false,
        status: "no_op",
        reason: "disabled",
        message: "Autopilot is disabled",
        target_count: targetCount,
        current_count: 0,
        deficit: targetCount,
        posts_created: 0,
        generated: 0,
        platforms,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
      });
      return new Response(
        JSON.stringify({
          success: true,
          message: "Autopilot is disabled",
          skipped: true,
          status: "no_op",
          reason: "disabled",
          target_count: targetCount,
          current_count: 0,
          deficit: targetCount,
          generated: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[autopilot] Running with settings:", settings);

    currentCount = await countPostsInFillWindow(supabase, windowStart, windowEnd);
    deficit = Math.max(0, targetCount - currentCount);

    console.log(
      `[autopilot] Window ${windowStart.toISOString()} → ${windowEnd.toISOString()} | ` +
        `current=${currentCount} target=${targetCount} deficit=${deficit}`
    );

    if (deficit <= 0) {
      console.log("[autopilot] Queue is full, no new posts needed");
      await writeAutopilotLastRun(supabase, {
        source,
        enabled: true,
        status: "no_op",
        reason: "queue_full",
        message: `Queue is at target (${currentCount}/${targetCount} posts in fill window)`,
        target_count: targetCount,
        current_count: currentCount,
        deficit: 0,
        posts_created: 0,
        generated: 0,
        platforms,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
      });
      return new Response(
        JSON.stringify({
          success: true,
          status: "no_op",
          reason: "queue_full",
          message: `Queue is at target (${currentCount}/${targetCount} posts in fill window)`,
          current_count: currentCount,
          target_count: targetCount,
          deficit: 0,
          generated: 0,
          posts_created: 0,
          current: currentCount,
          target: targetCount,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const postsToGenerate = Math.ceil(deficit / platforms.length);
    console.log(`[autopilot] Generating up to ${postsToGenerate} product slot(s) per platform`);

    const autoQueueUrl = `${supabaseUrl}/functions/v1/auto-queue`;

    const resurfaceInAutopilot = settings.resurface_in_autopilot !== false;
    const resurfaceMinAgeDays = Math.max(
      7,
      Math.min(365, Number(settings.resurface_min_age_days) || 30)
    );
    const resurfaceMaxPerRun = Math.max(
      0,
      Math.min(3, Number(settings.resurface_max_per_run) ?? 1)
    );

    const response = await fetch(autoQueueUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        count: postsToGenerate,
        platforms,
        captionTones: settings.tones,
        caption_tones: settings.tones,
        tones: settings.tones,
        postingTimes: settings.posting_times,
        posting_times: settings.posting_times,
        preview: false,
        source: "autopilot",
        resurfaceInAutopilot,
        resurfaceMinAgeDays,
        resurfaceMaxPerRun,
        resurface_in_autopilot: resurfaceInAutopilot,
        resurface_min_age_days: resurfaceMinAgeDays,
        resurface_max_per_run: resurfaceMaxPerRun,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[autopilot] auto-queue failed:", result);
      throw new Error(result.error || `auto-queue returned ${response.status}`);
    }

    const generated = Number(result.generated) || 0;
    const postsBuilt =
      Number(result.generatedCount) ||
      Number(result.run_summary?.posts_built) ||
      0;
    const resurfacedCount = Number(result.run_summary?.resurfaced_count) || 0;
    const newProductCount =
      result.run_summary?.new_product_count != null
        ? Number(result.run_summary.new_product_count)
        : Math.max(0, generated - resurfacedCount);
    const skippedCount = result.run_summary?.skipped_count ?? 0;
    const noPoolSkipped = result.run_summary?.no_pool_asset_skipped ?? 0;
    const skippedErrors = Array.isArray(result.skippedErrors)
      ? (result.skippedErrors as string[]).slice(0, 5)
      : [];

    console.log(
      `[autopilot] auto-queue built=${postsBuilt} saved=${generated} skipped_errors=${skippedErrors.length}`
    );

    let status = "success";
    let reason: string | null = null;
    let message = `Autopilot generated ${generated} post(s)`;
    if (generated > 0 && resurfacedCount > 0) {
      message = `Created ${generated} post(s): ${newProductCount} new, ${resurfacedCount} resurfaced`;
    } else if (generated === 0 && resurfaceInAutopilot) {
      const skipReason = result.run_summary?.resurface_skipped_reason;
      if (skipReason === "no_eligible_winners" || skipReason === "insufficient_engagement_data") {
        message = `No posts created. Resurface enabled but no eligible winners (${skipReason}).`;
      }
    }

    if (generated === 0) {
      status = "no_op";
      if (postsBuilt > 0) {
        reason = "insert_failed";
        const errHint = skippedErrors.length
          ? skippedErrors.join("; ")
          : "Database insert failed (see auto-queue logs)";
        message = `No posts saved (${currentCount}/${targetCount} in fill window, need ${deficit} more). Built ${postsBuilt} in memory. ${errHint}`;
      } else {
        reason = "no_candidates";
        const skipHint =
          skippedCount > 0
            ? `${skippedCount} product(s) skipped (see auto-queue run_summary)`
            : "auto-queue returned zero posts";
        message = `No posts created (${currentCount}/${targetCount} in fill window, need ${deficit} more). ${skipHint}`;
      }
    }

    await writeAutopilotLastRun(supabase, {
      source,
      enabled: true,
      status,
      reason,
      message,
      target_count: targetCount,
      current_count: currentCount,
      deficit,
      posts_created: generated,
      generated,
      resurfaced_count: resurfacedCount,
      new_product_count: newProductCount,
      resurface_enabled: resurfaceInAutopilot,
      resurface_limit: resurfaceMaxPerRun,
      resurface_min_age_days: resurfaceMinAgeDays,
      resurface_skipped_reason: result.run_summary?.resurface_skipped_reason ?? null,
      skipped_count: skippedCount,
      no_pool_asset_skipped: noPoolSkipped,
      image_asset_policy: result.run_summary?.image_asset_policy ?? "image_pool_only",
      platforms,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      auto_queue_message: result.message ?? null,
      posts_built: postsBuilt,
      skipped_errors: skippedErrors.length ? skippedErrors : undefined,
    });

    return new Response(
      JSON.stringify({
        success: true,
        status,
        reason,
        message,
        current_count: currentCount,
        target_count: targetCount,
        deficit,
        generated,
        posts_created: generated,
        posts_built: postsBuilt,
        current: currentCount,
        target: targetCount,
        posts: result.posts,
        run_summary: result.run_summary,
        resurfaced_count: resurfacedCount,
        new_product_count: newProductCount,
        resurface_enabled: resurfaceInAutopilot,
        resurface_limit: resurfaceMaxPerRun,
        skippedErrors: skippedErrors.length ? skippedErrors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMessage = sanitizeError(err instanceof Error ? err.message : String(err));
    console.error("[autopilot] Error:", errorMessage);

    try {
      await writeAutopilotLastRun(supabase, {
        source,
        enabled: settings.enabled === true,
        status: "error",
        reason: "error",
        message: errorMessage,
        target_count: targetCount,
        current_count: currentCount,
        deficit,
        posts_created: 0,
        generated: 0,
        platforms,
        error: errorMessage,
      });
    } catch (logErr) {
      console.error("[autopilot] Failed to write error last_run:", logErr);
    }

    return new Response(
      JSON.stringify({
        success: false,
        status: "error",
        reason: "error",
        error: errorMessage,
        current_count: currentCount,
        target_count: targetCount,
        deficit,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
