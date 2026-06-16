// supabase/functions/stripe-webhook/index.ts
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  claimStripeInventoryDedup,
  DEDUP_CHECKOUT_RESERVE,
  DEDUP_CHECKOUT_STOCK_DEDUCT,
  decrementVariantStockForOrder,
  getKkReservationMode,
  resolveCheckoutLineVariant,
  upsertKkReservation,
} from "../_shared/stripeWebhookInventory.ts";
import { recordBundleReservationShadowsForCheckout } from "../_shared/bundleCheckoutShadow.ts";
import {
  isBundleLiveDeductionEnabled,
  reserveLiveBundleComponents,
} from "../_shared/bundleLiveInventory.ts";
import { handleChargeRefundedEvent } from "../_shared/stripeWebhookChargeRefunded.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeStr(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function safeInt(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normEmail(email: unknown) {
  const e = safeStr(email).trim().toLowerCase();
  return e.length ? e : null;
}

function normPhone(phone: unknown) {
  const p = safeStr(phone).trim();
  return p.length ? p : null;
}

function parseFirstLast(name: string | null) {
  const n = safeStr(name).trim();
  if (!n) return { first: null, last: null };

  if (n.includes(",")) {
    const [last, first] = n.split(",").map((x) => x.trim());
    return { first: first || null, last: last || null };
  }

  const parts = n.split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function toIsoFromStripeCreated(created?: number | null) {
  const ms = (created ?? Math.floor(Date.now() / 1000)) * 1000;
  return new Date(ms).toISOString();
}

type StripeAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

function pickBestAddress(
  a?: StripeAddress | null,
  b?: StripeAddress | null,
  c?: StripeAddress | null
): StripeAddress | null {
  const score = (x?: StripeAddress | null) => {
    if (!x) return 0;
    let s = 0;
    if (x.line1) s += 3;
    if (x.city) s += 1;
    if (x.state) s += 1;
    if (x.postal_code) s += 1;
    if (x.country) s += 1;
    return s;
  };
  const arr = [a, b, c];
  arr.sort((x, y) => score(y) - score(x));
  return arr[0] ?? null;
}

type ProductLookup = {
  price_cents: number;
  weight_g: number | null;
  product_uuid: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, stripe-signature",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
if (req.method === "GET") {
  return json({ ok: true, note: "Stripe webhook endpoint. Use POST." }, 200);
}

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceRole) {
      console.error("[stripe-webhook] missing env vars");
      return json({ error: "Server misconfigured" }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

    const signature = req.headers.get("stripe-signature");
    if (!signature) return json({ error: "Missing stripe-signature" }, 400);

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error("[stripe-webhook] signature verify failed", err);
      return json({ error: "Invalid signature" }, 400);
    }

    // ── Handle charge.refunded ──────────────────────────────────
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const result = await handleChargeRefundedEvent({
        sb: supabaseAdmin,
        stripe,
        event,
        charge,
      });
      return json(result.body, result.status);
    }

    // ── Ignore other event types ─────────────────────────────────
    if (event.type !== "checkout.session.completed") {
      return json({ received: true, ignored: true, type: event.type }, 200);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = safeStr(session.id).trim();
    if (!sessionId) return json({ error: "Missing session id" }, 400);

    // Retrieve session (do NOT expand shipping_details - not expandable)
    const fullSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer"],
    });

    // Line items: listLineItems is reliable and supports expand on product
    const liRes = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      expand: ["data.price.product"],
    });
    const items = liRes.data ?? [];

    const md: any = fullSession.metadata ?? {};

    const kk_order_id =
      safeStr(fullSession.client_reference_id).trim() ||
      safeStr(md.kk_order_id).trim() ||
      null;

    // Promo/savings from your metadata (your site is source of truth)
    const coupon_code_used = safeStr(md.kk_coupon_code).trim() || null;

    const order_savings_total_cents = Math.max(0, safeInt(md.kk_savings_cents, 0));
    const order_savings_code_cents = Math.max(0, safeInt(md.kk_savings_code_cents, 0));
    const order_savings_auto_cents = Math.max(0, safeInt(md.kk_savings_auto_cents, 0));

    // Stripe totals (paid)
    const tax_cents = fullSession.total_details?.amount_tax ?? 0;
    const shipping_paid_cents = fullSession.total_details?.amount_shipping ?? 0;
    const total_paid_cents = fullSession.amount_total ?? 0;

    // Customer/shipping details
    const customerDetails = fullSession.customer_details;
    const shippingDetails = fullSession.shipping_details;

    const customerName =
      safeStr(shippingDetails?.name).trim() ||
      safeStr(customerDetails?.name).trim() ||
      null;

    const { first: first_name, last: last_name } = parseFirstLast(customerName);

    const email = normEmail(customerDetails?.email);
    const phone_number = normPhone(customerDetails?.phone);

    const customerObj = fullSession.customer as Stripe.Customer | string | null;
    const stripe_customer_id =
      typeof customerObj !== "string" && customerObj?.id
        ? customerObj.id
        : safeStr(fullSession.customer).trim() || null;

    const customerAddr =
      typeof customerObj !== "string" && customerObj?.address ? customerObj.address : null;

    const bestAddr = pickBestAddress(
      shippingDetails?.address as any,
      customerDetails?.address as any,
      customerAddr as any
    );

    const street_address = bestAddr?.line1 ? safeStr(bestAddr.line1) : null;
    const city = bestAddr?.city ? safeStr(bestAddr.city) : null;
    const state = bestAddr?.state ? safeStr(bestAddr.state) : null;
    const zip = bestAddr?.postal_code ? safeStr(bestAddr.postal_code) : null;
    const country = bestAddr?.country ? safeStr(bestAddr.country) : null;

    const order_date = toIsoFromStripeCreated(fullSession.created);

    // ---- Build product lookup from Supabase (original price + weight) ----
    // SKU comes from Stripe Product metadata: kk_product_id
    const skus = Array.from(
      new Set(
        items
          .map((li) => {
            const price = li.price;
            const productObj = (price?.product ?? null) as Stripe.Product | string | null;
            const productMeta: any =
              typeof productObj !== "string" && productObj?.metadata ? productObj.metadata : {};
            const sku = safeStr(productMeta.kk_product_id).trim();
            return sku || "";
          })
          .filter(Boolean)
      )
    );

    const skuMap = new Map<string, ProductLookup>();

    if (skus.length) {
      const { data: prodRows, error: prodErr } = await supabaseAdmin
        .from("products")
        .select("id, code, price, weight_g")
        .in("code", skus);

      if (prodErr) {
        console.error("[stripe-webhook] products lookup failed", prodErr);
      } else {
        for (const p of prodRows || []) {
          const code = safeStr((p as any).code).trim();
          const productUuid = safeStr((p as any).id).trim();
          const priceNum = Number((p as any).price ?? 0);
          const weightNum = (p as any).weight_g == null ? null : Number((p as any).weight_g);

          const price_cents = Number.isFinite(priceNum) ? Math.round(priceNum * 100) : 0;
          const weight_g =
            weightNum == null ? null : Number.isFinite(weightNum) ? Math.round(weightNum) : null;

          if (code) skuMap.set(code, { price_cents, weight_g, product_uuid: productUuid });
        }
      }
    }

    // ---- Build line rows + compute order totals ----
    let subtotal_original_cents = 0;
    let subtotal_paid_cents = 0;
    let total_items = 0;
    let total_weight_g = 0;

    const lineRows = items.map((li) => {
      const price = li.price;

      const productObj = (price?.product ?? null) as Stripe.Product | string | null;
      const productMeta: any =
        typeof productObj !== "string" && productObj?.metadata ? productObj.metadata : {};

      const product_id = safeStr(productMeta.kk_product_id).trim() || null;
      const variant = safeStr(productMeta.kk_variant).trim() || null;

      // ── Phase 2: read durable variant identity from Stripe metadata ──
      const variant_id    = safeStr(productMeta.kk_variant_id).trim()    || null;
      const variant_sku   = safeStr(productMeta.kk_variant_sku).trim()   || null;
      const variant_title = safeStr(productMeta.kk_variant_title).trim() || null;
      // selected_options is stored as a JSON string in Stripe metadata
      let selected_options: Record<string, string> | null = null;
      const selectedOptionsStr = safeStr(productMeta.kk_selected_options).trim();
      if (selectedOptionsStr) {
        try {
          const parsed = JSON.parse(selectedOptionsStr);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            selected_options = parsed as Record<string, string>;
          }
        } catch {
          // Malformed JSON — leave null; don't block order processing
          console.warn("[stripe-webhook] kk_selected_options parse failed (non-fatal)");
        }
      }

      const quantity = Math.max(1, li.quantity ?? 1);

      // Paid total for this line from Stripe
      const linePaidTotal = li.amount_total ?? li.amount_subtotal ?? 0;
      const paid_unit = quantity > 0 ? Math.round(linePaidTotal / quantity) : 0;

      // Original unit price from Supabase products.price (fallback to paid_unit)
      const lookup = product_id ? skuMap.get(product_id) : null;
      const unit_price_cents =
        lookup?.price_cents != null && lookup.price_cents > 0 ? lookup.price_cents : paid_unit;

      const post_discount_unit_price_cents = paid_unit;

      const item_weight_g = lookup?.weight_g ?? null;

      const product_name =
        typeof productObj !== "string" && productObj?.name
          ? productObj.name
          : safeStr(li.description).trim() || null;

      subtotal_original_cents += unit_price_cents * quantity;
      subtotal_paid_cents += post_discount_unit_price_cents * quantity;

      total_items += quantity;

      const w = item_weight_g == null ? 0 : Math.max(0, Math.trunc(item_weight_g));
      total_weight_g += w * quantity;

      return {
        order_date,
        stripe_checkout_session_id: sessionId,
        stripe_line_item_id: safeStr(li.id).trim(),

        product_id,
        product_name,
        variant,

        // Phase 2: durable variant identity (nullable; absent for legacy sessions)
        variant_id,
        variant_sku,
        variant_title,
        selected_options,

        quantity,
        item_weight_g,

        unit_price_cents: Math.max(0, unit_price_cents),
        post_discount_unit_price_cents: Math.max(0, post_discount_unit_price_cents),
      };
    });

    // If metadata savings not provided, compute total savings from price difference
    const computedSavings = Math.max(0, subtotal_original_cents - subtotal_paid_cents);
    const final_order_savings_total_cents =
      order_savings_total_cents > 0 ? order_savings_total_cents : computedSavings;

    // ✅ 1) UPSERT orders_raw FIRST (FK target must exist)
    const orderRow = {
      stripe_checkout_session_id: sessionId,
      kk_order_id,
      stripe_customer_id,
      stripe_payment_intent_id: safeStr(fullSession.payment_intent).trim() || null,

      coupon_code_used,

      order_savings_total_cents: final_order_savings_total_cents,
      order_savings_code_cents: Math.max(0, order_savings_code_cents),
      order_savings_auto_cents: Math.max(0, order_savings_auto_cents),

      subtotal_original_cents: Math.max(0, subtotal_original_cents),
      subtotal_paid_cents: Math.max(0, subtotal_paid_cents),

      tax_cents: Math.max(0, tax_cents),
      shipping_paid_cents: Math.max(0, shipping_paid_cents),
      total_paid_cents: Math.max(0, total_paid_cents),

      // ✅ order-level computed totals
      total_items: Math.max(0, total_items),
      total_weight_g: Math.max(0, total_weight_g),

      first_name,
      last_name,
      email,
      phone_number,

      street_address,
      city,
      state,
      zip,
      country,

      order_date,
    };

    const { data: existingOrderBefore } = await supabaseAdmin
      .from("orders_raw")
      .select("coupon_code_used")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    const { error: oErr } = await supabaseAdmin
      .from("orders_raw")
      .upsert(orderRow, { onConflict: "stripe_checkout_session_id" });

    if (oErr) {
      console.error("[stripe-webhook] orders_raw upsert failed", oErr);
      return json({ error: "Failed to upsert order", detail: oErr }, 500);
    }

    // Promotion redemption accounting (idempotent across webhook retries)
    const shouldIncrementPromotionUsage = !!coupon_code_used
      && !coupon_code_used.startsWith("THANKS-")
      && (!existingOrderBefore || !existingOrderBefore.coupon_code_used);

    if (shouldIncrementPromotionUsage) {
      try {
        const { data: promo } = await supabaseAdmin
          .from("promotions")
          .select("id, usage_count, usage_limit")
          .eq("code", coupon_code_used)
          .maybeSingle();

        if (promo?.id) {
          const usageCount = Number(promo.usage_count || 0);
          const usageLimit = Number(promo.usage_limit || 0);
          const canIncrement = usageLimit <= 0 || usageCount < usageLimit;

          if (canIncrement) {
            await supabaseAdmin
              .from("promotions")
              .update({ usage_count: usageCount + 1, updated_at: new Date().toISOString() })
              .eq("id", promo.id);
          }
        }
      } catch (promoUsageErr) {
        console.error("[stripe-webhook] promotion usage increment failed (non-fatal):", promoUsageErr);
      }
    }

    // ── SMS Attribution ──────────────────────────────────────
    // Check if this order should be attributed to SMS marketing
    try {
      let smsAttributed = false;
      let smsSendId: string | null = null;
      let smsClickAt: string | null = null;

      // Method 1: Direct attribution — coupon code starts with "SMS-" or "VIP-"
      if (coupon_code_used && (coupon_code_used.startsWith("SMS-") || coupon_code_used.startsWith("VIP-"))) {
        smsAttributed = true;

        // Find the sms_send that delivered this coupon
        const { data: contact } = await supabaseAdmin
          .from("customer_contacts")
          .select("id")
          .eq("coupon_code", coupon_code_used)
          .maybeSingle();

        if (contact) {
          const sendFlow = coupon_code_used.startsWith("VIP-") ? "upgrade" : "signup";
          const { data: send } = await supabaseAdmin
            .from("sms_sends")
            .select("id")
            .eq("contact_id", contact.id)
            .eq("flow", sendFlow)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (send) smsSendId = send.id;
        }
      }

      // Method 2: Click-based attribution — phone matches a contact who clicked within 48h
      if (!smsAttributed && phone_number) {
        const normalizedPhone = phone_number.replace(/\D/g, "");
        let e164Phone = "";
        if (normalizedPhone.length === 10) e164Phone = `+1${normalizedPhone}`;
        else if (normalizedPhone.length === 11 && normalizedPhone.startsWith("1")) e164Phone = `+${normalizedPhone}`;

        if (e164Phone) {
          const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
          const { data: clickEvent } = await supabaseAdmin
            .from("sms_events")
            .select("id, sms_send_id, created_at")
            .eq("phone", e164Phone)
            .eq("event_type", "sms_clicked")
            .gte("created_at", fortyEightHoursAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (clickEvent) {
            smsAttributed = true;
            smsSendId = clickEvent.sms_send_id;
            smsClickAt = clickEvent.created_at;
          }
        }
      }

      // Update order with attribution data
      if (smsAttributed) {
        await supabaseAdmin
          .from("orders_raw")
          .update({
            sms_attributed: true,
            sms_send_id: smsSendId,
            sms_click_at: smsClickAt,
          })
          .eq("stripe_checkout_session_id", sessionId);

        // Log attribution event
        const orderPhone = phone_number ? (
          phone_number.replace(/\D/g, "").length === 10
            ? `+1${phone_number.replace(/\D/g, "")}`
            : phone_number.replace(/\D/g, "").length === 11
              ? `+${phone_number.replace(/\D/g, "")}`
              : phone_number
        ) : null;

        await supabaseAdmin.from("sms_events").insert({
          event_type:  "order_attributed",
          phone:       orderPhone,
          sms_send_id: smsSendId,
          metadata: {
            order_id: kk_order_id,
            session_id: sessionId,
            coupon_code: coupon_code_used,
            total_paid_cents,
            attribution_method: (coupon_code_used?.startsWith("SMS-") || coupon_code_used?.startsWith("VIP-")) ? "coupon" : "click_window",
          },
        });

        // Update sms_sends outcome to converted
        if (smsSendId) {
          await supabaseAdmin
            .from("sms_sends")
            .update({ outcome: "converted", converted_at: new Date().toISOString() })
            .eq("id", smsSendId);
        }

        // Log coupon redemption event if SMS or VIP coupon
        if (coupon_code_used?.startsWith("SMS-") || coupon_code_used?.startsWith("VIP-")) {
          await supabaseAdmin.from("sms_events").insert({
            event_type:  "coupon_redeemed",
            phone:       orderPhone,
            sms_send_id: smsSendId,
            metadata: {
              coupon_code: coupon_code_used,
              order_id: kk_order_id,
              total_paid_cents,
            },
          });
        }

        console.log(`[stripe-webhook] SMS attribution: order ${kk_order_id} attributed to SMS (method: ${(coupon_code_used?.startsWith("SMS-") || coupon_code_used?.startsWith("VIP-")) ? "coupon" : "click_window"}, send: ${smsSendId})`);  
      }
    } catch (smsErr) {
      console.error("[stripe-webhook] SMS attribution failed (non-fatal):", smsErr);
    }

    // ── Mark any active saved_carts as purchased ────────────
    try {
      const orderPhone = phone_number ? (
        phone_number.replace(/\D/g, "").length === 10
          ? `+1${phone_number.replace(/\D/g, "")}`
          : phone_number.replace(/\D/g, "").length === 11
            ? `+${phone_number.replace(/\D/g, "")}`
            : phone_number
      ) : null;

      if (orderPhone) {
        await supabaseAdmin
          .from("saved_carts")
          .update({ status: "purchased", purchased_at: new Date().toISOString() })
          .eq("phone", orderPhone)
          .eq("status", "active");
      }
    } catch (cartErr) {
      console.error("[stripe-webhook] Cart status update failed (non-fatal):", cartErr);
    }

// ✅ 1.5) Ensure fulfillment row exists (idempotent; do NOT overwrite status)
const fulfillmentRow = {
  stripe_checkout_session_id: sessionId,
  kk_order_id: kk_order_id ?? sessionId, // keep NOT NULL happy
  label_status: "pending",
};

const { error: fErr } = await supabaseAdmin
  .from("fulfillment_shipments")
  .upsert(fulfillmentRow, {
    onConflict: "stripe_checkout_session_id",
    ignoreDuplicates: true, // <-- key part: inserts if missing, does nothing if exists
  });

if (fErr) {
  console.error("[stripe-webhook] fulfillment_shipments ensure failed", fErr);
  // non-fatal: order + items are still valid
}


    // ✅ 2) UPSERT line_items_raw SECOND
    const { error: liErr } = await supabaseAdmin
      .from("line_items_raw")
      .upsert(lineRows, { onConflict: "stripe_checkout_session_id,stripe_line_item_id" });

    if (liErr) {
      console.error("[stripe-webhook] line_items_raw upsert failed", liErr);
      return json({ error: "Failed to upsert line items", detail: liErr }, 500);
    }

    // ✅ 2.5) Inventory — mode-aware (legacy deduct / shadow / reserve-only)
    try {
      const kkMode = await getKkReservationMode(supabaseAdmin);
      const checkoutDedupAction = kkMode === "reserve_only"
        ? DEDUP_CHECKOUT_RESERVE
        : DEDUP_CHECKOUT_STOCK_DEDUCT;

      const inventoryDedup = await claimStripeInventoryDedup(
        supabaseAdmin,
        event.id,
        checkoutDedupAction,
        sessionId,
      );

      if (!inventoryDedup.claimed) {
        console.log(
          `[stripe-webhook] checkout inventory dedup skip event=${event.id} session=${sessionId} mode=${kkMode}`,
        );
      }

      for (const row of lineRows) {
        const sku = row.product_id;
        const variantName = row.variant;
        const qty = row.quantity || 1;
        const lineItemId = safeStr(row.stripe_line_item_id).trim();

        if (!sku && !row.variant_id) continue;

        const variantRow = await resolveCheckoutLineVariant(supabaseAdmin, row, skuMap);
        if (!variantRow) continue;

        const productUuid = variantRow.product_id || (sku ? skuMap.get(sku)?.product_uuid : null) || "";

        if (kkMode === "reserve_only") {
          if (lineItemId && variantRow.product_id) {
            try {
              const liveBundle = await isBundleLiveDeductionEnabled(
                supabaseAdmin,
                variantRow.id,
              );
              if (liveBundle) {
                const liveReserve = await reserveLiveBundleComponents(supabaseAdmin, {
                  orderId: sessionId,
                  orderItemId: lineItemId,
                  bundleVariantId: variantRow.id,
                  quantity: qty,
                });
                if (liveReserve.reservedComponents && liveReserve.reservedComponents > 0) {
                  console.log(
                    `[stripe-webhook] live bundle components reserved: ${sessionId}/${lineItemId} components=${liveReserve.reservedComponents}`,
                  );
                }
                if (liveReserve.failedComponents && liveReserve.failedComponents > 0) {
                  console.error(
                    `[stripe-webhook] live bundle component shortage: ${sessionId}/${lineItemId}`,
                    liveReserve.issues,
                  );
                }
                continue;
              }

              const reservation = await upsertKkReservation(supabaseAdmin, {
                orderId: sessionId,
                orderItemId: lineItemId,
                variantId: variantRow.id,
                productId: variantRow.product_id,
                quantity: qty,
                sourceReference: sessionId,
                isShadow: false,
              });
              if (reservation.inserted) {
                console.log(
                  `[stripe-webhook] active reservation: ${sessionId}/${lineItemId} qty=${qty}`,
                );
              }
            } catch (reserveErr) {
              console.error("[stripe-webhook] active reservation failed (non-fatal):", reserveErr);
            }
          }
          continue;
        }

        if (inventoryDedup.claimed && kkMode !== "reserve_only") {
          try {
            await decrementVariantStockForOrder(
              supabaseAdmin,
              variantRow,
              qty,
              kk_order_id || sessionId,
              productUuid,
            );
            console.log(
              `[stripe-webhook] stock: ${sku || row.variant_id}/${variantName} (-${qty}) mode=${kkMode}`,
            );
          } catch (decrementErr) {
            console.error(
              `[stripe-webhook] stock decrement failed for variant ${variantRow.id}:`,
              decrementErr,
            );
            continue;
          }
        }

        if (kkMode === "shadow" && lineItemId && variantRow.product_id) {
          try {
            const shadow = await upsertKkReservation(supabaseAdmin, {
              orderId: sessionId,
              orderItemId: lineItemId,
              variantId: variantRow.id,
              productId: variantRow.product_id,
              quantity: qty,
              sourceReference: sessionId,
              isShadow: true,
            });
            if (shadow.inserted) {
              console.log(`[stripe-webhook] shadow reservation: ${sessionId}/${lineItemId} qty=${qty}`);
            }
          } catch (shadowErr) {
            console.error("[stripe-webhook] shadow reservation failed (non-fatal):", shadowErr);
          }
        }
      }
    } catch (stockErr) {
      console.error("[stripe-webhook] checkout inventory failed (non-fatal):", stockErr);
    }

    // ✅ 2.6) Virtual bundle checkout shadow (Phase 10D — log only, never mutates inventory)
    try {
      const bundleShadow = await recordBundleReservationShadowsForCheckout(supabaseAdmin, {
        sessionId,
        kkOrderId: kk_order_id,
        lineRows,
        resolveVariant: (sb, row) => resolveCheckoutLineVariant(sb, row, skuMap),
      });
      if (bundleShadow.inserted > 0 || bundleShadow.errors > 0) {
        console.log(
          `[stripe-webhook] bundle shadow: attempted=${bundleShadow.attempted} inserted=${bundleShadow.inserted} skipped=${bundleShadow.skipped} errors=${bundleShadow.errors}`,
        );
      }
    } catch (bundleShadowErr) {
      console.error("[stripe-webhook] bundle checkout shadow failed (non-fatal):", bundleShadowErr);
    }

    // ✅ 3) Send push notification to admin about new order (fire-and-forget)
    try {
      const orderTotal = `$${(total_paid_cents / 100).toFixed(2)}`;
      const itemSummary = total_items === 1 ? "1 item" : `${total_items} items`;
      const custName = first_name ? `${first_name}${last_name ? ' ' + last_name : ''}` : (email || 'A customer');

      fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceRole}`,
        },
        body: JSON.stringify({
          title: `🛒 New Order — ${orderTotal}`,
          body: `${custName} just ordered ${itemSummary}!`,
          url: "/pages/admin/lineItemsOrders.html",
          tag: `order-${sessionId.slice(0, 8)}`,
          target: "admin",
        }),
      }).catch((pushErr) => {
        console.error("[stripe-webhook] push notification failed (non-fatal):", pushErr);
      });
    } catch (pushErr) {
      console.error("[stripe-webhook] push notification setup failed (non-fatal):", pushErr);
    }

    return json(
      {
        received: true,
        sessionId,
        kk_order_id,
        orderRowWritten: true,
        fulfillmentRowEnsured: true,
        lineItemsWritten: lineRows.length,
        subtotal_original_cents,
        subtotal_paid_cents,
        computedSavings,
        total_items,
        total_weight_g,
      },
      200
    );
  } catch (err) {
    console.error("[stripe-webhook] processing failed", err);
    return json({ error: "Processing failed" }, 500);
  }
});
