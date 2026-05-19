// Platform publish helpers (Instagram / Facebook / Pinterest edge functions)

import { getPlatformsContext } from "./platformsContext.js";

export async function postToInstagram(postId, imageUrl, caption) {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getPlatformsContext();
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/instagram-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId, imageUrl, caption }),
    });
    const data = await resp.json();
    if (data.success) { alert("Posted to Instagram successfully!"); return data; }
    else { alert(`Failed to post to Instagram: ${data.error}`); return null; }
  } catch (err) {
    console.error("Instagram post error:", err);
    alert("Failed to post to Instagram. Check console for details.");
    return null;
  }
}

export async function postToFacebook(postId, imageUrl, caption, linkUrl = null) {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getPlatformsContext();
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/facebook-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId, imageUrl, caption, linkUrl }),
    });
    const data = await resp.json();
    if (data.success) { alert("Posted to Facebook successfully!"); return data; }
    else { alert(`Failed to post to Facebook: ${data.error}`); return null; }
  } catch (err) {
    console.error("Facebook post error:", err);
    alert("Failed to post to Facebook. Check console for details.");
    return null;
  }
}

export async function postToPinterest(postId, imageUrl, title, description, link, boardId) {
  const { SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } = getPlatformsContext();
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/pinterest-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ postId, imageUrl, title, description, link, boardId }),
    });
    const data = await resp.json();
    if (data.success) { alert("Pin created successfully!"); return data; }
    else { alert(`Failed to post: ${data.error}`); return null; }
  } catch (err) {
    console.error("Pinterest post error:", err);
    alert("Failed to post to Pinterest. Check console for details.");
    return null;
  }
}
