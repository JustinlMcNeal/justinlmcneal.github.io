// supabase/functions/create-checkout-session/index.ts
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    // Calculate cart subtotal (after discounts)
    const cartSubtotal = items.reduce((sum: number, it: any) => {
      const price = Number(it?.discounted_price ?? it?.price ?? 0);
      const qty = Math.max(1, Number(it?.qty || 1));
      return sum + (price * qty);
    }, 0);

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
    const hasFreeShippingCoupon = couponType === "free_shipping" || couponType === "free-shipping";

    // Qualifies if: (a) cart meets threshold OR (b) has free_shipping coupon applied
    const qualifiesForFreeShipping = 
      (freeShippingEnabled && cartSubtotal >= freeShippingThreshold) || 
      hasFreeShippingCoupon;

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
    const promoCode = metaStr(promo?.code || "", 80);
    const savingsCents = Math.max(0, safeInt(promo?.savings_cents, 0));
    const savingsCodeCents = Math.max(0, safeInt(promo?.savings_code_cents, 0));
    const savingsAutoCents = Math.max(0, safeInt(promo?.savings_auto_cents, 0));

    const appliedIds = Array.isArray(promo?.applied_ids)
      ? promo.applied_ids.map((x: any) => metaStr(x, 80)).filter(Boolean)
      : [];

    const promoMode = promoCode ? "code" : (savingsCents > 0 ? "auto" : "none");
    const promoIdsCsv = appliedIds.slice(0, 20).join(",");

    // ✅ weight lookup from products table by SKU code
    const skus = uniqStrings(items.map((it: any) => it?.product_id || it?.id || ""));
    const weightMap = new Map<string, number>();

    if (skus.length) {
      const { data, error } = await supabaseAdmin
        .from("products")
        .select("code, weight_g")
        .in("code", skus);

      if (error) {
        console.error("[create-checkout-session] weight lookup failed", error);
      } else {
        for (const row of data || []) {
          const code = String((row as any).code ?? "").trim();
          const w = Number((row as any).weight_g ?? 0);
          if (code) weightMap.set(code, Number.isFinite(w) ? Math.max(0, Math.round(w)) : 0);
        }
      }
    }

    // ✅ Stripe line items
    const line_items = items.map((it: any) => {
      const productId = metaStr(it?.product_id || it?.id || "", 80); // SKU
      const name = metaStr(it?.name || "Item", 200);
      const variant = metaStr(it?.variant || "", 120);

      const qty = Math.max(1, Number(it?.qty || 1));

      const originalUnit = Number(it?.price ?? 0);
      const finalUnit = Number(it?.discounted_price ?? it?.price ?? 0);

      if (!Number.isFinite(finalUnit) || finalUnit <= 0) {
        throw new Error(`Invalid final unit price for ${productId}: ${finalUnit}`);
      }
      if (!Number.isFinite(originalUnit) || originalUnit < 0) {
        throw new Error(`Invalid original unit price for ${productId}: ${originalUnit}`);
      }

      const originalUnitCents = toCents(originalUnit);
      const finalUnitCents = toCents(finalUnit);

      const itemWeightG = weightMap.get(productId) ?? 0;

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
            // ✅ THIS IS ALLOWED
            metadata: {
              kk_product_id: productId,
              kk_variant: variant,
              kk_order_id,

              kk_unit_price_cents: String(originalUnitCents),
              kk_post_discount_unit_price_cents: String(finalUnitCents),
              kk_item_weight_g: String(itemWeightG),
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
        kk_cart_subtotal_cents: String(toCents(cartSubtotal)),
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
              fixed_amount: { amount: 599, currency: "usd" },
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
