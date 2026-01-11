import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Pinterest access token from settings (using correct column names)
    const { data: settings } = await supabase
      .from("social_settings")
      .select("setting_key, setting_value")
      .eq("setting_key", "pinterest_access_token")
      .single();

    if (!settings?.setting_value?.token) {
      return new Response(
        JSON.stringify({ success: false, error: "Pinterest not connected" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    const accessToken = settings.setting_value.token;

    // Fetch boards from Pinterest API
    // Try production API first (for Standard access), fall back to sandbox for Trial access
    let pinterestResp = await fetch("https://api.pinterest.com/v5/boards", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`
      }
    });

    let pinterestData = await pinterestResp.json();
    
    // Log the response for debugging
    console.log("Pinterest API response:", JSON.stringify(pinterestData));

    if (!pinterestResp.ok) {
      // If production API fails, try sandbox
      console.log("Production API failed, trying sandbox...");
      pinterestResp = await fetch("https://api-sandbox.pinterest.com/v5/boards", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      });
      pinterestData = await pinterestResp.json();
      console.log("Sandbox API response:", JSON.stringify(pinterestData));
      
      if (!pinterestResp.ok) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: pinterestData.message || "Failed to fetch boards",
            debug: pinterestData
          }),
          { headers: corsHeaders, status: pinterestResp.status }
        );
      }
    }

    // Return boards
    return new Response(
      JSON.stringify({ 
        success: true, 
        boards: pinterestData.items || []
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Pinterest boards error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Unknown error" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
