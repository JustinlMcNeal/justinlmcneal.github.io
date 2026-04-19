// sync-pinterest-boards — auto-create Pinterest boards per category
// and store category→board mapping in social_settings

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Get Pinterest access token
    const { data: tokenRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "pinterest_access_token")
      .single();

    if (!tokenRow?.setting_value?.token) {
      return new Response(
        JSON.stringify({ success: false, error: "Pinterest not connected" }),
        { headers: corsHeaders, status: 400 }
      );
    }
    const accessToken = tokenRow.setting_value.token;

    // 2. Fetch existing boards from Pinterest API
    const boardsResp = await fetch("https://api.pinterest.com/v5/boards", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const boardsData = await boardsResp.json();
    if (!boardsResp.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: boardsData.message || "Failed to fetch boards",
        }),
        { headers: corsHeaders, status: boardsResp.status }
      );
    }

    const existingBoards: { id: string; name: string }[] =
      boardsData.items || [];
    console.log(
      `[sync-boards] Found ${existingBoards.length} existing boards:`,
      existingBoards.map((b: { name: string }) => b.name)
    );

    // 3. Get all categories
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name")
      .order("name");

    if (!categories?.length) {
      return new Response(
        JSON.stringify({ success: false, error: "No categories found" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // 4. Map existing boards to categories by name match
    const boardMap: Record<string, string> = {}; // category_id → pinterest_board_id
    const created: string[] = [];
    const matched: string[] = [];

    for (const cat of categories) {
      const displayName = `${cat.name.charAt(0).toUpperCase()}${cat.name.slice(1)} | Karry Kraze`;

      // Check if a board already exists with matching name
      const existing = existingBoards.find(
        (b: { name: string }) =>
          b.name.toLowerCase() === displayName.toLowerCase() ||
          b.name.toLowerCase() === cat.name.toLowerCase() ||
          b.name.toLowerCase().startsWith(cat.name.toLowerCase())
      );

      if (existing) {
        boardMap[cat.id] = existing.id;
        matched.push(`${cat.name} → ${existing.name} (${existing.id})`);
        continue;
      }

      // Create new board on Pinterest
      console.log(`[sync-boards] Creating board: "${displayName}"`);
      const createResp = await fetch("https://api.pinterest.com/v5/boards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: displayName,
          description: `Shop ${cat.name} at karrykraze.com — unique finds for every style.`,
          privacy: "PUBLIC",
        }),
      });

      const createResult = await createResp.json();

      if (createResp.ok && createResult.id) {
        boardMap[cat.id] = createResult.id;
        created.push(`${cat.name} → ${createResult.id}`);
      } else {
        console.error(
          `[sync-boards] Failed to create board "${displayName}":`,
          createResult
        );
      }
    }

    // 5. Ensure a default board exists
    let defaultBoardId = "";
    const defaultBoard = existingBoards.find(
      (b: { name: string }) =>
        b.name.toLowerCase().includes("karry kraze") &&
        !Object.values(boardMap).includes(b.id)
    );

    if (defaultBoard) {
      defaultBoardId = defaultBoard.id;
    } else if (!Object.keys(boardMap).length) {
      // Create a general board as fallback
      const fallbackResp = await fetch("https://api.pinterest.com/v5/boards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Karry Kraze",
          description:
            "Shop unique accessories, jewelry, bags & more at karrykraze.com",
          privacy: "PUBLIC",
        }),
      });
      const fallbackResult = await fallbackResp.json();
      if (fallbackResp.ok && fallbackResult.id) {
        defaultBoardId = fallbackResult.id;
        created.push(`_default → ${fallbackResult.id}`);
      }
    } else {
      // Use the first mapped board as default
      defaultBoardId = Object.values(boardMap)[0];
    }

    // 6. Store mapping in social_settings
    const mapping = {
      board_map: boardMap, // category_id → pinterest_board_id
      default_board_id: defaultBoardId,
      synced_at: new Date().toISOString(),
    };

    await supabase.from("social_settings").upsert(
      {
        setting_key: "pinterest_board_map",
        setting_value: mapping,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "setting_key" }
    );

    console.log("[sync-boards] Board mapping saved:", mapping);

    return new Response(
      JSON.stringify({
        success: true,
        matched,
        created,
        default_board_id: defaultBoardId,
        total_mapped: Object.keys(boardMap).length,
      }),
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error("[sync-boards] Error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
