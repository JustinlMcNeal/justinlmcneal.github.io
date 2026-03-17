// Generate Social-Ready Product Images — Image-to-Image Pipeline
// Uses gpt-image-1 /images/edits to restyle the ACTUAL product photo
// into beautiful social-media-ready lifestyle shots.
// Falls back to DALL-E 3 text-to-image only when no catalog photo exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ══════════════════ SCENE RANDOMIZER — Infinite Variety ══════════════════
// Every generation assembles a unique prompt from randomized pools of
// environments, lighting, moods, compositions, props, and camera angles.
// 49 products × infinite scene combos = never-ending unique content.

// ── Building blocks ──
const ENVIRONMENTS = [
  "a cozy coffee shop table with warm ambient lighting",
  "a sunlit marble bathroom vanity",
  "a rustic wooden desk near a window with golden hour light streaming in",
  "a trendy outdoor café table in a European street",
  "a lush botanical garden with green foliage backdrop",
  "a modern minimalist apartment with white walls and soft shadows",
  "a beach towel on sand with turquoise ocean in the background",
  "a luxurious velvet jewelry display in a boutique",
  "a cozy bed with rumpled linen sheets and morning light",
  "a park bench surrounded by autumn leaves",
  "a sleek kitchen countertop with fresh flowers nearby",
  "a stylish car dashboard with city skyline visible through the windshield",
  "a vintage dresser top with a small mirror and perfume bottles",
  "a hammock in a tropical setting with palm shadows",
  "a rainy-day windowsill with droplets on the glass and soft gray light",
  "a rooftop terrace at sunset with city lights in the background",
  "a bookshelf nook with stacked books and warm lamp light",
  "a picnic blanket in a wildflower meadow",
  "a gym bag on a polished locker room bench",
  "a Christmas tree with twinkling fairy lights and wrapped gifts",
  "a poolside lounge chair with a cold drink and sunglasses",
  "a music festival setting with colorful wristbands and sunshine",
  "a pastel-colored ice cream parlor table",
  "a campfire setting at dusk with marshmallows and blankets",
  "a chic nail salon table with manicure tools and roses",
  "a neon-lit nighttime city street with reflections on wet pavement",
  "a warm fireplace mantle with candles and greenery",
  "a yoga mat in a bright sunlit studio",
  "a leather journal and pen on a library reading table",
  "a colorful street market stall with fabrics and spices",
];

const LIGHTING = [
  "soft natural window light with gentle shadows",
  "warm golden hour glow",
  "dramatic moody side-lighting",
  "bright and airy overhead daylight",
  "cozy candlelit warmth",
  "neon accent lighting with cool tones",
  "misty morning diffused light",
  "sunset backlighting with a warm halo",
  "studio ring-light with even illumination",
  "dappled sunlight through tree leaves",
  "overcast soft-box-style even light",
  "fairy lights / string lights creating bokeh",
  "blue hour twilight with cool ambient tones",
  "harsh midday sun with strong shadows (editorial style)",
  "firelight flicker with orange warmth",
];

const COMPOSITIONS = [
  "centered hero shot — product dominates the frame",
  "rule-of-thirds placement with negative space for text overlay",
  "slightly off-center with a leading line drawing the eye to the product",
  "close-up macro detail shot filling 80% of the frame",
  "environmental wide shot showing the product in context at medium distance",
  "overhead flat-lay view from directly above",
  "45-degree angle tabletop view",
  "low-angle looking up at the product",
  "shallow depth of field with product sharp and background beautifully blurred",
  "reflected in a mirror or glass surface for a double-image effect",
  "product peeking out of a bag/pocket in a lifestyle moment",
  "held in a hand/between fingers",
];

const MOODS = [
  "warm, cozy, and inviting — autumn vibes",
  "bright, energetic, and playful — summer fun",
  "dark, moody, and luxurious — premium editorial",
  "soft, dreamy, and romantic — pastel tones",
  "fresh, clean, and minimal — Scandinavian aesthetic",
  "bold, vibrant, and colorful — maximalist pop",
  "earthy, natural, and organic — sustainable living",
  "retro/vintage film look — grainy with muted warm tones",
  "futuristic and sleek — cool metallics and gradients",
  "tropical and lush — saturated greens and warm tones",
  "whimsical and magical — fairy-tale fantasy vibes",
  "urban and street-style — concrete, graffiti, attitude",
  "cottagecore — soft florals, countryside charm",
  "Y2K aesthetic — glossy, pink/chrome, playful",
];

const PROPS = [
  "a cup of latte with latte art",
  "fresh peonies or roses",
  "scattered gold confetti",
  "a pair of stylish sunglasses",
  "a small succulent plant",
  "a silk ribbon or scarf draped nearby",
  "seashells and sand",
  "autumn leaves in warm colors",
  "fairy lights or string lights",
  "a leather-bound notebook",
  "macarons in pastel colors",
  "a vintage Polaroid camera",
  "crystals and gemstones",
  "a small mirror reflecting light",
  "dried lavender or eucalyptus sprigs",
  "colorful washi tape rolls",
  "sparklers or candles",
  "a fuzzy knit blanket",
  "headphones or earbuds",
  "fruit slices (citrus, strawberries)",
  "a velvet jewelry box",
  "scattered rose petals",
  "a cute sticker or enamel pin",
  "nothing — clean and minimal, product only",
  "nothing — clean and minimal, product only",
];

const CAMERA_STYLES = [
  "shot on iPhone — natural, authentic, slightly casual",
  "professional DSLR product photography — crisp and commercial",
  "film camera aesthetic — Kodak Portra 400, warm grain",
  "mirrorless camera with 85mm portrait lens — creamy bokeh",
  "macro lens detail photography — every texture visible",
  "drone/aerial perspective looking straight down",
  "Polaroid/instant camera aesthetic — white border, nostalgic",
  "magazine editorial photography — high-fashion, styled",
  "TikTok/Reels thumbnail style — eye-catching and trendy",
  "Pinterest flat-lay aesthetic — perfectly curated overhead shot",
];

// ═══════════════════ SEASONAL AWARENESS ═══════════════════
// Adds season-specific environments, moods, and props that get
// mixed into the pool based on the current month.
const SEASONAL_EXTRAS: Record<string, { envs: string[]; moods: string[]; props: string[] }> = {
  spring: {
    envs: [
      "a cherry blossom tree-lined path with pink petals falling",
      "a flower market stall with tulips and daffodils",
      "a garden patio table with fresh lemonade and blooming wisteria",
      "a sunlit greenhouse with potted plants and morning dew",
    ],
    moods: [
      "fresh spring awakening — light pastels, new growth, optimistic",
      "cherry blossom season — soft pink, gentle, romantic",
      "Easter/springtime — pastel colors, eggs, bunny motifs",
    ],
    props: [
      "fresh tulips or cherry blossoms",
      "a straw hat and sunflowers",
      "a glass of fresh lemonade",
      "pastel-colored Easter eggs",
    ],
  },
  summer: {
    envs: [
      "a beach with crystal clear turquoise water and white sand",
      "a rooftop pool party with city views at sunset",
      "an outdoor summer concert with golden hour lighting",
      "a tropical smoothie bar with palm trees and fairy lights",
      "a boardwalk pier with cotton candy and ocean breeze",
    ],
    moods: [
      "hot girl summer — bold, confident, sun-kissed",
      "beach vacation vibes — salty, golden, carefree",
      "festival season — neon, fun, high energy",
    ],
    props: [
      "a coconut drink with a paper umbrella",
      "a beach towel and flip flops",
      "a watermelon slice",
      "colorful popsicles",
      "a pool float in the background",
    ],
  },
  fall: {
    envs: [
      "a pumpkin patch with golden afternoon light",
      "a cozy cabin porch with falling leaves and a warm drink",
      "a tree-lined autumn path with red, orange, and gold foliage",
      "a harvest festival table with gourds and cinnamon sticks",
      "a foggy morning forest trail with crunchy leaves underfoot",
    ],
    moods: [
      "cozy autumn — warm tones, flannel, comfort",
      "spooky season — Halloween, moody, mysterious",
      "harvest/Thanksgiving — rich, grateful, abundant",
    ],
    props: [
      "a pumpkin spice latte",
      "mini pumpkins and gourds",
      "cinnamon sticks and dried oranges",
      "a chunky knit scarf",
      "fall maple leaves in warm colors",
    ],
  },
  winter: {
    envs: [
      "a snow-dusted windowsill with a cozy scene inside",
      "beside a roaring fireplace with stockings and garland",
      "a Christmas market stall with twinkling lights and pine garland",
      "a winter wonderland with fresh snowfall and evergreen trees",
      "a cozy ski lodge table with hot cocoa and frost on the windows",
    ],
    moods: [
      "holiday magic — twinkling lights, candy canes, gift-giving",
      "cozy winter — snow, fireplace, chunky knits, hot chocolate",
      "New Year's glam — sparkle, champagne, metallics, celebration",
    ],
    props: [
      "a mug of hot cocoa with marshmallows",
      "wrapped gifts with ribbon",
      "pine cones and evergreen sprigs",
      "fairy lights and tinsel",
      "snowflake ornaments",
    ],
  },
};

function getCurrentSeason(): string {
  const month = new Date().getMonth(); // 0-11
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

// ── Pick random item from array ──
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Weighted pick: 60% chance of seasonal items, 40% base pool ──
function pickSeasonal(basePool: string[], seasonalPool: string[]): string {
  if (seasonalPool.length && Math.random() < 0.6) {
    return pick(seasonalPool);
  }
  return pick(basePool);
}

// ══════════ SMART SCHEDULING — Scene Deduplication ══════════
// Tracks recently used scene elements for each product so
// consecutive images are always visually distinct.
interface SceneFingerprint {
  env: string;
  mood: string;
  camera: string;
}

async function getRecentScenes(
  supabase: any,
  productId: string,
  limit = 5
): Promise<SceneFingerprint[]> {
  try {
    const { data } = await supabase
      .from("social_generated_images")
      .select("metadata")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data || []).map((r: any) => ({
      env: r.metadata?.scene_env || "",
      mood: r.metadata?.scene_mood || "",
      camera: r.metadata?.scene_camera || "",
    }));
  } catch {
    return [];
  }
}

function pickAvoiding<T extends string>(pool: T[], avoid: string[]): T {
  // Try to find one not in the avoid list
  const fresh = pool.filter((x) => !avoid.includes(x));
  if (fresh.length) return pick(fresh);
  return pick(pool); // if everything is used, just pick random
}

// ── Build a unique scene prompt — seasonal + deduplicated ──
function buildRandomScenePrompt(
  productName: string,
  categoryCtx: string,
  recentScenes: SceneFingerprint[] = []
): { prompt: string; fingerprint: SceneFingerprint } {
  const season = getCurrentSeason();
  const seasonal = SEASONAL_EXTRAS[season];

  const recentEnvs = recentScenes.map((s) => s.env);
  const recentMoods = recentScenes.map((s) => s.mood);
  const recentCameras = recentScenes.map((s) => s.camera);

  const env = pickAvoiding(
    [...ENVIRONMENTS, ...(seasonal?.envs || [])],
    recentEnvs
  );
  const light = pick(LIGHTING);
  const comp = pick(COMPOSITIONS);
  const mood = pickAvoiding(
    [...MOODS, ...(seasonal?.moods || [])],
    recentMoods
  );
  const prop = pickSeasonal(PROPS, seasonal?.props || []);
  const camera = pickAvoiding(CAMERA_STYLES, recentCameras);

  const prompt = `Transform this product photo into a stunning social-media-ready image.

SCENE: ${env}
LIGHTING: ${light}
COMPOSITION: ${comp}
MOOD/AESTHETIC: ${mood}
NEARBY PROPS: ${prop}
CAMERA STYLE: ${camera}

CRITICAL RULES:
- Keep the product EXACTLY as it appears in the reference photo — same colors, shape, materials, patterns, textures, and every small detail. Do NOT redesign, reimagine, simplify, or alter the product in ANY way.
- Only change the background, setting, lighting, and surrounding environment.
- The product ("${productName}" — ${categoryCtx}) must be the clear hero and focal point.
- Make it look premium, aspirational, and scroll-stopping for Instagram/TikTok.
- No text, watermarks, logos, or brand names on the image.
- Photorealistic quality.`;

  return { prompt, fingerprint: { env, mood, camera } };
}

// ── For text-to-image fallback (no reference photo) ──
function buildRandomScenePromptText(
  productName: string,
  categoryCtx: string,
  recentScenes: SceneFingerprint[] = []
): { prompt: string; fingerprint: SceneFingerprint } {
  const season = getCurrentSeason();
  const seasonal = SEASONAL_EXTRAS[season];

  const recentEnvs = recentScenes.map((s) => s.env);
  const recentMoods = recentScenes.map((s) => s.mood);
  const recentCameras = recentScenes.map((s) => s.camera);

  const env = pickAvoiding(
    [...ENVIRONMENTS, ...(seasonal?.envs || [])],
    recentEnvs
  );
  const light = pick(LIGHTING);
  const comp = pick(COMPOSITIONS);
  const mood = pickAvoiding(
    [...MOODS, ...(seasonal?.moods || [])],
    recentMoods
  );
  const prop = pickSeasonal(PROPS, seasonal?.props || []);
  const camera = pickAvoiding(CAMERA_STYLES, recentCameras);

  const prompt = `Create a stunning product photo of "${productName}" (${categoryCtx}).

SCENE: ${env}
LIGHTING: ${light}
COMPOSITION: ${comp}
MOOD/AESTHETIC: ${mood}
NEARBY PROPS: ${prop}
CAMERA STYLE: ${camera}

Make the product the clear hero/focal point. Premium, aspirational, scroll-stopping for Instagram/TikTok. Photorealistic. No text, watermarks, or logos.`;

  return { prompt, fingerprint: { env, mood, camera } };
}

// ═══════════ CAROUSEL SLIDE PROMPT BUILDERS ═══════════
// For carousel sets, the camera style stays CONSISTENT across all slides
// for visual coherence, but environment, mood, and props change to make
// each slide worth swiping to. Compositions are chosen to create a
// narrative flow across slides (wide → mid → close-up → detail).

const CAROUSEL_COMPOSITION_FLOW = [
  "environmental wide shot showing the product in context at medium distance",
  "centered hero shot — product dominates the frame",
  "45-degree angle tabletop view",
  "close-up macro detail shot filling 80% of the frame",
  "held in a hand/between fingers",
];

function buildCarouselSlidePrompt(
  productName: string,
  categoryCtx: string,
  recentScenes: SceneFingerprint[],
  lockedCamera: string,
  slideIndex: number,
  totalSlides: number
): { prompt: string; fingerprint: SceneFingerprint } {
  const season = getCurrentSeason();
  const seasonal = SEASONAL_EXTRAS[season];

  const recentEnvs = recentScenes.map((s) => s.env);
  const recentMoods = recentScenes.map((s) => s.mood);

  const env = pickAvoiding(
    [...ENVIRONMENTS, ...(seasonal?.envs || [])],
    recentEnvs
  );
  const light = pick(LIGHTING);
  // Composition follows a narrative flow for carousels
  const comp = CAROUSEL_COMPOSITION_FLOW[slideIndex % CAROUSEL_COMPOSITION_FLOW.length];
  const mood = pickAvoiding(
    [...MOODS, ...(seasonal?.moods || [])],
    recentMoods
  );
  const prop = pickSeasonal(PROPS, seasonal?.props || []);

  const prompt = `Transform this product photo into a stunning social-media-ready image.
This is SLIDE ${slideIndex + 1} of ${totalSlides} in an Instagram carousel.

SCENE: ${env}
LIGHTING: ${light}
COMPOSITION: ${comp}
MOOD/AESTHETIC: ${mood}
NEARBY PROPS: ${prop}
CAMERA STYLE: ${lockedCamera}

CRITICAL RULES:
- Keep the product EXACTLY as it appears in the reference photo — same colors, shape, materials, patterns, textures, and every small detail. Do NOT redesign, reimagine, simplify, or alter the product in ANY way.
- Only change the background, setting, lighting, and surrounding environment.
- The product ("${productName}" — ${categoryCtx}) must be the clear hero and focal point.
- Make it look premium, aspirational, and scroll-stopping for Instagram/TikTok.
- No text, watermarks, logos, or brand names on the image.
- Photorealistic quality.`;

  return { prompt, fingerprint: { env, mood, camera: lockedCamera } };
}

function buildCarouselSlidePromptText(
  productName: string,
  categoryCtx: string,
  recentScenes: SceneFingerprint[],
  lockedCamera: string,
  slideIndex: number,
  totalSlides: number
): { prompt: string; fingerprint: SceneFingerprint } {
  const season = getCurrentSeason();
  const seasonal = SEASONAL_EXTRAS[season];

  const recentEnvs = recentScenes.map((s) => s.env);
  const recentMoods = recentScenes.map((s) => s.mood);

  const env = pickAvoiding(
    [...ENVIRONMENTS, ...(seasonal?.envs || [])],
    recentEnvs
  );
  const light = pick(LIGHTING);
  const comp = CAROUSEL_COMPOSITION_FLOW[slideIndex % CAROUSEL_COMPOSITION_FLOW.length];
  const mood = pickAvoiding(
    [...MOODS, ...(seasonal?.moods || [])],
    recentMoods
  );
  const prop = pickSeasonal(PROPS, seasonal?.props || []);

  const prompt = `Create a stunning product photo of "${productName}" (${categoryCtx}).
This is slide ${slideIndex + 1} of ${totalSlides} in an Instagram carousel.

SCENE: ${env}
LIGHTING: ${light}
COMPOSITION: ${comp}
MOOD/AESTHETIC: ${mood}
NEARBY PROPS: ${prop}
CAMERA STYLE: ${lockedCamera}

Make the product the clear hero/focal point. Premium, aspirational, scroll-stopping for Instagram/TikTok. Photorealistic. No text, watermarks, or logos.`;

  return { prompt, fingerprint: { env, mood, camera: lockedCamera } };
}

// ───── category context: tells the AI how each product type is USED ─────
const CATEGORY_CONTEXT: Record<string, string> = {
  accessories:
    "a fashion accessory (could be a keychain, charm, bracelet, fidget, scrunchie, or similar). If it's a keychain, show it attached to a bag, backpack strap, or held in someone's hand. If it's a bracelet or charm, show it being worn on a wrist or clipped to something",
  headwear:
    "a hat or beanie meant to be worn on the head. Show it being worn by a person or styled on a shelf/hook as if about to be worn. Beanies look great in cozy/outdoor winter settings",
  bags:
    "a bag, purse, tote, or crossbody. Show it being carried by a person, slung over a shoulder, or placed on a chair/table as a styled accessory. It should look like something someone would take out and about",
  jewelry:
    "a jewelry piece (necklace, bracelet, pendant, chain). Show it being worn on a person — around the neck, on a wrist, or displayed on a jewelry stand/dish. Reflective surfaces and soft lighting work great",
  plushies:
    "a plush toy / stuffed figure. Show it being held, sitting on a desk, tucked in a bed, or displayed on a shelf. Make it look cute, giftable, and collectible",
  lego:
    "a LEGO or building block set/figure. Show it on a desk, shelf, or in a creative workspace. Make it look fun, collectible, and display-worthy",
  default:
    "a fashion/lifestyle product. Show it being used or worn naturally in a lifestyle context",
};

// ───────────────────── cost tracking (cents) ─────────────────────
const COST_MAP: Record<string, Record<string, number>> = {
  "dall-e-3": {
    "standard-1024x1024": 4,
    "standard-1024x1792": 8,
    "standard-1792x1024": 8,
    "hd-1024x1024": 8,
    "hd-1024x1792": 12,
    "hd-1792x1024": 12,
  },
  "gpt-image-1": {
    "standard-1024x1024": 4,
    "standard-1536x1024": 8,
    "standard-1024x1536": 8,
    "medium-1024x1024": 5,
    "medium-1536x1024": 10,
    "medium-1024x1536": 10,
    "high-1024x1024": 8,
    "high-1536x1024": 16,
    "high-1024x1536": 16,
  },
};

function getCostCents(
  model: string,
  quality: string,
  size: string
): number {
  const key = `${quality}-${size}`;
  return COST_MAP[model]?.[key] ?? 8; // default 8 cents if unknown
}

// ═══════════════════════ MAIN HANDLER ═══════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      product_id,
      style,        // optional: lifestyle | flat_lay | close_up | on_model | seasonal
      model,        // optional: dall-e-3 | gpt-image-1
      quality,      // optional: standard | hd
      size,         // optional: 1024x1024 | 1024x1792
      count = 1,    // how many images to generate (max 4)
      batch = false, // if true, generate for multiple products (body.product_ids)
      product_ids,  // array of product IDs for batch mode
      carousel = false, // if true, generate a carousel set (3-5 images with shared set ID)
    } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";

    if (!openaiKey) {
      return error("OPENAI_API_KEY not configured", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Load pipeline settings ──
    const { data: settingsRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "image_pipeline")
      .single();

    const settings = settingsRow?.setting_value || {};
    const useQuality = quality || settings.quality || "high";
    const useSize = size || settings.size || "1024x1024";
    const maxPerDay = settings.max_generations_per_day || 50;
    const requireReview = settings.require_review !== false; // default true

    // ── Check daily generation limit ──
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from("social_generated_images")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString());

    if ((todayCount || 0) >= maxPerDay) {
      return error(
        `Daily generation limit reached (${maxPerDay}). Try again tomorrow.`,
        429
      );
    }

    // ── Determine products to process ──
    const ids = batch && product_ids?.length ? product_ids : product_id ? [product_id] : [];

    if (!ids.length) {
      return error("product_id or product_ids[] required", 400);
    }

    // Fetch product details
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, name, slug, category_id, catalog_image_url, price, category:categories(name)")
      .in("id", ids);

    if (prodErr || !products?.length) {
      return error("Products not found", 404);
    }

    // ── Generate images ──
    const results: any[] = [];
    const imageCount = carousel ? Math.max(3, Math.min(count, 5)) : Math.min(count, 4);

    // For carousel mode, each product gets a shared set ID
    const carouselSetId = carousel ? crypto.randomUUID() : null;

    for (const product of products) {
      const categoryName =
        (product as any).category?.name?.toLowerCase() || "default";
      const categoryCtx =
        CATEGORY_CONTEXT[categoryName] || CATEGORY_CONTEXT.default;

      // Decide generation mode: image-to-image (preferred) or text-to-image (fallback)
      const hasPhoto = !!product.catalog_image_url;
      const genMode = hasPhoto ? "img2img" : "txt2img";
      const useModel = hasPhoto
        ? "gpt-image-1"                       // img2img always uses gpt-image-1
        : model || settings.model || "dall-e-3"; // txt2img uses configured model

      console.log(`[generate-social-image] Mode: ${genMode} | Model: ${useModel} | Product: "${product.name}"`);

      // Download product photo for image-to-image
      let productImageBlob: Blob | null = null;
      if (hasPhoto) {
        try {
          const imgResp = await fetch(product.catalog_image_url);
          if (imgResp.ok) {
            productImageBlob = await imgResp.blob();
            console.log(`[generate-social-image] Downloaded product photo: ${(productImageBlob.size / 1024).toFixed(0)}KB`);
          }
        } catch (dlErr) {
          console.warn(`[generate-social-image] Failed to download product photo, falling back to text:`, dlErr);
        }
      }

      // ── Smart scheduling: fetch recent scenes for this product ──
      const recentScenes = await getRecentScenes(supabase, product.id, 5);
      console.log(`[generate-social-image] Found ${recentScenes.length} recent scenes for deduplication`);

      const currentStyle = carousel ? "carousel" : (style || "random");

      // For carousels, lock camera style for visual coherence across slides
      const carouselCamera = carousel ? pick(CAMERA_STYLES) : null;

      for (let i = 0; i < imageCount; i++) {
        let genResult: GenResult;
        let sceneFingerprint: SceneFingerprint;

        if (productImageBlob) {
          // ═══ IMAGE-TO-IMAGE: Send actual product photo ═══
          const { prompt: fullPrompt, fingerprint } = carousel
            ? buildCarouselSlidePrompt(product.name, categoryCtx, recentScenes, carouselCamera!, i, imageCount)
            : buildRandomScenePrompt(product.name, categoryCtx, recentScenes);
          sceneFingerprint = fingerprint;

          console.log(`[generate-social-image] img2img scene ${i + 1}: env="${fingerprint.env.substring(0, 40)}..." mood="${fingerprint.mood.substring(0, 30)}..."`);
          genResult = await generateImageFromReference(openaiKey, {
            imageBlob: productImageBlob,
            prompt: fullPrompt,
            size: useSize,
          });
        } else {
          // ═══ TEXT-TO-IMAGE FALLBACK: No product photo available ═══
          const { prompt: fullPrompt, fingerprint } = carousel
            ? buildCarouselSlidePromptText(product.name, categoryCtx, recentScenes, carouselCamera || pick(CAMERA_STYLES), i, imageCount)
            : buildRandomScenePromptText(product.name, categoryCtx, recentScenes);
          sceneFingerprint = fingerprint;

          console.log(`[generate-social-image] txt2img scene ${i + 1}: env="${fingerprint.env.substring(0, 40)}..."`);
          genResult = await generateImageFromText(openaiKey, {
            model: useModel,
            prompt: fullPrompt,
            quality: useQuality,
            size: useSize,
          });
        }

        try {
          if (!genResult.success) {
            results.push({
              product_id: product.id,
              product_name: product.name,
              style: currentStyle,
              mode: genMode,
              success: false,
              error: genResult.error,
            });
            continue;
          }

          // ── Upload to Supabase Storage ──
          const timestamp = Date.now();
          const rnd = Math.random().toString(36).substring(2, 8);
          const storagePath = `ai-generated/${product.slug}/${timestamp}_${rnd}.png`;

          // genResult.imageData is already a Uint8Array (from either mode)
          const imageBytes = genResult.imageData!;

          const { error: uploadErr } = await supabase.storage
            .from("social-media")
            .upload(storagePath, imageBytes, {
              contentType: "image/png",
              upsert: false,
            });

          if (uploadErr) {
            console.error("Upload error:", uploadErr);
            results.push({
              product_id: product.id,
              product_name: product.name,
              style: currentStyle,
              success: false,
              error: `Upload failed: ${uploadErr.message}`,
            });
            continue;
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from("social-media")
            .getPublicUrl(storagePath);

          const publicUrl = urlData.publicUrl;
          const costCents = getCostCents(useModel, useQuality, useSize);
          const usedPrompt = genResult.prompt || "(image-to-image)";

          // ── Quality scoring via GPT-4o Vision ──
          let qualityScore = 0;
          let qualityVerdict = "pending";
          let qualityFeedback = "";
          try {
            const qr = await scoreGeneratedImage(openaiKey, publicUrl, product.catalog_image_url, product.name);
            qualityScore = qr.score;
            qualityVerdict = qr.verdict;
            qualityFeedback = qr.feedback;
            console.log(`[generate-social-image] Quality: ${qr.score}/10 → ${qr.verdict} | ${qr.feedback.substring(0, 80)}`);
          } catch (scoreErr) {
            console.warn(`[generate-social-image] Quality scoring failed:`, scoreErr);
            qualityVerdict = requireReview ? "pending_review" : "approved";
          }

          // Map verdict to status:
          //   score >= 8 → auto-approved
          //   score 5-7  → pending_review (needs human check)
          //   score < 5  → auto-rejected
          const finalStatus =
            qualityVerdict === "approved" ? "approved" :
            qualityVerdict === "rejected" ? "rejected" :
            requireReview ? "pending_review" : "approved";

          // If rejected, delete the uploaded file to save storage
          if (finalStatus === "rejected") {
            console.log(`[generate-social-image] Auto-rejected (score ${qualityScore}/10). Deleting image.`);
            await supabase.storage.from("social-media").remove([storagePath]);
          }

          // ── Insert into social_generated_images ──
          const { data: genImg, error: insertErr } = await supabase
            .from("social_generated_images")
            .insert({
              product_id: product.id,
              storage_path: finalStatus === "rejected" ? null : storagePath,
              public_url: finalStatus === "rejected" ? null : publicUrl,
              prompt: usedPrompt,
              model: useModel,
              style: currentStyle,
              quality: useQuality,
              size: useSize,
              status: finalStatus,
              generation_cost_cents: costCents,
              carousel_set_id: carouselSetId,
              metadata: {
                mode: genMode,
                revised_prompt: genResult.revised_prompt || null,
                product_name: product.name,
                category: categoryName,
                had_reference_photo: hasPhoto,
                season: getCurrentSeason(),
                scene_env: sceneFingerprint.env,
                scene_mood: sceneFingerprint.mood,
                scene_camera: sceneFingerprint.camera,
                quality_score: qualityScore,
                quality_feedback: qualityFeedback,
                carousel_set_id: carouselSetId,
                carousel_index: carousel ? i : null,
              },
            })
            .select("id, status, public_url")
            .single();

          if (insertErr) {
            console.error("DB insert error:", insertErr);
            results.push({
              product_id: product.id,
              product_name: product.name,
              style: currentStyle,
              success: false,
              error: `DB error: ${insertErr.message}`,
            });
            continue;
          }

          // Add fingerprint to recent list so next iteration in same batch avoids it
          recentScenes.push(sceneFingerprint);

          results.push({
            product_id: product.id,
            product_name: product.name,
            style: currentStyle,
            mode: genMode,
            success: true,
            generated_image_id: genImg.id,
            public_url: genImg.public_url,
            status: genImg.status,
            quality_score: qualityScore,
            quality_feedback: qualityFeedback,
            cost_cents: costCents,
            model: useModel,
          });

          console.log(
            `[generate-social-image] ✓ ${genMode} for "${product.name}" → ${finalStatus} (${qualityScore}/10) ${publicUrl}`
          );
        } catch (genError) {
          console.error(
            `[generate-social-image] Error for ${product.name}:`,
            genError
          );
          results.push({
            product_id: product.id,
            product_name: product.name,
            style: currentStyle,
            mode: genMode,
            success: false,
            error: genError.message,
          });
        }
      }
    }

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const totalCost = successful.reduce((sum, r) => sum + (r.cost_cents || 0), 0);

    // Build carousel URLs array if in carousel mode
    const carouselUrls = carousel
      ? successful.filter((r) => r.status === "approved").map((r) => r.public_url)
      : null;

    // Return success:false only when ALL images failed
    const overallSuccess = successful.length > 0;

    return new Response(
      JSON.stringify({
        success: overallSuccess,
        error: overallSuccess ? undefined : (failed[0]?.error || "All images failed to generate"),
        message: `Generated ${successful.length}/${results.length} images${carousel ? ` (carousel set)` : ""}`,
        total_cost_cents: totalCost,
        total_cost_display: `$${(totalCost / 100).toFixed(2)}`,
        carousel_set_id: carouselSetId,
        carousel_urls: carouselUrls,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[generate-social-image] Error:", err);
    return error(err.message, 500);
  }
});

// ═══════════════════════ Types ═══════════════════════
interface GenResult {
  success: boolean;
  imageData?: Uint8Array;  // raw PNG bytes, ready for upload
  prompt?: string;
  revised_prompt?: string;
  error?: string;
}

// ═══════════════ Image-to-Image (gpt-image-1 edits) ═══════════════
// Sends the actual product photo + styling prompt → restyled product image
async function generateImageFromReference(
  apiKey: string,
  opts: { imageBlob: Blob; prompt: string; size: string }
): Promise<GenResult> {
  const { imageBlob, prompt, size } = opts;

  const formData = new FormData();
  formData.append("image", imageBlob, "product.png");
  formData.append("prompt", prompt);
  formData.append("model", "gpt-image-1");
  formData.append("size", size);
  formData.append("n", "1");

  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Note: Do NOT set Content-Type — fetch sets it with boundary for FormData
    },
    body: formData,
  });

  const result = await resp.json();

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    return { success: false, error: "No image data in response" };
  }

  // Decode base64 to bytes
  const imageData = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  return {
    success: true,
    imageData,
    prompt,
    revised_prompt: result.data[0].revised_prompt,
  };
}

// ═══════════════ Text-to-Image Fallback (DALL-E 3) ═══════════════
// Only used when no product photo is available
async function generateImageFromText(
  apiKey: string,
  opts: { model: string; prompt: string; quality: string; size: string }
): Promise<GenResult> {
  const { model, prompt, quality, size } = opts;

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      quality,
      response_format: "b64_json",
    }),
  });

  const result = await resp.json();

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    return { success: false, error: "No image data in response" };
  }

  const imageData = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  return {
    success: true,
    imageData,
    prompt,
    revised_prompt: result.data[0].revised_prompt,
  };
}

// ═══════════════ Quality Scoring (GPT-4o Vision) ═══════════════
// Compares the generated image against the original product photo.
// Scores 1-10 on product accuracy, composition, and IG-readiness.
// Returns: score, verdict (approved/pending_review/rejected), feedback.
async function scoreGeneratedImage(
  apiKey: string,
  generatedUrl: string,
  originalUrl: string | null,
  productName: string
): Promise<{ score: number; verdict: string; feedback: string }> {
  const images: any[] = [
    {
      type: "image_url" as const,
      image_url: { url: generatedUrl, detail: "low" as const },
    },
  ];

  // If we have the original for comparison, include it
  let comparisonInstr = "";
  if (originalUrl) {
    images.push({
      type: "image_url" as const,
      image_url: { url: originalUrl, detail: "low" as const },
    });
    comparisonInstr = `The SECOND image is the original product photo. Compare the product in the generated image to the original — does it look like the same product? Same colors, shape, details?`;
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You are a social media image quality reviewer for an e-commerce brand. Score generated product images on a scale of 1-10.

Scoring criteria:
- Product accuracy (does it match the original? same colors/shape/details?) — 40% weight
- Composition & aesthetics (is it visually appealing, well-lit, Instagram-worthy?) — 30% weight  
- No artifacts, distortion, weird hands, text, or watermarks — 30% weight

Respond in EXACTLY this JSON format, nothing else:
{"score": 8, "feedback": "one sentence explaining the score"}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Rate this AI-generated social media image for the product "${productName}". The FIRST image is the AI-generated one. ${comparisonInstr}`,
            },
            ...images,
          ],
        },
      ],
    }),
  });

  const result = await resp.json();
  const content = result.choices?.[0]?.message?.content || "";

  try {
    // Parse the JSON response
    const parsed = JSON.parse(content.trim().replace(/```json\n?|\n?```/g, ""));
    const score = Math.min(10, Math.max(1, parseInt(parsed.score) || 5));
    const feedback = parsed.feedback || "No feedback";

    // Verdict thresholds
    const verdict = score >= 8 ? "approved" : score >= 5 ? "pending_review" : "rejected";

    return { score, verdict, feedback };
  } catch {
    // If parsing fails, default to pending review
    return { score: 5, verdict: "pending_review", feedback: `Could not parse score: ${content.substring(0, 100)}` };
  }
}

// ═══════════════════════ Helper ═══════════════════════
function error(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
