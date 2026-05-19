// Platform test helpers (console / admin debugging)

import { getPlatformsContext } from "./platformsContext.js";

function createTestInstagramPostHandler() {
  return async function testInstagramPost() {
    const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY, getSupabaseClient } = getPlatformsContext();
    const client = getSupabaseClient();
    const { data: settings } = await client
      .from("social_settings").select("setting_value")
      .eq("setting_key", "instagram_connected").single();
    if (!settings?.setting_value) { alert("Please connect Instagram first!"); return; }

    const imageUrl = prompt("Enter a public image URL to post to Instagram:\n\n(Must be a publicly accessible image URL)");
    if (!imageUrl) return;
    const caption = prompt("Enter a caption for the post:", "Test post from KarryKraze Social Manager \ud83d\uded2\u2728 #karrykraze #test");
    if (caption === null) return;
    if (!confirm(`Ready to post to Instagram:\n\nImage: ${imageUrl}\nCaption: ${caption}\n\nProceed?`)) return;

    try {
      alert("Posting to Instagram... This may take a few seconds.");
      const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ postId: null, imageUrl, caption }),
      });
      const data = await resp.json();
      if (data.success) alert(`\ud83c\udf89 Posted to Instagram successfully!\n\nInstagram Media ID: ${data.mediaId}`);
      else alert(`Failed to post: ${data.error}\n\nCheck console for details.`);
    } catch (err) {
      console.error("Test post error:", err);
      alert("Failed to post. Check console for details.");
    }
  };
}

/** Preserve global `window.testInstagramPost`. */
export function registerPlatformTestActions() {
  window.testInstagramPost = createTestInstagramPostHandler();
}
