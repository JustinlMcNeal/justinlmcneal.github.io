// amazon-ai-autofill — Admin-only Amazon listing draft copy assist (OpenAI vision).
// GUARDRAILS: AI does NOT choose product type, price, quantity, or fulfillment settings.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-ai-autofill]";
const AMAZON_ITEM_NAME_MAX_LENGTH = 75;

function clampAmazonItemName(title: string, maxLength = AMAZON_ITEM_NAME_MAX_LENGTH): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length <= maxLength) return trimmed;
  let cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLength * 0.6)) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.trim();
}

type AiField = {
  value: string;
  confidence?: number;
  source?: string;
};

type AiAttribute = {
  name: string;
  value: string;
  source?: string;
  confidence?: number;
};

function parseStringArray(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, maxItems);
}

function parseImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
    .slice(0, 4);
}

function parseAiField(value: unknown): AiField | null {
  const rec = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const text = typeof rec?.value === "string" ? rec.value.trim() : "";
  if (!text) return null;
  return {
    value: text,
    confidence: typeof rec?.confidence === "number" ? rec.confidence : undefined,
    source: typeof rec?.source === "string" ? rec.source : undefined,
  };
}

function parseBulletPoints(value: unknown): AiField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parseAiField(entry))
    .filter((entry): entry is AiField => entry !== null)
    .slice(0, 5);
}

type AiAttributeHint = {
  name: string;
  label?: string;
  hint?: string;
  defaultValue?: string;
  enumValues?: string[];
};

function parseAttributeHints(value: unknown): AiAttributeHint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const rec = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : null;
      const name = typeof rec?.name === "string" ? rec.name.trim() : "";
      if (!name) return null;
      const enumValues = parseStringArray(rec?.enumValues, 24);
      return {
        name,
        label: typeof rec?.label === "string" ? rec.label.trim() : undefined,
        hint: typeof rec?.hint === "string" ? rec.hint.trim() : undefined,
        defaultValue: typeof rec?.defaultValue === "string" ? rec.defaultValue.trim() : undefined,
        enumValues,
      };
    })
    .filter((entry): entry is AiAttributeHint => entry !== null)
    .slice(0, 40);
}

function productTypeAttributeRules(productType: string): string {
  const pt = productType.trim().toUpperCase();
  if (pt === "KEYCHAIN") {
    return `
KEYCHAIN-SPECIFIC (product type is KEYCHAIN — follow exactly):
- item_type_keyword must be key-chains (or another value from enumValues). Never use plush-figure-toys or toy browse-tree codes.
- Fill required KEYCHAIN fields using enumValues when provided:
  department → Unisex unless images/title indicate otherwise
  import_designation → Imported
  size → Small, Medium, or Large based on visible scale
  special_feature → Quick Release, Lightweight, or best match from enumValues
  closure → Lobster Clasp, Split Ring, or C Hook based on visible hardware
- included_components → describe keychain parts (e.g. "Metal keychain with charms", "Keyring with chain and lobster clasp"). Never plush/toy bouquet phrases.
- material → infer from images (Metal, Acrylic, Plush Fabric, etc.).
- generic_keyword → keychain/accessory search terms only.
- DO NOT return: cpsia_cautionary_statement, safety_warning, educational_objective, is_assembly_required, target_audience_keyword, age_range_description, manufacturer_minimum_age, manufacturer_maximum_age, toy_figure_type, subject_character.
- batteries_required → false for non-electronic keychains.`;
  }
  if (pt === "HAT") {
    return `
HAT-SPECIFIC (product type is HAT — follow exactly):
- item_type_keyword: cold-weather-hats for beanies/earflap hats (from enumValues).
- headwear_size: use size_class alpha and size One Size for stretch beanies unless numeric sizing is shown.
- special_size_type → Standard for regular one-size beanies (from enumValues). Required when Amazon asks for Special Size.
- department → Unisex unless clearly mens/womens.
- care_instructions, style, seasons, lifestyle, pattern_type → pick from enumValues (e.g. Hand Wash Only, Casual, Fall, Casual, Graphic).
- fabric_type → 100% Acrylic (or exact fiber content visible on label/tags). Never Plush.
- material → Acrylic for knit beanies (not generic Polyester unless label shows polyester blend).
- title_differentiation → Item Highlight: short feature phrase (max 125 chars), e.g. Faux fur cat ears. Not the field name.
- color → primary hat color (Black, Gray, etc.) — not Multicolor unless truly multi-color.
- theme → Animal for cat/animal ear hats; pick from enumValues.
- number_of_items → 1.
- batteries_required → false (required for HAT — always include in attributes[]).
- DO NOT return: package_level, included_components, variation_role, closure, size, special_feature, toy fields, plant fields, or any image_locator fields (images are uploaded separately).
- generic_keyword → beanie, winter hat, cat ear beanie search terms.`;
  }
  if (pt === "APPAREL_PIN") {
    return `
APPAREL_PIN-SPECIFIC (product type is APPAREL_PIN — follow exactly):
- item_type_keyword must be brooches-and-pins (from enumValues).
- material → Metal (or Enamel when visible).
- metal_type → alloy (standalone enum, must match metals composite type).
- metals → pipe-delimited composite: Alloy|No Metal Stamp|1 (metal_type|metal_stamp|id). Use Alloy for enamel pins.
- stones → pipe-delimited composite: No Gemstone|Not Treated|Unknown|1 (type|treatment_method|creation_method|id).
- gem_type → No Gemstone for enamel-only pins (must match stones type).
- department → Unisex; size → Small for typical lapel pins.
- title_differentiation → short differentiator such as Enamel Pin or Lapel Pin.
- color → primary pin color (e.g. Black, Multicolor).
- generic_keyword → enamel pin, lapel pin, brooch search terms.
- DO NOT return: package_level, included_components, theme, toy fields, plant fields, or image_locator fields.`;
  }
  if (pt === "APPAREL_BELT") {
    return `
APPAREL_BELT-SPECIFIC (product type is APPAREL_BELT — follow exactly):
- item_type_keyword must be apparel-belts or novelty-apparel-belts (from enumValues). Use apparel-belts for fashion/western belts.
- fabric_type → strap material text such as 100% Faux Leather or PU Leather (required — never Plush or plant fabric terms).
- material → Faux Leather, PU Leather, or Leather when visible (not Metal, alloy, or Polyester unless clearly a fabric belt).
- title_differentiation → Item Highlight: short benefit phrase about the buckle/strap (max 125 chars). Never "Default", "Enamel Pin", or the field name.
- department → Unisex or Womens from enumValues.
- size → One Size for adjustable belts with multiple holes.
- care_instructions → Wipe Clean or Hand Wash Only from enumValues.
- import_designation → Imported unless label says otherwise.
- age_range_description → Adult for fashion belts.
- color → primary strap/buckle color (e.g. Black, Brown — not Multicolor unless clearly multi-color).
- target_gender → unisex unless clearly womens/mens belt.
- generic_keyword → belt, western belt, faux leather belt, heart buckle search terms.
- item_package_dimensions / item_package_weight → reasonable shipping box size/weight for a belt.
- DO NOT return: metals, stones, gem_type, metal_type, headwear_size, theme, package_level, included_components, toy fields, plant fields, pin dimensions, or image_locator fields.`;
  }
  if (pt === "HANDBAG") {
    return `
HANDBAG-SPECIFIC (product type is HANDBAG — follow exactly):
- item_type_keyword → top-handle-handbags, cross-body-handbags, or shoulder-handbags (from enumValues) for mini totes and purses.
- fabric_type → Faux Leather or PU Leather (exterior). Never Plush or plant fabric terms.
- material → Faux Leather, PU Leather, or Polyurethane when visible.
- lining_description → Polyester or interior lining material when visible.
- title_differentiation → Item Highlight: short benefit phrase (max 125 chars). Never "Enamel Pin", "Default", or the field name.
- special_feature → Detachable Strap or Convertible from enumValues when applicable.
- target_audience → Women or Unisex-Adults for fashion mini bags.
- department → Womens or Unisex.
- style → Casual or Fashion from enumValues.
- theme → Love for heart-themed bags; pick from enumValues.
- included_components → Shoulder Strap or Detachable Strap when a strap is included.
- batteries_required → false (required when Amazon asks — always include in attributes[]).
- number_of_items → 1.
- size_info → Mini / Small (display name only — not size class codes).
- capacity → 1.5|liters (numeric amount | unit). Never free-text descriptions.
- outer → exterior material phrase, e.g. Faux Leather with heart embossing.
- inner → interior lining phrase, e.g. Polyester lining with slip pocket.
- item_dimensions → 8 x 6 x 4 in (height x width x length with unit).
- closure → Zipper or Magnetic from enumValues. Never Lobster Clasp (keychain value).
- strap_type → Shoulder or Cross-Body from enumValues.
- number_of_compartments → 1, 2, or 3.
- seasons → Fall or All Seasons from enumValues.
- import_designation → Imported.
- age_range_description → Adult.
- DO NOT return: package_level, parentage_level, color on variation parents, headwear_size, hat fields, toy fields, plant fields, pin fields, or image_locator fields.
- generic_keyword → mini bag, crossbody purse, heart tote search terms.`;
  }
  if (pt === "TOTE_BAG") {
    return `
TOTE_BAG-SPECIFIC (product type is TOTE_BAG — follow exactly):
- item_type_keyword → reusable-grocery-bags or shopping-totes (from enumValues) for canvas mini totes.
- fabric_type → Canvas or 100% Cotton (exterior). Never Plush, Faux Leather, or plant fabric terms.
- material → Cotton or Canvas when visible.
- lining_description → Unlined when the bag has no separate lining.
- title_differentiation → Item Highlight: short benefit phrase (max 125 chars). Never "Enamel Pin", "Default", or the field name.
- special_feature → Reusable or Lightweight from enumValues when applicable.
- target_audience → Unisex-Adults or Women.
- department → Unisex or Womens.
- style → Casual from enumValues.
- batteries_required → false.
- number_of_items → 1.
- size_info → Mini / Small (display name only — not size class codes).
- capacity → 1.5|liters (numeric amount | unit). Never free-text descriptions like "Small - fits daily essentials".
- outer → Canvas or Cotton canvas.
- inner → Unlined (canvas interior) when there is no separate lining.
- item_length_width_height → 8 x 6 x 4 in (length x width x height with unit).
- closure → Open Top for open canvas totes without a zipper. Never Lobster Clasp or Clasp unless clearly present.
- strap_type → Hand-Carry or Shoulder from enumValues.
- number_of_compartments → 1.
- import_designation → Imported.
- age_range_description → Adult.
- model_number / part_number → use the child seller SKU (e.g. KK-0033-BLUE), never the parent SKU.
- DO NOT return: package_level, included_components, parentage_level, item_dimensions, headwear_size, hat fields, toy fields, plant fields, pin fields, or image_locator fields.
- generic_keyword → mini tote, canvas bag, reusable bag, pastel tote search terms.`;
  }
  if (pt === "TOY_FIGURE") {
    return `
TOY_FIGURE-SPECIFIC:
- item_type_keyword: plush-figure-toys or plush-animal-toys from enumValues (never free text).
- toy_figure_type: stuffed_toy for plush items (not "plush").
- Skip supplier_declared_dg_hz_regulation unless explicitly required.`;
  }
  return "";
}

function parseAttributes(value: unknown): AiAttribute[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const rec = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : null;
      const name = typeof rec?.name === "string" ? rec.name.trim() : "";
      const attrValue = typeof rec?.value === "string" ? rec.value.trim() : "";
      if (!name || !attrValue) return null;
      return {
        name,
        value: attrValue,
        source: typeof rec?.source === "string" ? rec.source : undefined,
        confidence: typeof rec?.confidence === "number" ? rec.confidence : undefined,
      };
    })
    .filter((entry): entry is AiAttribute => entry !== null)
    .slice(0, 40);
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
  const openAiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !openAiKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = await requireAdminJson(
    createClient,
    supabaseUrl,
    supabaseAnonKey,
    authHeader,
    LOG_PREFIX,
  );
  if (!admin.ok) return admin.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const productName = typeof body.productName === "string" ? body.productName.trim() : "";
  const productCode = typeof body.productCode === "string" ? body.productCode.trim() : "";
  const productType = typeof body.productType === "string" ? body.productType.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const price = body.price;
  const imageUrls = parseImageUrls(body.imageUrls);
  const requiredAttributes = parseStringArray(body.requiredAttributes, 40);
  const recommendedAttributes = parseStringArray(body.recommendedAttributes, 20);
  const attributeHints = parseAttributeHints(body.attributeHints);
  const variationRole = typeof body.variationRole === "string" ? body.variationRole.trim().toLowerCase() : "";
  const variationTheme = typeof body.variationTheme === "string" ? body.variationTheme.trim() : "";
  const variantColors = parseStringArray(body.variantColors, 12);
  const brandDefault = typeof body.brandDefault === "string" && body.brandDefault.trim()
    ? body.brandDefault.trim()
    : "Generic";
  const isParentListing = variationRole === "parent";

  if (!productName) {
    return json({ ok: false, error: "invalid_request", hint: "productName is required" }, 400);
  }

  const imageContent = imageUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url, detail: "low" },
  }));

  const systemPrompt = `You are an expert Amazon listing copywriter for "Karry Kraze", a trendy online store selling fashion accessories, bags, headwear, jewelry, plushies, and collectibles. Target audience: Gen-Z and young women (ages 16-28).

Generate Amazon listing content from product data and images.

STRICT RULES:
1. TITLE (item_name): SEO-optimized Amazon title, HARD MAX ${AMAZON_ITEM_NAME_MAX_LENGTH} characters (required for Amazon Item Highlights). Prioritize the most important keywords in the first 75 characters. Do NOT exceed 75 characters under any circumstance. Do NOT stuff brand name unless helpful.
2. BULLET POINTS: Return exactly 5 concise bullet points, each max 500 characters. Focus on benefits and features visible from images/data.
3. DESCRIPTION (product_description): Plain text product description, 2-4 short paragraphs, max 2000 characters. No HTML. Warm, on-brand tone.
4. BRAND: Default to "${brandDefault}" unless product data clearly indicates otherwise.
5. PTD ATTRIBUTES: Fill Amazon PTD attribute values from images, title, and hints below.
   - Return one attributes[] entry for EVERY required attribute name when possible.
   - Use attributeHints.defaultValue when you cannot infer a better value from images/title.
   - When attributeHints.enumValues is provided, pick EXACTLY one allowed enum value (never invent codes).
   - item_type_keyword must be a browse-tree code from enumValues (never free text like "stuffed-animal-toys" unless in enumValues).
   - theme must match Amazon enum values (e.g. Floral not Flowers).
   - toy_figure_type for plush items: stuffed_toy (not plush).
   SAFE DEFAULTS when required and unknown:
   - country_of_origin → "CN" (source: default) unless product data says otherwise
   - supplier_declared_has_product_identifier_exemption → "true" for Karry Kraze private-label SKUs without UPC
   - supplier_declared_dg_hz_regulation → "not_applicable" (source: default) for plush/accessory items (skip for TOY_FIGURE)
   - cpsia_cautionary_statement → "no_warning_applicable" (TOY_FIGURE only — skip for KEYCHAIN)
   - safety_warning → "no_warning_applicable" (TOY_FIGURE only — skip for KEYCHAIN)
   - is_assembly_required → "false" (TOY_FIGURE only — skip for KEYCHAIN)
   - batteries_required → "false" for non-electronic plush/accessories
   - package_level → "unit"
   - number_of_items → "1"
   - manufacturer / brand → "${brandDefault}"
   - model_name / part_number → product code when provided
   - item_length_width_height / item_package_dimensions → estimate from images (e.g. "8 x 6 x 4 in") when plausible
   - item_package_weight → "0.5 pounds" for small plush/accessories when unknown
   - material → infer from images (Polyester, Plush, Faux Leather, Metal, etc.) when visible
   - included_components → short phrase describing what is in the package
   - generic_keyword → 3-5 search keywords comma-separated or short phrase
6. DO NOT set or suggest: product type, price, quantity, fulfillment channel, condition, seller SKU, marketplace, ASIN, UPC/EAN/GTIN.
7. DO NOT invent compliance claims. Use safe defaults above rather than leaving required attributes empty.
${isParentListing ? `
PARENT VARIATION LISTING (variationRole=parent):
- This is a non-buyable Amazon variation parent shell, NOT a child SKU and NOT a standalone listing.
- Variation theme${variationTheme ? ` is ${variationTheme}` : ""}. Child listings will carry color/size-specific values.
- TITLE / BULLETS / DESCRIPTION must be COLOR-NEUTRAL and VARIANT-NEUTRAL.
  - Do NOT mention Gold, Silver, or any single color/finish in title, bullets, or description.
  - Write for the whole product family${variantColors.length ? ` (available colors include: ${variantColors.join(", ")})` : ""}.
- DO NOT return color, merchant_suggested_asin, price, quantity, or variant-specific model/part numbers tied to one color.
- model_name / model_number / part_number → use parent product code with -PARENT suffix when provided (e.g. KK-0018-PARENT).
- Use shared/generic hero imagery concepts only; do not describe one finish as the only option.
` : ""}${productTypeAttributeRules(productType)}

Respond with ONLY valid JSON:
{
  "title": { "value": "string", "confidence": 0.0-1.0, "source": "generated" },
  "description": { "value": "string", "confidence": 0.0-1.0, "source": "generated" },
  "brand": { "value": "${brandDefault}", "confidence": 1.0, "source": "default" },
  "bullet_points": [
    { "value": "string", "confidence": 0.0-1.0, "source": "generated" }
  ],
  "attributes": [
    { "name": "amazon_attribute_name", "value": "string", "source": "from_data|inferred|default", "confidence": 0.0-1.0 }
  ],
  "notes": ["strings for admin review"]
}`;

  let userPrompt = `Generate Amazon listing content for this product:\n\n`;
  userPrompt += `Product Name: ${productName}\n`;
  if (productCode) userPrompt += `Product Code: ${productCode}\n`;
  if (productType) userPrompt += `Amazon Product Type (already chosen — do NOT change): ${productType}\n`;
  if (isParentListing) {
    userPrompt += `Listing Role: PARENT variation family shell (not buyable, color-neutral copy only)\n`;
    if (variationTheme) userPrompt += `Variation Theme: ${variationTheme}\n`;
    if (variantColors.length) userPrompt += `Child variant colors (for context only — do NOT pick one): ${variantColors.join(", ")}\n`;
  }
  if (category) userPrompt += `Store Category: ${category}\n`;
  if (!isParentListing && typeof price === "number" && Number.isFinite(price)) {
    userPrompt += `Reference Price: $${price}\n`;
  }
  if (requiredAttributes.length) {
    userPrompt += `\nRequired Amazon attributes to fill when possible:\n`;
    userPrompt += requiredAttributes.map((name) => `- ${name}`).join("\n");
  }
  if (recommendedAttributes.length) {
    userPrompt += `\nRecommended Amazon attributes (fill when confident):\n`;
    userPrompt += recommendedAttributes.map((name) => `- ${name}`).join("\n");
  }
  if (attributeHints.length) {
    userPrompt += `\nAttribute field hints (use defaultValue or enumValues when unsure):\n`;
    userPrompt += attributeHints.map((hint) => {
      const parts = [`- ${hint.name}`];
      if (hint.label) parts.push(`label: ${hint.label}`);
      if (hint.hint) parts.push(`hint: ${hint.hint}`);
      if (hint.defaultValue) parts.push(`default: ${hint.defaultValue}`);
      if (hint.enumValues?.length) parts.push(`allowed: ${hint.enumValues.join(", ")}`);
      return parts.join(" | ");
    }).join("\n");
  }
  userPrompt += `\n\nReturn ONLY valid JSON.`;

  console.log(
    `${LOG_PREFIX} product=${productName.slice(0, 60)} images=${imageContent.length} required=${requiredAttributes.length} hints=${attributeHints.length}`,
  );

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: string } }
  > = [{ type: "text", text: userPrompt }, ...imageContent];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_completion_tokens: 8000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.log(`${LOG_PREFIX} openai_error`, response.status, errBody.slice(0, 400));
      return json({ ok: false, error: "openai_request_failed", hint: String(response.status) }, 502);
    }

    const completion = await response.json();
    const rawContent = (
      completion.choices?.[0]?.message?.content ||
      completion.output?.[0]?.content?.[0]?.text ||
      completion.choices?.[0]?.text ||
      ""
    ).trim();

    if (!rawContent) {
      return json({ ok: false, error: "openai_empty_response" }, 502);
    }

    let cleaned = rawContent;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      console.log(`${LOG_PREFIX} json_parse_failed`, cleaned.slice(0, 300));
      return json({ ok: false, error: "openai_invalid_json" }, 502);
    }

    const title = parseAiField(parsed.title);
    const description = parseAiField(parsed.description);
    const brand = parseAiField(parsed.brand);
    const bulletPoints = parseBulletPoints(parsed.bullet_points);
    const attributes = parseAttributes(parsed.attributes);
    const notes = parseStringArray(parsed.notes, 8);

    if (title?.value) {
      const original = title.value;
      title.value = clampAmazonItemName(title.value);
      if (title.value.length !== original.length) {
        notes.unshift(
          `Title trimmed to ${title.value.length} characters (Amazon Item Highlights max ${AMAZON_ITEM_NAME_MAX_LENGTH}).`,
        );
      }
    }

    if (!title && !description && !bulletPoints.length) {
      return json({ ok: false, error: "openai_no_usable_content" }, 502);
    }

    return json({
      ok: true,
      data: {
        title,
        description,
        brand,
        bulletPoints,
        attributes,
        notes,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unexpected_error";
    console.log(`${LOG_PREFIX} error`, message);
    return json({ ok: false, error: "unexpected_error", hint: message.slice(0, 200) }, 500);
  }
});
