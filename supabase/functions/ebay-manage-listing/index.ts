// ebay-manage-listing — Unified handler for eBay Inventory API operations
// Actions: create_item, create_offer, publish, update_item, update_offer,
//          withdraw, delete_item, get_item, list_items, get_offers, bulk_update, get_policies, setup_location
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  getAccessToken,
  EBAY_API,
} from "../_shared/ebayUtils.ts";

const INV_API = `${EBAY_API}/sell/inventory/v1`;
const ACCT_API = `${EBAY_API}/sell/account/v1`;
const MKTG_API = `${EBAY_API}/sell/marketing/v1`;

/** Make an authenticated request to eBay Inventory/Account API */
async function ebayFetch(
  token: string,
  method: string,
  url: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; headers: Headers }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Language": "en-US",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Language"] = "en-US";
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Some endpoints return 204 No Content on success (PUT inventory_item)
  if (resp.status === 204) {
    return { ok: true, status: 204, data: null, headers: resp.headers };
  }

  const text = await resp.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawResponse: text.slice(0, 500) };
  }

  if (!resp.ok) {
    console.error(`[ebay-listing] ${method} ${url} → ${resp.status}:`, text.slice(0, 500));
  }

  return { ok: resp.ok, status: resp.status, data, headers: resp.headers };
}

// Detects eBay eventual-consistency errors: 25604 (Product not found at publish) and 25709 (Invalid InventoryItemBundleKey)
function isEbayProductNotFoundPublishError(data: unknown): boolean {
  const payload = data as { errors?: Array<{ errorId?: number }> } | null;
  return Boolean(payload?.errors?.some((e) => e?.errorId === 25604 || e?.errorId === 25709));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();
    const accessToken = await getAccessToken(supabase);
    const body = await req.json();
    const { action } = body;

    // ── DELETE INVENTORY ITEM ─────────────────────────────
    if (action === "delete_item") {
      const { sku } = body;
      if (!sku) throw new Error("sku is required");
      const result = await ebayFetch(accessToken, "DELETE", `${INV_API}/inventory_item/${encodeURIComponent(sku)}`);
      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete item failed (${result.status}): ${JSON.stringify(result.data)}`);
      }
      await supabase.from("products").update({
        ebay_sku: null, ebay_offer_id: null, ebay_listing_id: null,
        ebay_status: "not_listed", ebay_category_id: null, ebay_price_cents: null,
        ebay_item_group_key: null,
        updated_at: new Date().toISOString(),
      }).eq("code", sku);
      return new Response(JSON.stringify({ success: true, deleted: sku }), { headers: corsHeaders });
    }

    // ── GET SINGLE INVENTORY ITEM ───────────────────────────
    if (action === "get_item") {
      const { sku } = body;
      if (!sku) throw new Error("sku is required");
      const result = await ebayFetch(accessToken, "GET", `${INV_API}/inventory_item/${encodeURIComponent(sku)}`);
      if (!result.ok) {
        throw new Error(`Get item failed (${result.status}): ${JSON.stringify(result.data)}`);
      }
      return new Response(JSON.stringify({ success: true, item: result.data }), { headers: corsHeaders });
    }

    // ── CREATE / UPDATE INVENTORY ITEM ──────────────────────
    if (action === "create_item" || action === "update_item") {
      const { sku, product, packageWeightAndSize } = body;
      if (!sku) throw new Error("sku is required");

      // product = { title, description, imageUrls[], aspects{}, condition, quantity, lotSize }
      const invItem: Record<string, unknown> = {
        condition: product.condition || "NEW",
        availability: {
          shipToLocationAvailability: {
            quantity: product.quantity ?? 0,
          },
        },
        product: {
          title: product.title,
          description: product.description || "",
          imageUrls: product.imageUrls || [],
          aspects: product.aspects || {},
        },
      };

      if (product.lotSize && product.lotSize > 1) {
        invItem.lotSize = product.lotSize;
      }

      if (packageWeightAndSize) {
        invItem.packageWeightAndSize = packageWeightAndSize;
      }

      // PUT /inventory_item/{sku} — creates or replaces
      const result = await ebayFetch(
        accessToken,
        "PUT",
        `${INV_API}/inventory_item/${encodeURIComponent(sku)}`,
        invItem
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Create inventory item failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      // Update products table
      await supabase
        .from("products")
        .update({
          ebay_sku: sku,
          ebay_status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("code", sku);

      return new Response(
        JSON.stringify({ success: true, sku, action }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE OFFER ────────────────────────────────────────
    if (action === "create_offer") {
      const { sku, categoryId, priceCents, quantity, policies, bestOfferTerms, storeCategoryNames } = body;
      if (!sku || !categoryId) throw new Error("sku and categoryId are required");

      const priceValue = ((priceCents || 0) / 100).toFixed(2);

      const offer: Record<string, unknown> = {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: quantity ?? 1,
        categoryId,
        pricingSummary: {
          price: { value: priceValue, currency: "USD" },
        },
        listingPolicies: {
          fulfillmentPolicyId: policies?.fulfillmentPolicyId || Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") || "",
          returnPolicyId: policies?.returnPolicyId || Deno.env.get("EBAY_RETURN_POLICY_ID") || "",
          paymentPolicyId: policies?.paymentPolicyId || Deno.env.get("EBAY_PAYMENT_POLICY_ID") || "",
        },
        merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") || "default",
      };

      if (bestOfferTerms?.bestOfferEnabled) {
        (offer.listingPolicies as Record<string, unknown>).bestOfferTerms = {
          bestOfferEnabled: true,
          ...(bestOfferTerms.autoAcceptPrice ? { autoAcceptPrice: { value: bestOfferTerms.autoAcceptPrice, currency: "USD" } } : {}),
          ...(bestOfferTerms.autoDeclinePrice ? { autoDeclinePrice: { value: bestOfferTerms.autoDeclinePrice, currency: "USD" } } : {}),
        };
      }

      if (storeCategoryNames?.length) {
        offer.storeCategoryNames = storeCategoryNames;
      }

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer`,
        offer
      );

      if (!result.ok) {
        throw new Error(`Create offer failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const offerId = (result.data as Record<string, string>)?.offerId;

      // Update products table with offer ID and price
      await supabase
        .from("products")
        .update({
          ebay_offer_id: offerId,
          ebay_category_id: categoryId,
          ebay_price_cents: priceCents,
          updated_at: new Date().toISOString(),
        })
        .eq("code", sku);

      return new Response(
        JSON.stringify({ success: true, offerId }),
        { headers: corsHeaders }
      );
    }

    // ── PUBLISH OFFER ───────────────────────────────────────
    if (action === "publish") {
      const { offerId, sku } = body;
      if (!offerId) throw new Error("offerId is required");

      let result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/${offerId}/publish`,
        {}
      );

      // eBay can intermittently return API_INVENTORY 25604 immediately after item/offer creation.
      // Retry briefly to handle eventual consistency on their side.
      if (!result.ok && result.status === 500 && isEbayProductNotFoundPublishError(result.data)) {
        for (const waitMs of [1500, 3000, 5000]) {
          await delay(waitMs);
          result = await ebayFetch(
            accessToken,
            "POST",
            `${INV_API}/offer/${offerId}/publish`,
            {}
          );
          if (result.ok) break;
          if (!(result.status === 500 && isEbayProductNotFoundPublishError(result.data))) break;
        }
      }

      if (!result.ok) {
        throw new Error(`Publish failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const listingId = (result.data as Record<string, string>)?.listingId;

      // Update products table
      if (sku) {
        await supabase
          .from("products")
          .update({
            ebay_listing_id: listingId,
            ebay_status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, listingId }),
        { headers: corsHeaders }
      );
    }

    // ── PUBLISH OFFER BY INVENTORY ITEM GROUP ───────────────
    if (action === "publish_group") {
      const { inventoryItemGroupKey, sku } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      let result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/publish_by_inventory_item_group`,
        { inventoryItemGroupKey, marketplaceId: "EBAY_US" }
      );

      // Retry briefly for eBay eventual consistency windows.
      if (!result.ok && isEbayProductNotFoundPublishError(result.data)) {
        for (const waitMs of [1500, 3000, 5000]) {
          await delay(waitMs);
          result = await ebayFetch(
            accessToken,
            "POST",
            `${INV_API}/offer/publish_by_inventory_item_group`,
            { inventoryItemGroupKey, marketplaceId: "EBAY_US" }
          );
          if (result.ok) break;
          if (!isEbayProductNotFoundPublishError(result.data)) break;
        }
      }

      if (!result.ok) {
        throw new Error(`Publish group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const listingId = (result.data as Record<string, unknown>)?.listingId as string | undefined;

      if (sku) {
        await supabase
          .from("products")
          .update({
            ebay_listing_id: listingId || null,
            ebay_status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, listingId: listingId || null, data: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── UPDATE OFFER (price, quantity) ──────────────────────
    if (action === "update_offer") {
      const { offerId, sku, priceCents, quantity, categoryId, policies, bestOfferTerms, storeCategoryNames } = body;
      if (!offerId) throw new Error("offerId is required");

      // First GET current offer to preserve fields we're not changing
      const current = await ebayFetch(accessToken, "GET", `${INV_API}/offer/${offerId}`);
      if (!current.ok) {
        throw new Error(`Get offer failed (${current.status}): ${JSON.stringify(current.data)}`);
      }

      const existing = current.data as Record<string, unknown>;
      const updatedOffer: Record<string, unknown> = {
        ...existing,
        availableQuantity: quantity ?? existing.availableQuantity,
        categoryId: categoryId || existing.categoryId,
      };

      if (priceCents !== undefined) {
        updatedOffer.pricingSummary = {
          price: {
            value: (priceCents / 100).toFixed(2),
            currency: "USD",
          },
        };
      }

      if (policies) {
        updatedOffer.listingPolicies = {
          ...(existing.listingPolicies as Record<string, unknown> || {}),
          ...policies,
        };
      }

      if (bestOfferTerms !== undefined) {
        const lp = (updatedOffer.listingPolicies || existing.listingPolicies || {}) as Record<string, unknown>;
        if (bestOfferTerms.bestOfferEnabled) {
          lp.bestOfferTerms = {
            bestOfferEnabled: true,
            ...(bestOfferTerms.autoAcceptPrice ? { autoAcceptPrice: { value: bestOfferTerms.autoAcceptPrice, currency: "USD" } } : {}),
            ...(bestOfferTerms.autoDeclinePrice ? { autoDeclinePrice: { value: bestOfferTerms.autoDeclinePrice, currency: "USD" } } : {}),
          };
        } else {
          lp.bestOfferTerms = { bestOfferEnabled: false };
        }
        updatedOffer.listingPolicies = lp;
      }

      if (storeCategoryNames?.length) {
        updatedOffer.storeCategoryNames = storeCategoryNames;
      } else if (storeCategoryNames !== undefined) {
        updatedOffer.storeCategoryNames = [];
      }

      const result = await ebayFetch(
        accessToken,
        "PUT",
        `${INV_API}/offer/${offerId}`,
        updatedOffer
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Update offer failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      // Update local DB
      if (sku) {
        const updates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (priceCents !== undefined) updates.ebay_price_cents = priceCents;
        if (categoryId) updates.ebay_category_id = categoryId;
        await supabase.from("products").update(updates).eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, offerId }),
        { headers: corsHeaders }
      );
    }

    // ── WITHDRAW (end listing) ──────────────────────────────
    if (action === "withdraw") {
      const { offerId, sku } = body;
      if (!offerId) throw new Error("offerId is required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/${offerId}/withdraw`,
        {}
      );

      if (!result.ok) {
        throw new Error(`Withdraw failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      if (sku) {
        await supabase
          .from("products")
          .update({
            ebay_status: "ended",
            updated_at: new Date().toISOString(),
          })
          .eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, withdrawn: true }),
        { headers: corsHeaders }
      );
    }

    // ── WITHDRAW BY INVENTORY ITEM GROUP (variation listing) ─
    if (action === "withdraw_group") {
      const { inventoryItemGroupKey, sku } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/withdraw_by_inventory_item_group`,
        {
          inventoryItemGroupKey,
          marketplaceId: "EBAY_US",
        }
      );

      if (!result.ok) {
        throw new Error(`Withdraw group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      if (sku) {
        await supabase
          .from("products")
          .update({
            ebay_status: "ended",
            updated_at: new Date().toISOString(),
          })
          .eq("code", sku);
      }

      return new Response(
        JSON.stringify({ success: true, withdrawn: true }),
        { headers: corsHeaders }
      );
    }

    // ── DELETE OFFER (cleanup stale/unpublished offers) ───
    if (action === "delete_offer") {
      const { offerId } = body;
      if (!offerId) throw new Error("offerId is required");

      const result = await ebayFetch(
        accessToken,
        "DELETE",
        `${INV_API}/offer/${offerId}`,
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete offer failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, deleted: true, offerId }),
        { headers: corsHeaders }
      );
    }

    // ── LIST INVENTORY ITEMS ────────────────────────────────
    if (action === "list_items") {
      const limit = body.limit || 100;
      const offset = body.offset || 0;

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/inventory_item?limit=${limit}&offset=${offset}`
      );

      if (!result.ok) {
        throw new Error(`List items failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, ...(result.data as Record<string, unknown>) }),
        { headers: corsHeaders }
      );
    }

    // ── GET OFFERS FOR SKU ──────────────────────────────────
    if (action === "get_offers") {
      const { sku, inventoryItemGroupKey, limit, offset } = body;
      const qp = new URLSearchParams();
      if (sku) qp.set("sku", String(sku));
      if (inventoryItemGroupKey) qp.set("inventory_item_group_key", String(inventoryItemGroupKey));
      if (limit) qp.set("limit", String(limit));
      if (offset) qp.set("offset", String(offset));

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/offer${qp.toString() ? `?${qp.toString()}` : ""}`
      );

      if (!result.ok) {
        throw new Error(`Get offers failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, ...(result.data as Record<string, unknown>) }),
        { headers: corsHeaders }
      );
    }

    // ── BULK UPDATE PRICE/QUANTITY ──────────────────────────
    if (action === "bulk_update") {
      const { items } = body;
      if (!items?.length) throw new Error("items array is required");

      // items = [{ sku, priceCents, quantity }]
      const requests = items.map((item: Record<string, unknown>) => {
        const req: Record<string, unknown> = {
          sku: item.sku,
          shipToLocationAvailability: {
            quantity: item.quantity ?? 0,
          },
        };
        if (item.priceCents) {
          req.offers = [
            {
              offerId: item.offerId,
              availableQuantity: item.quantity ?? 0,
              price: {
                value: ((item.priceCents as number) / 100).toFixed(2),
                currency: "USD",
              },
            },
          ];
        }
        return req;
      });

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/bulk_update_price_quantity`,
        { requests }
      );

      if (!result.ok) {
        throw new Error(`Bulk update failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, responses: (result.data as Record<string, unknown>)?.responses }),
        { headers: corsHeaders }
      );
    }

    // ── GET FULFILLMENT/RETURN/PAYMENT POLICIES ─────────────
    if (action === "get_policies") {
      const results: Record<string, unknown> = {};
      const errors: Record<string, unknown> = {};

      for (const type of ["fulfillment_policy", "return_policy", "payment_policy"]) {
        const resp = await ebayFetch(
          accessToken,
          "GET",
          `${ACCT_API}/${type}?marketplace_id=EBAY_US`
        );
        if (resp.ok) {
          results[type] = resp.data;
        } else {
          errors[type] = { status: resp.status, data: resp.data };
        }
      }

      return new Response(
        JSON.stringify({ success: true, policies: results, ...(Object.keys(errors).length ? { errors } : {}) }),
        { headers: corsHeaders }
      );
    }

    // ── OPT IN TO BUSINESS POLICIES ────────────────────────
    if (action === "opt_in_policies") {
      const result = await ebayFetch(
        accessToken,
        "POST",
        `${ACCT_API}/program/opt_in`,
        { programType: "SELLING_POLICY_MANAGEMENT" }
      );
      return new Response(
        JSON.stringify({ success: result.ok, status: result.status, data: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE DEFAULT BUSINESS POLICIES ─────────────────────
    if (action === "create_default_policies") {
      const created: Record<string, unknown> = {};
      const errs: Record<string, unknown> = {};

      // 1. Fulfillment policy — Economy Shipping via USPS, 1-3 day handling
      const fulfillment = await ebayFetch(accessToken, "POST", `${ACCT_API}/fulfillment_policy`, {
        name: "Standard Shipping",
        description: "Economy shipping via USPS, 1-3 business day handling",
        marketplaceId: "EBAY_US",
        handlingTime: { value: 3, unit: "DAY" },
        shippingOptions: [{
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [{
            shippingServiceCode: "USPSFirstClass",
            shippingCost: { value: "0.00", currency: "USD" },
            additionalShippingCost: { value: "0.00", currency: "USD" },
            freeShipping: true,
            sortOrder: 1,
            buyerResponsibleForShipping: false,
          }],
        }],
      });
      if (fulfillment.ok) created.fulfillment = fulfillment.data;
      else errs.fulfillment = { status: fulfillment.status, data: fulfillment.data };

      // 2. Return policy — 30-day returns, buyer pays return shipping
      const returns = await ebayFetch(accessToken, "POST", `${ACCT_API}/return_policy`, {
        name: "30-Day Returns",
        description: "30-day returns accepted, buyer pays return shipping",
        marketplaceId: "EBAY_US",
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
      });
      if (returns.ok) created.returns = returns.data;
      else errs.returns = { status: returns.status, data: returns.data };

      // 3. Payment policy — immediate payment (eBay managed payments)
      const payment = await ebayFetch(accessToken, "POST", `${ACCT_API}/payment_policy`, {
        name: "Immediate Payment",
        description: "Immediate payment required",
        marketplaceId: "EBAY_US",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        immediatePay: true,
      });
      if (payment.ok) created.payment = payment.data;
      else errs.payment = { status: payment.status, data: payment.data };

      return new Response(
        JSON.stringify({ success: Object.keys(errs).length === 0, created, ...(Object.keys(errs).length ? { errors: errs } : {}) }),
        { headers: corsHeaders }
      );
    }

    // ── SETUP INVENTORY LOCATION ────────────────────────────
    if (action === "setup_location") {
      const supabase2 = createServiceClient();
      const { data: setting } = await supabase2
        .from("site_settings")
        .select("value")
        .eq("key", "ship_from_address")
        .single();

      const addr = setting?.value;
      if (!addr) throw new Error("No ship_from_address in site_settings");

      const locationKey = body.locationKey || "default";

      const location = {
        location: {
          address: {
            addressLine1: addr.street1,
            city: addr.city,
            stateOrProvince: addr.state,
            postalCode: addr.zip,
            country: addr.country || "US",
          },
        },
        name: addr.name || "Karry Kraze",
        merchantLocationStatus: "ENABLED",
        locationTypes: ["WAREHOUSE"],
      };

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/location/${encodeURIComponent(locationKey)}`,
        location
      );

      // 204 = created, 200 = ok, 409 = already exists (all fine)
      if (!result.ok && result.status !== 204 && result.status !== 409) {
        throw new Error(`Setup location failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, locationKey }),
        { headers: corsHeaders }
      );
    }

    // ── SETUP WEBHOOK NOTIFICATIONS ───────────────────────
    if (action === "setup_webhook_config") {
      // Step 1: Create alert configuration
      const alertEmail = body.alertEmail || "justinlmcneal@gmail.com";
      const configResult = await ebayFetch(
        accessToken,
        "PUT",
        `${EBAY_API}/commerce/notification/v1/config`,
        { alertEmail },
      );
      return new Response(
        JSON.stringify({ success: true, action: "setup_webhook_config", data: configResult.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "delete_webhook_destination") {
      const destinationId = body.destinationId;
      if (!destinationId) throw new Error("destinationId required");
      const result = await ebayFetch(
        accessToken,
        "DELETE",
        `${EBAY_API}/commerce/notification/v1/destination/${destinationId}`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "delete_webhook_destination", destinationId, data: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "create_webhook_destination") {
      // Step 2: Create destination endpoint (eBay will challenge-verify it)
      const endpointUrl = body.endpointUrl;
      const verificationToken = body.verificationToken;
      if (!endpointUrl || !verificationToken) throw new Error("endpointUrl and verificationToken required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${EBAY_API}/commerce/notification/v1/destination`,
        {
          name: "KarryKraze-Webhook",
          status: "ENABLED",
          deliveryConfig: {
            endpoint: endpointUrl,
            verificationToken,
            protocol: "HTTPS",
            method: "POST",
          },
        },
      );

      // destinationId is in the Location header
      const locationHeader = result.headers?.get?.("location") || "";
      const destinationId = locationHeader.split("/").pop() || (result.data as Record<string, unknown>)?.destinationId || "";

      return new Response(
        JSON.stringify({ success: true, action: "create_webhook_destination", destinationId, data: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "create_webhook_subscription") {
      // Step 3: Subscribe to a notification topic
      const topicId = body.topicId;
      const destinationId = body.destinationId;
      const schemaVersion = body.schemaVersion || "1.0";
      if (!topicId || !destinationId) throw new Error("topicId and destinationId required");

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${EBAY_API}/commerce/notification/v1/subscription`,
        {
          topicId,
          status: "ENABLED",
          payload: {
            format: "JSON",
            schemaVersion,
            deliveryProtocol: "HTTPS",
          },
          destinationId,
        },
      );

      const locationHeader = result.headers?.get?.("location") || "";
      const subscriptionId = locationHeader.split("/").pop() || (result.data as Record<string, unknown>)?.subscriptionId || "";

      return new Response(
        JSON.stringify({ success: true, action: "create_webhook_subscription", subscriptionId, topicId, data: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "list_webhook_subscriptions") {
      const result = await ebayFetch(
        accessToken,
        "GET",
        `${EBAY_API}/commerce/notification/v1/subscription`,
      );
      return new Response(
        JSON.stringify({ success: true, subscriptions: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "list_webhook_destinations") {
      const result = await ebayFetch(
        accessToken,
        "GET",
        `${EBAY_API}/commerce/notification/v1/destination`,
      );
      return new Response(
        JSON.stringify({ success: true, destinations: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "get_notification_topics") {
      const result = await ebayFetch(
        accessToken,
        "GET",
        `${EBAY_API}/commerce/notification/v1/topic`,
      );
      return new Response(
        JSON.stringify({ success: true, topics: result.data }),
        { headers: corsHeaders },
      );
    }

    if (action === "test_webhook_subscription") {
      const subscriptionId = body.subscriptionId;
      if (!subscriptionId) throw new Error("subscriptionId required");
      const result = await ebayFetch(
        accessToken,
        "POST",
        `${EBAY_API}/commerce/notification/v1/subscription/${subscriptionId}/test`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "test_webhook_subscription", data: result.data }),
        { headers: corsHeaders },
      );
    }

    // ── CREATE / UPDATE INVENTORY ITEM GROUP ─────────────
    if (action === "create_item_group" || action === "update_item_group") {
      const { inventoryItemGroupKey, title, description, imageUrls, aspects, variantSKUs, variesBy } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");
      if (!variantSKUs?.length) throw new Error("variantSKUs array is required");

      const groupBody: Record<string, unknown> = {
        title: title || "",
        description: description || "",
        imageUrls: imageUrls || [],
        aspects: aspects || {},
        variantSKUs,
        variesBy: variesBy || {},
      };

      const result = await ebayFetch(
        accessToken,
        "PUT",
        `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`,
        groupBody
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`${action} failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      // Store group key in products table (on the base product code)
      const baseCode = body.baseProductCode;
      if (baseCode) {
        await supabase
          .from("products")
          .update({
            ebay_item_group_key: inventoryItemGroupKey,
            ebay_status: "draft",
            updated_at: new Date().toISOString(),
          })
          .eq("code", baseCode);
      }

      return new Response(
        JSON.stringify({ success: true, inventoryItemGroupKey, action }),
        { headers: corsHeaders }
      );
    }

    // ── DELETE INVENTORY ITEM GROUP ──────────────────────
    if (action === "delete_item_group") {
      const { inventoryItemGroupKey } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const result = await ebayFetch(
        accessToken,
        "DELETE",
        `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`
      );

      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete item group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, deleted: inventoryItemGroupKey }),
        { headers: corsHeaders }
      );
    }

    // ── GET INVENTORY ITEM GROUP ────────────────────────
    if (action === "get_item_group") {
      const { inventoryItemGroupKey } = body;
      if (!inventoryItemGroupKey) throw new Error("inventoryItemGroupKey is required");

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`
      );

      if (!result.ok) {
        throw new Error(`Get item group failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, itemGroup: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE OFFER FOR ITEM GROUP ─────────────────────
    if (action === "create_group_offer") {
      const { categoryId, priceCents, policies, bestOfferTerms, storeCategoryNames, baseProductCode, variantSKUs } = body;
      if (!categoryId) throw new Error("categoryId is required");
      if (!variantSKUs?.length) throw new Error("variantSKUs is required");

      const priceValue = ((priceCents || 0) / 100).toFixed(2);
      const offerIds: string[] = [];

      for (const sku of variantSKUs as string[]) {
        const offer: Record<string, unknown> = {
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          categoryId,
          pricingSummary: {
            price: { value: priceValue, currency: "USD" },
          },
          listingPolicies: {
            fulfillmentPolicyId: policies?.fulfillmentPolicyId || Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") || "",
            returnPolicyId: policies?.returnPolicyId || Deno.env.get("EBAY_RETURN_POLICY_ID") || "",
            paymentPolicyId: policies?.paymentPolicyId || Deno.env.get("EBAY_PAYMENT_POLICY_ID") || "",
          },
          merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") || "default",
        };

        if (bestOfferTerms?.bestOfferEnabled) {
          (offer.listingPolicies as Record<string, unknown>).bestOfferTerms = {
            bestOfferEnabled: true,
            ...(bestOfferTerms.autoAcceptPrice ? { autoAcceptPrice: { value: bestOfferTerms.autoAcceptPrice, currency: "USD" } } : {}),
            ...(bestOfferTerms.autoDeclinePrice ? { autoDeclinePrice: { value: bestOfferTerms.autoDeclinePrice, currency: "USD" } } : {}),
          };
        }

        if (storeCategoryNames?.length) {
          offer.storeCategoryNames = storeCategoryNames;
        }

        let result = await ebayFetch(accessToken, "POST", `${INV_API}/offer`, offer);

        // If an offer already exists for this SKU, reuse it instead of failing.
        if (!result.ok) {
          const existing = await ebayFetch(accessToken, "GET", `${INV_API}/offer?sku=${encodeURIComponent(sku)}`);
          const existingOffers = (existing.data as { offers?: Array<{ offerId?: string }> })?.offers || [];
          const existingOfferId = existingOffers[0]?.offerId;
          if (existing.ok && existingOfferId) {
            offerIds.push(existingOfferId);
            continue;
          }
        }

        if (!result.ok) {
          throw new Error(`Create group offer failed (${result.status}): ${JSON.stringify(result.data)}`);
        }

        const offerId = (result.data as Record<string, string>)?.offerId;
        if (offerId) offerIds.push(offerId);
      }

      if (baseProductCode) {
        await supabase
          .from("products")
          .update({
            ebay_category_id: categoryId,
            ebay_price_cents: priceCents,
            updated_at: new Date().toISOString(),
          })
          .eq("code", baseProductCode);
      }

      return new Response(
        JSON.stringify({ success: true, offerIds, count: offerIds.length }),
        { headers: corsHeaders }
      );
    }

    // ── CREATE VOLUME DISCOUNT PROMOTION ─────────────────
    if (action === "create_volume_discount") {
      const { listingId, tiers, productCode } = body;
      if (!listingId) throw new Error("listingId is required");
      if (!tiers?.length) throw new Error("At least one discount tier is required");

      const now = new Date();
      const endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() + 1);

      const sortedTiers = [...tiers]
        .map((t: { minQuantity: number; percentOff: number }) => ({
          minQuantity: Number(t.minQuantity),
          percentOff: Number(t.percentOff || 0),
        }))
        .filter((t) => Number.isFinite(t.minQuantity) && t.minQuantity >= 2)
        .sort((a, b) => a.minQuantity - b.minQuantity);

      // VOLUME_DISCOUNT requires baseline rule: minQuantity=1 with 0% off.
      const normalized = [{ minQuantity: 1, percentOff: 0 }, ...sortedTiers]
        .slice(0, 4)
        .map((t, idx) => ({
          minQuantity: idx + 1,
          percentOff: t.percentOff,
        }));

      if (normalized.length < 2) {
        throw new Error("Volume pricing requires at least one tier at quantity 2+");
      }

      const discountRules = normalized.map((t) => ({
        ruleOrder: t.minQuantity,
        discountSpecification: { minQuantity: t.minQuantity },
        discountBenefit: { percentageOffOrder: String(t.percentOff) },
      }));

      let inventoryCriterion: Record<string, unknown> = {
        inventoryCriterionType: "INVENTORY_BY_VALUE",
        listingIds: [listingId],
      };

      // For multi-variation listings, use inventoryItemGroupKey to avoid listing-ID timing/eligibility issues.
      if (productCode) {
        const { data: product } = await supabase
          .from("products")
          .select("ebay_item_group_key")
          .eq("code", productCode)
          .maybeSingle();
        const groupKey = (product as { ebay_item_group_key?: string } | null)?.ebay_item_group_key;
        if (groupKey) {
          inventoryCriterion = {
            inventoryCriterionType: "INVENTORY_BY_VALUE",
            inventoryItems: [
              {
                inventoryReferenceType: "INVENTORY_ITEM_GROUP",
                inventoryReferenceId: groupKey,
              },
            ],
          };
        }
      }

      const promo = {
        name: `Volume Discount — ${productCode || listingId}`,
        marketplaceId: "EBAY_US",
        promotionStatus: "SCHEDULED",
        promotionType: "VOLUME_DISCOUNT",
        applyDiscountToSingleItemOnly: false,
        startDate: now.toISOString(),
        endDate: endDate.toISOString(),
        discountRules,
        inventoryCriterion,
      };

      let result = await ebayFetch(accessToken, "POST", `${MKTG_API}/item_promotion`, promo);
      // Newly published listings can briefly fail validation in Marketing API.
      if (!result.ok) {
        for (const waitMs of [1500, 3000]) {
          await delay(waitMs);
          result = await ebayFetch(accessToken, "POST", `${MKTG_API}/item_promotion`, promo);
          if (result.ok) break;
        }
      }
      if (!result.ok) {
        throw new Error(`Create volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      const promotionId = (result.data as Record<string, string>)?.promotionId
        || result.headers.get("Location")?.split("/").pop()
        || null;

      if (productCode && promotionId) {
        await supabase.from("products").update({
          ebay_volume_promo_id: promotionId,
          updated_at: new Date().toISOString(),
        }).eq("code", productCode);
      }

      return new Response(
        JSON.stringify({ success: true, promotionId }),
        { headers: corsHeaders }
      );
    }

    // ── GET VOLUME DISCOUNT PROMOTION ────────────────────
    if (action === "get_volume_discount") {
      const { promotionId } = body;
      if (!promotionId) throw new Error("promotionId is required");

      const result = await ebayFetch(accessToken, "GET", `${MKTG_API}/item_promotion/${promotionId}`);
      if (!result.ok) {
        throw new Error(`Get volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, promotion: result.data }),
        { headers: corsHeaders }
      );
    }

    // ── UPDATE VOLUME DISCOUNT PROMOTION ─────────────────
    if (action === "update_volume_discount") {
      const { promotionId, listingId, tiers } = body;
      if (!promotionId) throw new Error("promotionId is required");
      if (!tiers?.length) throw new Error("At least one discount tier is required");

      // Fetch existing promotion to preserve fields
      const current = await ebayFetch(accessToken, "GET", `${MKTG_API}/item_promotion/${promotionId}`);
      if (!current.ok) {
        throw new Error(`Get promotion failed (${current.status}): ${JSON.stringify(current.data)}`);
      }

      const existing = current.data as Record<string, unknown>;

      const sortedTiers = [...tiers]
        .map((t: { minQuantity: number; percentOff: number }) => ({
          minQuantity: Number(t.minQuantity),
          percentOff: Number(t.percentOff || 0),
        }))
        .filter((t) => Number.isFinite(t.minQuantity) && t.minQuantity >= 2)
        .sort((a, b) => a.minQuantity - b.minQuantity);

      const normalized = [{ minQuantity: 1, percentOff: 0 }, ...sortedTiers]
        .slice(0, 4)
        .map((t, idx) => ({
          minQuantity: idx + 1,
          percentOff: t.percentOff,
        }));

      if (normalized.length < 2) {
        throw new Error("Volume pricing requires at least one tier at quantity 2+");
      }

      const discountRules = normalized.map((t) => ({
        ruleOrder: t.minQuantity,
        discountSpecification: { minQuantity: t.minQuantity },
        discountBenefit: { percentageOffOrder: String(t.percentOff) },
      }));

      const updatedPromo: Record<string, unknown> = {
        ...existing,
        promotionStatus: (existing.promotionStatus as string) || "SCHEDULED",
        discountRules,
      };

      // If listingId changed, update inventoryCriterion
      if (listingId) {
        updatedPromo.inventoryCriterion = {
          inventoryCriterionType: "INVENTORY_BY_VALUE",
          listingIds: [listingId],
        };
      }

      const result = await ebayFetch(accessToken, "PUT", `${MKTG_API}/item_promotion/${promotionId}`, updatedPromo);
      if (!result.ok && result.status !== 204) {
        throw new Error(`Update volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      return new Response(
        JSON.stringify({ success: true, promotionId }),
        { headers: corsHeaders }
      );
    }

    // ── DELETE VOLUME DISCOUNT PROMOTION ─────────────────
    if (action === "delete_volume_discount") {
      const { promotionId, productCode } = body;
      if (!promotionId) throw new Error("promotionId is required");

      const result = await ebayFetch(accessToken, "DELETE", `${MKTG_API}/item_promotion/${promotionId}`);
      if (!result.ok && result.status !== 204) {
        throw new Error(`Delete volume discount failed (${result.status}): ${JSON.stringify(result.data)}`);
      }

      if (productCode) {
        await supabase.from("products").update({
          ebay_volume_promo_id: null,
          updated_at: new Date().toISOString(),
        }).eq("code", productCode);
      }

      return new Response(
        JSON.stringify({ success: true, deleted: promotionId }),
        { headers: corsHeaders }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: unknown) {
    console.error(
      "[ebay-listing] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
