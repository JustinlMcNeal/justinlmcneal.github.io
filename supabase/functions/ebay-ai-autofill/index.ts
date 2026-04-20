// supabase/functions/ebay-ai-autofill/index.ts
// AI-powered eBay listing auto-fill using GPT-4o vision
// Generates title, description, and item specifics with confidence/source metadata
// GUARDRAILS: AI does NOT choose category, does NOT include shipping/policy info

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function errorResponse(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 500);
    }

    const body = await req.json();
    const {
      productName = "",
      productCode = "",
      category = "",
      price,
      imageUrls = [],
      existingAspects = [],
    } = body;

    if (!productName) {
      return errorResponse("productName is required");
    }

    // Build image content for GPT-4o vision (cap at 4 images, low detail)
    const imageContent: Array<{
      type: "image_url";
      image_url: { url: string; detail: string };
    }> = [];

    for (const url of imageUrls) {
      if (url && typeof url === "string" && url.startsWith("https://")) {
        imageContent.push({
          type: "image_url",
          image_url: { url, detail: "low" },
        });
      }
      if (imageContent.length >= 4) break;
    }

    // Build the system prompt with strict guardrails
    const systemPrompt = `You are an expert eBay listing copywriter for "Karry Kraze", a trendy online store selling fashion accessories, bags, headwear, jewelry, plushies, and collectibles. Target audience: Gen-Z and young women (ages 16-28).

Your job is to generate an optimized eBay listing from product data and images.

STRICT RULES:
1. TITLE: Create an SEO-optimized eBay title, max 80 characters. Pack with relevant search keywords buyers would use. Do NOT include "Karry Kraze" or brand name in title.
2. DESCRIPTION: Write product features ONLY. Do NOT include:
   - Shipping information, handling times, or delivery promises
   - Return policy or refund terms
   - Store information or links
   - Payment methods
   Focus on: what the product IS, materials, colors, features, who it's for, occasions.
3. ITEM SPECIFICS: Only fill values you can determine from the data or images.
   - For each specific, indicate your confidence:
     - "certain" = directly from product data
     - "inferred" = visible in images or strongly implied
     - "unknown" = cannot determine (return empty string)
   - SAFE DEFAULTS: Brand is always "Unbranded" unless stated otherwise.
   - Do NOT guess: material, size, weight, dimensions unless clearly visible.
4. DO NOT suggest an eBay category. Category selection is handled separately by the Taxonomy API.

You MUST respond with ONLY valid JSON. No markdown, no code fences, no explanation.

JSON structure:
{
  "title": {
    "value": "string (max 80 chars)",
    "confidence": 0.0-1.0,
    "source": "generated"
  },
  "description_html": {
    "value": "<ul><li>Feature 1</li>...</ul>",
    "confidence": 0.0-1.0,
    "source": "generated"
  },
  "item_specifics": [
    {
      "name": "Aspect Name",
      "value": "value or empty string if unknown",
      "source": "default|from_data|inferred",
      "confidence": 0.0-1.0
    }
  ],
  "notes": ["string array of things admin should review"]
}`;

    // Build user prompt
    let userPrompt = `Generate an eBay listing for this product:\n\n`;
    userPrompt += `Product Name: ${productName}\n`;
    if (productCode) userPrompt += `Product Code: ${productCode}\n`;
    if (category) userPrompt += `Store Category: ${category}\n`;
    if (price) userPrompt += `Price: $${Number(price).toFixed(2)}\n`;

    if (existingAspects.length > 0) {
      userPrompt += `\nThe selected eBay category expects these item specifics (fill what you can):\n`;
      userPrompt += existingAspects.map((a: string) => `- ${a}`).join("\n");
    } else {
      userPrompt += `\nFill common item specifics: Brand, Type, Color, Material, Style, Theme (leave unknown ones empty).`;
    }

    userPrompt += `\n\nDescription should be a clean HTML unordered list (<ul><li>) of 4-6 product features. Keep it concise and engaging.`;
    userPrompt += `\n\nReturn ONLY valid JSON.`;

    console.log(
      `[ebay-ai-autofill] Product: ${productName}, Images: ${imageContent.length}, Aspects: ${existingAspects.length}`
    );

    // Build messages array
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
      { type: "text", text: userPrompt },
    ];
    for (const img of imageContent) {
      userContent.push(img as unknown as { type: string; image_url: { url: string; detail: string } });
    }

    // Call OpenAI GPT-4o
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 2000,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[ebay-ai-autofill] OpenAI error:", response.status, errBody);
      return errorResponse(`OpenAI API error: ${response.status}`, 502);
    }

    const completion = await response.json();
    const rawContent = completion.choices?.[0]?.message?.content?.trim() || "";

    console.log("[ebay-ai-autofill] Raw response length:", rawContent.length);

    if (!rawContent) {
      return errorResponse("AI returned an empty response. Please try again.", 502);
    }

    // Parse JSON — strip markdown fences just in case
    let cleaned = rawContent;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr: unknown) {
      const snippet = cleaned.substring(0, 300);
      console.error("[ebay-ai-autofill] Failed to parse JSON:", snippet);
      return errorResponse("AI returned invalid JSON. Please try again.", 502);
    }

    // Validate and sanitize the output
    const title = parsed.title || {};
    if (typeof title.value === "string" && title.value.length > 80) {
      title.value = title.value.substring(0, 80);
      (parsed.notes || []).push("Title was truncated to 80 characters");
    }

    const result = {
      success: true,
      data: {
        title: {
          value: title.value || productName,
          confidence: typeof title.confidence === "number" ? title.confidence : 0.8,
          source: "generated",
        },
        description_html: {
          value: parsed.description_html?.value || "",
          confidence: typeof parsed.description_html?.confidence === "number" ? parsed.description_html.confidence : 0.8,
          source: "generated",
        },
        item_specifics: Array.isArray(parsed.item_specifics)
          ? parsed.item_specifics
              .filter((s: { name?: string; value?: string }) => s.name && s.value)
              .map((s: { name: string; value: string; source?: string; confidence?: number }) => ({
                name: s.name,
                value: s.value,
                source: s.source || "inferred",
                confidence: typeof s.confidence === "number" ? s.confidence : 0.7,
              }))
          : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      },
    };

    console.log(
      `[ebay-ai-autofill] Generated: title=${result.data.title.value.length}ch, ` +
        `desc=${result.data.description_html.value.length}ch, ` +
        `specifics=${result.data.item_specifics.length}`
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ebay-ai-autofill] Error:", msg);
    return errorResponse(msg || "Internal error", 500);
  }
});
