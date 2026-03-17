// supabase/functions/ai-product-fill/index.ts
// AI-powered product description generator using GPT-4o vision
// Analyzes product images and returns description, sizing, care, tags, and name

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function error(msg: string, status = 400) {
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
      return error("OPENAI_API_KEY not configured", 500);
    }

    const body = await req.json();
    const {
      images = [],
      imageUrls = [],
      productName,
      category,
      sections = ["description", "sizing", "care"],
    } = body;

    // Build image content for the vision API
    const imageContent: Array<{
      type: "image_url";
      image_url: { url: string; detail: string };
    }> = [];

    // Add base64 images
    for (const img of images) {
      const dataUri = img.startsWith("data:")
        ? img
        : `data:image/jpeg;base64,${img}`;
      imageContent.push({
        type: "image_url",
        image_url: { url: dataUri, detail: "low" },
      });
    }

    // Add URL-based images (use low detail to reduce token cost)
    for (const url of imageUrls) {
      if (url && url.startsWith("http")) {
        imageContent.push({
          type: "image_url",
          image_url: { url, detail: "low" },
        });
      }
    }

    if (imageContent.length === 0) {
      return error("At least one image (base64 or URL) is required for AI analysis");
    }

    // Cap at 4 images to stay within token limits
    const cappedImages = imageContent.slice(0, 4);

    // Build the system prompt
    const systemPrompt = `You are an expert e-commerce product copywriter for "Karry Kraze", a trendy online store selling fashion accessories, bags, headwear, jewelry, plushies, and collectibles. Your target audience is Gen-Z and young women (ages 16-28).

Your task is to analyze product images and generate structured product information. Write engaging, concise bullet points that highlight key features and appeal to young, fashion-forward customers.

IMPORTANT RULES:
- Each bullet point should be a single concise sentence (no bullet character prefix)
- Description: 4-6 bullets about material, design, features, and appeal
- Sizing: 3-5 bullets about dimensions, fit, adjustability (estimate from image)
- Care: 3-4 bullets about washing, storage, and maintenance
- Tags: 5-8 relevant lowercase keywords for search/filtering
- Name: A creative, catchy product name (2-5 words)
- Be specific about what you see (colors, materials, patterns, closures)
- If you can't determine exact measurements, give reasonable estimates or say "One size fits most"

You MUST respond with ONLY valid JSON. No markdown fences, no explanation, no extra text.
The JSON must have this exact structure:
{"name":"Product Name","description":["bullet 1","bullet 2"],"sizing":["bullet 1"],"care":["bullet 1"],"tags":["tag1","tag2"]}`;

    // Build the user prompt
    let userPrompt =
      "Analyze this product image(s) and generate product listing content.";
    if (productName) {
      userPrompt += `\n\nThe product is called: "${productName}"`;
    }
    if (category) {
      userPrompt += `\nCategory: ${category}`;
    }

    const requestedSections = sections.join(", ");
    userPrompt += `\n\nPlease generate content for these sections: ${requestedSections}`;
    userPrompt += `\n\nReturn ONLY valid JSON. No markdown, no code blocks, just the JSON object.`;

    console.log(
      `[ai-product-fill] Analyzing ${cappedImages.length} image(s), sections: ${requestedSections}`
    );

    // Call OpenAI Vision API
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                ...cappedImages,
              ],
            },
          ],
          max_tokens: 1500,
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[ai-product-fill] OpenAI error:", response.status, errBody);
      return error(`OpenAI API error: ${response.status}`, 502);
    }

    const completion = await response.json();
    const rawContent =
      completion.choices?.[0]?.message?.content?.trim() || "";

    console.log(
      "[ai-product-fill] Raw response length:",
      rawContent.length
    );

    if (!rawContent) {
      return error("AI returned an empty response. Please try again.", 502);
    }

    // Parse the JSON response — strip markdown fences just in case
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
      console.error("[ai-product-fill] Failed to parse JSON:", snippet);
      return error(
        "AI returned invalid JSON. Please try again.",
        502
      );
    }

    const result = {
      success: true,
      data: {
        name: parsed.name || undefined,
        description: Array.isArray(parsed.description)
          ? parsed.description
          : [],
        sizing: Array.isArray(parsed.sizing) ? parsed.sizing : [],
        care: Array.isArray(parsed.care) ? parsed.care : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      },
    };

    console.log(
      `[ai-product-fill] Generated: ${result.data.description.length} desc, ` +
        `${result.data.sizing.length} sizing, ${result.data.care.length} care, ` +
        `${(result.data.tags || []).length} tags`
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-product-fill] Error:", msg);
    return error(msg || "Internal error", 500);
  }
});
