// supabase/functions/ai-product-fill/index.ts
// AI-powered product description generator using GPT-4o vision
// Analyzes product images and returns description, sizing, and care bullet points

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ProductFillRequest {
  /** Base64-encoded images (data URIs or raw base64) */
  images: string[];
  /** Optional: image URLs to analyze instead of base64 */
  imageUrls?: string[];
  /** Optional: product name if already known */
  productName?: string;
  /** Optional: product category if already known */
  category?: string;
  /** Which sections to generate */
  sections?: ("description" | "sizing" | "care" | "tags" | "name")[];
}

interface ProductFillResponse {
  success: boolean;
  data?: {
    name?: string;
    description: string[];
    sizing: string[];
    care: string[];
    tags?: string[];
  };
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const body: ProductFillRequest = await req.json();
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
        image_url: { url: dataUri, detail: "high" },
      });
    }

    // Add URL-based images
    for (const url of imageUrls) {
      if (url) {
        imageContent.push({
          type: "image_url",
          image_url: { url, detail: "high" },
        });
      }
    }

    if (imageContent.length === 0) {
      throw new Error(
        "At least one image (base64 or URL) is required for AI analysis"
      );
    }

    // Build the system prompt
    const systemPrompt = `You are an expert e-commerce product copywriter for "Kool Kreations" (KK), a trendy online store selling fashion accessories, bags, headwear, jewelry, plushies, and collectibles.

Your task is to analyze product images and generate structured product information. Write engaging, concise bullet points that highlight key features and appeal to young, fashion-forward customers.

IMPORTANT RULES:
- Each bullet point should be a single concise sentence (no bullet character prefix)
- Description: 4-6 bullets about material, design, features, and appeal
- Sizing: 3-5 bullets about dimensions, fit, adjustability (estimate from image)
- Care: 3-4 bullets about washing, storage, and maintenance
- Tags: 5-8 relevant keywords for search/filtering
- Be specific about what you see (colors, materials, patterns, closures)
- If you can't determine exact measurements, give reasonable estimates or say "One size fits most"

Respond ONLY with valid JSON in this exact format:
{
  "name": "Product Name Here",
  "description": ["bullet 1", "bullet 2", ...],
  "sizing": ["bullet 1", "bullet 2", ...],
  "care": ["bullet 1", "bullet 2", ...],
  "tags": ["tag1", "tag2", ...]
}`;

    // Build the user prompt
    let userPrompt = "Analyze this product image(s) and generate product listing content.";
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
      `[ai-product-fill] Analyzing ${imageContent.length} image(s), sections: ${requestedSections}`
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
                ...imageContent,
              ],
            },
          ],
          max_tokens: 1500,
          temperature: 0.7,
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[ai-product-fill] OpenAI error:", errBody);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const completion = await response.json();
    const rawContent =
      completion.choices?.[0]?.message?.content?.trim() || "";

    console.log("[ai-product-fill] Raw response length:", rawContent.length);

    // Parse the JSON response (strip markdown code blocks if present)
    let cleaned = rawContent;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error(
        "[ai-product-fill] Failed to parse JSON:",
        cleaned.substring(0, 500)
      );
      throw new Error("AI returned invalid JSON. Please try again.");
    }

    // Validate and normalize the response
    const result: ProductFillResponse = {
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
      `[ai-product-fill] Generated: ${result.data!.description.length} desc, ${result.data!.sizing.length} sizing, ${result.data!.care.length} care, ${(result.data!.tags || []).length} tags`
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-product-fill] Error:", msg);
    return new Response(
      JSON.stringify({
        success: false,
        error: msg || "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
