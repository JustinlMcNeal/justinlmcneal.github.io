// Import from 1688.com — Accepts product title + image URLs from the client,
// translates with GPT-4o vision, and returns structured product data.
//
// POST body:
//   { title: string, images: string[], price_cny?: number, markup_percent?: number }
//
// Returns:
//   { success: true, product: { name, price, ... } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Category keywords for auto-detection ─────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  headwear: [
    "hat", "cap", "beanie", "beret", "headband", "帽", "贝雷帽",
    "棒球帽", "渔夫帽", "毛线帽", "针织帽", "鸭舌帽", "遮阳帽",
  ],
  jewelry: [
    "necklace", "bracelet", "ring", "earring", "pendant", "chain",
    "项链", "手链", "戒指", "耳环", "吊坠", "珠宝", "首饰",
    "耳钉", "手镯", "饰品",
  ],
  bags: [
    "bag", "purse", "tote", "backpack", "crossbody", "clutch",
    "包", "手提包", "斜挎包", "双肩包", "托特包", "钱包",
    "单肩包", "mini包", "腋下包",
  ],
  accessories: [
    "keychain", "charm", "scrunchie", "hair", "phone case", "fidget",
    "钥匙扣", "挂件", "发圈", "手机壳", "发夹", "小挂饰",
    "配饰", "饰物", "发饰",
  ],
  plushies: [
    "plush", "stuffed", "toy", "doll", "figure",
    "毛绒", "玩偶", "公仔", "玩具", "布偶",
  ],
  lego: [
    "lego", "building block", "brick", "积木", "拼装",
  ],
};

// ── Auto-detect category from text ─────────────────────
function detectCategory(
  text: string,
  categories: Array<{ id: string; name: string; slug: string }>
): { id: string; name: string } | null {
  const lower = text.toLowerCase();
  for (const cat of categories) {
    const keywords = CATEGORY_KEYWORDS[cat.slug] || [];
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { id: cat.id, name: cat.name };
      }
    }
  }
  return null;
}

// ── Generate English listing with GPT-4o ──────────────
async function generateListing(
  apiKey: string,
  title: string,
  priceCny: number | null,
  imageUrls: string[],
  categories: Array<{ id: string; name: string; slug: string }>,
  markupPercent: number
): Promise<any> {
  const categoryNames = categories.map((c) => c.name).join(", ");
  const priceContext = priceCny
    ? `The wholesale price is approximately ¥${priceCny} CNY.`
    : "No price was provided — estimate a reasonable retail price for this type of product.";

  const messages = [
    {
      role: "system",
      content: `You are a product listing expert for "Karry Kraze", an online accessories & lifestyle boutique targeting Gen-Z and young women (ages 16-28). Your job is to take a Chinese 1688.com product listing and create a polished English product listing ready for the store.

The store has these categories: ${categoryNames}

Your output must be VALID JSON with this exact structure:
{
  "name": "Creative, catchy English product name (2-5 words, branded style)",
  "category": "one of: ${categoryNames}",
  "tags": ["tag1", "tag2", "tag3"],
  "description": ["bullet 1", "bullet 2", "bullet 3", "bullet 4"],
  "sizing": ["sizing detail 1", "sizing detail 2"],
  "care": ["care instruction 1", "care instruction 2"],
  "colors": ["Color 1", "Color 2"],
  "weight_g": 100,
  "suggested_price_usd": 14.99
}

Rules:
- Name should be catchy, brandable, and appealing to young women. NOT a literal translation.
- Description bullets should be persuasive marketing copy, not technical specs.
- Include 3-6 relevant tags (lowercase, no spaces in individual tags).
- Detect the best matching category from the store's categories.
- Extract color/variant names from the images or title and translate them to English.
- Estimate weight in grams from the product type.
- ${priceCny ? `The suggested price should be the Chinese wholesale price × ${markupPercent / 100} markup, converted from CNY to USD (use ~7.2 CNY per USD), rounded to .99 or .49.` : "Suggest a reasonable retail price in USD, rounded to .99 or .49."}
- Sizing should include dimensions in inches/cm if detectable from images.
- Care instructions should be appropriate for the product type.
- Use the product images to determine colors, materials, and product details.

Respond ONLY with the JSON object, no markdown fences or explanation.`,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Chinese 1688 product listing:

Title: ${title}
${priceContext}

Please analyze the images and create the English product listing.`,
        },
        // Include up to 4 product images for visual analysis
        ...imageUrls.slice(0, 4).map((url) => ({
          type: "image_url" as const,
          image_url: { url, detail: "low" as const },
        })),
      ],
    },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1000,
      temperature: 0.7,
      messages,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("[1688] OpenAI error:", resp.status, errBody);
    throw new Error(`OpenAI API error (${resp.status})`);
  }

  const result = await resp.json();
  const content = result.choices?.[0]?.message?.content || "";

  try {
    const cleaned = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("[1688] Failed to parse GPT response:", content);
    throw new Error("Failed to parse AI-generated listing");
  }
}

// ═══════════════════════ MAIN HANDLER ═══════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      title = "",
      images = [],
      price_cny = null,
      url = "",
      markup_percent = 350,
    } = body;

    // Must have title or images
    if (!title && images.length === 0) {
      return error("Please provide a product title and/or image URLs.", 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!openaiKey) {
      return error("OPENAI_API_KEY not configured", 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch categories for matching
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, slug");

    console.log(`[1688] Generating listing for: "${title}" with ${images.length} images`);

    // Generate English listing with GPT-4o (with vision)
    const listing = await generateListing(
      openaiKey,
      title,
      price_cny ? Number(price_cny) : null,
      images,
      categories || [],
      markup_percent
    );

    // Match category
    const matchedCategory =
      detectCategory(
        `${title} ${listing.category || ""}`,
        categories || []
      ) ||
      (categories || []).find(
        (c: any) => c.name.toLowerCase() === (listing.category || "").toLowerCase()
      );

    // Build structured product data
    const slug = (listing.name || "product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const product = {
      name: listing.name || title,
      slug,
      category_id: matchedCategory?.id || null,
      category_name: matchedCategory?.name || listing.category || "uncategorized",
      price: listing.suggested_price_usd || 9.99,
      weight_g: listing.weight_g || null,
      supplier_url: url || null,
      tags: listing.tags || [],
      description: listing.description || [],
      sizing: listing.sizing || [],
      care: listing.care || [],
      colors: listing.colors || [],
      images: images.slice(0, 10),
    };

    return new Response(
      JSON.stringify({
        success: true,
        product,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[1688] Error:", msg);
    return error(msg || "Internal error", 500);
  }
});

function error(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
