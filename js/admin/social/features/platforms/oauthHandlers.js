// OAuth redirect callback handling (Pinterest / Instagram)

import { getPlatformsContext } from "./platformsContext.js";

function handlePinterestOAuth() {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getPlatformsContext();
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code && !params.get("state")?.includes("instagram")) {
    fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ code }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.access_token) {
        alert("Pinterest connected successfully!");
        window.history.replaceState({}, document.title, window.location.pathname);
        location.reload();
      } else {
        console.error("Pinterest OAuth error:", data);
        alert("Failed to connect Pinterest. Check console for details.");
      }
    })
    .catch(err => {
      console.error("Pinterest OAuth fetch error:", err);
      alert("Failed to connect Pinterest. Check console for details.");
    });
  }
}

function handleInstagramOAuth() {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getPlatformsContext();
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthState = params.get("state");
  if (code && oauthState === "instagram") {
    window.history.replaceState({}, document.title, window.location.pathname);
    fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-oauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ code }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert(`Instagram connected successfully! Welcome @${data.username}`);
        location.reload();
      } else {
        console.error("Instagram OAuth error:", data);
        if (data.debug) console.log("Debug info:", data.debug);
        alert(`Failed to connect Instagram: ${data.error || "Unknown error"}`);
      }
    })
    .catch(err => {
      console.error("Instagram OAuth fetch error:", err);
      alert("Failed to connect Instagram. Check console for details.");
    });
  }
}

/** Register DOMContentLoaded OAuth redirect handlers (same as legacy index.js). */
export function registerOAuthRedirectHandlers() {
  window.addEventListener("DOMContentLoaded", handlePinterestOAuth);
  window.addEventListener("DOMContentLoaded", handleInstagramOAuth);
}
