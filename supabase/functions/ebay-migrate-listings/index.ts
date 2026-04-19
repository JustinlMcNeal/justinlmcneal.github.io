// ebay-migrate-listings — One-time tool to discover existing Seller Hub (legacy) listings
// and import them into the Inventory API for unified management
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  getAccessToken,
  EBAY_API,
  matchProduct,
  KKProduct,
} from "../_shared/ebayUtils.ts";

const INV_API = `${EBAY_API}/sell/inventory/v1`;
const TRADING_API = "https://api.ebay.com/ws/api.dll";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();
    const accessToken = await getAccessToken(supabase);
    const body = await req.json();
    const { action } = body;

    // ── SCAN: List all active listings via Inventory API ─────
    if (action === "scan") {
      const items: unknown[] = [];
      let offset = 0;
      const limit = 100;

      while (true) {
        const resp = await fetch(
          `${INV_API}/inventory_item?limit=${limit}&offset=${offset}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!resp.ok) {
          // If 404, the seller has no inventory at all
          if (resp.status === 404) break;
          const errText = await resp.text();
          throw new Error(`List inventory failed (${resp.status}): ${errText.slice(0, 300)}`);
        }

        const data = await resp.json();
        const pageItems = data.inventoryItems || [];
        items.push(...pageItems);

        if (offset + limit >= (data.total || 0)) break;
        offset += limit;
      }

      // Load products for matching
      const { data: allProducts } = await supabase
        .from("products")
        .select("code, name");
      const products = (allProducts || []) as KKProduct[];

      // Try to match each eBay item to a KK product
      const results = items.map((item: unknown) => {
        const inv = item as Record<string, unknown>;
        const sku = inv.sku as string;
        const prod = inv.product as Record<string, unknown> | undefined;
        const title = (prod?.title as string) || sku;

        const matchedCode = matchProduct(title, products);

        return {
          sku,
          title,
          condition: inv.condition,
          quantity:
            (
              (inv.availability as Record<string, unknown>)
                ?.shipToLocationAvailability as Record<string, unknown>
            )?.quantity ?? 0,
          imageUrls: (prod?.imageUrls as string[]) || [],
          matchedCode,
        };
      });

      return new Response(
        JSON.stringify({
          success: true,
          total: results.length,
          items: results,
          matched: results.filter((r) => r.matchedCode).length,
          unmatched: results.filter((r) => !r.matchedCode).length,
        }),
        { headers: corsHeaders }
      );
    }

    // ── LINK: Associate existing eBay items with KK products ─
    if (action === "link") {
      const { links } = body;
      // links = [{ sku, productCode }]
      if (!links?.length) throw new Error("links array is required");

      let linked = 0;
      const errors: string[] = [];

      for (const link of links as { sku: string; productCode: string }[]) {
        // Get offers for this SKU to find offerId and listingId
        const offersResp = await fetch(
          `${INV_API}/offer?sku=${encodeURIComponent(link.sku)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        let offerId: string | null = null;
        let listingId: string | null = null;
        let categoryId: string | null = null;
        let priceCents: number | null = null;

        if (offersResp.ok) {
          const offersData = await offersResp.json();
          const offers = offersData.offers || [];
          if (offers.length > 0) {
            offerId = offers[0].offerId || null;
            listingId = offers[0].listing?.listingId || null;
            categoryId = offers[0].categoryId || null;
            const priceVal = offers[0].pricingSummary?.price?.value;
            if (priceVal) priceCents = Math.round(parseFloat(priceVal) * 100);
          }
        }

        const { error } = await supabase
          .from("products")
          .update({
            ebay_sku: link.sku,
            ebay_offer_id: offerId,
            ebay_listing_id: listingId,
            ebay_category_id: categoryId,
            ebay_price_cents: priceCents,
            ebay_status: listingId ? "active" : offerId ? "draft" : "not_listed",
            updated_at: new Date().toISOString(),
          })
          .eq("code", link.productCode);

        if (error) {
          errors.push(`${link.productCode}: ${error.message}`);
        } else {
          linked++;
        }
      }

      return new Response(
        JSON.stringify({ success: true, linked, errors }),
        { headers: corsHeaders }
      );
    }

    // ── AUTO-LINK: Scan + auto-match + link in one step ──────
    if (action === "auto_link") {
      // Step 1: Scan inventory
      const items: unknown[] = [];
      let offset = 0;
      const limit = 100;

      while (true) {
        const resp = await fetch(
          `${INV_API}/inventory_item?limit=${limit}&offset=${offset}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!resp.ok) {
          if (resp.status === 404) break;
          const errText = await resp.text();
          throw new Error(`List inventory failed (${resp.status}): ${errText.slice(0, 300)}`);
        }

        const data = await resp.json();
        items.push(...(data.inventoryItems || []));
        if (offset + limit >= (data.total || 0)) break;
        offset += limit;
      }

      // Step 2: Load products
      const { data: allProducts } = await supabase
        .from("products")
        .select("code, name");
      const products = (allProducts || []) as KKProduct[];

      // Step 3: Match and link
      let linked = 0;
      let skippedNoMatch = 0;
      const linkResults: { sku: string; title: string; code: string | null; linked: boolean }[] = [];

      for (const item of items) {
        const inv = item as Record<string, unknown>;
        const sku = inv.sku as string;
        const prod = inv.product as Record<string, unknown> | undefined;
        const title = (prod?.title as string) || sku;

        const matchedCode = matchProduct(title, products);
        if (!matchedCode) {
          skippedNoMatch++;
          linkResults.push({ sku, title, code: null, linked: false });
          continue;
        }

        // Get offers
        const offersResp = await fetch(
          `${INV_API}/offer?sku=${encodeURIComponent(sku)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        let offerId: string | null = null;
        let listingId: string | null = null;
        let categoryId: string | null = null;
        let priceCents: number | null = null;

        if (offersResp.ok) {
          const offersData = await offersResp.json();
          const offers = offersData.offers || [];
          if (offers.length > 0) {
            offerId = offers[0].offerId || null;
            listingId = offers[0].listing?.listingId || null;
            categoryId = offers[0].categoryId || null;
            const priceVal = offers[0].pricingSummary?.price?.value;
            if (priceVal) priceCents = Math.round(parseFloat(priceVal) * 100);
          }
        }

        await supabase
          .from("products")
          .update({
            ebay_sku: sku,
            ebay_offer_id: offerId,
            ebay_listing_id: listingId,
            ebay_category_id: categoryId,
            ebay_price_cents: priceCents,
            ebay_status: listingId ? "active" : offerId ? "draft" : "not_listed",
            updated_at: new Date().toISOString(),
          })
          .eq("code", matchedCode);

        linked++;
        linkResults.push({ sku, title, code: matchedCode, linked: true });
      }

      return new Response(
        JSON.stringify({
          success: true,
          total: items.length,
          linked,
          skippedNoMatch,
          results: linkResults,
        }),
        { headers: corsHeaders }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: unknown) {
    console.error("[ebay-migrate] Error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
