// ebay-account-deletion — Marketplace Account Deletion notification endpoint (compliance)
// Handles GET (challenge verification) and POST (deletion notifications)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-ebay-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const VERIFICATION_TOKEN = Deno.env.get("EBAY_VERIFICATION_TOKEN") || "";
  const ENDPOINT_URL = Deno.env.get("EBAY_DELETION_ENDPOINT") || "";

  // GET — eBay challenge code verification
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challengeCode = url.searchParams.get("challenge_code");

    if (!challengeCode) {
      return new Response(
        JSON.stringify({ error: "Missing challenge_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SHA-256 hash of: challengeCode + verificationToken + endpoint
    const encoder = new TextEncoder();
    const data = encoder.encode(challengeCode + VERIFICATION_TOKEN + ENDPOINT_URL);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    console.log("[ebay-deletion] Challenge verified, responding with hash");

    return new Response(
      JSON.stringify({ challengeResponse: hashHex }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // POST — Account deletion notification from eBay
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const topic = body?.metadata?.topic;
      const notificationId = body?.notification?.notificationId;
      const username = body?.notification?.data?.username;
      const userId = body?.notification?.data?.userId;

      console.log(
        `[ebay-deletion] Received notification: topic=${topic}, id=${notificationId}, user=${username || userId}`
      );

      // We don't persist eBay user data, so just acknowledge.
      // If we start storing eBay buyer data in the future, add deletion logic here.

      return new Response(null, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
      console.error("[ebay-deletion] Error processing notification:", err instanceof Error ? err.message : String(err));
      return new Response(null, { status: 200, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
