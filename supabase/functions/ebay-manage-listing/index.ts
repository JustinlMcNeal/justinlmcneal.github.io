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

/** Make an authenticated request to eBay Inventory/Account API */
async function ebayFetch(
  token: string,
  method: string,
  url: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
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
    return { ok: true, status: 204, data: null };
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

  return { ok: resp.ok, status: resp.status, data };
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

      // product = { title, description, imageUrls[], aspects{}, condition, quantity }
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

      const result = await ebayFetch(
        accessToken,
        "POST",
        `${INV_API}/offer/${offerId}/publish`,
        {}
      );

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
      const { sku } = body;
      if (!sku) throw new Error("sku is required");

      const result = await ebayFetch(
        accessToken,
        "GET",
        `${INV_API}/offer?sku=${encodeURIComponent(sku)}`
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
