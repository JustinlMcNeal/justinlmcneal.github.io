#!/usr/bin/env node
/** Test Amazon LWA refresh_token exchange (run locally, do not commit secrets). */
const clientId = process.env.LWA_CLIENT_ID || process.env.AMAZON_LWA_CLIENT_ID;
const clientSecret = process.env.LWA_CLIENT_SECRET || process.env.AMAZON_LWA_CLIENT_SECRET;
const refreshToken = process.env.REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.error("Set LWA_CLIENT_ID, LWA_CLIENT_SECRET, REFRESH_TOKEN env vars.");
  process.exit(1);
}

const resp = await fetch("https://api.amazon.com/auth/o2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken.trim(),
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
  }),
});

const data = await resp.json();
console.log("status:", resp.status);
console.log(JSON.stringify(data, null, 2));
