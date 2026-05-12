// supabase/functions/create-checkout-session/index.ts
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-runtime, x-supabase-client-platform, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toCents(amount: number) {
  return Math.round(Number(amount) * 100);
}

function metaStr(v: unknown, max = 200) {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function safeInt(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function makeKkOrderId() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `KKO-${n}`;
}

function uniqStrings(arr: unknown[]): string[] {
  const out = new Set<string>();
  for (const x of arr || []) {
    const s = String(x ?? "").trim();
    if (s) out.add(s);
  }
  return Array.from(out);
}

// ── Phase 2: variant lookup type ─────────────────────────────────────────────
type VariantLookup = {
  product_id: string;         // UUID of the parent product
  sku: string | null;
  title: string | null;
  option_values: Record<string, string> | null;
  price_override_cents: number | null;
  weight_g_override: number | null;
};

// Shipping rate IDs from Stripe Dashboard
// Replace these with your actual Stripe shipping rate IDs after creating them
// Valid format: shr_XXXXXXXXXXXXXXXXXX (starts with "shr_")
const SHIPPING_RATES = {
  STANDARD: Deno.env.get("STRIPE_SHIPPING_STANDARD") || "",
  EXPRESS: Deno.env.get("STRIPE_SHIPPING_EXPRESS") || "",
  FREE: Deno.env.get("STRIPE_SHIPPING_FREE") || "",
};

// Validate shipping rate ID format
function isValidShippingRateId(id: string): boolean {
  return id.startsWith("shr_") && id.length > 10;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const SITE_URL = Deno.env.get("SITE_URL");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!STRIPE_SECRET_KEY) return json({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    if (!SITE_URL) return json({ error: "Missing SITE_URL" }, 500);
    if (!SUPABASE_URL) return json({ error: "Missing SUPABASE_URL" }, 500);
    if (!SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) return json({ error: "Cart is empty" }, 400);

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || null;

    // Fetch free shipping threshold from site_settings
    let freeShippingThreshold = 50; // default
    let freeShippingEnabled = true;
    
    try {
      const { data: settingsData } = await supabaseAdmin
        .from("site_settings")
        .select("value")
        .eq("key", "free_shipping")
        .single();
      
      if (settingsData?.value) {
        freeShippingEnabled = settingsData.value.enabled ?? true;
        freeShippingThreshold = Number(settingsData.value.threshold) || 50;
      }
    } catch (e) {
      console.warn("[create-checkout-session] Could not fetch free shipping settings, using defaults");
    }

    // ✅ Check for free_shipping type coupon (handles both free-shipping and free_shipping)
    const promo = body?.promo ?? {};
    const couponType = String(promo?.coupon_type || "").toLowerCase();
    let hasFreeShippingCoupon = couponType === "free_shipping" || couponType === "free-shipping";
    let qualifiesForFreeShipping = false;

    // order id
    const kk_order_id =
      typeof body?.kk_order_id === "string" && body.kk_order_id.trim()
        ? metaStr(body.kk_order_id, 32)
        : makeKkOrderId();

    const baseSuccess =
      typeof body?.success_url === "string"
        ? body.success_url
        : `${SITE_URL}/pages/success.html`;

    const success_url =
      baseSuccess.includes("?")
        ? `${baseSuccess}&oid=${encodeURIComponent(kk_order_id)}`
        : `${baseSuccess}?oid=${encodeURIComponent(kk_order_id)}`;

    const cancel_url =
      typeof body?.cancel_url === "string"
        ? body.cancel_url
        : `${SITE_URL}/pages/catalog.html`;

    // order-level optional metadata
    const orderSource = metaStr(body?.source || "website", 60) || "website";
    const orderShippingType = metaStr(body?.shipping_type || "", 60) || "";

    // promo truth (since Stripe doesn't discount for you) - promo already declared above
    const promoCode = metaStr(promo?.code || "", 80).toUpperCase();
    let savingsCents = Math.max(0, safeInt(promo?.savings_cents, 0));
    let savingsCodeCents = Math.max(0, safeInt(promo?.savings_code_cents, 0));
    let savingsAutoCents = Math.max(0, safeInt(promo?.savings_auto_cents, 0));

    const appliedIds = Array.isArray(promo?.applied_ids)
      ? promo.applied_ids.map((x: any) => metaStr(x, 80)).filter(Boolean)
      : [];

    const promoMode = promoCode ? "code" : (savingsCents > 0 ? "auto" : "none");
    const promoIdsCsv = appliedIds.slice(0, 20).join(",");

    // ── Review coupon validation (THANKS-XXXXXX) ──────────────
    let reviewCouponId: string | null = null;
    let reviewCouponMin = 0;
    const isReviewCoupon = promoCode.startsWith("THANKS-");

    async function logCouponAttempt(reason: string, detail: string, extra: Record<string, unknown> = {}) {
      try {
        await supabaseAdmin.from("coupon_attempt_logs").insert({
          coupon_code: promoCode || null,
          reason,
          detail,
          subtotal_cents: Number(extra.subtotal_cents || 0),
          min_required_cents: Number(extra.min_required_cents || 0),
          kk_order_id,
          ip_address: clientIp,
          user_agent: req.headers.get("user-agent") || null,
          context: {
            source: orderSource,
            shipping_type: orderShippingType,
            ...extra,
          },
        });
      } catch (logErr) {
        console.warn("[create-checkout-session] coupon attempt logging failed:", logErr);
      }
    }

    if (isReviewCoupon && promoCode) {
      const { data: rcData, error: rcErr } = await supabaseAdmin
        .from("review_coupons")
        .select("id, used_at, expires_at, single_use, min_order")
        .eq("code", promoCode)
        .maybeSingle();

      if (rcErr) {
        console.warn("[create-checkout-session] review coupon lookup failed:", rcErr.message);
      } else if (!rcData) {
        return json({ error: "Review coupon not found." }, 400);
      } else if (rcData.used_at && rcData.single_use) {
        return json({ error: "This review coupon has already been used." }, 400);
      } else if (rcData.expires_at && new Date(rcData.expires_at) < new Date()) {
        return json({ error: "This review coupon has expired." }, 400);
      } else {
        reviewCouponId = rcData.id;
        reviewCouponMin = Number(rcData.min_order || 0);
      }
    }

    // ✅ weight lookup from products table by SKU code
    const skus = uniqStrings(items.map((it: any) => it?.product_id || it?.id || ""));
    const weightMap = new Map<string, number>();
    const priceMap = new Map<string, number>();
    const productUuidMap = new Map<string, string>();

    if (skus.length) {
      const { data, error } = await supabaseAdmin
        .from("products")
        .select("id, code, price, weight_g")
        .in("code", skus);

      if (error) {
        console.error("[create-checkout-session] weight lookup failed", error);
      } else {
        for (const row of data || []) {
          const code = String((row as any).code ?? "").trim();
          const price = Number((row as any).price ?? 0);
          const w = Number((row as any).weight_g ?? 0);
          const uuid = String((row as any).id ?? "");
          if (code) {
            if (Number.isFinite(price) && price >= 0) {
              priceMap.set(code, toCents(price));
            }
            weightMap.set(code, Number.isFinite(w) ? Math.max(0, Math.round(w)) : 0);
            if (uuid) productUuidMap.set(code, uuid);
          }
        }
      }
    }

    // ── Phase 2: variant lookup by variant_id ─────────────────────────────
    // When items carry variant_id, fetch the variant row server-side so we can
    // embed authoritative identity in Stripe metadata and apply weight overrides.
    // This does NOT change the anti-tamper subtotal check (still product-level).
    const variantIds = uniqStrings(
      items.map((it: any) => it?.variant_id).filter((v: any) => typeof v === "string")
    );
    const variantMap = new Map<string, VariantLookup>();

    if (variantIds.length) {
      const { data: vRows, error: vErr } = await supabaseAdmin
        .from("product_variants")
        .select("id, product_id, sku, title, option_values, price_override_cents, weight_g_override")
        .in("id", variantIds);

      if (vErr) {
        // Non-fatal: missing variant rows fall back to product-level data
        console.warn("[create-checkout-session] variant lookup failed (non-fatal):", vErr.message);
      } else {
        for (const v of vRows || []) {
          const vid = String((v as any).id ?? "").trim();
          if (!vid) continue;
          variantMap.set(vid, {
            product_id:           String((v as any).product_id ?? ""),
            sku:                  (v as any).sku  ? String((v as any).sku)  : null,
            title:                (v as any).title ? String((v as any).title) : null,
            option_values:        (v as any).option_values && typeof (v as any).option_values === "object"
                                    ? (v as any).option_values as Record<string, string>
                                    : null,
            price_override_cents: (v as any).price_override_cents != null
                                    ? Number((v as any).price_override_cents)
                                    : null,
            weight_g_override:    (v as any).weight_g_override != null
                                    ? Number((v as any).weight_g_override)
                                    : null,
          });
        }
      }
    }

    // Authoritative subtotal calculations
    const cartSubtotalOriginalCents = items.reduce((sum: number, it: any) => {
      const sku = String(it?.product_id || it?.id || "").trim();
      const qty = Math.max(1, Number(it?.qty || 1));
      const fallbackPriceCents = toCents(Number(it?.price ?? 0));
      const unitCents = priceMap.get(sku) ?? Math.max(0, fallbackPriceCents);
      return sum + (unitCents * qty);
    }, 0);

    const cartSubtotalPaidCents = items.reduce((sum: number, it: any) => {
      const qty = Math.max(1, Number(it?.qty || 1));
      const paidUnit = toCents(Number(it?.discounted_price ?? it?.price ?? 0));
      return sum + (Math.max(0, paidUnit) * qty);
    }, 0);

    const cartSubtotal = cartSubtotalPaidCents / 100;

    // Server-side promotion validation + anti-tamper for regular coupons
    if (promoCode && !isReviewCoupon) {
      const { data: promoRow, error: promoErr } = await supabaseAdmin
        .from("promotions")
        .select("id, code, type, value, min_order_amount, usage_count, usage_limit, start_date, end_date, is_active, requires_code")
        .eq("code", promoCode)
        .maybeSingle();

      if (promoErr || !promoRow) {
        await logCouponAttempt("invalid_coupon", "Coupon not found", { subtotal_cents: cartSubtotalOriginalCents });
        return json({ error: "Coupon not found." }, 400);
      }

      if (!promoRow.is_active) {
        await logCouponAttempt("inactive_coupon", "Coupon inactive", { subtotal_cents: cartSubtotalOriginalCents });
        return json({ error: "Coupon is not active." }, 400);
      }

      if (promoRow.requires_code === false) {
        await logCouponAttempt("not_code_coupon", "Promotion does not accept coupon code", { subtotal_cents: cartSubtotalOriginalCents });
        return json({ error: "This promotion does not accept a code." }, 400);
      }

      const now = new Date();
      const starts = promoRow.start_date ? new Date(promoRow.start_date) : null;
      const ends = promoRow.end_date ? new Date(promoRow.end_date) : null;
      if ((starts && starts > now) || (ends && ends < now)) {
        await logCouponAttempt("outside_window", "Coupon outside date window", { subtotal_cents: cartSubtotalOriginalCents });
        return json({ error: "Coupon is not active." }, 400);
      }

      const usageLimit = Number(promoRow.usage_limit || 0);
      const usageCount = Number(promoRow.usage_count || 0);
      if (usageLimit > 0 && usageCount >= usageLimit) {
        await logCouponAttempt("usage_exceeded", "Coupon usage limit reached", { subtotal_cents: cartSubtotalOriginalCents });
        return json({ error: "This coupon has already been used." }, 400);
      }

      const minOrderCents = toCents(Number(promoRow.min_order_amount || 0));
      if (minOrderCents > 0 && cartSubtotalOriginalCents < minOrderCents) {
        await logCouponAttempt("min_order_failed", "Coupon minimum order requirement not met", {
          subtotal_cents: cartSubtotalOriginalCents,
          min_required_cents: minOrderCents,
        });
        return json({ error: `This code requires a $${(minOrderCents / 100).toFixed(2)} minimum order.` }, 400);
      }

      const promoType = String(promoRow.type || "").toLowerCase();
      const promoValue = Number(promoRow.value || 0);
      let authoritativeCodeSavingsCents = 0;

      if (promoType === "percentage") {
        authoritativeCodeSavingsCents = Math.round(cartSubtotalOriginalCents * (promoValue / 100));
      } else if (promoType === "fixed") {
        authoritativeCodeSavingsCents = Math.min(toCents(promoValue), cartSubtotalOriginalCents);
      } else if (promoType === "free_shipping" || promoType === "free-shipping") {
        authoritativeCodeSavingsCents = 0;
        hasFreeShippingCoupon = true;
      }

      const expectedPaidCents = Math.max(0, cartSubtotalOriginalCents - authoritativeCodeSavingsCents);
      if (Math.abs(cartSubtotalPaidCents - expectedPaidCents) > 1) {
        await logCouponAttempt("pricing_mismatch", "Client totals mismatch server-calculated totals", {
          subtotal_cents: cartSubtotalOriginalCents,
          expected_paid_cents: expectedPaidCents,
          client_paid_cents: cartSubtotalPaidCents,
          authoritative_discount_cents: authoritativeCodeSavingsCents,
        });
        return json({ error: "Pricing mismatch detected. Please refresh your cart and try again." }, 400);
      }

      savingsCodeCents = authoritativeCodeSavingsCents;
      savingsAutoCents = 0;
      savingsCents = savingsCodeCents;
    }

    // Review coupon minimum order enforcement (server-side)
    if (isReviewCoupon && reviewCouponMin > 0) {
      const minOrderCents = toCents(reviewCouponMin);
      if (cartSubtotalOriginalCents < minOrderCents) {
        await logCouponAttempt("review_min_order_failed", "Review coupon minimum order requirement not met", {
          subtotal_cents: cartSubtotalOriginalCents,
          min_required_cents: minOrderCents,
        });
        return json({ error: `This code requires a $${(minOrderCents / 100).toFixed(2)} minimum order.` }, 400);
      }
    }

    // Qualifies if: (a) cart meets threshold OR (b) has free_shipping coupon applied
    qualifiesForFreeShipping =
      (freeShippingEnabled && cartSubtotal >= freeShippingThreshold) ||
      hasFreeShippingCoupon;

    // ✅ Stock check — determine which items are back-ordered (informational, not blocking)
    const backOrderSkus = new Set<string>();
    try {
      const uuids = [...productUuidMap.values()].filter(Boolean);
      if (uuids.length) {
        const { data: variantRows } = await supabaseAdmin
          .from("product_variants")
          .select("id, product_id, option_value, stock")
          .in("product_id", uuids)
          .eq("is_active", true);

        // Build a map of product_uuid → variant → stock AND variant_id → stock
        const stockByProduct = new Map<string, Map<string, number>>();
        const stockByVariantId = new Map<string, number>();
        for (const v of variantRows || []) {
          const pid = String(v.product_id);
          if (!stockByProduct.has(pid)) stockByProduct.set(pid, new Map());
          stockByProduct.get(pid)!.set(String(v.option_value || "").toLowerCase(), v.stock ?? 0);
          if (v.id) stockByVariantId.set(String(v.id), v.stock ?? 0);
        }

        // Check each cart item for back-order
        for (const it of items) {
          const sku = String(it?.product_id || it?.id || "").trim();
          const variantId = String(it?.variant_id || "").trim();
          const variant = String(it?.variant || "").trim().toLowerCase();
          const uuid = productUuidMap.get(sku);

          // Phase 2: prefer variant_id for direct stock check
          if (variantId && stockByVariantId.has(variantId)) {
            if ((stockByVariantId.get(variantId) ?? 0) <= 0) {
              backOrderSkus.add(sku);
            }
            continue;
          }

          if (!uuid) continue;
          const variants = stockByProduct.get(uuid);
          if (!variants) continue;

          const variantStock = variant ? (variants.get(variant) ?? null) : null;
          const totalStock = [...variants.values()].reduce((s, v) => s + v, 0);

          if ((variantStock !== null && variantStock <= 0) || totalStock <= 0) {
            backOrderSkus.add(sku);
          }
        }
      }
    } catch (stockErr) {
      console.warn("[create-checkout-session] stock check failed (non-fatal):", stockErr);
    }

    // ✅ Stripe line items
    const line_items = items.map((it: any) => {
      const productId = metaStr(it?.product_id || it?.id || "", 80); // SKU
      const name = metaStr(it?.name || "Item", 200);
      const variant = metaStr(it?.variant || "", 120);

      const qty = Math.max(1, Number(it?.qty || 1));

      const originalUnit = (priceMap.get(productId) ?? toCents(Number(it?.price ?? 0))) / 100;
      const finalUnit = Number(it?.discounted_price ?? it?.price ?? 0);

      if (!Number.isFinite(finalUnit) || finalUnit <= 0) {
        throw new Error(`Invalid final unit price for ${productId}: ${finalUnit}`);
      }
      if (!Number.isFinite(originalUnit) || originalUnit < 0) {
        throw new Error(`Invalid original unit price for ${productId}: ${originalUnit}`);
      }

      const originalUnitCents = toCents(originalUnit);
      const finalUnitCents = toCents(finalUnit);

      // ── Phase 2: resolve variant-level weight override ─────────────────
      const resolvedVariantId = metaStr(it?.variant_id || "", 80);
      const resolvedVariant = resolvedVariantId ? variantMap.get(resolvedVariantId) : undefined;

      // Weight: prefer variant weight_g_override when set; else product-level weight
      const productWeightG = weightMap.get(productId) ?? 0;
      const itemWeightG =
        resolvedVariant?.weight_g_override != null && resolvedVariant.weight_g_override >= 0
          ? resolvedVariant.weight_g_override
          : productWeightG;

      // ── Phase 2: enriched variant metadata for Stripe ──────────────────
      const variantSku   = metaStr(it?.variant_sku   || resolvedVariant?.sku   || "", 80);
      const variantTitle = metaStr(it?.variant_title || resolvedVariant?.title || "", 120);

      // Serialize selected_options → JSON string for Stripe metadata
      const selectedOptionsObj =
        it?.selected_options && typeof it.selected_options === "object" && !Array.isArray(it.selected_options)
          ? it.selected_options
          : (resolvedVariant?.option_values ?? null);
      const selectedOptionsMeta = selectedOptionsObj
        ? metaStr(JSON.stringify(selectedOptionsObj), 200)
        : "";

      const imageUrl =
        typeof it?.image === "string" && it.image.startsWith("http")
          ? it.image
          : undefined;

      return {
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: finalUnitCents,
          product_data: {
            name,
            ...(imageUrl ? { images: [imageUrl] } : {}),
            metadata: {
              // ── Existing fields (kept for backward compat) ──
              kk_product_id: productId,
              kk_variant: variant,
              kk_order_id,

              kk_unit_price_cents: String(originalUnitCents),
              kk_post_discount_unit_price_cents: String(finalUnitCents),
              kk_item_weight_g: String(itemWeightG),
              ...(backOrderSkus.has(productId) ? { kk_back_order: "true" } : {}),

              // ── Phase 2: durable variant identity ──
              ...(resolvedVariantId ? { kk_variant_id: resolvedVariantId } : {}),
              ...(variantSku        ? { kk_variant_sku: variantSku }       : {}),
              ...(variantTitle      ? { kk_variant_title: variantTitle }    : {}),
              ...(selectedOptionsMeta ? { kk_selected_options: selectedOptionsMeta } : {}),
            },
          },
        },
      };
    });

    // Build shipping options based on cart value
    const shipping_options: Stripe.Checkout.SessionCreateParams.ShippingOption[] = [];
    
    // Check which Stripe shipping rates are configured AND valid
    const hasStandardRate = isValidShippingRateId(SHIPPING_RATES.STANDARD);
    const hasExpressRate = isValidShippingRateId(SHIPPING_RATES.EXPRESS);
    const hasFreeRate = isValidShippingRateId(SHIPPING_RATES.FREE);
    
    console.log("[create-checkout-session] Shipping rates check:", {
      STANDARD: SHIPPING_RATES.STANDARD ? `${SHIPPING_RATES.STANDARD.slice(0, 10)}... (valid: ${hasStandardRate})` : "(not set)",
      EXPRESS: SHIPPING_RATES.EXPRESS ? `${SHIPPING_RATES.EXPRESS.slice(0, 10)}... (valid: ${hasExpressRate})` : "(not set)",
      FREE: SHIPPING_RATES.FREE ? `${SHIPPING_RATES.FREE.slice(0, 10)}... (valid: ${hasFreeRate})` : "(not set)",
      qualifiesForFreeShipping,
      cartSubtotal,
    });
    
    // Use Stripe Dashboard rates if ALL needed rates are configured and valid
    // Otherwise, use inline shipping to ensure all options are available
    const useStripeRates = hasStandardRate && hasExpressRate && hasFreeRate;
    
    if (useStripeRates) {
      // Use pre-configured Stripe Dashboard rates
      if (qualifiesForFreeShipping && SHIPPING_RATES.FREE) {
        shipping_options.push({ shipping_rate: SHIPPING_RATES.FREE });
      }
      if (SHIPPING_RATES.STANDARD) {
        shipping_options.push({ shipping_rate: SHIPPING_RATES.STANDARD });
      }
      if (SHIPPING_RATES.EXPRESS) {
        shipping_options.push({ shipping_rate: SHIPPING_RATES.EXPRESS });
      }
    }

    // Always use inline shipping if not all Stripe rates are configured
    const useInlineShipping = !useStripeRates;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url,
      cancel_url,

      client_reference_id: kk_order_id,

      metadata: {
        kk_order_id,

        kk_coupon_code: promoCode,
        kk_savings_cents: String(savingsCents),
        kk_savings_code_cents: String(savingsCodeCents),
        kk_savings_auto_cents: String(savingsAutoCents),

        kk_promo_mode: promoMode,
        kk_promo_ids: metaStr(promoIdsCsv, 450),

        source: orderSource,
        shipping_type: orderShippingType,
        
        kk_free_shipping_applied: qualifiesForFreeShipping ? "true" : "false",
        kk_cart_subtotal_cents: String(cartSubtotalPaidCents),
      },

      customer_creation: "always",
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      
      // Use configured shipping rates OR inline options
      ...(useInlineShipping ? {
        shipping_options: [
          // Free shipping if qualified
          ...(qualifiesForFreeShipping ? [{
            shipping_rate_data: {
              type: "fixed_amount" as const,
              fixed_amount: { amount: 0, currency: "usd" },
              display_name: "Free Shipping",
              delivery_estimate: {
                minimum: { unit: "business_day" as const, value: 5 },
                maximum: { unit: "business_day" as const, value: 7 },
              },
            },
          }] : []),
          // Standard shipping
          {
            shipping_rate_data: {
              type: "fixed_amount" as const,
              fixed_amount: { amount: 895, currency: "usd" },
              display_name: "Standard Shipping",
              delivery_estimate: {
                minimum: { unit: "business_day" as const, value: 5 },
                maximum: { unit: "business_day" as const, value: 7 },
              },
            },
          },
          // Express shipping
          {
            shipping_rate_data: {
              type: "fixed_amount" as const,
              fixed_amount: { amount: 1299, currency: "usd" },
              display_name: "Express Shipping",
              delivery_estimate: {
                minimum: { unit: "business_day" as const, value: 2 },
                maximum: { unit: "business_day" as const, value: 3 },
              },
            },
          },
        ],
      } : {
        shipping_options,
      }),
    });

    // ── Mark review coupon as used ───────────────────────────
    if (reviewCouponId && session.id) {
      const { error: markErr } = await supabaseAdmin
        .from("review_coupons")
        .update({ used_at: new Date().toISOString(), used_order_id: session.id })
        .eq("id", reviewCouponId);

      if (markErr) {
        console.warn("[create-checkout-session] Could not mark review coupon as used:", markErr.message);
      } else {
        console.log(`[create-checkout-session] Review coupon ${promoCode} marked used for session ${session.id}`);
      }
    }

    return json({ url: session.url, kk_order_id });
  } catch (err) {
    console.error("[create-checkout-session] failed", err);
    
    // Log more details for debugging
    const errorDetails = {
      message: err instanceof Error ? err.message : "Unknown error",
      type: err instanceof Error ? err.constructor.name : typeof err,
      stack: err instanceof Error ? err.stack : undefined,
      // Include Stripe error details if available
      stripeCode: (err as any)?.code,
      stripeType: (err as any)?.type,
      stripeParam: (err as any)?.param,
    };
    console.error("[create-checkout-session] error details:", JSON.stringify(errorDetails));
    
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg, details: errorDetails }, 500);
  }
});
