
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json"
};

serve(async (req) => {
  // No authorization header required; public endpoint for OAuth
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { code } = await req.json();
  const client_id = Deno.env.get("PINTEREST_CLIENT_ID") || "";
  const client_secret = Deno.env.get("PINTEREST_CLIENT_SECRET") || "";
  const redirect_uri = "https://karrykraze.com/pages/admin/social.html";

  // Pinterest requires Basic Auth: Base64(client_id:client_secret)
  const basicAuth = btoa(`${client_id}:${client_secret}`);

  // Exchange code for access token
  // Use sandbox API for Trial access apps
  const resp = await fetch("https://api-sandbox.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
    }),
  });

  const data = await resp.json();

  // Store token in Supabase if successful
  if (data.access_token) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    
    console.log("Saving Pinterest token to Supabase...");
    console.log("SUPABASE_URL:", supabaseUrl ? "set" : "NOT SET");
    console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseServiceKey ? "set" : "NOT SET");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate expiry date
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    // Store tokens in social_settings table - using correct column names: setting_key, setting_value
    const { error: err1 } = await supabase.from("social_settings").upsert(
      { setting_key: "pinterest_access_token", setting_value: { token: data.access_token } },
      { onConflict: "setting_key" }
    );
    if (err1) console.error("Error saving access_token:", err1);

    const { error: err2 } = await supabase.from("social_settings").upsert(
      { setting_key: "pinterest_refresh_token", setting_value: { token: data.refresh_token } },
      { onConflict: "setting_key" }
    );
    if (err2) console.error("Error saving refresh_token:", err2);

    const { error: err3 } = await supabase.from("social_settings").upsert(
      { setting_key: "pinterest_token_expires_at", setting_value: { expires_at: expiresAt } },
      { onConflict: "setting_key" }
    );
    if (err3) console.error("Error saving expires_at:", err3);

    const { error: err4 } = await supabase.from("social_settings").upsert(
      { setting_key: "pinterest_connected", setting_value: { connected: true } },
      { onConflict: "setting_key" }
    );
    if (err4) console.error("Error saving connected:", err4);

    // Add save status to response
    data.saved = !err1 && !err2 && !err3 && !err4;
    if (!data.saved) {
      data.save_errors = [err1, err2, err3, err4].filter(Boolean);
    }
  }

  return new Response(JSON.stringify(data), { headers: corsHeaders });
});