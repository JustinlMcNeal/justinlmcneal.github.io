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

    // promo truth (since Stripe doesn’t discount for you)
    const promo = body?.promo ?? {};
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
      },

      customer_creation: "always",
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
    });

    return json({ url: session.url, kk_order_id });
  } catch (err) {
    console.error("[create-checkout-session] failed", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});
