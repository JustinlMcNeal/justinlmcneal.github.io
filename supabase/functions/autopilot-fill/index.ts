// Autopilot Fill - Automatically fills the queue with posts daily
// This runs via pg_cron to ensure there are always posts scheduled ahead
// 
// Logic:
// 1. Check how many posts are scheduled for the next X days
// 2. If below threshold, auto-generate more using auto-queue logic
// 3. Respects autopilot settings (enabled, days_ahead, posts_per_day, platforms, tones)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get autopilot settings
    const { data: settingsRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "autopilot")
      .single();

    const settings = settingsRow?.setting_value || {
      enabled: false,
      days_ahead: 7,
      posts_per_day: 2,
      platforms: ["instagram"],
      tones: ["casual", "urgency"],
      posting_times: ["10:00", "18:00"],
    };

    // Check if autopilot is enabled
    if (!settings.enabled) {
      console.log("[autopilot] Autopilot is disabled, skipping");
      return new Response(JSON.stringify({
        success: true,
        message: "Autopilot is disabled",
        skipped: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("[autopilot] Running with settings:", settings);

    // 2. Count posts scheduled for the next X days
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + settings.days_ahead);

    const { count: scheduledCount } = await supabase
      .from("social_posts")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "draft"])
      .gte("scheduled_for", now.toISOString())
      .lte("scheduled_for", futureDate.toISOString());

    const targetCount = settings.days_ahead * settings.posts_per_day * settings.platforms.length;
    const currentCount = scheduledCount || 0;
    const deficit = targetCount - currentCount;

    console.log(`[autopilot] Current: ${currentCount}, Target: ${targetCount}, Deficit: ${deficit}`);

    // 3. If we have enough posts, skip
    if (deficit <= 0) {
      console.log("[autopilot] Queue is full, no new posts needed");
      return new Response(JSON.stringify({
        success: true,
        message: `Queue is full (${currentCount}/${targetCount} posts)`,
        current: currentCount,
        target: targetCount,
        generated: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. Calculate how many posts to generate (per platform)
    const postsToGenerate = Math.ceil(deficit / settings.platforms.length);
    console.log(`[autopilot] Generating ${postsToGenerate} posts per platform`);

    // 5. Call auto-queue function to generate posts
    const autoQueueUrl = `${supabaseUrl}/functions/v1/auto-queue`;
    
    const response = await fetch(autoQueueUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        count: postsToGenerate,
        platforms: settings.platforms,
        tones: settings.tones,
        posting_times: settings.posting_times,
        preview: false,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to generate posts");
    }

    console.log(`[autopilot] Generated ${result.generated} posts`);

    // 6. Log autopilot activity
    await supabase
      .from("social_settings")
      .upsert({
        setting_key: "autopilot_last_run",
        setting_value: {
          ran_at: new Date().toISOString(),
          generated: result.generated,
          current_queue: currentCount + result.generated,
          target_queue: targetCount,
        },
      });

    return new Response(JSON.stringify({
      success: true,
      message: `Autopilot generated ${result.generated} posts`,
      current: currentCount,
      target: targetCount,
      generated: result.generated,
      posts: result.posts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[autopilot] Error:", err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
