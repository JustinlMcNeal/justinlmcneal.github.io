// Import from 1688.com — Fetches product data, translates with GPT-4o,
// and returns structured product data ready for the admin product editor.
//
// POST body:
//   { url: string, markup_percent?: number }
//
// Returns:
//   { success: true, product: { name, price, ... }, raw: { ... } }

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

// ── 1688 Data Extraction ──────────────────────────────
// 1688 offers ID (offerId) lives in the URL path

function extractOfferId(url: string): string | null {
  // Patterns:
  // https://detail.1688.com/offer/XXXXXXXXXX.html
  // https://m.1688.com/offer/XXXXXXXXXX.html
  // https://offer.1688.com/offer/XXXXXXXXXX.html
  const m = url.match(/(\d{10,})/);
  return m ? m[1] : null;
}

interface Raw1688Data {
  title: string;
  price_range: string;
  images: string[];
  sku_props: Array<{
    prop_name: string;
    values: Array<{ name: string; image_url?: string }>;
  }>;
  detail_images: string[];
  min_order: number;
  unit: string;
  seller_name: string;
}

async function fetch1688Data(offerId: string): Promise<Raw1688Data> {
  // Try the mobile API endpoint first (returns JSON)
  const apiUrl = `https://m.1688.com/page/offerRemark.htm?offerId=${offerId}`;
  const detailUrl = `https://h5api.m.1688.com/h5/mtop.alibaba.1688.detail.getdetail/1.0/?offerId=${offerId}`;

  // Use the offer detail page HTML as a fallback – parse structured data from it
  const pageUrl = `https://detail.1688.com/offer/${offerId}.html`;

  // Try fetching the detail page for structured data
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };

  let title = "";
  let priceRange = "";
  let images: string[] = [];
  let skuProps: Raw1688Data["sku_props"] = [];
  let detailImages: string[] = [];
  let minOrder = 1;
  let unit = "件";
  let sellerName = "";

  try {
    // Try mobile offer detail endpoint
    const mobileUrl = `https://m.1688.com/offer/${offerId}.html`;
    const resp = await fetch(mobileUrl, { headers });
    const html = await resp.text();

    // Extract title
    const titleMatch = html.match(
      /<title[^>]*>([^<]+)<\/title>/i
    );
    if (titleMatch) {
      title = titleMatch[1]
        .replace(/-1688\.com$/, "")
        .replace(/-阿里巴巴$/, "")
        .trim();
    }

    // Extract images from various patterns
    const imgMatches = html.matchAll(
      /["'](https?:\/\/cbu\d*\.alicdn\.com\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/gi
    );
    const imgSet = new Set<string>();
    for (const m of imgMatches) {
      let url = m[1].split("?")[0]; // strip query params
      if (!url.includes("_")) {
        imgSet.add(url);
      } else {
        // Try to get original by stripping resize suffix
        const orig = url.replace(/_\d+x\d+\.\w+$/, "");
        imgSet.add(url);
      }
    }
    images = Array.from(imgSet).slice(0, 20);

    // Extract price
    const priceMatch = html.match(
      /(?:price|价格)[^"]*?(\d+\.?\d*)\s*[-–~]\s*(\d+\.?\d*)/i
    ) || html.match(
      /¥\s*(\d+\.?\d*)/
    );
    if (priceMatch) {
      priceRange = priceMatch[2]
        ? `¥${priceMatch[1]} - ¥${priceMatch[2]}`
        : `¥${priceMatch[1]}`;
    }

    // Extract SKU/color data from JSON embedded in page
    const skuDataMatch = html.match(
      /skuProps['":\s]*(\[[\s\S]*?\])\s*[,;}\]]/
    );
    if (skuDataMatch) {
      try {
        skuProps = JSON.parse(skuDataMatch[1]);
      } catch { /* ignore parse errors */ }
    }

    // Min order
    const moqMatch = html.match(/(\d+)\s*件起批/);
    if (moqMatch) minOrder = parseInt(moqMatch[1]);

  } catch (fetchErr) {
    console.warn("[1688] Mobile fetch failed, trying desktop:", fetchErr);
    
    // Fallback: try desktop page
    try {
      const resp = await fetch(pageUrl, { headers: { ...headers, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
      const html = await resp.text();

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].replace(/-1688\.com$/, "").replace(/-阿里巴巴$/, "").trim();

      const imgMatches = html.matchAll(
        /["'](https?:\/\/cbu\d*\.alicdn\.com\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/gi
      );
      const imgSet = new Set<string>();
      for (const m of imgMatches) {
        imgSet.add(m[1].split("?")[0]);
      }
      images = Array.from(imgSet).slice(0, 20);
    } catch (e2) {
      console.error("[1688] Desktop fetch also failed:", e2);
    }
  }

  return {
    title,
    price_range: priceRange,
    images,
    sku_props: skuProps,
    detail_images: detailImages,
    min_order: minOrder,
    unit,
    seller_name: sellerName,
  };
}

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
  raw: Raw1688Data,
  imageUrls: string[],
  categories: Array<{ id: string; name: string; slug: string }>,
  markupPercent: number
): Promise<any> {
  const categoryNames = categories.map((c) => c.name).join(", ");

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
- Extract color/variant names and translate them to English.
- Estimate weight in grams from the product type if not provided.
- The suggested price should be the Chinese wholesale price × ${markupPercent / 100} markup, converted from CNY to USD (use ~7.2 CNY per USD), rounded to .99 or .49.
- Sizing should include dimensions in inches/cm if detectable.
- Care instructions should be appropriate for the product type.

Respond ONLY with the JSON object, no markdown fences or explanation.`,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Chinese 1688 product listing:

Title: ${raw.title}
Price: ${raw.price_range}
Min Order: ${raw.min_order} ${raw.unit}
SKU Options: ${JSON.stringify(raw.sku_props || [])}

Please create the English product listing.`,
        },
        // Include up to 3 product images for visual analysis
        ...imageUrls.slice(0, 3).map((url) => ({
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
    const { url, markup_percent = 350 } = body; // Default 3.5x markup

    if (!url) {
      return error("URL is required", 400);
    }

    const offerId = extractOfferId(url);
    if (!offerId) {
      return error(
        "Could not extract offer ID from URL. Please use a direct 1688.com product link.",
        400
      );
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

    console.log(`[1688] Fetching offer ${offerId}...`);

    // Step 1: Fetch raw data from 1688
    const raw = await fetch1688Data(offerId);

    if (!raw.title && raw.images.length === 0) {
      return error(
        "Could not fetch product data from 1688. The page may be blocked or the URL may be invalid. Try pasting the product images and title manually.",
        422
      );
    }

    console.log(`[1688] Got: "${raw.title}" with ${raw.images.length} images`);

    // Step 2: Generate English listing with GPT-4o (with vision)
    const listing = await generateListing(
      openaiKey,
      raw,
      raw.images,
      categories || [],
      markup_percent
    );

    // Step 3: Match category
    const matchedCategory =
      detectCategory(
        `${raw.title} ${listing.category || ""}`,
        categories || []
      ) ||
      (categories || []).find(
        (c) => c.name.toLowerCase() === (listing.category || "").toLowerCase()
      );

    // Step 4: Build structured product data
    const slug = (listing.name || "product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const product = {
      name: listing.name || raw.title,
      slug,
      category_id: matchedCategory?.id || null,
      category_name: matchedCategory?.name || listing.category || "uncategorized",
      price: listing.suggested_price_usd || 9.99,
      weight_g: listing.weight_g || null,
      supplier_url: url,
      tags: listing.tags || [],
      description: listing.description || [],
      sizing: listing.sizing || [],
      care: listing.care || [],
      colors: listing.colors || [],
      images: raw.images.slice(0, 10), // Primary images
      detail_images: raw.detail_images.slice(0, 10),
    };

    // Return everything — the frontend will use this to populate the product editor
    return new Response(
      JSON.stringify({
        success: true,
        product,
        raw: {
          title: raw.title,
          price_range: raw.price_range,
          images: raw.images,
          sku_props: raw.sku_props,
          min_order: raw.min_order,
          offer_id: offerId,
          seller_name: raw.seller_name,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[1688] Error:", err);
    return error(err.message || "Internal error", 500);
  }
});

function error(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
