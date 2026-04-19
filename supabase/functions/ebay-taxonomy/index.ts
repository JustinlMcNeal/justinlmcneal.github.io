// ebay-taxonomy — Category suggestions + item aspects from eBay Taxonomy API
// Uses application token (no seller auth needed)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  getAppToken,
  EBAY_API,
} from "../_shared/ebayUtils.ts";

const CATEGORY_TREE_ID = "0"; // eBay US (EBAY_US)

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();
    const appToken = await getAppToken();

    if (action === "suggest_category") {
      // GET /commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=...
      const query = encodeURIComponent(params.query || "");
      if (!query) throw new Error("query is required");

      const url = `${EBAY_API}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?q=${query}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${appToken}` },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Taxonomy API ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data = await resp.json();
      const suggestions = (data.categorySuggestions || []).map(
        (s: Record<string, unknown>) => ({
          categoryId: (s.category as Record<string, string>)?.categoryId,
          categoryName: (s.category as Record<string, string>)?.categoryName,
          categoryTreeNodeLevel: s.categoryTreeNodeLevel,
          relevancy: s.relevancy,
        })
      );

      return new Response(
        JSON.stringify({ success: true, suggestions }),
        { headers: corsHeaders }
      );
    }

    if (action === "get_aspects") {
      // GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=...
      const categoryId = params.categoryId;
      if (!categoryId) throw new Error("categoryId is required");

      // Check cache first
      const supabase = createServiceClient();
      const { data: cached } = await supabase
        .from("ebay_category_cache")
        .select("*")
        .eq("category_id", categoryId)
        .single();

      // Use cache if < 30 days old
      if (cached && cached.aspects) {
        const age = Date.now() - new Date(cached.cached_at).getTime();
        if (age < 30 * 24 * 60 * 60 * 1000) {
          return new Response(
            JSON.stringify({
              success: true,
              categoryId,
              categoryName: cached.category_name,
              aspects: cached.aspects,
              fromCache: true,
            }),
            { headers: corsHeaders }
          );
        }
      }

      const url = `${EBAY_API}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${categoryId}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${appToken}` },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Taxonomy API ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data = await resp.json();
      const aspects = (data.aspects || []).map(
        (a: Record<string, unknown>) => ({
          name: (a.localizedAspectName as string) || "",
          required:
            (a.aspectConstraint as Record<string, unknown>)?.aspectRequired === true,
          mode: (a.aspectConstraint as Record<string, unknown>)?.aspectMode || "FREE_TEXT",
          dataType:
            (a.aspectConstraint as Record<string, unknown>)?.aspectDataType || "STRING",
          values: ((a.aspectValues || []) as Record<string, string>[]).map(
            (v) => v.localizedValue
          ),
        })
      );

      // Cache the result
      const categoryName =
        aspects.length > 0 ? `Category ${categoryId}` : `Category ${categoryId}`;

      await supabase.from("ebay_category_cache").upsert(
        {
          category_id: categoryId,
          category_name: categoryName,
          aspects,
          cached_at: new Date().toISOString(),
        },
        { onConflict: "category_id" }
      );

      return new Response(
        JSON.stringify({
          success: true,
          categoryId,
          aspects,
          fromCache: false,
        }),
        { headers: corsHeaders }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: unknown) {
    console.error(
      "[ebay-taxonomy] Error:",
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
