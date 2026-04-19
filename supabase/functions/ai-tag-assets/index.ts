// ai-tag-assets — Auto-tag social assets with shot_type and quality_score using GPT-4o-mini vision
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

const SHOT_TYPES = [
  "product_flat",
  "product_angle",
  "closeup",
  "lifestyle",
  "model",
  "packaging",
  "group",
  "scale",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "OPENAI_API_KEY not configured" }),
        { headers: corsHeaders, status: 500 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const { asset_ids } = await req.json();
    if (!asset_ids?.length) {
      return new Response(
        JSON.stringify({ success: false, error: "asset_ids required" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Fetch assets
    const { data: assets, error: fetchErr } = await supabase
      .from("social_assets")
      .select("id, original_image_path, product_id")
      .in("id", asset_ids)
      .eq("is_active", true);

    if (fetchErr || !assets?.length) {
      return new Response(
        JSON.stringify({ success: false, error: fetchErr?.message || "No assets found" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Get product names for context
    const productIds = [...new Set(assets.filter(a => a.product_id).map(a => a.product_id))];
    let productMap: Record<string, string> = {};
    if (productIds.length) {
      const { data: products } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds);
      productMap = Object.fromEntries((products || []).map(p => [p.id, p.name]));
    }

    const results: { id: string; shot_type: string; quality_score: number; success: boolean; error?: string }[] = [];

    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < assets.length; i += 5) {
      const batch = assets.slice(i, i + 5);

      const batchPromises = batch.map(async (asset) => {
        try {
          const imageUrl = asset.original_image_path.startsWith("http")
            ? asset.original_image_path
            : `${supabaseUrl}/storage/v1/object/public/social-media/${asset.original_image_path}`;

          const productName = asset.product_id ? productMap[asset.product_id] || "unknown product" : "unknown product";

          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              max_tokens: 150,
              messages: [
                {
                  role: "system",
                  content: `You analyze product images for an e-commerce social media system. Return JSON only, no markdown.

Classify the shot_type as one of: ${SHOT_TYPES.join(", ")}
Rate quality_score 1-5:
  5 = studio quality, perfect lighting, sharp focus
  4 = good quality, minor issues
  3 = acceptable, some blur or poor lighting
  2 = below average, significant issues
  1 = unusable, too blurry/dark/cropped

Respond with: {"shot_type":"...","quality_score":N}`,
                },
                {
                  role: "user",
                  content: [
                    { type: "text", text: `Product: "${productName}". Classify this image.` },
                    { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
                  ],
                },
              ],
            }),
          });

          if (!resp.ok) {
            const errBody = await resp.text();
            console.error(`[ai-tag] OpenAI error for ${asset.id}:`, errBody);
            return { id: asset.id, shot_type: "product_flat", quality_score: 3, success: false, error: `OpenAI ${resp.status}` };
          }

          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || "";
          
          // Parse JSON from response (handle potential markdown wrapping)
          const jsonStr = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const parsed = JSON.parse(jsonStr);

          const shotType = SHOT_TYPES.includes(parsed.shot_type) ? parsed.shot_type : "product_flat";
          const qualityScore = Math.max(1, Math.min(5, Math.round(parsed.quality_score || 3)));

          // Update asset in DB
          await supabase
            .from("social_assets")
            .update({
              shot_type: shotType,
              quality_score: qualityScore,
              updated_at: new Date().toISOString(),
            })
            .eq("id", asset.id);

          console.log(`[ai-tag] Tagged ${asset.id}: ${shotType}, quality=${qualityScore}`);
          return { id: asset.id, shot_type: shotType, quality_score: qualityScore, success: true };
        } catch (err: unknown) {
          console.error(`[ai-tag] Failed for ${asset.id}:`, err);
          return { id: asset.id, shot_type: "product_flat", quality_score: 3, success: false, error: err instanceof Error ? err.message : String(err) };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const tagged = results.filter(r => r.success).length;
    console.log(`[ai-tag] Done: ${tagged}/${results.length} tagged successfully`);

    return new Response(
      JSON.stringify({ success: true, tagged, total: results.length, results }),
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error("[ai-tag] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
